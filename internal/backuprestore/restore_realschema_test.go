package backuprestore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/backupverify"
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Restore drill coverage against the REAL migrated schema.
//
// The previous integration test built a three-column fixture
// (`CREATE TABLE vehicles (id BIGINT PRIMARY KEY, display_name TEXT)`)
// and proved nothing about the database a drill actually restores into.
// Two defects hid behind that simplification, and both made every
// production-artifact drill fail before importing a single row:
//
//  1. A migrated scratch database is NOT empty. Migrations seed
//     `settings` (11 rows at migration 234), so the import's
//     "scratch table must be empty" precondition rejected the restore.
//
//  2. `vehicles`, `alert_rules`, `geofences`, and `notification_channels`
//     declare `id bigint GENERATED ALWAYS AS IDENTITY`. A plain
//     `INSERT ... SELECT` of the artifact's explicit ids fails with
//     "cannot insert a non-DEFAULT value into column id"; only
//     `OVERRIDING SYSTEM VALUE` preserves the production primary keys
//     that every restored foreign key depends on.
//
// These tests therefore run the real `migrations/` tree. Set
// TESLASYNC_RESTORE_TEST_DATABASE_URL to a superuser URL on a
// TimescaleDB instance (the schema needs `CREATE EXTENSION timescaledb`)
// to execute them:
//
//	docker run -d --name pg -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=drill \
//	  -p 55433:5432 timescale/timescaledb-ha:pg17
//	TESLASYNC_RESTORE_TEST_DATABASE_URL=postgres://drill:drill@localhost:55433/postgres?sslmode=disable \
//	  go test ./internal/backuprestore/ -run RealSchema -v

var (
	templateOnce sync.Once
	templateName string
	templateErr  error
)

// realSchemaHarness owns the migrated template database and hands out
// disposable scratch databases cloned from it. Cloning keeps each test
// isolated without paying the ~4 minute cost of replaying 230+
// migrations per case.
type realSchemaHarness struct {
	adminURL string
	config   *pgxpool.Config
	admin    *pgxpool.Pool
	template string
}

func newRealSchemaHarness(ctx context.Context, t *testing.T) *realSchemaHarness {
	t.Helper()
	adminURL := strings.TrimSpace(os.Getenv("TESLASYNC_RESTORE_TEST_DATABASE_URL"))
	if adminURL == "" {
		t.Skip("TESLASYNC_RESTORE_TEST_DATABASE_URL is not set; the real-schema restore drill needs a live TimescaleDB")
	}
	config, err := pgxpool.ParseConfig(adminURL)
	if err != nil {
		t.Fatalf("parse admin URL: %v", err)
	}
	admin, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatalf("connect admin database: %v", err)
	}
	t.Cleanup(admin.Close)

	harness := &realSchemaHarness{adminURL: adminURL, config: config, admin: admin}
	templateOnce.Do(func() { templateName, templateErr = harness.buildTemplate(ctx) })
	if templateErr != nil {
		t.Fatalf("build migrated template database: %v", templateErr)
	}
	harness.template = templateName
	return harness
}

// buildTemplate applies the real migrations once.
func (h *realSchemaHarness) buildTemplate(ctx context.Context) (string, error) {
	name := "teslasync_drill_template"
	if _, err := h.admin.Exec(ctx,
		"DROP DATABASE IF EXISTS "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)"); err != nil {
		return "", err
	}
	if _, err := h.admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()); err != nil {
		return "", err
	}
	source, err := migrationsSourceURL()
	if err != nil {
		return "", err
	}
	migrator, err := migrate.New(source, h.dsn(name))
	if err != nil {
		return "", fmt.Errorf("construct migrator: %w", err)
	}
	defer func() { _, _ = migrator.Close() }()
	if err := migrator.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return "", fmt.Errorf("migrate template: %w", err)
	}
	return name, nil
}

// dsn rewrites the admin URL to point at another database on the same
// server.
func (h *realSchemaHarness) dsn(database string) string {
	parsed, err := url.Parse(h.adminURL)
	if err != nil {
		return h.adminURL
	}
	parsed.Path = "/" + database
	return parsed.String()
}

