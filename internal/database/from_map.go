package database

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

// insertRowFromMap performs a parameterized INSERT into `table` using the keys
// of `row` as column names. Identity columns vehicle_id/ts are prepended.
//
// Caller MUST ensure all map keys are valid SQL identifiers; in this codebase
// the keys are sourced from telemetry.HotRoute.Column declarations which are
// authored against the schema.
func insertRowFromMap(ctx context.Context, db *DB, table string, vehicleID int64, ts time.Time, row map[string]any) error {
	if len(row) == 0 {
		return nil
	}
	keys := sortedKeys(row)
	cols := make([]string, 0, len(keys)+2)
	vals := make([]any, 0, len(keys)+2)
	cols = append(cols, "vehicle_id", "ts")
	vals = append(vals, vehicleID, ts)
	for _, k := range keys {
		cols = append(cols, k)
		vals = append(vals, row[k])
	}
	placeholders := make([]string, len(cols))
	for i := range cols {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
	}
	q := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", table,
		strings.Join(cols, ","), strings.Join(placeholders, ","))
	if _, err := db.Pool.Exec(ctx, q, vals...); err != nil {
		return fmt.Errorf("insert %s from map: %w", table, err)
	}
	return nil
}

// upsertLiveStateFromMap performs the vehicle_live_state per-domain merge
// dynamically. Value columns use COALESCE(EXCLUDED, existing) so a partial
// batch (e.g. climate-only) never blanks fields owned by other domains.
// Columns suffixed with `_last_updated_at` advance via GREATEST so a late
// batch cannot regress the per-domain freshness watermark (ADR-002).
func upsertLiveStateFromMap(ctx context.Context, db *DB, vehicleID int64, _ time.Time, row map[string]any) error {
	if len(row) == 0 {
		return nil
	}
	keys := sortedKeys(row)
	cols := make([]string, 0, len(keys)+1)
	vals := make([]any, 0, len(keys)+1)
	cols = append(cols, "vehicle_id")
	vals = append(vals, vehicleID)
	for _, k := range keys {
		cols = append(cols, k)
		vals = append(vals, row[k])
	}
	placeholders := make([]string, len(cols))
	for i := range cols {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
	}
	setClauses := make([]string, 0, len(keys)+1)
	for _, k := range keys {
		if strings.HasSuffix(k, "_last_updated_at") {
			setClauses = append(setClauses,
				fmt.Sprintf("%s = GREATEST(vehicle_live_state.%s, EXCLUDED.%s)", k, k, k))
		} else {
			setClauses = append(setClauses,
				fmt.Sprintf("%s = COALESCE(EXCLUDED.%s, vehicle_live_state.%s)", k, k, k))
		}
	}
	setClauses = append(setClauses, "updated_at = now()")
	q := fmt.Sprintf(
		"INSERT INTO vehicle_live_state (%s) VALUES (%s) ON CONFLICT (vehicle_id) DO UPDATE SET %s",
		strings.Join(cols, ","), strings.Join(placeholders, ","), strings.Join(setClauses, ", "))
	if _, err := db.Pool.Exec(ctx, q, vals...); err != nil {
		return fmt.Errorf("upsert vehicle_live_state from map: %w", err)
	}
	return nil
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// --- Per-repo bulk entry points for the map-based write path (Phase 6 fan-out).
//
// Each wrapper delegates to the shared insertRowFromMap helper bound to the
// repo's table. They are the single map-based bulk entry point per repo so
// the telemetry handler dispatch can route by table name without leaking SQL.

func (r *PositionRepo) InsertFromMap(ctx context.Context, vehicleID int64, ts time.Time, row map[string]any) error {
	return insertRowFromMap(ctx, r.db, "positions", vehicleID, ts, row)
}

func (r *ChargingTelemetryRepo) InsertFromMap(ctx context.Context, vehicleID int64, ts time.Time, row map[string]any) error {
	return insertRowFromMap(ctx, r.db, "charging_telemetry", vehicleID, ts, row)
}

func (r *ClimateRepo) InsertFromMap(ctx context.Context, vehicleID int64, ts time.Time, row map[string]any) error {
	return insertRowFromMap(ctx, r.db, "climate_snapshots", vehicleID, ts, row)
}

func (r *MotorRepo) InsertFromMap(ctx context.Context, vehicleID int64, ts time.Time, row map[string]any) error {
	return insertRowFromMap(ctx, r.db, "motor_snapshots", vehicleID, ts, row)
}

func (r *SecurityRepo) InsertFromMap(ctx context.Context, vehicleID int64, ts time.Time, row map[string]any) error {
	return insertRowFromMap(ctx, r.db, "security_events", vehicleID, ts, row)
}

func (r *VehicleMetaRepo) InsertFromMap(ctx context.Context, vehicleID int64, ts time.Time, row map[string]any) error {
	return insertRowFromMap(ctx, r.db, "vehicle_meta_snapshots", vehicleID, ts, row)
}

func (r *VehicleLiveStateRepo) UpsertFromMap(ctx context.Context, vehicleID int64, ts time.Time, row map[string]any) error {
	return upsertLiveStateFromMap(ctx, r.db, vehicleID, ts, row)
}
