package backuprestore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/backup"
	"github.com/ev-dev-labs/teslasync/internal/backupverify"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const scratchGuardTable = "restore_drill_guard"

var scratchDatabaseName = regexp.MustCompile(`(^teslasync_drill_|_restore_drill$)`)

// ArtifactVerifier proves and returns the newest checksum-verified backup.
type ArtifactVerifier interface {
	VerifyLatest(ctx context.Context) (*backupverify.Result, error)
}

// Result is the non-sensitive database-import result consumed by the restore
// workflow when it creates immutable end-to-end drill evidence.
type Result struct {
	OK                bool             `json:"ok"`
	Error             string           `json:"error,omitempty"`
	ArtifactRunID     int64            `json:"artifact_run_id"`
	ArtifactSHA256    string           `json:"artifact_sha256,omitempty"`
	BackupAt          time.Time        `json:"backup_at"`
	TargetDatabase    string           `json:"target_database"`
	SchemaVersion     uint             `json:"schema_version"`
	SchemaMigrated    bool             `json:"schema_migrated"`
	DatabaseImported  bool             `json:"database_imported"`
	TablesRestored    []TableResult    `json:"tables_restored"`
	CriticalTableRows map[string]int64 `json:"critical_table_rows"`
	// CollateralRowsCleared reports rows removed from tables that are
	// NOT on the restorable allowlist because the schema itself declares
	// ON DELETE CASCADE from a table that was reset (roughly 40 tables
	// hang off `vehicles` this way).
	//
	// A restore replaces the entire restorable dataset, so dependents of
	// the discarded rows cannot survive — but that must be measured and
	// published, not left as a silent side effect. On a scratch database
	// seeded only by migrations this is empty; anything else is a signal
	// the operator needs to see in the drill evidence.
	CollateralRowsCleared map[string]int64 `json:"collateral_rows_cleared"`
}

// TableResult records exact source-to-target row parity for one table,
// plus the two facts that make the import reproducible against a fully
// migrated scratch schema: how many pre-existing rows had to be cleared,
// and whether explicit identity values had to be forced past a
// GENERATED ALWAYS column.
type TableResult struct {
	Table        string `json:"table"`
	ArtifactRows int64  `json:"artifact_rows"`
	RestoredRows int64  `json:"restored_rows"`
	// ClearedRows counts rows deleted from the scratch table before the
	// import. A migrated schema is NOT empty — migrations seed `settings`
	// (11 rows today) and historically `alert_rules` — so an import that
	// insists on empty tables can never restore a production artifact.
	ClearedRows int64 `json:"cleared_rows"`
	// IdentityOverride records that the table has a
	// `GENERATED ALWAYS AS IDENTITY` column and the insert therefore used
	// OVERRIDING SYSTEM VALUE to preserve the artifact's primary keys.
	IdentityOverride bool `json:"identity_override"`
}

// scratchTable is one restorable table as it actually exists in the
// migrated scratch schema.
type scratchTable struct {
	name string
	// columns are the insertable columns in attribute order. Stored
	// generated columns are excluded: PostgreSQL rejects an explicit
	// value for them and OVERRIDING SYSTEM VALUE does not apply.
	columns []string
	// identityAlways is true when any column is GENERATED ALWAYS AS
	// IDENTITY. Restoring production primary keys into such a table
	// requires OVERRIDING SYSTEM VALUE; without it PostgreSQL raises
	// "cannot insert a non-DEFAULT value into column".
	identityAlways bool
}

// Restorer imports a verified artifact into an explicitly guarded scratch DB.
type Restorer struct {
	verifier ArtifactVerifier
	source   *pgxpool.Pool
	target   *pgxpool.Pool
}

func New(verifier ArtifactVerifier, source, target *pgxpool.Pool) *Restorer {
	return &Restorer{verifier: verifier, source: source, target: target}
}

