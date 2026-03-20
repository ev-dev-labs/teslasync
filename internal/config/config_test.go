package config

import (
	"os"
	"testing"
	"time"
)

// clearEnv unsets all TeslaSync-related env vars to isolate tests.
func clearEnv(t *testing.T) {
	t.Helper()
	envVars := []string{
		"TESLASYNC_PORT", "TESLASYNC_LOG_LEVEL",
		"DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASS",
		"DATABASE_NAME", "DATABASE_SSLMODE", "DATABASE_MAX_CONNS", "DATABASE_MIN_CONNS",
		"DATABASE_CONN_MAX_LIFETIME", "DATABASE_CONN_MAX_IDLE_TIME", "DATABASE_MIGRATIONS",
		"TESLA_CLIENT_ID", "TESLA_CLIENT_SECRET", "TESLA_API_BASE_URL",
		"TESLA_AUTH_URL", "TESLA_REDIRECT_URI", "TESLA_TIMEOUT",
		"MQTT_ENABLED", "MQTT_HOST", "MQTT_PORT", "MQTT_USERNAME",
		"MQTT_PASSWORD", "MQTT_CLIENT_ID", "MQTT_PREFIX",
		"WORKER_POLL_INTERVAL", "WORKER_SLEEP_POLL_MULT", "WORKER_STREAMING",
		"REDIS_ENABLED", "REDIS_HOST", "REDIS_PORT", "REDIS_PASSWORD", "REDIS_DB",
		"AUTH_ENABLED", "AUTH_JWT_SECRET",
		"DATA_RETENTION_DAYS", "POSITION_RETENTION_DAYS",
	}
	for _, key := range envVars {
		os.Unsetenv(key)
	}
}

func TestLoadDefaults(t *testing.T) {
	clearEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Port != 4000 {
		t.Errorf("Port = %d, want 4000", cfg.Port)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, "info")
	}

	// Database defaults
	if cfg.Database.Host != "localhost" {
		t.Errorf("Database.Host = %q, want %q", cfg.Database.Host, "localhost")
	}
	if cfg.Database.Port != 5432 {
		t.Errorf("Database.Port = %d, want 5432", cfg.Database.Port)
	}
	if cfg.Database.User != "teslasync" {
		t.Errorf("Database.User = %q, want %q", cfg.Database.User, "teslasync")
	}
	if cfg.Database.Password != "teslasync" {
		t.Errorf("Database.Password = %q, want %q", cfg.Database.Password, "teslasync")
	}
	if cfg.Database.Name != "teslasync" {
		t.Errorf("Database.Name = %q, want %q", cfg.Database.Name, "teslasync")
	}
	if cfg.Database.SSLMode != "disable" {
		t.Errorf("Database.SSLMode = %q, want %q", cfg.Database.SSLMode, "disable")
	}
	if cfg.Database.MaxConns != 25 {
		t.Errorf("Database.MaxConns = %d, want 25", cfg.Database.MaxConns)
	}
	if cfg.Database.MinConns != 5 {
		t.Errorf("Database.MinConns = %d, want 5", cfg.Database.MinConns)
	}
	if cfg.Database.ConnMaxLifetime != 5*time.Minute {
		t.Errorf("Database.ConnMaxLifetime = %v, want %v", cfg.Database.ConnMaxLifetime, 5*time.Minute)
	}
	if cfg.Database.ConnMaxIdleTime != 1*time.Minute {
		t.Errorf("Database.ConnMaxIdleTime = %v, want %v", cfg.Database.ConnMaxIdleTime, 1*time.Minute)
	}

	// MQTT defaults
	if cfg.MQTT.Enabled != true {
		t.Errorf("MQTT.Enabled = %v, want true", cfg.MQTT.Enabled)
	}
	if cfg.MQTT.Host != "localhost" {
		t.Errorf("MQTT.Host = %q, want %q", cfg.MQTT.Host, "localhost")
	}
	if cfg.MQTT.Port != 1883 {
		t.Errorf("MQTT.Port = %d, want 1883", cfg.MQTT.Port)
	}

	// Worker defaults
	if cfg.Worker.PollInterval != 15*time.Second {
		t.Errorf("Worker.PollInterval = %v, want %v", cfg.Worker.PollInterval, 15*time.Second)
	}
	if cfg.Worker.SleepPollMult != 4 {
		t.Errorf("Worker.SleepPollMult = %d, want 4", cfg.Worker.SleepPollMult)
	}
	if cfg.Worker.StreamingEnabled != false {
		t.Errorf("Worker.StreamingEnabled = %v, want false", cfg.Worker.StreamingEnabled)
	}

	// Redis defaults
	if cfg.Redis.Enabled != false {
		t.Errorf("Redis.Enabled = %v, want false", cfg.Redis.Enabled)
	}
	if cfg.Redis.Host != "localhost" {
		t.Errorf("Redis.Host = %q, want %q", cfg.Redis.Host, "localhost")
	}
	if cfg.Redis.Port != 6379 {
		t.Errorf("Redis.Port = %d, want 6379", cfg.Redis.Port)
	}

	// Auth defaults
	if cfg.Auth.Enabled != false {
		t.Errorf("Auth.Enabled = %v, want false", cfg.Auth.Enabled)
	}

	// Retention defaults
	if cfg.Retention.DataRetentionDays != 365 {
		t.Errorf("Retention.DataRetentionDays = %d, want 365", cfg.Retention.DataRetentionDays)
	}
	if cfg.Retention.PositionRetentionDays != 90 {
		t.Errorf("Retention.PositionRetentionDays = %d, want 90", cfg.Retention.PositionRetentionDays)
	}
}

