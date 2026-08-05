package fleetops

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestSmallFleetMigrationPinsRaceSafeConstraints(t *testing.T) {
	path := filepath.Join("..", "..", "..", "migrations", "000221_small_fleet_operations.up.sql")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(body)
	required := []string{
		"fleet_assignment_vehicle_no_overlap EXCLUDE USING gist",
		"fleet_assignment_driver_no_overlap EXCLUDE USING gist",
		"fleet_reservation_vehicle_no_overlap EXCLUDE USING gist",
		"fleet_reservation_driver_no_overlap EXCLUDE USING gist",
		"fleet_charging_policy_priority_no_overlap EXCLUDE USING gist",
		"due_odometer_m",
		"max_power_w",
		"fleet_work_order_cost_currency_consistent",
	}
	for _, fragment := range required {
		if !strings.Contains(sql, fragment) {
			t.Errorf("migration is missing %q", fragment)
		}
	}
	if strings.Contains(strings.ToLower(sql), "jsonb") {
		t.Error("known fleet schema must not use jsonb")
	}
}

func TestSmallFleetDownMigrationDropsEveryOwnedTable(t *testing.T) {
	path := filepath.Join("..", "..", "..", "migrations", "000221_small_fleet_operations.down.sql")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read down migration: %v", err)
	}
	sql := string(body)
	for _, table := range []string{
		"fleet_maintenance_work_orders",
		"fleet_charging_policy_windows",
		"fleet_charging_policies",
		"fleet_reservations",
		"fleet_vehicle_driver_assignments",
		"fleet_cost_centers",
		"fleet_drivers",
	} {
		if !strings.Contains(sql, "DROP TABLE IF EXISTS "+table) {
			t.Errorf("down migration does not drop %s", table)
		}
	}
}

func TestClassifyPGErrorMapsConstraintRacesToConflict(t *testing.T) {
	for _, code := range []string{"23P01", "23505", "23503"} {
		err := classifyPGError(&pgconn.PgError{Code: code, Message: "constraint"})
		if !strings.Contains(err.Error(), ErrConflict.Error()) {
			t.Errorf("code %s: err=%v, want conflict", code, err)
		}
	}
}

func TestReservationWritesUseTransactionAndAdvisoryLocks(t *testing.T) {
	body, err := os.ReadFile("scheduling_repo.go")
	if err != nil {
		t.Fatalf("read scheduling repo: %v", err)
	}
	source := string(body)
	createStart := strings.Index(source, "func (r *Repository) CreateReservation")
	updateStart := strings.Index(source, "func (r *Repository) UpdateReservation")
	deleteStart := strings.Index(source, "func (r *Repository) DeleteReservation")
	if createStart < 0 || updateStart < 0 || deleteStart < 0 {
		t.Fatal("reservation repository methods not found")
	}
	createBody := source[createStart:updateStart]
	updateBody := source[updateStart:deleteStart]
	for name, method := range map[string]string{"create": createBody, "update": updateBody} {
		if !strings.Contains(method, "r.db.WithTx") ||
			!strings.Contains(method, "advisoryLocks") ||
			!strings.Contains(method, "ensureDriverAssigned") {
			t.Errorf("%s reservation must transact, lock, and validate assignment", name)
		}
	}
}
