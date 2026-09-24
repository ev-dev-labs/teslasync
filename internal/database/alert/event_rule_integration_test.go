package alert

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestEventRulePersistenceAndCooldown(t *testing.T) {
	dsn := os.Getenv("TESLASYNC_TEST_DB")
	if dsn == "" {
		t.Skip("TESLASYNC_TEST_DB unset")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("test database unreachable: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT 1 FROM event_alert_cooldown LIMIT 0`).Scan(new(int)); err != nil {
		// QueryRow on LIMIT 0 returns ErrNoRows when the migration is present.
		if !errors.Is(err, pgx.ErrNoRows) {
			t.Skipf("migration 000252 not applied: %v", err)
		}
	}
	db := &database.DB{Pool: pool}
	repo := NewAlertRuleRepo(db)
	outage := "outage"
	for _, test := range []struct {
		name        string
		allVehicles bool
		transition  *string
	}{
		{name: "system scope", allVehicles: false, transition: &outage},
		{name: "missing transition", allVehicles: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := pool.Exec(ctx, `INSERT INTO alert_rules
				(name,signal_name,op,severity,cooldown_min,trigger_mode,kind,component_name,transition,all_vehicles)
				VALUES ('invalid event','','','warn',15,'repeat','system_component','mqtt',$1,$2)`,
				test.transition, test.allVehicles)
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
				t.Fatalf("database accepted invalid event rule or wrong error: %v", err)
			}
		})
	}
	name, transition := "mqtt", "outage"
	rule := &alertmodel.AlertRule{Name: "event rule persistence test", Enabled: true, AllVehicles: true,
		VehicleIDs: []int64{}, Kind: alertmodel.AlertRuleKindSystemComponent, ComponentName: &name,
		Transition: &transition, Severity: "warn", CooldownMin: 15, TriggerMode: "repeat", IncludeTitle: true}
	if err := repo.Create(ctx, rule); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := repo.Delete(context.Background(), rule.ID); err != nil {
			t.Errorf("cleanup event rule: %v", err)
		}
	})
	read, err := repo.GetByID(ctx, rule.ID)
	if err != nil || read == nil || read.ComponentName == nil || *read.ComponentName != "mqtt" ||
		read.Transition == nil || *read.Transition != "outage" {
		t.Fatalf("roundtrip: %+v %v", read, err)
	}
	transition = "recovery"
	read.Transition = &transition
	if err := repo.Update(ctx, rule.ID, read); err != nil {
		t.Fatal(err)
	}
	read, err = repo.GetByID(ctx, rule.ID)
	if err != nil || read == nil || read.Transition == nil || *read.Transition != "recovery" {
		t.Fatalf("update: %+v %v", read, err)
	}
	claim := NewEventCooldownRepo(db)
	now := time.Now().UTC()
	for i, expected := range []bool{true, false, true} {
		at := now
		if i == 2 {
			at = now.Add(16 * time.Minute)
		}
		got, err := claim.Claim(ctx, rule.ID, "mqtt:recovery", at, 15)
		if err != nil || got != expected {
			t.Fatalf("claim %d: %v %v, want %v", i, got, err, expected)
		}
	}
}
