package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// RouterOptions holds optional parameters for NewRouter.
type RouterOptions struct {
	AppVersion       string
	Encryptor        *crypto.Encryptor
	TelemetryHandler *TelemetryHandler // If set, reuses existing handler (for hybrid mode wiring)
}

// NewRouter creates and configures the main HTTP router with all API routes,
// middleware (logging, recovery, CORS, rate limiting, security headers), and
// a static file server for the SPA frontend. It wires up handler dependencies
// and returns the ready-to-serve http.Handler.
func NewRouter(db *database.DB, teslaClient *tesla.Client, mqttClient *mqtt.Client, cfg *config.Config, health *resilience.HealthMonitor, opts ...RouterOptions) http.Handler {
	r := chi.NewRouter()

	var opt RouterOptions
	if len(opts) > 0 {
		opt = opts[0]
	}

	// SSE event hub for real-time updates
	eventHub := NewEventHub()

	// Global middleware
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(LoggerMiddleware)
	r.Use(RecoveryMiddleware) // Enhanced recovery that logs panics as structured errors
	r.Use(chimw.Compress(5))

	// CORS — use explicit origins in production. The wildcard is kept for
	// development convenience but paired with AllowCredentials=false to comply
	// with the Fetch spec. Set CORS_ORIGINS env var for production.
	corsOrigins := []string{"*"}
	if cfg.CORSOrigins != "" {
		corsOrigins = []string{cfg.CORSOrigins}
	}
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   corsOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "X-API-Key"},
		ExposedHeaders:   []string{"X-Request-ID", "X-Response-Time"},
		AllowCredentials: cfg.CORSOrigins != "",
		MaxAge:           300,
	}))

	// Security headers (clickjacking, MIME sniffing, CSP, HSTS, etc.)
	r.Use(SecurityHeadersMiddleware)

	// Request body size limit (1MB) — prevents DoS via large payloads
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req.Body = http.MaxBytesReader(w, req.Body, 1<<20)
			next.ServeHTTP(w, req)
		})
	})

	// Handlers
	vehicleHandler := NewVehicleHandler(db, teslaClient)
	driveHandler := NewDriveHandler(db)
	chargingHandler := NewChargingHandler(db)
	geofenceHandler := NewGeofenceHandler(db)
	authHandler := NewAuthHandler(db, teslaClient, opt.Encryptor)
	settingsHandler := NewSettingsHandler(db)
	alertHandler := NewAlertHandler(db)
	commandHandler := NewCommandHandler(db, teslaClient)
	energyHandler := NewEnergyHandler(db)
	batteryHandler := NewBatteryHandler(db)
	analyticsHandler := NewAnalyticsHandler(db)
	notificationHandler := NewNotificationHandler(db)
	notifScheduleHandler := NewNotificationScheduleHandler(db)
	chatbotHandler := NewChatbotHandler(db)
	tirePressureHandler := NewTirePressureHandler(db)
	motorHandler := NewMotorHandler(db)
	climateHandler := NewClimateHandler(db)
	securityHandler := NewSecurityHandler(db)
	chargingTelemetryHandler := NewChargingTelemetryHandler(db)
	mediaHandler := NewMediaHandler(db)
	vehicleConfigHandler := NewVehicleConfigHandler(db)
	locationSnapshotHandler := NewLocationSnapshotHandler(db)
	safetyHandler := NewSafetyHandler(db)
	userPreferenceHandler := NewUserPreferenceHandler(db)
	softwareUpdateHandler := NewSoftwareUpdateHandler(db)
	vampireDrainHandler := NewVampireDrainHandler(db)
	visitedLocationHandler := NewVisitedLocationHandler(db)
	mileageHandler := NewMileageHandler(db)
	tripHandler := NewTripHandler(db)
	vehicleStateHandler := NewVehicleStateHandler(db)
	backupHandler := NewBackupHandler(db)
	auditHandler := NewAuditHandler(db)
	apiCallLogHandler := NewAPICallLogHandler(db)
	telemetryHandler := opt.TelemetryHandler
	if telemetryHandler == nil {
		telemetryHandler = NewTelemetryHandler(db, mqttClient, eventHub, 5*time.Minute)
	}
	devToolsHandler := NewDevToolsHandler(teslaClient, WithDB(db), WithMQTTClient(mqttClient), WithConfig(cfg))

	// Health check
	r.Get("/healthz", HealthHandler(db))
	r.Get("/readyz", ReadyHandler(db, teslaClient))

	// Metrics
	r.Handle("/metrics", MetricsHandler())

	// API v1 routes
	r.Route("/api/v1", func(r chi.Router) {
		// Auth (stricter rate limits to prevent brute force)
		r.Route("/auth", func(r chi.Router) {
			r.Get("/login", authHandler.Login)
			r.Get("/callback", authHandler.Callback)
			r.Post("/refresh", authHandler.Refresh)
			r.Get("/status", authHandler.Status)
		})

		// Vehicles
		r.Route("/vehicles", func(r chi.Router) {
			r.Get("/", vehicleHandler.List)
			r.Post("/sync", vehicleHandler.SyncFromTesla)
			r.Route("/{vehicleID}", func(r chi.Router) {
				r.Get("/", vehicleHandler.Get)
				r.Delete("/", vehicleHandler.Delete)
				r.Get("/positions", vehicleHandler.Positions)
				r.Get("/state", vehicleHandler.CurrentState)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/wake", vehicleHandler.Wake)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/command", commandHandler.SendCommand)
				r.Get("/energy", energyHandler.Stats)
				r.Get("/battery", batteryHandler.Report)
			})
		})

		// Drives
		r.Route("/drives", func(r chi.Router) {
			r.Get("/", driveHandler.ListByVehicle)
			r.Route("/{driveID}", func(r chi.Router) {
				r.Get("/", driveHandler.Get)
				r.Get("/positions", driveHandler.Positions)
			})
		})

		// Charging
		r.Route("/charging", func(r chi.Router) {
			r.Get("/", chargingHandler.ListByVehicle)
			r.Get("/{sessionID}", chargingHandler.Get)
		})

		// Geofences
		r.Route("/geofences", func(r chi.Router) {
			r.Get("/", geofenceHandler.List)
			r.Post("/", geofenceHandler.Create)
			r.Route("/{geofenceID}", func(r chi.Router) {
				r.Get("/", geofenceHandler.Get)
				r.Put("/", geofenceHandler.Update)
				r.Delete("/", geofenceHandler.Delete)
			})
		})

		// Settings
		r.Get("/settings", settingsHandler.Get)
		r.Put("/settings", settingsHandler.Update)
		r.Post("/settings/suspend-api", settingsHandler.ToggleAPISuspend)

		// Alerts
		r.Route("/alerts", func(r chi.Router) {
			r.Get("/", alertHandler.List)
			r.Post("/{alertID}/read", alertHandler.MarkRead)
			r.Get("/rules", alertHandler.ListRules)
			r.Post("/rules", alertHandler.CreateRule)
			r.Put("/rules/{ruleID}", alertHandler.UpdateRule)
			r.Delete("/rules/{ruleID}", alertHandler.DeleteRule)
		})

		// Analytics
		r.Get("/analytics/fleet", analyticsHandler.Fleet)

		// Notifications
		r.Route("/notifications", func(r chi.Router) {
			r.Get("/", notificationHandler.ListChannels)
			r.Post("/", notificationHandler.CreateChannel)
			r.Get("/logs", notificationHandler.GetLogs)
			r.Get("/stats", notificationHandler.GetStats)
			r.Get("/analytics", notifScheduleHandler.GetAnalytics)
			r.Route("/schedules", func(r chi.Router) {
				r.Get("/", notifScheduleHandler.ListSchedules)
				r.Post("/", notifScheduleHandler.CreateSchedule)
				r.Delete("/{scheduleID}", notifScheduleHandler.DeleteSchedule)
			})
			r.Route("/{channelID}", func(r chi.Router) {
				r.Get("/", notificationHandler.GetChannel)
				r.Put("/", notificationHandler.UpdateChannel)
				r.Delete("/", notificationHandler.DeleteChannel)
				r.Post("/toggle", notificationHandler.ToggleChannel)
				r.Post("/test", notificationHandler.TestChannel)
				r.Get("/preferences", notifScheduleHandler.GetPreferences)
				r.Put("/preferences", notifScheduleHandler.UpdatePreference)
				r.Get("/metrics", notifScheduleHandler.GetChannelMetrics)
			})
		})

		// Chatbot
		r.Route("/chatbot", func(r chi.Router) {
			r.Post("/", chatbotHandler.Chat)
			r.Get("/history", chatbotHandler.History)
			r.Get("/sessions", chatbotHandler.Sessions)
		})

		// Tire Pressure
		r.Route("/tire-pressure", func(r chi.Router) {
			r.Get("/", tirePressureHandler.List)
			r.Get("/latest", tirePressureHandler.Latest)
		})

		// Motor/Powertrain
		r.Route("/motor", func(r chi.Router) {
			r.Get("/", motorHandler.List)
			r.Get("/latest", motorHandler.Latest)
		})

		// Climate/HVAC
		r.Route("/climate", func(r chi.Router) {
			r.Get("/", climateHandler.List)
			r.Get("/latest", climateHandler.Latest)
		})

		// Security/Access
		r.Route("/security", func(r chi.Router) {
			r.Get("/", securityHandler.List)
			r.Get("/latest", securityHandler.Latest)
		})

		// Charging Telemetry
		r.Route("/charging-telemetry", func(r chi.Router) {
			r.Get("/", chargingTelemetryHandler.List)
			r.Get("/latest", chargingTelemetryHandler.Latest)
		})

		// Media
		r.Route("/media", func(r chi.Router) {
			r.Get("/", mediaHandler.List)
			r.Get("/latest", mediaHandler.Latest)
		})

		// Vehicle Config
		r.Route("/vehicle-config", func(r chi.Router) {
			r.Get("/", vehicleConfigHandler.List)
			r.Get("/latest", vehicleConfigHandler.Latest)
		})

		// Location Snapshots
		r.Route("/location-snapshots", func(r chi.Router) {
			r.Get("/", locationSnapshotHandler.List)
			r.Get("/latest", locationSnapshotHandler.Latest)
		})

		// Safety
		r.Route("/safety", func(r chi.Router) {
			r.Get("/", safetyHandler.List)
			r.Get("/latest", safetyHandler.Latest)
		})

		// User Preferences
		r.Route("/user-preferences", func(r chi.Router) {
			r.Get("/", userPreferenceHandler.List)
			r.Get("/latest", userPreferenceHandler.Latest)
		})

		// Software Updates
		r.Get("/software-updates", softwareUpdateHandler.List)

		// Vampire Drain
		r.Route("/vampire-drain", func(r chi.Router) {
			r.Get("/", vampireDrainHandler.List)
			r.Get("/stats", vampireDrainHandler.Stats)
		})

		// Visited Locations
		r.Get("/locations", visitedLocationHandler.List)

		// Mileage
		r.Route("/mileage", func(r chi.Router) {
			r.Get("/daily", mileageHandler.Daily)
			r.Get("/monthly", mileageHandler.Monthly)
			r.Get("/stats", mileageHandler.Stats)
		})

		// Trips
		r.Get("/trips", tripHandler.List)

		// Vehicle States / Timeline
		r.Route("/states", func(r chi.Router) {
			r.Get("/timeline", vehicleStateHandler.Timeline)
			r.Get("/summary", vehicleStateHandler.Summary)
			r.Get("/daily", vehicleStateHandler.DailyBreakdown)
		})

		// Real-time SSE stream
		r.Get("/events", SSEHandler(eventHub))

		// System endpoints
		r.Route("/system", func(r chi.Router) {
			r.Get("/status", SystemStatusHandler(db, teslaClient, mqttClient, health, cfg))
			r.Get("/health", ExtendedHealthCheck(db, health))
			r.Get("/api-usage", APIUsageHandler(db))
			r.Get("/compression-stats", CompressionStatsHandler(db))
			r.Get("/backup", backupHandler.ExportData)
			r.Get("/backup/stats", backupHandler.BackupStats)
			r.Get("/config-validation", ConfigValidation(cfg))
			r.Get("/audit", auditHandler.List)

			// Version & update endpoints
			ver := opt.AppVersion
			if ver == "" {
				ver = "dev"
			}
			r.Get("/version", VersionHandler(ver, cfg))
			r.Get("/update-check", UpdateCheckHandler())
			r.Get("/workers", WorkersHealthHandler())
		})

		// API Call Logs
		r.Route("/api-logs", func(r chi.Router) {
			r.Get("/", apiCallLogHandler.List)
			r.Get("/stats", apiCallLogHandler.Stats)
		})

		// Fleet Telemetry ingestion
		r.Route("/telemetry", func(r chi.Router) {
			r.Post("/", telemetryHandler.TelemetryIngest)
			r.Get("/", telemetryHandler.TelemetryStatus)
		})

		// Developer Tools
		r.Route("/dev-tools", func(r chi.Router) {
			r.Get("/fleet-api-info", devToolsHandler.FleetAPIInfo)
			r.Get("/detect-region", devToolsHandler.DetectRegion)
			r.Post("/register-partner", devToolsHandler.RegisterPartner)
			r.Get("/test-api", devToolsHandler.TestAPIConnectivity)
			r.Get("/token-info", devToolsHandler.TokenInfo)
			r.Get("/db-stats", devToolsHandler.DatabaseStats)
			r.Get("/migration-status", devToolsHandler.MigrationStatus)
			r.Post("/mqtt-test", devToolsHandler.MQTTTest)
			r.Get("/env-check", devToolsHandler.EnvCheck)
			r.Get("/runtime-info", devToolsHandler.RuntimeInfo)
			r.Post("/generate-keypair", devToolsHandler.GenerateKeypair)
			r.Post("/upload-public-key", devToolsHandler.UploadPublicKey)
			r.Get("/public-key-status", devToolsHandler.PublicKeyStatus)
			r.Delete("/public-key", devToolsHandler.DeletePublicKey)
			r.Post("/pair-vehicle-key", devToolsHandler.PairVehicleKey)

			// Fleet Telemetry
			r.Post("/fleet-telemetry-subscribe", devToolsHandler.FleetTelemetrySubscribe)
			r.Get("/fleet-telemetry-config", devToolsHandler.FleetTelemetryGetConfig)
			r.Delete("/fleet-telemetry-config", devToolsHandler.FleetTelemetryDeleteConfig)
			r.Get("/fleet-telemetry-errors", devToolsHandler.FleetTelemetryErrors)
			r.Post("/fleet-status", devToolsHandler.FleetStatus)
		})

		// Export
		r.Get("/export/{type}", NewExportHandler(db))

		// Export Jobs (async, MQTT-backed)
		var pahoClient pahomqtt.Client
		if mqttClient != nil {
			pahoClient = mqttClient.Underlying()
		}
		exportJobHandler := NewExportJobHandler(db, pahoClient)
		r.Route("/export/jobs", func(r chi.Router) {
			r.Post("/", exportJobHandler.SubmitJob)
			r.Post("/import", exportJobHandler.SubmitImportJob)
			r.Get("/", exportJobHandler.ListJobs)
			r.Get("/{jobID}", exportJobHandler.GetJob)
			r.Get("/{jobID}/download", exportJobHandler.DownloadJob)
		})
	})

	// Tesla public key (.well-known path required by Tesla Fleet API)
	r.Get("/.well-known/appspecific/com.tesla.3p.public-key.pem", devToolsHandler.ServePublicKey)

	// Serve frontend static files (SPA)
	// Static assets found on disk are served directly; all other GET
	// requests fall back to index.html for client-side routing.
	// Try /web/dist (Docker) then ./web/dist (local dev).
	staticDir := "/web/dist"
	if _, err := os.Stat(staticDir); err != nil {
		staticDir = "./web/dist"
	}
	fs := http.FileServer(http.Dir(staticDir))
	r.NotFound(spaFallback(staticDir, fs))

	// Subscribe to export status events from the export worker and relay via SSE
	if mqttClient != nil {
		mqttClient.Underlying().Subscribe("teslasync/events/export.status", 1, func(_ pahomqtt.Client, msg pahomqtt.Message) {
			var evt map[string]interface{}
			if err := json.Unmarshal(msg.Payload(), &evt); err != nil {
				return
			}
			eventHub.Broadcast("export_status", evt)
		})
	}

	return r
}

// spaFallback returns an http.Handler that serves static files from dir
// and falls back to index.html for paths that don't match a file on disk.
// This enables client-side routing so that direct navigation or page
// reload on paths like /api-logs works correctly.
func spaFallback(dir string, fs http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Only serve SPA fallback for GET requests
		if r.Method != http.MethodGet {
			http.Error(w, "Not Found", http.StatusNotFound)
			return
		}

		// Don't intercept API paths — let them 404 naturally
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.Error(w, "Not Found", http.StatusNotFound)
			return
		}

		// If the file exists on disk, serve it directly
		path := filepath.Join(dir, filepath.Clean(r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}

		// SPA fallback — serve index.html for client-side routing
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	}
}
