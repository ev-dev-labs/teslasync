// Package activity composes the unified vehicle operations-intelligence
// timeline from existing domain tables. It intentionally has no table of
// its own — every row is projected, at query time, from drives,
// charging_sessions, notification_logs (+ alert_rules / alert_rule_vehicles),
// software_updates, and chart_annotations via a single UNION ALL query so
// the API stays free of N+1 fan-out.
package activity

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	activitymodel "github.com/ev-dev-labs/teslasync/internal/models/activity"
)

// Filters scopes a single activity query. Start/End use the zero time.Time
// to mean "unbounded" (mirrors apiparams.ParseDateRange / NullableTime).
// Kinds empty means "all kinds" (activitymodel.AllKinds).
type Filters struct {
	VehicleID *int64
	Start     time.Time
	End       time.Time
	Kinds     []activitymodel.Kind
	Limit     int
	Offset    int
}

// Repo composes the activity timeline. Constructed with NewRepo.
type Repo struct {
	db *database.DB
}

func NewRepo(db *database.DB) *Repo {
	return &Repo{db: db}
}

// subquery is one UNION ALL branch. Every branch MUST project the exact
// same 15 columns, in this order:
//
//	source_table text, source_id bigint, kind text, occurred_at timestamptz,
//	vehicle_id bigint, title text, summary text, severity text, status text,
//	path text, duration_s bigint, start_soc_pct double precision,
//	end_soc_pct double precision, energy_added_wh double precision, version text
//
// All five branches share the same three bind parameters:
//
//	$1 vehicle_id filter (bigint, NULL = unscoped)
//	$2 start      filter (timestamptz, NULL = unbounded)
//	$3 end        filter (timestamptz, NULL = unbounded)
//
// Re-using the same placeholders across branches (rather than allocating a
// fresh one per branch) keeps the query readable and is valid pgx usage —
// a bound value may appear at any number of placeholder positions.
var subqueriesByKind = map[activitymodel.Kind]string{
	activitymodel.KindDrive: `
SELECT
  'drives'::text AS source_table,
  d.id AS source_id,
  'drive'::text AS kind,
  d.started_at AS occurred_at,
  d.vehicle_id AS vehicle_id,
  ''::text AS title,
  ''::text AS summary,
  NULL::text AS severity,
  (CASE WHEN d.ended_at IS NULL THEN 'in_progress' ELSE 'completed' END) AS status,
  ('/drives/' || d.id::text) AS path,
  d.duration_s AS duration_s,
  d.start_soc_pct::double precision AS start_soc_pct,
  d.end_soc_pct::double precision AS end_soc_pct,
  NULL::double precision AS energy_added_wh,
  NULL::text AS version
FROM drives d
WHERE ($1::bigint IS NULL OR d.vehicle_id = $1::bigint)
  AND ($2::timestamptz IS NULL OR d.started_at >= $2::timestamptz)
  AND ($3::timestamptz IS NULL OR d.started_at <= $3::timestamptz)`,

	activitymodel.KindCharging: `
SELECT
  'charging_sessions'::text AS source_table,
  c.id AS source_id,
  'charging'::text AS kind,
  c.started_at AS occurred_at,
  c.vehicle_id AS vehicle_id,
  ''::text AS title,
  ''::text AS summary,
  NULL::text AS severity,
  (CASE WHEN c.ended_at IS NULL THEN 'in_progress' ELSE 'completed' END) AS status,
  ('/charging/' || c.id::text) AS path,
  CASE WHEN c.ended_at IS NULL
       THEN NULL::bigint
       ELSE ROUND(EXTRACT(EPOCH FROM (c.ended_at - c.started_at)))::bigint
  END AS duration_s,
  c.start_soc_pct::double precision AS start_soc_pct,
  c.end_soc_pct::double precision AS end_soc_pct,
  c.total_energy_added_wh::double precision AS energy_added_wh,
  NULL::text AS version
FROM charging_sessions c
WHERE ($1::bigint IS NULL OR c.vehicle_id = $1::bigint)
  AND ($2::timestamptz IS NULL OR c.started_at >= $2::timestamptz)
  AND ($3::timestamptz IS NULL OR c.started_at <= $3::timestamptz)`,

	// Vehicle scoping mirrors buildNotificationLogWhere in
	// internal/database/notification/repo.go: a rule with no alert_id, an
	// alert_id whose rule no longer exists, or a rule marked all_vehicles
	// is visible regardless of the requested vehicle. vehicle_id in the
	// projected row is the selected vehicle when scoped, the sole target
	// when a rule has exactly one target, and NULL for fleet/multi-vehicle
	// rules. This avoids attributing a multi-vehicle alert to an arbitrary
	// first junction row.
	activitymodel.KindAlert: `
SELECT
  'notification_logs'::text AS source_table,
  nl.id AS source_id,
  'alert'::text AS kind,
  nl.created_at AS occurred_at,
  CASE
    WHEN $1::bigint IS NOT NULL AND ar.id IS NOT NULL THEN $1::bigint
    WHEN ar.id IS NULL OR ar.all_vehicles THEN NULL::bigint
    ELSE (
      SELECT CASE WHEN COUNT(*) = 1 THEN MIN(arv.vehicle_id) ELSE NULL::bigint END
      FROM alert_rule_vehicles arv
      WHERE arv.rule_id = ar.id
    )
  END AS vehicle_id,
  nl.title AS title,
  LEFT(nl.message, 240) AS summary,
  COALESCE(NULLIF(nl.severity, ''), ar.severity, 'info') AS severity,
  nl.status AS status,
  '/notifications/inbox'::text AS path,
  NULL::bigint AS duration_s,
  NULL::double precision AS start_soc_pct,
  NULL::double precision AS end_soc_pct,
  NULL::double precision AS energy_added_wh,
  NULL::text AS version
FROM notification_logs nl
LEFT JOIN alert_rules ar ON ar.id = nl.alert_id
WHERE ($2::timestamptz IS NULL OR nl.created_at >= $2::timestamptz)
  AND ($3::timestamptz IS NULL OR nl.created_at <= $3::timestamptz)
  AND ($1::bigint IS NULL OR ar.id IS NULL OR ar.all_vehicles OR EXISTS (
        SELECT 1 FROM alert_rule_vehicles arv2
        WHERE arv2.rule_id = ar.id AND arv2.vehicle_id = $1::bigint
      ))`,

	activitymodel.KindSoftwareUpdate: `
SELECT
  'software_updates'::text AS source_table,
  su.id AS source_id,
  'software_update'::text AS kind,
  COALESCE(su.installed_at, su.scheduled_at, su.created_at) AS occurred_at,
  su.vehicle_id AS vehicle_id,
  ''::text AS title,
  ''::text AS summary,
  NULL::text AS severity,
  su.status AS status,
  '/software-updates'::text AS path,
  NULL::bigint AS duration_s,
  NULL::double precision AS start_soc_pct,
  NULL::double precision AS end_soc_pct,
  NULL::double precision AS energy_added_wh,
  su.version::text AS version
FROM software_updates su
WHERE ($1::bigint IS NULL OR su.vehicle_id = $1::bigint)
  AND ($2::timestamptz IS NULL OR COALESCE(su.installed_at, su.scheduled_at, su.created_at) >= $2::timestamptz)
  AND ($3::timestamptz IS NULL OR COALESCE(su.installed_at, su.scheduled_at, su.created_at) <= $3::timestamptz)`,

	// Vehicle scoping is inclusive of fleet-wide rows (vehicle_id IS NULL),
	// matching the existing /annotations list semantics
	// (internal/api/chartannotation).
	activitymodel.KindAnnotation: `
SELECT
  'chart_annotations'::text AS source_table,
  ca.id AS source_id,
  'annotation'::text AS kind,
  ca.occurred_at AS occurred_at,
  ca.vehicle_id AS vehicle_id,
  ca.title AS title,
  LEFT(COALESCE(ca.description, ''), 240) AS summary,
  NULL::text AS severity,
  ca.category::text AS status,
  NULL::text AS path,
  NULL::bigint AS duration_s,
  NULL::double precision AS start_soc_pct,
  NULL::double precision AS end_soc_pct,
  NULL::double precision AS energy_added_wh,
  NULL::text AS version
FROM chart_annotations ca
WHERE ($1::bigint IS NULL OR ca.vehicle_id = $1::bigint OR ca.vehicle_id IS NULL)
  AND ($2::timestamptz IS NULL OR ca.occurred_at >= $2::timestamptz)
  AND ($3::timestamptz IS NULL OR ca.occurred_at <= $3::timestamptz)`,
}

