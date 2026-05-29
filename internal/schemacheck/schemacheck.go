// Package schemacheck verifies that the live PostgreSQL/TimescaleDB
// schema matches the canonical migrated schema. Drift indicates that
// a hand-rolled ALTER TABLE or a partially-applied migration has
// left the deployment in a state the application code does not
// expect.
//
// Layer: platform
//
// Approach:
//
//  1. CI runs a clean migration sequence against a testcontainers
//     postgres, dumps the schema fingerprint (table+column+index
//     sha256), and inserts a row into schema_fingerprint.
//
//  2. At boot the application reads the live schema, computes the
//     same fingerprint, and compares to the most recent
//     schema_fingerprint row. Mismatch increments the
//     teslasync_schema_drift_total metric and is exposed via
//     /api/v1/system/schema-drift for the admin UI.
//
//  3. The Drift result is intentionally LOW-detail at the wire
//     level: it tells you "there are 3 missing columns and 1 extra
//     index" but not the column values. Operators consult the live
//     pg dump for the actual delta. This avoids leaking schema
//     details to anyone who can read the response body.
package schemacheck

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Fingerprint summarises the schema for comparison.
type Fingerprint struct {
	SHA256      string `json:"sha256"`
	TableCount  int    `json:"table_count"`
	ColumnCount int    `json:"column_count"`
	IndexCount  int    `json:"index_count"`
}

// Drift is the result of comparing two fingerprints. Always returned
// as a value (never nil) so callers can render "no drift" uniformly.
type Drift struct {
	HasDrift            bool        `json:"has_drift"`
	Current             Fingerprint `json:"current"`
	Expected            Fingerprint `json:"expected"`
	TableCountDelta     int         `json:"table_count_delta"`
	ColumnCountDelta    int         `json:"column_count_delta"`
	IndexCountDelta     int         `json:"index_count_delta"`
	ExpectedGeneratedAt string      `json:"expected_generated_at,omitempty"`
}

// Querier is the narrow surface of *pgxpool.Pool this package needs.
// Mockable for tests via any type that implements Query returning
// pgx.Rows.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Compute walks information_schema for the public schema and produces
// a fingerprint. Tables in `excludeTables` are skipped (e.g. the
// transient `schema_migrations` table that golang-migrate manages).
func Compute(ctx context.Context, pool Querier, excludeTables []string) (Fingerprint, error) {
	excluded := make(map[string]bool, len(excludeTables))
	for _, t := range excludeTables {
		excluded[t] = true
	}

	tables, err := listTables(ctx, pool, excluded)
	if err != nil {
		return Fingerprint{}, fmt.Errorf("schemacheck: list tables: %w", err)
	}
	columns, columnCount, err := listColumns(ctx, pool, excluded)
	if err != nil {
		return Fingerprint{}, fmt.Errorf("schemacheck: list columns: %w", err)
	}
	indexes, err := listIndexes(ctx, pool, excluded)
	if err != nil {
		return Fingerprint{}, fmt.Errorf("schemacheck: list indexes: %w", err)
	}

	parts := make([]string, 0, len(tables)+len(columns)+len(indexes))
	for _, t := range tables {
		parts = append(parts, "T:"+t)
	}
	for _, c := range columns {
		parts = append(parts, "C:"+c)
	}
	for _, i := range indexes {
		parts = append(parts, "I:"+i)
	}
	sort.Strings(parts)
	sum := sha256.Sum256([]byte(strings.Join(parts, "\n")))
	return Fingerprint{
		SHA256:      hex.EncodeToString(sum[:]),
		TableCount:  len(tables),
		ColumnCount: columnCount,
		IndexCount:  len(indexes),
	}, nil
}

func listTables(ctx context.Context, pool Querier, excluded map[string]bool) ([]string, error) {
	rows, err := pool.Query(ctx, `
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		if excluded[name] {
			continue
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

func listColumns(ctx context.Context, pool Querier, excluded map[string]bool) ([]string, int, error) {
	rows, err := pool.Query(ctx, `
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'`)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []string
	count := 0
	for rows.Next() {
		var table, col, typ, nullable string
		if err := rows.Scan(&table, &col, &typ, &nullable); err != nil {
			return nil, 0, err
		}
		if excluded[table] {
			continue
		}
		out = append(out, table+"."+col+":"+typ+"/"+nullable)
		count++
	}
	return out, count, rows.Err()
}

func listIndexes(ctx context.Context, pool Querier, excluded map[string]bool) ([]string, error) {
	rows, err := pool.Query(ctx, `
SELECT tablename, indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var table, name, def string
		if err := rows.Scan(&table, &name, &def); err != nil {
			return nil, err
		}
		if excluded[table] {
			continue
		}
		out = append(out, table+"."+name+":"+normaliseIndexDef(def))
	}
	return out, rows.Err()
}

func normaliseIndexDef(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(s)), " ")
}

// Diff compares current to expected and returns a Drift value. Always
// non-error; nil-safe.
func Diff(current, expected Fingerprint, expectedGeneratedAt string) Drift {
	return Drift{
		HasDrift:            current.SHA256 != expected.SHA256,
		Current:             current,
		Expected:            expected,
		TableCountDelta:     current.TableCount - expected.TableCount,
		ColumnCountDelta:    current.ColumnCount - expected.ColumnCount,
		IndexCountDelta:     current.IndexCount - expected.IndexCount,
		ExpectedGeneratedAt: expectedGeneratedAt,
	}
}