// Run verifies source/target isolation, imports every backed-up table in one
// transaction, and proves non-empty parity for each critical table.
func (r *Restorer) Run(ctx context.Context, guard string, criticalTables []string) (*Result, error) {
	result := &Result{
		CriticalTableRows:     make(map[string]int64),
		CollateralRowsCleared: make(map[string]int64),
	}
	fail := func(err error) (*Result, error) {
		result.Error = err.Error()
		return result, err
	}
	if r == nil || r.verifier == nil || r.source == nil || r.target == nil {
		return fail(errors.New("restore drill is not configured"))
	}

	targetDatabase, err := validateScratchTarget(ctx, r.source, r.target, guard)
	if err != nil {
		return fail(err)
	}
	result.TargetDatabase = targetDatabase

	var dirty bool
	if err := r.target.QueryRow(ctx,
		"SELECT version, dirty FROM schema_migrations LIMIT 1",
	).Scan(&result.SchemaVersion, &dirty); err != nil {
		return fail(fmt.Errorf("read scratch schema version: %w", err))
	}
	if dirty || result.SchemaVersion == 0 {
		return fail(fmt.Errorf("scratch schema is not at a clean migrated version"))
	}
	result.SchemaMigrated = true

	verified, err := r.verifier.VerifyLatest(ctx)
	if err != nil {
		return fail(fmt.Errorf("verify production artifact: %w", err))
	}
	if verified == nil || !verified.OK || !verified.ChecksumOK || len(verified.RestoredData) == 0 {
		return fail(errors.New("verified artifact did not provide restorable table data"))
	}
	result.ArtifactRunID = verified.RunID
	result.ArtifactSHA256 = verified.ArtifactSHA256
	result.BackupAt = verified.BackupAt

	tableNames := make([]string, 0, len(verified.RestoredData))
	for table := range verified.RestoredData {
		if table == "_metadata" {
			continue
		}
		if !backup.IsAllowedTable(table) {
			return fail(fmt.Errorf("artifact contains unsupported table %q", table))
		}
		tableNames = append(tableNames, table)
	}
	if len(tableNames) == 0 {
		return fail(errors.New("artifact contains no restorable tables"))
	}
	sort.Strings(tableNames)

	tx, err := r.target.Begin(ctx)
	if err != nil {
		return fail(fmt.Errorf("begin scratch import: %w", err))
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Re-assert the scratch guard INSIDE the transaction. The guard was
	// checked before this point on a different pooled connection; the
	// next statements DELETE rows, so the window between "this is a
	// scratch database" and "start deleting" must not be crossed on
	// unverified state.
	if err := assertScratchGuard(ctx, tx, guard); err != nil {
		return fail(err)
	}

	schema, err := inspectScratchTables(ctx, tx, tableNames)
	if err != nil {
		return fail(fmt.Errorf("inspect scratch schema: %w", err))
	}
	for _, table := range tableNames {
		if _, ok := schema[table]; !ok {
			return fail(fmt.Errorf(
				"artifact table %s does not exist in the migrated scratch schema; "+
					"the artifact and the migrations are out of sync and the restore would silently lose data",
				table))
		}
	}
	ordered, err := dependencyOrder(ctx, tx, tableNames)
	if err != nil {
		return fail(fmt.Errorf("order scratch tables by dependency: %w", err))
	}

	// ── Phase 1: reset, with foreign keys still ENFORCED ─────────────
	//
	// A fully migrated scratch database is not empty: migrations seed
	// `settings` and (historically) `alert_rules`, so the previous
	// "table must be empty" precondition made every production-artifact
	// drill fail before it imported a single row.
	//
	// Only the explicitly allowlisted restorable tables are cleared, in
	// reverse dependency order, with DELETE rather than TRUNCATE:
	//   * TRUNCATE would need CASCADE, and CASCADE reaches 40+ tables
	//     that are NOT in the restorable allowlist (everything with a
	//     `vehicle_id` FK), silently widening the blast radius.
	//   * DELETE with FK enforcement still on fails loudly if any
	//     non-allowlisted table holds referencing rows under a RESTRICT
	//     or NO ACTION rule, instead of leaving orphans behind.
	//
	// Where the schema itself declares ON DELETE CASCADE the dependent
	// rows do go with the parent — that is the schema's own contract,
	// not a choice made here — so the collateral is counted before and
	// after and published in the drill evidence.
	collateral, err := cascadeCollateralTables(ctx, tx, tableNames)
	if err != nil {
		return fail(fmt.Errorf("map cascade collateral: %w", err))
	}
	beforeCollateral, err := countRows(ctx, tx, collateral)
	if err != nil {
		return fail(fmt.Errorf("count cascade collateral before reset: %w", err))
	}

	cleared := make(map[string]int64, len(ordered))
	for i := len(ordered) - 1; i >= 0; i-- {
		table := ordered[i]
		if !backup.IsAllowedTable(table) {
			return fail(fmt.Errorf("refusing to clear non-allowlisted scratch table %q", table))
		}
		tag, err := tx.Exec(ctx, "DELETE FROM "+pgx.Identifier{table}.Sanitize())
		if err != nil {
			return fail(fmt.Errorf(
				"clear scratch table %s before import (a non-restorable table may reference it): %w",
				table, err))
		}
		cleared[table] = tag.RowsAffected()
	}

	afterCollateral, err := countRows(ctx, tx, collateral)
	if err != nil {
		return fail(fmt.Errorf("count cascade collateral after reset: %w", err))
	}
	for table, before := range beforeCollateral {
		if delta := before - afterCollateral[table]; delta > 0 {
			result.CollateralRowsCleared[table] = delta
		}
	}

	// ── Phase 2: import, with triggers suppressed ────────────────────
	//
	// Deferred until after the reset so the delete above is FK-checked.
	if _, err := tx.Exec(ctx, "SET LOCAL session_replication_role = replica"); err != nil {
		return fail(fmt.Errorf("disable scratch triggers for logical import: %w", err))
	}

	for _, table := range ordered {
		raw := verified.RestoredData[table]
		expectedRows, err := rowCount(raw)
		if err != nil {
			return fail(fmt.Errorf("decode artifact table %s: %w", table, err))
		}
		target := schema[table]
		tag, err := tx.Exec(ctx, target.insertStatement(), string(raw))
		if err != nil {
			return fail(fmt.Errorf("restore table %s: %w", table, err))
		}
		if tag.RowsAffected() != expectedRows {
			return fail(fmt.Errorf(
				"restore table %s inserted %d rows, want %d",
				table,
				tag.RowsAffected(),
				expectedRows,
			))
		}
		result.TablesRestored = append(result.TablesRestored, TableResult{
			Table:            table,
			ArtifactRows:     expectedRows,
			RestoredRows:     tag.RowsAffected(),
			ClearedRows:      cleared[table],
			IdentityOverride: target.identityAlways,
		})
	}
	sort.Slice(result.TablesRestored, func(i, j int) bool {
		return result.TablesRestored[i].Table < result.TablesRestored[j].Table
	})
	for _, table := range ordered {
		if err := resetTableSequences(ctx, tx, table); err != nil {
			return fail(fmt.Errorf("reset sequences for %s: %w", table, err))
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fail(fmt.Errorf("commit scratch import: %w", err))
	}

	for _, table := range criticalTables {
		if !backup.IsAllowedTable(table) {
			return fail(fmt.Errorf("critical table %q is not supported", table))
		}
		identifier := pgx.Identifier{table}.Sanitize()
		var rows int64
		if err := r.target.QueryRow(ctx, "SELECT COUNT(*) FROM "+identifier).Scan(&rows); err != nil {
			return fail(fmt.Errorf("verify critical table %s: %w", table, err))
		}
		if rows <= 0 {
			return fail(fmt.Errorf("critical table %s is empty after restore", table))
		}
		result.CriticalTableRows[table] = rows
	}

	result.DatabaseImported = true
	result.OK = true
	return result, nil
}

// cascadeCollateralTables returns the non-allowlisted tables that the
// schema's own ON DELETE CASCADE rules will empty when the restorable
// tables are cleared, following the cascade transitively.
func cascadeCollateralTables(ctx context.Context, tx pgx.Tx, tables []string) ([]string, error) {
	rows, err := tx.Query(ctx, `
		WITH RECURSIVE seed AS (
			SELECT c.oid
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = current_schema()
			  AND c.relname = ANY($1)
		), closure AS (
			SELECT oid FROM seed
			UNION
			SELECT con.conrelid
			FROM pg_constraint con
			JOIN closure cl ON cl.oid = con.confrelid
			WHERE con.contype = 'f'
			  AND con.confdeltype = 'c'
		)
		SELECT c.relname
		FROM closure cl
		JOIN pg_class c ON c.oid = cl.oid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = current_schema()
		  AND c.relkind IN ('r', 'p')
		  AND NOT (c.relname = ANY($1))
		ORDER BY 1
	`, tables)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			return nil, err
		}
		out = append(out, table)
	}
	return out, rows.Err()
}