// clone creates a scratch database from the migrated template. Cloning
// requires no active sessions on the template, so nothing here may hold
// a template connection open.
func (h *realSchemaHarness) clone(ctx context.Context, t *testing.T, name string) *pgxpool.Pool {
	t.Helper()
	identifier := pgx.Identifier{name}.Sanitize()
	if _, err := h.admin.Exec(ctx, "DROP DATABASE IF EXISTS "+identifier+" WITH (FORCE)"); err != nil {
		t.Fatalf("drop %s: %v", name, err)
	}
	if _, err := h.admin.Exec(ctx,
		"CREATE DATABASE "+identifier+" TEMPLATE "+pgx.Identifier{h.template}.Sanitize()); err != nil {
		t.Fatalf("clone %s from the migrated template: %v", name, err)
	}
	t.Cleanup(func() {
		_, _ = h.admin.Exec(context.Background(), "DROP DATABASE IF EXISTS "+identifier+" WITH (FORCE)")
	})

	config := h.config.Copy()
	config.ConnConfig.Database = name
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatalf("connect %s: %v", name, err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func migrationsSourceURL() (string, error) {
	for _, candidate := range []string{
		filepath.Join("..", "..", "migrations"),
		filepath.Join("..", "..", "..", "migrations"),
		"migrations",
	} {
		abs, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		if _, err := os.Stat(abs); err == nil {
			return "file://" + filepath.ToSlash(abs), nil
		}
	}
	return "", errors.New("migrations directory not found")
}

// installGuard reproduces exactly what the drill workflow does to the
// scratch database before the restorer runs.
func installGuard(ctx context.Context, t *testing.T, pool *pgxpool.Pool, guard string) {
	t.Helper()
	statements := []string{
		`CREATE TABLE restore_drill_guard (
			nonce TEXT PRIMARY KEY,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`INSERT INTO restore_drill_guard (nonce) VALUES ($1)`,
	}
	for i, statement := range statements {
		var err error
		if i == len(statements)-1 {
			_, err = pool.Exec(ctx, statement, guard)
		} else {
			_, err = pool.Exec(ctx, statement)
		}
		if err != nil {
			t.Fatalf("install scratch guard: %v", err)
		}
	}
}

func count(ctx context.Context, t *testing.T, pool *pgxpool.Pool, table string) int64 {
	t.Helper()
	var rows int64
	if err := pool.QueryRow(ctx, "SELECT COUNT(*) FROM "+pgx.Identifier{table}.Sanitize()).Scan(&rows); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return rows
}

// productionShapedArtifact mirrors what internal/backup exports: one
// JSON array per table with every column present, explicit primary keys
// included.
func productionShapedArtifact() map[string]json.RawMessage {
	return map[string]json.RawMessage{
		"_metadata": json.RawMessage(`{"version":"1.0"}`),
		// GENERATED ALWAYS AS IDENTITY — needs OVERRIDING SYSTEM VALUE.
		"vehicles": json.RawMessage(`[
			{"id":41,"tesla_id":1001,"vin":"5YJ3E1EA1JF000041","display_name":"Prod One",
			 "model":"3","option_codes":null,"color":"white","trim_level":"LR",
			 "enrolled_at":"2024-01-01T00:00:00Z","archived_at":null,
			 "created_at":"2024-01-01T00:00:00Z","updated_at":"2024-01-02T00:00:00Z","timezone":"UTC"},
			{"id":42,"tesla_id":1002,"vin":"5YJ3E1EA1JF000042","display_name":"Prod Two",
			 "model":"Y","option_codes":null,"color":"blue","trim_level":"P",
			 "enrolled_at":"2024-01-03T00:00:00Z","archived_at":null,
			 "created_at":"2024-01-03T00:00:00Z","updated_at":"2024-01-04T00:00:00Z","timezone":"UTC"}
		]`),
		// Identity table AND a foreign-key child of vehicles: proves the
		// import order and the preserved parent ids line up.
		"alert_rules": json.RawMessage(`[
			{"id":7,"name":"Low battery","description":null,"enabled":true,"vehicle_id":41,
			 "signal_name":"battery_level","op":"<","value_num":20,"value_text":null,"value_bool":null,
			 "value_min":null,"value_max":null,"severity":"warn","cooldown_min":30,
			 "created_at":"2024-01-05T00:00:00Z","updated_at":"2024-01-05T00:00:00Z",
			 "trigger_mode":"once","snoozed_until":null,"kind":"signal","metric_id":null,
			 "metric_window":null,"metric_threshold":null,"metric_op":null,
			 "max_fires_per_resolution":null,"all_vehicles":false,"escalation_after_min":null,
			 "escalation_severity":null,"msg_template":null,"include_title":true}
		]`),
		// Seeded by migrations — the table that made the old
		// "must be empty" precondition unsatisfiable.
		"settings": json.RawMessage(`[
			{"key":"unit_of_length","value_text":"km","value_num":null,"value_bool":null,
			 "data_kind":"text","description":"restored from production",
			 "created_at":"2024-01-01T00:00:00Z","updated_at":"2024-01-06T00:00:00Z","value_jsonb":null},
			{"key":"base_cost_per_kwh","value_text":null,"value_num":0.42,"value_bool":null,
			 "data_kind":"number","description":"restored from production",
			 "created_at":"2024-01-01T00:00:00Z","updated_at":"2024-01-06T00:00:00Z","value_jsonb":null}
		]`),
		"drives": json.RawMessage(`[
			{"id":900,"vehicle_id":41,"started_at":"2024-02-01T08:00:00Z","ended_at":"2024-02-01T08:30:00Z",
			 "start_lat":52.1,"start_lng":4.3,"end_lat":52.2,"end_lng":4.4,
			 "start_place":null,"end_place":null,"start_odometer_m":1000,"end_odometer_m":21000,
			 "distance_m":20000,"duration_s":1800,"start_soc_pct":80,"end_soc_pct":72,
			 "energy_used_wh":3400,"regen_energy_wh":420,"avg_speed_mps":11.1,"max_speed_mps":30.5,
			 "avg_power_w":6800,"peak_power_w":90000,"ambient_temp_c_avg":9.5,
			 "place_label_version":1,"start_geofence_id":null,"end_geofence_id":null}
		]`),
		"charging_sessions": json.RawMessage(`[
			{"id":800,"vehicle_id":42,"started_at":"2024-02-02T20:00:00Z","ended_at":"2024-02-02T22:00:00Z",
			 "start_soc_pct":30,"end_soc_pct":80,"delta_soc_pct":50,
			 "start_odometer_m":50000,"end_odometer_m":50000,"start_lat":52.0,"start_lng":4.0,
			 "start_place":null,"total_energy_added_wh":37000,"peak_power_w":11000,"avg_power_w":9000,
			 "cost_decimal":"15.4400","cost_currency":"EUR","charger_type":"ac","cable_type":"type2",
			 "geofence_id":null,"rate_id":null,"cost_source":"manual"}
		]`),
		// A TimescaleDB hypertable: chunk routing must survive the
		// import path, which a plain-table fixture cannot demonstrate.
		"positions": json.RawMessage(`[
			{"vehicle_id":41,"ts":"2024-02-01T08:10:00Z","lat":52.15,"lng":4.35,
			 "altitude_m":3,"speed_mps":12.5,"heading_deg":180,"gps_state":"ok",
			 "odometer_m":11000,"est_range_m":250000,"rated_range_m":260000,"ideal_range_m":270000}
		]`),
	}
}

func newRestorerFor(source, target *pgxpool.Pool, data map[string]json.RawMessage) *Restorer {
	return New(fakeVerifier{result: &backupverify.Result{
		OK:             true,
		ChecksumOK:     true,
		RunID:          4242,
		BackupAt:       time.Now().Add(-2 * time.Hour),
		ArtifactSHA256: strings.Repeat("b", 64),
		RestoredData:   data,
	}}, source, target)
}

// TestRealSchemaRestoreImportsProductionArtifact is the end-to-end
// contract: a production-shaped artifact restores into a fully migrated,
// already-seeded scratch database.
func TestRealSchemaRestoreImportsProductionArtifact(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	harness := newRealSchemaHarness(ctx, t)

	source := harness.clone(ctx, t, "teslasync_drill_source_import")
	target := harness.clone(ctx, t, "teslasync_drill_target_import")
	guard := "real-schema-import-guard"
	installGuard(ctx, t, target, guard)

	// Precondition, asserted rather than assumed: the migrated schema
	// arrives with seeded rows. If this ever becomes 0 the regression
	// this test guards has silently stopped being reproducible.
	seededSettings := count(ctx, t, target, "settings")
	if seededSettings == 0 {
		t.Fatal("migrations no longer seed `settings`; the non-empty-scratch regression is no longer covered")
	}
	t.Logf("migrated scratch schema arrives with %d seeded settings rows", seededSettings)

	criticalTables := []string{"vehicles", "drives", "charging_sessions"}
	restorer := newRestorerFor(source, target, productionShapedArtifact())

	result, err := restorer.Run(ctx, guard, criticalTables)
	if err != nil {
		t.Fatalf("Run() error = %v\nresult = %+v", err, result)
	}
	if !result.OK || !result.DatabaseImported || !result.SchemaMigrated {
		t.Fatalf("result = %+v, want a successful import", result)
	}

	// ── Identity handling ────────────────────────────────────────────
	byTable := map[string]TableResult{}
	for _, entry := range result.TablesRestored {
		byTable[entry.Table] = entry
	}
	for _, table := range []string{"vehicles", "alert_rules"} {
		if !byTable[table].IdentityOverride {
			t.Errorf("%s has a GENERATED ALWAYS identity column but the import did not record an override", table)
		}
	}
	for _, table := range []string{"drives", "settings", "positions"} {
		if byTable[table].IdentityOverride {
			t.Errorf("%s has no GENERATED ALWAYS identity column; OVERRIDING SYSTEM VALUE must not be used", table)
		}
	}

	// ── Scratch reset ────────────────────────────────────────────────
	if got := byTable["settings"].ClearedRows; got != seededSettings {
		t.Errorf("settings cleared %d rows, want the %d seeded by migrations", got, seededSettings)
	}

	// ── Row parity ───────────────────────────────────────────────────
	want := map[string]int64{
		"vehicles": 2, "alert_rules": 1, "settings": 2,
		"drives": 1, "charging_sessions": 1, "positions": 1,
	}
	for table, expected := range want {
		if got := count(ctx, t, target, table); got != expected {
			t.Errorf("restored %s has %d rows, want %d", table, got, expected)
		}
	}
	for table, expected := range map[string]int64{"vehicles": 2, "drives": 1, "charging_sessions": 1} {
		if got := result.CriticalTableRows[table]; got != expected {
			t.Errorf("critical_table_rows[%s] = %d, want %d", table, got, expected)
		}
	}

	// ── Production primary keys survived ─────────────────────────────
	var vehicleIDs []int64
	rows, err := target.Query(ctx, "SELECT id FROM vehicles ORDER BY id")
	if err != nil {
		t.Fatalf("read restored vehicle ids: %v", err)
	}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan vehicle id: %v", err)
		}
		vehicleIDs = append(vehicleIDs, id)
	}
	rows.Close()
	if len(vehicleIDs) != 2 || vehicleIDs[0] != 41 || vehicleIDs[1] != 42 {
		t.Errorf("restored vehicle ids = %v, want [41 42]; identity columns re-numbered the artifact", vehicleIDs)
	}

	// ── Foreign keys line up across the restore ──────────────────────
	var joined int64
	if err := target.QueryRow(ctx,
		"SELECT COUNT(*) FROM alert_rules r JOIN vehicles v ON v.id = r.vehicle_id",
	).Scan(&joined); err != nil {
		t.Fatalf("join restored alert_rules to vehicles: %v", err)
	}
	if joined != 1 {
		t.Errorf("restored alert_rules joined to vehicles = %d, want 1", joined)
	}

	// ── Sequences repaired ───────────────────────────────────────────
	//
	// Without a setval the identity sequence still sits at 1 and the
	// first post-restore insert collides with the restored primary key.
	var nextVehicleID int64
	if err := target.QueryRow(ctx, `
		INSERT INTO vehicles (tesla_id, vin, display_name)
		VALUES (2001, '5YJ3E1EA1JF009999', 'Post Restore')
		RETURNING id
	`).Scan(&nextVehicleID); err != nil {
		t.Fatalf("insert after restore (sequence not repaired?): %v", err)
	}
	if nextVehicleID <= 42 {
		t.Errorf("post-restore vehicles.id = %d, want > 42; the identity sequence was not advanced", nextVehicleID)
	}

	// ── Blast radius ─────────────────────────────────────────────────
	//
	// The guard table is not on the restorable allowlist. A CASCADE
	// truncate or an over-broad reset would have taken it with them.
	var guards int64
	if err := target.QueryRow(ctx,
		"SELECT COUNT(*) FROM restore_drill_guard WHERE nonce = $1", guard).Scan(&guards); err != nil {
		t.Fatalf("re-read the scratch guard: %v", err)
	}
	if guards != 1 {
		t.Errorf("scratch guard rows = %d, want 1; the reset reached beyond the allowlist", guards)
	}
	// schema_migrations is likewise off-allowlist and must be intact.
	var schemaVersion uint
	var dirty bool
	if err := target.QueryRow(ctx,
		"SELECT version, dirty FROM schema_migrations LIMIT 1").Scan(&schemaVersion, &dirty); err != nil {
		t.Fatalf("re-read schema_migrations: %v", err)
	}
	if dirty || schemaVersion != result.SchemaVersion {
		t.Errorf("schema_migrations = (%d, %v), want (%d, false)", schemaVersion, dirty, result.SchemaVersion)
	}
}

// TestRealSchemaRestoreIsIdempotent proves the drill can run twice
// against the same scratch database — the reset is what makes a second
// run possible at all.
func TestRealSchemaRestoreIsIdempotent(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	harness := newRealSchemaHarness(ctx, t)

	source := harness.clone(ctx, t, "teslasync_drill_source_repeat")
	target := harness.clone(ctx, t, "teslasync_drill_target_repeat")
	guard := "real-schema-repeat-guard"
	installGuard(ctx, t, target, guard)

	critical := []string{"vehicles", "drives", "charging_sessions"}
	restorer := newRestorerFor(source, target, productionShapedArtifact())

	first, err := restorer.Run(ctx, guard, critical)
	if err != nil {
		t.Fatalf("first Run() error = %v (%+v)", err, first)
	}
	second, err := restorer.Run(ctx, guard, critical)
	if err != nil {
		t.Fatalf("second Run() error = %v (%+v); the drill is not repeatable", err, second)
	}
	if got := count(ctx, t, target, "vehicles"); got != 2 {
		t.Errorf("vehicles after two restores = %d, want 2 (rows were duplicated or lost)", got)
	}
	byTable := map[string]TableResult{}
	for _, entry := range second.TablesRestored {
		byTable[entry.Table] = entry
	}
	if got := byTable["vehicles"].ClearedRows; got != 2 {
		t.Errorf("second run cleared %d vehicles, want the 2 left by the first run", got)
	}
}

// TestRealSchemaRestoreRollsBackOnFailure proves the transactional
// guarantee: a mid-import failure must leave the scratch database
// exactly as the migrations left it, not half-wiped.
func TestRealSchemaRestoreRollsBackOnFailure(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	harness := newRealSchemaHarness(ctx, t)

	source := harness.clone(ctx, t, "teslasync_drill_source_rollback")
	target := harness.clone(ctx, t, "teslasync_drill_target_rollback")
	guard := "real-schema-rollback-guard"
	installGuard(ctx, t, target, guard)
	seededSettings := count(ctx, t, target, "settings")

	artifact := productionShapedArtifact()
	// `drives.vehicle_id` is NOT NULL: this row cannot be inserted, and
	// the failure lands AFTER `settings` has already been cleared.
	artifact["drives"] = json.RawMessage(`[{"id":901,"vehicle_id":null,"started_at":"2024-02-01T08:00:00Z"}]`)

	restorer := newRestorerFor(source, target, artifact)
	result, err := restorer.Run(ctx, guard, []string{"vehicles", "drives", "charging_sessions"})
	if err == nil {
		t.Fatalf("Run() unexpectedly succeeded with an invalid artifact: %+v", result)
	}
	if !strings.Contains(err.Error(), "restore table drives") {
		t.Errorf("error = %v, want it to name the failing table", err)
	}
	if result == nil || result.OK || result.DatabaseImported {
		if result != nil && (result.OK || result.DatabaseImported) {
			t.Errorf("failed restore reported ok=%v imported=%v", result.OK, result.DatabaseImported)
		}
	}

	if got := count(ctx, t, target, "settings"); got != seededSettings {
		t.Errorf("settings after a rolled-back restore = %d, want the original %d; the reset was not transactional",
			got, seededSettings)
	}
	if got := count(ctx, t, target, "vehicles"); got != 0 {
		t.Errorf("vehicles after a rolled-back restore = %d, want 0", got)
	}
}

// TestRealSchemaRestoreRefusesToOrphanNonRestorableRows is the negative
// control for the reset's blast radius.
//
// `notifications` is NOT on the restorable allowlist and references
// `notification_channels` under ON DELETE RESTRICT. Clearing the channel
// table while such a row exists must fail loudly and roll back — never
// leave an orphan and never widen into a CASCADE.
func TestRealSchemaRestoreRefusesToOrphanNonRestorableRows(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	harness := newRealSchemaHarness(ctx, t)

	source := harness.clone(ctx, t, "teslasync_drill_source_orphan")
	target := harness.clone(ctx, t, "teslasync_drill_target_orphan")
	guard := "real-schema-orphan-guard"
	installGuard(ctx, t, target, guard)

	var channelID int64
	if err := target.QueryRow(ctx, `
		INSERT INTO notification_channels (name, kind, enabled)
		VALUES ('pre-existing', 'webhook', true) RETURNING id
	`).Scan(&channelID); err != nil {
		t.Fatalf("seed a pre-existing notification channel: %v", err)
	}
	if _, err := target.Exec(ctx, `
		INSERT INTO notifications (channel_id, severity, title, body)
		VALUES ($1, 'info', 'pre-existing', 'must not be orphaned')
	`, channelID); err != nil {
		t.Fatalf("seed a non-restorable dependent row: %v", err)
	}

	artifact := productionShapedArtifact()
	// notification_channels is allowlisted, so the reset reaches it.
	artifact["notification_channels"] = json.RawMessage(`[
		{"id":5,"name":"restored","kind":"webhook","enabled":true,"created_at":"2024-01-01T00:00:00Z",
		 "updated_at":"2024-01-01T00:00:00Z"}
	]`)

	restorer := newRestorerFor(source, target, artifact)
	_, err := restorer.Run(ctx, guard, []string{"vehicles", "drives", "charging_sessions"})
	if err == nil {
		t.Fatal("the restore cleared a table that a RESTRICT-referencing non-restorable row still points at")
	}
	if !strings.Contains(err.Error(), "clear scratch table notification_channels") {
		t.Errorf("error = %v, want an explicit clear-phase failure naming the table", err)
	}

	// Nothing was committed: the dependent row is still intact.
	var dependents int64
	if err := target.QueryRow(ctx, "SELECT COUNT(*) FROM notifications").Scan(&dependents); err != nil {
		t.Fatalf("re-read the dependent table: %v", err)
	}
	if dependents != 1 {
		t.Errorf("notifications rows = %d, want 1", dependents)
	}
}

// TestRealSchemaRestoreMeasuresCascadeCollateral pins the honest half of
// the contract: where the schema declares ON DELETE CASCADE the reset
// does remove dependent rows, and that must appear in the evidence
// rather than happening silently.
func TestRealSchemaRestoreMeasuresCascadeCollateral(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	harness := newRealSchemaHarness(ctx, t)

	source := harness.clone(ctx, t, "teslasync_drill_source_collateral")
	target := harness.clone(ctx, t, "teslasync_drill_target_collateral")
	guard := "real-schema-collateral-guard"
	installGuard(ctx, t, target, guard)

	// vehicle_settings references vehicles ON DELETE CASCADE and is not
	// on the restorable allowlist.
	var vehicleID int64
	if err := target.QueryRow(ctx, `
		INSERT INTO vehicles (tesla_id, vin, display_name)
		VALUES (3001, '5YJ3E1EA1JF003001', 'Pre-existing') RETURNING id
	`).Scan(&vehicleID); err != nil {
		t.Fatalf("seed a pre-existing vehicle: %v", err)
	}
	if _, err := target.Exec(ctx, `
		INSERT INTO vehicle_settings (vehicle_id, setting_key, value_text, data_kind)
		VALUES ($1, 'theme', 'dark', 'text')
	`, vehicleID); err != nil {
		t.Fatalf("seed a cascade-dependent row: %v", err)
	}

	restorer := newRestorerFor(source, target, productionShapedArtifact())
	result, err := restorer.Run(ctx, guard, []string{"vehicles", "drives", "charging_sessions"})
	if err != nil {
		t.Fatalf("Run() error = %v (%+v)", err, result)
	}
	if got := result.CollateralRowsCleared["vehicle_settings"]; got != 1 {
		t.Errorf("collateral_rows_cleared[vehicle_settings] = %d, want 1; the cascade was not measured", got)
	}
	if got := count(ctx, t, target, "vehicle_settings"); got != 0 {
		t.Errorf("vehicle_settings rows = %d, want 0", got)
	}
	// The evidence must not claim collateral that did not happen.
	if got := result.CollateralRowsCleared["restore_drill_guard"]; got != 0 {
		t.Errorf("the guard table was reported as collateral (%d rows)", got)
	}
}

// TestRealSchemaRestoreRejectsNonScratchTarget proves the guardrails did
// not weaken when the import gained the power to DELETE.
func TestRealSchemaRestoreRejectsNonScratchTarget(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	harness := newRealSchemaHarness(ctx, t)

	source := harness.clone(ctx, t, "teslasync_drill_source_guarded")
	// Deliberately NOT named as a drill database.
	target := harness.clone(ctx, t, "teslasync_production_lookalike")
	installGuard(ctx, t, target, "real-schema-guarded")
	seededSettings := count(ctx, t, target, "settings")

	restorer := newRestorerFor(source, target, productionShapedArtifact())
	if _, err := restorer.Run(ctx, "real-schema-guarded", []string{"vehicles"}); err == nil ||
		!strings.Contains(err.Error(), "isolated restore drill") {
		t.Fatalf("Run() error = %v, want a scratch-name rejection", err)
	}
	if got := count(ctx, t, target, "settings"); got != seededSettings {
		t.Errorf("a rejected target lost %d settings rows", seededSettings-got)
	}

	// A correct name with the wrong guard nonce must fail too.
	guarded := harness.clone(ctx, t, "teslasync_drill_target_wrongnonce")
	installGuard(ctx, t, guarded, "the-real-nonce")
	restorer = newRestorerFor(source, guarded, productionShapedArtifact())
	if _, err := restorer.Run(ctx, "an-attacker-supplied-nonce", []string{"vehicles"}); err == nil ||
		!strings.Contains(err.Error(), "guard") {
		t.Fatalf("Run() error = %v, want a guard rejection", err)
	}
	if got := count(ctx, t, guarded, "settings"); got == 0 {
		t.Error("a guard-rejected target was cleared anyway")
	}

	// Source and target resolving to the same database is the one
	// mistake that would let a drill delete production.
	if _, err := validateScratchTarget(ctx, guarded, guarded, "the-real-nonce"); err == nil ||
		!strings.Contains(err.Error(), "same database") {
		t.Fatalf("same source/target error = %v, want isolation rejection", err)
	}
}