func TestLoadCustomEnvVars(t *testing.T) {
	clearEnv(t)

	t.Setenv("TESLASYNC_PORT", "8080")
	t.Setenv("TESLASYNC_LOG_LEVEL", "debug")
	t.Setenv("DATABASE_HOST", "db.example.com")
	t.Setenv("DATABASE_PORT", "5433")
	t.Setenv("DATABASE_USER", "myuser")
	t.Setenv("DATABASE_PASS", "mypass")
	t.Setenv("DATABASE_NAME", "mydb")
	t.Setenv("DATABASE_SSLMODE", "require")
	t.Setenv("DATABASE_MAX_CONNS", "50")
	t.Setenv("MQTT_ENABLED", "false")
	t.Setenv("MQTT_HOST", "mqtt.example.com")
	t.Setenv("MQTT_PORT", "8883")
	t.Setenv("REDIS_ENABLED", "true")
	t.Setenv("REDIS_HOST", "redis.example.com")
	t.Setenv("REDIS_PORT", "6380")
	t.Setenv("WORKER_POLL_INTERVAL", "30s")
	t.Setenv("DATA_RETENTION_DAYS", "180")
	t.Setenv("POSITION_RETENTION_DAYS", "30")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Port != 8080 {
		t.Errorf("Port = %d, want 8080", cfg.Port)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, "debug")
	}
	if cfg.Database.Host != "db.example.com" {
		t.Errorf("Database.Host = %q, want %q", cfg.Database.Host, "db.example.com")
	}
	if cfg.Database.Port != 5433 {
		t.Errorf("Database.Port = %d, want 5433", cfg.Database.Port)
	}
	if cfg.Database.User != "myuser" {
		t.Errorf("Database.User = %q, want %q", cfg.Database.User, "myuser")
	}
	if cfg.Database.Password != "mypass" {
		t.Errorf("Database.Password = %q, want %q", cfg.Database.Password, "mypass")
	}
	if cfg.Database.Name != "mydb" {
		t.Errorf("Database.Name = %q, want %q", cfg.Database.Name, "mydb")
	}
	if cfg.Database.SSLMode != "require" {
		t.Errorf("Database.SSLMode = %q, want %q", cfg.Database.SSLMode, "require")
	}
	if cfg.Database.MaxConns != 50 {
		t.Errorf("Database.MaxConns = %d, want 50", cfg.Database.MaxConns)
	}
	if cfg.MQTT.Enabled != false {
		t.Errorf("MQTT.Enabled = %v, want false", cfg.MQTT.Enabled)
	}
	if cfg.MQTT.Host != "mqtt.example.com" {
		t.Errorf("MQTT.Host = %q, want %q", cfg.MQTT.Host, "mqtt.example.com")
	}
	if cfg.MQTT.Port != 8883 {
		t.Errorf("MQTT.Port = %d, want 8883", cfg.MQTT.Port)
	}
	if cfg.Redis.Enabled != true {
		t.Errorf("Redis.Enabled = %v, want true", cfg.Redis.Enabled)
	}
	if cfg.Redis.Host != "redis.example.com" {
		t.Errorf("Redis.Host = %q, want %q", cfg.Redis.Host, "redis.example.com")
	}
	if cfg.Redis.Port != 6380 {
		t.Errorf("Redis.Port = %d, want 6380", cfg.Redis.Port)
	}
	if cfg.Worker.PollInterval != 30*time.Second {
		t.Errorf("Worker.PollInterval = %v, want %v", cfg.Worker.PollInterval, 30*time.Second)
	}
	if cfg.Retention.DataRetentionDays != 180 {
		t.Errorf("Retention.DataRetentionDays = %d, want 180", cfg.Retention.DataRetentionDays)
	}
	if cfg.Retention.PositionRetentionDays != 30 {
		t.Errorf("Retention.PositionRetentionDays = %d, want 30", cfg.Retention.PositionRetentionDays)
	}
}

