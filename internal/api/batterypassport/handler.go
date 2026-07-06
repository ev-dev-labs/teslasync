package batterypassport

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/rs/zerolog/log"
)

// bpDataTimeout bounds each analytics read so a stalled connection cannot pin
// the request goroutine longer than the boundary rule allows. The pool's
// server-side statement_timeout is the backstop; this is the client-side
// deadline. A var (not const) so tests can shorten it.
var bpDataTimeout = 15 * time.Second

// Trend / band tuning. Kept as vars so a test can pin the exact SQL args.
var (
	// trendMinSocSwingPct is the minimum daily SoC swing a day must show to
	// yield a usable capacity estimate — small swings amplify sensor noise
	// in the energy/SoC ratio.
	trendMinSocSwingPct = 20.0
	// trendMaxDays caps the degradation trend so the payload stays bounded
	// even for a pack with years of daily history.
	trendMaxDays = 180
	// recentCapacitySamples is how many of the most recent daily capacity
	// estimates feed the robust (median) headline SoH.
	recentCapacitySamples = 8
)

// errVehicleNotFound is returned by buildPassport when the vehicle row is
// absent, so the handlers can map it to a 404 rather than a 500.
var errVehicleNotFound = errors.New("vehicle not found")

// passportLedgerWriteFailuresTotal counts best-effort ledger snapshot writes
// that failed. A ledger-write failure never fails the read — the passport is
// still served — but it is counted here and logged so operators can alert on
// a persistently broken provenance ledger.
var passportLedgerWriteFailuresTotal = promauto.NewCounter(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "battery_passport_ledger_write_failures_total",
	Help:      "Battery-passport ledger snapshot writes that failed (the passport read still succeeded).",
})

// passportQuerier is the minimal pgx surface the handler needs. Declared
// locally so tests can drive every branch with scripted row/rows sources and
// an Exec seam without a live database or a vendored pgxmock (mirrors
// timemachine.tmQuerier / routeeff.routeQuerier). *pgxpool.Pool satisfies it.
type passportQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Handler serves the Battery Passport certificate and its verify endpoint.
type Handler struct {
	db  passportQuerier
	now func() time.Time
}

// NewBatteryPassportHandler wires the handler to the pgx pool. Panics on a nil
// pool — a nil pool is a wiring bug, not a runtime condition, so it surfaces
// at construction rather than as a nil-deref on the first request (mirrors
// routeeff.NewRouteEfficiencyHandler / timemachine.NewTimeMachineHandler).
func NewBatteryPassportHandler(db *database.DB) *Handler {
	if db == nil || db.Pool == nil {
		panic("batterypassport.NewBatteryPassportHandler: db pool must not be nil")
	}
	return &Handler{db: db.Pool, now: time.Now}
}

// --- SQL. Package-level constants so tests can pin the critical clauses
// without a live database. ---

// vehicleQuery fetches the identity + capacity inputs. ErrNoRows ⇒ 404.
const vehicleQuery = `SELECT vin, model FROM vehicles WHERE id = $1`

// trendQuery estimates usable pack capacity per day from cagg_battery_daily:
// the day's charged energy (AC + DC cumulative-counter deltas) divided by the
// day's SoC swing. Only days with a meaningful swing and positive charged
// energy qualify. Newest-first with a cap, re-sorted ascending by the caller.
const trendQuery = `
SELECT day, cap_est_wh FROM (
  SELECT
    bucket::date AS day,
    (COALESCE(ac_energy_added_wh, 0) + COALESCE(dc_energy_added_wh, 0))
      / NULLIF((max_soc - min_soc) / 100.0, 0) AS cap_est_wh
  FROM cagg_battery_daily
  WHERE vehicle_id = $1
    AND max_soc IS NOT NULL
    AND min_soc IS NOT NULL
    AND (max_soc - min_soc) >= $2
    AND (COALESCE(ac_energy_added_wh, 0) + COALESCE(dc_energy_added_wh, 0)) > 0
  ORDER BY bucket DESC
  LIMIT $3
) t
ORDER BY day ASC`

// chargingQuery rolls up fast-charge share, total charged energy (for
// equivalent full cycles), the average charge ceiling, and the first charge.
const chargingQuery = `
SELECT
  COUNT(*) FILTER (WHERE peak_power_w > $2)            AS fast_count,
  COUNT(*)                                             AS total_count,
  COALESCE(SUM(total_energy_added_wh), 0)              AS total_energy_wh,
  AVG(end_soc_pct) FILTER (WHERE end_soc_pct IS NOT NULL) AS avg_end_soc,
  MIN(started_at)                                      AS first_charge_at
FROM charging_sessions
WHERE vehicle_id = $1`

