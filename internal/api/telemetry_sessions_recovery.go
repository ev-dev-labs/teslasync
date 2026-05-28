package api

import (
	"context"
	"math"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/units"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// recoveryStateBundle pairs the cold-path signal.StateReader installed via
// SetDriveStateReader / SetChargeStateReader (telemetry_sessions_drive_tracking.go,
// telemetry_sessions_charge_tracking.go) with the field name `state` used by
// the per-session enrichment paths in those files. Keeping the call shape
// identical (`bundle.state.State(ctx, vehicleID, at)`) lets one anchor regex
// guard every cold-read call site against accidental re-introduction of the
// legacy *database.SignalLogReader snapshot path.
//
// Forward-fold semantics matter for crash recovery: Tesla Fleet Telemetry only
// re-emits a signal when the value changes, so a snapshot reconstructed from
// the legacy snapshot tables saw nil for any signal that had not changed since
// the start of the recovery gap, causing odometer / energy / lat-lng deltas
// to silently zero out and sessions to be closed with corrupt enrichment
// values. signal.StateReader.State forward-folds signal_log so every signal
// emitted at-or-before `at` is included regardless of when it last changed.
//
// A nil `state` field is the explicit "no reader installed" path —
// completion-time enrichment falls back to empty snapshot maps so the
// recovered session still commits with whatever in-memory data was captured
// during streaming, instead of leaving end_ts NULL forever.
type recoveryStateBundle struct {
	state signal.StateReader
}

// RecoverSessions restores active drive/charge sessions from Postgres on pod restart.
// Queries for sessions with no end_ts and rebuilds the in-memory tracking state.
func (t *TelemetrySessionTracker) RecoverSessions(ctx context.Context) {
	t.mu.Lock()
	defer t.mu.Unlock()

	// Recover open drives (started within last 24 hours)
	cutoff := time.Now().UTC().Add(-24 * time.Hour)
	openDrives, err := t.driveRepo.GetStale(ctx, cutoff)
	if err != nil {
		log.Warn().Err(err).Msg("session recovery: failed to query open drives")
	}
	for _, d := range openDrives {
		if _, exists := t.activeDrives[d.VehicleID]; exists {
			continue
		}
		sd := &streamingDrive{
			DriveID:            d.ID,
			VehicleID:          d.VehicleID,
			StartTime:          d.StartTs,
			LastSeen:           time.Now().UTC(),
			accumulatedSignals: make(map[string]interface{}),
			lastTelemetryWrite: time.Now().UTC(),
		}

		t.activeDrives[d.VehicleID] = sd
		log.Info().Int64("drive_id", d.ID).Int64("vehicle_id", d.VehicleID).Msg("session recovery: restored open drive")
	}

	// Recover open charges (started within last 48 hours — charges can be long)
	chargeCutoff := time.Now().UTC().Add(-48 * time.Hour)
	openCharges, err := t.chargeRepo.GetStale(ctx, chargeCutoff)
	if err != nil {
		log.Warn().Err(err).Msg("session recovery: failed to query open charges")
	}
	for _, c := range openCharges {
		if _, exists := t.activeCharges[c.VehicleID]; exists {
			continue
		}
		sc := &streamingCharge{
			SessionID:          c.ID,
			VehicleID:          c.VehicleID,
			StartTime:          c.StartedAt,
			StartBatteryLevel:  derefFloatAsInt(c.StartSocPct),
			LastSeen:           time.Now().UTC(),
			accumulatedSignals: make(map[string]interface{}),
			lastTelemetryWrite: time.Now().UTC(),
		}
		if c.PeakPowerW != nil {
			sc.Power = c.PeakPowerW
		}
		t.activeCharges[c.VehicleID] = sc
		log.Info().Int64("session_id", c.ID).Int64("vehicle_id", c.VehicleID).Msg("session recovery: restored open charge")
	}

	log.Info().Int("drives", len(t.activeDrives)).Int("charges", len(t.activeCharges)).Msg("session recovery: complete")
}

// ValidateRecoveredSessions checks recovered sessions against current SignalStore state.
// Auto-closes sessions that are no longer active (vehicle parked, charge complete, or timed out).
func (t *TelemetrySessionTracker) ValidateRecoveredSessions(ctx context.Context) {
	t.mu.Lock()
	defer t.mu.Unlock()

	for vehicleID, drive := range t.activeDrives {
		// Auto-close drives open > 4 hours with no new telemetry
		if time.Since(drive.StartTime) > 4*time.Hour {
			log.Info().Int64("drive_id", drive.DriveID).Msg("session recovery: auto-closing stale drive (>4h)")
			t.completeDriveLocked(ctx, vehicleID, drive, nil, time.Time{}, nil)
			continue
		}
		// If SignalStore shows Gear=P and Speed=0, close the drive
		if t.localSignals != nil {
			if gear, ok := t.localSignals.GetString(vehicleID, "Gear"); ok && gear == enums.GearPark {
				log.Info().Int64("drive_id", drive.DriveID).Msg("session recovery: closing drive (Gear=P)")
				t.completeDriveLocked(ctx, vehicleID, drive, nil, time.Time{}, nil)
			}
		}
	}

	for vehicleID, charge := range t.activeCharges {
		// Auto-close charges open > 24 hours
		if time.Since(charge.StartTime) > 24*time.Hour {
			log.Info().Int64("session_id", charge.SessionID).Msg("session recovery: auto-closing stale charge (>24h)")
			t.completeChargeLocked(ctx, vehicleID, charge, nil, time.Time{})
			continue
		}
		// If SignalStore shows charge complete, close
		if t.localSignals != nil {
			if state, ok := t.localSignals.GetString(vehicleID, "DetailedChargeState"); ok {
				if enums.IsChargeComplete(state) {
					log.Info().Int64("session_id", charge.SessionID).Msg("session recovery: closing charge (Complete)")
					t.completeChargeLocked(ctx, vehicleID, charge, nil, time.Time{})
				}
			}
		}
	}
}

// staleSessionThreshold is the minimum duration since the last signal before
// a session is considered stale and eligible for recovery completion.
const staleSessionThreshold = 5 * time.Minute

// RecoverIncompleteSessions finds drives and charges with end_ts IS NULL that
// are not currently tracked in memory, and completes them using signal_log data.
// Run once at startup after RecoverSessions / ValidateRecoveredSessions.
// Sessions with recent signals (< 5 min) are left open — the vehicle is likely
// still active and will be picked up by normal tracking.
//
// Phase-39 / ADR-002: snapshot reconstruction at the recovery start/end
// anchors goes through signal.StateReader (driveR.state / chargeR.state)
// instead of the legacy *database.SignalLogReader snapshot tables. The
// StateReader forward-folds signal_log so signals that have not been
// re-emitted since the start of the recovery gap (the common case under
// Tesla's delta encoding) still appear in the reconstructed snapshot.
// Without forward-fold, recovery saw nil for those signals and silently
// zeroed out odometer / energy / lat-lng deltas. The tracker's
// signalLogReader field is INTENTIONALLY retained for the
// LatestTimestamp() call (no StateReader equivalent) — removing the field
// would silently disable the staleness gate and try to "complete" sessions
// for vehicles that are still actively reporting.
func (t *TelemetrySessionTracker) RecoverIncompleteSessions(ctx context.Context) {
	if t.signalLogReader == nil {
		log.Info().Msg("recovery: signal_log reader not available, skipping incomplete session recovery")
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now().UTC()

	// Cold-path readers for snapshot reconstruction at recovery anchors.
	// A nil .state means SetDriveStateReader / SetChargeStateReader has
	// not run yet (first boot before router wiring) — the per-site
	// branches below degrade to empty snapshot maps so the recovered
	// session still commits with the in-memory data captured pre-crash.
	driveR := recoveryStateBundle{state: t.driveStateReader()}
	chargeR := recoveryStateBundle{state: t.chargeStateReader()}

	// 1. Find all open drives (end_ts IS NULL, start_ts < now)
	openDrives, err := t.driveRepo.GetStale(ctx, now)
	if err != nil {
		log.Warn().Err(err).Msg("recovery: failed to query open drives")
	}
	var drivesRecovered, drivesSkipped int
	for _, drive := range openDrives {
		// Skip if already tracked in memory (recovered by RecoverSessions)
		if _, exists := t.activeDrives[drive.VehicleID]; exists {
			continue
		}

		lastSignalTs, tsErr := t.signalLogReader.LatestTimestamp(ctx, drive.VehicleID)
		if tsErr != nil {
			log.Warn().Err(tsErr).Int64("drive_id", drive.ID).Int64("vehicle_id", drive.VehicleID).
				Msg("recovery: failed to get latest signal timestamp for drive")
			continue
		}
		if lastSignalTs.IsZero() {
			// No signals at all — complete with minimal data
			log.Info().Int64("drive_id", drive.ID).Msg("recovery: completing drive with no signal_log data")
			t.completeRecoveredDrive(ctx, drive, nil, nil, now)
			drivesRecovered++
			continue
		}

		staleDuration := now.Sub(lastSignalTs)
		if staleDuration < staleSessionThreshold {
			log.Info().Int64("drive_id", drive.ID).Msg("recovery: drive still active, skipping")
			drivesSkipped++
			continue
		}

		log.Info().Int64("drive_id", drive.ID).Time("last_signal", lastSignalTs).
			Msg("recovery: completing stale drive from signal_log")

		// Forward-folded snapshots via StateReader. State() errors are
		// logged-and-swallowed so a transient cold-read failure does not
		// abort recovery (the alternative is leaving the session open
		// with end_ts NULL forever).
		var startSnap, endSnap map[string]interface{}
		if driveR.state != nil {
			s, startErr := driveR.state.State(ctx, drive.VehicleID, drive.StartTs)
			if startErr != nil {
				log.Warn().Err(startErr).Int64("drive_id", drive.ID).
					Msg("recovery: state.State drive start snapshot failed")
				startSnap = map[string]interface{}{}
			} else {
				startSnap = stateToLegacyMap(s)
			}
			s2, endErr := driveR.state.State(ctx, drive.VehicleID, lastSignalTs)
			if endErr != nil {
				log.Warn().Err(endErr).Int64("drive_id", drive.ID).
					Msg("recovery: state.State drive end snapshot failed")
				endSnap = map[string]interface{}{}
			} else {
				endSnap = stateToLegacyMap(s2)
			}
		} else {
			startSnap = map[string]interface{}{}
			endSnap = map[string]interface{}{}
		}

		t.completeRecoveredDrive(ctx, drive, startSnap, endSnap, lastSignalTs)
		drivesRecovered++
	}

	// 2. Find all open charges (end_ts IS NULL, start_ts < now)
	openCharges, err := t.chargeRepo.GetStale(ctx, now)
	if err != nil {
		log.Warn().Err(err).Msg("recovery: failed to query open charges")
	}
	var chargesRecovered, chargesSkipped int
	for _, charge := range openCharges {
		// Skip if already tracked in memory (recovered by RecoverSessions)
		if _, exists := t.activeCharges[charge.VehicleID]; exists {
			continue
		}

		lastSignalTs, tsErr := t.signalLogReader.LatestTimestamp(ctx, charge.VehicleID)
		if tsErr != nil {
			log.Warn().Err(tsErr).Int64("charge_id", charge.ID).Int64("vehicle_id", charge.VehicleID).
				Msg("recovery: failed to get latest signal timestamp for charge")
			continue
		}
		if lastSignalTs.IsZero() {
			log.Info().Int64("charge_id", charge.ID).Msg("recovery: completing charge with no signal_log data")
			t.completeRecoveredCharge(ctx, charge, nil, nil, now)
			chargesRecovered++
			continue
		}

		staleDuration := now.Sub(lastSignalTs)
		if staleDuration < staleSessionThreshold {
			log.Info().Int64("charge_id", charge.ID).Msg("recovery: charge still active, skipping")
			chargesSkipped++
			continue
		}

		log.Info().Int64("charge_id", charge.ID).Time("last_signal", lastSignalTs).
			Msg("recovery: completing stale charge from signal_log")

		// Forward-folded snapshots via StateReader (see drive branch above
		// for the full rationale). State() errors are logged-and-swallowed.
		var startSnap, endSnap map[string]interface{}
		if chargeR.state != nil {
			s, startErr := chargeR.state.State(ctx, charge.VehicleID, charge.StartedAt)
			if startErr != nil {
				log.Warn().Err(startErr).Int64("charge_id", charge.ID).
					Msg("recovery: state.State charge start snapshot failed")
				startSnap = map[string]interface{}{}
			} else {
				startSnap = stateToLegacyMap(s)
			}
			s2, endErr := chargeR.state.State(ctx, charge.VehicleID, lastSignalTs)
			if endErr != nil {
				log.Warn().Err(endErr).Int64("charge_id", charge.ID).
					Msg("recovery: state.State charge end snapshot failed")
				endSnap = map[string]interface{}{}
			} else {
				endSnap = stateToLegacyMap(s2)
			}
		} else {
			startSnap = map[string]interface{}{}
			endSnap = map[string]interface{}{}
		}

		t.completeRecoveredCharge(ctx, charge, startSnap, endSnap, lastSignalTs)
		chargesRecovered++
	}

	log.Info().
		Int("drives_recovered", drivesRecovered).Int("drives_skipped", drivesSkipped).
		Int("charges_recovered", chargesRecovered).Int("charges_skipped", chargesSkipped).
		Msg("recovery: incomplete session recovery complete")
}

// completeRecoveredDrive closes a drive that was left open after a crash, using
// signal_log snapshots to populate end values. Best-effort: if snapshots are
// empty the session is still closed with whatever data is available.
//
// Phase-48: all signal values are SI canonical post-Phase-42 (Odometer in
// meters, VehicleSpeed in m/s, PackVoltage*PackCurrent in Watts), so the
// values flow directly through to SI-canonical Drive fields with no unit
// normalisation. The legacy units.NormalizeDistance/NormalizeSpeed calls
// would have actively corrupted SI values by treating meters as miles or
// km depending on the user's preference setting.
func (t *TelemetrySessionTracker) completeRecoveredDrive(ctx context.Context, drive *drivemodel.Drive, startSnap, endSnap map[string]interface{}, endTs time.Time) {
	if startSnap == nil {
		startSnap = map[string]interface{}{}
	}
	if endSnap == nil {
		endSnap = map[string]interface{}{}
	}

	durationSec := endTs.Sub(drive.StartTs).Seconds()
	if durationSec < 0 {
		durationSec = 0
	}
	durationS := int64(durationSec + 0.5)
	enhancedFields := map[string]interface{}{
		"ended_status": "recovered",
	}

	endTempUnit := units.GetUnitFromSnapshot(endSnap, "SettingTemperatureUnit")

	// Distance from odometer (SI meters; codec already normalised).
	var distanceMeters float64
	if startOdo, ok := snapFloat(startSnap, "Odometer"); ok {
		if endOdo, ok := snapFloat(endSnap, "Odometer"); ok {
			d := endOdo - startOdo
			if d > 0 {
				distanceMeters = d
				enhancedFields["distance_m"] = distanceMeters
			}
		}
	}

	// Battery
	var endBattery int
	if bl, ok := snapFloat(startSnap, "BatteryLevel"); ok && bl > 0 {
		enhancedFields["start_soc_pct"] = float32(bl)
	}
	if bl, ok := snapFloat(endSnap, "BatteryLevel"); ok && bl > 0 {
		endBattery = int(bl)
	}

	// Position from snapshots. Dual-key tolerance for Phase-42
	// codec ("LocationLatitude") + legacy ingest ("Latitude").
	if lat, ok := snapFloat(startSnap, "LocationLatitude", "Latitude"); ok {
		enhancedFields["start_lat"] = lat
	}
	if lon, ok := snapFloat(startSnap, "LocationLongitude", "Longitude"); ok {
		enhancedFields["start_lng"] = lon
	}
	if lat, ok := snapFloat(endSnap, "LocationLatitude", "Latitude"); ok {
		enhancedFields["end_lat"] = lat
	}
	if lon, ok := snapFloat(endSnap, "LocationLongitude", "Longitude"); ok {
		enhancedFields["end_lng"] = lon
	}

	// Temperature (unit-aware, normalised to °C). Only ambient (outside)
	// is persisted; mig 000185 dropped the inside cabin temp column.
	var outsideAvg *float64
	if temp, ok := snapFloat(endSnap, "OutsideTemp"); ok {
		normalized := units.NormalizeTemp(temp, endTempUnit)
		enhancedFields["ambient_temp_c_avg"] = normalized
		outsideAvg = &normalized
	}

	// Energy: delta of cumulative LifetimeEnergyUsed counter (kWh) → Wh.
	if startEnergy, ok := snapFloat(startSnap, "LifetimeEnergyUsed"); ok {
		if endEnergy, ok := snapFloat(endSnap, "LifetimeEnergyUsed"); ok {
			energyKwh := endEnergy - startEnergy
			if energyKwh > 0 {
				enhancedFields["energy_used_wh"] = energyKwh * 1000.0
			}
		}
	}

	// Aggregates from signal_log during the drive window.
	// DriveAggregates returns avg/max speed in m/s (SI canonical) and avg
	// power in kW (V*A/1000); convert avg power to Watts.
	var maxSpeedMps float64
	var powerMaxW *float64
	slAvgSpeed, slMaxSpeed, slAvgPower := t.signalLogReader.DriveAggregates(ctx, drive.VehicleID, drive.StartTs, endTs)
	if slAvgSpeed > 0 {
		enhancedFields["avg_speed_mps"] = slAvgSpeed
	}
	if slMaxSpeed > 0 {
		enhancedFields["max_speed_mps"] = slMaxSpeed
		maxSpeedMps = slMaxSpeed
	}
	if slAvgPower != 0 {
		w := math.Abs(slAvgPower) * 1000.0
		enhancedFields["avg_power_w"] = w
		powerMaxW = &w
	}

	// Regen energy (kWh from signal_log) → Wh.
	regenKwh := t.signalLogReader.RegenEnergy(ctx, drive.VehicleID, drive.StartTs, endTs)
	if regenKwh > 0 {
		enhancedFields["regen_energy_wh"] = regenKwh * 1000.0
	}

	// Commit to DB
	if err := t.db.WithTx(ctx, func(tx pgx.Tx) error {
		var endBatteryPct *int16
		if b := int16(endBattery); b > 0 {
			endBatteryPct = &b
		}
		if err := t.driveRepo.CompleteWithTx(ctx, tx, drive.ID, endTs,
			distanceMeters, durationS, endBatteryPct, &maxSpeedMps, powerMaxW, outsideAvg); err != nil {
			return err
		}
		if len(enhancedFields) > 0 {
			if err := t.driveRepo.PartialUpdateWithTx(ctx, tx, drive.ID, enhancedFields); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		log.Error().Err(err).Int64("drive_id", drive.ID).Msg("recovery: failed to complete drive")
		return
	}

	log.Info().Int64("drive_id", drive.ID).Int64("vehicle_id", drive.VehicleID).
		Time("original_start", drive.StartTs).Time("recovered_end", endTs).
		Int64("duration_s", durationS).Float64("distance_m", distanceMeters).
		Msg("recovery: drive completed")
}

// completeRecoveredCharge closes a charge that was left open after a crash, using
// signal_log snapshots to populate end values. Best-effort: if snapshots are
// empty the session is still closed with whatever data is available.
func (t *TelemetrySessionTracker) completeRecoveredCharge(ctx context.Context, charge *chargingmodel.ChargingSession, startSnap, endSnap map[string]interface{}, endTs time.Time) {
	if startSnap == nil {
		startSnap = map[string]interface{}{}
	}
	if endSnap == nil {
		endSnap = map[string]interface{}{}
	}

	enhancedFields := map[string]interface{}{}

	// Battery level from snapshots
	var endBattery int
	if bl, ok := snapFloat(startSnap, "BatteryLevel"); ok && bl > 0 {
		enhancedFields["start_soc_pct"] = bl
	}
	if bl, ok := snapFloat(endSnap, "BatteryLevel"); ok && bl > 0 {
		endBattery = int(bl)
	}

	// Energy added: difference in cumulative energy counter
	var energyAdded float64
	if startEnergy, ok := snapFloat(startSnap, "ACChargingEnergyIn"); ok {
		if endEnergy, ok := snapFloat(endSnap, "ACChargingEnergyIn"); ok {
			delta := endEnergy - startEnergy
			if delta > 0 {
				energyAdded = delta
				enhancedFields["total_energy_added_wh"] = delta
			}
		}
	}

	// Estimate energy from battery% diff if direct signal unavailable
	startBattery := derefFloatAsInt(charge.StartSocPct)
	if energyAdded == 0 && startBattery > 0 && endBattery > startBattery {
		energyAdded = float64(endBattery-startBattery) * 750
	}

	// Location from snapshots
	if lat, ok := snapFloat(endSnap, "LocationLatitude", "Latitude"); ok {
		enhancedFields["start_lat"] = lat
	}
	if lon, ok := snapFloat(endSnap, "LocationLongitude", "Longitude"); ok {
		enhancedFields["start_lng"] = lon
	}

	// Charger type detection from snapshot
	if dcPower, ok := snapFloat(endSnap, "DCChargingPower"); ok && dcPower > 0 {
		enhancedFields["charger_type"] = "DC"
	}

	// Max/avg power from signal_log aggregate during charge window
	slMaxPower, slAvgPower := t.signalLogReader.ChargeAggregates(ctx, charge.VehicleID, charge.StartedAt, endTs)
	if slMaxPower > 0 {
		enhancedFields["peak_power_w"] = slMaxPower
	}
	if slAvgPower > 0 {
		enhancedFields["avg_power_w"] = slAvgPower
	}

	if v, ok := signalStr(endSnap, "ChargingCableType"); ok {
		enhancedFields["cable_type"] = v
	}

	// Commit to DB
	if err := t.db.WithTx(ctx, func(tx pgx.Tx) error {
		var endSocPct *float64
		if endBattery > 0 {
			v := float64(endBattery)
			endSocPct = &v
		}
		var energyAddedPtr *float64
		if energyAdded > 0 {
			energyAddedPtr = &energyAdded
		}
		var maxPower, avgPower *float64
		if slMaxPower > 0 {
			maxPower = &slMaxPower
		}
		if slAvgPower > 0 {
			avgPower = &slAvgPower
		}
		if err := t.chargeRepo.CompleteWithTx(ctx, tx, charge.ID, endTs,
			energyAddedPtr, endSocPct,
			maxPower, avgPower,
			nil, nil); err != nil {
			return err
		}
		// Backfill session_id on charging_telemetry rows in the same tx
		// as completion (pattern parity with C4 drive backfill). Recovery
		// sessions are particularly likely to have orphaned per-tick rows
		// because the api may have crashed between session-create and
		// session-complete, leaving every reading session_id=NULL.
		if affected, err := t.chargeRepo.BackfillChargingTelemetrySessionIDInTx(
			ctx, tx, charge.ID, charge.VehicleID, charge.StartedAt, endTs); err != nil {
			log.Error().Err(err).
				Int64("session_id", charge.ID).
				Int64("vehicle_id", charge.VehicleID).
				Time("start_ts", charge.StartedAt).
				Time("end_ts", endTs).
				Msg("recovery: charging_telemetry session_id backfill failed; rolling back completion")
			return err
		} else if affected > 0 {
			log.Info().
				Int64("session_id", charge.ID).
				Int64("vehicle_id", charge.VehicleID).
				Int64("rows_attributed", affected).
				Msg("recovery: backfilled charging_telemetry.session_id for completed session")
		}
		if len(enhancedFields) > 0 {
			if err := t.chargeRepo.PartialUpdateWithTx(ctx, tx, charge.ID, enhancedFields); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		log.Error().Err(err).Int64("charge_id", charge.ID).Msg("recovery: failed to complete charge")
		return
	}

	log.Info().Int64("charge_id", charge.ID).Int64("vehicle_id", charge.VehicleID).
		Time("original_start", charge.StartedAt).Time("recovered_end", endTs).
		Float64("duration_s", endTs.Sub(charge.StartedAt).Seconds()).Float64("total_energy_added_wh", energyAdded).
		Msg("recovery: charge completed")
}
