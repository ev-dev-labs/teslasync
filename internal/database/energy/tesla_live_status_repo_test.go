package energy

import (
	"context"
	"strings"
	"testing"
)

// TestTeslaEnergyLiveStatusSQL_Shape pins the insert, latest, and history
// queries for the live-status snapshots. All 14 power/state columns must
// be present and in a stable order so the positional Scan stays aligned.
func TestTeslaEnergyLiveStatusSQL_Shape(t *testing.T) {
	t.Parallel()

	cols := []string{
		"energy_site_id", "solar_power", "battery_power", "load_power",
		"grid_power", "grid_services_power", "energy_left", "total_pack_energy",
		"percentage_charged", "grid_status", "backup_capable", "storm_mode_active",
		"timestamp", "fetched_at",
	}

	insertMust := append([]string{
		"INSERT INTO tesla_energy_live_status",
		"VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
		"RETURNING id",
	}, cols...)
	for _, frag := range insertMust {
		if !strings.Contains(teslaEnergyLiveStatusInsertSQL, frag) {
			t.Errorf("teslaEnergyLiveStatusInsertSQL missing %q\n%s", frag, teslaEnergyLiveStatusInsertSQL)
		}
	}

	latestMust := []string{
		"FROM tesla_energy_live_status",
		"WHERE energy_site_id = $1",
		"ORDER BY timestamp DESC",
		"LIMIT 1",
	}
	for _, frag := range latestMust {
		if !strings.Contains(teslaEnergyLiveStatusLatestSQL, frag) {
			t.Errorf("teslaEnergyLiveStatusLatestSQL missing %q\n%s", frag, teslaEnergyLiveStatusLatestSQL)
		}
	}

	historyMust := []string{
		"FROM tesla_energy_live_status",
		"WHERE energy_site_id = $1 AND timestamp >= $2 AND timestamp <= $3",
		"ORDER BY timestamp ASC",
		"LIMIT $4",
	}
	for _, frag := range historyMust {
		if !strings.Contains(teslaEnergyLiveStatusHistorySQL, frag) {
			t.Errorf("teslaEnergyLiveStatusHistorySQL missing %q\n%s", frag, teslaEnergyLiveStatusHistorySQL)
		}
	}

	// The latest-snapshot query is the current-state read path: it must
	// order newest-first and cap at a single row.
	if strings.Contains(teslaEnergyLiveStatusLatestSQL, "ORDER BY timestamp ASC") {
		t.Error("latest query must be DESC (newest-first), not ASC")
	}
}

// TestLiveStatusCreate_NilRejected pins the defence-in-depth nil guard so
// a nil snapshot fails before any pool access (db is nil here).
func TestLiveStatusCreate_NilRejected(t *testing.T) {
	t.Parallel()
	repo := &TeslaEnergyLiveStatusRepo{db: nil}
	err := repo.Create(context.Background(), nil)
	if err == nil {
		t.Fatal("Create(nil) must return an error")
	}
	if !strings.Contains(err.Error(), "nil snapshot") {
		t.Errorf("Create(nil) error = %q, want it to mention nil snapshot", err.Error())
	}
}

// TestNewTeslaEnergyLiveStatusRepo_NilDBPanics covers the fail-fast
// construction contract.
func TestNewTeslaEnergyLiveStatusRepo_NilDBPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if recover() == nil {
			t.Fatal("expected NewTeslaEnergyLiveStatusRepo(nil) to panic")
		}
	}()
	_ = NewTeslaEnergyLiveStatusRepo(nil)
}
