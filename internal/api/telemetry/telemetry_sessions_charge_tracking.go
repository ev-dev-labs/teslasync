package telemetry

import (
	"context"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/metrics"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	signalcounter "github.com/ev-dev-labs/teslasync/internal/signal/counter"
)

// chargeStateRegistry holds the per-tracker signal.StateReader injected by
// router.go at startup. The tracker struct itself is
// defined in telemetry_sessions.go, so this side table provides the
// wiring seam without altering the shared struct definition. The setter and
// accessor below live in this file because the snapshot read sites that
// consume the reader are exclusively in this file.
//
// A nil entry (or missing key) means no StateReader has been installed for
// that tracker — completion-time enrichment falls back to the unenriched
// code path (empty snapshot maps), preserving the behavior of the legacy
// fallback when both signalLogReader and signalHistoryWriter were nil.
var (
	chargeStateRegistryMu sync.RWMutex
	chargeStateRegistry   = map[*TelemetrySessionTracker]signal.StateReader{}
)

// SetChargeStateReader injects the cold-path signal.StateReader used to
// reconstruct charging start/end snapshots at session completion. Replaces
// the legacy *signaldb.SignalLogReader.SnapshotAt /
// *signaldb.SignalHistoryWriter.SnapshotAt calls.
// Passing nil clears any previously installed reader.
func (t *TelemetrySessionTracker) SetChargeStateReader(s signal.StateReader) {
	chargeStateRegistryMu.Lock()
	defer chargeStateRegistryMu.Unlock()
	if s == nil {
		delete(chargeStateRegistry, t)
		return
	}
	chargeStateRegistry[t] = s
}

// chargeStateReader returns the StateReader previously installed by
// SetChargeStateReader, or nil if no reader is installed (which makes
// charge-session completion fall back to the unenriched code path).
func (t *TelemetrySessionTracker) chargeStateReader() signal.StateReader {
	chargeStateRegistryMu.RLock()
	defer chargeStateRegistryMu.RUnlock()
	return chargeStateRegistry[t]
}

// stateToLegacyMap copies a signal.State (named map[string]SignalValue) into
// a fresh map[string]interface{} so it can be passed to the existing
// snapFloat / signalStr / units.GetUnitFromSnapshot helpers, which were
// authored before signal.State existed and take the unnamed-map type.
//
// Defined types in Go are not directly assignable / convertible to
// structurally-identical unnamed types when the element type is itself a
// defined alias (signal.SignalValue), so the copy is unavoidable. The
// snapshot maps are small (≤ ~50 entries — a single per-vehicle state) so
// the allocation cost_decimal is negligible compared to the underlying signal_log
// query.
func stateToLegacyMap(s signal.State) map[string]interface{} {
	if s == nil {
		return map[string]interface{}{}
	}
	m := make(map[string]interface{}, len(s))
	for k, v := range s {
		m[k] = v
	}
	return m
}

// streamingCharge tracks comprehensive data during an active charging session.
type streamingCharge struct {
	SessionID            int64
	VehicleID            int64
	StartTime            time.Time
	LastSeen             time.Time
	EnergyAdded          float64
	EnergyCounterField   string
	EnergyCounterStartWh *float64
	EnergyCounterLastWh  *float64
	EnergyCounterReset   bool

	// Signal accumulator (same pattern as streamingDrive)
	accumulatedSignals map[string]interface{}
	lastTelemetryWrite time.Time

	// Location
	Latitude      *float64
	Longitude     *float64
	LocationFresh bool

	// Temperature accumulators
	InsideTempSum, OutsideTempSum float64
	TempCount                     int

	// Charger details (captured during session)
	Phases           *int
	Voltage          *int
	Current          *int
	Power            *float64
	FastChargerType  *string
	FastChargerBrand *string
	ChargeCable      *string

	// Battery at start
	StartBatteryLevel int
	StartRangeKm      *float64
	Completing        bool // prevents double-completion race

	// state is the signal.StateReader captured at session start. Consumed
	// by completeChargeLocked to reconstruct the start/end signal snapshots
	// used for completion-time enrichment (energy delta, range delta,
	// charger spec recovery, geocoding lat/lng). Nil when no StateReader
	// was installed via SetChargeStateReader — the enrichment code path
	// then degrades gracefully to empty snapshot maps.
	state signal.StateReader
}