// drivesQuery buckets drives by average ambient temperature into thermal
// bands and reports the first observed drive.
const drivesQuery = `
SELECT
  COUNT(*) FILTER (WHERE ambient_temp_c_avg < $2)                                  AS cold_count,
  COUNT(*) FILTER (WHERE ambient_temp_c_avg >= $2 AND ambient_temp_c_avg <= $3)    AS nominal_count,
  COUNT(*) FILTER (WHERE ambient_temp_c_avg > $3)                                  AS hot_count,
  MIN(started_at)                                                                  AS first_drive_at
FROM drives
WHERE vehicle_id = $1`

// ledgerInsert appends an issued-snapshot row. Best-effort: a failure here is
// logged + counted, never surfaced to the caller.
const ledgerInsert = `
INSERT INTO tesla_battery_passport_ledger
  (vehicle_id, issued_at, soh_pct, equivalent_full_cycles, provenance_hash, payload)
VALUES ($1, $2, $3, $4, $5, $6)`

// Get serves GET /api/v1/vehicles/{vehicleID}/battery-passport. It builds the
// passport, best-effort appends a provenance-ledger snapshot, and returns the
// certificate JSON. A ledger-write failure never fails the read.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), bpDataTimeout)
	defer cancel()

	passport, err := h.buildPassport(ctx, vehicleID)
	if err != nil {
		if errors.Is(err, errVehicleNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
			return
		}
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("battery passport: failed to build passport")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to build battery passport")
		return
	}

	h.recordLedgerSnapshot(ctx, passport)

	httpx.WriteJSON(w, http.StatusOK, passport)
}

// Verify serves GET /api/v1/vehicles/{vehicleID}/battery-passport/verify. It
// recomputes the current passport hash and reports whether the caller-supplied
// hash still matches (tamper / staleness evidence). Read-only — it never
// writes a ledger snapshot.
func (h *Handler) Verify(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	provided := r.URL.Query().Get("hash")
	if provided == "" {
		httpx.WriteError(w, http.StatusBadRequest, "hash query parameter required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), bpDataTimeout)
	defer cancel()

	passport, err := h.buildPassport(ctx, vehicleID)
	if err != nil {
		if errors.Is(err, errVehicleNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
			return
		}
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("battery passport: failed to verify passport")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to verify battery passport")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, VerifyResponse{
		Valid:        passport.ProvenanceHash == provided,
		ExpectedHash: passport.ProvenanceHash,
		ProvidedHash: provided,
	})
}

// buildPassport runs the four reads, folds them through the pure scoring +
// hashing core, and returns the certificate. It never writes. A missing
// vehicle is reported via errVehicleNotFound; any other read failure is
// wrapped for the caller to log + 500.
func (h *Handler) buildPassport(ctx context.Context, vehicleID int64) (*Passport, error) {
	// 1. Identity + nameplate capacity.
	var vin string
	var model *string
	if err := h.db.QueryRow(ctx, vehicleQuery, vehicleID).Scan(&vin, &model); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errVehicleNotFound
		}
		return nil, err
	}
	modelStr := ""
	if model != nil {
		modelStr = *model
	}
	originalWh := EstimateOriginalCapacityWh(vin, modelStr)

	// 2. Degradation trend + robust current capacity/SoH from cagg_battery_daily.
	trend, currentCapacityWh, err := h.readTrend(ctx, vehicleID, originalWh)
	if err != nil {
		return nil, err
	}
	sohPct := 0.0
	if originalWh > 0 && currentCapacityWh > 0 {
		sohPct = clamp(currentCapacityWh/originalWh*100, 0, 100)
	}

	// 3. Charging roll-up: fast-charge share, cycles, avg charge ceiling.
	var fastCount, totalCount int64
	var totalEnergyWh float64
	var avgEndSoc *float64
	var firstChargeAt *time.Time
	if err := h.db.QueryRow(ctx, chargingQuery, vehicleID, dcFastChargeThresholdW).
		Scan(&fastCount, &totalCount, &totalEnergyWh, &avgEndSoc, &firstChargeAt); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	fastChargeRatio := 0.0
	if totalCount > 0 {
		fastChargeRatio = clamp(float64(fastCount)/float64(totalCount), 0, 1)
	}
	avgChargeLimit := 0.0
	if avgEndSoc != nil {
		avgChargeLimit = clamp(*avgEndSoc, 0, 100)
	}
	equivalentFullCycles := 0.0
	if originalWh > 0 {
		equivalentFullCycles = totalEnergyWh / originalWh
	}

	// 4. Drives roll-up: thermal exposure bands + first observed drive.
	var coldCount, nominalCount, hotCount int64
	var firstDriveAt *time.Time
	if err := h.db.QueryRow(ctx, drivesQuery, vehicleID, thermalColdMaxC, thermalHotMinC).
		Scan(&coldCount, &nominalCount, &hotCount, &firstDriveAt); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	thermal := ThermalExposureFrom(coldCount, nominalCount, hotCount)

	// Fold + round to the canonical numeric form used by BOTH the JSON body
	// and the hashed facts.
	firstObserved := earliest(firstChargeAt, firstDriveAt)
	sohR := round1(sohPct)
	capacityKwhR := round2(currentCapacityWh / 1000.0)
	originalKwhR := round1(originalWh / 1000.0)
	cyclesR := round1(equivalentFullCycles)
	fastRatioR := round4(fastChargeRatio)
	avgLimitR := round1(avgChargeLimit)

	issuedAt := h.now().UTC()
	facts := PassportCoreFacts{
		VehicleID:            vehicleID,
		FirstObservedAt:      firstObserved,
		SohPct:               sohR,
		CapacityKwh:          capacityKwhR,
		EquivalentFullCycles: cyclesR,
		FastChargeRatio:      fastRatioR,
		IssuedAt:             issuedAt,
	}

	grade := gradeUnknown
	if sohR > 0 {
		grade = Grade(sohR, fastRatioR, cyclesR)
	}

	return &Passport{
		VehicleID:            vehicleID,
		VinMasked:            MaskVIN(vin),
		IssuedAt:             issuedAt.Format(time.RFC3339),
		FirstObservedAt:      formatTimePtr(firstObserved),
		SohPct:               sohR,
		CapacityKwh:          capacityKwhR,
		OriginalCapacityKwh:  originalKwhR,
		EquivalentFullCycles: cyclesR,
		FastChargeRatio:      fastRatioR,
		AvgChargeLimitPct:    avgLimitR,
		ThermalExposure:      thermal,
		HealthGrade:          grade,
		DegradationTrend:     trend,
		Recommendations:      Recommendations(sohR, fastRatioR, avgLimitR, thermal.HotPct, cyclesR),
		ProvenanceHash:       ProvenanceHash(facts),
	}, nil
}

