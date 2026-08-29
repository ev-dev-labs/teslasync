package telemetry

import (
	"context"
	"math"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	signalcounter "github.com/ev-dev-labs/teslasync/internal/signal/counter"
	"github.com/ev-dev-labs/teslasync/internal/units"
)

// recoveryStateBundle pairs the cold-path signal.StateReader installed via
// SetDriveStateReader / SetChargeStateReader (telemetry_sessions_drive_tracking.go,
// telemetry_sessions_charge_tracking.go) with the field name `state` used by
// the per-session enrichment paths in those files. Keeping the call shape
// identical (`bundle.state.State(ctx, vehicleID, at)`) lets one anchor regex
// guard every cold-read call site against accidental re-introduction of the
// legacy *signaldb.SignalLogReader snapshot path.
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

// RecoverSessions restores plausible active drive/charge sessions from
// Postgres on pod restart. Historical open rows are intentionally not restored
// as live: they remain available to the evidence-based data-repair workflow.
func (t *TelemetrySessionTracker) RecoverSessions(ctx context.Context) {
	t.mu.Lock()
	defer t.mu.Unlock()

	recoveryNow := time.Now().UTC()

	// Recover open drives (started within last 24 hours)
	cutoff := recoveryNow.Add(-24 * time.Hour)
	openDrives, err := t.driveRepo.GetOpenSince(ctx, cutoff)
	if err != nil {
		log.Warn().Err(err).Msg("session recovery: failed to query open drives")
	}
	for _, d := range openDrives {
		if d.StartTs.After(recoveryNow) {
			continue
		}
		if _, exists := t.activeDrives[d.VehicleID]; exists {
			continue
		}
		sd := &streamingDrive{
			DriveID:            d.ID,
			VehicleID:          d.VehicleID,
			StartTime:          d.StartTs,
			LastSeen:           recoveryNow,
			accumulatedSignals: make(map[string]interface{}),
			lastTelemetryWrite: recoveryNow,
			state:              t.driveStateReader(),
		}

		t.activeDrives[d.VehicleID] = sd
		log.Info().Int64("drive_id", d.ID).Int64("vehicle_id", d.VehicleID).Msg("session recovery: restored open drive")
	}

	// Recover open charges (started within last 48 hours — charges can be long)
	chargeCutoff := recoveryNow.Add(-48 * time.Hour)
	openCharges, err := t.chargeRepo.GetOpenSince(ctx, chargeCutoff)
	if err != nil {
		log.Warn().Err(err).Msg("session recovery: failed to query open charges")
	}
	for _, c := range openCharges {
		if c.StartedAt.After(recoveryNow) {
			continue
		}
		if _, exists := t.activeCharges[c.VehicleID]; exists {
			continue
		}
		sc := &streamingCharge{
			SessionID:          c.ID,
			VehicleID:          c.VehicleID,
			StartTime:          c.StartedAt,
			StartBatteryLevel:  derefFloatAsInt(c.StartSocPct),
			LastSeen:           recoveryNow,
			accumulatedSignals: make(map[string]interface{}),
			lastTelemetryWrite: recoveryNow,
			state:              t.chargeStateReader(),
		}
		if c.PeakPowerW != nil {
			sc.Power = c.PeakPowerW
		}
		t.activeCharges[c.VehicleID] = sc
		log.Info().Int64("session_id", c.ID).Int64("vehicle_id", c.VehicleID).Msg("session recovery: restored open charge")
	}

	log.Info().Int("drives", len(t.activeDrives)).Int("charges", len(t.activeCharges)).Msg("session recovery: complete")
}

var (
	recoveryChargeStateFields = []string{"DetailedChargeState", "ChargeState"}
	recoveryActiveStates      = []string{
		enums.ChargeStateCharging,
		enums.ChargeStateStarting,
		"Enable",
	}
	recoveryTerminalStates = []string{
		enums.ChargeStateComplete,
		enums.ChargeStateStopped,
		enums.ChargeStateDisconnected,
		enums.ChargeStateNoPower,
	}
)

