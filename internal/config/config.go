package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds all application configuration.
type Config struct {
	Port             int
	LogLevel         string
	CORSOrigins      string
	VehiclePhotoDir  string
	// RequireCookieConsent (Phase-46 / Prompt 70) opts the deployment
	// into the GDPR / ePrivacy cookie-consent banner. Default false so
	// the typical self-hosted single-user instance is unaffected — only
	// fleet operators serving multiple EU drivers, or instances exposed
	// publicly with analytics enabled, need to flip this to true.
	//
	// When true, the SPA renders a bottom-of-screen banner the first
	// time a visitor lands on the page; client-side reporting (web
	// vitals, error reporter) gates its POSTs on the user's stored
	// consent. When false, all reporting flows unchanged and the
	// banner never renders.
	RequireCookieConsent bool
	Database             DatabaseConfig
	Tesla                TeslaConfig
	MQTT                 MQTTConfig
	Worker               WorkerConfig
	Redis                RedisConfig
	Auth                 AuthConfig
	Retention            RetentionConfig
	FleetTelemetry       FleetTelemetryConfig
	MongoDB              MongoDBConfig
	GasPrice             GasPriceConfig
	OpenTelemetry        OpenTelemetryConfig
	GoogleMaps           GoogleMapsConfig
	AzureMaps            AzureMapsConfig
	APILogs              APILogsConfig
	WebPush              WebPushConfig
	System               SystemConfig
	GitHub               GitHubConfig
}

// GitHubConfig holds the credentials used by the optional GitHub Issues
// bridge in the admin feedback queue (Phase-46 / Prompt 08). When Repo
// or Token is empty the bridge is disabled — the admin endpoint
// surfaces this in its response and the SPA hides the "Forward to
// GitHub" action.
type GitHubConfig struct {
	// Repo is the target repository in "owner/name" form (e.g.
	// "ev-dev-labs/teslasync"). Empty disables the bridge.
	Repo string
	// Token is a fine-grained Personal Access Token with the "Issues:
	// write" scope on Repo. Empty disables the bridge.
	Token string
}

// SystemConfig holds the operator-controlled service-mode banner state
// (Phase-46 / Prompt 04). When Mode is empty, the effective state comes
// from the system_state DB row; when Mode is non-empty (any of "ok",
// "degraded", "maintenance"), the env values override the DB so an
// operator can force-clear or force-set the banner without touching the
// database (useful during deploy/rollback).
type SystemConfig struct {
	// Mode is the operator-supplied service mode override. Empty means
	// "fall through to DB state". Valid non-empty values: "ok",
	// "degraded", "maintenance". Other values are treated as empty
	// (no override) by the resolver.
	Mode string
	// MaintenanceMessage is the banner text shown to users when Mode is
	// "degraded" or "maintenance". Trimmed and truncated to 280 chars
	// at write time. Ignored when Mode is empty or "ok".
	MaintenanceMessage string
	// MaintenanceUntil is an RFC3339 timestamp when the banner should
	// auto-clear (informational; the SPA renders a countdown). Empty
	// string means no scheduled end. Invalid values are passed through
	// to the SPA as-is so misconfiguration surfaces in dev tools.
	MaintenanceUntil string
}

// WebPushConfig holds VAPID credentials used to sign and deliver Web Push
// notifications to subscribed browsers (Phase 40 / Prompt 52).
//
// All three fields are required for the push channel to be active. When
// any is empty, the push channel is disabled and the public-key endpoint
// returns 404 — the frontend interprets that as "browser push unavailable
// for this install" and hides the Enable button accordingly.
//
// VAPID keys MUST be generated once (offline) and pinned via env vars:
//
//	go run ./cmd/teslasync vapid-keygen
//
// Auto-generating at startup would invalidate every existing subscription
// on the next restart.
type WebPushConfig struct {
	// PublicKey is the base64url-encoded VAPID public key (~88 chars).
	// Returned to the browser unauthenticated via GET /push/public-key
	// and used by the browser as `applicationServerKey` when subscribing.
	PublicKey string
	// PrivateKey is the base64url-encoded VAPID private key (~44 chars).
	// SECRET — kept out of the frontend bundle; only the API server and
	// notification worker need it (to sign each push request's JWT).
	PrivateKey string
	// Subject is the `mailto:` or HTTPS URL the push service contacts
	// when a subscription needs operator follow-up. SECRET-ish — leaks
	// the operator's email if exposed via logs.
	Subject string
}

// Enabled reports whether all three VAPID fields are set. The push
// channel registers as a no-op when this returns false.
func (w WebPushConfig) Enabled() bool {
	return w.PublicKey != "" && w.PrivateKey != "" && w.Subject != ""
}

