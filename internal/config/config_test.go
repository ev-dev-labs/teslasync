package config

import (
	"os"
	"testing"
	"time"
)

func TestLoad_Defaults(t *testing.T) {
	// Unset any env vars that might interfere
	os.Unsetenv("TESLASYNC_PORT")
	os.Unsetenv("TESLASYNC_LOG_LEVEL")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error from Load(): %v", err)
	}

	if cfg.Port == 0 {
		t.Error("expected non-zero default port")
	}
	if cfg.Port != 4000 {
		t.Errorf("expected default port 4000, got %d", cfg.Port)
	}
	if cfg.LogLevel == "" {
		t.Error("expected non-empty default log level")
	}
	if cfg.LogLevel != "info" {
		t.Errorf("expected default log level 'info', got '%s'", cfg.LogLevel)
	}
}

func TestLoad_SignalHistoryRetentionIsBoundedByDefault(t *testing.T) {
	t.Setenv("SIGNAL_HISTORY_RETENTION_DAYS", "")
	t.Setenv("SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error from Load(): %v", err)
	}
	if cfg.Retention.SignalHistoryRetentionDays != 365 {
		t.Fatalf("SignalHistoryRetentionDays = %d, want 365", cfg.Retention.SignalHistoryRetentionDays)
	}
	if cfg.Retention.SignalHistoryRetentionAcknowledged {
		t.Fatal("SignalHistoryRetentionAcknowledged = true, want safe upgrade default false")
	}
}

func TestLoad_TeslaAPIBudgetDefaults(t *testing.T) {
	t.Setenv("TESLA_API_DAILY_BUDGET_USD", "")
	t.Setenv("TESLA_API_COMMAND_RESERVE_USD", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error from Load(): %v", err)
	}
	if cfg.Tesla.DailyBudgetUSD != 0.30 {
		t.Fatalf("DailyBudgetUSD = %v, want 0.30", cfg.Tesla.DailyBudgetUSD)
	}
	if cfg.Tesla.CommandReserveUSD != 0.05 {
		t.Fatalf("CommandReserveUSD = %v, want 0.05", cfg.Tesla.CommandReserveUSD)
	}
}

func TestLoad_TeslaAPIBudgetOverrides(t *testing.T) {
	t.Setenv("TESLA_API_DAILY_BUDGET_USD", "1.75")
	t.Setenv("TESLA_API_COMMAND_RESERVE_USD", "0.25")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error from Load(): %v", err)
	}
	if cfg.Tesla.DailyBudgetUSD != 1.75 {
		t.Fatalf("DailyBudgetUSD = %v, want 1.75", cfg.Tesla.DailyBudgetUSD)
	}
	if cfg.Tesla.CommandReserveUSD != 0.25 {
		t.Fatalf("CommandReserveUSD = %v, want 0.25", cfg.Tesla.CommandReserveUSD)
	}
}

func TestLoad_TeslaAPIBudgetRejectsInvalidNegativeValues(t *testing.T) {
	t.Setenv("TESLA_API_DAILY_BUDGET_USD", "-1")
	t.Setenv("TESLA_API_COMMAND_RESERVE_USD", "NaN")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error from Load(): %v", err)
	}
	if cfg.Tesla.DailyBudgetUSD != 0.30 {
		t.Fatalf("DailyBudgetUSD = %v, want safe default 0.30", cfg.Tesla.DailyBudgetUSD)
	}
	if cfg.Tesla.CommandReserveUSD != 0.05 {
		t.Fatalf("CommandReserveUSD = %v, want safe default 0.05", cfg.Tesla.CommandReserveUSD)
	}
}

func TestLoad_DatabaseDefaults(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error from Load(): %v", err)
	}

	if cfg.Database.Host != "localhost" {
		t.Errorf("expected default database host 'localhost', got '%s'", cfg.Database.Host)
	}
	if cfg.Database.Port != 5432 {
		t.Errorf("expected default database port 5432, got %d", cfg.Database.Port)
	}
	if cfg.Database.SSLMode != "disable" {
		t.Errorf("expected default SSL mode 'disable', got '%s'", cfg.Database.SSLMode)
	}
}

