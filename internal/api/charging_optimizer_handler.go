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

// ChargingOptimizerHandler analyses charging habits and recommends schedule optimizations.
type ChargingOptimizerHandler struct {
	db *database.DB
}

func NewChargingOptimizerHandler(db *database.DB) *ChargingOptimizerHandler {
	return &ChargingOptimizerHandler{db: db}
}

// ── Response types ───────────────────────────────────────────

type optimizerResponse struct {
	CurrentSchedule    currentSchedule      `json:"current_schedule"`
	CostAnalysis       costAnalysis         `json:"cost_analysis"`
	BatteryHealthScore int                  `json:"battery_health_score"`
	Recommendations    []optimizerRec       `json:"recommendations"`
	WeeklyHeatmap      []heatmapEntry       `json:"weekly_heatmap"`
}

type currentSchedule struct {
	MostCommonStartHour int     `json:"most_common_start_hour"`
	MostCommonDay       string  `json:"most_common_day"`
	AvgSessionsPerWeek  float64 `json:"avg_sessions_per_week"`
	HomeChargingPct     float64 `json:"home_charging_pct"`
	AvgChargeToPct      float64 `json:"avg_charge_to_pct"`
}

type costAnalysis struct {
	PeakHours              []int   `json:"peak_hours"`
	OffpeakHours           []int   `json:"offpeak_hours"`
	PeakCostPerKWh         float64 `json:"peak_cost_per_kwh"`
	OffpeakCostPerKWh      float64 `json:"offpeak_cost_per_kwh"`
	SessionsDuringPeakPct  float64 `json:"sessions_during_peak_pct"`
	PotentialMonthlySavings float64 `json:"potential_monthly_savings"`
}

type optimizerRec struct {
	Type            string   `json:"type"`
	Priority        string   `json:"priority"`
	Title           string   `json:"title"`
	Detail          string   `json:"detail"`
	EstimatedSavings float64 `json:"estimated_savings,omitempty"`
}

type heatmapEntry struct {
	Day           int     `json:"day"`
	Hour          int     `json:"hour"`
	Sessions      int     `json:"sessions"`
	AvgCostPerKWh float64 `json:"avg_cost_per_kwh"`
}

// ── Internal types ───────────────────────────────────────────

type sessionRow struct {
	startDate    time.Time
	cost         float64
	kwh          float64
	power        float64
	endBattery   int
	startBattery int
	lat          float64
	lon          float64
	outsideTemp  float64
}

// ── Handler ──────────────────────────────────────────────────

// GetOptimization handles GET /analytics/charging-optimizer?vehicle_id=X
func (h *ChargingOptimizerHandler) GetOptimization(w http.ResponseWriter, r *http.Request) {
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

	ctx := r.Context()

	rows, err := h.db.Pool.Query(ctx, `
		SELECT start_ts,
		       COALESCE(cost, 0),
		       COALESCE(energy_added_kwh, 0),
		       COALESCE(charger_power_kw_max, 0),
		       COALESCE(end_battery_pct, 0),
		       COALESCE(start_battery_pct, 0)
		FROM charging_sessions
		WHERE vehicle_id = $1
		ORDER BY start_ts DESC`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("charging-optimizer: query failed")
		writeError(w, http.StatusInternalServerError, "failed to get charging data")
		return
	}
	defer rows.Close()

	var sessions []sessionRow
	for rows.Next() {
		var s sessionRow
		if err := rows.Scan(&s.startDate, &s.cost, &s.kwh, &s.power,
			&s.endBattery, &s.startBattery); err != nil {
			continue
		}
		// lat, lon, outsideTemp not available in charging_sessions — use defaults
		// detectHome() skips (0,0) entries; outsideTemp=20 is neutral for health scoring
		s.outsideTemp = 20
		sessions = append(sessions, s)
	}

	if len(sessions) == 0 {
		writeJSON(w, http.StatusOK, optimizerResponse{
			CurrentSchedule:    currentSchedule{},
			CostAnalysis:       costAnalysis{PeakHours: []int{}, OffpeakHours: []int{}},
			Recommendations:    []optimizerRec{},
			WeeklyHeatmap:      []heatmapEntry{},
		})
		return
	}

	schedule := analyzeSchedule(sessions)
	homeLocSessions, homePct := detectHome(sessions)
	schedule.HomeChargingPct = round2(homePct)

	heatmap, ca := analyzeCosts(sessions, homeLocSessions)
	healthScore := computeBatteryHealthScore(sessions)
	recs := buildOptimizerRecommendations(schedule, ca, healthScore, sessions)

	writeJSON(w, http.StatusOK, optimizerResponse{
		CurrentSchedule:    schedule,
		CostAnalysis:       ca,
		BatteryHealthScore: healthScore,
		Recommendations:    recs,
		WeeklyHeatmap:      heatmap,
	})
}

