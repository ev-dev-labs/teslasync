package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/teslasync/teslasync/internal/config"
	"github.com/teslasync/teslasync/internal/database"
	"github.com/teslasync/teslasync/internal/mqtt"
	"github.com/teslasync/teslasync/internal/resilience"
	"github.com/teslasync/teslasync/internal/tesla"
)

// NewRouter creates and configures the main HTTP router with all API routes,
// middleware (logging, recovery, CORS, rate limiting, security headers), and
// a static file server for the SPA frontend. It wires up handler dependencies
// and returns the ready-to-serve http.Handler.
func NewRouter(db *database.DB, teslaClient *tesla.Client, mqttClient *mqtt.Client, cfg *config.Config, health *resilience.HealthMonitor) http.Handler {
	r := chi.NewRouter()

	// SSE event hub for real-time updates
	eventHub := NewEventHub()

	// Global middleware
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(LoggerMiddleware)
	r.Use(RecoveryMiddleware) // Enhanced recovery that logs panics as structured errors
	r.Use(chimw.Compress(5))
	r.Use(chimw.Timeout(30 * time.Second))

	// CORS
	// NOTE: AllowedOrigins is set to "*" for development convenience.
	// For production deployments, replace with explicit origins, e.g.:
	//   AllowedOrigins: []string{"https://your-domain.com"},
	// Also note: AllowCredentials with a wildcard origin is technically
	// non-compliant per the Fetch spec — browsers will reject credentialed
	// requests unless a specific origin is returned. Configure properly
	// for production via an environment variable or config field.
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		ExposedHeaders:   []string{"X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Security headers (clickjacking, MIME sniffing, CSP, HSTS, etc.)
	r.Use(SecurityHeadersMiddleware)

	// Rate limiting
	r.Use(httprate.LimitByIP(100, 1*time.Minute))

	// Handlers
	vehicleHandler := NewVehicleHandler(db, teslaClient)
	driveHandler := NewDriveHandler(db)
	chargingHandler := NewChargingHandler(db)
	geofenceHandler := NewGeofenceHandler(db)
	authHandler := NewAuthHandler(db, teslaClient)
	settingsHandler := NewSettingsHandler(db)
	alertHandler := NewAlertHandler(db)
	commandHandler := NewCommandHandler(db, teslaClient)
	energyHandler := NewEnergyHandler(db)
	batteryHandler := NewBatteryHandler(db)
	analyticsHandler := NewAnalyticsHandler(db)
	notificationHandler := NewNotificationHandler(db)
	chatbotHandler := NewChatbotHandler(db)
	tirePressureHandler := NewTirePressureHandler(db)
	softwareUpdateHandler := NewSoftwareUpdateHandler(db)
	vampireDrainHandler := NewVampireDrainHandler(db)
	visitedLocationHandler := NewVisitedLocationHandler(db)
	mileageHandler := NewMileageHandler(db)
	tripHandler := NewTripHandler(db)
	vehicleStateHandler := NewVehicleStateHandler(db)
	importHandler := NewImportHandler(db)

	// Health check
	r.Get("/healthz", HealthHandler(db))
	r.Get("/readyz", ReadyHandler(db, teslaClient))
	r.Get("/api/v1/system/status", SystemStatusHandler(db, teslaClient, mqttClient, health))

	// Metrics
	r.Handle("/metrics", MetricsHandler())

	// API v1 routes
	r.Route("/api/v1", func(r chi.Router) {
		// Auth
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
				r.Post("/wake", vehicleHandler.Wake)
				r.Post("/command", commandHandler.SendCommand)
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
			r.Put("/rules/{ruleID}", alertHandler.UpdateRule)
		})

		// Analytics
		r.Get("/analytics/fleet", analyticsHandler.Fleet)

		// Notifications
		r.Route("/notifications", func(r chi.Router) {
			r.Get("/", notificationHandler.ListChannels)
			r.Post("/", notificationHandler.CreateChannel)
			r.Get("/logs", notificationHandler.GetLogs)
			r.Get("/stats", notificationHandler.GetStats)
			r.Route("/{channelID}", func(r chi.Router) {
				r.Get("/", notificationHandler.GetChannel)
				r.Put("/", notificationHandler.UpdateChannel)
				r.Delete("/", notificationHandler.DeleteChannel)
				r.Post("/toggle", notificationHandler.ToggleChannel)
				r.Post("/test", notificationHandler.TestChannel)
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

		// Export
		r.Get("/export/{type}", NewExportHandler(db))

		// Import
		r.Post("/import/drives", importHandler.ImportDrives)
		r.Post("/import/charging", importHandler.ImportCharging)

		// Export Notification Logs
		r.Get("/export/notifications", ExportNotificationLogs(db))

		// System
		r.Get("/system/database", DatabaseSize(db))
		r.Get("/system/info", SystemInfo)
	})

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
