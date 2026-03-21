package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds all application configuration.
type Config struct {
	Port      int
	LogLevel  string
	Database  DatabaseConfig
	Tesla     TeslaConfig
	MQTT      MQTTConfig
	Worker    WorkerConfig
	Redis     RedisConfig
	Auth      AuthConfig
	Retention RetentionConfig
}

type DatabaseConfig struct {
	Host           string
	Port           int
	User           string
	Password       string
	Name           string
	SSLMode        string
	MaxConns       int
	MinConns       int
	ConnMaxLifetime time.Duration
	ConnMaxIdleTime time.Duration
	MigrationsPath string
}

func (d DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		d.User, d.Password, d.Host, d.Port, d.Name, d.SSLMode,
	)
}

type TeslaConfig struct {
	ClientID     string
	ClientSecret string
	BaseURL      string
	AuthURL      string
	RedirectURI  string
	Timeout      time.Duration
}

type MQTTConfig struct {
	Enabled  bool
	Host     string
	Port     int
	Username string
	Password string
	ClientID string
	Prefix   string
}

func (m MQTTConfig) BrokerURL() string {
	return fmt.Sprintf("tcp://%s:%d", m.Host, m.Port)
}

type WorkerConfig struct {
	PollInterval         time.Duration
	SleepPollInterval    time.Duration
	DrivingPollInterval  time.Duration
	ChargingPollInterval time.Duration
	StatusCheckInterval  time.Duration
	SleepPollMult        int
	StreamingEnabled     bool
}

type RedisConfig struct {
	Enabled  bool
	Host     string
	Port     int
	Password string
	DB       int
}

func (r RedisConfig) Addr() string {
	return fmt.Sprintf("%s:%d", r.Host, r.Port)
}

type AuthConfig struct {
	Enabled   bool
	JWTSecret string
}

type RetentionConfig struct {
	DataRetentionDays     int
	PositionRetentionDays int
}

// Load reads configuration from environment variables with sensible defaults.
//
// SECURITY: Do not log the returned Config struct directly — it contains
// sensitive fields (Database.Password, Tesla.ClientSecret, MQTT.Password,
// Redis.Password, Auth.JWTSecret). If diagnostic logging is needed, redact
// these fields first or log only non-sensitive values.
func Load() (*Config, error) {
	cfg := &Config{
		Port:     envInt("TESLASYNC_PORT", 4000),
		LogLevel: envStr("TESLASYNC_LOG_LEVEL", "info"),

		Database: DatabaseConfig{
			Host:            envStr("DATABASE_HOST", "localhost"),
			Port:            envInt("DATABASE_PORT", 5432),
			User:            envStr("DATABASE_USER", "teslasync"),
			Password:        envStr("DATABASE_PASS", "teslasync"),
			Name:            envStr("DATABASE_NAME", "teslasync"),
			SSLMode:         envStr("DATABASE_SSLMODE", "disable"),
			MaxConns:        envInt("DATABASE_MAX_CONNS", 25),
			MinConns:        envInt("DATABASE_MIN_CONNS", 5),
			ConnMaxLifetime: envDuration("DATABASE_CONN_MAX_LIFETIME", 5*time.Minute),
			ConnMaxIdleTime: envDuration("DATABASE_CONN_MAX_IDLE_TIME", 1*time.Minute),
			MigrationsPath:  envStr("DATABASE_MIGRATIONS", "file://migrations"),
		},

		Tesla: TeslaConfig{
			ClientID:     envStr("TESLA_CLIENT_ID", ""),
			ClientSecret: envStr("TESLA_CLIENT_SECRET", ""),
			BaseURL:      envStr("TESLA_API_BASE_URL", "https://fleet-api.prd.na.vn.cloud.tesla.com"),
			AuthURL:      envStr("TESLA_AUTH_URL", "https://auth.tesla.com"),
			RedirectURI:  envStr("TESLA_REDIRECT_URI", "http://localhost:4000/api/v1/auth/callback"),
			Timeout:      envDuration("TESLA_TIMEOUT", 30*time.Second),
		},

		MQTT: MQTTConfig{
			Enabled:  envBool("MQTT_ENABLED", true),
			Host:     envStr("MQTT_HOST", "localhost"),
			Port:     envInt("MQTT_PORT", 1883),
			Username: envStr("MQTT_USERNAME", ""),
			Password: envStr("MQTT_PASSWORD", ""),
			ClientID: envStr("MQTT_CLIENT_ID", "teslasync"),
			Prefix:   envStr("MQTT_PREFIX", "teslasync"),
		},

		Worker: WorkerConfig{
			PollInterval:         envDuration("WORKER_POLL_INTERVAL", 900*time.Second),
			SleepPollInterval:    envDuration("WORKER_SLEEP_POLL_INTERVAL", 0),
			DrivingPollInterval:  envDuration("WORKER_DRIVING_POLL_INTERVAL", 120*time.Second),
			ChargingPollInterval: envDuration("WORKER_CHARGING_POLL_INTERVAL", 600*time.Second),
			StatusCheckInterval:  envDuration("WORKER_STATUS_CHECK_INTERVAL", 900*time.Second),
			SleepPollMult:        envInt("WORKER_SLEEP_POLL_MULT", 4),
			StreamingEnabled:     envBool("WORKER_STREAMING", false),
		},

		Redis: RedisConfig{
			Enabled:  envBool("REDIS_ENABLED", false),
			Host:     envStr("REDIS_HOST", "localhost"),
			Port:     envInt("REDIS_PORT", 6379),
			Password: envStr("REDIS_PASSWORD", ""),
			DB:       envInt("REDIS_DB", 0),
		},

		Auth: AuthConfig{
			Enabled:   envBool("AUTH_ENABLED", false),
			JWTSecret: envStr("AUTH_JWT_SECRET", ""),
		},

		Retention: RetentionConfig{
			DataRetentionDays:     envInt("DATA_RETENTION_DAYS", 365),
			PositionRetentionDays: envInt("POSITION_RETENTION_DAYS", 90),
		},
	}

	return cfg, nil
}

func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
