package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds all application configuration.
type Config struct {
	Port           int
	LogLevel       string
	CORSOrigins    string
	Database       DatabaseConfig
	Tesla          TeslaConfig
	MQTT           MQTTConfig
	Worker         WorkerConfig
	Redis          RedisConfig
	Auth           AuthConfig
	Retention      RetentionConfig
	FleetTelemetry FleetTelemetryConfig
	MongoDB        MongoDBConfig
	GasPrice       GasPriceConfig
	OpenTelemetry  OpenTelemetryConfig
	GoogleMaps     GoogleMapsConfig
	AzureMaps      AzureMapsConfig
}

// GoogleMapsConfig holds settings for the Google Maps geocoding API.
type GoogleMapsConfig struct {
	APIKey string
}

// AzureMapsConfig holds settings for the Azure Maps geocoding API.
type AzureMapsConfig struct {
	APIKey string
}

// OpenTelemetryConfig controls optional distributed tracing via OpenTelemetry.
type OpenTelemetryConfig struct {
	Enabled     bool   `json:"enabled"`
	Endpoint    string `json:"endpoint"`
	ServiceName string `json:"service_name"`
	Insecure    bool   `json:"insecure"`
}

// GasPriceConfig controls automated gas price polling from the EIA API.
type GasPriceConfig struct {
	Enabled      bool
	PollInterval string // "daily", "7d", "15d", "30d"
	APIKey       string
}

type MongoDBConfig struct {
	Enabled  bool
	URI      string
	Database string
	TTLDays  int
}

type FleetTelemetryConfig struct {
	Enabled               bool
	Host                  string
	Port                  int
	TopicBase             string        // MQTT topic base for fleet-telemetry (e.g., "telemetry")
	BatchMs               int           // Signal batching window in milliseconds
	StaleTimeout          time.Duration // How long without signals before a vehicle is considered stale (fallback to API polling)
	FallbackPollInterval  time.Duration // How often to poll non-streaming vehicles when telemetry is enabled
	SnapshotWriteInterval time.Duration // How often to flush accumulated signals to DB per vehicle (default 10s)
	CleanupInterval       time.Duration // How often to run stale-session cleanup (default 2m)
	StaleSessionTimeout   time.Duration // Close drive/charge sessions idle longer than this (default 5m)
	LiveSignalStoreMode   string        // hybrid uses Redis-backed live reads; local keeps L1-only rollback mode
}

type DatabaseConfig struct {
	Host              string
	Port              int
	User              string
	Password          string
	Name              string
	SSLMode           string
	MaxConns          int
	MinConns          int
	ConnMaxLifetime   time.Duration
	ConnMaxIdleTime   time.Duration
	MigrationsPath    string
	ConnectTimeout    int           // seconds, appended to DSN as connect_timeout
	StatementTimeout  int           // milliseconds, appended to DSN as statement_timeout
	HealthCheckPeriod time.Duration // pool health check interval
}

func (d DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s&connect_timeout=%d&statement_timeout=%d",
		d.User, d.Password, d.Host, d.Port, d.Name, d.SSLMode,
		d.ConnectTimeout, d.StatementTimeout,
	)
}

// MigrationDSN returns a DSN without statement_timeout. Migrations use
// pg_advisory_lock which must wait indefinitely for the lock — a statement
// timeout would kill the lock acquisition and crash the pod.
func (d DatabaseConfig) MigrationDSN() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s&connect_timeout=%d",
		d.User, d.Password, d.Host, d.Port, d.Name, d.SSLMode,
		d.ConnectTimeout,
	)
}

type TeslaConfig struct {
	ClientID        string
	ClientSecret    string
	BaseURL         string
	AuthURL         string
	RedirectURI     string
	CommandProxyURL string // Vehicle Command Proxy URL for signed commands
	Timeout         time.Duration
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
	PollInterval     time.Duration
	SleepPollMult    int
	StreamingEnabled bool
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
	Enabled           bool
	JWTSecret         string
	ForwardAuthHeader string // Header set by reverse proxy auth (e.g. X-Forwarded-User)
}

type RetentionConfig struct {
	DataRetentionDays        int
	PositionRetentionDays    int
	SignalHistoryRetentionDays int
}