func chargeEnergyCounterValue(signals map[string]interface{}, preferredField string) (string, float64, bool) {
	if preferredField != "" {
		value, ok := signalFloat(signals, preferredField)
		return preferredField, value, ok
	}
	for _, field := range []string{"DCChargingEnergyIn", "ACChargingEnergyIn"} {
		if value, ok := signalFloat(signals, field); ok {
			return field, value, true
		}
	}
	return "", 0, false
}

func observeChargeEnergyCounter(active *streamingCharge, signals map[string]interface{}) {
	field, value, ok := chargeEnergyCounterValue(signals, active.EnergyCounterField)
	if !ok || !signalcounter.Valid(value) {
		return
	}

	if active.EnergyCounterStartWh == nil {
		active.EnergyCounterField = field
		active.EnergyCounterStartWh = floatPtr(value)
	}
	if active.EnergyCounterLastWh != nil {
		change := signalcounter.Compare(*active.EnergyCounterLastWh, value)
		if change.Kind == signalcounter.ChangeReset {
			active.EnergyCounterReset = true
		}
	}
	active.EnergyCounterLastWh = floatPtr(value)
}

func snapshotChargeEnergyDelta(
	startSnap, endSnap map[string]interface{},
	preferredField string,
) (float64, signalcounter.ChangeKind, bool) {
	fields := []string{"DCChargingEnergyIn", "ACChargingEnergyIn"}
	if preferredField != "" {
		fields = append([]string{preferredField}, fields...)
	}
	seen := make(map[string]struct{}, len(fields))
	for _, field := range fields {
		if _, duplicate := seen[field]; duplicate {
			continue
		}
		seen[field] = struct{}{}

		start, startOK := snapFloat(startSnap, field)
		end, endOK := snapFloat(endSnap, field)
		if !startOK || !endOK {
			continue
		}
		change := signalcounter.Compare(start, end)
		return change.Delta, change.Kind, true
	}
	return 0, signalcounter.ChangeInvalid, false
}

func trackedChargeEnergyDelta(active *streamingCharge) (float64, bool) {
	if active.EnergyCounterReset ||
		active.EnergyCounterStartWh == nil ||
		active.EnergyCounterLastWh == nil {
		return 0, false
	}
	change := signalcounter.Compare(*active.EnergyCounterStartWh, *active.EnergyCounterLastWh)
	switch change.Kind {
	case signalcounter.ChangeAdvanced:
		return change.Delta, true
	case signalcounter.ChangeUnchanged:
		return 0, true
	default:
		return 0, false
	}
}

func freshChargeCoordinateValue(v *signal.Value, at time.Time) bool {
	if at.IsZero() {
		at = time.Now().UTC()
	}
	return v != nil &&
		!v.TimestampSynthetic &&
		signal.IsLiveSignalFresh(v, at) &&
		!v.Timestamp.After(at.Add(signal.LiveSignalFreshnessThreshold))
}

func firstStoredSignal(store *signal.Store, vehicleID int64, keys ...string) *signal.Value {
	if store == nil {
		return nil
	}
	for _, key := range keys {
		if value := store.Get(vehicleID, key); value != nil {
			return value
		}
	}
	return nil
}

// chargeLocationIsFresh confirms that the coordinates resolved for a charge
// came from the current telemetry window. Auto-discovery must never act on a
// forward-folded location from a prior drive.
func (t *TelemetrySessionTracker) chargeLocationIsFresh(
	vehicleID int64,
	signals map[string]interface{},
	fieldTs map[string]time.Time,
	payloadTs, at time.Time,
) bool {
	if _, _, ok := signalLatLon(signals); ok {
		observedAt := time.Time{}
		for _, key := range []string{
			"Location",
			"LocationLatitude",
			"LocationLongitude",
			"Latitude",
			"Longitude",
		} {
			if ts := fieldTs[key]; !ts.IsZero() &&
				(observedAt.IsZero() || ts.Before(observedAt)) {
				observedAt = ts
			}
		}
		if observedAt.IsZero() {
			observedAt = payloadTs
		}
		if observedAt.IsZero() {
			observedAt = at
		}
		return freshChargeCoordinateValue(&signal.Value{Timestamp: observedAt}, at)
	}

	latValue := firstStoredSignal(t.localSignals, vehicleID, "LocationLatitude", "Latitude")
	lonValue := firstStoredSignal(t.localSignals, vehicleID, "LocationLongitude", "Longitude")
	return freshChargeCoordinateValue(latValue, at) &&
		freshChargeCoordinateValue(lonValue, at)
}