func TestLoad_FleetTelemetryPersistenceDefaults(t *testing.T) {
	t.Setenv("FLEET_TELEMETRY_BATCH_MS", "")
	t.Setenv("FLEET_TELEMETRY_BATCH_MAX_MESSAGES", "")
	t.Setenv("FLEET_TELEMETRY_PERSISTENCE_CONCURRENCY", "")
	t.Setenv("FLEET_TELEMETRY_PERSISTENCE_QUEUE_CAPACITY", "")
	t.Setenv("FLEET_TELEMETRY_PERSISTENCE_TIMEOUT", "")
	t.Setenv("FLEET_TELEMETRY_SNAPSHOT_WRITE_INTERVAL", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error from Load(): %v", err)
	}
	if cfg.FleetTelemetry.BatchMs != 100 {
		t.Errorf("BatchMs = %d, want 100", cfg.FleetTelemetry.BatchMs)
	}
	if cfg.FleetTelemetry.BatchMaxMessages != 256 {
		t.Errorf("BatchMaxMessages = %d, want 256", cfg.FleetTelemetry.BatchMaxMessages)
	}
	if cfg.FleetTelemetry.PersistenceConcurrency != 2 {
		t.Errorf("PersistenceConcurrency = %d, want 2", cfg.FleetTelemetry.PersistenceConcurrency)
	}
	if cfg.FleetTelemetry.PersistenceQueueCapacity != 64 {
		t.Errorf("PersistenceQueueCapacity = %d, want 64", cfg.FleetTelemetry.PersistenceQueueCapacity)
	}
	if cfg.FleetTelemetry.PersistenceTimeout != 30*time.Second {
		t.Errorf("PersistenceTimeout = %s, want 30s", cfg.FleetTelemetry.PersistenceTimeout)
	}
	if cfg.FleetTelemetry.SnapshotWriteInterval != 10*time.Second {
		t.Errorf(
			"SnapshotWriteInterval = %s, want 10s",
			cfg.FleetTelemetry.SnapshotWriteInterval,
		)
	}
}

func TestLoad_EnvOverride(t *testing.T) {
	t.Setenv("TESLASYNC_PORT", "8080")
	t.Setenv("TESLASYNC_LOG_LEVEL", "debug")
	t.Setenv("SYNTHETIC_JOURNEY_BASE_URL", "http://teslasync-api:8080")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error from Load(): %v", err)
	}

	if cfg.Port != 8080 {
		t.Errorf("expected port 8080, got %d", cfg.Port)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("expected log level 'debug', got '%s'", cfg.LogLevel)
	}
	if cfg.Synthetic.JourneyBaseURL != "http://teslasync-api:8080" {
		t.Errorf("expected synthetic journey base URL override, got %q", cfg.Synthetic.JourneyBaseURL)
	}
}

func TestDatabaseConfig_DSN(t *testing.T) {
	d := DatabaseConfig{
		Host:             "localhost",
		Port:             5432,
		User:             "testuser",
		Password:         "testpass",
		Name:             "testdb",
		SSLMode:          "disable",
		ConnectTimeout:   5,
		StatementTimeout: 30000,
	}
	expected := "postgres://testuser:testpass@localhost:5432/testdb?sslmode=disable&connect_timeout=5&statement_timeout=30000"
	if got := d.DSN(); got != expected {
		t.Errorf("expected DSN %q, got %q", expected, got)
	}
}

func TestDatabaseConfig_DSN_CustomTimeouts(t *testing.T) {
	d := DatabaseConfig{
		Host:             "db.prod",
		Port:             5432,
		User:             "app",
		Password:         "secret",
		Name:             "mydb",
		SSLMode:          "require",
		ConnectTimeout:   10,
		StatementTimeout: 60000,
	}
	expected := "postgres://app:secret@db.prod:5432/mydb?sslmode=require&connect_timeout=10&statement_timeout=60000"
	if got := d.DSN(); got != expected {
		t.Errorf("expected DSN %q, got %q", expected, got)
	}
}

func TestLoad_DatabaseResilienceDefaults(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error from Load(): %v", err)
	}
	if cfg.Database.MaxConns != 12 {
		t.Errorf("expected default MaxConns 12, got %d", cfg.Database.MaxConns)
	}
	if cfg.Database.MinConns != 2 {
		t.Errorf("expected default MinConns 2, got %d", cfg.Database.MinConns)
	}
	if cfg.Database.ConnectTimeout != 5 {
		t.Errorf("expected default ConnectTimeout 5, got %d", cfg.Database.ConnectTimeout)
	}
	if cfg.Database.StatementTimeout != 30000 {
		t.Errorf("expected default StatementTimeout 30000, got %d", cfg.Database.StatementTimeout)
	}
	if cfg.Database.HealthCheckPeriod != 30*time.Second {
		t.Errorf("expected default HealthCheckPeriod 30s, got %v", cfg.Database.HealthCheckPeriod)
	}
}

func TestMQTTConfig_BrokerURL(t *testing.T) {
	m := MQTTConfig{
		Host: "mqtt.example.com",
		Port: 1883,
	}
	expected := "tcp://mqtt.example.com:1883"
	if got := m.BrokerURL(); got != expected {
		t.Errorf("expected broker URL %q, got %q", expected, got)
	}
}

func TestRedisConfig_Addr(t *testing.T) {
	r := RedisConfig{
		Host: "redis.example.com",
		Port: 6379,
	}
	expected := "redis.example.com:6379"
	if got := r.Addr(); got != expected {
		t.Errorf("expected addr %q, got %q", expected, got)
	}
}
