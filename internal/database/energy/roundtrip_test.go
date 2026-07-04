package energy

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/database"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

// The round-trips below exercise the real Scan paths against a live
// TimescaleDB. They run only when DATABASE_URL/TESLASYNC_TEST_DSN points
// at a reachable instance with migrations applied, mirroring
// ai/call_log_repo_test.go. They confine themselves to the FK-free
// tesla_energy_* tables, use unique test site ids, and clean up after
// themselves — in particular they never call the destructive full-table
// ReplaceAll against a shared database.

func ptrF(f float64) *float64 { return &f }
func ptrS(s string) *string   { return &s }

// dsnOrSkip returns the configured live-DB DSN or skips the test.
func dsnOrSkip(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("TESLASYNC_TEST_DSN")
	}
	if dsn == "" {
		t.Skip("DATABASE_URL/TESLASYNC_TEST_DSN not set; skipping energy round-trip tests")
	}
	return dsn
}

// openTestDB opens a lazily-connected pool and skips (never fails) when
// the database is unreachable, so a missing dev DB can't break the gate.
func openTestDB(t *testing.T, dsn string) *database.DB {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("cannot reach database: %v", err)
	}
	return &database.DB{Pool: pool}
}

func requireTable(t *testing.T, db *database.DB, name string) {
	t.Helper()
	var has bool
	err := db.Pool.QueryRow(context.Background(),
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables
		                WHERE table_schema='public' AND table_name=$1)`, name).Scan(&has)
	if err != nil {
		t.Skipf("table check for %s failed: %v", name, err)
	}
	if !has {
		t.Skipf("table %s missing; run migrations against this DSN", name)
	}
}

func requireColumn(t *testing.T, db *database.DB, table, column string) {
	t.Helper()
	var has bool
	err := db.Pool.QueryRow(context.Background(),
		`SELECT EXISTS (SELECT 1 FROM information_schema.columns
		                WHERE table_schema='public' AND table_name=$1 AND column_name=$2)`,
		table, column).Scan(&has)
	if err != nil {
		t.Skipf("column check for %s.%s failed: %v", table, column, err)
	}
	if !has {
		t.Skipf("column %s.%s missing; run migrations against this DSN", table, column)
	}
}

// TestTeslaEnergyHistoryRepo_RoundTrip covers UpsertBatch idempotency, the
// period + range filter, and ASC ordering against a live DB.
func TestTeslaEnergyHistoryRepo_RoundTrip(t *testing.T) {
	db := openTestDB(t, dsnOrSkip(t))
	requireTable(t, db, "tesla_energy_history")
	repo := NewTeslaEnergyHistoryRepo(db)
	ctx := context.Background()

	const siteID = int64(990101)
	clean := func() { _, _ = db.Pool.Exec(ctx, `DELETE FROM tesla_energy_history WHERE energy_site_id=$1`, siteID) }
	clean()
	t.Cleanup(clean)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	entries := []*teslamodel.TeslaEnergyHistory{
		{EnergySiteID: siteID, Period: "day", Timestamp: base, SolarEnergyWh: ptrF(1000), ConsumerEnergyWh: ptrF(800)},
		{EnergySiteID: siteID, Period: "day", Timestamp: base.Add(24 * time.Hour), SolarEnergyWh: ptrF(1200)},
	}
	n, err := repo.UpsertBatch(ctx, entries)
	if err != nil {
		t.Fatalf("UpsertBatch: %v", err)
	}
	if n != 2 {
		t.Fatalf("UpsertBatch n=%d, want 2", n)
	}

	// Re-upsert must update in place (natural key = site,period,timestamp).
	entries[0].SolarEnergyWh = ptrF(1111)
	if _, err := repo.UpsertBatch(ctx, entries); err != nil {
		t.Fatalf("re-upsert: %v", err)
	}

	got, err := repo.GetByRange(ctx, siteID, "day", base.Add(-time.Hour), base.Add(48*time.Hour), 100)
	if err != nil {
		t.Fatalf("GetByRange: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("GetByRange len=%d, want 2 (idempotent upsert must not duplicate)", len(got))
	}
	if !got[0].Timestamp.Before(got[1].Timestamp) {
		t.Error("results must be ASC by timestamp")
	}
	if got[0].SolarEnergyWh == nil || *got[0].SolarEnergyWh != 1111 {
		t.Errorf("idempotent update not applied: %v", got[0].SolarEnergyWh)
	}

	none, err := repo.GetByRange(ctx, siteID, "month", base.Add(-time.Hour), base.Add(48*time.Hour), 100)
	if err != nil {
		t.Fatalf("GetByRange(month): %v", err)
	}
	if len(none) != 0 {
		t.Errorf("period filter leaked: got %d rows for 'month'", len(none))
	}
}

// TestTeslaEnergyBackupEventRepo_RoundTrip covers upsert + range filter.
func TestTeslaEnergyBackupEventRepo_RoundTrip(t *testing.T) {
	db := openTestDB(t, dsnOrSkip(t))
	requireTable(t, db, "tesla_energy_backup_events")
	repo := NewTeslaEnergyBackupEventRepo(db)
	ctx := context.Background()

	const siteID = int64(990102)
	clean := func() {
		_, _ = db.Pool.Exec(ctx, `DELETE FROM tesla_energy_backup_events WHERE energy_site_id=$1`, siteID)
	}
	clean()
	t.Cleanup(clean)

	base := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	entries := []*teslamodel.TeslaEnergyBackupEvent{
		{EnergySiteID: siteID, Period: "day", Timestamp: base, DurationSeconds: 600},
		{EnergySiteID: siteID, Period: "day", Timestamp: base.Add(time.Hour), DurationSeconds: 120},
	}
	if _, err := repo.UpsertBatch(ctx, entries); err != nil {
		t.Fatalf("UpsertBatch: %v", err)
	}

	got, err := repo.GetByRange(ctx, siteID, base.Add(-time.Minute), base.Add(2*time.Hour), 100)
	if err != nil {
		t.Fatalf("GetByRange: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("GetByRange len=%d, want 2", len(got))
	}
	if got[0].DurationSeconds != 600 {
		t.Errorf("first event duration = %d, want 600", got[0].DurationSeconds)
	}

	// A window that starts after both events must return nothing.
	empty, err := repo.GetByRange(ctx, siteID, base.Add(3*time.Hour), base.Add(4*time.Hour), 100)
	if err != nil {
		t.Fatalf("GetByRange(empty window): %v", err)
	}
	if len(empty) != 0 {
		t.Errorf("range filter leaked: got %d rows", len(empty))
	}
}

// TestTeslaEnergyWCChargingRepo_RoundTrip covers upsert with a NULL DIN
// participating in the COALESCE(din, empty-string) natural key.
func TestTeslaEnergyWCChargingRepo_RoundTrip(t *testing.T) {
	db := openTestDB(t, dsnOrSkip(t))
	requireTable(t, db, "tesla_energy_wc_charging")
	repo := NewTeslaEnergyWCChargingRepo(db)
	ctx := context.Background()

	const siteID = int64(990103)
	clean := func() {
		_, _ = db.Pool.Exec(ctx, `DELETE FROM tesla_energy_wc_charging WHERE energy_site_id=$1`, siteID)
	}
	clean()
	t.Cleanup(clean)

	base := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	entries := []*teslamodel.TeslaEnergyWCCharging{
		{EnergySiteID: siteID, DIN: nil, Timestamp: base, EnergyWh: ptrF(500)},
		{EnergySiteID: siteID, DIN: ptrS("ABC-123"), Timestamp: base, EnergyWh: ptrF(700)},
	}
	if _, err := repo.UpsertBatch(ctx, entries); err != nil {
		t.Fatalf("UpsertBatch: %v", err)
	}

	// Re-upsert the NULL-DIN row: COALESCE(din, empty-string) keeps it a single row.
	if _, err := repo.UpsertBatch(ctx, []*teslamodel.TeslaEnergyWCCharging{
		{EnergySiteID: siteID, DIN: nil, Timestamp: base, EnergyWh: ptrF(555)},
	}); err != nil {
		t.Fatalf("re-upsert null din: %v", err)
	}

	got, err := repo.GetByRange(ctx, siteID, base.Add(-time.Hour), base.Add(time.Hour), 100)
	if err != nil {
		t.Fatalf("GetByRange: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("GetByRange len=%d, want 2 (null + non-null din)", len(got))
	}
}

// TestTeslaEnergyLiveStatusRepo_RoundTrip covers Create timestamp
// defaulting, GetLatest (newest-first), GetHistory (ASC), and the
// no-rows (nil, nil) contract.
func TestTeslaEnergyLiveStatusRepo_RoundTrip(t *testing.T) {
	db := openTestDB(t, dsnOrSkip(t))
	requireTable(t, db, "tesla_energy_live_status")
	repo := NewTeslaEnergyLiveStatusRepo(db)
	ctx := context.Background()

	const siteID = int64(990104)
	clean := func() {
		_, _ = db.Pool.Exec(ctx, `DELETE FROM tesla_energy_live_status WHERE energy_site_id=$1`, siteID)
	}
	clean()
	t.Cleanup(clean)

	// Unknown site → (nil, nil), not an error.
	if s, err := repo.GetLatest(ctx, siteID); err != nil || s != nil {
		t.Fatalf("GetLatest(empty) = (%v, %v), want (nil, nil)", s, err)
	}

	base := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	older := &teslamodel.TeslaEnergyLiveStatus{EnergySiteID: siteID, SolarPower: ptrF(100), Timestamp: base}
	newer := &teslamodel.TeslaEnergyLiveStatus{EnergySiteID: siteID, SolarPower: ptrF(250), Timestamp: base.Add(time.Hour)}
	if err := repo.Create(ctx, older); err != nil {
		t.Fatalf("Create older: %v", err)
	}
	if older.ID == 0 {
		t.Error("Create must populate the RETURNING id")
	}
	if err := repo.Create(ctx, newer); err != nil {
		t.Fatalf("Create newer: %v", err)
	}

	latest, err := repo.GetLatest(ctx, siteID)
	if err != nil {
		t.Fatalf("GetLatest: %v", err)
	}
	if latest == nil || latest.SolarPower == nil || *latest.SolarPower != 250 {
		t.Errorf("GetLatest returned the wrong (non-newest) snapshot: %+v", latest)
	}

	hist, err := repo.GetHistory(ctx, siteID, base.Add(-time.Hour), base.Add(2*time.Hour), 100)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(hist) != 2 {
		t.Fatalf("GetHistory len=%d, want 2", len(hist))
	}
	if !hist[0].Timestamp.Before(hist[1].Timestamp) {
		t.Error("GetHistory must be ASC by timestamp")
	}

	// Create with a zero timestamp must default to now (not the zero year).
	zeroTS := &teslamodel.TeslaEnergyLiveStatus{EnergySiteID: siteID, SolarPower: ptrF(1)}
	if err := repo.Create(ctx, zeroTS); err != nil {
		t.Fatalf("Create zero-ts: %v", err)
	}
	if zeroTS.Timestamp.IsZero() {
		t.Error("Create must default a zero Timestamp to now()")
	}
}

// TestTeslaEnergySiteRepo_RoundTrip covers GetAll, GetSiteInfo (absent →
// nil), UpdateSiteInfo, and the not-found update error — WITHOUT invoking
// the destructive full-table ReplaceAll on a shared database.
func TestTeslaEnergySiteRepo_RoundTrip(t *testing.T) {
	db := openTestDB(t, dsnOrSkip(t))
	requireTable(t, db, "tesla_energy_sites")
	requireColumn(t, db, "tesla_energy_sites", "site_info_json")
	repo := NewTeslaEnergySiteRepo(db)
	ctx := context.Background()

	const siteID = int64(990105)
	clean := func() { _, _ = db.Pool.Exec(ctx, `DELETE FROM tesla_energy_sites WHERE energy_site_id=$1`, siteID) }
	clean()
	t.Cleanup(clean)

	// Seed one row directly (bypassing ReplaceAll's full-table delete).
	if _, err := db.Pool.Exec(ctx,
		`INSERT INTO tesla_energy_sites (energy_site_id, site_name) VALUES ($1, $2)`,
		siteID, "roundtrip-site"); err != nil {
		t.Fatalf("seed site: %v", err)
	}

	// site_info absent → (nil, nil, nil).
	j, ts, err := repo.GetSiteInfo(ctx, siteID)
	if err != nil {
		t.Fatalf("GetSiteInfo(fresh): %v", err)
	}
	if j != nil || ts != nil {
		t.Errorf("GetSiteInfo(fresh) = (%v, %v), want (nil, nil)", j, ts)
	}

	// Unknown site → (nil, nil, nil), not an error.
	if j, ts, err := repo.GetSiteInfo(ctx, int64(990199)); err != nil || j != nil || ts != nil {
		t.Errorf("GetSiteInfo(unknown) = (%v, %v, %v), want (nil, nil, nil)", j, ts, err)
	}

	if err := repo.UpdateSiteInfo(ctx, siteID, `{"version":1}`); err != nil {
		t.Fatalf("UpdateSiteInfo: %v", err)
	}
	j, ts, err = repo.GetSiteInfo(ctx, siteID)
	if err != nil {
		t.Fatalf("GetSiteInfo(after update): %v", err)
	}
	if j == nil || *j != `{"version":1}` {
		t.Errorf("GetSiteInfo json = %v, want {\"version\":1}", j)
	}
	if ts == nil {
		t.Error("GetSiteInfo must return a non-nil fetched_at after UpdateSiteInfo")
	}

	// UpdateSiteInfo on a non-existent site must error (RowsAffected == 0).
	if err := repo.UpdateSiteInfo(ctx, int64(990198), "{}"); err == nil {
		t.Error("UpdateSiteInfo(unknown site) must return an error")
	}

	// GetAll must surface our seeded site.
	all, err := repo.GetAll(ctx)
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	found := false
	for _, s := range all {
		if s.EnergySiteID == siteID {
			found = true
			break
		}
	}
	if !found {
		t.Error("GetAll did not include the seeded site")
	}
}
