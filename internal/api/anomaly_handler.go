package api

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// AnomalyHandler detects unusual signal values and produces health alerts.
type AnomalyHandler struct {
	db *database.DB
}

func NewAnomalyHandler(db *database.DB) *AnomalyHandler {
	return &AnomalyHandler{db: db}
}

// ── Response types ───────────────────────────────────────────

type anomalyResponse struct {
	Anomalies         []anomalyEntry    `json:"anomalies"`
	HealthSummary     map[string]string `json:"health_summary"`
	SignalsMonitored  int               `json:"signals_monitored"`
	AnomaliesLast7d   int               `json:"anomalies_last_7d"`
	AnomaliesLast24h  int               `json:"anomalies_last_24h"`
}

type anomalyEntry struct {
	Signal     string  `json:"signal"`
	Type       string  `json:"type"`
	Severity   string  `json:"severity"`
	Value      float64 `json:"value"`
	Baseline   float64 `json:"baseline"`
	ZScore     float64 `json:"z_score"`
	DetectedAt string  `json:"detected_at"`
	Message    string  `json:"message"`
}

// Predefined safe ranges for critical signals.
var safeRanges = map[string][2]float64{
	"BatteryLevel":        {0, 100},
	"PackVoltage":         {300, 420},
	"ModuleTempMax":       {-20, 55},
	"ModuleTempMin":       {-20, 55},
	"TpmsPressureFl":      {2.0, 3.5},
	"TpmsPressureFr":      {2.0, 3.5},
	"TpmsPressureRl":      {2.0, 3.5},
	"TpmsPressureRr":      {2.0, 3.5},
	"InsideTemp":          {-30, 60},
	"OutsideTemp":         {-40, 60},
	"DiStatorTempF":       {-20, 150},
	"DiStatorTempR":       {-20, 150},
	"IsolationResistance": {500, 99999},
}

// Maps signals to health categories.
var signalCategory = map[string]string{
	"BatteryLevel":        "battery",
	"PackVoltage":         "battery",
	"ModuleTempMax":       "battery",
	"ModuleTempMin":       "battery",
	"TpmsPressureFl":      "tires",
	"TpmsPressureFr":      "tires",
	"TpmsPressureRl":      "tires",
	"TpmsPressureRr":      "tires",
	"DiStatorTempF":       "motors",
	"DiStatorTempR":       "motors",
	"InsideTemp":          "hvac",
	"OutsideTemp":         "hvac",
	"IsolationResistance": "charging",
}

// Severity classification based on signal type and deviation.
var criticalSignals = map[string]bool{
	"IsolationResistance": true,
	"TpmsPressureFl":      true,
	"TpmsPressureFr":      true,
	"TpmsPressureRl":      true,
	"TpmsPressureRr":      true,
	"ModuleTempMax":       true,
}

// Human-readable signal display names.
var signalDisplayName = map[string]string{
	"BatteryLevel":        "Battery Level",
	"PackVoltage":         "Pack Voltage",
	"ModuleTempMax":       "Battery Module Temp (Max)",
	"ModuleTempMin":       "Battery Module Temp (Min)",
	"TpmsPressureFl":      "Tire Pressure (Front-Left)",
	"TpmsPressureFr":      "Tire Pressure (Front-Right)",
	"TpmsPressureRl":      "Tire Pressure (Rear-Left)",
	"TpmsPressureRr":      "Tire Pressure (Rear-Right)",
	"InsideTemp":          "Cabin Temperature",
	"OutsideTemp":         "Outside Temperature",
	"DiStatorTempF":       "Front Motor Stator Temp",
	"DiStatorTempR":       "Rear Motor Stator Temp",
	"IsolationResistance": "HV Isolation Resistance",
}

// ── Handler ──────────────────────────────────────────────────

