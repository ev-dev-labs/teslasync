package charging

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/chargingsvc"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSessionFactsAndIdempotentClassificationRepair(t *testing.T) {
	dsn := os.Getenv("CHARGING_FACTS_TEST_DSN")
	if dsn == "" {
		t.Skip("CHARGING_FACTS_TEST_DSN must point to a disposable local PostgreSQL instance")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	_, err = pool.Exec(ctx, `
CREATE TEMP TABLE vehicles (id bigint PRIMARY KEY, vin text);
CREATE TEMP TABLE geofences (id bigint PRIMARY KEY, category text);
CREATE TEMP TABLE settings (key text PRIMARY KEY, value_num numeric);
CREATE TEMP TABLE charging_sessions (
 id bigint PRIMARY KEY, vehicle_id bigint, started_at timestamptz, ended_at timestamptz,
 start_soc_pct float8, end_soc_pct float8, delta_soc_pct float8,
 start_odometer_m float8, end_odometer_m float8, start_lat float8, start_lng float8,
 start_place text, total_energy_added_wh float8, peak_power_w float8, avg_power_w float8,
 cost_decimal numeric, cost_currency text, cable_type text, charger_type text,
 geofence_id bigint, rate_id bigint, cost_source text);
CREATE TEMP TABLE tesla_charging_history (
 id bigint GENERATED ALWAYS AS IDENTITY,
 vin text, charge_start_datetime timestamptz, charge_stop_datetime timestamptz,
 total_due numeric, currency_code text, usage_wh float8, site_location_name text);
CREATE TEMP TABLE signal_log (
 vehicle_id bigint, ts timestamptz, field text, str_value text,
 bool_value boolean, float_value float8, int_value bigint);
INSERT INTO vehicles VALUES (1, 'fixture-vehicle');
INSERT INTO geofences VALUES (1, 'home');
INSERT INTO settings VALUES ('base_cost_per_kwh', 0.30);
INSERT INTO charging_sessions
 (id, vehicle_id, started_at, ended_at, total_energy_added_wh, peak_power_w, charger_type, geofence_id)
VALUES
 (1, 1, '2026-10-25 21:59Z', '2026-10-25 22:19Z', 25780, 120000, 'AC', 1),
 (2, 1, '2026-10-26 21:00Z', '2026-10-26 23:00Z', 20000, 11000, 'AC', 1),
 (3, 1, '2026-10-27 21:00Z', '2026-10-27 22:00Z', NULL, NULL, NULL, NULL);
INSERT INTO tesla_charging_history (vin, charge_start_datetime, charge_stop_datetime, total_due, currency_code, usage_wh, site_location_name) VALUES
 ('fixture-vehicle', '2026-10-25 22:00Z', '2026-10-25 22:19Z', 10.25, 'USD', 27000, 'Bothell Supercharger');
INSERT INTO signal_log (vehicle_id, ts, field, str_value) VALUES
 (1, '2026-10-25 22:00Z', 'FastChargerType', 'Supercharger'),
 (1, '2026-10-25 22:19Z', 'FastChargerType', 'Unknown');
INSERT INTO signal_log (vehicle_id, ts, field, float_value) VALUES
 (1, '2026-10-25 22:00Z', 'DCChargingPower', 120000),
 (1, '2026-10-25 22:19Z', 'DCChargingPower', 0),
 (1, '2026-10-26 21:01Z', 'ACChargingPower', 11000);`)
	if err != nil {
		t.Fatal(err)
	}
	repo := NewChargingRepo(&database.DB{Pool: pool})
	sessions, err := repo.ClassificationRepairBatch(ctx, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	facts, err := repo.LoadSessionFacts(ctx, sessions)
	if err != nil {
		t.Fatal(err)
	}
	for _, session := range sessions {
		previous := session.ChargerType
		chargingsvc.ApplySessionFacts(session, facts[session.ID])
		switch session.ID {
		case 1:
			if session.ChargerType == nil || *session.ChargerType != "Supercharger" ||
				session.CostDecimal == nil || *session.CostDecimal != 10.25 || *session.CostSource != "tesla_actual" {
				t.Fatalf("Supercharger presentation: %+v", session)
			}
			changed, err := repo.RepairChargerType(ctx, session.ID, previous, session.ChargerType)
			if err != nil || !changed {
				t.Fatalf("first repair: changed=%v err=%v", changed, err)
			}
			changed, err = repo.RepairChargerType(ctx, session.ID, previous, session.ChargerType)
			if err != nil || changed {
				t.Fatalf("second repair must be a no-op: changed=%v err=%v", changed, err)
			}
		case 2:
			if session.ChargerType == nil || *session.ChargerType != "AC" || !facts[2].IsHome ||
				session.CostDecimal == nil || *session.CostDecimal != 6 || *session.CostSource != "default_estimate" {
				t.Fatalf("home presentation: %+v", session)
			}
		case 3:
			if session.ChargerType != nil || session.CostDecimal != nil {
				t.Fatalf("missing evidence must remain unknown: %+v", session)
			}
		}
	}
	var persistedCost *float64
	if err := pool.QueryRow(ctx, "SELECT cost_decimal FROM charging_sessions WHERE id = 1").Scan(&persistedCost); err != nil {
		t.Fatal(err)
	}
	if persistedCost != nil {
		t.Fatal("classification repair must not persist response costs")
	}
	_, err = pool.Exec(ctx, `
INSERT INTO tesla_charging_history (vin, charge_start_datetime, charge_stop_datetime, total_due, currency_code)
VALUES ('fixture-vehicle', '2026-10-25 22:01Z', '2026-10-25 22:19Z', 99, 'USD')`)
	if err != nil {
		t.Fatal(err)
	}
	facts, err = repo.LoadSessionFacts(ctx, sessions)
	if err != nil {
		t.Fatal(err)
	}
	if facts[1].InvoiceID != 0 || facts[1].InvoiceCost != nil {
		t.Fatal("ambiguous overlapping invoices must not supply a price or detail overlay")
	}
}
