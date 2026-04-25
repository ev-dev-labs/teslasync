// Deprecated: This package is superseded by internal/config.
// New code should use internal/config exclusively.
// This package will be removed in a future phase — do not add new fields here.
// See: .github/prompts/db-refactor/phase-17-security-reliability/README.md
package config

import (
	"fmt"
	"time"

	"github.com/caarlos0/env/v11"
	"github.com/rs/zerolog/log"
)

// Config holds all application configuration, loaded from environment variables.
type Config struct {
	Server         ServerConfig         `envPrefix:"SERVER_"`
	Database       DatabaseConfig       `envPrefix:"DATABASE_"`
	Redis          RedisConfig          `envPrefix:"REDIS_"`
	Tesla          TeslaConfig          `envPrefix:"TESLA_"`
	MQTT           MQTTConfig           `envPrefix:"MQTT_"`
	Auth           AuthConfig           `envPrefix:"AUTH_"`
	Features       FeatureFlags         `envPrefix:"FEATURE_"`
	OpenTelemetry  OpenTelemetryConfig  `envPrefix:"OTEL_"`
	FleetTelemetry FleetTelemetryConfig `envPrefix:"FLEET_TELEMETRY_"`
	GoogleMaps     GoogleMapsConfig     `envPrefix:"GOOGLE_MAPS_"`
	AzureMaps      AzureMapsConfig      `envPrefix:"AZURE_MAPS_"`
	MongoDB        MongoDBConfig        `envPrefix:"MONGODB_"`
	GasPrice       GasPriceConfig       `envPrefix:"GAS_PRICE_"`
	Retention      RetentionConfig      `envPrefix:"RETENTION_"`
	LogLevel       string               `env:"LOG_LEVEL" envDefault:"info"`
	CORSOrigins    string               `env:"CORS_ORIGINS" envDefault:""`
}

// ServerConfig holds HTTP server settings.
type ServerConfig struct {
	Port            int           `env:"PORT" envDefault:"8080"`
	ReadTimeout     time.Duration `env:"READ_TIMEOUT" envDefault:"10s"`
	WriteTimeout    time.Duration `env:"WRITE_TIMEOUT" envDefault:"30s"`
	IdleTimeout     time.Duration `env:"IDLE_TIMEOUT" envDefault:"60s"`
	ShutdownTimeout time.Duration `env:"SHUTDOWN_TIMEOUT" envDefault:"15s"`
}

// DatabaseConfig holds PostgreSQL connection settings.
type DatabaseConfig struct {
	Host            string        `env:"HOST" envDefault:"localhost"`
	Port            int           `env:"PORT" envDefault:"5432"`
	User            string        `env:"USER" envDefault:"teslasync"`
	Password        string        `env:"PASS" envDefault:"teslasync"`
	Name            string        `env:"NAME" envDefault:"teslasync"`
	SSLMode         string        `env:"SSLMODE" envDefault:"disable"`
	MaxConns        int           `env:"MAX_CONNS" envDefault:"20"`
	MinConns        int           `env:"MIN_CONNS" envDefault:"5"`
	ConnMaxLifetime time.Duration `env:"CONN_MAX_LIFETIME" envDefault:"5m"`
	ConnMaxIdleTime time.Duration `env:"CONN_MAX_IDLE_TIME" envDefault:"1m"`
	MigrationsPath  string        `env:"MIGRATIONS" envDefault:"file:///migrations"`
}

// DSN returns the PostgreSQL connection string.
func (d DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		d.User, d.Password, d.Host, d.Port, d.Name, d.SSLMode,
	)
}

// RedisConfig holds Redis connection settings.
type RedisConfig struct {
	Enabled  bool   `env:"ENABLED" envDefault:"false"`
	Host     string `env:"HOST" envDefault:"localhost"`
	Port     int    `env:"PORT" envDefault:"6379"`
	Password string `env:"PASSWORD" envDefault:""`
	DB       int    `env:"DB" envDefault:"0"`
}

// Addr returns the Redis address in host:port format.
func (r RedisConfig) Addr() string {
	return fmt.Sprintf("%s:%d", r.Host, r.Port)
}

// TeslaConfig holds Tesla Fleet API settings.
type TeslaConfig struct {
	ClientID        string        `env:"CLIENT_ID" envDefault:""`
	ClientSecret    string        `env:"CLIENT_SECRET" envDefault:""`
	BaseURL         string        `env:"API_BASE_URL" envDefault:"https://fleet-api.prd.na.vn.cloud.tesla.com"`
	AuthURL         string        `env:"AUTH_URL" envDefault:"https://auth.tesla.com"`
	RedirectURI     string        `env:"REDIRECT_URI" envDefault:"http://localhost:8080/api/v1/auth/callback"`
	CommandProxyURL string        `env:"COMMAND_PROXY_URL" envDefault:""`
	Timeout         time.Duration `env:"TIMEOUT" envDefault:"30s"`
}

// MQTTConfig holds MQTT broker settings.
type MQTTConfig struct {
	Enabled  bool   `env:"ENABLED" envDefault:"true"`
	Host     string `env:"HOST" envDefault:"localhost"`
	Port     int    `env:"PORT" envDefault:"1883"`
	Username string `env:"USERNAME" envDefault:""`
	Password string `env:"PASSWORD" envDefault:""`
	ClientID string `env:"CLIENT_ID" envDefault:"teslasync"`
	Prefix   string `env:"PREFIX" envDefault:"teslasync"`
}