// countRows counts every listed table in a single round trip. Table
// names come from the catalog and are quoted, never interpolated raw.
func countRows(ctx context.Context, tx pgx.Tx, tables []string) (map[string]int64, error) {
	counts := make(map[string]int64, len(tables))
	if len(tables) == 0 {
		return counts, nil
	}
	parts := make([]string, 0, len(tables))
	for _, table := range tables {
		parts = append(parts, "SELECT "+quoteLiteral(table)+" AS t, COUNT(*) AS n FROM "+
			pgx.Identifier{table}.Sanitize())
	}
	rows, err := tx.Query(ctx, strings.Join(parts, " UNION ALL "))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var table string
		var n int64
		if err := rows.Scan(&table, &n); err != nil {
			return nil, err
		}
		counts[table] = n
	}
	return counts, rows.Err()
}

// quoteLiteral renders a catalog-sourced identifier as a SQL string
// literal for the SELECT projection above.
func quoteLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

// insertStatement builds the import statement for one table.
//
// Two things the naive `INSERT INTO t SELECT * FROM json_populate_recordset(...)`
// gets wrong against the real schema:
//
//  1. An explicit column list is required, because stored generated
//     columns must be omitted entirely — PostgreSQL rejects any supplied
//     value for them.
//  2. `OVERRIDING SYSTEM VALUE` is required for tables with a
//     `GENERATED ALWAYS AS IDENTITY` column (vehicles, alert_rules,
//     geofences, notification_channels today). Without it the import
//     fails with "cannot insert a non-DEFAULT value into column id";
//     with it the artifact's primary keys survive, which is what makes
//     the restored foreign keys line up.
func (t scratchTable) insertStatement() string {
	identifier := pgx.Identifier{t.name}.Sanitize()
	columns := make([]string, 0, len(t.columns))
	for _, column := range t.columns {
		columns = append(columns, pgx.Identifier{column}.Sanitize())
	}
	list := strings.Join(columns, ", ")

	overriding := ""
	if t.identityAlways {
		overriding = " OVERRIDING SYSTEM VALUE"
	}
	return "INSERT INTO " + identifier + " (" + list + ")" + overriding +
		" SELECT " + list + " FROM json_populate_recordset(NULL::" + identifier + ", $1::json)"
}

