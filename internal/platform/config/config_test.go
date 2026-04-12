package config

import (
	"os"
	"testing"
)

func TestLoad_Defaults(t *testing.T) {
	// Clear any env vars that might interfere
	for _, key := range []string{"SERVER_PORT", "DATABASE_HOST", "REDIS_ENABLED"} {
		os.Unsetenv(key)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() with defaults failed: %v", err)
	}

	if cfg.Server.Port != 8080 {
		t.Errorf("expected default port 8080, got %d", cfg.Server.Port)
	}
	if cfg.Database.Host != "localhost" {
		t.Errorf("expected default db host 'localhost', got %q", cfg.Database.Host)
	}
	if cfg.Database.MaxConns != 20 {
		t.Errorf("expected default max_conns 20, got %d", cfg.Database.MaxConns)
	}
	if cfg.Database.MinConns != 5 {
		t.Errorf("expected default min_conns 5, got %d", cfg.Database.MinConns)
	}
	if cfg.Redis.Enabled {
		t.Error("expected Redis disabled by default")
	}
	if cfg.Auth.Enabled {
		t.Error("expected Auth disabled by default")
	}
	if cfg.LogLevel != "info" {
		t.Errorf("expected default log level 'info', got %q", cfg.LogLevel)
	}
}

func TestLoad_CustomEnv(t *testing.T) {
	t.Setenv("SERVER_PORT", "9090")
	t.Setenv("DATABASE_HOST", "db.example.com")
	t.Setenv("DATABASE_PORT", "5433")
	t.Setenv("LOG_LEVEL", "debug")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() failed: %v", err)
	}

	if cfg.Server.Port != 9090 {
		t.Errorf("expected port 9090, got %d", cfg.Server.Port)
	}
	if cfg.Database.Host != "db.example.com" {
		t.Errorf("expected db host 'db.example.com', got %q", cfg.Database.Host)
	}
	if cfg.Database.Port != 5433 {
		t.Errorf("expected db port 5433, got %d", cfg.Database.Port)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("expected log level 'debug', got %q", cfg.LogLevel)
	}
}

func TestDSN(t *testing.T) {
	cfg := DatabaseConfig{
		Host:    "localhost",
		Port:    5432,
		User:    "user",
		Password: "pass",
		Name:    "db",
		SSLMode: "disable",
	}
	want := "postgres://user:pass@localhost:5432/db?sslmode=disable"
	if got := cfg.DSN(); got != want {
		t.Errorf("DSN() = %q, want %q", got, want)
	}
}

func TestRedisAddr(t *testing.T) {
	cfg := RedisConfig{Host: "redis.local", Port: 6380}
	want := "redis.local:6380"
	if got := cfg.Addr(); got != want {
		t.Errorf("Addr() = %q, want %q", got, want)
	}
}

func TestMQTTBrokerURL(t *testing.T) {
	cfg := MQTTConfig{Host: "mqtt.local", Port: 1884}
	want := "tcp://mqtt.local:1884"
	if got := cfg.BrokerURL(); got != want {
		t.Errorf("BrokerURL() = %q, want %q", got, want)
	}
}

func TestValidation_InvalidPort(t *testing.T) {
	t.Setenv("SERVER_PORT", "0")
	_, err := Load()
	if err == nil {
		t.Error("expected error for invalid port 0")
	}
}

func TestValidation_MinConnsExceedsMaxConns(t *testing.T) {
	t.Setenv("DATABASE_MIN_CONNS", "30")
	t.Setenv("DATABASE_MAX_CONNS", "10")
	_, err := Load()
	if err == nil {
		t.Error("expected error when min_conns > max_conns")
	}
}

func TestValidation_AuthEnabledNoSecret(t *testing.T) {
	t.Setenv("AUTH_ENABLED", "true")
	t.Setenv("AUTH_JWT_SECRET", "")
	t.Setenv("AUTH_AUTHENTIK_URL", "")
	_, err := Load()
	if err == nil {
		t.Error("expected error when auth enabled but no secret/URL set")
	}
}

func TestFeatureFlags_Defaults(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() failed: %v", err)
	}
	if !cfg.Features.EnableExportWorker {
		t.Error("expected EnableExportWorker to be true by default")
	}
	if !cfg.Features.EnableNotificationWorker {
		t.Error("expected EnableNotificationWorker to be true by default")
	}
	if cfg.Features.EnableFleetTelemetry {
		t.Error("expected EnableFleetTelemetry to be false by default")
	}
}