// GetAnomalies handles GET /analytics/anomalies?vehicle_id=X&days=7
func (h *AnomalyHandler) GetAnomalies(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	days := 7
	if d, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && d > 0 && d <= 30 {
		days = d
	}

	ctx := r.Context()
	since := time.Now().AddDate(0, 0, -days)

	var allAnomalies []anomalyEntry

	// ── 1. Z-score outliers ──────────────────────────────────
	zAnomalies, signalsChecked := h.detectZScoreAnomalies(ctx, vehicleID, since)
	allAnomalies = append(allAnomalies, zAnomalies...)

	// ── 2. Range violations ──────────────────────────────────
	rangeAnomalies := h.detectRangeViolations(ctx, vehicleID, since)
	allAnomalies = append(allAnomalies, rangeAnomalies...)

	// ── 3. Trend anomalies ───────────────────────────────────
	trendAnomalies := h.detectTrendAnomalies(ctx, vehicleID)
	allAnomalies = append(allAnomalies, trendAnomalies...)

	// Deduplicate by signal+type (keep highest z-score)
	allAnomalies = deduplicateAnomalies(allAnomalies)

	// Sort by severity then time
	sort.Slice(allAnomalies, func(i, j int) bool {
		si := severityOrder(allAnomalies[i].Severity)
		sj := severityOrder(allAnomalies[j].Severity)
		if si != sj {
			return si < sj
		}
		return allAnomalies[i].DetectedAt > allAnomalies[j].DetectedAt
	})

	// ── Health summary ───────────────────────────────────────
	healthSummary := map[string]string{
		"battery":  "normal",
		"tires":    "normal",
		"motors":   "normal",
		"hvac":     "normal",
		"charging": "normal",
	}
	for _, a := range allAnomalies {
		cat := signalCategory[a.Signal]
		if cat == "" {
			continue
		}
		current := healthSummary[cat]
		if severityOrder(a.Severity) < severityOrder(current) {
			healthSummary[cat] = a.Severity
		}
	}

	// Count last 24h and 7d
	now := time.Now()
	last24h := 0
	for _, a := range allAnomalies {
		t, _ := time.Parse(time.RFC3339, a.DetectedAt)
		if now.Sub(t) < 24*time.Hour {
			last24h++
		}
	}

	writeJSON(w, http.StatusOK, anomalyResponse{
		Anomalies:        allAnomalies,
		HealthSummary:    healthSummary,
		SignalsMonitored: signalsChecked,
		AnomaliesLast7d:  len(allAnomalies),
		AnomaliesLast24h: last24h,
	})
}

// ── Z-score detection ────────────────────────────────────────

