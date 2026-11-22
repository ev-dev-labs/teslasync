package smartreadiness

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

var _ port.SitePerformanceRepository = (*Repository)(nil)

const activeSitePerformanceScope = `
	FROM smart_charging_site_performance p
	JOIN vehicles v ON v.id = p.vehicle_id AND v.archived_at IS NULL
	JOIN geofences g ON g.id = p.place_id AND g.enabled AND NOT g.needs_review
	  AND g.archived_at IS NULL AND g.is_charging_location AND g.updated_at = p.place_updated_at`

func (r *Repository) ListSitePerformanceScopes(ctx context.Context, subject string, vehicleID *int64, limit int) ([]domain.SitePerformanceScope, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT p.place_id, g.name, p.vehicle_id, v.display_name, p.place_updated_at, p.enabled_at
	`+activeSitePerformanceScope+`
		WHERE p.subject = $1 AND ($2::bigint IS NULL OR p.vehicle_id = $2)
		ORDER BY p.enabled_at DESC, p.vehicle_id LIMIT $3`, subject, vehicleID, limit)
	if err != nil {
		return nil, fmt.Errorf("list site performance opt-ins: %w", err)
	}
	result, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.SitePerformanceScope, error) {
		var scope domain.SitePerformanceScope
		err := row.Scan(&scope.PlaceID, &scope.PlaceName, &scope.VehicleID, &scope.VehicleName, &scope.PlaceUpdatedAt, &scope.EnabledAt)
		return scope, err
	})
	if err != nil {
		return nil, fmt.Errorf("read site performance opt-ins: %w", err)
	}
	return result, nil
}

func (r *Repository) SaveSitePerformanceScope(ctx context.Context, subject string, vehicleID int64, placeID *int64, now time.Time) error {
	if placeID == nil {
		if _, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_charging_site_performance WHERE subject = $1 AND vehicle_id = $2`, subject, vehicleID); err != nil {
			return fmt.Errorf("revoke site performance opt-in: %w", err)
		}
		return nil
	}
	tag, err := r.db.Pool.Exec(ctx, `
		INSERT INTO smart_charging_site_performance(subject, vehicle_id, place_id, place_updated_at, enabled_at)
		SELECT $1, v.id, g.id, g.updated_at, $4
		FROM vehicles v JOIN geofences g ON g.id = $3
		WHERE v.id = $2 AND v.archived_at IS NULL AND g.enabled
		  AND NOT g.needs_review AND g.archived_at IS NULL AND g.is_charging_location
		ON CONFLICT (subject, vehicle_id) DO UPDATE SET
		  place_id = EXCLUDED.place_id, place_updated_at = EXCLUDED.place_updated_at, enabled_at = EXCLUDED.enabled_at`,
		subject, vehicleID, *placeID, now)
	if err != nil {
		return fmt.Errorf("save site performance opt-in: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return port.ErrNotFound
	}
	return nil
}

func (r *Repository) ListSitePerformanceSessions(
	ctx context.Context, subject string, scope domain.SitePerformanceScope, now time.Time,
) ([]domain.SitePerformanceSession, error) {
	rows, err := r.db.Pool.Query(ctx, `
		WITH sessions AS MATERIALIZED (
			SELECT c.id, c.vehicle_id, c.started_at, c.ended_at, c.start_soc_pct, c.end_soc_pct,
			  c.charger_type, c.cable_type, c.start_lat, c.start_lng
		`+activeSitePerformanceScope+`
			JOIN charging_sessions c ON c.vehicle_id = p.vehicle_id AND c.geofence_id = p.place_id
			WHERE p.subject = $1 AND p.vehicle_id = $2 AND p.place_id = $3 AND p.enabled_at = $4
			  AND smart_feature_allowed(p.subject,'site_performance')
			  AND p.place_updated_at = $5 AND c.started_at >= $6::timestamptz - INTERVAL '91 days'
			  AND c.ended_at <= $6 AND c.ended_at > c.started_at
			ORDER BY c.ended_at DESC, c.id DESC LIMIT 32
		)`+measuredSessionMeters, subject, scope.VehicleID, scope.PlaceID, scope.EnabledAt, scope.PlaceUpdatedAt, now)
	if err != nil {
		return nil, fmt.Errorf("query measured site performance sessions: %w", err)
	}
	return readMeasuredSessions(rows)
}

