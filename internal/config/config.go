package config

import (
	"fmt"
	"math"
	"os"
	"strconv"
	"time"
)

// Config holds all application configuration.
type Config struct {
	Port int
	// DrainPort is the port of the ISOLATED internal drain listener that
	// serves the Kubernetes preStop hook (POST/GET /internal/flush).
	//
	// It is deliberately separate from Port: the drain endpoint is
	// one-way and pod-fatal (permanent readiness 503, every SSE stream
	// released), so it must never be reachable through the Service or
	// the Ingress. Kubelet reaches it by dialling the pod IP directly,
	// which needs no Service at all.
	//
	// See internal/app/drain.go and the exposure assertions in
	// .github/workflows/ops-gate.yml.
	DrainPort            int
	LogLevel             string
	CORSOrigins          string
	VehiclePhotoDir      string
	Environment          string
	ServiceVersion       string
	OTLPEndpoint         string
	OTELTracesSamplerArg string
	// RequireCookieConsent opts the deployment into the GDPR / ePrivacy
	// cookie-consent banner. Default false so
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
	Profiling            ProfilingConfig
	SLO                  SLOConfig
	DataQuality          DataQualityConfig
	Synthetic            SyntheticConfig
	HomeAssistant        HomeAssistantConfig
	GoogleMaps           GoogleMapsConfig
	AzureMaps            AzureMapsConfig
	APILogs              APILogsConfig
	WebPush              WebPushConfig
	System               SystemConfig
	GitHub               GitHubConfig

	// Operator-toggled behaviors that should not require a code change.
	Features FeaturesConfig
}

// FeaturesConfig holds operator-toggled behaviors that we don't want
// gated on a code change. These are read at startup; the dynamic
// internal/flags store is for runtime toggles that can change without
// a restart.

type FeaturesConfig struct {
	// DLQReplayEnabled gates the POST /system/dlq/{id}/replay endpoint.
	// Default false — an operator must explicitly opt in (env var or
	// helm values) because replay re-publishes a payload that already
	// triggered an exception in production. Replay is also gated by
	// sudo-token middleware AND audited on every code path.
	DLQReplayEnabled bool
	// DLQRingCapacity bounds the in-memory ring buffer the inspector
	// subscriber maintains. Default 200 entries (~800KB). Older
	// entries rotate out; audit rows survive ring rotation.
	DLQRingCapacity int
}

// GitHubConfig controls the bridge from the admin feedback queue. When
// Repo or Token is empty the bridge is disabled — the admin endpoint
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

// SystemConfig holds the operator-controlled service-mode banner state.
// When Mode is empty, the effective state comes
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
// notifications to subscribed browsers.
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

// APILogsConfig controls the inbound api_call_logs middleware.
//
// When Enabled is false the middleware uses a no-op logger, so a misconfigured
// or under-provisioned writer can be disabled at runtime without a rebuild.
//
// CaptureBodies toggles request/response body persistence (default OFF, per
// ADR-038-08); when enabled both bodies are truncated at 10 KB.
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

// ProfilingConfig controls Pyroscope continuous profiling. Defaults to
// disabled — when ServerAddress is empty the profiler is a no-op and
// the runtime profilers stay at their stock rates. When enabled, every
// long-lived binary (API + 3 workers) uploads CPU/heap/goroutine/mutex
// profiles to the Pyroscope server using godeltaprof deltas (<1% CPU
// overhead). See the Pyroscope runbook for the dashboard taxonomy.
type ProfilingConfig struct {
	// Enabled gates the entire profiler. Default false.
	Enabled bool
	// ServerAddress is the Pyroscope server's ingest URL
	// (e.g. http://pyroscope:4040). Required when Enabled is true.
	ServerAddress string
	// UploadRate controls how often deltas are pushed. Default 15s
	// matches Pyroscope's documented baseline; lower values increase
	// resolution at the cost of network bytes.
	UploadRate time.Duration
}

