// Package database — SignalsCatalogRepo backs the restored
// /signals/catalog + /signals/observations endpoints.
//
// Phase-43a / Prompt 0007. Phase-42 prompt 0077 deleted both endpoints
// alongside signal_catalog_handler.go; the typed signal_log hypertable
// from mig 000186 (recreated by phase-42) is the new source of truth.
//
// Catalog spine: routing.yaml entries provide the static "field +
// destination + value_kind" rows. signal_log aggregates provide the
// dynamic last_seen_at + counts via a single GROUP BY query. The
// handler merges the two — entries without aggregates appear with
// NULL last_seen_at (routed but unobserved).
//
// Observations: per-request paged scan over signal_log with optional
// filters on vehicle_id, field, since, until. The handler pulls the
// populated typed column out per row using value_kind as discriminator
// (per mig 000186 lines 79-89): str_value / bool_value / int_value /
// float_value / time_value.
//
// All queries scope to signal_log only — no vehicles JOIN. The
// vehicles existence check is handled implicitly by the empty result
// when filtering by an unknown vehicle_id, mirroring the 200 + empty
// pattern from the existing /signals/{vehicleID}/available endpoint
// (an admin's catalog/observations probe never carries a 404 risk
// because the catalog is fleet-wide and the observations endpoint is
// optional-filter, not required-filter).
package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CatalogAggregate is the per-field signal_log aggregate row joined
// against the routing.yaml spine in the handler. All three counters
// are NULL for fields routed but never observed (LEFT JOIN
// fall-through in Go).
type CatalogAggregate struct {
	LastSeenAt       *time.Time
	SampleCountTotal int64
	VehicleCount     int64
}

// SignalObservation is one row from /signals/observations. The Value
// field carries whichever typed column was populated for the row's
// ValueKind; the handler renders it as the JSON `value` key. ValueKind
// is the protomodel.ValueKind ordinal stored in signal_log.value_kind
// (SMALLINT, range 0..10 per mig 000186).
type SignalObservation struct {
	VehicleID int64     `json:"vehicle_id"`
	Ts        time.Time `json:"ts"`
	Field     string    `json:"field"`
	ValueKind int16     `json:"-"` // emitted as ValueKind.String() by the handler
	Value     any       `json:"value"`
}

// ObservationsParams binds the optional filters from the
// /signals/observations query string. Empty slices and nil pointers
// mean "no filter on this dimension". Limit and Offset come pre-clamped
// from the handler — the repo trusts them.
type ObservationsParams struct {
	VehicleIDs []int64
	Fields     []string
	Since      *time.Time
	Until      *time.Time
	Limit      int
	Offset     int
}

// signalsCatalogPool is the minimal pgxpool subset this repo needs.
// Declared locally so tests can supply a fake without dragging in
// pgxmock (the codebase does not vendor pgxmock — see repo memories
// from prior phase-43a prompts).
type signalsCatalogPool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// SignalsCatalogRepo serves catalog aggregates + observations from
// signal_log. Construct via NewSignalsCatalogRepo.
type SignalsCatalogRepo struct {
	pool signalsCatalogPool
}

// NewSignalsCatalogRepo binds the repo to a pgx pool. Mirrors the
// snapshot-writer fail-fast precedent — a nil pool at construction is
// a wiring bug, not a runtime condition.
func NewSignalsCatalogRepo(pool *pgxpool.Pool) *SignalsCatalogRepo {
	if pool == nil {
		panic("database.NewSignalsCatalogRepo: pool must not be nil")
	}
	return &SignalsCatalogRepo{pool: pool}
}

// catalogAggregateSelectSQL is exposed as a package-level constant so
// the SQL-shape test can pin column names + GROUP BY without needing
// a real database. The signal_log_field_ts index covers the GROUP BY
// scan; COUNT(DISTINCT vehicle_id) is the slowest part of the query
// because it cannot be served from the index alone.
const catalogAggregateSelectSQL = `
SELECT
    field,
    MAX(ts)                    AS last_seen_at,
    COUNT(*)                   AS sample_count_total,
    COUNT(DISTINCT vehicle_id) AS vehicle_count
FROM signal_log
GROUP BY field
`