// buildQuery composes the WITH ... UNION ALL ... SELECT query for the
// requested kinds (defaulting to all of them), returning the SQL and the
// positional args ($1 vehicle_id, $2 start, $3 end, $4 limit, $5 offset).
func buildQuery(f Filters) (string, []any) {
	kinds := f.Kinds
	if len(kinds) == 0 {
		kinds = activitymodel.AllKinds
	}

	branches := make([]string, 0, len(kinds))
	for _, k := range kinds {
		if sub, ok := subqueriesByKind[k]; ok {
			branches = append(branches, sub)
		}
	}
	if len(branches) == 0 {
		// No recognized kind survived filtering — return a query shape that
		// is valid SQL but selects nothing, rather than a run-time error.
		branches = append(branches, `SELECT
  ''::text, 0::bigint, ''::text, now(), NULL::bigint, ''::text, ''::text,
  NULL::text, ''::text, NULL::text, NULL::bigint, NULL::double precision,
  NULL::double precision, NULL::double precision, NULL::text
WHERE FALSE`)
	}

	var vehicleIDArg any
	if f.VehicleID != nil {
		vehicleIDArg = *f.VehicleID
	}
	var startArg, endArg any
	if !f.Start.IsZero() {
		startArg = f.Start.UTC()
	}
	if !f.End.IsZero() {
		endArg = f.End.UTC()
	}

	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}

	query := "WITH activity AS (" + strings.Join(branches, "\nUNION ALL\n") + `
)
SELECT source_table, source_id, kind, occurred_at, vehicle_id, title, summary, severity, status, path,
       duration_s, start_soc_pct, end_soc_pct, energy_added_wh, version,
       count(*) OVER() AS total_count
FROM activity
ORDER BY occurred_at DESC, source_table ASC, source_id DESC
LIMIT $4 OFFSET $5`

	return query, []any{vehicleIDArg, startArg, endArg, limit, offset}
}

// List runs the composed activity query and returns the page of items plus
// the total row count matching the filters (pre-pagination), computed via
// a single COUNT(*) OVER() window so no second round trip is needed.
func (r *Repo) List(ctx context.Context, f Filters) ([]activitymodel.Item, int64, error) {
	query, args := buildQuery(f)

	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("query activity timeline: %w", err)
	}
	defer rows.Close()

	items := make([]activitymodel.Item, 0)
	var total int64
	for rows.Next() {
		var it activitymodel.Item
		var severity, path *string
		if err := rows.Scan(
			&it.SourceTable, &it.SourceID, &it.Kind, &it.OccurredAt, &it.VehicleID,
			&it.Title, &it.Summary, &severity, &it.Status, &path,
			&it.DurationS, &it.StartSocPct, &it.EndSocPct, &it.EnergyAddedWh, &it.Version,
			&total,
		); err != nil {
			return nil, 0, fmt.Errorf("scan activity row: %w", err)
		}
		it.Severity = severity
		it.Path = path
		it.ID = it.SourceTable + ":" + fmt.Sprint(it.SourceID)
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate activity rows: %w", err)
	}
	return items, total, nil
}