// BrokerURL returns the MQTT broker URL.
func (m MQTTConfig) BrokerURL() string {
	return fmt.Sprintf("tcp://%s:%d", m.Host, m.Port)
}

// AuthConfig holds authentication settings.
type AuthConfig struct {
	Enabled          bool   `env:"ENABLED" envDefault:"false"`
	JWTSecret        string `env:"JWT_SECRET" envDefault:""`
	AuthentikURL     string `env:"AUTHENTIK_URL" envDefault:""`
	AuthentikHMACKey string `env:"AUTHENTIK_HMAC_KEY" envDefault:""`
}

// FeatureFlags controls optional feature toggles.
type FeatureFlags struct {
	EnableExportWorker       bool `env:"EXPORT_WORKER" envDefault:"true"`
	EnableNotificationWorker bool `env:"NOTIFICATION_WORKER" envDefault:"true"`
	EnableFleetTelemetry     bool `env:"FLEET_TELEMETRY" envDefault:"false"`
	EnableGasPrices          bool `env:"GAS_PRICES" envDefault:"false"`
	EnableMongoDB            bool `env:"MONGODB" envDefault:"false"`
}

// OpenTelemetryConfig controls distributed tracing.
type OpenTelemetryConfig struct {
	Enabled     bool   `env:"ENABLED" envDefault:"false"`
	Endpoint    string `env:"ENDPOINT" envDefault:"localhost:4317"`
	ServiceName string `env:"SERVICE_NAME" envDefault:"teslasync"`
	Insecure    bool   `env:"INSECURE" envDefault:"true"`
}

// FleetTelemetryConfig holds fleet telemetry MQTT settings.
type FleetTelemetryConfig struct {
	Enabled              bool          `env:"ENABLED" envDefault:"false"`
	Host                 string        `env:"HOST" envDefault:""`
	Port                 int           `env:"PORT" envDefault:"4443"`
	TopicBase            string        `env:"TOPIC_BASE" envDefault:"telemetry"`
	BatchMs              int           `env:"BATCH_MS" envDefault:"100"`
	StaleTimeout         time.Duration `env:"STALE_TIMEOUT" envDefault:"15m"`
	FallbackPollInterval time.Duration `env:"FALLBACK_POLL_INTERVAL" envDefault:"5m"`
}

// GoogleMapsConfig holds Google Maps API settings.
type GoogleMapsConfig struct {
	APIKey string `env:"API_KEY" envDefault:""`
}

// AzureMapsConfig holds Azure Maps API settings.
type AzureMapsConfig struct {
	APIKey string `env:"API_KEY" envDefault:""`
}

// MongoDBConfig holds MongoDB settings.
type MongoDBConfig struct {
	Enabled  bool   `env:"ENABLED" envDefault:"false"`
	URI      string `env:"URI" envDefault:"mongodb://localhost:27017"`
	Database string `env:"DATABASE" envDefault:"teslasync"`
	TTLDays  int    `env:"TTL_DAYS" envDefault:"7"`
}

// GasPriceConfig holds EIA gas price API settings.
type GasPriceConfig struct {
	Enabled      bool   `env:"ENABLED" envDefault:"false"`
	PollInterval string `env:"POLL_INTERVAL" envDefault:"7d"`
	APIKey       string `env:"API_KEY" envDefault:""`
}

// RetentionConfig holds data retention settings.
type RetentionConfig struct {
	DataRetentionDays     int `env:"DATA_DAYS" envDefault:"365"`
	PositionRetentionDays int `env:"POSITION_DAYS" envDefault:"90"`
}

// MustLoad parses configuration from environment variables and validates it.
// It fatally exits if the configuration is invalid.
func MustLoad() *Config {
	cfg, err := Load()
	if err != nil {
		log.Fatal().Err(err).Msg("failed to load configuration")
	}
	return cfg
}

// Load parses configuration from environment variables.
func Load() (*Config, error) {
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return nil, fmt.Errorf("parsing env config: %w", err)
	}
	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("validating config: %w", err)
	}
	return &cfg, nil
}

// validate checks for invalid configuration combinations.
func (c *Config) validate() error {
	if c.Server.Port < 1 || c.Server.Port > 65535 {
		return fmt.Errorf("server port must be between 1 and 65535, got %d", c.Server.Port)
	}
	if c.Database.MaxConns < 1 {
		return fmt.Errorf("database max_conns must be >= 1, got %d", c.Database.MaxConns)
	}
	if c.Database.MinConns < 0 {
		return fmt.Errorf("database min_conns must be >= 0, got %d", c.Database.MinConns)
	}
	if c.Database.MinConns > c.Database.MaxConns {
		return fmt.Errorf("database min_conns (%d) must not exceed max_conns (%d)", c.Database.MinConns, c.Database.MaxConns)
	}
	if c.Auth.Enabled && c.Auth.JWTSecret == "" && c.Auth.AuthentikURL == "" {
		return fmt.Errorf("auth is enabled but neither JWT_SECRET nor AUTHENTIK_URL is set")
	}
	if c.Redis.Enabled && c.Redis.Port < 1 {
		return fmt.Errorf("redis is enabled but port is invalid: %d", c.Redis.Port)
	}
	return nil
}