type recoveryEvidence interface {
	LastDrivingObservation(context.Context, int64, []string, time.Time, time.Time) (*datarepairdb.Observation, error)
	FirstGearObservation(context.Context, int64, []string, time.Time, time.Time) (*datarepairdb.Observation, error)
	FirstChargeStateObservation(context.Context, int64, []string, []string, time.Time, time.Time) (*datarepairdb.Observation, error)
	FirstChargingSessionAfter(context.Context, int64, time.Time, int64) (*datarepairdb.Observation, error)
	FirstDriveAfter(context.Context, int64, time.Time, int64) (*datarepairdb.Observation, error)
}

func finalParkBoundary(
	ctx context.Context,
	evidence recoveryEvidence,
	vehicleID int64,
	startedAt, until time.Time,
) (*datarepairdb.Observation, error) {
	lastDriving, err := evidence.LastDrivingObservation(
		ctx,
		vehicleID,
		[]string{enums.GearDrive, enums.GearReverse},
		startedAt,
		until,
	)
	if err != nil {
		return nil, err
	}
	searchAfter := startedAt
	if lastDriving != nil {
		searchAfter = lastDriving.Ts.Add(-time.Nanosecond)
	}
	return evidence.FirstGearObservation(
		ctx,
		vehicleID,
		[]string{enums.GearPark, enums.GearNeutral},
		searchAfter,
		until,
	)
}

func earlierRecoveryObservation(a, b *datarepairdb.Observation) *datarepairdb.Observation {
	if a == nil {
		return b
	}
	if b == nil || a.Ts.Before(b.Ts) {
		return a
	}
	return b
}

func boundedRecoveryEvidenceUntil(nextSameKind *datarepairdb.Observation, until time.Time) time.Time {
	if nextSameKind == nil || nextSameKind.Ts.After(until) {
		return until
	}
	return nextSameKind.Ts.Add(-time.Nanosecond)
}

func terminalEvidencePrecedesContradiction(
	terminal, contradiction *datarepairdb.Observation,
) bool {
	return terminal != nil &&
		(contradiction == nil || terminal.Ts.Before(contradiction.Ts))
}

func driveRecoveryEvidenceUntil(
	ctx context.Context,
	evidence recoveryEvidence,
	vehicleID int64,
	startedAt time.Time,
	driveID int64,
	until time.Time,
) (time.Time, error) {
	nextDrive, err := evidence.FirstDriveAfter(ctx, vehicleID, startedAt, driveID)
	if err != nil {
		return time.Time{}, err
	}
	return boundedRecoveryEvidenceUntil(nextDrive, until), nil
}

func chargingRecoveryEvidenceUntil(
	ctx context.Context,
	evidence recoveryEvidence,
	vehicleID int64,
	startedAt time.Time,
	sessionID int64,
	until time.Time,
) (time.Time, error) {
	nextCharge, err := evidence.FirstChargingSessionAfter(ctx, vehicleID, startedAt, sessionID)
	if err != nil {
		return time.Time{}, err
	}
	return boundedRecoveryEvidenceUntil(nextCharge, until), nil
}

func driveRecoveryContradiction(
	ctx context.Context,
	evidence recoveryEvidence,
	vehicleID int64,
	startedAt, until time.Time,
) (*datarepairdb.Observation, error) {
	chargeSession, err := evidence.FirstChargingSessionAfter(ctx, vehicleID, startedAt, 0)
	if err != nil {
		return nil, err
	}
	if chargeSession != nil && chargeSession.Ts.After(until) {
		chargeSession = nil
	}
	chargeState, err := evidence.FirstChargeStateObservation(
		ctx,
		vehicleID,
		recoveryChargeStateFields,
		recoveryActiveStates,
		startedAt,
		until,
	)
	if err != nil {
		return nil, err
	}
	return earlierRecoveryObservation(chargeSession, chargeState), nil
}

