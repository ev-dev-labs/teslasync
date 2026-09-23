package notification

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func eventFixture(t *testing.T) (*NotificationRepo, context.Context) {
	t.Helper()
	dsn := os.Getenv("NOTIFICATION_REPO_TEST_DSN")
	if dsn == "" {
		t.Skip("set NOTIFICATION_REPO_TEST_DSN to run PostgreSQL event/inbox integration tests")
	}
	ctx := context.Background()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns = 1
	cfg.MinConns = 0
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	// Temporary tables shadow production tables on this single connection;
	// no migration or test row touches the persistent database.
	for _, statement := range []string{
		`CREATE TEMP TABLE notification_channels (id bigint PRIMARY KEY, kind text NOT NULL)`,
		`CREATE TEMP TABLE alert_rules (id bigint PRIMARY KEY, vehicle_id bigint)`,
		`CREATE TEMP TABLE notification_logs (
			id bigserial PRIMARY KEY, channel_id bigint, alert_id bigint,
			title text NOT NULL, message text NOT NULL, status text NOT NULL,
			severity text, error text, created_at timestamptz NOT NULL DEFAULT now(),
			sent_at timestamptz, scheduled_at timestamptz, latency_ms integer,
			read_at timestamptz, archived_at timestamptz,
			acknowledged_at timestamptz, acknowledged_by text, acknowledgement_note text,
			trigger_id uuid, event_type text, group_key text,
			CHECK ((status = 'triggered' AND channel_id IS NULL AND trigger_id IS NOT NULL AND event_type IS NOT NULL)
				OR (status <> 'triggered' AND channel_id IS NOT NULL)))`,
		`CREATE UNIQUE INDEX notification_test_trigger_event ON notification_logs (trigger_id) WHERE status = 'triggered'`,
		`CREATE TEMP TABLE notification_log_events (notification_log_id bigint, actor text, kind text, note text)`,
	} {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("create isolated notification fixture: %v", err)
		}
	}
	return NewNotificationRepo(&database.DB{Pool: pool}), ctx
}

func TestEventInboxReportTwoChannelFanout(t *testing.T) {
	repo, ctx := eventFixture(t)
	if _, err := repo.db.Pool.Exec(ctx, `INSERT INTO notification_channels (id, kind) VALUES (1, 'email'), (2, 'discord')`); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.db.Pool.Exec(ctx, `INSERT INTO alert_rules (id, vehicle_id) VALUES (42, 7)`); err != nil {
		t.Fatal(err)
	}
	triggerID, eventType := uuid.NewString(), "alert.charge_stopped"
	alertID := int64(42)
	event := &notificationmodel.NotificationLog{
		Title: "Charging alert", Message: "Charge stopped", Severity: "warn",
		AlertID: &alertID, TriggerID: &triggerID, EventType: &eventType,
	}
	if err := repo.CreateEvent(ctx, event); err != nil {
		t.Fatal(err)
	}
	if err := repo.CreateEvent(ctx, &notificationmodel.NotificationLog{
		Title: event.Title, Message: event.Message, TriggerID: &triggerID, EventType: &eventType,
	}); err != nil {
		t.Fatalf("retry must reuse the same event: %v", err)
	}
	for _, channelID := range []int64{1, 2} {
		if err := repo.CreateLog(ctx, &notificationmodel.NotificationLog{
			ChannelID: channelID, Title: event.Title, Message: event.Message,
			Status: "sent", Severity: event.Severity,
			AlertID: &alertID, TriggerID: &triggerID, EventType: &eventType,
		}); err != nil {
			t.Fatal(err)
		}
	}
	from := time.Now().UTC().Truncate(24 * time.Hour)
	report, err := repo.GetReport(ctx, from, from.AddDate(0, 0, 1))
	if err != nil {
		t.Fatal(err)
	}
	if report.Triggered != 1 || report.Deliveries != 2 || report.UncorrelatedDeliveries != 0 {
		t.Fatalf("report: triggered=%d deliveries=%d uncorrelated=%d, want 1/2/0", report.Triggered, report.Deliveries, report.UncorrelatedDeliveries)
	}
	if len(report.BySource) != 1 || report.BySource[0] != (ReportKeyCount{Key: "alert", Count: 1}) ||
		len(report.ByChannel) != 2 || report.ByChannel[0] != (ReportKeyCount{Key: "discord", Count: 1}) ||
		report.ByChannel[1] != (ReportKeyCount{Key: "email", Count: 1}) || len(report.Daily) != 1 ||
		report.Daily[0].Triggered != 1 || report.Daily[0].Deliveries != 2 {
		t.Fatalf("report dimensions: %+v", report)
	}
	logs, err := repo.GetLogsFiltered(ctx, NotificationLogFilters{})
	if err != nil || len(logs) != 1 || logs[0].ID != event.ID || logs[0].ChannelID != 0 {
		t.Fatalf("inbox logs=%+v err=%v, want only zero-channel event %d", logs, err, event.ID)
	}
	if _, err := repo.db.Pool.Exec(ctx,
		`UPDATE notification_logs SET latency_ms = 123, sent_at = created_at + interval '123 milliseconds'
		 WHERE channel_id = 1`); err != nil {
		t.Fatal(err)
	}
	deliveries, err := repo.GetLogsFiltered(ctx, NotificationLogFilters{DeliveryOnly: true})
	if err != nil || len(deliveries) != 2 || deliveries[0].Status != "sent" {
		t.Fatalf("delivery analytics logs=%+v err=%v, want two channel attempts", deliveries, err)
	}
	var measured bool
	for _, delivery := range deliveries {
		if delivery.ChannelID == 1 && delivery.LatencyMs != nil && *delivery.LatencyMs == 123 && delivery.SentAt != nil {
			measured = true
		}
	}
	if !measured {
		t.Fatalf("delivery latency was not returned: %+v", deliveries)
	}
	groups, err := repo.ListGrouped(ctx, NotificationLogFilters{})
	if err != nil || len(groups) != 1 || groups[0].Count != 1 ||
		groups[0].UnreadCount != 1 || groups[0].Latest.ID != event.ID ||
		groups[0].GroupKey == nil || len(groups[0].VehicleIDs) != 1 || groups[0].VehicleIDs[0] != 7 {
		t.Fatalf("inbox groups=%+v err=%v, want one event group", groups, err)
	}
	alerts, err := repo.GetAlertLogs(ctx, 10, 0)
	if err != nil || len(alerts) != 1 || alerts[0].ID != event.ID {
		t.Fatalf("alert alias=%+v err=%v, want one event", alerts, err)
	}
	unread, err := repo.GetUnreadCount(ctx)
	if err != nil || unread != 1 {
		t.Fatalf("unread=%d err=%v, want 1", unread, err)
	}
	changed, err := repo.BulkSetReadByGroupKey(ctx, *groups[0].GroupKey)
	if err != nil || changed != 1 {
		t.Fatalf("read grouped event: affected=%d err=%v", changed, err)
	}
	var unseenDeliveries int
	if err := repo.db.Pool.QueryRow(ctx,
		`SELECT count(*) FROM notification_logs WHERE status = 'sent' AND read_at IS NULL`,
	).Scan(&unseenDeliveries); err != nil || unseenDeliveries != 2 {
		t.Fatalf("correlated deliveries should remain untouched: count=%d err=%v", unseenDeliveries, err)
	}
}

