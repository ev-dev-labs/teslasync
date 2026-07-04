package energy

import (
	"context"
	"strings"
	"testing"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

// TestTeslaEnergyHistorySQL_Shape pins the energy-history select + upsert.
// The ON CONFLICT target is the natural key that keeps calendar-history
// idempotent across refetches; dropping a key column would silently
// duplicate rows.
func TestTeslaEnergyHistorySQL_Shape(t *testing.T) {
	t.Parallel()

	selMust := []string{
		"FROM tesla_energy_history",
		"WHERE energy_site_id = $1 AND period = $2 AND timestamp >= $3 AND timestamp <= $4",
		"ORDER BY timestamp ASC",
		"LIMIT $5",
		"solar_energy_wh", "battery_energy_in_wh", "battery_energy_out_wh",
		"grid_energy_in_wh", "grid_energy_out_wh", "consumer_energy_wh",
	}
	for _, frag := range selMust {
		if !strings.Contains(teslaEnergyHistorySelectSQL, frag) {
			t.Errorf("teslaEnergyHistorySelectSQL missing %q\n%s", frag, teslaEnergyHistorySelectSQL)
		}
	}

	upMust := []string{
		"INSERT INTO tesla_energy_history",
		"ON CONFLICT (energy_site_id, period, timestamp) DO UPDATE SET",
		"solar_energy_wh = EXCLUDED.solar_energy_wh",
		"consumer_energy_wh = EXCLUDED.consumer_energy_wh",
		"fetched_at = EXCLUDED.fetched_at",
	}
	for _, frag := range upMust {
		if !strings.Contains(teslaEnergyHistoryUpsertSQL, frag) {
			t.Errorf("teslaEnergyHistoryUpsertSQL missing %q\n%s", frag, teslaEnergyHistoryUpsertSQL)
		}
	}
}

// TestTeslaEnergyBackupSQL_Shape pins the backup-event select + upsert.
func TestTeslaEnergyBackupSQL_Shape(t *testing.T) {
	t.Parallel()

	selMust := []string{
		"FROM tesla_energy_backup_events",
		"WHERE energy_site_id = $1 AND timestamp >= $2 AND timestamp <= $3",
		"ORDER BY timestamp ASC",
		"LIMIT $4",
		"duration_seconds",
	}
	for _, frag := range selMust {
		if !strings.Contains(teslaEnergyBackupSelectSQL, frag) {
			t.Errorf("teslaEnergyBackupSelectSQL missing %q\n%s", frag, teslaEnergyBackupSelectSQL)
		}
	}

	upMust := []string{
		"INSERT INTO tesla_energy_backup_events",
		"ON CONFLICT (energy_site_id, period, timestamp) DO UPDATE SET",
		"duration_seconds = EXCLUDED.duration_seconds",
	}
	for _, frag := range upMust {
		if !strings.Contains(teslaEnergyBackupUpsertSQL, frag) {
			t.Errorf("teslaEnergyBackupUpsertSQL missing %q\n%s", frag, teslaEnergyBackupUpsertSQL)
		}
	}
}

// TestTeslaEnergyWCSQL_Shape pins the wall-connector select + upsert. The
// COALESCE(din, empty-string) in the conflict target lets a NULL DIN still
// participate in the natural key.
func TestTeslaEnergyWCSQL_Shape(t *testing.T) {
	t.Parallel()

	selMust := []string{
		"FROM tesla_energy_wc_charging",
		"WHERE energy_site_id = $1 AND timestamp >= $2 AND timestamp <= $3",
		"ORDER BY timestamp ASC",
		"LIMIT $4",
		"energy_wh",
	}
	for _, frag := range selMust {
		if !strings.Contains(teslaEnergyWCSelectSQL, frag) {
			t.Errorf("teslaEnergyWCSelectSQL missing %q\n%s", frag, teslaEnergyWCSelectSQL)
		}
	}

	upMust := []string{
		"INSERT INTO tesla_energy_wc_charging",
		"ON CONFLICT (energy_site_id, COALESCE(din, ''), timestamp) DO UPDATE SET",
		"energy_wh = EXCLUDED.energy_wh",
	}
	for _, frag := range upMust {
		if !strings.Contains(teslaEnergyWCUpsertSQL, frag) {
			t.Errorf("teslaEnergyWCUpsertSQL missing %q\n%s", frag, teslaEnergyWCUpsertSQL)
		}
	}
}

// TestHistoryUpsertBatch_Empty confirms the fast-path: an empty batch is
// a no-op that reports zero upserts and never touches the pool (db is
// nil here, so any pool access would panic).
func TestHistoryUpsertBatch_Empty(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	histRepo := &TeslaEnergyHistoryRepo{db: nil}
	if n, err := histRepo.UpsertBatch(ctx, nil); err != nil || n != 0 {
		t.Errorf("history UpsertBatch(nil) = (%d, %v), want (0, nil)", n, err)
	}
	if n, err := histRepo.UpsertBatch(ctx, []*teslamodel.TeslaEnergyHistory{}); err != nil || n != 0 {
		t.Errorf("history UpsertBatch([]) = (%d, %v), want (0, nil)", n, err)
	}

	backupRepo := &TeslaEnergyBackupEventRepo{db: nil}
	if n, err := backupRepo.UpsertBatch(ctx, nil); err != nil || n != 0 {
		t.Errorf("backup UpsertBatch(nil) = (%d, %v), want (0, nil)", n, err)
	}

	wcRepo := &TeslaEnergyWCChargingRepo{db: nil}
	if n, err := wcRepo.UpsertBatch(ctx, nil); err != nil || n != 0 {
		t.Errorf("wc UpsertBatch(nil) = (%d, %v), want (0, nil)", n, err)
	}
}

// TestHistoryUpsertBatch_NilEntryRejected pins the nil-entry guard: a nil
// element must surface an error at the offending index before any Exec,
// so a malformed batch can't nil-deref inside the loop.
func TestHistoryUpsertBatch_NilEntryRejected(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	histRepo := &TeslaEnergyHistoryRepo{db: nil}
	if n, err := histRepo.UpsertBatch(ctx, []*teslamodel.TeslaEnergyHistory{nil}); err == nil || n != 0 {
		t.Errorf("history UpsertBatch([nil]) = (%d, %v), want (0, error)", n, err)
	}

	backupRepo := &TeslaEnergyBackupEventRepo{db: nil}
	if n, err := backupRepo.UpsertBatch(ctx, []*teslamodel.TeslaEnergyBackupEvent{nil}); err == nil || n != 0 {
		t.Errorf("backup UpsertBatch([nil]) = (%d, %v), want (0, error)", n, err)
	}

	wcRepo := &TeslaEnergyWCChargingRepo{db: nil}
	if n, err := wcRepo.UpsertBatch(ctx, []*teslamodel.TeslaEnergyWCCharging{nil}); err == nil || n != 0 {
		t.Errorf("wc UpsertBatch([nil]) = (%d, %v), want (0, error)", n, err)
	}
}

// TestHistoryConstructors_NilDBPanic covers the fail-fast contract for
// all three history-family constructors.
func TestHistoryConstructors_NilDBPanic(t *testing.T) {
	t.Parallel()
	ctors := map[string]func(){
		"NewTeslaEnergyHistoryRepo":     func() { _ = NewTeslaEnergyHistoryRepo(nil) },
		"NewTeslaEnergyBackupEventRepo": func() { _ = NewTeslaEnergyBackupEventRepo(nil) },
		"NewTeslaEnergyWCChargingRepo":  func() { _ = NewTeslaEnergyWCChargingRepo(nil) },
	}
	for name, ctor := range ctors {
		name, ctor := name, ctor
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			defer func() {
				if recover() == nil {
					t.Fatalf("expected %s(nil) to panic", name)
				}
			}()
			ctor()
		})
	}
}