func (r *Repository) ListChargeRemedySessions(
	ctx context.Context, candidate port.Candidate, now time.Time,
) ([]domain.SitePerformanceSession, error) {
	p := candidate.Plan
	rows, err := r.db.Pool.Query(ctx, `
		WITH sessions AS MATERIALIZED (
			SELECT c.id, c.vehicle_id, c.started_at, c.ended_at, c.start_soc_pct, c.end_soc_pct,
			       c.charger_type, c.cable_type, c.start_lat, c.start_lng
			FROM smart_charging_plans p
			JOIN vehicles v ON v.id = p.vehicle_id AND v.archived_at IS NULL
			JOIN geofences g ON g.id = p.charging_place_id AND g.enabled AND NOT g.needs_review
			  AND g.archived_at IS NULL AND g.is_charging_location AND g.updated_at = $5
			JOIN charging_sessions c ON c.vehicle_id = p.vehicle_id AND c.geofence_id = p.charging_place_id
			WHERE p.id = $1 AND p.subject = $2 AND p.vehicle_id = $3 AND p.version = $4
			  AND p.enabled AND p.notify_at <= $6 AND p.departure_at > $6::timestamptz + INTERVAL '30 minutes'
			  AND (p.snoozed_until IS NULL OR p.snoozed_until <= $6)
			  AND c.started_at >= $6::timestamptz - INTERVAL '14 days'
			  AND c.ended_at <= $6 AND c.ended_at > c.started_at
			ORDER BY c.ended_at DESC, c.id DESC LIMIT 2
		)`+measuredSessionMeters, p.ID, p.Subject, p.VehicleID, p.Version, candidate.PlaceUpdatedAt, now)
	if err != nil {
		return nil, fmt.Errorf("query measured charging remedy sessions: %w", err)
	}
	return readMeasuredSessions(rows)
}

const measuredSessionMeters = `
		SELECT s.id, s.started_at, s.ended_at, COALESCE(s.start_soc_pct, -1), COALESCE(s.end_soc_pct, -1),
		       COALESCE(s.charger_type, ''), COALESCE(s.cable_type, ''), COALESCE(meter_wh, 0),
		       s.start_lat, s.start_lng
		FROM sessions s
		LEFT JOIN LATERAL (
			WITH steps AS (
				SELECT m.kind, t.ts, m.wh,
				       LAG(m.wh) OVER (PARTITION BY m.kind ORDER BY t.ts) AS prior_wh,
				       LAG(t.ts) OVER (PARTITION BY m.kind ORDER BY t.ts) AS prior_at
				FROM charging_telemetry t
				CROSS JOIN LATERAL (VALUES ('ac', t.ac_charging_energy_in_wh), ('dc', t.dc_charging_energy_in_wh)) m(kind, wh)
				WHERE t.session_id = s.id AND t.vehicle_id = s.vehicle_id AND t.ts BETWEEN s.started_at AND s.ended_at
				  AND s.ended_at - s.started_at <= INTERVAL '24 hours' AND m.wh IS NOT NULL
			), channels AS (
				SELECT MAX(wh) - MIN(wh) AS delta_wh
				FROM steps GROUP BY kind
				HAVING COUNT(*) >= 3 AND MIN(wh) >= 0 AND MAX(wh) < 'Infinity'::float8
				  AND MIN(ts) <= s.started_at + INTERVAL '5 minutes'
				  AND MAX(ts) >= s.ended_at - INTERVAL '5 minutes'
				  AND BOOL_AND(prior_wh IS NULL OR (wh >= prior_wh AND ts - prior_at <= INTERVAL '10 minutes'))
				  AND MAX(wh) > MIN(wh)
			)
			SELECT MIN(delta_wh) AS meter_wh FROM channels HAVING COUNT(*) = 1
		) meter ON true
		ORDER BY s.ended_at DESC, s.id DESC`

func readMeasuredSessions(rows pgx.Rows) ([]domain.SitePerformanceSession, error) {
	result, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.SitePerformanceSession, error) {
		var session domain.SitePerformanceSession
		err := row.Scan(&session.ID, &session.StartedAt, &session.EndedAt, &session.StartSocPct, &session.EndSocPct,
			&session.Charger, &session.Cable, &session.DeliveredWh, &session.StartLatitude, &session.StartLongitude)
		return session, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan measured charging sessions: %w", err)
	}
	return result, nil
}
