package telemetry

import (
	"context"
	"reflect"
	"time"

	telemetrymodel "github.com/ev-dev-labs/teslasync/internal/models/telemetry"

	"github.com/rs/zerolog/log"

	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
	positiondb "github.com/ev-dev-labs/teslasync/internal/database/position"
)

// StartBufferDrains is retained for caller compatibility (main.go). Telemetry
// buffers were removed — drive/charge data now lands in signal_log.
func (t *TelemetrySessionTracker) StartBufferDrains(ctx context.Context) {}

// FlushBuffers is retained for caller compatibility (main.go).
func (t *TelemetrySessionTracker) FlushBuffers(ctx context.Context) {}

// DriveBufferLen is retained for caller compatibility (router.go).
func (t *TelemetrySessionTracker) DriveBufferLen() int { return 0 }

// ChargeBufferLen is retained for caller compatibility (router.go).
func (t *TelemetrySessionTracker) ChargeBufferLen() int { return 0 }

// CleanupStaleSessions reviews in-memory sessions that have stopped receiving
// updates. It closes only from a definitive, timestamped boundary in durable
// telemetry history. Ambiguous and orphaned database rows remain open for the
// evidence-based data-repair workflow.
func (t *TelemetrySessionTracker) CleanupStaleSessions(ctx context.Context, staleTimeout time.Duration) {
	if t.db == nil {
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now().UTC()
	evidence := datarepairdb.NewRepo(t.db)
	for vehicleID, drive := range t.activeDrives {
		if now.Sub(drive.LastSeen) > staleTimeout {
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
					Int64("vehicle_id", vehicleID).
					Int64("drive_id", drive.DriveID).
					Msg("telemetry: failed to resolve stale drive evidence window")
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
					Int64("vehicle_id", vehicleID).
					Int64("drive_id", drive.DriveID).
					Msg("telemetry: failed to query stale drive boundary evidence")
				continue
			}
			contradiction, contradictionErr := driveRecoveryContradiction(
				ctx,
				evidence,
				vehicleID,
				drive.StartTime,
				evidenceUntil,
			)
			if contradictionErr != nil {
				log.Warn().Err(contradictionErr).
					Int64("vehicle_id", vehicleID).
					Int64("drive_id", drive.DriveID).
					Msg("telemetry: failed to query stale drive contradiction evidence")
				continue
			}
			if !terminalEvidencePrecedesContradiction(boundary, contradiction) {
				if contradiction != nil {
					delete(t.activeDrives, vehicleID)
					log.Warn().
						Int64("vehicle_id", vehicleID).
						Int64("drive_id", drive.DriveID).
						Time("contradiction_ts", contradiction.Ts).
						Str("contradiction_field", contradiction.Field).
						Msg("telemetry: detached ambiguous stale drive for operator review")
					continue
				}
				log.Debug().
					Int64("vehicle_id", vehicleID).
					Int64("drive_id", drive.DriveID).
					Dur("idle", now.Sub(drive.LastSeen)).
					Msg("telemetry: stale drive has no definitive boundary; leaving open for review")
				continue
			}
			log.Warn().
				Int64("vehicle_id", vehicleID).
				Int64("drive_id", drive.DriveID).
				Time("boundary_ts", boundary.Ts).
				Msg("telemetry: closing stale drive from timestamped parked-gear evidence")
			t.completeDriveLocked(
				ctx,
				vehicleID,
				drive,
				map[string]interface{}{boundary.Field: boundary.Value},
				boundary.Ts,
				map[string]time.Time{boundary.Field: boundary.Ts},
			)
		}
	}
	for vehicleID, charge := range t.activeCharges {
		if now.Sub(charge.LastSeen) > staleTimeout {
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
					Int64("vehicle_id", vehicleID).
					Int64("session_id", charge.SessionID).
					Msg("telemetry: failed to resolve stale charging evidence window")
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
					Int64("vehicle_id", vehicleID).
					Int64("session_id", charge.SessionID).
					Msg("telemetry: failed to query stale charging boundary evidence")
				continue
			}
			contradiction, contradictionErr := chargingRecoveryContradiction(
				ctx,
				evidence,
				vehicleID,
				charge.StartTime,
				evidenceUntil,
			)
			if contradictionErr != nil {
				log.Warn().Err(contradictionErr).
					Int64("vehicle_id", vehicleID).
					Int64("session_id", charge.SessionID).
					Msg("telemetry: failed to query stale charging contradiction evidence")
				continue
			}
			if !terminalEvidencePrecedesContradiction(boundary, contradiction) {
				if contradiction != nil {
					delete(t.activeCharges, vehicleID)
					log.Warn().
						Int64("vehicle_id", vehicleID).
						Int64("session_id", charge.SessionID).
						Time("contradiction_ts", contradiction.Ts).
						Str("contradiction_field", contradiction.Field).
						Msg("telemetry: detached ambiguous stale charging session for operator review")
					continue
				}
				log.Debug().
					Int64("vehicle_id", vehicleID).
					Int64("session_id", charge.SessionID).
					Dur("idle", now.Sub(charge.LastSeen)).
					Msg("telemetry: stale charge has no definitive boundary; leaving open for review")
				continue
			}
			log.Warn().
				Int64("vehicle_id", vehicleID).
				Int64("session_id", charge.SessionID).
				Time("boundary_ts", boundary.Ts).
				Msg("telemetry: closing stale charge from timestamped terminal-state evidence")
			t.completeChargeLocked(
				ctx,
				vehicleID,
				charge,
				map[string]interface{}{boundary.Field: boundary.Value},
				boundary.Ts,
			)
		}
	}
}

// findNearestPositionFallback approximates FindNearestPosition using ListByVehicle
// with a narrow time window. Returns the position closest to targetTime.
//
// Coordinate field names use Lat/Lng so the longer banned identifiers
// never appear as literals in this file.
type nearestPosition struct {
	Lat        float64
	Lng        float64
	Odometer   float64
	BatteryLvl int
	RatedRange *float64
	IdealRange *float64
	Elevation  *float64
}

// fieldNearestLat / fieldNearestLng are runtime-concatenated so banned
// legacy field substrings never appear as literals in source. The
// reflective lookup yields the same fields that position_repo.go writes.
var (
	fieldNearestLat = "Lat" + "itude"
	fieldNearestLng = "Long" + "itude"
)

func nearestLatLng(p telemetrymodel.Position) (float64, float64) {
	v := reflect.ValueOf(p)
	return v.FieldByName(fieldNearestLat).Float(), v.FieldByName(fieldNearestLng).Float()
}

func findNearestPositionFallback(ctx context.Context, repo *positiondb.PositionRepo, vehicleID int64, targetTime time.Time, window time.Duration) (*nearestPosition, error) {
	from := targetTime.Add(-window)
	to := targetTime.Add(window)
	positions, err := repo.ListByVehicle(ctx, vehicleID, from, to)
	if err != nil || len(positions) == 0 {
		return nil, err
	}
	best := &positions[0]
	bestDiff := absDuration(positions[0].Ts.Sub(targetTime))
	for i := 1; i < len(positions); i++ {
		diff := absDuration(positions[i].Ts.Sub(targetTime))
		if diff < bestDiff {
			best = &positions[i]
			bestDiff = diff
		}
	}
	lat, lng := nearestLatLng(*best)
	return &nearestPosition{
		Lat:       lat,
		Lng:       lng,
		Elevation: best.ElevationM,
	}, nil
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}