// ── Schedule analysis ────────────────────────────────────────

func analyzeSchedule(sessions []sessionRow) currentSchedule {
	hourCount := make(map[int]int)
	weekdayCount := 0
	weekendCount := 0
	var totalEndBattery float64
	endBatteryN := 0

	for _, s := range sessions {
		h := s.startDate.Hour()
		hourCount[h]++
		if s.startDate.Weekday() >= time.Monday && s.startDate.Weekday() <= time.Friday {
			weekdayCount++
		} else {
			weekendCount++
		}
		if s.endBattery > 0 {
			totalEndBattery += float64(s.endBattery)
			endBatteryN++
		}
	}

	// Most common hour
	bestHour := 0
	bestCount := 0
	for h, c := range hourCount {
		if c > bestCount {
			bestHour = h
			bestCount = c
		}
	}

	commonDay := "weekday"
	if weekendCount > weekdayCount {
		commonDay = "weekend"
	}

	// Average sessions per week
	var first, last time.Time
	if len(sessions) > 0 {
		last = sessions[0].startDate
		first = sessions[len(sessions)-1].startDate
	}
	weeks := last.Sub(first).Hours() / (24 * 7)
	if weeks < 1 {
		weeks = 1
	}
	avgPerWeek := float64(len(sessions)) / weeks

	avgChargeTo := 0.0
	if endBatteryN > 0 {
		avgChargeTo = totalEndBattery / float64(endBatteryN)
	}

	return currentSchedule{
		MostCommonStartHour: bestHour,
		MostCommonDay:       commonDay,
		AvgSessionsPerWeek:  round2(avgPerWeek),
		AvgChargeToPct:      round2(avgChargeTo),
	}
}

// ── Home detection ───────────────────────────────────────────

func detectHome(sessions []sessionRow) (homeCount int, homePct float64) {
	if len(sessions) == 0 {
		return 0, 0
	}

	// Cluster locations: find most frequent within 0.001° (~100m)
	type locCluster struct {
		lat, lon float64
		count    int
	}
	var clusters []locCluster

	for _, s := range sessions {
		if s.lat == 0 && s.lon == 0 {
			continue
		}
		found := false
		for i := range clusters {
			if math.Abs(clusters[i].lat-s.lat) < 0.001 && math.Abs(clusters[i].lon-s.lon) < 0.001 {
				clusters[i].count++
				found = true
				break
			}
		}
		if !found {
			clusters = append(clusters, locCluster{lat: s.lat, lon: s.lon, count: 1})
		}
	}

	if len(clusters) == 0 {
		return 0, 0
	}

	// Largest cluster = home
	sort.Slice(clusters, func(i, j int) bool { return clusters[i].count > clusters[j].count })
	homeCount = clusters[0].count
	homePct = float64(homeCount) / float64(len(sessions)) * 100
	return homeCount, homePct
}

// ── Cost analysis ────────────────────────────────────────────

