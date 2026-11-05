package observability

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

type DatabaseTableInfo struct {
	Schema     string     `json:"schema"`
	Name       string     `json:"name"`
	RowCount   int64      `json:"row_count"`
	SizeBytes  int64      `json:"size_bytes"`
	IndexCount int64      `json:"index_count"`
	LastVacuum *time.Time `json:"last_vacuum"`
}

type DatabaseStats struct {
	Tables             []DatabaseTableInfo `json:"tables"`
	TableCount         int                 `json:"table_count"`
	DatabaseSize       int64               `json:"database_size"`
	RowCountsEstimated bool                `json:"row_counts_estimated"`
}

type DatabaseStatsRepo struct {
	exec database.DBTX
}

func NewDatabaseStatsRepo(db *database.DB) *DatabaseStatsRepo {
	if db == nil || db.Pool == nil {
		return nil
	}
	return &DatabaseStatsRepo{exec: db.Pool}
}

func (r *DatabaseStatsRepo) Stats(ctx context.Context) (*DatabaseStats, error) {
	if r == nil || r.exec == nil {
		return nil, fmt.Errorf("database stats: database not configured")
	}
	result := &DatabaseStats{Tables: []DatabaseTableInfo{}, RowCountsEstimated: true}
	if err := r.exec.QueryRow(ctx, "SELECT pg_database_size(current_database())").Scan(&result.DatabaseSize); err != nil {
		return nil, fmt.Errorf("database stats: read database size: %w", err)
	}

	// Timescale's estimates read catalogs, not table contents, and include
	// compressed chunks. Plain relation sizes omit a hypertable's chunks.
	const query = `
SELECT n.nspname, c.relname,
       approximate_row_count(c.oid::regclass)::bigint,
       CASE WHEN h.hypertable_name IS NOT NULL
            THEN hypertable_size(c.oid::regclass)
            ELSE pg_total_relation_size(c.oid)
       END::bigint,
       (SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid),
       GREATEST(s.last_vacuum, s.last_autovacuum)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
  LEFT JOIN timescaledb_information.hypertables h
    ON h.hypertable_schema = n.nspname AND h.hypertable_name = c.relname
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
 ORDER BY c.relname`
	rows, err := r.exec.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("database stats: query tables: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var table DatabaseTableInfo
		if err := rows.Scan(&table.Schema, &table.Name, &table.RowCount, &table.SizeBytes, &table.IndexCount, &table.LastVacuum); err != nil {
			return nil, fmt.Errorf("database stats: scan table: %w", err)
		}
		result.Tables = append(result.Tables, table)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("database stats: read tables: %w", err)
	}
	result.TableCount = len(result.Tables)
	return result, nil
}
