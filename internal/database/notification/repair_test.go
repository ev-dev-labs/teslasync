package notification

import (
	"testing"

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
)

func TestRepairVehicleLinksDryRunIdempotenceAndAmbiguity(t *testing.T) {
	repo, ctx := eventFixture(t)
	_, err := repo.db.Pool.Exec(ctx, `
		INSERT INTO vehicles (id, vin, created_at) VALUES (7, 'TEST-VIN-7', '2020-01-01'), (9, 'TEST-VIN-9', '2020-01-01');
		INSERT INTO alert_rules (id, all_vehicles, updated_at) VALUES
			(1, false, '2020-01-01'), (2, true, '2020-01-01'), (3, false, '2099-01-01');
		INSERT INTO alert_rule_vehicles (rule_id, vehicle_id) VALUES (1, 7), (3, 9);
		INSERT INTO notification_logs (id, channel_id, title, message, status, vehicle_id, trigger_id, alert_id) VALUES
			(1, 1, 'Falcon — Media', 'the station changed to .', 'sent', 7, '00000000-0000-0000-0000-000000000001', NULL),
			(2, 1, 'Falcon — Media', 'the station changed to .', 'sent', NULL, '00000000-0000-0000-0000-000000000001', NULL),
			(3, 1, 'TEST-VIN-9 — Media', 'now playing .', 'sent', NULL, NULL, NULL),
			(4, 1, 'Falcon — Media', 'now playing .', 'sent', NULL, NULL, 1),
			(5, 1, 'Falcon — Media', 'now playing .', 'sent', NULL, NULL, 2),
			(6, 1, 'Falcon — Media', 'now playing .', 'sent', NULL, NULL, 3),
			(7, 1, 'TEST-VIN-9 — Media', 'now playing .', 'sent', NULL, NULL, 1),
			(8, 1, 'Falcon — Media', 'now playing .', 'sent', NULL, NULL, NULL);
	`)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := repo.RepairVehicleLinks(ctx, false, 100)
	if err != nil || len(plan) != 3 {
		t.Fatalf("dry run = %+v, %v; want only correlated, VIN and unchanged single-scope evidence", plan, err)
	}
	var linked int
	if err := repo.db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM notification_logs WHERE vehicle_id IS NOT NULL`).Scan(&linked); err != nil || linked != 1 {
		t.Fatalf("dry run changed data: linked=%d err=%v", linked, err)
	}
	applied, err := repo.RepairVehicleLinks(ctx, true, 100)
	if err != nil || len(applied) != 3 {
		t.Fatalf("apply = %+v, %v", applied, err)
	}
	again, err := repo.RepairVehicleLinks(ctx, true, 100)
	if err != nil || len(again) != 0 {
		t.Fatalf("repair not idempotent: %+v, %v", again, err)
	}
	var audits, untouched int
	if err := repo.db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM notification_log_events WHERE actor = 'offline-notification-repair'`).Scan(&audits); err != nil || audits != 3 {
		t.Fatalf("audit count=%d err=%v", audits, err)
	}
	if err := repo.db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM notification_logs WHERE message IN ('the station changed to .', 'now playing .')`).Scan(&untouched); err != nil || untouched != 8 {
		t.Fatalf("historical messages changed: count=%d err=%v", untouched, err)
	}
}

func TestEventVehicleControlsListsAndGroupsRatherThanRuleScope(t *testing.T) {
	repo, ctx := eventFixture(t)
	if _, err := repo.db.Pool.Exec(ctx, `INSERT INTO alert_rules (id, vehicle_id, all_vehicles) VALUES (1, 99, true)`); err != nil {
		t.Fatal(err)
	}
	vehicleID, ruleID := int64(7), int64(1)
	trigger, eventType := "00000000-0000-0000-0000-000000000007", "alert.rule"
	event := &notificationmodel.NotificationLog{Title: "Falcon", Message: "Media changed", VehicleID: &vehicleID, AlertID: &ruleID, TriggerID: &trigger, EventType: &eventType}
	if err := repo.CreateEvent(ctx, event); err != nil {
		t.Fatal(err)
	}
	rows, err := repo.GetLogsFiltered(ctx, NotificationLogFilters{VehicleIDs: []int64{7}})
	if err != nil || len(rows) != 1 || rows[0].VehicleID == nil || *rows[0].VehicleID != 7 {
		t.Fatalf("captured vehicle list=%+v err=%v", rows, err)
	}
	other, err := repo.GetLogsFiltered(ctx, NotificationLogFilters{VehicleIDs: []int64{99}})
	if err != nil || len(other) != 0 {
		t.Fatalf("rule scope leaked into event list: %+v %v", other, err)
	}
	groups, err := repo.ListGrouped(ctx, NotificationLogFilters{VehicleIDs: []int64{7}})
	if err != nil || len(groups) != 1 || len(groups[0].VehicleIDs) != 1 || groups[0].VehicleIDs[0] != 7 ||
		groups[0].Latest.VehicleID == nil || *groups[0].Latest.VehicleID != 7 {
		t.Fatalf("captured group vehicle lost: %+v %v", groups, err)
	}
}