func (t *TelemetrySessionTracker) trackCharging(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}, accumulatedSignals map[string]interface{}, payloadTs time.Time, fieldTs map[string]time.Time) {
	chargeState, hasChargeState := signalStr(signals, "DetailedChargeState", "ChargeState")
	if !hasChargeState {
		// Even without charge state, accumulate signals for active charge
		t.mu.Lock()
		if active, ok := t.activeCharges[vehicleID]; ok {
			observeChargeEnergyCounter(active, signals)
			active.accumulatedSignals = accumulateSignals(active.accumulatedSignals, signals)
			active.LastSeen = time.Now().UTC()
			t.maybeFlushChargeTelemetry(ctx, active)
		}
		t.mu.Unlock()
		return
	}

	// Tesla Fleet Telemetry sends enum values with prefixes like
	// "DetailedChargeStateCharging", "DetailedChargeStateStarting", or just "Enable".
	isCharging := enums.IsCharging(chargeState)

	t.mu.Lock()
	defer t.mu.Unlock()

	active, hasCharge := t.activeCharges[vehicleID]

	if isCharging && !hasCharge {
		// === START CHARGE ===
		// Use resolve helpers: batch → accumulated → SignalStore
		batteryLevel, _ := t.resolveInt(vehicleID, signals, accumulatedSignals, "BatteryLevel", "Soc")
		lat, lon, hasLoc := t.resolveLatLon(vehicleID, signals, accumulatedSignals)
		startRange, _ := t.resolveFloat(vehicleID, signals, accumulatedSignals, "RatedRange")

		// prefer the charge-state field's
		// EmittedAt for the start timestamp; fall back to payloadTs
		// (batch high-water) then wall-clock.
		startTs := time.Time{}
		if ts, ok := fieldTs["DetailedChargeState"]; ok && !ts.IsZero() {
			startTs = ts
		} else if ts, ok := fieldTs["ChargeState"]; ok && !ts.IsZero() {
			startTs = ts
		}
		if startTs.IsZero() {
			startTs = payloadTs
		}
		startTs = eventTimeOrNow(startTs)
		locationFresh := hasLoc &&
			t.chargeLocationIsFresh(vehicleID, signals, fieldTs, payloadTs, startTs)

		session := &chargingmodel.ChargingSession{
			VehicleID:   vehicleID,
			StartedAt:   startTs,
			StartSocPct: floatPtr(float64(batteryLevel)),
		}
		if locationFresh {
			session.StartLat = floatPtr(lat)
			session.StartLng = floatPtr(lon)
		}

		if err := t.chargeRepo.Create(ctx, session); err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to create charge session")
			return
		}

		sc := &streamingCharge{
			SessionID:          session.ID,
			VehicleID:          vehicleID,
			StartTime:          startTs,
			LastSeen:           time.Now().UTC(),
			StartBatteryLevel:  batteryLevel,
			accumulatedSignals: make(map[string]interface{}),
			lastTelemetryWrite: time.Now().UTC(),
			state:              t.chargeStateReader(),
		}
		if hasLoc {
			sc.Latitude = floatPtr(lat)
			sc.Longitude = floatPtr(lon)
			sc.LocationFresh = locationFresh
		}
		if startRange > 0 {
			sc.StartRangeKm = floatPtr(startRange)
		}
		observeChargeEnergyCounter(sc, accumulatedSignals)
		observeChargeEnergyCounter(sc, signals)

		t.activeCharges[vehicleID] = sc
		metrics.ChargeSessionsActive.Inc()

		// Surface a newly discovered charging place as soon as a confirmed
		// charge starts. The same idempotent routine runs again at completion
		// once energy is known, when it can also calculate the session cost.
		if sc.LocationFresh && t.geofenceRepo != nil {
			sessionID, startLat, startLon := sc.SessionID, *sc.Latitude, *sc.Longitude
			safeGo("charge_geofence_discovery", func() {
				t.applyGeofencePricingAsync(
					sessionID,
					vehicleID,
					startLat,
					startLon,
					startTs,
					map[string]interface{}{},
				)
			})
		}

		// Accumulate and flush first reading immediately
		sc.accumulatedSignals = accumulateSignals(sc.accumulatedSignals, signals)
		t.flushChargeTelemetry(ctx, sc)

		log.Info().Int64("vehicle_id", vehicleID).Int64("session_id", session.ID).Msg("telemetry: charging started")
		if t.eventBus != nil {
			t.eventBus.Publish(events.Event{Type: events.ChargeStarted, VehicleID: vehicleID, VIN: vin,
				Data: map[string]interface{}{"session_id": session.ID, "battery_level": batteryLevel, "source": "fleet_telemetry"}})
		}

	} else if isCharging && hasCharge {
		// === UPDATE ACTIVE CHARGE ===
		active.LastSeen = time.Now().UTC()
		if lat, lon, ok := t.resolveLatLon(vehicleID, signals, accumulatedSignals); ok &&
			t.chargeLocationIsFresh(
				vehicleID,
				signals,
				fieldTs,
				payloadTs,
				eventTimeOrNow(payloadTs),
			) {
			active.Latitude = floatPtr(lat)
			active.Longitude = floatPtr(lon)
			active.LocationFresh = true
		}

		// Track energy
		observeChargeEnergyCounter(active, signals)

		// Track charger details
		if v, ok := signalInt(signals, "ChargerPhases"); ok {
			active.Phases = intPtr(v)
		}
		if v, ok := signalInt(signals, "ChargerVoltage"); ok {
			active.Voltage = intPtr(v)
		}
		if v, ok := signalInt(signals, "ChargerActualCurrent", "ChargeAmps"); ok {
			active.Current = intPtr(v)
		}
		if v, ok := signalFloat(signals, "DCChargingPower", "ACChargingPower"); ok {
			active.Power = floatPtr(v)
		}
		if v, ok := signalStr(signals, "FastChargerType"); ok {
			active.FastChargerType = strPtr(v)
		}
		if v, ok := signalStr(signals, "FastChargerBrand"); ok {
			active.FastChargerBrand = strPtr(v)
		}
		if v, ok := signalStr(signals, "ChargingCableType", "ConnChargeCable"); ok {
			active.ChargeCable = strPtr(v)
		}

		// Temperature — fall back to SignalStore for sparse batches
		it, hasIT := signalFloat(signals, "InsideTemp")
		if !hasIT && t.localSignals != nil {
			it, hasIT = t.localSignals.GetFloat(vehicleID, "InsideTemp")
		}
		ot, hasOT := signalFloat(signals, "OutsideTemp")
		if !hasOT && t.localSignals != nil {
			ot, hasOT = t.localSignals.GetFloat(vehicleID, "OutsideTemp")
		}
		if hasIT {
			active.InsideTempSum += it
			active.TempCount++
		}
		if hasOT {
			active.OutsideTempSum += ot
		}

		// Accumulate signals and flush periodically
		active.accumulatedSignals = accumulateSignals(active.accumulatedSignals, signals)
		t.maybeFlushChargeTelemetry(ctx, active)

	} else if !isCharging && hasCharge {
		// === CHARGE ENDED ===
		observeChargeEnergyCounter(active, signals)
		if lat, lon, ok := t.resolveLatLon(vehicleID, signals, accumulatedSignals); ok &&
			t.chargeLocationIsFresh(
				vehicleID,
				signals,
				fieldTs,
				payloadTs,
				eventTimeOrNow(payloadTs),
			) {
			active.Latitude = floatPtr(lat)
			active.Longitude = floatPtr(lon)
			active.LocationFresh = true
		}
		t.completeChargeLocked(ctx, vehicleID, active, signals, payloadTs)
	}
}

