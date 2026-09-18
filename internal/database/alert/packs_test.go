package alert

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/alertpacks"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPacksNilDatabase(t *testing.T) {
	for _, repo := range []*AlertRuleRepo{nil, {}, NewAlertRuleRepo(&database.DB{})} {
		if _, err := repo.ListPackInstallations(context.Background(), 20, 0); err == nil {
			t.Fatal("expected unavailable")
		}
		if _, err := repo.InstallPack(context.Background(), alertpacks.Pack{}, "", nil); err == nil {
			t.Fatal("expected unavailable")
		}
		if err := repo.RemovePack(context.Background(), 1, nil); err == nil {
			t.Fatal("expected unavailable")
		}
	}
}

func TestPacksPostgres(t *testing.T) {
	dsn := os.Getenv("TESLASYNC_TEST_DB")
	if dsn == "" {
		t.Skip("TESLASYNC_TEST_DB unset")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("alert_packs_test_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := admin.Exec(context.Background(), "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Error(err)
		}
	}()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	_, err = pool.Exec(ctx, `
		CREATE TABLE vehicles(id BIGINT PRIMARY KEY);
		INSERT INTO vehicles VALUES (1),(2);
		CREATE TABLE alert_rules(
			id BIGSERIAL PRIMARY KEY, name TEXT, description TEXT, enabled BOOLEAN, vehicle_id BIGINT,
			all_vehicles BOOLEAN, signal_name TEXT, op TEXT, value_num DOUBLE PRECISION, value_text TEXT,
			value_bool BOOLEAN, value_min DOUBLE PRECISION, value_max DOUBLE PRECISION, severity TEXT,
			cooldown_min INTEGER, trigger_mode TEXT, snoozed_until TIMESTAMPTZ, kind TEXT, metric_id TEXT,
			metric_window TEXT, metric_threshold DOUBLE PRECISION, metric_op TEXT, max_fires_per_resolution INTEGER,
			escalation_after_min INTEGER, escalation_severity TEXT, msg_template TEXT, include_title BOOLEAN,
			created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
		CREATE TABLE alert_rule_vehicles(rule_id BIGINT REFERENCES alert_rules(id) ON DELETE CASCADE,
			vehicle_id BIGINT REFERENCES vehicles(id), PRIMARY KEY(rule_id,vehicle_id));`)
	if err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000245_alert_packs.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	repo := NewAlertRuleRepo(&database.DB{Pool: pool})
	install := func(id string, ids []int64) (*alertpacks.Installation, error) {
		pack, _ := alertpacks.Find(id)
		req := alertpacks.InstallRequest{Version: 1, AllVehicles: ids == nil, VehicleIDs: ids}
		for _, rule := range pack.Rules {
			req.Rules = append(req.Rules, alertpacks.Selection{TemplateID: rule.ID})
		}
		templates, scope, err := alertpacks.Prepare(pack, req)
		if err != nil {
			return nil, err
		}
		return repo.InstallPack(ctx, pack, scope, templates)
	}
	first, err := install("everyday", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Members) != 3 {
		t.Fatal("missing members")
	}
	ruleID := *first.Members[0].RuleID
	if _, err := pool.Exec(ctx, `UPDATE alert_rules SET name='User edited',msg_template='Keep me',enabled=true WHERE id=$1`, ruleID); err != nil {
		t.Fatal(err)
	}
	second, err := install("trip", nil)
	if err != nil {
		t.Fatal(err)
	}
	if second.Members[0].Owned || second.Members[0].Name != "User edited" || !second.Members[0].Enabled {
		t.Fatal("existing edits overwritten")
	}
	if err := repo.RemovePack(ctx, first.ID, []int64{ruleID}); !errors.Is(err, alertpacks.ErrSelection) {
		t.Fatalf("shared rule deleted: %v", err)
	}
	if err := repo.RemovePack(ctx, second.ID, nil); err != nil {
		t.Fatal(err)
	}
	if err := repo.RemovePack(ctx, first.ID, []int64{ruleID}); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM alert_rules`).Scan(&count); err != nil || count != 4 {
		t.Fatalf("unselected rules lost count=%d err=%v", count, err)
	}

	// Roll back both installation and all created rules on a bad vehicle FK.
	if _, err := install("security", []int64{999}); err == nil {
		t.Fatal("missing vehicle accepted")
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM alert_pack_installations`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("partial install persisted count=%d err=%v", count, err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := install("charging", []int64{2, 1}); results <- err }()
	}
	wg.Wait()
	close(results)
	success, duplicate := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, alertpacks.ErrInstalled) {
			duplicate++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || duplicate != 1 {
		t.Fatalf("concurrent results success=%d duplicate=%d", success, duplicate)
	}
	list, err := repo.ListPackInstallations(ctx, 20, 0)
	if err != nil || len(list) != 1 || len(list[0].Members) != 3 || list[0].ScopeKey != "1,2" {
		t.Fatalf("list=%+v err=%v", list, err)
	}
	deletedID := *list[0].Members[0].RuleID
	if err := repo.Delete(ctx, deletedID); err != nil {
		t.Fatal(err)
	}
	list, err = repo.ListPackInstallations(ctx, 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	if list[0].Members[0].RuleID != nil {
		t.Fatal("deleted member must remain visibly missing")
	}
	if err := repo.RemovePack(ctx, list[0].ID, nil); err != nil {
		t.Fatal(err)
	}
}