// APILogsConfig controls the inbound api_call_logs middleware (Phase 38-10).
//
// When Enabled is false the middleware uses a no-op logger, so a misconfigured
// or under-provisioned writer can be disabled at runtime without a rebuild.
//
// CaptureBodies toggles request/response body persistence (default OFF, per
// ADR phase-38-08); when enabled both bodies are truncated at 10 KB.
//
// QueueCapacity, BatchSize and FlushInterval tune the async writer's
// channel/batcher.
type APILogsConfig struct {
	Enabled       bool
	CaptureBodies bool
	QueueCapacity int
	BatchSize     int
	FlushInterval time.Duration
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
	// ProviderHint is operator-supplied free text surfaced verbatim by
	// the /system/auth-mode endpoint. The SPA renders it as informative
	// copy ("Sign in via Authentik / Authelia / oauth2-proxy / Keycloak
	// / …"); TeslaSync NEVER routes off it or speaks to the upstream
	// IdP's admin API. Empty by default — when unset the SPA falls back
	// to a generic "your authentication provider" string.
	ProviderHint string
}

type RetentionConfig struct {
	DataRetentionDays          int
	PositionRetentionDays      int
	SignalHistoryRetentionDays int
	// AuditRetentionDays is the maximum age (in days) of rows kept in
	// audit_logs. Default 365. Set to 0 to disable automatic cleanup.
	AuditRetentionDays int
	// AuditIPRetentionDays is the age (in days) after which audit_logs.ip
	// and audit_logs.user_agent are redacted to NULL. Default 30. Always
	// less than or equal to AuditRetentionDays in practice; set to 0 to
	// disable IP/UA redaction (rows are still pruned per AuditRetentionDays).
	AuditIPRetentionDays int
}

// Load reads configuration from environment variables with sensible defaults.
//
// SECURITY: Do not log the returned Config struct directly — it contains
// sensitive fields (Database.Password, Tesla.ClientSecret, MQTT.Password,
// Redis.Password, Auth.JWTSecret). If diagnostic logging is needed, redact
// these fields first or log only non-sensitive values.
func Load() (*Config, error) {
	cfg := &Config{
		Port:            envInt("TESLASYNC_PORT", 4000),
		LogLevel:        envStr("TESLASYNC_LOG_LEVEL", "info"),
		CORSOrigins:     envStr("CORS_ORIGINS", ""),
		VehiclePhotoDir: envStr("TESLASYNC_VEHICLE_PHOTO_DIR", "/var/lib/teslasync/photos"),
		// Phase-46 / Prompt 70 — default OFF so self-hosted installs
		// keep working without a banner. Set TESLASYNC_REQUIRE_COOKIE_CONSENT=true
		// only on multi-user / public-facing deployments where GDPR /
		// ePrivacy compliance applies.
		RequireCookieConsent: envBool("TESLASYNC_REQUIRE_COOKIE_CONSENT", false),

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
			ProviderHint:      envStr("TESLASYNC_AUTH_PROVIDER_HINT", ""),
		},

		Retention: RetentionConfig{
			DataRetentionDays:          envInt("DATA_RETENTION_DAYS", 0),
			PositionRetentionDays:      envInt("POSITION_RETENTION_DAYS", 0),
			SignalHistoryRetentionDays: envInt("SIGNAL_HISTORY_RETENTION_DAYS", 0),
			AuditRetentionDays:         envInt("AUDIT_RETENTION_DAYS", 365),
			AuditIPRetentionDays:       envInt("AUDIT_IP_RETENTION_DAYS", 30),
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

		APILogs: APILogsConfig{
			Enabled:       envBool("API_LOGS_INBOUND_ENABLED", true),
			CaptureBodies: envBool("API_LOG_CAPTURE_BODIES", false),
			QueueCapacity: envInt("API_LOG_QUEUE_CAPACITY", 4096),
			BatchSize:     envInt("API_LOG_BATCH_SIZE", 100),
			FlushInterval: envDuration("API_LOG_FLUSH_INTERVAL", 1*time.Second),
		},

		WebPush: WebPushConfig{
			PublicKey:  envStr("TESLASYNC_VAPID_PUBLIC_KEY", ""),
			PrivateKey: envStr("TESLASYNC_VAPID_PRIVATE_KEY", ""),
			Subject:    envStr("TESLASYNC_VAPID_SUBJECT", ""),
		},

		System: SystemConfig{
			Mode:               envStr("TESLASYNC_SYSTEM_MODE", ""),
			MaintenanceMessage: envStr("TESLASYNC_SYSTEM_MAINTENANCE_MESSAGE", ""),
			MaintenanceUntil:   envStr("TESLASYNC_SYSTEM_MAINTENANCE_UNTIL", ""),
		},

		GitHub: GitHubConfig{
			Repo:  envStr("TESLASYNC_GITHUB_REPO", ""),
			Token: envStr("TESLASYNC_GITHUB_TOKEN", ""),
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