// assertScratchGuard re-proves scratch identity on the importing
// connection itself, immediately before any destructive statement.
func assertScratchGuard(ctx context.Context, tx pgx.Tx, guard string) error {
	var database string
	var guarded bool
	err := tx.QueryRow(ctx,
		"SELECT current_database(), EXISTS (SELECT 1 FROM "+scratchGuardTable+" WHERE nonce = $1)",
		guard,
	).Scan(&database, &guarded)
	if err != nil {
		return fmt.Errorf("re-verify scratch guard inside the import transaction: %w", err)
	}
	if !scratchDatabaseName.MatchString(database) {
		return fmt.Errorf(
			"import transaction is connected to %q, which is not named as an isolated restore drill",
			database)
	}
	if !guarded {
		return errors.New("scratch restore guard does not match the import connection")
	}
	return nil
}

// inspectScratchTables reads the insertable shape of each restorable
// table from the target's live catalog, so the import adapts to the
// migrated schema instead of assuming one.
func inspectScratchTables(
	ctx context.Context,
	tx pgx.Tx,
	tables []string,
) (map[string]scratchTable, error) {
	rows, err := tx.Query(ctx, `
		SELECT c.relname,
		       a.attname,
		       a.attidentity = 'a' AS identity_always
		FROM pg_attribute a
		JOIN pg_class c ON c.oid = a.attrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = current_schema()
		  AND c.relkind IN ('r', 'p')
		  AND c.relname = ANY($1)
		  AND a.attnum > 0
		  AND NOT a.attisdropped
		  AND a.attgenerated = ''
		ORDER BY c.relname, a.attnum
	`, tables)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	schema := make(map[string]scratchTable, len(tables))
	for rows.Next() {
		var table, column string
		var identityAlways bool
		if err := rows.Scan(&table, &column, &identityAlways); err != nil {
			return nil, err
		}
		entry := schema[table]
		entry.name = table
		entry.columns = append(entry.columns, column)
		entry.identityAlways = entry.identityAlways || identityAlways
		schema[table] = entry
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for table, entry := range schema {
		if len(entry.columns) == 0 {
			return nil, fmt.Errorf("scratch table %s exposes no insertable columns", table)
		}
	}
	return schema, nil
}

// dependencyOrder returns the restorable tables sorted parents-first.
//
// Inserting parents first and deleting children first keeps the drill
// honest even when triggers are live, and it is what lets the reset run
// with foreign keys still enforced.
func dependencyOrder(ctx context.Context, tx pgx.Tx, tables []string) ([]string, error) {
	rows, err := tx.Query(ctx, `
		SELECT child.relname, parent.relname
		FROM pg_constraint con
		JOIN pg_class child ON child.oid = con.conrelid
		JOIN pg_class parent ON parent.oid = con.confrelid
		JOIN pg_namespace n ON n.oid = child.relnamespace
		WHERE con.contype = 'f'
		  AND n.nspname = current_schema()
		  AND child.relname = ANY($1)
		  AND parent.relname = ANY($1)
		  AND child.relname <> parent.relname
	`, tables)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	parents := make(map[string]map[string]bool, len(tables))
	for _, table := range tables {
		parents[table] = map[string]bool{}
	}
	for rows.Next() {
		var child, parent string
		if err := rows.Scan(&child, &parent); err != nil {
			return nil, err
		}
		if _, ok := parents[child]; ok {
			parents[child][parent] = true
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return topologicalOrder(tables, parents)
}

// topologicalOrder sorts tables so every parent precedes its children,
// breaking ties alphabetically so the order — and therefore the drill
// evidence — is deterministic across runs.
func topologicalOrder(tables []string, parents map[string]map[string]bool) ([]string, error) {
	remaining := make([]string, len(tables))
	copy(remaining, tables)
	sort.Strings(remaining)

	placed := make(map[string]bool, len(tables))
	ordered := make([]string, 0, len(tables))
	for len(remaining) > 0 {
		progressed := false
		next := remaining[:0]
		for _, table := range remaining {
			ready := true
			for parent := range parents[table] {
				if !placed[parent] {
					ready = false
					break
				}
			}
			if ready {
				ordered = append(ordered, table)
				placed[table] = true
				progressed = true
				continue
			}
			next = append(next, table)
		}
		remaining = next
		if !progressed {
			// A cycle is not something to paper over: silently picking
			// an order would produce a restore whose foreign keys are
			// wrong in a way no row count can detect.
			sort.Strings(remaining)
			return nil, fmt.Errorf(
				"foreign-key cycle among restorable tables %s; the import order cannot be derived",
				strings.Join(remaining, ", "))
		}
	}
	return ordered, nil
}

func validateScratchTarget(
	ctx context.Context,
	source, target *pgxpool.Pool,
	guard string,
) (string, error) {
	if strings.TrimSpace(guard) == "" {
		return "", errors.New("scratch restore guard is required")
	}
	sourceIdentity, err := databaseIdentity(ctx, source)
	if err != nil {
		return "", fmt.Errorf("identify source database: %w", err)
	}
	targetIdentity, err := databaseIdentity(ctx, target)
	if err != nil {
		return "", fmt.Errorf("identify target database: %w", err)
	}
	if sourceIdentity == targetIdentity {
		return "", errors.New("source and restore target resolve to the same database")
	}
	targetDatabase := strings.SplitN(targetIdentity, "@", 2)[0]
	if !scratchDatabaseName.MatchString(targetDatabase) {
		return "", fmt.Errorf(
			"target database %q is not named as an isolated restore drill",
			targetDatabase,
		)
	}
	var guarded bool
	if err := target.QueryRow(ctx,
		"SELECT EXISTS (SELECT 1 FROM "+scratchGuardTable+" WHERE nonce = $1)",
		guard,
	).Scan(&guarded); err != nil {
		return "", fmt.Errorf("verify scratch restore guard: %w", err)
	}
	if !guarded {
		return "", errors.New("scratch restore guard does not match the target database")
	}
	return targetDatabase, nil
}

func databaseIdentity(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	var databaseName, serverAddress string
	var serverPort int
	err := pool.QueryRow(ctx, `
		SELECT current_database(),
		       COALESCE(inet_server_addr()::text, 'local'),
		       COALESCE(inet_server_port(), 0)
	`).Scan(&databaseName, &serverAddress, &serverPort)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s@%s:%d", databaseName, serverAddress, serverPort), nil
}

func rowCount(raw json.RawMessage) (int64, error) {
	var rows []json.RawMessage
	if err := json.Unmarshal(raw, &rows); err != nil {
		return 0, err
	}
	return int64(len(rows)), nil
}

func resetTableSequences(ctx context.Context, tx pgx.Tx, table string) error {
	rows, err := tx.Query(ctx, `
		SELECT column_name,
		       pg_get_serial_sequence(
		           quote_ident(table_schema) || '.' || quote_ident(table_name),
		           column_name
		       )
		FROM information_schema.columns
		WHERE table_schema = current_schema()
		  AND table_name = $1
		  AND pg_get_serial_sequence(
		          quote_ident(table_schema) || '.' || quote_ident(table_name),
		          column_name
		      ) IS NOT NULL
	`, table)
	if err != nil {
		return err
	}
	type sequenceColumn struct {
		column   string
		sequence string
	}
	sequences := make([]sequenceColumn, 0)
	for rows.Next() {
		var sequence sequenceColumn
		if err := rows.Scan(&sequence.column, &sequence.sequence); err != nil {
			rows.Close()
			return err
		}
		sequences = append(sequences, sequence)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	tableIdentifier := pgx.Identifier{table}.Sanitize()
	for _, sequence := range sequences {
		columnIdentifier := pgx.Identifier{sequence.column}.Sanitize()
		if _, err := tx.Exec(ctx,
			"SELECT setval($1::regclass, COALESCE(MAX("+columnIdentifier+")::bigint, 1), COUNT(*) > 0) FROM "+tableIdentifier,
			sequence.sequence,
		); err != nil {
			return err
		}
	}
	return nil
}
