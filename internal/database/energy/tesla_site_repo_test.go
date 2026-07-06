package energy

import (
	"strings"
	"testing"
)

// TestTeslaEnergySiteSQL_Shape pins the site select/upsert/delete and the
// site-info accessors. The most important invariant is that the upsert's
// DO UPDATE SET does NOT touch site_info_json / site_info_fetched_at — a
// product-list refresh must preserve the separately-fetched site_info
// blob (see ReplaceAll doc + UpdateSiteInfo).
func TestTeslaEnergySiteSQL_Shape(t *testing.T) {
	t.Parallel()

	selMust := []string{
		"FROM tesla_energy_sites",
		"ORDER BY site_name ASC",
		"energy_site_id", "resource_type", "site_name",
		"backup_capable", "storm_mode_enabled",
		"has_solar", "has_battery", "has_grid", "has_load_meter",
		"tou_capable", "storm_mode_capable",
		"site_info_fetched_at",
	}
	for _, frag := range selMust {
		if !strings.Contains(teslaEnergySiteSelectAllSQL, frag) {
			t.Errorf("teslaEnergySiteSelectAllSQL missing %q\n%s", frag, teslaEnergySiteSelectAllSQL)
		}
	}

	upMust := []string{
		"INSERT INTO tesla_energy_sites",
		"ON CONFLICT (energy_site_id) DO UPDATE SET",
		"resource_type = EXCLUDED.resource_type",
		"storm_mode_capable = EXCLUDED.storm_mode_capable",
		"updated_at = EXCLUDED.updated_at",
	}
	for _, frag := range upMust {
		if !strings.Contains(teslaEnergySiteUpsertSQL, frag) {
			t.Errorf("teslaEnergySiteUpsertSQL missing %q\n%s", frag, teslaEnergySiteUpsertSQL)
		}
	}

	// Preservation invariant: the conflict-update path must leave the
	// site_info columns untouched.
	updateClause := teslaEnergySiteUpsertSQL[strings.Index(teslaEnergySiteUpsertSQL, "DO UPDATE SET"):]
	for _, banned := range []string{"site_info_json = EXCLUDED", "site_info_fetched_at = EXCLUDED"} {
		if strings.Contains(updateClause, banned) {
			t.Errorf("upsert DO UPDATE SET must not overwrite site_info (%q) — it is preserved across refreshes", banned)
		}
	}

	// Delete variants: scoped anti-join when we have IDs, full wipe when
	// the incoming set is empty.
	if !strings.Contains(teslaEnergySiteDeleteStaleSQL, "energy_site_id != ALL($1)") {
		t.Errorf("teslaEnergySiteDeleteStaleSQL must anti-join on the incoming id set\n%s", teslaEnergySiteDeleteStaleSQL)
	}
	if strings.TrimSpace(teslaEnergySiteDeleteAllSQL) != "DELETE FROM tesla_energy_sites" {
		t.Errorf("teslaEnergySiteDeleteAllSQL = %q, want a bare full-table delete", teslaEnergySiteDeleteAllSQL)
	}

	getInfoMust := []string{"site_info_json", "site_info_fetched_at", "WHERE energy_site_id = $1"}
	for _, frag := range getInfoMust {
		if !strings.Contains(teslaEnergySiteGetSiteInfoSQL, frag) {
			t.Errorf("teslaEnergySiteGetSiteInfoSQL missing %q\n%s", frag, teslaEnergySiteGetSiteInfoSQL)
		}
	}

	updInfoMust := []string{
		"UPDATE tesla_energy_sites",
		"site_info_json = $1",
		"site_info_fetched_at = $2",
		"updated_at = $3",
		"WHERE energy_site_id = $4",
	}
	for _, frag := range updInfoMust {
		if !strings.Contains(teslaEnergySiteUpdateSiteInfoSQL, frag) {
			t.Errorf("teslaEnergySiteUpdateSiteInfoSQL missing %q\n%s", frag, teslaEnergySiteUpdateSiteInfoSQL)
		}
	}
}

// TestTeslaEnergySiteUpsertParams pins the 18-parameter placeholder list
// so a column added to the INSERT list without a matching bind (or vice
// versa) fails at build time.
func TestTeslaEnergySiteUpsertParams(t *testing.T) {
	t.Parallel()
	if !strings.Contains(teslaEnergySiteUpsertSQL, "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)") {
		t.Errorf("teslaEnergySiteUpsertSQL must bind exactly 18 positional params\n%s", teslaEnergySiteUpsertSQL)
	}
}

// TestNewTeslaEnergySiteRepo_NilDBPanics covers the fail-fast
// construction contract.
func TestNewTeslaEnergySiteRepo_NilDBPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if recover() == nil {
			t.Fatal("expected NewTeslaEnergySiteRepo(nil) to panic")
		}
	}()
	_ = NewTeslaEnergySiteRepo(nil)
}