// SLOConfig controls the live SLO board.
type SLOConfig struct {
	// CatalogPath points at slo/catalog.yaml. Default
	// "slo/catalog.yaml" (relative to the binary's CWD).
	CatalogPath string
	// PromBaseURL is the Prometheus HTTP API base
	// (e.g. http://prometheus:9090). Empty disables live tier
	// evaluation — the catalog metadata is still served so the SPA
	// can render names + targets + a "Prometheus not configured"
	// banner.
	PromBaseURL string
}

// DataQualityConfig controls per-field freshness, gap, and duplicate
// scoring from signal_log.
type DataQualityConfig struct {
	// Enabled gates the scorer. Default true — lineage graph is
	// always served because it reads embedded routing.yaml.
	Enabled bool
	// WindowMins is the lookback window for every aggregate.
	// Default 60.
	WindowMins int
}

// SyntheticConfig controls outside-in canary probes for health and
// readiness endpoints.
type SyntheticConfig struct {
	// Enabled gates the runner. Default false (opt-in to keep test
	// + local dev quiet).
	Enabled bool
	// IntervalSeconds between probe ticks. Default 60.
	IntervalSeconds int
	// TimeoutSeconds per probe invocation. Default 30.
	TimeoutSeconds int
	// ProbeURLs is the comma-separated list of full URLs to probe
	// (e.g. "http://localhost:8080/healthz,http://localhost:8080/readyz").
	// Default empty — runner is configured but registers zero
	// probes so /admin/observability/synthetic returns an empty
	// snapshot.
	ProbeURLs string
	// JourneyBaseURL, when set, registers the canonical critical-operator
	// journey probe (dashboard/fleet state -> vehicle inspect -> battery
	// health -> charging history — see
	// internal/synthetic.OperatorChainJourneySteps) against this base URL
	// (e.g. "http://localhost:8080"). Default empty — disabled.
	JourneyBaseURL string
}

