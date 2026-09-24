package notification

import (
	"context"
	"os"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/database"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestWebhookUpdateRetainsSigningSecretWhenOmitted(t *testing.T) {
	dsn := os.Getenv("NOTIFICATION_REPO_TEST_DSN")
	if dsn == "" {
		t.Skip("set NOTIFICATION_REPO_TEST_DSN to run PostgreSQL webhook integration test")
	}
	ctx := context.Background()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns, cfg.MinConns = 1, 0
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	for _, statement := range []string{
		`CREATE TEMP TABLE notification_channels (
			id bigserial PRIMARY KEY, name text, kind text, enabled boolean,
			created_at timestamptz, updated_at timestamptz)`,
		`CREATE TEMP TABLE notification_channel_webhook (
			channel_id bigint PRIMARY KEY, url text, http_method text, bearer_token text)`,
	} {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	repo := NewNotificationRepo(&database.DB{Pool: pool})
	ch := &notificationmodel.NotificationChannel{
		Name: "Receiver", Type: "webhook", Enabled: true,
		Config: map[string]string{
			"url": "https://receiver.example.test/a",
			"method": "POST",
			"bearer_token": "original-secret",
		},
	}
	if err := repo.CreateChannel(ctx, ch); err != nil {
		t.Fatal(err)
	}
	ch.Config = map[string]string{"url": "https://receiver.example.test/b", "method": "PUT"}
	if err := repo.UpdateChannel(ctx, ch); err != nil {
		t.Fatal(err)
	}
	var url, method, secret string
	if err := pool.QueryRow(ctx, `SELECT url, http_method, bearer_token
		FROM notification_channel_webhook WHERE channel_id=$1`, ch.ID).Scan(&url, &method, &secret); err != nil {
		t.Fatal(err)
	}
	if url != ch.Config["url"] || method != "PUT" || secret != "original-secret" {
		t.Fatalf("webhook update did not preserve its secret and other edits: url=%q method=%q preserved=%t",
			url, method, secret == "original-secret")
	}
}