func TestWebPushOnlyEventCanBeReadArchivedAndAcknowledged(t *testing.T) {
	repo, ctx := eventFixture(t)
	triggerID, eventType := uuid.NewString(), "digest.fsd_weekly"
	event := &notificationmodel.NotificationLog{
		Title: "Digest", Message: "Ready",
		TriggerID: &triggerID, EventType: &eventType,
	}
	if err := repo.CreateEvent(ctx, event); err != nil {
		t.Fatal(err)
	}
	from := time.Now().UTC().Truncate(24 * time.Hour)
	report, err := repo.GetReport(ctx, from, from.AddDate(0, 0, 1))
	if err != nil || report.Triggered != 1 || report.Deliveries != 0 {
		t.Fatalf("WebPush-only report=%+v err=%v, want 1 trigger and no channel rows", report, err)
	}
	logs, err := repo.GetLogs(ctx, 10, 0)
	if err != nil || len(logs) != 1 || logs[0].ID != event.ID || logs[0].ChannelID != 0 {
		t.Fatalf("WebPush-only inbox=%+v err=%v", logs, err)
	}
	if changed, err := repo.BulkSetRead(ctx, []int64{event.ID}, true); err != nil || changed != 1 {
		t.Fatalf("read event: affected=%d err=%v", changed, err)
	}
	if changed, err := repo.BulkSetArchived(ctx, []int64{event.ID}, true); err != nil || changed != 1 {
		t.Fatalf("archive event: affected=%d err=%v", changed, err)
	}
	ack, newlyAcknowledged, err := repo.AcknowledgeLog(ctx, event.ID, "operator", "Reviewed")
	if err != nil || !newlyAcknowledged || ack == nil || ack.ChannelID != 0 || ack.AcknowledgedAt == nil {
		t.Fatalf("ack event=%+v new=%t err=%v", ack, newlyAcknowledged, err)
	}
	if changed, err := repo.BulkSetReadAll(ctx); err != nil || changed != 0 {
		t.Fatalf("archived event remained unread: changed=%d err=%v", changed, err)
	}
	unread, err := repo.GetUnreadCount(ctx)
	if err != nil || unread != 0 {
		t.Fatalf("unread after archive=%d err=%v", unread, err)
	}
}
