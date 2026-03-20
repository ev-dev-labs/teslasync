package config

import (
	"os"
	"testing"
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

func TestLoad_EnvOverride(t *testing.T) {
	t.Setenv("TESLASYNC_PORT", "8080")
	t.Setenv("TESLASYNC_LOG_LEVEL", "debug")

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
}

func TestDatabaseConfig_DSN(t *testing.T) {
	d := DatabaseConfig{
		Host:     "localhost",
		Port:     5432,
		User:     "testuser",
		Password: "testpass",
		Name:     "testdb",
		SSLMode:  "disable",
	}
	expected := "postgres://testuser:testpass@localhost:5432/testdb?sslmode=disable"
	if got := d.DSN(); got != expected {
		t.Errorf("expected DSN %q, got %q", expected, got)
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
