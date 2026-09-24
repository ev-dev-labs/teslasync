package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	dbalert "github.com/ev-dev-labs/teslasync/internal/database/alert"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestEventRuleProductionDeliveryRoundTrip(t *testing.T) {
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
	if _, err := pool.Exec(ctx, `SELECT alert_id, event_type FROM notification_logs LIMIT 0`); err != nil {
		t.Skipf("notification reporting migrations not applied: %v", err)
	}
	db := &database.DB{Pool: pool}
	rules := dbalert.NewAlertRuleRepo(db)
	component, transition := "mqtt", "outage"
	template := "{{ComponentName}} {{Transition}}: {{EventMessage}}"
	rule := &alertmodel.AlertRule{
		Name: "Production delivery round-trip", Enabled: true, Kind: alertmodel.AlertRuleKindSystemComponent,
		AllVehicles: true, ComponentName: &component, Transition: &transition,
		Severity: "warn", CooldownMin: 15, TriggerMode: "repeat", IncludeTitle: false, MsgTemplate: &template,
	}
	if err := rules.Create(ctx, rule); err != nil {
		t.Fatal(err)
	}
	var received atomic.Int32
	webhookPayloads := make(chan struct {
		Title   string `json:"title"`
		Message string `json:"message"`
	}, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received.Add(1)
		var payload struct {
			Title   string `json:"title"`
			Message string `json:"message"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode webhook payload: %v", err)
		} else {
			webhookPayloads <- payload
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	notifications := dbnotif.NewNotificationRepo(db)
	channel := &notificationmodel.NotificationChannel{
		Name: "Local webhook", Type: "webhook", Enabled: true,
		Config: map[string]string{"url": server.URL, "http_method": "POST"},
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `DELETE FROM notification_logs WHERE alert_id=$1`, rule.ID); err != nil {
			t.Errorf("cleanup delivery logs: %v", err)
		}
		if channel.ID > 0 {
			if err := notifications.DeleteChannel(context.Background(), channel.ID); err != nil {
				t.Errorf("cleanup channel: %v", err)
			}
		}
		if err := rules.Delete(context.Background(), rule.ID); err != nil {
			t.Errorf("cleanup rule: %v", err)
		}
	})
	if err := notifications.CreateChannel(ctx, channel); err != nil {
		t.Fatal(err)
	}
	observer := &eventAlertObserver{
		rules: rules, claims: dbalert.NewEventCooldownRepo(db),
		deliver: func(ctx context.Context, evt componentTransitionEvent) {
			dispatchComponentNotification(ctx, notifications, nil, nil, notification.PublishCtx, evt)
		},
	}
	observer.fire(ctx, alertmodel.AlertRuleKindSystemComponent, "mqtt:outage",
		0, 0, "", "mqtt", "outage", "MQTT outage", "Broker down", EventMQTTOutage)
	observer.fire(ctx, alertmodel.AlertRuleKindSystemComponent, "mqtt:outage",
		0, 0, "", "mqtt", "outage", "MQTT outage", "Broker down", EventMQTTOutage)
	if received.Load() != 1 {
		t.Fatalf("webhook received %d requests; want one", received.Load())
	}
	select {
	case payload := <-webhookPayloads:
		if payload.Title != "" || payload.Message != "mqtt outage: Broker down" {
			t.Fatalf("rendered webhook payload: %+v", payload)
		}
	default:
		t.Fatal("webhook request body not captured")
	}
	rows, err := pool.Query(ctx, `SELECT status, alert_id, event_type, trigger_id
		FROM notification_logs WHERE alert_id=$1 ORDER BY id`, rule.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var statuses []string
	var triggerIDs []string
	for rows.Next() {
		var status, eventType, triggerID string
		var alertID int64
		if err := rows.Scan(&status, &alertID, &eventType, &triggerID); err != nil {
			t.Fatal(err)
		}
		if alertID != rule.ID || eventType != EventMQTTOutage {
			t.Fatalf("attribution: id=%d event_type=%q; want %d %q", alertID, eventType, rule.ID, EventMQTTOutage)
		}
		statuses = append(statuses, status)
		triggerIDs = append(triggerIDs, triggerID)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(statuses) != 2 || statuses[0] != "triggered" || statuses[1] != "sent" ||
		triggerIDs[0] == "" || triggerIDs[0] != triggerIDs[1] {
		t.Fatalf("notification rows: statuses=%v trigger_ids=%v", statuses, triggerIDs)
	}
}