func analyzeCosts(sessions []sessionRow, homeCount int) ([]heatmapEntry, costAnalysis) {
	type hourBucket struct {
		totalCost float64
		totalKwh  float64
		sessions  int
	}

	// Build 7×24 heatmap + per-hour cost aggregation
	grid := make(map[[2]int]*hourBucket)    // [day, hour] → bucket
	hourAgg := make(map[int]*hourBucket)     // hour → bucket (for peak detection)

	for _, s := range sessions {
		day := int(s.startDate.Weekday())
		hour := s.startDate.Hour()

		key := [2]int{day, hour}
		if grid[key] == nil {
			grid[key] = &hourBucket{}
		}
		grid[key].totalCost += s.cost
		grid[key].totalKwh += s.kwh
		grid[key].sessions++

		if hourAgg[hour] == nil {
			hourAgg[hour] = &hourBucket{}
		}
		hourAgg[hour].totalCost += s.cost
		hourAgg[hour].totalKwh += s.kwh
		hourAgg[hour].sessions++
	}

	// Build heatmap entries
	heatmap := make([]heatmapEntry, 0, len(grid))
	for key, b := range grid {
		avgCPK := 0.0
		if b.totalKwh > 0 {
			avgCPK = b.totalCost / b.totalKwh
		}
		heatmap = append(heatmap, heatmapEntry{
			Day:           key[0],
			Hour:          key[1],
			Sessions:      b.sessions,
			AvgCostPerKWh: round3(avgCPK),
		})
	}
	sort.Slice(heatmap, func(i, j int) bool {
		if heatmap[i].Day != heatmap[j].Day {
			return heatmap[i].Day < heatmap[j].Day
		}
		return heatmap[i].Hour < heatmap[j].Hour
	})

	// Find peak and off-peak from actual data
	type hourCost struct {
		hour int
		cpk  float64
	}
	var hourCosts []hourCost
	for h, b := range hourAgg {
		cpk := 0.0
		if b.totalKwh > 0 {
			cpk = b.totalCost / b.totalKwh
		}
		hourCosts = append(hourCosts, hourCost{hour: h, cpk: cpk})
	}
	sort.Slice(hourCosts, func(i, j int) bool { return hourCosts[i].cpk < hourCosts[j].cpk })

	offpeakHours := make([]int, 0)
	peakHours := make([]int, 0)
	var offpeakCPK, peakCPK float64

	if len(hourCosts) > 0 {
		// Cheapest 30% = off-peak, most expensive 30% = peak
		offCut := len(hourCosts) / 3
		if offCut < 1 {
			offCut = 1
		}
		peakCut := len(hourCosts) - offCut

		var offTotal, offN, peakTotal, peakN float64
		for i, hc := range hourCosts {
			if i < offCut {
				offpeakHours = append(offpeakHours, hc.hour)
				offTotal += hc.cpk
				offN++
			}
			if i >= peakCut {
				peakHours = append(peakHours, hc.hour)
				peakTotal += hc.cpk
				peakN++
			}
		}
		if offN > 0 {
			offpeakCPK = offTotal / offN
		}
		if peakN > 0 {
			peakCPK = peakTotal / peakN
		}
	}

	// Sessions during peak %
	peakSet := make(map[int]bool)
	for _, h := range peakHours {
		peakSet[h] = true
	}
	peakSessions := 0
	for _, s := range sessions {
		if peakSet[s.startDate.Hour()] {
			peakSessions++
		}
	}
	peakPct := 0.0
	if len(sessions) > 0 {
		peakPct = float64(peakSessions) / float64(len(sessions)) * 100
	}

	// Potential savings: shift peak home sessions to off-peak
	var monthlyHomeKwh float64
	var first, last time.Time
	if len(sessions) > 0 {
		last = sessions[0].startDate
		first = sessions[len(sessions)-1].startDate
	}
	months := last.Sub(first).Hours() / (24 * 30.44)
	if months < 1 {
		months = 1
	}

	for _, s := range sessions {
		monthlyHomeKwh += s.kwh
	}
	monthlyHomeKwh /= months
	peakFraction := peakPct / 100
	potentialSavings := monthlyHomeKwh * peakFraction * math.Max(0, peakCPK-offpeakCPK)

	sort.Ints(peakHours)
	sort.Ints(offpeakHours)

	ca := costAnalysis{
		PeakHours:               peakHours,
		OffpeakHours:            offpeakHours,
		PeakCostPerKWh:          round3(peakCPK),
		OffpeakCostPerKWh:       round3(offpeakCPK),
		SessionsDuringPeakPct:   round2(peakPct),
		PotentialMonthlySavings: round2(potentialSavings),
	}
	return heatmap, ca
}

// ── Battery health score ─────────────────────────────────────