func chargingRecoveryContradiction(
	ctx context.Context,
	evidence recoveryEvidence,
	vehicleID int64,
	startedAt, until time.Time,
) (*datarepairdb.Observation, error) {
	driveSession, err := evidence.FirstDriveAfter(ctx, vehicleID, startedAt, 0)
	if err != nil {
		return nil, err
	}
	if driveSession != nil && driveSession.Ts.After(until) {
		driveSession = nil
	}
	driveGear, err := evidence.FirstGearObservation(
		ctx,
		vehicleID,
		[]string{enums.GearDrive, enums.GearReverse},
		startedAt,
		until,
	)
	if err != nil {
		return nil, err
	}
	return earlierRecoveryObservation(driveSession, driveGear), nil
}

// ValidateRecoveredSessions checks recovered sessions against timestamped
// durable history. It closes only when a definitive boundary was persisted
// after the session started; age and hydrated current-state timestamps are not
// boundary evidence.
func (t *TelemetrySessionTracker) ValidateRecoveredSessions(ctx context.Context) {
	if t.db == nil {
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	evidence := datarepairdb.NewRepo(t.db)
	t.validateRecoveredWithEvidence(ctx, evidence, time.Now().UTC())
}

func (t *TelemetrySessionTracker) validateRecoveredWithEvidence(
	ctx context.Context,
	evidence recoveryEvidence,
	now time.Time,
) {
	for vehicleID, drive := range t.activeDrives {
		evidenceUntil, err := driveRecoveryEvidenceUntil(
			ctx,
			evidence,
			vehicleID,
			drive.StartTime,
			drive.DriveID,
			now,
		)
		if err != nil {
			log.Warn().Err(err).
				Int64("drive_id", drive.DriveID).
				Int64("vehicle_id", vehicleID).
				Msg("session recovery: failed to resolve drive evidence window")
			continue
		}
		boundary, err := finalParkBoundary(
			ctx,
			evidence,
			vehicleID,
			drive.StartTime,
			evidenceUntil,
		)
		if err != nil {
			log.Warn().Err(err).
				Int64("drive_id", drive.DriveID).
				Int64("vehicle_id", vehicleID).
				Msg("session recovery: failed to validate drive boundary evidence")
			continue
		}
		contradiction, err := driveRecoveryContradiction(
			ctx,
			evidence,
			vehicleID,
			drive.StartTime,
			evidenceUntil,
		)
		if err != nil {
			log.Warn().Err(err).
				Int64("drive_id", drive.DriveID).
				Int64("vehicle_id", vehicleID).
				Msg("session recovery: failed to check drive contradiction evidence")
			continue
		}
		if terminalEvidencePrecedesContradiction(boundary, contradiction) {
			log.Info().
				Int64("drive_id", drive.DriveID).
				Time("boundary_ts", boundary.Ts).
				Str("gear", boundary.Value).
				Msg("session recovery: closing drive from timestamped parked-gear evidence")
			t.completeDriveLocked(
				ctx,
				vehicleID,
				drive,
				map[string]interface{}{boundary.Field: boundary.Value},
				boundary.Ts,
				map[string]time.Time{boundary.Field: boundary.Ts},
			)
			continue
		}
		if contradiction != nil {
			delete(t.activeDrives, vehicleID)
			log.Warn().
				Int64("drive_id", drive.DriveID).
				Int64("vehicle_id", vehicleID).
				Time("contradiction_ts", contradiction.Ts).
				Str("contradiction_field", contradiction.Field).
				Msg("session recovery: detached ambiguous drive for operator review")
		}
	}

	for vehicleID, charge := range t.activeCharges {
		evidenceUntil, err := chargingRecoveryEvidenceUntil(
			ctx,
			evidence,
			vehicleID,
			charge.StartTime,
			charge.SessionID,
			now,
		)
		if err != nil {
			log.Warn().Err(err).
				Int64("session_id", charge.SessionID).
				Int64("vehicle_id", vehicleID).
				Msg("session recovery: failed to resolve charging evidence window")
			continue
		}
		boundary, err := evidence.FirstChargeStateObservation(
			ctx,
			vehicleID,
			recoveryChargeStateFields,
			recoveryTerminalStates,
			charge.StartTime,
			evidenceUntil,
		)
		if err != nil {
			log.Warn().Err(err).
				Int64("session_id", charge.SessionID).
				Int64("vehicle_id", vehicleID).
				Msg("session recovery: failed to validate charging boundary evidence")
			continue
		}
		contradiction, err := chargingRecoveryContradiction(
			ctx,
			evidence,
			vehicleID,
			charge.StartTime,
			evidenceUntil,
		)
		if err != nil {
			log.Warn().Err(err).
				Int64("session_id", charge.SessionID).
				Int64("vehicle_id", vehicleID).
				Msg("session recovery: failed to check charging contradiction evidence")
			continue
		}
		if terminalEvidencePrecedesContradiction(boundary, contradiction) {
			log.Info().
				Int64("session_id", charge.SessionID).
				Time("boundary_ts", boundary.Ts).
				Str("charge_state", boundary.Value).
				Msg("session recovery: closing charge from timestamped terminal-state evidence")
			t.completeChargeLocked(
				ctx,
				vehicleID,
				charge,
				map[string]interface{}{boundary.Field: boundary.Value},
				boundary.Ts,
			)
			continue
		}
		if contradiction != nil {
			delete(t.activeCharges, vehicleID)
			log.Warn().
				Int64("session_id", charge.SessionID).
				Int64("vehicle_id", vehicleID).
				Time("contradiction_ts", contradiction.Ts).
				Str("contradiction_field", contradiction.Field).
				Msg("session recovery: detached ambiguous charging session for operator review")
		}
	}
}

// RecoverIncompleteSessions finds historical open sessions that were not
// restored into memory and closes only those with a definitive, timestamped
// terminal signal. Ambiguous rows stay open for the data-repair worklist; a
// latest arbitrary signal or elapsed wall-clock time is never treated as a
// session boundary.
//
// ADR-002: snapshot reconstruction at the recovery start/end
// anchors goes through signal.StateReader (driveR.state / chargeR.state)
// instead of the legacy *signaldb.SignalLogReader snapshot tables. The
// StateReader forward-folds signal_log so signals that have not been
// re-emitted since the start of the recovery gap (the common case under
// Tesla's delta encoding) still appear in the reconstructed snapshot.
// Without forward-fold, recovery saw nil for those signals and silently
// zeroed out odometer / energy / lat-lng deltas. The tracker's
// signalLogReader field is retained for completion aggregates after a
// definitive boundary has been found.
func (t *TelemetrySessionTracker) RecoverIncompleteSessions(ctx context.Context) {
	if t.signalLogReader == nil || t.db == nil {
		log.Info().Msg("recovery: durable readers not available, skipping incomplete session recovery")
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now().UTC()

	// Cold-path readers for snapshot reconstruction at recovery anchors.
	// A nil .state means SetDriveStateReader / SetChargeStateReader has
	// not run yet (first boot before router wiring) — the per-site
	// branches below degrade to empty snapshot maps after a boundary is found.
	driveR := recoveryStateBundle{state: t.driveStateReader()}
	chargeR := recoveryStateBundle{state: t.chargeStateReader()}
	evidence := datarepairdb.NewRepo(t.db)

	// 1. Find open historical drives and require Park/Neutral evidence.
	openDrives, err := t.driveRepo.GetStale(ctx, now)
	if err != nil {
		log.Warn().Err(err).Msg("recovery: failed to query open drives")
	}
	var drivesRecovered, drivesPendingReview int
	for _, drive := range openDrives {
		if _, exists := t.activeDrives[drive.VehicleID]; exists {
			continue
		}

		evidenceUntil, windowErr := driveRecoveryEvidenceUntil(
			ctx,
			evidence,
			drive.VehicleID,
			drive.StartTs,
			drive.ID,
			now,
		)
		if windowErr != nil {
			log.Warn().Err(windowErr).
				Int64("drive_id", drive.ID).
				Int64("vehicle_id", drive.VehicleID).
				Msg("recovery: failed to resolve drive evidence window")
			continue
		}
		boundary, boundaryErr := finalParkBoundary(
			ctx,
			evidence,
			drive.VehicleID,
			drive.StartTs,
			evidenceUntil,
		)
		if boundaryErr != nil {
			log.Warn().Err(boundaryErr).
				Int64("drive_id", drive.ID).
				Int64("vehicle_id", drive.VehicleID).
				Msg("recovery: failed to query drive boundary evidence")
			continue
		}
		contradiction, contradictionErr := driveRecoveryContradiction(
			ctx,
			evidence,
			drive.VehicleID,
			drive.StartTs,
			evidenceUntil,
		)
		if contradictionErr != nil {
			log.Warn().Err(contradictionErr).
				Int64("drive_id", drive.ID).
				Int64("vehicle_id", drive.VehicleID).
				Msg("recovery: failed to query drive contradiction evidence")
			continue
		}
		if !terminalEvidencePrecedesContradiction(boundary, contradiction) {
			drivesPendingReview++
			if contradiction != nil {
				log.Warn().
					Int64("drive_id", drive.ID).
					Int64("vehicle_id", drive.VehicleID).
					Time("contradiction_ts", contradiction.Ts).
					Str("contradiction_field", contradiction.Field).
					Msg("recovery: historical drive left open for operator data repair")
			}
			continue
		}

		log.Info().
			Int64("drive_id", drive.ID).
			Time("boundary_ts", boundary.Ts).
			Str("gear", boundary.Value).
			Msg("recovery: completing drive from timestamped parked-gear evidence")

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
			s2, endErr := driveR.state.State(ctx, drive.VehicleID, boundary.Ts)
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

		if t.completeRecoveredDrive(ctx, drive, startSnap, endSnap, boundary.Ts) {
			drivesRecovered++
		}
	}

	// 2. Find open historical charges and require an explicit terminal state.
	openCharges, err := t.chargeRepo.GetStale(ctx, now)
	if err != nil {
		log.Warn().Err(err).Msg("recovery: failed to query open charges")
	}
	var chargesRecovered, chargesPendingReview int
	for _, charge := range openCharges {
		if _, exists := t.activeCharges[charge.VehicleID]; exists {
			continue
		}

		evidenceUntil, windowErr := chargingRecoveryEvidenceUntil(
			ctx,
			evidence,
			charge.VehicleID,
			charge.StartedAt,
			charge.ID,
			now,
		)
		if windowErr != nil {
			log.Warn().Err(windowErr).
				Int64("charge_id", charge.ID).
				Int64("vehicle_id", charge.VehicleID).
				Msg("recovery: failed to resolve charging evidence window")
			continue
		}
		boundary, stateErr := evidence.FirstChargeStateObservation(
			ctx,
			charge.VehicleID,
			recoveryChargeStateFields,
			recoveryTerminalStates,
			charge.StartedAt,
			evidenceUntil,
		)
		if stateErr != nil {
			log.Warn().Err(stateErr).
				Int64("charge_id", charge.ID).
				Int64("vehicle_id", charge.VehicleID).
				Msg("recovery: failed to query charging boundary evidence")
			continue
		}
		contradiction, contradictionErr := chargingRecoveryContradiction(
			ctx,
			evidence,
			charge.VehicleID,
			charge.StartedAt,
			evidenceUntil,
		)
		if contradictionErr != nil {
			log.Warn().Err(contradictionErr).
				Int64("charge_id", charge.ID).
				Int64("vehicle_id", charge.VehicleID).
				Msg("recovery: failed to query charging contradiction evidence")
			continue
		}
		if !terminalEvidencePrecedesContradiction(boundary, contradiction) {
			chargesPendingReview++
			if contradiction != nil {
				log.Warn().
					Int64("charge_id", charge.ID).
					Int64("vehicle_id", charge.VehicleID).
					Time("contradiction_ts", contradiction.Ts).
					Str("contradiction_field", contradiction.Field).
					Msg("recovery: historical charge left open for operator data repair")
			}
			continue
		}

		log.Info().
			Int64("charge_id", charge.ID).
			Time("boundary_ts", boundary.Ts).
			Str("charge_state", boundary.Value).
			Msg("recovery: completing charge from timestamped terminal-state evidence")

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
			s2, endErr := chargeR.state.State(ctx, charge.VehicleID, boundary.Ts)
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

		if t.completeRecoveredCharge(ctx, charge, startSnap, endSnap, boundary.Ts) {
			chargesRecovered++
		}
	}

	log.Info().
		Int("drives_recovered", drivesRecovered).
		Int("drives_pending_review", drivesPendingReview).
		Int("charges_recovered", chargesRecovered).
		Int("charges_pending_review", chargesPendingReview).
		Msg("recovery: incomplete session recovery complete")
}

// completeRecoveredDrive closes a drive that was left open after a crash, using
// signal_log snapshots to populate end values. Best-effort: if snapshots are
// empty the session is still closed with whatever data is available.
//
// All signal values are SI canonical after telemetry normalization (Odometer
// in meters, VehicleSpeed in m/s, PackVoltage*PackCurrent in Watts), so the
// values flow directly through to SI-canonical Drive fields with no unit
// normalisation. The legacy units.NormalizeDistance/NormalizeSpeed calls
// would have actively corrupted SI values by treating meters as miles or
// km depending on the user's preference setting.
func (t *TelemetrySessionTracker) completeRecoveredDrive(ctx context.Context, drive *drivemodel.Drive, startSnap, endSnap map[string]interface{}, endTs time.Time) bool {
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
			change := signalcounter.Compare(startOdo, endOdo)
			if change.Kind == signalcounter.ChangeAdvanced {
				distanceMeters = change.Delta
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

	// Position from snapshots. Dual-key tolerance for the codec
	// ("LocationLatitude") + legacy ingest ("Latitude").
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
			change := signalcounter.Compare(startEnergy, endEnergy)
			if change.Kind == signalcounter.ChangeAdvanced {
				enhancedFields["energy_used_wh"] = change.Delta * 1000.0
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
	if err := t.withTransaction(ctx, func(tx pgx.Tx) error {
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
		return false
	}

	log.Info().Int64("drive_id", drive.ID).Int64("vehicle_id", drive.VehicleID).
		Time("original_start", drive.StartTs).Time("recovered_end", endTs).
		Int64("duration_s", durationS).Float64("distance_m", distanceMeters).
		Msg("recovery: drive completed")
	return true
}

// completeRecoveredCharge closes a charge that was left open after a crash, using
// signal_log snapshots to populate end values. Best-effort: if snapshots are
// empty the session is still closed with whatever data is available.
func (t *TelemetrySessionTracker) completeRecoveredCharge(ctx context.Context, charge *chargingmodel.ChargingSession, startSnap, endSnap map[string]interface{}, endTs time.Time) bool {
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
			change := signalcounter.Compare(startEnergy, endEnergy)
			if change.Kind == signalcounter.ChangeAdvanced {
				energyAdded = change.Delta
				enhancedFields["total_energy_added_wh"] = change.Delta
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
	if err := t.withTransaction(ctx, func(tx pgx.Tx) error {
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
		return false
	}

	log.Info().Int64("charge_id", charge.ID).Int64("vehicle_id", charge.VehicleID).
		Time("original_start", charge.StartedAt).Time("recovered_end", endTs).
		Float64("duration_s", endTs.Sub(charge.StartedAt).Seconds()).Float64("total_energy_added_wh", energyAdded).
		Msg("recovery: charge completed")
	return true
}