// maybeFlushChargeTelemetry writes accumulated signals if the write interval has elapsed.
func (t *TelemetrySessionTracker) maybeFlushChargeTelemetry(ctx context.Context, charge *streamingCharge) {
	if time.Since(charge.lastTelemetryWrite) < telemetryWriteInterval {
		return
	}
	t.flushChargeTelemetry(ctx, charge)
}

// flushChargeTelemetry writes a telemetry reading from accumulated signals and resets the accumulator.
func (t *TelemetrySessionTracker) flushChargeTelemetry(ctx context.Context, charge *streamingCharge) {
	if len(charge.accumulatedSignals) == 0 {
		return
	}
	t.recordChargeTelemetry(ctx, charge, charge.accumulatedSignals)
	charge.accumulatedSignals = make(map[string]interface{})
	charge.lastTelemetryWrite = time.Now().UTC()
}

func (t *TelemetrySessionTracker) recordChargeTelemetry(ctx context.Context, charge *streamingCharge, signals map[string]interface{}) {
	reading := &chargingmodel.ChargeTelemetryReading{
		SessionID: telemetryInt64Ptr(charge.SessionID),
		VehicleID: charge.VehicleID,
		Ts:        time.Now().UTC(),
	}

	if v, ok := signalInt(signals, "BatteryLevel"); ok {
		reading.ChargeLimitSocPct = floatPtr(float64(v))
	}
	if v, ok := signalFloat(signals, "Soc"); ok {
		reading.ChargeLimitSocPct = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "DCChargingPower", "ACChargingPower"); ok {
		reading.DCChargingPowerW = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "ChargerVoltage"); ok {
		reading.ChargerVoltageV = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "ChargerActualCurrent", "ChargeAmps"); ok {
		reading.ChargerActualCurrentA = floatPtr(v)
	}
	if v, ok := signalInt(signals, "ChargerPhases"); ok {
		reading.ChargerPhases = intPtr(v)
	}
	if v, ok := signalFloat(signals, "DCChargingEnergyIn", "ACChargingEnergyIn"); ok {
		reading.DCChargingEnergyInWh = floatPtr(v)
	}

	// Charge telemetry data now lands in signal_log; reading built for session stats only.
	_ = reading
}

