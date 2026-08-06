package ownershipintel

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
	"github.com/jackc/pgx/v5"
)

// datasetTimeColumns is the closed registry of governable datasets and the
// column each one is aged by. Keeping this in the adapter — not in a request —
// is what stops a retention policy from ever naming an arbitrary relation.
var datasetTimeColumns = map[string]string{
	"signal_log":              "ts",
	"positions":               "ts",
	"climate_snapshots":       "ts",
	"security_events":         "ts",
	"tire_pressure_snapshots": "ts",
	"motor_snapshots":         "ts",
	"media_snapshots":         "ts",
	"drives":                  "started_at",
	"charging_sessions":       "started_at",
	"notification_logs":       "created_at",
	"alerts":                  "created_at",
	"audit_logs":              "ts",
}

// SourceRepository reads telemetry-derived evidence. It never writes.
type SourceRepository struct {
	q database.DBTX
}

// NewSourceRepository builds the read-only evidence adapter.
func NewSourceRepository(db *database.DB) *SourceRepository {
	if db == nil || db.Pool == nil {
		panic("ownershipintel.NewSourceRepository: db and db.Pool must not be nil")
	}
	return &SourceRepository{q: db.Pool}
}

// ListDrives returns completed drives inside the window in SI canonical units.
func (r *SourceRepository) ListDrives(
	ctx context.Context,
	vehicleID int64,
	from, to time.Time,
) ([]port.DriveRecord, error) {
	const query = `
		SELECT id, started_at, ended_at, distance_m, duration_s,
		       energy_used_wh, regen_energy_wh, avg_speed_mps, max_speed_mps,
		       avg_power_w, peak_power_w, ambient_temp_c_avg,
		       start_lat, start_lng, end_lat, end_lng,
		       start_odometer_m, end_odometer_m,
		       COALESCE(start_place, ''), COALESCE(end_place, '')
		FROM drives
		WHERE vehicle_id = $1
		  AND started_at >= $2
		  AND started_at < $3
		  AND ended_at IS NOT NULL
		ORDER BY started_at ASC
		LIMIT 20000`
	rows, err := r.q.Query(ctx, query, vehicleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("query drives: %w", err)
	}
	defer rows.Close()

	drives := make([]port.DriveRecord, 0)
	for rows.Next() {
		var drive port.DriveRecord
		if err := rows.Scan(
			&drive.ID,
			&drive.StartedAt,
			&drive.EndedAt,
			&drive.DistanceM,
			&drive.DurationS,
			&drive.EnergyUsedWh,
			&drive.RegenEnergyWh,
			&drive.AvgSpeedMps,
			&drive.MaxSpeedMps,
			&drive.AvgPowerW,
			&drive.PeakPowerW,
			&drive.AmbientTempC,
			&drive.StartLat,
			&drive.StartLng,
			&drive.EndLat,
			&drive.EndLng,
			&drive.StartOdometerM,
			&drive.EndOdometerM,
			&drive.StartPlace,
			&drive.EndPlace,
		); err != nil {
			return nil, fmt.Errorf("scan drive: %w", err)
		}
		drives = append(drives, drive)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate drives: %w", err)
	}
	return drives, nil
}

// ListCharges returns charging sessions inside the window with money already
// normalised to ISO-4217 minor units.
func (r *SourceRepository) ListCharges(
	ctx context.Context,
	vehicleID int64,
	from, to time.Time,
) ([]port.ChargeRecord, error) {
	const query = `
		SELECT id, started_at, ended_at, total_energy_added_wh,
		       peak_power_w, avg_power_w, delta_soc_pct,
		       CASE WHEN cost_decimal IS NULL THEN NULL
		            ELSE ROUND(cost_decimal * 100)::bigint END,
		       COALESCE(cost_currency, ''),
		       COALESCE(charger_type, ''),
		       COALESCE(start_place, ''),
		       start_lat, start_lng
		FROM charging_sessions
		WHERE vehicle_id = $1
		  AND started_at >= $2
		  AND started_at < $3
		ORDER BY started_at ASC
		LIMIT 20000`
	rows, err := r.q.Query(ctx, query, vehicleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("query charging sessions: %w", err)
	}
	defer rows.Close()

	charges := make([]port.ChargeRecord, 0)
	for rows.Next() {
		var charge port.ChargeRecord
		if err := rows.Scan(
			&charge.ID,
			&charge.StartedAt,
			&charge.EndedAt,
			&charge.EnergyAddedWh,
			&charge.PeakPowerW,
			&charge.AvgPowerW,
			&charge.DeltaSOCPct,
			&charge.CostMinor,
			&charge.CostCurrency,
			&charge.ChargerType,
			&charge.StartPlace,
			&charge.StartLat,
			&charge.StartLng,
		); err != nil {
			return nil, fmt.Errorf("scan charging session: %w", err)
		}
		charges = append(charges, charge)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate charging sessions: %w", err)
	}
	return charges, nil
}