// readTrend reads the daily capacity estimates, returns the ascending
// SoH-per-day trend plus the robust (median-of-recent) current capacity in Wh.
func (h *Handler) readTrend(ctx context.Context, vehicleID int64, originalWh float64) ([]TrendPoint, float64, error) {
	rows, err := h.db.Query(ctx, trendQuery, vehicleID, trendMinSocSwingPct, trendMaxDays)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	trend := make([]TrendPoint, 0, 32)
	caps := make([]float64, 0, 32)
	for rows.Next() {
		var day time.Time
		var capWh *float64
		if err := rows.Scan(&day, &capWh); err != nil {
			return nil, 0, err
		}
		if capWh == nil || *capWh <= 0 {
			continue
		}
		caps = append(caps, *capWh)
		soh := 0.0
		if originalWh > 0 {
			soh = clamp(*capWh/originalWh*100, 0, 100)
		}
		trend = append(trend, TrendPoint{
			Date:   day.UTC().Format("2006-01-02"),
			SohPct: round1(soh),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	// Robust current capacity: median of the most recent samples so a single
	// noisy day cannot move the headline number.
	recent := caps
	if len(recent) > recentCapacitySamples {
		recent = recent[len(recent)-recentCapacitySamples:]
	}
	return trend, medianWh(recent), nil
}

// recordLedgerSnapshot best-effort appends the issued passport to the
// provenance ledger. Any failure — marshal error or DB error — is logged and
// counted but never propagated: the read has already succeeded.
func (h *Handler) recordLedgerSnapshot(ctx context.Context, p *Passport) {
	payload, err := json.Marshal(p)
	if err != nil {
		passportLedgerWriteFailuresTotal.Inc()
		log.Error().Err(err).Int64("vehicleID", p.VehicleID).Msg("battery passport: failed to marshal ledger payload")
		return
	}
	if _, err := h.db.Exec(ctx, ledgerInsert,
		p.VehicleID, h.now().UTC(), p.SohPct, p.EquivalentFullCycles, p.ProvenanceHash, payload); err != nil {
		passportLedgerWriteFailuresTotal.Inc()
		log.Warn().Err(err).Int64("vehicleID", p.VehicleID).Msg("battery passport: failed to write ledger snapshot (passport still served)")
	}
}

// earliest returns the earlier of two nullable timestamps, or the zero time
// when both are nil.
func earliest(a, b *time.Time) time.Time {
	switch {
	case a == nil && b == nil:
		return time.Time{}
	case a == nil:
		return *b
	case b == nil:
		return *a
	case a.Before(*b):
		return *a
	default:
		return *b
	}
}

// formatTimePtr renders a nullable/zero instant as a nullable RFC 3339 UTC
// string so the JSON carries null (not a zero-time string) when the vehicle
// has no observed history yet.
func formatTimePtr(t time.Time) *string {
	if t.IsZero() {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}