func (t *TelemetrySessionTracker) completeChargeLocked(ctx context.Context, vehicleID int64, active *streamingCharge, signals map[string]interface{}, payloadTs time.Time) bool {
	// Guard: prevent double-completion race between cleanup and normal end
	if active.Completing {
		return false
	}
	active.Completing = true

	// end timestamp resolved from payloadTs
	// (batch high-water EmittedAt) with wall-clock fallback for legacy
	// callers (recovery / flush paths that pass time.Time{}).
	endTs := eventTimeOrNow(payloadTs)

	// Flush remaining accumulated signals
	if signals != nil {
		active.accumulatedSignals = accumulateSignals(active.accumulatedSignals, signals)
	}
	t.flushChargeTelemetry(ctx, active)

	finalSignals := signals
	if finalSignals == nil {
		finalSignals = map[string]interface{}{}
	}

	endBattery := 0
	if bl, ok := t.resolveInt(vehicleID, finalSignals, active.accumulatedSignals, "BatteryLevel", "Soc"); ok {
		endBattery = bl
	}
	duration := endTs.Sub(active.StartTime).Minutes()
	if duration < 0 {
		duration = 0
	}

	//: the legacy charge-telemetry MAX-rollup
	// backfill block was removed. The StateReader path immediately below is
	// the SI replacement — it reconstructs full signal state at a point in
	// time using last-known values (ADR-002).

	active.EnergyAdded = 0
	if energyDelta, ok := trackedChargeEnergyDelta(active); ok {
		active.EnergyAdded = energyDelta
	}

	// Build enhanced fields (only columns that exist in charging_sessions)
	enhancedFields := map[string]interface{}{}

	// Enrich with signal_log for fields not captured during charge session.
	// signal.StateReader (active.state) reconstructs full signal state at a
	// point in time using last-known values, compensating for Tesla's delta
	// encoding (signals not sent unless changed). Replaces the legacy
	// *signaldb.SignalLogReader.SnapshotAt and
	// *signaldb.SignalHistoryWriter.SnapshotAt code paths.
	//
	// The tracker's signalLogReader *signaldb.SignalLogReader field
	// (declared in telemetry_sessions.go) is INTENTIONALLY retained because
	// this branch still calls signalLogReader.ChargeAggregates for the
	// max/avg power rollup that has no equivalent on the StateReader API
	// surface. Removing the field would silently drop both rollup metrics.
	//
	// Both branches below intentionally read through active.state — the gating
	// signalLogReader / signalHistoryWriter checks remain in place because the
	// first branch still consumes signalLogReader for the ChargeAggregates
	// rollup (max/avg power) which has no StateReader equivalent, and the
	// second branch is preserved as the legacy degradation path when only
	// the writer-side reader is wired. State errors are logged-and-swallowed
	// so a transient signal_log query failure does not abort charge-session
	// completion (the unenriched `charging_sessions` row is still committed).
	if t.signalLogReader != nil {
		// endTs already computed at function entry.
		var startSnap, endSnap map[string]interface{}
		if active.state != nil {
			s, startErr := active.state.State(ctx, vehicleID, active.StartTime)
			if startErr != nil {
				log.Warn().Err(startErr).Int64("vehicle_id", vehicleID).
					Msg("telemetry: state.State charge start snapshot failed")
				startSnap = map[string]interface{}{}
			} else {
				startSnap = stateToLegacyMap(s)
			}
			s2, endErr := active.state.State(ctx, vehicleID, endTs)
			if endErr != nil {
				log.Warn().Err(endErr).Int64("vehicle_id", vehicleID).
					Msg("telemetry: state.State charge end snapshot failed")
				endSnap = map[string]interface{}{}
			} else {
				endSnap = stateToLegacyMap(s2)
			}
		} else {
			startSnap = map[string]interface{}{}
			endSnap = map[string]interface{}{}
		}

		// Battery level from snapshots
		if bl, ok := snapFloat(startSnap, "BatteryLevel"); ok && bl > 0 {
			enhancedFields["start_soc_pct"] = bl
		}
		if bl, ok := snapFloat(endSnap, "BatteryLevel"); ok && bl > 0 {
			endBattery = int(bl)
		}

		// Energy added: difference in one consistent cumulative counter.
		if energyDelta, kind, ok := snapshotChargeEnergyDelta(
			startSnap,
			endSnap,
			active.EnergyCounterField,
		); ok {
			active.EnergyAdded = 0
			if !active.EnergyCounterReset && kind == signalcounter.ChangeAdvanced {
				active.EnergyAdded = energyDelta
				enhancedFields["total_energy_added_wh"] = energyDelta
			}
		}

		// Location from snapshots (for geocoding — not written to DB).
		// Dual-key tolerance — the migration codec emits LocationLatitude.
		if active.Latitude == nil {
			if lat, ok := snapFloat(endSnap, "LocationLatitude", "Latitude"); ok {
				active.Latitude = floatPtr(lat)
			}
		}
		if active.Longitude == nil {
			if lon, ok := snapFloat(endSnap, "LocationLongitude", "Longitude"); ok {
				active.Longitude = floatPtr(lon)
			}
		}

		// Charger type detection from snapshot
		if dcPower, ok := snapFloat(endSnap, "DCChargingPower"); ok && dcPower > 0 {
			enhancedFields["charger_type"] = "DC"
		}

		// Max/avg power from signal_log aggregate during charge window —
		// kept on signalLogReader because StateReader has no aggregation API.
		slMaxPower, slAvgPower := t.signalLogReader.ChargeAggregates(ctx, vehicleID, active.StartTime, endTs)
		if slMaxPower > 0 {
			enhancedFields["peak_power_w"] = slMaxPower
		}
		if slAvgPower > 0 {
			enhancedFields["avg_power_w"] = slAvgPower
		}

		if active.ChargeCable != nil && *active.ChargeCable != "" {
			enhancedFields["cable_type"] = *active.ChargeCable
		} else if v, ok := signalStr(endSnap, "ChargingCableType"); ok {
			enhancedFields["cable_type"] = v
		}
	} else if t.signalHistoryWriter != nil {
		// Legacy fallback path: signalHistoryWriter is wired but signalLogReader
		// is not. Both legs still go through active.state because StateReader
		// is the canonical cold-path read API post-merge; the writer-side
		// gating is preserved purely as a degradation hint that cold reads may
		// not be backed by the primary reader. Only the geocoding lat/lng
		// recovery is performed here — the per-field enrichment above requires
		// the start snapshot which is intentionally read-but-discarded to keep
		// the legacy 4-call shape (start + end on each leg) and warm any
		// caching layers in front of the StateReader.
		if active.state != nil {
			if _, startErr := active.state.State(ctx, vehicleID, active.StartTime); startErr != nil {
				log.Warn().Err(startErr).Int64("vehicle_id", vehicleID).
					Msg("telemetry: state.State (history-writer fallback) charge start snapshot failed")
			}
			endSnap, endErr := active.state.State(ctx, vehicleID, endTs)
			if endErr != nil {
				log.Warn().Err(endErr).Int64("vehicle_id", vehicleID).
					Msg("telemetry: state.State (history-writer fallback) charge end snapshot failed")
			} else {
				endSnapshot := stateToLegacyMap(endSnap)
				// Fill missing location (for geocoding — not written to DB).
				// Dual-key tolerance — the migration codec emits LocationLatitude.
				if active.Latitude == nil {
					for _, k := range []string{"LocationLatitude", "Latitude"} {
						if v, ok := endSnapshot[k]; ok {
							if f, fOk := v.(float64); fOk {
								active.Latitude = &f
								break
							}
						}
					}
				}
				if active.Longitude == nil {
					for _, k := range []string{"LocationLongitude", "Longitude"} {
						if v, ok := endSnapshot[k]; ok {
							if f, fOk := v.(float64); fOk {
								active.Longitude = &f
								break
							}
						}
					}
				}
			}
		}
	}

	// A counter reset, invalid sample, or missing baseline makes direct energy
	// unavailable. Preserve the existing independent SOC-based estimate rather
	// than persisting an absolute counter value as session energy.
	if active.EnergyAdded == 0 && active.StartBatteryLevel > 0 && endBattery > active.StartBatteryLevel {
		active.EnergyAdded = float64(endBattery-active.StartBatteryLevel) * 750
	}

	// cost_currency / cost_decimal / geofence_id / rate_id / cost_source are
	// intentionally NOT defaulted here. Charging-place pricing (see
	// applyGeofencePricingAsync below) resolves/creates the session's
	// geofence and looks up its rate keyed on StartTime — that can only
	// happen after this function knows a location, and per the hot-path
	// rule it must never block synchronous charge completion, so it always
	// runs in the async leg alongside the existing place-name resolution. A
	// session with no location, or a geofence with no rate configured yet,
	// is left with cost_source unset (implicitly "unknown") rather than a
	// fabricated currency — see repriceEligibleCostSources precedence.

	if err := t.withTransaction(ctx, func(tx pgx.Tx) error {
		var endSocPct *float64
		if endBattery > 0 {
			v := float64(endBattery)
			endSocPct = &v
		}
		var energyAdded *float64
		if active.EnergyAdded > 0 {
			energyAdded = &active.EnergyAdded
		}
		// Power aggregation: derive max + avg from signal_log over the
		// session window (W). Using ChargeAggregates here mirrors the
		// recovery path (telemetry_sessions_recovery.go) which has
		// always done this. The previous code passed `active.Power,
		// active.Power` — i.e. the LAST observed sample for both peak
		// AND avg — producing nonsense aggregates (e.g. peak=avg=last
		// trickle value) on every completed session. signalLogReader
		// is the same handle used by the start/end snapshot enrichment
		// above so it's expected to be wired in production; if it
		// isn't, peak/avg fall through as nil and the columns remain
		// NULL rather than being polluted with a stale single sample.
		var maxPowerW, avgPowerW *float64
		if t.signalLogReader != nil {
			slMaxPower, slAvgPower := t.signalLogReader.ChargeAggregates(ctx, vehicleID, active.StartTime, endTs)
			if slMaxPower > 0 {
				maxPowerW = &slMaxPower
			}
			if slAvgPower > 0 {
				avgPowerW = &slAvgPower
			}
		}
		if err := t.chargeRepo.CompleteWithTx(ctx, tx, active.SessionID, endTs,
			energyAdded, endSocPct,
			maxPowerW, avgPowerW,
			nil, nil); err != nil {
			return err
		}

		// Attach unattributed charging_telemetry rows to this session
		// in the same tx as the completion update. Pattern parity with
		// the C4 fix on DriveRepo.BackfillDriveTelemetryDriveIDInTx —
		// without this, the UI session-detail charts (voltage / power
		// curves) read WHERE session_id = $1 and come up empty because
		// the per-tick writer streams readings before the session row
		// exists. Failure here rolls back the completion too — partial
		// state must not exist.
		if affected, err := t.chargeRepo.BackfillChargingTelemetrySessionIDInTx(
			ctx, tx, active.SessionID, vehicleID, active.StartTime, endTs); err != nil {
			log.Error().Err(err).
				Int64("session_id", active.SessionID).
				Int64("vehicle_id", vehicleID).
				Time("start_ts", active.StartTime).
				Time("end_ts", endTs).
				Msg("telemetry: charging_telemetry session_id backfill failed; rolling back completion")
			return err
		} else if affected > 0 {
			log.Info().
				Int64("session_id", active.SessionID).
				Int64("vehicle_id", vehicleID).
				Int64("rows_attributed", affected).
				Time("start_ts", active.StartTime).
				Time("end_ts", endTs).
				Msg("telemetry: backfilled charging_telemetry.session_id for completed session")
		}

		// Synchronous enhanced fields (non-geocoded) in same tx
		if len(enhancedFields) > 0 {
			// Only write fields without geocoding inside the tx when no async geocoding needed
			if active.Latitude == nil || active.Longitude == nil {
				if err := t.chargeRepo.PartialUpdateWithTx(ctx, tx, active.SessionID, enhancedFields); err != nil {
					return err
				}
			}
		}

		// Geofence attribution + rate-based cost calculation happen in the
		// async leg below (applyGeofencePricingAsync) — never inside this
		// transaction: discovery involves an advisory-lock round trip and
		// must not add latency/failure surface to charge completion itself.

		return nil
	}); err != nil {
		active.Completing = false
		log.Error().Err(err).Int64("session_id", active.SessionID).Msg("telemetry: failed to complete charge")
		return false
	}

	// Resolve place name + charging-place geofence/rate attribution async —
	// geocoding, discovery, and pricing all stay outside the completion
	// transaction. Guarded on location alone (NOT len(enhancedFields) > 0 —
	// removing the old blanket cost_currency default made enhancedFields
	// legitimately empty on many sessions, and we must still attempt place
	// resolution + geofence pricing whenever coordinates are available).
	if active.LocationFresh && active.Latitude != nil && active.Longitude != nil {
		fieldsCopy := make(map[string]interface{}, len(enhancedFields)+1)
		for k, v := range enhancedFields {
			fieldsCopy[k] = v
		}
		sessionID, lat, lon, startedAt := active.SessionID, *active.Latitude, *active.Longitude, active.StartTime
		safeGo("charge_geofence_pricing", func() {
			t.applyGeofencePricingAsync(sessionID, vehicleID, lat, lon, startedAt, fieldsCopy)
		})
	}

	log.Info().Int64("vehicle_id", vehicleID).Int64("session_id", active.SessionID).
		Float64("duration_min", duration).Float64("energy_added", active.EnergyAdded).Msg("telemetry: charging ended")

	if t.eventBus != nil {
		t.eventBus.Publish(events.Event{Type: events.ChargeCompleted, VehicleID: vehicleID,
			Data: map[string]interface{}{"session_id": active.SessionID, "battery_level": endBattery,
				"energy_added": active.EnergyAdded, "source": "fleet_telemetry"}})
	}

	delete(t.activeCharges, vehicleID)
	metrics.ChargeSessionsActive.Dec()
	metrics.ChargeSessionsCompleted.Inc()
	metrics.TotalCharges.Inc()
	if active.EnergyAdded > 0 {
		metrics.TotalEnergyKwh.Add(active.EnergyAdded / 1000)
	}

	// Backfill missing start/end values from nearest position data (async)
	go t.backfillChargeValues(active, vehicleID)
	return true
}