func (h *AnomalyHandler) detectZScoreAnomalies(ctx interface {
	Deadline() (time.Time, bool)
	Done() <-chan struct{}
	Err() error
	Value(interface{}) interface{}
}, vehicleID int64, since time.Time) ([]anomalyEntry, int) {

	rows, err := h.db.Pool.Query(ctx, `
		WITH stats AS (
			SELECT field,
			       AVG(COALESCE(float_value, int_value::float8)) AS mean,
			       STDDEV(COALESCE(float_value, int_value::float8)) AS stddev,
			       COUNT(*) AS cnt
			FROM signal_log
			WHERE vehicle_id = $1 AND ts > $2
			  AND (float_value IS NOT NULL OR int_value IS NOT NULL)
			GROUP BY field
			HAVING STDDEV(COALESCE(float_value, int_value::float8)) > 0
			   AND COUNT(*) >= 30
		)
		SELECT sh.field,
		       COALESCE(sh.float_value, sh.int_value::float8) AS value,
		       sh.ts,
		       s.mean,
		       s.stddev,
		       ABS(COALESCE(sh.float_value, sh.int_value::float8) - s.mean) / s.stddev AS z_score
		FROM signal_log sh
		JOIN stats s ON sh.field = s.field
		WHERE sh.vehicle_id = $1
		  AND sh.ts > $2
		  AND (sh.float_value IS NOT NULL OR sh.int_value IS NOT NULL)
		  AND ABS(COALESCE(sh.float_value, sh.int_value::float8) - s.mean) / s.stddev > 3
		ORDER BY sh.ts DESC
		LIMIT 100`, vehicleID, since)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("anomaly: z-score query failed")
		return nil, 0
	}
	defer rows.Close()

	var anomalies []anomalyEntry
	for rows.Next() {
		var signal string
		var value, mean, stddev, zScore float64
		var ts time.Time
		if err := rows.Scan(&signal, &value, &ts, &mean, &stddev, &zScore); err != nil {
			continue
		}
		sev := classifySeverity(signal, zScore)
		name := signalDisplayName[signal]
		if name == "" {
			name = signal
		}
		anomalies = append(anomalies, anomalyEntry{
			Signal:     signal,
			Type:       "z_score",
			Severity:   sev,
			Value:      round2(value),
			Baseline:   round2(mean),
			ZScore:     round2(zScore),
			DetectedAt: ts.Format(time.RFC3339),
			Message:    fmt.Sprintf("%s value %.2f is %.1fσ from mean (%.2f)", name, value, zScore, mean),
		})
	}

	// Count signals checked
	var signalsChecked int
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT field) FROM signal_log
		WHERE vehicle_id = $1 AND ts > $2
		  AND (float_value IS NOT NULL OR int_value IS NOT NULL)`,
		vehicleID, since).Scan(&signalsChecked)

	return anomalies, signalsChecked
}

// ── Range violation detection ────────────────────────────────

func (h *AnomalyHandler) detectRangeViolations(ctx interface {
	Deadline() (time.Time, bool)
	Done() <-chan struct{}
	Err() error
	Value(interface{}) interface{}
}, vehicleID int64, since time.Time) []anomalyEntry {

	var anomalies []anomalyEntry

	for signal, bounds := range safeRanges {
		var value float64
		var ts time.Time
		err := h.db.Pool.QueryRow(ctx, `
			SELECT COALESCE(float_value, int_value::float8), ts FROM signal_log
			WHERE vehicle_id = $1 AND field = $2 AND ts > $3
			  AND (float_value IS NOT NULL OR int_value IS NOT NULL)
			  AND (COALESCE(float_value, int_value::float8) < $4 OR COALESCE(float_value, int_value::float8) > $5)
			ORDER BY ts DESC LIMIT 1`,
			vehicleID, signal, since, bounds[0], bounds[1]).Scan(&value, &ts)
		if err != nil {
			continue
		}

		name := signalDisplayName[signal]
		if name == "" {
			name = signal
		}
		midpoint := (bounds[0] + bounds[1]) / 2
		sev := "warning"
		if criticalSignals[signal] {
			sev = "critical"
		}

		var msg string
		if value < bounds[0] {
			msg = fmt.Sprintf("%s value %.2f is below safe minimum (%.1f)", name, value, bounds[0])
		} else {
			msg = fmt.Sprintf("%s value %.2f exceeds safe maximum (%.1f)", name, value, bounds[1])
		}

		anomalies = append(anomalies, anomalyEntry{
			Signal:     signal,
			Type:       "range",
			Severity:   sev,
			Value:      round2(value),
			Baseline:   round2(midpoint),
			ZScore:     0,
			DetectedAt: ts.Format(time.RFC3339),
			Message:    msg,
		})
	}

	return anomalies
}

// ── Trend anomaly detection ──────────────────────────────────

func (h *AnomalyHandler) detectTrendAnomalies(ctx interface {
	Deadline() (time.Time, bool)
	Done() <-chan struct{}
	Err() error
	Value(interface{}) interface{}
}, vehicleID int64) []anomalyEntry {

	trendSignals := []string{
		"BatteryLevel", "PackVoltage",
		"TpmsPressureFl", "TpmsPressureFr", "TpmsPressureRl", "TpmsPressureRr",
	}

	var anomalies []anomalyEntry
	for _, signal := range trendSignals {
		var avg7d, stddev7d, avg24h *float64
		err := h.db.Pool.QueryRow(ctx, `
			SELECT
				(SELECT AVG(COALESCE(float_value, int_value::float8)) FROM signal_log WHERE vehicle_id = $1 AND field = $2 AND ts > NOW() - INTERVAL '7 days' AND (float_value IS NOT NULL OR int_value IS NOT NULL)),
				(SELECT STDDEV(COALESCE(float_value, int_value::float8)) FROM signal_log WHERE vehicle_id = $1 AND field = $2 AND ts > NOW() - INTERVAL '7 days' AND (float_value IS NOT NULL OR int_value IS NOT NULL)),
				(SELECT AVG(COALESCE(float_value, int_value::float8)) FROM signal_log WHERE vehicle_id = $1 AND field = $2 AND ts > NOW() - INTERVAL '24 hours' AND (float_value IS NOT NULL OR int_value IS NOT NULL))
			`, vehicleID, signal).Scan(&avg7d, &stddev7d, &avg24h)
		if err != nil || avg7d == nil || stddev7d == nil || avg24h == nil || *stddev7d == 0 {
			continue
		}

		deviation := math.Abs(*avg24h - *avg7d) / *stddev7d
		if deviation <= 2 {
			continue
		}

		name := signalDisplayName[signal]
		if name == "" {
			name = signal
		}
		sev := "info"
		if criticalSignals[signal] {
			sev = "warning"
		}
		if deviation > 4 {
			sev = "critical"
		}

		direction := "increased"
		if *avg24h < *avg7d {
			direction = "decreased"
		}
		pctChange := math.Abs(*avg24h-*avg7d) / math.Abs(*avg7d) * 100

		anomalies = append(anomalies, anomalyEntry{
			Signal:     signal,
			Type:       "trend",
			Severity:   sev,
			Value:      round2(*avg24h),
			Baseline:   round2(*avg7d),
			ZScore:     round2(deviation),
			DetectedAt: time.Now().Format(time.RFC3339),
			Message:    fmt.Sprintf("%s %s %.0f%% in last 24h vs 7-day average (%.2f → %.2f)", name, direction, pctChange, *avg7d, *avg24h),
		})
	}

	return anomalies
}

// ── Helpers ──────────────────────────────────────────────────

func classifySeverity(signal string, zScore float64) string {
	if criticalSignals[signal] && zScore > 4 {
		return "critical"
	}
	if zScore > 5 {
		return "critical"
	}
	if zScore > 4 || criticalSignals[signal] {
		return "warning"
	}
	return "info"
}

func severityOrder(sev string) int {
	switch sev {
	case "critical":
		return 0
	case "warning":
		return 1
	case "info":
		return 2
	case "normal":
		return 3
	default:
		return 4
	}
}

func deduplicateAnomalies(anomalies []anomalyEntry) []anomalyEntry {
	best := make(map[string]anomalyEntry)
	for _, a := range anomalies {
		key := a.Signal + "|" + a.Type
		if existing, ok := best[key]; !ok || a.ZScore > existing.ZScore {
			best[key] = a
		}
	}
	result := make([]anomalyEntry, 0, len(best))
	for _, a := range best {
		result = append(result, a)
	}
	return result
}