// VehicleSnapshot derives odometer and battery-retention context. The vehicles
// table carries neither, so both are reconstructed from measured evidence.
func (r *SourceRepository) VehicleSnapshot(ctx context.Context, vehicleID int64) (*port.VehicleSnapshot, error) {
	const query = `
		WITH odo AS (
		    SELECT MAX(end_odometer_m)   AS latest_m,
		           MIN(start_odometer_m) AS earliest_m,
		           MIN(started_at)       AS first_at,
		           MAX(started_at)       AS last_at
		    FROM drives
		    WHERE vehicle_id = $1 AND end_odometer_m IS NOT NULL
		),
		cap AS (
		    SELECT started_at,
		           total_energy_added_wh * 100.0 / NULLIF(delta_soc_pct, 0) AS usable_wh
		    FROM charging_sessions
		    WHERE vehicle_id = $1
		      AND delta_soc_pct >= 20
		      AND total_energy_added_wh > 0
		),
		baseline AS (
		    SELECT AVG(usable_wh) AS wh FROM (
		        SELECT usable_wh FROM cap ORDER BY started_at ASC LIMIT 10
		    ) early
		),
		recent AS (
		    SELECT AVG(usable_wh) AS wh FROM (
		        SELECT usable_wh FROM cap ORDER BY started_at DESC LIMIT 10
		    ) late
		)
		SELECT v.id,
		       COALESCE(v.display_name, ''),
		       COALESCE(v.vin, ''),
		       v.enrolled_at,
		       odo.latest_m,
		       odo.earliest_m,
		       odo.first_at,
		       odo.last_at,
		       baseline.wh,
		       recent.wh,
		       (SELECT COUNT(*)::int FROM cap)
		FROM vehicles v
		CROSS JOIN odo
		CROSS JOIN baseline
		CROSS JOIN recent
		WHERE v.id = $1`
	var snapshot port.VehicleSnapshot
	err := r.q.QueryRow(ctx, query, vehicleID).Scan(
		&snapshot.VehicleID,
		&snapshot.DisplayName,
		&snapshot.VIN,
		&snapshot.EnrolledAt,
		&snapshot.OdometerM,
		&snapshot.FirstOdometerM,
		&snapshot.FirstObservedAt,
		&snapshot.LastObservedAt,
		&snapshot.BaselineCapacityWh,
		&snapshot.RecentCapacityWh,
		&snapshot.CapacitySamples,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("query vehicle snapshot: %w", err)
	}
	return &snapshot, nil
}

// DatasetStats reads live row counts and on-disk footprints from the catalog,
// including TimescaleDB chunk totals for hypertables.
func (r *SourceRepository) DatasetStats(ctx context.Context, datasets []string) ([]port.DatasetStat, error) {
	stats := make([]port.DatasetStat, 0, len(datasets))
	for _, dataset := range datasets {
		timeColumn, ok := datasetTimeColumns[dataset]
		if !ok {
			continue
		}
		stat := port.DatasetStat{Dataset: dataset}
		const sizeQuery = `
			SELECT COALESCE(pg_total_relation_size(c.oid), 0)::bigint,
			       EXISTS (
			           SELECT 1 FROM timescaledb_information.hypertables h
			           WHERE h.hypertable_schema = 'public' AND h.hypertable_name = c.relname
			       )
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind = 'r'`
		err := r.q.QueryRow(ctx, sizeQuery, dataset).Scan(&stat.TotalBytes, &stat.IsHypertable)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("query size of %s: %w", dataset, err)
		}
		if stat.IsHypertable {
			var chunkBytes *int64
			const chunkQuery = `
				SELECT SUM(total_bytes)::bigint
				FROM timescaledb_information.chunks ch
				JOIN LATERAL (
				    SELECT pg_total_relation_size(
				        format('%I.%I', ch.chunk_schema, ch.chunk_name)::regclass
				    ) AS total_bytes
				) sizes ON TRUE
				WHERE ch.hypertable_schema = 'public' AND ch.hypertable_name = $1`
			if err := r.q.QueryRow(ctx, chunkQuery, dataset).Scan(&chunkBytes); err == nil && chunkBytes != nil {
				stat.TotalBytes += *chunkBytes
			}
		}
		// The time column comes from a closed in-process registry, never from
		// user input, so interpolating it here cannot be an injection vector.
		countQuery := fmt.Sprintf(
			`SELECT COUNT(*)::bigint, MIN(%[1]s), MAX(%[1]s) FROM %[2]s`,
			pgx.Identifier{timeColumn}.Sanitize(),
			pgx.Identifier{dataset}.Sanitize(),
		)
		if err := r.q.QueryRow(ctx, countQuery).Scan(&stat.RowCount, &stat.OldestAt, &stat.NewestAt); err != nil {
			return nil, fmt.Errorf("count rows of %s: %w", dataset, err)
		}
		stats = append(stats, stat)
	}
	return stats, nil
}

// DatasetExpiry counts how many rows a retention policy would touch. It only
// ever reads — no row is modified by this call.
func (r *SourceRepository) DatasetExpiry(
	ctx context.Context,
	dataset string,
	cutoff, downsampleCutoff time.Time,
) (int64, int64, int64, error) {
	timeColumn, ok := datasetTimeColumns[dataset]
	if !ok {
		return 0, 0, 0, fmt.Errorf("dataset %q is not governable", dataset)
	}
	query := fmt.Sprintf(`
		SELECT COUNT(*)::bigint,
		       COUNT(*) FILTER (WHERE %[1]s < $1)::bigint,
		       COUNT(*) FILTER (WHERE %[1]s >= $1 AND %[1]s < $2)::bigint
		FROM %[2]s`,
		pgx.Identifier{timeColumn}.Sanitize(),
		pgx.Identifier{dataset}.Sanitize(),
	)
	var scanned, expiring, downsampling int64
	if err := r.q.QueryRow(ctx, query, cutoff, downsampleCutoff).Scan(&scanned, &expiring, &downsampling); err != nil {
		return 0, 0, 0, fmt.Errorf("count expiry of %s: %w", dataset, err)
	}
	return scanned, expiring, downsampling, nil
}