// backfillChargeValues fills missing charging session start/end values
// from the nearest position data, similar to backfillDriveValues.
func (t *TelemetrySessionTracker) backfillChargeValues(active *streamingCharge, vehicleID int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	const lookupWindow = 10 * time.Minute
	backfill := map[string]interface{}{}

	// Backfill start battery from nearest position
	if active.StartBatteryLevel == 0 {
		startPos, err := findNearestPositionFallback(ctx, t.posRepo, vehicleID, active.StartTime, lookupWindow)
		if err == nil && startPos != nil && startPos.BatteryLvl > 0 {
			backfill["start_soc_pct"] = float64(startPos.BatteryLvl)
		}
	}

	// Backfill end battery from nearest position to end time
	endTime := time.Now().UTC()
	endPos, err := findNearestPositionFallback(ctx, t.posRepo, vehicleID, endTime, lookupWindow)
	if err == nil && endPos != nil {
		if endPos.BatteryLvl > 0 {
			backfill["end_soc_pct"] = float64(endPos.BatteryLvl)
		}
	}

	if len(backfill) > 0 {
		if err := t.chargeRepo.PartialUpdate(ctx, active.SessionID, backfill); err != nil {
			log.Warn().Err(err).Int64("session_id", active.SessionID).Msg("telemetry: failed to backfill charge values")
		} else {
			log.Info().Int64("session_id", active.SessionID).Int("fields", len(backfill)).Msg("telemetry: backfilled charge values from nearest positions")
		}
	}
}