// CatalogAggregates returns last_seen_at + counts keyed by field name
// across the entire signal_log table. Fields with no rows are absent
// from the map (the handler treats absence as "routed but unobserved"
// and renders NULL for the count fields).
func (r *SignalsCatalogRepo) CatalogAggregates(ctx context.Context) (map[string]CatalogAggregate, error) {
	rows, err := r.pool.Query(ctx, catalogAggregateSelectSQL)
	if err != nil {
		return nil, fmt.Errorf("signals_catalog: aggregate query: %w", err)
	}
	defer rows.Close()

	out := make(map[string]CatalogAggregate)
	for rows.Next() {
		var (
			field        string
			lastSeen     *time.Time
			sampleCount  int64
			vehicleCount int64
		)
		if err := rows.Scan(&field, &lastSeen, &sampleCount, &vehicleCount); err != nil {
			return nil, fmt.Errorf("signals_catalog: aggregate scan: %w", err)
		}
		out[field] = CatalogAggregate{
			LastSeenAt:       lastSeen,
			SampleCountTotal: sampleCount,
			VehicleCount:     vehicleCount,
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("signals_catalog: aggregate rows iter: %w", err)
	}
	return out, nil
}

// buildObservationsWhere assembles the dynamic WHERE clause for the
// observations endpoints (count + select). Returns (whereClause, args)
// with whereClause beginning with "WHERE 1=1" so subsequent AND
// fragments compose unconditionally and the empty-filter case stays
// valid SQL. Placeholder numbering starts at 1 and is assigned in
// declaration order; tests assert the contract.
func buildObservationsWhere(p ObservationsParams) (string, []any) {
	var (
		clauses []string
		args    []any
	)
	clauses = append(clauses, "WHERE 1=1")

	if len(p.VehicleIDs) > 0 {
		args = append(args, p.VehicleIDs)
		clauses = append(clauses, fmt.Sprintf("AND vehicle_id = ANY($%d::bigint[])", len(args)))
	}
	if len(p.Fields) > 0 {
		args = append(args, p.Fields)
		clauses = append(clauses, fmt.Sprintf("AND field = ANY($%d::text[])", len(args)))
	}
	if p.Since != nil {
		args = append(args, *p.Since)
		clauses = append(clauses, fmt.Sprintf("AND ts >= $%d", len(args)))
	}
	if p.Until != nil {
		args = append(args, *p.Until)
		clauses = append(clauses, fmt.Sprintf("AND ts <= $%d", len(args)))
	}

	return strings.Join(clauses, " "), args
}

// ObservationsCount returns the total row count matching the filters.
// Used by the handler to populate the response `total` so the consumer
// can render pagination affordances.
func (r *SignalsCatalogRepo) ObservationsCount(ctx context.Context, params ObservationsParams) (int64, error) {
	where, args := buildObservationsWhere(params)
	sql := "SELECT COUNT(*) FROM signal_log " + where

	var total int64
	if err := r.pool.QueryRow(ctx, sql, args...).Scan(&total); err != nil {
		return 0, fmt.Errorf("signals_catalog: observations count: %w", err)
	}
	return total, nil
}

// observationsSelectColumns lists the typed columns scanned out of
// signal_log per row. Defined as a package-level constant so the
// SQL-shape test can pin the order matched by scanObservation.
const observationsSelectColumns = "vehicle_id, ts, field, value_kind, str_value, bool_value, int_value, float_value, time_value"

// Observations returns the page of rows matching the filters in the
// ORDER BY ts DESC, vehicle_id ASC, field ASC stable order. ts DESC
// matches operator expectations ("show latest first") and aligns with
// the signal_log_vehicle_field_ts and signal_log_field_ts indexes.
func (r *SignalsCatalogRepo) Observations(ctx context.Context, params ObservationsParams) ([]SignalObservation, error) {
	where, args := buildObservationsWhere(params)

	args = append(args, params.Limit)
	limitPlaceholder := len(args)
	args = append(args, params.Offset)
	offsetPlaceholder := len(args)

	sql := fmt.Sprintf(
		"SELECT %s FROM signal_log %s ORDER BY ts DESC, vehicle_id ASC, field ASC LIMIT $%d OFFSET $%d",
		observationsSelectColumns, where, limitPlaceholder, offsetPlaceholder,
	)

	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("signals_catalog: observations query: %w", err)
	}
	defer rows.Close()

	out := make([]SignalObservation, 0, params.Limit)
	for rows.Next() {
		obs, err := scanObservation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, obs)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("signals_catalog: observations rows iter: %w", err)
	}
	return out, nil
}

// scanObservation reads one signal_log row into a SignalObservation
// and selects the typed column dictated by value_kind (per mig 000186
// lines 79-89). Unknown / Compound / Invalid kinds (0, 8, 10) yield
// Value=nil; the handler will render `null`.
func scanObservation(rows pgx.Rows) (SignalObservation, error) {
	var (
		obs       SignalObservation
		strVal    *string
		boolVal   *bool
		intVal    *int64
		floatVal  *float64
		timeVal   *time.Time
		valueKind int16
	)
	if err := rows.Scan(
		&obs.VehicleID,
		&obs.Ts,
		&obs.Field,
		&valueKind,
		&strVal,
		&boolVal,
		&intVal,
		&floatVal,
		&timeVal,
	); err != nil {
		return SignalObservation{}, fmt.Errorf("signals_catalog: observation scan: %w", err)
	}
	obs.ValueKind = valueKind
	obs.Value = decodeObservationValue(valueKind, strVal, boolVal, intVal, floatVal, timeVal)
	return obs, nil
}

// decodeObservationValue picks the populated typed column for the
// row's ValueKind. Pulled out of scanObservation so the per-kind
// dispatch is unit-testable without a database. Mapping mirrors mig
// 000186 lines 79-89 verbatim.
func decodeObservationValue(
	valueKind int16,
	strVal *string,
	boolVal *bool,
	intVal *int64,
	floatVal *float64,
	timeVal *time.Time,
) any {
	const (
		kindString = 1
		kindBool   = 2
		kindInt32  = 3
		kindInt64  = 4
		kindFloat  = 5
		kindDouble = 6
		kindEnum   = 7
		kindTime   = 9
	)
	switch valueKind {
	case kindString:
		if strVal != nil {
			return *strVal
		}
	case kindBool:
		if boolVal != nil {
			return *boolVal
		}
	case kindInt32, kindInt64, kindEnum:
		if intVal != nil {
			return *intVal
		}
	case kindFloat, kindDouble:
		if floatVal != nil {
			return *floatVal
		}
	case kindTime:
		if timeVal != nil {
			return *timeVal
		}
	}
	return nil
}