// HomeAssistantConfig controls the MQTT discovery publisher that emits a
// Home Assistant entity catalog for every
// vehicle on a periodic tick. Opt-in via HOMEASSISTANT_ENABLED=true
// to avoid surprising operators who don't run HA.
type HomeAssistantConfig struct {
	// Enabled gates the publisher. Default false.
	Enabled bool
	// DiscoveryPrefix matches HA's "discovery prefix" setting.
	// Default "homeassistant".
	DiscoveryPrefix string
	// PublishInterval controls how often the publisher reasserts
	// the full catalog. Default 1h — HA's discovery listener
	// caches retained config topics, so the interval primarily
	// guards against schema drift / display-name changes.
	PublishInterval time.Duration
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
	// DailyBudgetUSD is a conservative UTC-daily estimated Fleet API spend
	// ceiling shared across API and worker processes. Zero disables the guard.
	DailyBudgetUSD float64
	// CommandReserveUSD protects part of the daily ceiling from background
	// reads so user and automation commands retain capacity late in the day.
	CommandReserveUSD float64
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
	// SignalHistoryRetentionAcknowledged must be enabled explicitly after
	// verifying a recoverable backup; this keeps upgrades non-destructive.
	SignalHistoryRetentionAcknowledged bool
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
		Port:                 envInt("TESLASYNC_PORT", 4000),
		DrainPort:            envInt("TESLASYNC_DRAIN_PORT", 8090),
		LogLevel:             envStr("TESLASYNC_LOG_LEVEL", "info"),
		CORSOrigins:          envStr("CORS_ORIGINS", ""),
		VehiclePhotoDir:      envStr("TESLASYNC_VEHICLE_PHOTO_DIR", "/var/lib/teslasync/photos"),
		Environment:          envStr("TESLASYNC_ENVIRONMENT", envStr("ENVIRONMENT", "development")),
		ServiceVersion:       envStr("TESLASYNC_SERVICE_VERSION", envStr("VERSION", "dev")),
		OTLPEndpoint:         envStr("OTEL_EXPORTER_OTLP_ENDPOINT", envStr("OTEL_ENDPOINT", "http://otel-collector:4317")),
		OTELTracesSamplerArg: envStr("OTEL_TRACES_SAMPLER_ARG", "1.0"),
		// Default off so self-hosted installs keep working without a banner.
		// Set TESLASYNC_REQUIRE_COOKIE_CONSENT=true
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
			ClientID:          envStr("TESLA_CLIENT_ID", ""),
			ClientSecret:      envStr("TESLA_CLIENT_SECRET", ""),
			BaseURL:           envStr("TESLA_API_BASE_URL", "https://fleet-api.prd.na.vn.cloud.tesla.com"),
			AuthURL:           envStr("TESLA_AUTH_URL", "https://auth.tesla.com"),
			RedirectURI:       envStr("TESLA_REDIRECT_URI", "http://localhost:4000/api/v1/auth/callback"),
			CommandProxyURL:   envStr("TESLA_COMMAND_PROXY_URL", ""),
			Timeout:           envDuration("TESLA_TIMEOUT", 30*time.Second),
			DailyBudgetUSD:    envFloat64("TESLA_API_DAILY_BUDGET_USD", 0.30),
			CommandReserveUSD: envFloat64("TESLA_API_COMMAND_RESERVE_USD", 0.05),
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
			DataRetentionDays:                  envInt("DATA_RETENTION_DAYS", 0),
			PositionRetentionDays:              envInt("POSITION_RETENTION_DAYS", 0),
			SignalHistoryRetentionDays:         envInt("SIGNAL_HISTORY_RETENTION_DAYS", 365),
			SignalHistoryRetentionAcknowledged: envBool("SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED", false),
			AuditRetentionDays:                 envInt("AUDIT_RETENTION_DAYS", 365),
			AuditIPRetentionDays:               envInt("AUDIT_IP_RETENTION_DAYS", 30),
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

		Profiling: ProfilingConfig{
			Enabled:       envBool("PYROSCOPE_ENABLED", false),
			ServerAddress: envStr("PYROSCOPE_SERVER_ADDRESS", ""),
			UploadRate:    envDuration("PYROSCOPE_UPLOAD_RATE", 15*time.Second),
		},

		SLO: SLOConfig{
			CatalogPath: envStr("SLO_CATALOG_PATH", "slo/catalog.yaml"),
			PromBaseURL: envStr("PROMETHEUS_BASE_URL", ""),
		},

		DataQuality: DataQualityConfig{
			Enabled:    envBool("DATA_QUALITY_ENABLED", true),
			WindowMins: envInt("DATA_QUALITY_WINDOW_MINS", 60),
		},

		Synthetic: SyntheticConfig{
			Enabled:         envBool("SYNTHETIC_ENABLED", false),
			IntervalSeconds: envInt("SYNTHETIC_INTERVAL_SECONDS", 60),
			TimeoutSeconds:  envInt("SYNTHETIC_TIMEOUT_SECONDS", 30),
			ProbeURLs:       envStr("SYNTHETIC_PROBE_URLS", ""),
			JourneyBaseURL:  envStr("SYNTHETIC_JOURNEY_BASE_URL", ""),
		},

		HomeAssistant: HomeAssistantConfig{
			Enabled:         envBool("HOMEASSISTANT_ENABLED", false),
			DiscoveryPrefix: envStr("HOMEASSISTANT_DISCOVERY_PREFIX", "homeassistant"),
			PublishInterval: envDuration("HOMEASSISTANT_PUBLISH_INTERVAL", time.Hour),
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

		Features: FeaturesConfig{
			DLQReplayEnabled: envBool("DLQ_REPLAY_ENABLED", false),
			DLQRingCapacity:  envInt("DLQ_RING_CAPACITY", 200),
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

func envFloat64(key string, fallback float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f >= 0 && !math.IsInf(f, 0) && !math.IsNaN(f) {
			return f
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
