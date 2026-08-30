package battery

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"go.opentelemetry.io/otel"
)

const maxBatteryTrendDays = 366

// BatteryHandler handles battery health HTTP requests.
//
// The legacy signaldb.SignalLogReader's per-signal
// helper has been replaced with the canonical signal.StateReader
// (ADR-002). The four per-signal lookups (EnergyRemaining,
// EstBatteryRange, ModuleTempMax, ModuleTempMin) all resolve "value as
// of now" — a forward-folded read at time.Now() — so they map 1:1 onto
// StateReader.SignalAt with identical semantics. We intentionally
// retain the per-signal pattern (rather than a single
// StateReader.State call) to preserve the existing behavior where each
// individual signal's absence falls through independently to its zero
// fallback in the response, without coupling that fallback to a single
// snapshot read failure.
type BatteryHandler struct {
	db    *database.DB
	state signal.StateReader
}

func NewBatteryHandler(db *database.DB, state signal.StateReader) *BatteryHandler {
	return &BatteryHandler{db: db, state: state}
}

func (h *BatteryHandler) Report(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.battery.report")
	defer span.End()
	now := time.Now().UTC()
	traceID := span.SpanContext().TraceID().String()

	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil || vehicleID <= 0 {
		if err != nil {
			span.RecordError(err)
		} else {
			span.RecordError(fmt.Errorf("vehicle ID must be positive"))
		}
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	// Point-in-time time-machine view.
	// `?as_of=` reroutes the per-signal lookups to a historical anchor
	// instead of time.Now(). Validation, lookback bounds, and RFC 3339
	// parsing live in signal.ParseAsOf so every handler that gains the
	// parameter shares one policy. Absence of the parameter preserves
	// the legacy live-state behavior exactly.
	queryTime, hasAsOf, asOfErr := signal.ParseAsOf(r.URL.Query(), now)
	if asOfErr != nil {
		span.RecordError(asOfErr)
		httpx.WriteError(w, http.StatusBadRequest, asOfErr.Error())
		return
	}
	if !hasAsOf {
		queryTime = now
	}

	var healthScore, capacityWh, degradation, estRange float64
	var avgTemp *float64
	var cycleCount int
	partialReasons := make(map[string]struct{})
	markPartial := func(reason string) {
		partialReasons[reason] = struct{}{}
	}

	{
		const nominalCapacity = 75000.0

		if h.state != nil {
			val, err := h.state.SignalAt(ctx, vehicleID, "EnergyRemaining", queryTime)
			if err != nil {
				span.RecordError(err)
				log.Error().Err(err).Int64("vehicle_id", vehicleID).Str("signal", "EnergyRemaining").
					Str("trace_id", traceID).Msg("battery: failed to read signal state")
				httpx.WriteError(w, http.StatusInternalServerError, "failed to read battery state")
				return
			}
			if val != nil {
				if v, ok := signal.Float64(val); ok && v > 0 {
					capacityWh = v
					healthScore = (capacityWh / nominalCapacity) * 100
					if healthScore > 100 {
						healthScore = 100
					}
					degradation = 100 - healthScore
				}
			}
			val, err = h.state.SignalAt(ctx, vehicleID, "EstBatteryRange", queryTime)
			if err != nil {
				span.RecordError(err)
				log.Error().Err(err).Int64("vehicle_id", vehicleID).Str("signal", "EstBatteryRange").
					Str("trace_id", traceID).Msg("battery: failed to read signal state")
				httpx.WriteError(w, http.StatusInternalServerError, "failed to read battery state")
				return
			}
			if val != nil {
				if v, ok := signal.Float64(val); ok && v > 0 {
					estRange = v
				}
			}
			// nil means "no data" when either module temperature is absent.
			valMax, err := h.state.SignalAt(ctx, vehicleID, "ModuleTempMax", queryTime)
			if err != nil {
				span.RecordError(err)
				log.Error().Err(err).Int64("vehicle_id", vehicleID).Str("signal", "ModuleTempMax").
					Str("trace_id", traceID).Msg("battery: failed to read signal state")
				httpx.WriteError(w, http.StatusInternalServerError, "failed to read battery state")
				return
			}
			if valMax != nil {
				if tempMax, ok := signal.Float64(valMax); ok {
					valMin, err := h.state.SignalAt(ctx, vehicleID, "ModuleTempMin", queryTime)
					if err != nil {
						span.RecordError(err)
						log.Error().Err(err).Int64("vehicle_id", vehicleID).Str("signal", "ModuleTempMin").
							Str("trace_id", traceID).Msg("battery: failed to read signal state")
						httpx.WriteError(w, http.StatusInternalServerError, "failed to read battery state")
						return
					}
					if valMin != nil {
						if tempMin, okMin := signal.Float64(valMin); okMin {
							avg := (tempMax + tempMin) / 2
							avgTemp = &avg
						}
					}
				}
			}
		} else {
			markPartial("state_reader_unavailable")
		}

		// Count charge cycles from charging sessions (sum of SOC deltas / 100).
		// Use SI columns start_soc_pct/end_soc_pct
		// (DOUBLE PRECISION) instead of legacy smallint battery percent columns.
		// The new schema also stores the server-computed delta_soc_pct directly,
		// but we sum GREATEST(end-start, 0) inline to keep the same semantics
		// as the legacy query (filter to rows where the SoC actually rose).
		if h.db != nil {
			var totalSOCDelta *float64
			if err := h.db.Pool.QueryRow(ctx,
				`SELECT SUM(GREATEST(end_soc_pct - start_soc_pct, 0))
				 FROM charging_sessions WHERE vehicle_id = $1 AND end_soc_pct > start_soc_pct`,
				vehicleID).Scan(&totalSOCDelta); err != nil && err != pgx.ErrNoRows {
				span.RecordError(err)
				log.Warn().Err(err).Int64("vehicle_id", vehicleID).Str("trace_id", traceID).
					Msg("battery: charge cycle SOC delta query failed")
				markPartial("charge_cycle_query_failed")
			}
			if totalSOCDelta != nil {
				cycleCount = int(*totalSOCDelta / 100)
			}
		} else {
			markPartial("database_unavailable")
		}
	}

	type trendPoint struct {
		Month       string  `json:"month"`
		CapacityPct float64 `json:"capacity_pct"`
		RangeKm     float64 `json:"range_km"`
		HealthScore float64 `json:"health_score"`
		CapacityWh  float64 `json:"capacity_wh"`
		EstRangeKm  float64 `json:"est_range_km"`
	}
	trend := make([]trendPoint, 0)

	trendDays := 90
	if rawDays := r.URL.Query().Get("days"); rawDays != "" {
		parsed, parseErr := strconv.Atoi(rawDays)
		if parseErr != nil || parsed <= 0 || parsed > maxBatteryTrendDays {
			validationErr := fmt.Errorf("days must be an integer between 1 and %d", maxBatteryTrendDays)
			span.RecordError(validationErr)
			httpx.WriteError(w, http.StatusBadRequest, validationErr.Error())
			return
		}
		trendDays = parsed
	}
	trendCutoff := now.AddDate(0, 0, -trendDays)
	const trendNominalCap = 75000.0
	const trendNominalRange = 531.0

	if h.db != nil {
		trendRows, trendErr := h.db.Pool.Query(ctx,
			`SELECT bucket, end_soc, min_soc, max_soc
			 FROM cagg_battery_daily
			 WHERE vehicle_id = $1 AND bucket >= $2
			 ORDER BY bucket ASC`,
			vehicleID, trendCutoff)
		if trendErr == nil {
			defer trendRows.Close()
			for trendRows.Next() {
				var bucket time.Time
				var endSOC, minSOC, maxSOC *float64
				if scanErr := trendRows.Scan(&bucket, &endSOC, &minSOC, &maxSOC); scanErr != nil {
					log.Warn().Err(scanErr).Int64("vehicle_id", vehicleID).Str("trace_id", traceID).
						Msg("battery: trend row scan failed")
					markPartial("trend_row_scan_failed")
					continue
				}
				soc := 0.0
				if endSOC != nil {
					soc = *endSOC
				}
				trend = append(trend, trendPoint{
					Month:       bucket.Format("2006-01-02"),
					CapacityPct: soc,
					HealthScore: soc,
					CapacityWh:  soc * trendNominalCap / 100,
					RangeKm:     soc * trendNominalRange / 100,
					EstRangeKm:  soc * trendNominalRange / 100,
				})
			}
			if rowsErr := trendRows.Err(); rowsErr != nil {
				span.RecordError(rowsErr)
				log.Warn().Err(rowsErr).Int64("vehicle_id", vehicleID).Str("trace_id", traceID).
					Msg("battery: failed to iterate trend rows")
				markPartial("trend_query_failed")
			}
		} else {
			span.RecordError(trendErr)
			log.Warn().Err(trendErr).Int64("vehicle_id", vehicleID).Str("trace_id", traceID).
				Msg("battery: failed to query trend")
			markPartial("trend_query_failed")
		}
	} else {
		markPartial("database_unavailable")
	}

	const nominalRangeKm = 531.0 // Model Y Long Range nominal range.
	partialReasonList := make([]string, 0, len(partialReasons))
	for reason := range partialReasons {
		partialReasonList = append(partialReasonList, reason)
	}
	sort.Strings(partialReasonList)

	resp := map[string]interface{}{
		"generated_at":               now,
		"source":                     "signal_log_and_cagg_battery_daily",
		"partial_result":             map[string]interface{}{"is_partial": len(partialReasonList) > 0, "reasons": partialReasonList},
		"vehicle_id":                 vehicleID,
		"health_score":               healthScore,
		"capacity_wh":                capacityWh,
		"current_capacity_pct":       healthScore,
		"degradation_pct":            degradation,
		"est_range_km":               estRange,
		"estimated_range_current_km": estRange,
		"estimated_range_new_km":     nominalRangeKm,
		"total_cycles":               cycleCount,
		"cycle_count":                cycleCount,
		"avg_cell_temp_c":            avgTemp,
		"monthly_trend":              trend,
	}
	if hasAsOf {
		// Echo the parsed timestamp back so the SPA can confirm the
		// server honored the requested point-in-time anchor and can
		// surface the same value to the user via the time-machine
		// banner.
		resp["as_of"] = queryTime.Format(time.RFC3339)
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}
