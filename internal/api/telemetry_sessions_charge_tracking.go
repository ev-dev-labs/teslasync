package api

import (
	"context"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/units"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// streamingCharge tracks comprehensive data during an active charging session.
type streamingCharge struct {
	SessionID   int64
	VehicleID   int64
	StartTime   time.Time
	LastSeen    time.Time
	EnergyAdded float64

	// Signal accumulator (same pattern as streamingDrive)
	accumulatedSignals map[string]interface{}
	lastTelemetryWrite time.Time

	// Location
	Latitude  *float64
	Longitude *float64

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
}

func (t *TelemetrySessionTracker) trackCharging(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}, accumulatedSignals map[string]interface{}) {
	chargeState, hasChargeState := signalStr(signals, "DetailedChargeState", "ChargeState")
	if !hasChargeState {
		// Even without charge state, accumulate signals for active charge
		t.mu.Lock()
		if active, ok := t.activeCharges[vehicleID]; ok {
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

		session := &models.ChargingSession{
			VehicleID:       vehicleID,
			StartTs:         time.Now().UTC(),
			StartBatteryPct: int16Ptr(batteryLevel),
		}

		if err := t.chargeRepo.Create(ctx, session); err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to create charge session")
			return
		}

		sc := &streamingCharge{
			SessionID:          session.ID,
			VehicleID:          vehicleID,
			StartTime:          time.Now().UTC(),
			LastSeen:           time.Now().UTC(),
			StartBatteryLevel:  batteryLevel,
			accumulatedSignals: make(map[string]interface{}),
			lastTelemetryWrite: time.Now().UTC(),
		}
		if hasLoc {
			sc.Latitude = floatPtr(lat)
			sc.Longitude = floatPtr(lon)
		}
		if startRange > 0 {
			sc.StartRangeKm = floatPtr(startRange)
		}

		t.activeCharges[vehicleID] = sc
		ChargeSessionsActive.Inc()

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

		// Track energy
		if ea, ok := signalFloat(signals, "DCChargingEnergyIn"); ok {
			active.EnergyAdded = ea
		} else if ea, ok := signalFloat(signals, "ACChargingEnergyIn"); ok {
			active.EnergyAdded = ea
		}

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
		t.completeChargeLocked(ctx, vehicleID, active, signals)
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
	reading := &models.ChargeTelemetryReading{
		SessionID: charge.SessionID,
		VehicleID: charge.VehicleID,
	}

	if v, ok := signalInt(signals, "BatteryLevel"); ok {
		reading.BatteryLevel = intPtr(v)
	}
	if v, ok := signalFloat(signals, "Soc"); ok {
		reading.Soc = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "DCChargingPower", "ACChargingPower"); ok {
		reading.PowerKW = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "ChargerVoltage"); ok {
		reading.Voltage = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "ChargerActualCurrent", "ChargeAmps"); ok {
		reading.CurrentAmps = floatPtr(v)
	}
	if v, ok := signalInt(signals, "ChargerPhases"); ok {
		reading.Phases = intPtr(v)
	}
	if v, ok := signalFloat(signals, "DCChargingEnergyIn", "ACChargingEnergyIn"); ok {
		reading.EnergyAdded = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "RatedRange"); ok {
		reading.RatedRange = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "IdealBatteryRange"); ok {
		reading.IdealRange = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "EstBatteryRange"); ok {
		reading.EstRange = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "InsideTemp"); ok {
		reading.InsideTemp = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "OutsideTemp"); ok {
		reading.OutsideTemp = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "ModuleTempMax"); ok {
		reading.BatteryTemp = floatPtr(v)
	}
	if la, lo, ok := signalLatLon(signals); ok {
		reading.Latitude = floatPtr(la)
		reading.Longitude = floatPtr(lo)
	}
	if v, ok := signalFloat(signals, "ChargeRateMilePerHour", "ChargeRateMph"); ok {
		reading.ChargeRate = floatPtr(v)
	}

	// Charge telemetry data now lands in signal_log; reading built for session stats only.
	_ = reading
}

func (t *TelemetrySessionTracker) completeChargeLocked(ctx context.Context, vehicleID int64, active *streamingCharge, signals map[string]interface{}) {
	// Guard: prevent double-completion race between cleanup and normal end
	if active.Completing {
		return
	}
	active.Completing = true

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
	duration := time.Since(active.StartTime).Minutes()

	// Backfill from telemetry readings if in-memory values are empty
	if endBattery == 0 || active.EnergyAdded == 0 || active.Power == nil || active.Voltage == nil {
		var maxBatt, maxPower, maxEnergy, maxVoltage, maxCurrent *float64
		var maxPhases *int
		_ = t.db.Pool.QueryRow(ctx, `SELECT 
			MAX(battery_level)::float, MAX(power_kw), MAX(energy_added),
			MAX(voltage), MAX(current_amps), MAX(phases)
			FROM charge_telemetry_readings WHERE session_id = $1`,
			active.SessionID).Scan(&maxBatt, &maxPower, &maxEnergy, &maxVoltage, &maxCurrent, &maxPhases)
		if endBattery == 0 && maxBatt != nil {
			endBattery = int(*maxBatt)
		}
		if active.EnergyAdded == 0 && maxEnergy != nil && *maxEnergy > 0 {
			active.EnergyAdded = *maxEnergy
		}
		if active.Power == nil && maxPower != nil {
			active.Power = maxPower
		}
		if active.Voltage == nil && maxVoltage != nil {
			v := int(*maxVoltage)
			active.Voltage = &v
		}
		if active.Current == nil && maxCurrent != nil {
			v := int(*maxCurrent)
			active.Current = &v
		}
		if active.Phases == nil && maxPhases != nil {
			active.Phases = maxPhases
		}
	}

	// Estimate energy from battery% diff if direct energy signal unavailable
	if active.EnergyAdded == 0 && active.StartBatteryLevel > 0 && endBattery > active.StartBatteryLevel {
		estimatedKWh := float64(endBattery-active.StartBatteryLevel) * 0.75
		active.EnergyAdded = estimatedKWh
	}

	// Get end range — fall back to accumulated signals → SignalStore
	var endRange *float64
	if v, ok := t.resolveFloat(vehicleID, finalSignals, active.accumulatedSignals, "RatedRange"); ok {
		endRange = floatPtr(v)
	}

	// Build enhanced fields (only columns that exist in charging_sessions)
	enhancedFields := map[string]interface{}{}

	// Enrich with signal_log for fields not captured during charge session.
	// SignalLogReader reconstructs full signal state using last-known values,
	// compensating for Tesla's delta encoding (signals not sent unless changed).
	// Falls back to signalHistoryWriter if signalLogReader is unavailable.
	if t.signalLogReader != nil {
		endTs := time.Now().UTC()
		startSnap, startErr := t.signalLogReader.SnapshotAt(ctx, vehicleID, active.StartTime)
		if startErr != nil {
			log.Warn().Err(startErr).Int64("vehicle_id", vehicleID).
				Msg("telemetry: signal_log charge start snapshot failed")
			startSnap = map[string]interface{}{}
		}
		endSnap, endErr := t.signalLogReader.SnapshotAt(ctx, vehicleID, endTs)
		if endErr != nil {
			log.Warn().Err(endErr).Int64("vehicle_id", vehicleID).
				Msg("telemetry: signal_log charge end snapshot failed")
			endSnap = map[string]interface{}{}
		}

		// Unit preferences at start and end (may differ if user changed mid-charge)
		startDistUnit := units.GetUnitFromSnapshot(startSnap, "SettingDistanceUnit")
		endDistUnit := units.GetUnitFromSnapshot(endSnap, "SettingDistanceUnit")

		// Battery level from snapshots
		if bl, ok := snapFloat(startSnap, "BatteryLevel"); ok && bl > 0 {
			enhancedFields["start_battery_pct"] = int16(bl)
		}
		if bl, ok := snapFloat(endSnap, "BatteryLevel"); ok && bl > 0 {
			endBattery = int(bl)
		}

		// Energy added: difference in cumulative energy counter
		if startEnergy, ok := snapFloat(startSnap, "ACChargingEnergyIn"); ok {
			if endEnergy, ok := snapFloat(endSnap, "ACChargingEnergyIn"); ok {
				energyDelta := endEnergy - startEnergy
				if energyDelta > 0 {
					active.EnergyAdded = energyDelta
					enhancedFields["energy_added_kwh"] = energyDelta
				}
			}
		}

		// Range added (normalized to miles)
		if startRangeRaw, ok := snapFloat(startSnap, "BatteryRange"); ok {
			if endRangeRaw, ok := snapFloat(endSnap, "BatteryRange"); ok {
				startRangeMi := units.NormalizeDistance(startRangeRaw, startDistUnit)
				endRangeMi := units.NormalizeDistance(endRangeRaw, endDistUnit)
				milesAdded := endRangeMi - startRangeMi
				if milesAdded > 0 {
					endRange = floatPtr(milesAdded)
					enhancedFields["miles_added"] = milesAdded
				}
			}
		}

		// Location from snapshots (for geocoding — not written to DB)
		if active.Latitude == nil {
			if lat, ok := snapFloat(endSnap, "Latitude"); ok {
				active.Latitude = floatPtr(lat)
			}
		}
		if active.Longitude == nil {
			if lon, ok := snapFloat(endSnap, "Longitude"); ok {
				active.Longitude = floatPtr(lon)
			}
		}

		// Charger type detection from snapshot
		if dcPower, ok := snapFloat(endSnap, "DCChargingPower"); ok && dcPower > 0 {
			enhancedFields["charger_type"] = "DC"
		}

		// Max/avg power from signal_log aggregate during charge window
		slMaxPower, slAvgPower := t.signalLogReader.ChargeAggregates(ctx, vehicleID, active.StartTime, endTs)
		if slMaxPower > 0 {
			enhancedFields["charger_power_kw_max"] = slMaxPower
		}
		if slAvgPower > 0 {
			enhancedFields["charger_power_kw_avg"] = slAvgPower
		}

		// Charger spec fields from in-memory session data or signal_log snapshots
		if active.Voltage != nil && *active.Voltage > 0 {
			enhancedFields["max_charger_voltage"] = int16(*active.Voltage)
		} else if v, ok := snapFloat(endSnap, "ChargerVoltage"); ok && v > 0 {
			enhancedFields["max_charger_voltage"] = int16(v)
		}
		if active.Phases != nil && *active.Phases > 0 {
			enhancedFields["charger_phases"] = int16(*active.Phases)
		} else if v, ok := snapFloat(endSnap, "ChargerPhases"); ok && v > 0 {
			enhancedFields["charger_phases"] = int16(v)
		}
		if active.ChargeCable != nil && *active.ChargeCable != "" {
			enhancedFields["cable_type"] = *active.ChargeCable
		} else if v, ok := signalStr(endSnap, "ChargingCableType"); ok {
			enhancedFields["cable_type"] = v
		}
	} else if t.signalHistoryWriter != nil {
		// Legacy fallback: use signalHistoryWriter for enrichment
		_, startErr := t.signalHistoryWriter.SnapshotAt(ctx, vehicleID, active.StartTime)
		if startErr != nil {
			log.Warn().Err(startErr).Int64("vehicle_id", vehicleID).
				Msg("telemetry: signal_history charge start snapshot failed")
		}
		endSnapshot, endErr := t.signalHistoryWriter.SnapshotAt(ctx, vehicleID, time.Now().UTC())
		if endErr != nil {
			log.Warn().Err(endErr).Int64("vehicle_id", vehicleID).
				Msg("telemetry: signal_history charge end snapshot failed")
		}

		// Fill missing location (for geocoding — not written to DB)
		if active.Latitude == nil {
			if v, ok := endSnapshot["Latitude"]; ok {
				if f, fOk := v.(float64); fOk {
					active.Latitude = &f
				}
			}
		}
		if active.Longitude == nil {
			if v, ok := endSnapshot["Longitude"]; ok {
				if f, fOk := v.(float64); fOk {
					active.Longitude = &f
				}
			}
		}
	}

	// Determine ended_status based on how the charge ended
	switch {
	case signals == nil:
		enhancedFields["ended_status"] = "interrupted"
	case endBattery >= 95:
		enhancedFields["ended_status"] = "full"
	default:
		// Check DetailedChargeState for user-stop vs normal completion
		if cs, ok := signalStr(signals, "DetailedChargeState", "ChargeState"); ok {
			if strings.Contains(cs, enums.ChargeStateStopped) || strings.Contains(cs, enums.ChargeStateDisconnected) {
				enhancedFields["ended_status"] = "user_stopped"
			} else {
				enhancedFields["ended_status"] = "completed"
			}
		} else {
			enhancedFields["ended_status"] = "completed"
		}
	}

	// Default cost_currency — will be overridden when geofence electricity pricing is implemented
	// TODO: Set from geofence.ElectricityCurrency when Geofence model gains that field
	enhancedFields["cost_currency"] = "USD"

	if err := t.db.WithTx(ctx, func(tx pgx.Tx) error {
		var endBatteryPct *int16
		if b := int16(endBattery); b > 0 {
			endBatteryPct = &b
		}
		var energyAdded *float64
		if active.EnergyAdded > 0 {
			energyAdded = &active.EnergyAdded
		}
		if err := t.chargeRepo.CompleteWithTx(ctx, tx, active.SessionID, time.Now().UTC(),
			energyAdded, endBatteryPct, endRange,
			active.Power, active.Power,
			nil, nil, &duration, nil); err != nil {
			return err
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

		// TODO: Auto-calculate charge cost from geofence electricity rate.
		// Geofence model does not yet have ElectricityRate/ElectricityCurrency fields.
		// When added, compute: cost = energyAdded * rate, cost_currency = geofence.ElectricityCurrency.

		return nil
	}); err != nil {
		log.Error().Err(err).Int64("session_id", active.SessionID).Msg("telemetry: failed to complete charge")
	}

	// Resolve location name async — geocoding stays outside the transaction
	if len(enhancedFields) > 0 && active.Latitude != nil && active.Longitude != nil {
		fieldsCopy := make(map[string]interface{}, len(enhancedFields)+1)
		for k, v := range enhancedFields {
			fieldsCopy[k] = v
		}
		go func(sessionID int64, lat, lon float64, fields map[string]interface{}) {
			gctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()

			// 1. Check geofences first (user-defined name)
			if geofences, err := t.geofenceRepo.FindByCoordinates(gctx, lat, lon); err == nil && len(geofences) > 0 {
				fields["charger_location"] = geofences[0].Name
				_ = t.chargeRepo.PartialUpdate(gctx, sessionID, fields)
				return
			}

			// 2. Check places cache (previously resolved, within 50m)
			if cached, err := t.placesCache.FindNearby(gctx, lat, lon, 50); err == nil && cached != nil {
				_ = t.placesCache.IncrementHitCount(gctx, cached.ID)
				fields["charger_location"] = cached.DisplayName
				_ = t.chargeRepo.PartialUpdate(gctx, sessionID, fields)
				return
			}

			// 3. Reverse geocode and cache the result
			result, err := t.geocoder.ReverseGeocode(gctx, lat, lon)
			if err != nil {
				_ = t.chargeRepo.PartialUpdate(gctx, sessionID, fields)
				return
			}
			name := result.ShortName()
			fields["charger_location"] = name
			_ = t.chargeRepo.PartialUpdate(gctx, sessionID, fields)

			// Save to cache
			_ = t.placesCache.Upsert(gctx, &database.PlaceCacheEntry{
				Latitude: lat, Longitude: lon, DisplayName: name, Source: "geocoding",
				City: ptrStrOrNil(result.City), State: ptrStrOrNil(result.State),
				Country: ptrStrOrNil(result.Country), Postcode: ptrStrOrNil(result.PostCode),
			})
		}(active.SessionID, *active.Latitude, *active.Longitude, fieldsCopy)
	}

	log.Info().Int64("vehicle_id", vehicleID).Int64("session_id", active.SessionID).
		Float64("duration_min", duration).Float64("energy_added", active.EnergyAdded).Msg("telemetry: charging ended")

	if t.eventBus != nil {
		t.eventBus.Publish(events.Event{Type: events.ChargeCompleted, VehicleID: vehicleID,
			Data: map[string]interface{}{"session_id": active.SessionID, "battery_level": endBattery,
				"energy_added": active.EnergyAdded, "source": "fleet_telemetry"}})
	}

	delete(t.activeCharges, vehicleID)
	ChargeSessionsActive.Dec()
	ChargeSessionsCompleted.Inc()
	TotalCharges.Inc()
	if active.EnergyAdded > 0 {
		TotalEnergyKwh.Add(active.EnergyAdded)
	}

	// Backfill missing start/end values from nearest position data (async)
	go t.backfillChargeValues(active, vehicleID)
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
			backfill["start_battery_pct"] = int16(startPos.BatteryLvl)
		}
	}

	// Backfill end battery from nearest position to end time
	endTime := time.Now().UTC()
	endPos, err := findNearestPositionFallback(ctx, t.posRepo, vehicleID, endTime, lookupWindow)
	if err == nil && endPos != nil {
		if endPos.BatteryLvl > 0 {
			backfill["end_battery_pct"] = int16(endPos.BatteryLvl)
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