func computeBatteryHealthScore(sessions []sessionRow) int {
	if len(sessions) == 0 {
		return 100
	}
	score := 100.0

	var fullChargeCount, dcFastCount, extremeTempCount int
	var homeStyleCount int
	n := float64(len(sessions))

	for _, s := range sessions {
		if s.endBattery >= 95 {
			fullChargeCount++
		}
		if s.power > 50 {
			dcFastCount++
		}
		if s.outsideTemp < 0 || s.outsideTemp > 40 {
			extremeTempCount++
		}
		if s.power <= 22 || s.power == 0 {
			homeStyleCount++
		}
	}

	// Deductions
	fullPct := float64(fullChargeCount) / n * 100
	if fullPct > 50 {
		score -= 25
	} else if fullPct > 25 {
		score -= 15
	} else if fullPct > 10 {
		score -= 5
	}

	dcPct := float64(dcFastCount) / n * 100
	if dcPct > 50 {
		score -= 20
	} else if dcPct > 25 {
		score -= 10
	}

	extremePct := float64(extremeTempCount) / n * 100
	if extremePct > 30 {
		score -= 15
	} else if extremePct > 15 {
		score -= 8
	}

	// Bonuses
	homePct := float64(homeStyleCount) / n * 100
	if homePct > 70 {
		score += 5
	}

	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	return int(math.Round(score))
}

// ── Recommendations ──────────────────────────────────────────

func buildOptimizerRecommendations(sched currentSchedule, ca costAnalysis, healthScore int, sessions []sessionRow) []optimizerRec {
	recs := make([]optimizerRec, 0, 5)

	// Peak charging shift
	if ca.SessionsDuringPeakPct > 20 && ca.PotentialMonthlySavings > 5 {
		prio := "medium"
		if ca.PotentialMonthlySavings > 15 {
			prio = "high"
		}
		recs = append(recs, optimizerRec{
			Type:     "schedule",
			Priority: prio,
			Title:    "Shift home charging to off-peak hours",
			Detail: fmt.Sprintf(
				"%.0f%% of sessions start during peak rates. Scheduling after 11 PM could save ~$%.0f/month.",
				ca.SessionsDuringPeakPct, ca.PotentialMonthlySavings,
			),
			EstimatedSavings: ca.PotentialMonthlySavings,
		})
	}

	// Charge limit
	if sched.AvgChargeToPct > 90 {
		recs = append(recs, optimizerRec{
			Type:     "limit",
			Priority: "medium",
			Title:    "Lower daily charge limit to 80%",
			Detail: fmt.Sprintf(
				"Your average charge target is %.0f%%. Reducing to 80%% for daily driving extends battery life with minimal range impact.",
				sched.AvgChargeToPct,
			),
		})
	}

	// Pre-conditioning
	morningCount := 0
	for _, s := range sessions {
		h := s.startDate.Hour()
		if h >= 6 && h <= 9 {
			morningCount++
		}
	}
	if len(sessions) > 0 && float64(morningCount)/float64(len(sessions))*100 < 20 {
		// User doesn't charge in morning → likely departs morning
		recs = append(recs, optimizerRec{
			Type:     "precondition",
			Priority: "low",
			Title:    "Enable scheduled departure",
			Detail:   "Scheduled departure pre-conditions the battery while plugged in, saving 3-5% range — especially in cold weather.",
		})
	}

	// DC fast charging frequency
	dcCount := 0
	for _, s := range sessions {
		if s.power > 50 {
			dcCount++
		}
	}
	if len(sessions) > 0 {
		dcPct := float64(dcCount) / float64(len(sessions)) * 100
		if dcPct > 40 {
			recs = append(recs, optimizerRec{
				Type:     "battery",
				Priority: "high",
				Title:    "Reduce DC fast charging frequency",
				Detail:   fmt.Sprintf("%.0f%% of sessions use DC fast charging. Frequent fast charging accelerates battery degradation.", dcPct),
			})
		}
	}

	// Home charging encouragement
	if sched.HomeChargingPct < 50 && sched.HomeChargingPct > 0 {
		recs = append(recs, optimizerRec{
			Type:     "cost",
			Priority: "medium",
			Title:    "Increase home charging ratio",
			Detail:   fmt.Sprintf("Only %.0f%% of sessions are at home. Home charging is typically 50-70%% cheaper than public charging.", sched.HomeChargingPct),
		})
	}

	if len(recs) == 0 {
		recs = append(recs, optimizerRec{
			Type:     "general",
			Priority: "low",
			Title:    "Your charging habits are excellent!",
			Detail:   "No optimization recommendations at this time. Keep up the great habits.",
		})
	}

	// Sort by priority: high → medium → low
	prioOrder := map[string]int{"high": 0, "medium": 1, "low": 2}
	sort.Slice(recs, func(i, j int) bool {
		return prioOrder[recs[i].Priority] < prioOrder[recs[j].Priority]
	})

	return recs
}