// Load reads configuration from environment variables with sensible defaults.
//
// SECURITY: Do not log the returned Config struct directly — it contains
// sensitive fields (Database.Password, Tesla.ClientSecret, MQTT.Password,
// Redis.Password, Auth.JWTSecret). If diagnostic logging is needed, redact
// these fields first or log only non-sensitive values.
func Load() (*Config, error) {
	cfg := &Config{
		Port:        envInt("TESLASYNC_PORT", 4000),
		LogLevel:    envStr("TESLASYNC_LOG_LEVEL", "info"),
		CORSOrigins: envStr("CORS_ORIGINS", ""),

		Database: DatabaseConfig{
			Host:              envStr("DATABASE_HOST", "localhost"),
			Port:              envInt("DATABASE_PORT", 5432),
			User:              envStr("DATABASE_USER", "teslasync"),
			Password:          envStr("DATABASE_PASS", "teslasync"),
			Name:              envStr("DATABASE_NAME", "teslasync"),
			SSLMode:           envStr("DATABASE_SSLMODE", "disable"),
			MaxConns:          envInt("DATABASE_MAX_CONNS", 25),
			MinConns:          envInt("DATABASE_MIN_CONNS", 5),
			ConnMaxLifetime:   envDuration("DATABASE_CONN_MAX_LIFETIME", 5*time.Minute),
			ConnMaxIdleTime:   envDuration("DATABASE_CONN_MAX_IDLE_TIME", 1*time.Minute),
			MigrationsPath:    envStr("DATABASE_MIGRATIONS", "file:///migrations"),
			ConnectTimeout:    envInt("DATABASE_CONNECT_TIMEOUT", 5),
			StatementTimeout:  envInt("DATABASE_STATEMENT_TIMEOUT", 30000),
			HealthCheckPeriod: envDuration("DATABASE_HEALTH_CHECK_PERIOD", 5*time.Second),
		},

		Tesla: TeslaConfig{
			ClientID:        envStr("TESLA_CLIENT_ID", ""),
			ClientSecret:    envStr("TESLA_CLIENT_SECRET", ""),
			BaseURL:         envStr("TESLA_API_BASE_URL", "https://fleet-api.prd.na.vn.cloud.tesla.com"),
			AuthURL:         envStr("TESLA_AUTH_URL", "https://auth.tesla.com"),
			RedirectURI:     envStr("TESLA_REDIRECT_URI", "http://localhost:4000/api/v1/auth/callback"),
			CommandProxyURL: envStr("TESLA_COMMAND_PROXY_URL", ""),
			Timeout:         envDuration("TESLA_TIMEOUT", 30*time.Second),
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
			PollInterval:     envDuration("WORKER_POLL_INTERVAL", 15*time.Second),
			SleepPollMult:    envInt("WORKER_SLEEP_POLL_MULT", 4),
			StreamingEnabled: envBool("WORKER_STREAMING", false),
		},

		Redis: RedisConfig{
			Enabled:  envBool("REDIS_ENABLED", false),
			Host:     envStr("REDIS_HOST", "localhost"),
			Port:     envInt("REDIS_PORT", 6379),
			Password: envStr("REDIS_PASSWORD", ""),
			DB:       envInt("REDIS_DB", 0),
		},

		Auth: AuthConfig{
			Enabled:           envBool("AUTH_ENABLED", false),
			JWTSecret:         envStr("AUTH_JWT_SECRET", ""),
			ForwardAuthHeader: envStr("FORWARD_AUTH_HEADER", ""),
		},

		Retention: RetentionConfig{
			DataRetentionDays:          envInt("DATA_RETENTION_DAYS", 0),
			PositionRetentionDays:      envInt("POSITION_RETENTION_DAYS", 0),
			SignalHistoryRetentionDays: envInt("SIGNAL_HISTORY_RETENTION_DAYS", 0),
		},

		FleetTelemetry: FleetTelemetryConfig{
			Enabled:               envBool("FLEET_TELEMETRY_ENABLED", false),
			Host:                  envStr("FLEET_TELEMETRY_HOST", ""),
			Port:                  envInt("FLEET_TELEMETRY_PORT", 4443),
			TopicBase:             envStr("FLEET_TELEMETRY_TOPIC_BASE", "telemetry"),
			BatchMs:               envInt("FLEET_TELEMETRY_BATCH_MS", 100),
			StaleTimeout:          envDuration("FLEET_TELEMETRY_STALE_TIMEOUT", 15*time.Minute),
			FallbackPollInterval:  envDuration("FLEET_TELEMETRY_FALLBACK_POLL_INTERVAL", 5*time.Minute),
			SnapshotWriteInterval: envDuration("FLEET_TELEMETRY_SNAPSHOT_WRITE_INTERVAL", 10*time.Second),
			CleanupInterval:       envDuration("FLEET_TELEMETRY_CLEANUP_INTERVAL", 2*time.Minute),
			StaleSessionTimeout:   envDuration("FLEET_TELEMETRY_STALE_SESSION_TIMEOUT", 5*time.Minute),
			LiveSignalStoreMode:   envStr("LIVE_SIGNAL_STORE_MODE", "hybrid"),
		},

		MongoDB: MongoDBConfig{
			Enabled:  envBool("MONGODB_ENABLED", false),
			URI:      envStr("MONGODB_URI", "mongodb://localhost:27017"),
			Database: envStr("MONGODB_DATABASE", "teslasync"),
			TTLDays:  envInt("MONGODB_TTL_DAYS", 7),
		},

		GasPrice: GasPriceConfig{
			Enabled:      envBool("GAS_PRICE_ENABLED", false),
			PollInterval: envStr("GAS_PRICE_POLL_INTERVAL", "7d"),
			APIKey:       envStr("GAS_PRICE_API_KEY", ""),
		},

		OpenTelemetry: OpenTelemetryConfig{
			Enabled:     envBool("OTEL_ENABLED", false),
			Endpoint:    envStr("OTEL_ENDPOINT", "localhost:4317"),
			ServiceName: envStr("OTEL_SERVICE_NAME", "teslasync"),
			Insecure:    envBool("OTEL_INSECURE", true),
		},

		GoogleMaps: GoogleMapsConfig{
			APIKey: envStr("GOOGLE_MAPS_API_KEY", ""),
		},

		AzureMaps: AzureMapsConfig{
			APIKey: envStr("AZURE_MAPS_API_KEY", ""),
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
