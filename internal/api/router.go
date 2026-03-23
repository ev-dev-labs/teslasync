package api

import (
	"net/http"
	"time"

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
	AppVersion string
	Encryptor  *crypto.Encryptor
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
	r.Use(chimw.Timeout(30 * time.Second))

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

	// Rate limiting
	r.Use(httprate.LimitByIP(100, 1*time.Minute))

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
	softwareUpdateHandler := NewSoftwareUpdateHandler(db)
	vampireDrainHandler := NewVampireDrainHandler(db)
	visitedLocationHandler := NewVisitedLocationHandler(db)
	mileageHandler := NewMileageHandler(db)
	tripHandler := NewTripHandler(db)
	vehicleStateHandler := NewVehicleStateHandler(db)
	backupHandler := NewBackupHandler(db)
	auditHandler := NewAuditHandler(db)
	apiCallLogHandler := NewAPICallLogHandler(db)
	telemetryHandler := NewTelemetryHandler(db, mqttClient)
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
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Get("/login", authHandler.Login)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Get("/callback", authHandler.Callback)
			r.With(httprate.LimitByIP(10, 1*time.Minute)).Post("/refresh", authHandler.Refresh)
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
			r.Get("/{driveID}", driveHandler.Get)
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
			r.Get("/api-usage", APIUsageHandler())
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
			r.Get("/version", VersionHandler(ver))
			r.Get("/update-check", UpdateCheckHandler())
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
		})

		// Export
		r.With(httprate.LimitByIP(10, 1*time.Minute)).Get("/export/{type}", NewExportHandler(db))
	})

	// Tesla public key (.well-known path required by Tesla Fleet API)
	r.Get("/.well-known/appspecific/com.tesla.3p.public-key.pem", devToolsHandler.ServePublicKey)

	// Serve frontend static files (SPA)
	fileServer(r, "/", http.Dir("./web/dist"))

	return r
}

// fileServer serves static files from the given directory.
func fileServer(r chi.Router, path string, root http.FileSystem) {
	fs := http.StripPrefix(path, http.FileServer(root))
	r.Get(path+"*", func(w http.ResponseWriter, r *http.Request) {
		if _, err := root.Open(r.URL.Path); err != nil {
			// Serve index.html for SPA routing
			http.ServeFile(w, r, "./web/dist/index.html")
			return
		}
		fs.ServeHTTP(w, r)
	})
}
