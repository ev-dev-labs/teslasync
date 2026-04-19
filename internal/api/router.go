package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/polling"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	"github.com/ev-dev-labs/teslasync/internal/service"
	signal "github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/ev-dev-labs/teslasync/internal/worker"

	// New hexagonal architecture packages
	pgadapter "github.com/ev-dev-labs/teslasync/internal/adapter/postgres"
	"github.com/ev-dev-labs/teslasync/internal/app/chargingsvc"
	"github.com/ev-dev-labs/teslasync/internal/app/dashboardsvc"
	"github.com/ev-dev-labs/teslasync/internal/app/exportsvc"
	"github.com/ev-dev-labs/teslasync/internal/app/vehiclesvc"
	v1handlers "github.com/ev-dev-labs/teslasync/internal/handler/v1"
)

// RouterOptions holds optional parameters for NewRouter.
type RouterOptions struct {
	AppVersion       string
	Encryptor        *crypto.Encryptor
	TelemetryHandler *TelemetryHandler       // If set, reuses existing handler (for hybrid mode wiring)
	GasPriceWorker   *worker.GasPriceWorker  // If set, enables gas price management endpoints
	PollEngine       *polling.PollEngine      // If set, enables polling engine dashboard endpoints
	SignalStore      *signal.Store            // If set, enables /internal/flush endpoint
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

	// Error tracker for centralized error aggregation
	errorTracker := NewErrorTracker(200)
	globalErrorTracker = errorTracker

	// Global middleware
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(TracingMiddleware)
	r.Use(LoggerMiddleware)
	r.Use(RecoveryMiddleware) // Enhanced recovery that logs panics as structured errors
	r.Use(ErrorTrackingMiddleware(errorTracker)) // Centralized error aggregation
	r.Use(PrometheusMiddleware) // HTTP request metrics (duration, count, size)
	r.Use(chimw.Compress(5))

	// CORS ╬ô├ç├╢ use explicit origins in production. The wildcard is kept for
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
		// AllowCredentials is only enabled when explicit origins are set.
		// With wildcard ("*"), credentials are disabled per the Fetch spec,
		// preventing cookie/auth header leakage to arbitrary origins.
		AllowCredentials: cfg.CORSOrigins != "",
		MaxAge:           300,
	}))

	// Security headers (clickjacking, MIME sniffing, CSP, HSTS, etc.)
	r.Use(SecurityHeadersMiddleware)

	// Request body size limit (1MB) ╬ô├ç├╢ prevents DoS via large payloads
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req.Body = http.MaxBytesReader(w, req.Body, 1<<20)
			next.ServeHTTP(w, req)
		})
	})

	// Services
	vehicleSvc := service.NewVehicleService(db)
	energySvc := service.NewEnergyService(db)

	// Handlers
	vehicleHandler := NewVehicleHandler(vehicleSvc, teslaClient)
	driveHandler := NewDriveHandler(db)
	chargingHandler := NewChargingHandler(db)
	geofenceHandler := NewGeofenceHandler(db)
	authHandler := NewAuthHandler(db, teslaClient, opt.Encryptor)
	settingsHandler := NewSettingsHandler(db)
	var pahoForAlerts pahomqtt.Client
	if mqttClient != nil { pahoForAlerts = mqttClient.Underlying() }
	var alertSignalStore *signal.Store
	if opt.TelemetryHandler != nil {
		alertSignalStore = opt.TelemetryHandler.GetSignalStore()
	}
	alertHandler := NewAlertHandler(db, eventHub, pahoForAlerts, alertSignalStore)
	commandHandler := NewCommandHandler(db, teslaClient)
	energyHandler := NewEnergyHandler(energySvc)
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
	locationSnapshotHandler.SetSignalStore(alertSignalStore)
	safetyHandler := NewSafetyHandler(db)
	userPreferenceHandler := NewUserPreferenceHandler(db)
	softwareUpdateHandler := NewSoftwareUpdateHandler(db)
	tcoHandler := NewTCOHandler(db)
	sleepHandler := NewSleepHandler(db)
	vampireDrainHandler := NewVampireDrainHandler(db)
	visitedLocationHandler := NewVisitedLocationHandler(db)
	mileageHandler := NewMileageHandler(db)
	tripHandler := NewTripHandler(db)
	vehicleStateHandler := NewVehicleStateHandler(db)
	backupHandler := NewBackupHandler(db)
	backupRestoreHandler := NewBackupRestoreHandler(db)
	regenHandler := NewRegenHandler(db)
	batteryDegradationHandler := NewBatteryDegradationHandler(db)
	auditHandler := NewAuditHandler(db)
	apiCallLogHandler := NewAPICallLogHandler(db)
	apiKeyHandler := NewAPIKeyHandler(db)
	chargingHeatmapHandler := NewChargingHeatmapHandler(db)
	speedProfileHandler := NewSpeedProfileHandler(db)
	dataRepairHandler := NewDataRepairHandler(db)
	tempImpactHandler := NewTempImpactHandler(db)
	routeEfficiencyHandler := NewRouteEfficiencyHandler(db)
	batteryCellsHandler := NewBatteryCellsHandler(db)
	rangeProjectionHandler := NewRangeProjectionHandler(db)
	drivetrainHealthHandler := NewDrivetrainHealthHandler(db)
	maintenanceHandler := NewMaintenanceHandler(db)
	periodStatsHandler := NewPeriodStatsHandler(db)
	drivingCoachHandler := NewDrivingCoachHandler(db)
	costForecastHandler := NewCostForecastHandler(db)
	chargingOptimizerHandler := NewChargingOptimizerHandler(db)
	anomalyHandler := NewAnomalyHandler(db)
	energyFlowHandler := NewEnergyFlowHandler(db)
	weeklyDigestHandler := NewWeeklyDigestHandler(db)
	automationHandler := NewAutomationHandler(db)
	telemetryHandler := opt.TelemetryHandler
	if telemetryHandler == nil {
		telemetryHandler = NewTelemetryHandler(db, mqttClient, eventHub, 5*time.Minute, geocoding.NewGeocoder(cfg.GoogleMaps.APIKey, cfg.AzureMaps.APIKey))
	} else {
		// Reusing handler from main ╬ô├ç├╢ wire the eventHub created by the router
		telemetryHandler.SetEventHub(eventHub)
	}
	devToolsHandler := NewDevToolsHandler(teslaClient, WithDB(db), WithMQTTClient(mqttClient), WithConfig(cfg))

	// Wire telemetry handler into vehicle handler for streaming-aware state
	vehicleHandler.SetTelemetryHandler(telemetryHandler)

	// Wire telemetry handler into settings handler for capture toggle sync
	settingsHandler.SetTelemetryHandler(telemetryHandler)

	// Health check
	r.Get("/healthz", HealthHandler(db))
	r.Get("/readyz", ReadyHandler(db, teslaClient))

	// Internal: PreStop flush endpoint for Kubernetes lifecycle hooks
	r.Post("/internal/flush", func(w http.ResponseWriter, req *http.Request) {
		if opt.SignalStore != nil {
			flushCtx, cancel := context.WithTimeout(req.Context(), 10*time.Second)
			defer cancel()
			opt.SignalStore.FlushAll(flushCtx)
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "flushed"})
	})

	// Metrics
	r.Handle("/metrics", MetricsHandler())

	// API v1 routes
	r.Route("/api/v1", func(r chi.Router) {
		// Auth (stricter rate limits to prevent brute force)
		r.Route("/auth", func(r chi.Router) {
			r.Use(httprate.LimitByIP(10, 1*time.Minute))
			r.Get("/login", authHandler.Login)
			r.Post("/url", authHandler.Login)
			r.Get("/callback", authHandler.Callback)
			r.Post("/refresh", authHandler.Refresh)
			r.Get("/status", authHandler.Status)
			r.Post("/disconnect", authHandler.Disconnect)
		})

		// Vehicles
		r.Route("/vehicles", func(r chi.Router) {
			r.Get("/", vehicleHandler.List)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/sync", vehicleHandler.SyncFromTesla)
			r.Route("/{vehicleID}", func(r chi.Router) {
				r.Get("/", vehicleHandler.Get)
				r.Delete("/", vehicleHandler.Delete)
				r.Get("/positions", vehicleHandler.Positions)
				r.Get("/state", vehicleHandler.CurrentState)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/wake", vehicleHandler.Wake)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/command", commandHandler.SendCommand)
				r.Get("/commands/latest", commandHandler.LatestCommands)
				r.Get("/commands/history", commandHandler.CommandHistory)
				r.Get("/energy", energyHandler.Stats)
				r.Get("/energy/flow", energyFlowHandler.Get)
				r.Get("/battery", batteryHandler.Report)
				r.Get("/battery/cells", batteryCellsHandler.GetByVehicle)
				r.Get("/battery/projected-range", rangeProjectionHandler.GetByVehicle)
				r.Get("/weekly-digest", weeklyDigestHandler.Get)
			})
		})

		// Drives
		r.Route("/drives", func(r chi.Router) {
			r.Get("/", driveHandler.ListByVehicle)
			r.Get("/stats", driveHandler.Stats)
			r.Get("/score", driveHandler.Score)
			r.Get("/dynamics", driveHandler.Dynamics)
			r.Get("/acceleration-distribution", driveHandler.AccelerationDistribution)
			r.Route("/{driveID}", func(r chi.Router) {
				r.Get("/", driveHandler.Get)
				r.Get("/positions", driveHandler.Positions)
				r.Get("/telemetry", driveHandler.TelemetryReadings)
			})
		})

		// Drivetrain Health
		r.Get("/drivetrain/health", drivetrainHealthHandler.Get)

		// Maintenance
		r.Route("/maintenance", func(r chi.Router) {
			r.Get("/", maintenanceHandler.List)
			r.Get("/records", maintenanceHandler.Records)
		})

		// Charging
		r.Route("/charging", func(r chi.Router) {
			r.Get("/", chargingHandler.ListByVehicle)
			r.Route("/{sessionID}", func(r chi.Router) {
				r.Get("/", chargingHandler.Get)
				r.Get("/telemetry", chargingHandler.TelemetryReadings)
			})
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
		r.Group(func(r chi.Router) {
			r.Use(httprate.LimitByIP(20, 1*time.Minute))
			r.Get("/settings", settingsHandler.Get)
			r.Put("/settings", settingsHandler.Update)
			r.Post("/settings/suspend-api", settingsHandler.ToggleAPISuspend)
			r.Get("/settings/polling-config", settingsHandler.GetPollingConfig)
			r.Put("/settings/polling-config", settingsHandler.UpdatePollingConfig)
		})

		// Gas Price Auto-Poll
		if opt.GasPriceWorker != nil {
			gasPriceHandler := NewGasPriceHandler(db, opt.GasPriceWorker)
			r.Route("/gas-price", func(r chi.Router) {
				r.Get("/status", gasPriceHandler.Status)
				r.Post("/poll", gasPriceHandler.Poll)
				r.Post("/toggle", gasPriceHandler.Toggle)
				r.Put("/config", gasPriceHandler.UpdateConfig)
				r.Get("/history", gasPriceHandler.History)
			})
		}

		// Alerts
		r.Route("/alerts", func(r chi.Router) {
			r.Get("/", alertHandler.List)
			r.Post("/{alertID}/read", alertHandler.MarkRead)
			r.Get("/rules", alertHandler.ListRules)
			r.Post("/rules", alertHandler.CreateRule)
			r.Put("/rules/{ruleID}", alertHandler.UpdateRule)
			r.Delete("/rules/{ruleID}", alertHandler.DeleteRule)
			r.Post("/test", alertHandler.TestRule)
		})

		// Automations
		r.Route("/automations", func(r chi.Router) {
			r.Get("/", automationHandler.List)
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/", automationHandler.Create)

			// Execution history (static routes before {id} param)
			r.Route("/history", func(r chi.Router) {
				r.Get("/", automationHandler.ListHistory)
				r.Get("/{historyId}", automationHandler.GetHistoryDetail)
			})

			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", automationHandler.Get)
				r.Get("/history", automationHandler.ListAutomationHistory)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Put("/", automationHandler.Update)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Delete("/", automationHandler.Delete)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Patch("/toggle", automationHandler.Toggle)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Patch("/re-enable", automationHandler.ReEnable)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/test-run", automationHandler.TestRun)
			})
		})

		// Analytics
		r.Get("/analytics/fleet", analyticsHandler.Fleet)
		r.Get("/analytics/tco", tcoHandler.GetTCO)
		r.Get("/analytics/sleep", sleepHandler.GetSleepAnalytics)
		r.Get("/analytics/regen", regenHandler.Stats)
		r.Get("/analytics/battery-degradation", batteryDegradationHandler.Predict)
		r.Get("/analytics/battery-health", batteryDegradationHandler.Health)
		r.Get("/analytics/charging-heatmap", chargingHeatmapHandler.Get)
		r.Get("/analytics/speed-profile", speedProfileHandler.Get)
		r.Get("/analytics/temperature-impact", tempImpactHandler.Get)
		r.Get("/analytics/route-efficiency", routeEfficiencyHandler.List)
		r.Get("/analytics/route-efficiency/detail", routeEfficiencyHandler.Detail)
		r.Get("/analytics/battery-cells", batteryCellsHandler.Get)
		r.Get("/analytics/energy", energyHandler.AnalyticsStats)
		r.Get("/analytics/range-projection", rangeProjectionHandler.Get)
		r.Get("/analytics/period-stats", periodStatsHandler.Get)
		r.Get("/analytics/driving-coach", drivingCoachHandler.GetCoaching)
		r.Get("/analytics/cost-forecast", costForecastHandler.GetForecast)
		r.Get("/analytics/charging-optimizer", chargingOptimizerHandler.GetOptimization)
		r.Get("/analytics/anomalies", anomalyHandler.GetAnomalies)

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
		r.Route("/vehicle-states", func(r chi.Router) {
			r.Get("/timeline", vehicleStateHandler.Timeline)
			r.Get("/summary", vehicleStateHandler.Summary)
			r.Get("/daily", vehicleStateHandler.DailyBreakdown)
		})

		// FSM shadow mode stats + transition log
		r.Route("/fsm", func(r chi.Router) {
			r.Get("/stats", func(w http.ResponseWriter, req *http.Request) {
				fh := telemetryHandler.FSMHandler()
				if fh == nil {
					writeJSON(w, http.StatusOK, map[string]interface{}{"enabled": false})
					return
				}
				stats := fh.Stats()
				result := map[string]interface{}{
					"enabled": true,
					"stats":   stats,
				}
				// If vehicle_id provided, include active sub-FSM state
				if vidStr := req.URL.Query().Get("vehicle_id"); vidStr != "" {
					if vid, err := strconv.ParseInt(vidStr, 10, 64); err == nil && vid > 0 {
						var activeSubs []map[string]interface{}
						if driveState, dc := fh.ActiveDriveState(vid); dc != nil {
							activeSubs = append(activeSubs, map[string]interface{}{
								"type":       "drive",
								"state":      driveState,
								"start_time": dc.StartTime,
								"drive_id":   dc.DriveID,
							})
						}
						if chargeState, cc := fh.ActiveChargeState(vid); cc != nil {
							activeSubs = append(activeSubs, map[string]interface{}{
								"type":       "charge",
								"state":      chargeState,
								"start_time": cc.StartTime,
								"session_id": cc.SessionID,
							})
						}
						result["active_subs"] = activeSubs
					}
				}
				writeJSON(w, http.StatusOK, result)
			})
			r.Get("/transitions", func(w http.ResponseWriter, req *http.Request) {
				fsmTransRepo := database.NewFSMTransitionRepo(db)
				vehicleID, _ := strconv.ParseInt(req.URL.Query().Get("vehicle_id"), 10, 64)
				if vehicleID == 0 {
					writeError(w, http.StatusBadRequest, "vehicle_id required")
					return
				}
				fsmType := req.URL.Query().Get("fsm_type")
				hours := 1
				if h := req.URL.Query().Get("hours"); h != "" {
					if v, err := strconv.Atoi(h); err == nil && v >= 0 {
						hours = v
					}
				}
				var from time.Time
				if hours == 0 {
					from = time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
				} else {
					from = time.Now().UTC().Add(-time.Duration(hours) * time.Hour)
				}
				to := time.Now().UTC()
				page := 1
				if p := req.URL.Query().Get("page"); p != "" {
					if v, err := strconv.Atoi(p); err == nil && v > 0 {
						page = v
					}
				}
				perPage := 50
				if pp := req.URL.Query().Get("per_page"); pp != "" {
					if v, err := strconv.Atoi(pp); err == nil && v > 0 {
						perPage = v
					}
				}
				records, total, err := fsmTransRepo.Query(req.Context(), vehicleID, fsmType, nil, from, to, perPage, (page-1)*perPage)
				if err != nil {
					writeError(w, http.StatusInternalServerError, "query failed")
					return
				}
				writeJSON(w, http.StatusOK, map[string]interface{}{
					"data":  records,
					"total": total,
					"page":  page,
					"per_page": perPage,
				})
			})
		})

		// Real-time SSE stream
		if cfg.Auth.AuthentikURL != "" || cfg.Auth.AuthentikHMACKey != "" {
			if cfg.Auth.AuthentikURL == "" || cfg.Auth.AuthentikHMACKey == "" {
				log.Warn().
					Bool("has_url", cfg.Auth.AuthentikURL != "").
					Bool("has_hmac", cfg.Auth.AuthentikHMACKey != "").
					Msg("partial authentik config: set both AUTHENTIK_URL and AUTHENTIK_HMAC_KEY for full JWT validation; SSE will fall back to ForwardAuth headers")
			}
			// SSE with authentik JWT validation + ForwardAuth header fallback
			r.With(AuthentikSSEAuth(cfg.Auth.AuthentikURL, cfg.Auth.AuthentikHMACKey)).Get("/events", SSEHandler(eventHub))
			// Token endpoint (behind ForwardAuth ╬ô├ç├╢ returns JWT to frontend)
			r.Get("/sse-token", SSETokenHandler())
		} else {
			// No auth on SSE (development)
			r.Get("/events", SSEHandler(eventHub))
			// Return empty token in dev mode so frontend doesn't get 404
			r.Get("/sse-token", func(w http.ResponseWriter, r *http.Request) {
				writeJSON(w, http.StatusOK, map[string]string{"token": ""})
			})
		}

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
			r.Get("/errors/stats", ErrorStatsHandler(errorTracker))
			r.Get("/errors/catalog", ErrorCatalogHandler())
			r.Get("/map-config", MapConfigHandler(cfg))

			// Version & update endpoints
			ver := opt.AppVersion
			if ver == "" {
				ver = "dev"
			}
			r.Get("/version", VersionHandler(ver, cfg))
			r.Get("/update-check", UpdateCheckHandler())
			r.Get("/workers", WorkersHealthHandler())
			r.Get("/metrics-catalog", MetricsCatalogHandler())
		})

		// API Call Logs
		r.Route("/api-logs", func(r chi.Router) {
			r.Get("/", apiCallLogHandler.List)
			r.Get("/stats", apiCallLogHandler.Stats)
		})

		// Adaptive Polling Engine
		if opt.PollEngine != nil {
			handlers := PollEngineHandlers(opt.PollEngine)
			r.Route("/polling", func(r chi.Router) {
				r.Get("/status", handlers["status"])
				r.Get("/decisions", handlers["decisions"])
				r.Get("/predictions", handlers["predictions"])
				r.Get("/savings", handlers["savings"])
				r.Get("/config", handlers["config"])
				r.Post("/demo", handlers["demo"])
			})
		}

		// API Keys
		r.Route("/api-keys", func(r chi.Router) {
			r.Get("/", apiKeyHandler.List)
			r.Post("/", apiKeyHandler.Create)
			r.Route("/{id}", func(r chi.Router) {
				r.Delete("/", apiKeyHandler.Delete)
				r.Post("/revoke", apiKeyHandler.Revoke)
			})
		})

		// Fleet Telemetry ingestion
		r.Route("/telemetry", func(r chi.Router) {
			r.Post("/", telemetryHandler.TelemetryIngest)
			r.Get("/", telemetryHandler.TelemetryStatus)
		})

		// Developer Tools
		r.Route("/dev-tools", func(r chi.Router) {
			r.Use(httprate.LimitByIP(30, 1*time.Minute))
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
			r.Get("/nearby-charging", devToolsHandler.NearbyChargingSites)
			r.Get("/release-notes", devToolsHandler.ReleaseNotes)
			r.Get("/recent-alerts", devToolsHandler.RecentAlerts)
			r.Get("/service-data", devToolsHandler.ServiceData)

			// Raw telemetry signal capture
			r.Route("/telemetry-capture", func(r chi.Router) {
				r.Get("/", telemetryHandler.CaptureList)
				r.Get("/stats", telemetryHandler.CaptureStats)
				r.Delete("/", telemetryHandler.CaptureDrop)
				r.Get("/export", telemetryHandler.CaptureExport)
			})
		})

		// Signal History (Postgres-backed — always available)
		if telemetryHandler != nil && telemetryHandler.signalHistoryWriter != nil {
			shw := telemetryHandler.signalHistoryWriter
			r.Route("/signals/history", func(r chi.Router) {
				// GET /api/v1/signals/history?vehicle_id=1&signals=BatteryLevel,Gear&from=...&to=...&page=1&per_page=50
				r.Get("/", func(w http.ResponseWriter, req *http.Request) {
					vid, _ := strconv.ParseInt(req.URL.Query().Get("vehicle_id"), 10, 64)
					if vid == 0 { vid = 1 }
					signalNames := strings.Split(req.URL.Query().Get("signals"), ",")
					if len(signalNames) == 0 || signalNames[0] == "" {
						writeError(w, http.StatusBadRequest, "signals parameter required")
						return
					}
					from, _ := time.Parse(time.RFC3339, req.URL.Query().Get("from"))
					to, _ := time.Parse(time.RFC3339, req.URL.Query().Get("to"))
					if from.IsZero() { from = time.Now().UTC().Add(-1 * time.Hour) }
					if to.IsZero() { to = time.Now().UTC() }
					page, _ := strconv.Atoi(req.URL.Query().Get("page"))
					perPage, _ := strconv.Atoi(req.URL.Query().Get("per_page"))
					entries, total, err := shw.Query(req.Context(), vid, signalNames, from, to, page, perPage)
					if err != nil {
						writeError(w, http.StatusInternalServerError, "query failed")
						return
					}
					totalPages := (total + int64(perPage) - 1) / int64(perPage)
					if perPage == 0 { totalPages = 0 }
					writeJSON(w, http.StatusOK, map[string]interface{}{
						"data": entries,
						"pagination": map[string]interface{}{
							"page": page, "per_page": perPage, "total": total, "total_pages": totalPages,
						},
					})
				})
			})
			r.Get("/signals/available", func(w http.ResponseWriter, req *http.Request) {
				vid, _ := strconv.ParseInt(req.URL.Query().Get("vehicle_id"), 10, 64)
				if vid == 0 { vid = 1 }
				signals, err := shw.AvailableSignals(req.Context(), vid)
				if err != nil {
					writeError(w, http.StatusInternalServerError, "query failed")
					return
				}
				writeJSON(w, http.StatusOK, signals)
			})
			r.Get("/signals/stats", func(w http.ResponseWriter, req *http.Request) {
				vid, _ := strconv.ParseInt(req.URL.Query().Get("vehicle_id"), 10, 64)
				if vid == 0 { vid = 1 }
				signalNames := strings.Split(req.URL.Query().Get("signals"), ",")
				from, _ := time.Parse(time.RFC3339, req.URL.Query().Get("from"))
				to, _ := time.Parse(time.RFC3339, req.URL.Query().Get("to"))
				if from.IsZero() { from = time.Now().UTC().Add(-1 * time.Hour) }
				if to.IsZero() { to = time.Now().UTC() }
				stats, err := shw.Stats(req.Context(), vid, signalNames, from, to)
				if err != nil {
					writeError(w, http.StatusInternalServerError, "query failed")
					return
				}
				writeJSON(w, http.StatusOK, stats)
			})
		}

		// Signal routes
		r.Route("/signals/{vehicleID}", func(r chi.Router) {
			// Live state from in-memory SignalStore (always available)
			if telemetryHandler != nil {
				r.Get("/live", func(w http.ResponseWriter, r *http.Request) {
					store := telemetryHandler.GetSignalStore()
					if store == nil {
						writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "signal store not initialized"})
						return
					}
					vid, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
					if err != nil {
						writeError(w, http.StatusBadRequest, "invalid vehicle ID")
						return
					}
					raw := store.GetAll(vid)
					// Convert to JSON-friendly format with timestamps
					signals := make(map[string]interface{}, len(raw))
					for k, v := range raw {
						if v != nil {
							signals[k] = map[string]interface{}{
								"value":     v.Raw,
								"timestamp": v.Timestamp,
							}
						}
					}
					writeJSON(w, http.StatusOK, map[string]interface{}{
						"vehicle_id": vid,
						"count":      len(signals),
						"signals":    signals,
					})
				})
			}

			// Signal History (Postgres primary, MongoDB optional fallback)
			if telemetryHandler != nil {
				var mongoRepo *database.SignalLogRepo
				if telemetryHandler.signalLogRepo != nil {
					mongoRepo = telemetryHandler.signalLogRepo
				}
				signalHandler := NewSignalHandler(mongoRepo)
				if db != nil {
					signalHandler.WithDB(db)
				}
				if telemetryHandler.signalHistoryWriter != nil {
					signalHandler.WithSignalHistory(telemetryHandler.signalHistoryWriter)
				}
				r.Get("/available", signalHandler.AvailableSignals)
				r.Get("/stats", signalHandler.Stats)
				r.Get("/{signalName}/history", signalHandler.History)
			} else {
				// No telemetry handler at all — register with DB-only fallbacks
				signalHandler := NewSignalHandler(nil)
				if db != nil {
					signalHandler.WithDB(db)
				}
				r.Get("/available", signalHandler.AvailableSignals)
				r.Get("/stats", signalHandler.Stats)
				r.Get("/{signalName}/history", signalHandler.History)
			}
		})

		// Data Repair
		r.Route("/data-repair", func(r chi.Router) {
			r.Use(httprate.LimitByIP(20, 1*time.Minute))
			r.Get("/stale-sessions", dataRepairHandler.GetStaleSessions)
			r.Route("/charging/{id}", func(r chi.Router) {
				r.Put("/", dataRepairHandler.UpdateCharging)
				r.Post("/close", dataRepairHandler.CloseCharging)
				r.Delete("/", dataRepairHandler.DeleteCharging)
			})
			r.Route("/drive/{id}", func(r chi.Router) {
				r.Put("/", dataRepairHandler.UpdateDrive)
				r.Post("/close", dataRepairHandler.CloseDrive)
				r.Delete("/", dataRepairHandler.DeleteDrive)
			})
		})

		// Backup & Restore
		r.Route("/backup", func(r chi.Router) {
			r.Get("/configs", backupRestoreHandler.ListConfigs)
			r.Post("/configs", backupRestoreHandler.CreateConfig)
			r.Get("/configs/{configID}", backupRestoreHandler.GetConfig)
			r.Put("/configs/{configID}", backupRestoreHandler.UpdateConfig)
			r.Delete("/configs/{configID}", backupRestoreHandler.DeleteConfig)
			r.Post("/configs/{configID}/trigger", backupRestoreHandler.TriggerBackup)
			r.Post("/quick", backupRestoreHandler.TriggerQuickBackup)
			r.Get("/runs", backupRestoreHandler.ListRuns)
			r.Get("/runs/{runID}", backupRestoreHandler.GetRun)
			r.Get("/runs/{runID}/download", backupRestoreHandler.DownloadBackup)
			r.Post("/runs/{runID}/verify", backupRestoreHandler.VerifyBackup)
			r.Get("/runs/{runID}/preview", backupRestoreHandler.PreviewRestore)
		})

		// Export
		r.With(httprate.LimitByIP(10, 1*time.Minute)).Get("/export/{type}", NewExportHandler(db))

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

		// ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç
		// NEW ARCHITECTURE: Hexagonal handlers (adapters ╬ô├Ñ├å services ╬ô├Ñ├å v1 handlers)
		// These complement the existing routes above.
		// ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç
		pool := db.Pool

		// Adapters
		vehicleRepo := pgadapter.NewVehicleRepository(pool)
		chargingRepo := pgadapter.NewChargingSessionRepository(pool)
		tripRepo := pgadapter.NewTripRepository(pool)
		exportRepo := pgadapter.NewExportJobRepository(pool)
		fsmHistoryRepo := pgadapter.NewFSMHistoryRepository(pool)

		// Services
		vehicleSvc := vehiclesvc.New(vehicleRepo, fsmHistoryRepo, nil)
		chargingSvc := chargingsvc.New(chargingRepo, fsmHistoryRepo)
		exportSvc := exportsvc.New(exportRepo, fsmHistoryRepo, nil)
		dashboardSvc := dashboardsvc.New(vehicleRepo, chargingRepo, tripRepo)

		// Handlers
		v1VehicleHandler := v1handlers.NewVehicleHandler(vehicleSvc)
		v1ChargingHandler := v1handlers.NewChargingHandler(chargingSvc)
		v1ExportHandler := v1handlers.NewExportHandler(exportSvc)
		v1DashboardHandler := v1handlers.NewDashboardHandler(dashboardSvc)
		v1UserHandler := v1handlers.NewUserHandler()

		// Register new routes (paths that DON'T exist in the legacy router above)
		v1DashboardHandler.Register(r)    // /dashboard/stats ╬ô├ç├╢ NEW
		v1ChargingHandler.Register(r)     // /charging-sessions ╬ô├ç├╢ NEW (old uses /charging)
		v1ExportHandler.Register(r)       // /exports ╬ô├ç├╢ NEW (old uses /export/jobs)
		v1UserHandler.Register(r)         // /users/me ╬ô├ç├╢ NEW
		// NOTE: /vehicles conflicts with legacy vehicleHandler above; skip new vehicle handler.

		// Suppress unused warnings
		_ = vehicleSvc
		_ = v1VehicleHandler
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

		// Don't intercept API paths ╬ô├ç├╢ let them 404 naturally
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

		// SPA fallback ╬ô├ç├╢ serve index.html for client-side routing
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	}
}