func TestDatabaseConfigDSN(t *testing.T) {
	tests := []struct {
		name string
		cfg  DatabaseConfig
		want string
	}{
		{
			name: "standard connection",
			cfg: DatabaseConfig{
				Host: "localhost", Port: 5432,
				User: "teslasync", Password: "secret",
				Name: "teslasync", SSLMode: "disable",
			},
			want: "postgres://teslasync:secret@localhost:5432/teslasync?sslmode=disable",
		},
		{
			name: "custom host and port",
			cfg: DatabaseConfig{
				Host: "db.prod.com", Port: 5433,
				User: "admin", Password: "p@ss",
				Name: "mydb", SSLMode: "require",
			},
			want: "postgres://admin:p@ss@db.prod.com:5433/mydb?sslmode=require",
		},
		{
			name: "empty password",
			cfg: DatabaseConfig{
				Host: "localhost", Port: 5432,
				User: "user", Password: "",
				Name: "db", SSLMode: "disable",
			},
			want: "postgres://user:@localhost:5432/db?sslmode=disable",
		},
		{
			name: "zero port",
			cfg: DatabaseConfig{
				Host: "localhost", Port: 0,
				User: "user", Password: "pass",
				Name: "db", SSLMode: "disable",
			},
			want: "postgres://user:pass@localhost:0/db?sslmode=disable",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.cfg.DSN()
			if got != tt.want {
				t.Errorf("DSN() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestMQTTConfigBrokerURL(t *testing.T) {
	tests := []struct {
		name string
		cfg  MQTTConfig
		want string
	}{
		{
			name: "default",
			cfg:  MQTTConfig{Host: "localhost", Port: 1883},
			want: "tcp://localhost:1883",
		},
		{
			name: "custom host and port",
			cfg:  MQTTConfig{Host: "mqtt.example.com", Port: 8883},
			want: "tcp://mqtt.example.com:8883",
		},
		{
			name: "zero port",
			cfg:  MQTTConfig{Host: "localhost", Port: 0},
			want: "tcp://localhost:0",
		},
		{
			name: "empty host",
			cfg:  MQTTConfig{Host: "", Port: 1883},
			want: "tcp://:1883",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.cfg.BrokerURL()
			if got != tt.want {
				t.Errorf("BrokerURL() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestRedisConfigAddr(t *testing.T) {
	tests := []struct {
		name string
		cfg  RedisConfig
		want string
	}{
		{
			name: "default",
			cfg:  RedisConfig{Host: "localhost", Port: 6379},
			want: "localhost:6379",
		},
		{
			name: "custom",
			cfg:  RedisConfig{Host: "redis.example.com", Port: 6380},
			want: "redis.example.com:6380",
		},
		{
			name: "empty host",
			cfg:  RedisConfig{Host: "", Port: 6379},
			want: ":6379",
		},
		{
			name: "zero port",
			cfg:  RedisConfig{Host: "localhost", Port: 0},
			want: "localhost:0",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.cfg.Addr()
			if got != tt.want {
				t.Errorf("Addr() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestEnvIntInvalidFallsBack(t *testing.T) {
	t.Setenv("TESLASYNC_PORT", "notanumber")
	clearEnv(t)
	t.Setenv("TESLASYNC_PORT", "notanumber")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Port != 4000 {
		t.Errorf("Port = %d, want fallback 4000 for invalid int", cfg.Port)
	}
}

func TestEnvBoolInvalidFallsBack(t *testing.T) {
	clearEnv(t)
	t.Setenv("MQTT_ENABLED", "notabool")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.MQTT.Enabled != true {
		t.Errorf("MQTT.Enabled = %v, want true (fallback for invalid bool)", cfg.MQTT.Enabled)
	}
}

func TestEnvDurationInvalidFallsBack(t *testing.T) {
	clearEnv(t)
	t.Setenv("WORKER_POLL_INTERVAL", "invalid")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Worker.PollInterval != 15*time.Second {
		t.Errorf("Worker.PollInterval = %v, want fallback %v for invalid duration", cfg.Worker.PollInterval, 15*time.Second)
	}
}
