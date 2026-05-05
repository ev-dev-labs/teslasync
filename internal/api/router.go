package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	"github.com/ev-dev-labs/teslasync/internal/integrations"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/platform"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	"github.com/ev-dev-labs/teslasync/internal/service"
	signal "github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/ev-dev-labs/teslasync/internal/webpush"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/pquerna/otp/totp"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/automation"
	"github.com/ev-dev-labs/teslasync/internal/automation/action"

	// New hexagonal architecture packages
	pgadapter "github.com/ev-dev-labs/teslasync/internal/adapter/postgres"
	"github.com/ev-dev-labs/teslasync/internal/app/chargingsvc"
	"github.com/ev-dev-labs/teslasync/internal/app/dashboardsvc"
	"github.com/ev-dev-labs/teslasync/internal/app/exportsvc"
	"github.com/ev-dev-labs/teslasync/internal/app/vehiclesvc"
	v1handlers "github.com/ev-dev-labs/teslasync/internal/handler/v1"
)

// NewRouter creates and configures the main HTTP router with all API routes,
// middleware (logging, recovery, CORS, rate limiting, security headers), and
// a static file server for the SPA frontend. It wires up handler dependencies
// and returns the ready-to-serve http.Handler.
//
// stateReader is the new signal-log-backed cold-path reader (ADR-002 / phase-39).
// It is threaded through here so that handler migrations in phases 10–36 can
// take it as a constructor dependency one file at a time. The legacy
// *database.SignalLogReader (signalLogReader below) is intentionally preserved
// alongside it during the migration window so the build stays green between
// prompts; both readers will coexist until the deletion prompts (phases 37–40).
func NewRouter(db *database.DB, teslaClient *tesla.Client, mqttClient *mqtt.Client, cfg *config.Config, health *resilience.HealthMonitor, stateReader signal.StateReader, opts ...RouterOptions) http.Handler {
	r := chi.NewRouter()
	// stateReader is intentionally not wired into individual handlers in this
	// prompt — handler-migration prompts (phases 10–36) consume it one file at
	// a time. The reference below keeps it visible to readers and lets static
	// analyzers see it as a live dependency rather than a dead parameter.
	_ = stateReader

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
	r.Use(RecoveryMiddleware)                    // Enhanced recovery that logs panics as structured errors
	r.Use(ErrorTrackingMiddleware(errorTracker)) // Centralized error aggregation
	r.Use(PrometheusMiddleware)                  // HTTP request metrics (duration, count, size)
	r.Use(chimw.Compress(5))

	// CORS ╬ô├ç├╢ use explicit origins in production. The wildcard is kept for
	// development convenience but paired with AllowCredentials=false to comply
	// with the Fetch spec. Set CORS_ORIGINS env var for production.
	corsOrigins := []string{"*"}
	if cfg.CORSOrigins != "" {
		corsOrigins = []string{cfg.CORSOrigins}
	}
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: corsOrigins,
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "X-API-Key"},
		ExposedHeaders: []string{"X-Request-ID", "X-Response-Time"},
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
	vehicleHandler := NewVehicleHandler(vehicleSvc, teslaClient, stateReader)
	driveHandler := NewDriveDetail(db, stateReader)
	chargingHandler := NewChargingHandler(db, stateReader)
	geofenceHandler := NewGeofenceHandler(db)
	authHandler := NewAuthHandler(db, teslaClient, opt.Encryptor)
	// Phase-46 / Prompt 31 — Sudo step-up. Construct the in-memory
	// token store and the reauth HTTP handler once and share them
	// across the route table. The store is the source of truth for
	// step-up authorisation; the middleware reads from it on every
	// gated request, the handler writes to it on a successful
	// /auth/reauth.
	sudoCfg := LoadSudoConfig(cfg)
	sudoStore := database.NewSudoTokenStore(sudoCfg.TTL)
	// Phase-46 / Prompt 35 — wire the real RFC 6238 verifier so the
	// shared TESLASYNC_SUDO_TOTP_SECRET path validates for real (and
	// not just NULL-on-arrival as it did before). We pass a thin
	// closure rather than a bare totp.Validate reference so any future
	// switch to a non-default Validate variant (different period /
	// digits / skew) only changes one line.
	sudoTOTPVerifier := func(secret, code string) error {
		if !totp.Validate(code, secret) {
			return errors.New("invalid totp code")
		}
		return nil
	}
	sudoHandler := NewSudoHandler(sudoCfg, sudoStore, sudoTOTPVerifier)

	// Phase-46 / Prompt 35 — per-user TOTP enrollment. Owns its own
	// pending/active tables; mints sudo tokens via the shared sudoStore
	// from prompt 31 so a successful per-user TOTP step-up is
	// indistinguishable downstream from a successful password step-up.
	totpRepo := database.NewTOTPRepo(db)
	totpHandler := NewTOTPHandler(totpRepo, opt.Encryptor, sudoStore, cfg.Auth.ForwardAuthHeader)

	// Phase-46 / Prompt 34 — Live log tail. Build a process-wide
	// pub/sub registry for zerolog events and tee the global logger
	// through it so every Info/Warn/Error/etc. fans out to any
	// connected SSE subscriber. The tee is idempotent: installAdminLogStreamTap
	// guards against double-wrapping when NewRouter is called more
	// than once in the same process (e.g. parallel router tests).
	logTap := platform.NewLogSubscriberRegistry()
	installAdminLogStreamTap(logTap)
	logStreamHandler := NewAdminLogStreamHandler(logTap)
	settingsHandler := NewSettingsHandler(db)
	dashboardLayoutHandler := NewDashboardLayoutHandler(db)
	chartAnnotationHandler := NewChartAnnotationHandler(db)
	pinnedHandler := NewPinnedHandler(db)
	savedViewsHandler := NewSavedViewsHandler(db, cfg.Auth.ForwardAuthHeader)
	pushHandler := NewPushHandler(db, webpush.Default(), cfg.Auth.ForwardAuthHeader)
	var pahoForAlerts pahomqtt.Client
	if mqttClient != nil {
		pahoForAlerts = mqttClient.Underlying()
	}
	var alertLiveSignalStore signal.LiveSignalStore
	if opt.TelemetryHandler != nil {
		alertLiveSignalStore = opt.TelemetryHandler.GetLiveSignalStore()
	}
	alertHandler := NewAlertHandler(db, eventHub, pahoForAlerts, alertLiveSignalStore)
	commandHandler := NewCommandHandler(db, teslaClient)
	guardHandler := NewGuardHandler(db, teslaClient)
	energyHandler := NewEnergyHandler(energySvc)
	signalLogReader := database.NewSignalLogReader(db)
	batteryHandler := NewBatteryHandler(db, stateReader)
	analyticsHandler := NewAnalyticsHandler(db, stateReader)
	notificationHandler := NewNotificationHandler(db)
	notifScheduleHandler := NewNotificationScheduleHandler(db)
	quietHoursHandler := NewQuietHoursHandler(database.NewQuietHoursRepo(db), cfg)
	chatbotHandler := NewChatbotHandler(db, vehicleSvc, stateReader)
	tirePressureHandler := NewTirePressureHandler(stateReader)
	motorHandler := NewMotorHandler(stateReader)
	climateHandler := NewClimateHandler(stateReader)
	securityHandler := NewSecurityHandler(stateReader)
	chargingTelemetryHandler := NewChargingTelemetryHandler(stateReader)
	mediaHandler := NewMediaHandler(stateReader)
	vehicleConfigHandler := NewVehicleConfigHandler(stateReader)
	locationSnapshotHandler := NewLocationSnapshotHandler(stateReader)
	safetyHandler := NewSafetyHandler(stateReader)
	userPreferenceHandler := NewUserPreferenceHandler(stateReader)
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
	batteryDegradationHandler := NewBatteryDegradationHandler(db, stateReader, signalLogReader)
	auditHandler := NewAuditHandler(db, cfg.Auth.ForwardAuthHeader)
	apiCallLogHandler := NewAPICallLogHandler(db)
	apiKeyHandler := NewAPIKeyHandler(db, cfg.Auth.ForwardAuthHeader)
	signalCatalogHandler := NewSignalCatalogHandler(db)
	chargingHeatmapHandler := NewChargingHeatmapHandler(db)
	speedProfileHandler := NewSpeedProfileHandler(db)
	dataRepairHandler := NewDataRepairHandler(db)
	tempImpactHandler := NewTempImpactHandler(db)
	routeEfficiencyHandler := NewRouteEfficiencyHandler(db)
	batteryCellsHandler := NewBatteryCellsHandler(db, alertLiveSignalStore, stateReader, signalLogReader)
	rangeProjectionHandler := NewRangeProjectionHandler(db, stateReader)
	drivetrainHealthHandler := NewDrivetrainHealthHandler(db, stateReader)
	maintenanceHandler := NewMaintenanceHandler(db)
	periodStatsHandler := NewPeriodStatsHandler(db)
	drivingCoachHandler := NewDrivingCoachHandler(db)
	costForecastHandler := NewCostForecastHandler(db)
	chargingOptimizerHandler := NewChargingOptimizerHandler(db)
	anomalyHandler := NewAnomalyHandler(db)
	lifetimeHandler := NewLifetimeHandler(db, eventHub)
	yearReviewHandler := NewYearReviewHandler(db)
	chargePlannerHandler := NewChargePlannerHandler(db, teslaClient, cfg, stateReader)
	energyFlowHandler := NewEnergyFlowHandler(db, stateReader)
	weeklyDigestHandler := NewWeeklyDigestHandler(db)
	teslaChargingHistoryHandler := NewTeslaChargingHistoryHandler(teslaClient, db)
	teslaChargingSessionHandler := NewTeslaChargingSessionHandler(teslaClient, db)
	teslaEnergyHistoryHandler := NewTeslaEnergyHistoryHandler(teslaClient, db)
	teslaEnergyLiveStatusHandler := NewTeslaEnergyLiveStatusHandler(teslaClient, db)
	energySiteHandler := NewEnergySiteHandler(teslaClient, db)
	fleetTelemetryErrorHandler := NewFleetTelemetryErrorHandler(teslaClient, db)
	teslaUserConfigHandler := NewTeslaUserConfigHandler(teslaClient, db)
	teslaUserOrderHandler := NewTeslaUserOrderHandler(teslaClient, db)
	teslaUserProfileHandler := NewTeslaUserProfileHandler(teslaClient, db)
	vehicleAccessHandler := NewVehicleAccessHandler(teslaClient, db)
	vehicleInfoHandler := NewVehicleInfoHandler(teslaClient, db)
	tripPlannerHandler := NewTripPlannerHandler(db, opt.CacheStore, stateReader)
	geocodeHandler := NewGeocodeHandler(geocoding.NewSearcher("TeslaSync/1.0"), geocoding.NewGeocoder(cfg.GoogleMaps.APIKey, cfg.AzureMaps.APIKey))
	shareHandler := NewShareHandler(db)
	watchHandler := NewWatchHandler(db, teslaClient)
	onboardingHandler := NewOnboardingHandler(db, opt.Encryptor)
	searchHandler := NewSearchHandler(db)

	// Wire Redis signal cache to handlers that read live vehicle state
	if opt.CacheStore != nil {
		if rdb := opt.CacheStore.Underlying(); rdb != nil {
			redisSignalCache := signal.NewRedisSignalCache(rdb)
			maintenanceHandler.WithRedisCache(redisSignalCache)
			commandHandler.WithRedisCache(redisSignalCache)
			watchHandler.WithRedisCache(redisSignalCache)
			driveHandler.WithRedisCache(redisSignalCache)
			chargingHandler.WithRedisCache(redisSignalCache)
			rangeProjectionHandler.WithRedisCache(redisSignalCache)
		}
	}

	// Wire ForwardAuth header into handlers that audit-log mutations
	// (Phase-40 / Prompt 51 — bulk action endpoints).
	driveHandler.WithForwardAuthHeader(cfg.Auth.ForwardAuthHeader)
	chargingHandler.WithForwardAuthHeader(cfg.Auth.ForwardAuthHeader)
	alertHandler.WithForwardAuthHeader(cfg.Auth.ForwardAuthHeader)

	// Start Redis Pub/Sub subscription for cross-pod SSE delivery.
	// When Redis is available, vehicle_update events published by any pod's
	// telemetry handler are forwarded to this pod's SSE clients.
	if opt.CacheStore != nil {
		if rdb := opt.CacheStore.Underlying(); rdb != nil {
			eventHub.SubscribeRedis(context.Background(), signal.NewRedisSignalCache(rdb))
		}
	}

	// SSE event hub for automation real-time events
	automationEventHub := NewEventHub()
	automationPublisher := NewAutomationEventPublisher(automationEventHub)

	// Wire MQTT publisher for automation config change notifications
	var automationMQTTPublisher AutomationMQTTPublisher
	if mqttClient != nil {
		automationMQTTPublisher = &automationMQTTReloader{client: mqttClient}
	}

	automationHandler := NewAutomationHandler(db,
		WithCommandExecutor(action.NewCommandExecutor(
			database.NewVehicleRepo(db),
			database.NewCommandLogRepo(db),
			&settingsCheckerAdapter{database.NewSettingsRepo(db)},
			teslaClient,
		)),
		WithAutomationEventPublisher(automationPublisher),
		WithAutomationAuditor(automation.NewAuditor(NewDBAuditWriter(db))),
		WithAutomationMQTTPublisher(automationMQTTPublisher),
	)
	telemetryHandler := opt.TelemetryHandler
	if telemetryHandler == nil {
		telemetryHandler = NewTelemetryHandler(db, mqttClient, eventHub, 5*time.Minute, geocoding.NewGeocoder(cfg.GoogleMaps.APIKey, cfg.AzureMaps.APIKey))
	} else {
		// Reusing handler from main ╬ô├ç├╢ wire the eventHub created by the router
		telemetryHandler.SetEventHub(eventHub)
	}
	// Phase-39 / ADR-002: install the cold-path signal.StateReader on the
	// session tracker so charge-completion and drive-completion enrichment
	// use the canonical state-read API instead of the legacy
	// *database.SignalLogReader.SnapshotAt /
	// *database.SignalHistoryWriter.SnapshotAt code paths that this prompt
	// removed from telemetry_sessions_charge_tracking.go and
	// telemetry_sessions_drive_tracking.go.
	if st := telemetryHandler.SessionTracker(); st != nil {
		st.SetChargeStateReader(stateReader)
		st.SetDriveStateReader(stateReader)
	}
	devToolsHandler := NewDevToolsHandler(teslaClient, WithDB(db), WithMQTTClient(mqttClient), WithConfig(cfg), WithSignalStore(opt.SignalStore))
	if opt.CacheStore != nil {
		if rdb := opt.CacheStore.Underlying(); rdb != nil {
			devToolsHandler.redisCache = signal.NewRedisSignalCache(rdb)
		}
	}

	// Wire telemetry handler into vehicle handler for streaming-aware state
	vehicleHandler.SetTelemetryHandler(telemetryHandler)

	// Wire signal.StateReader into vehicle service for the durable
	// last-value backstop used by BuildStateFromSignalStore (ADR-002).
	vehicleSvc.WithStateReader(stateReader)

	// Wire telemetry handler into settings handler for capture toggle sync
	settingsHandler.SetTelemetryHandler(telemetryHandler)

	// Health check
	r.Get("/healthz", HealthHandler(db))
	r.Get("/readyz", ReadyHandler(db, teslaClient))

	// Internal: PreStop flush endpoint for Kubernetes lifecycle hooks
	// (Signal store no longer has Postgres flush — Redis + signal_log handle persistence)
	r.Post("/internal/flush", func(w http.ResponseWriter, req *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "flushed"})
	})

	// Metrics
	r.Handle("/metrics", MetricsHandler())

	// Public: Automation webhook receiver (no auth — token IS the auth).
	// Mounted before the /api/v1 subrouter so it is exempt from any
	// ForwardAuth / auth middleware applied to the main API group.
	if opt.WebhookTrigger != nil {
		webhookReceiver := NewWebhookReceiverHandler(opt.WebhookTrigger)
		r.With(
			httprate.Limit(60, 1*time.Minute, httprate.WithKeyFuncs(
				webhookTokenKeyFunc,
			)),
		).Post("/api/v1/automations/webhook/{token}", webhookReceiver.Receive)
	}

	// Public: Shareable drive reports (no auth — token IS the auth).
	// Rate limited to prevent abuse of public endpoints.
	// NOTE: If using ForwardAuth (Authentik/Authelia), exempt /api/v1/share/ from auth.
	r.With(
		httprate.LimitByIP(60, 1*time.Minute),
	).Get("/api/v1/share/{token}", shareHandler.GetPublicShare)

	// Public: Web Vitals ingest (Phase 45 / Prompt 12). Anonymous browsers
	// POST batches of LCP/INP/CLS/FCP/TTFB samples here. Mounted outside
	// the /api/v1 ForwardAuth subrouter so logged-out clients can still
	// report — the body carries no PII and the handler caps batch size +
	// label cardinality. Rate-limited per IP to bound abuse.
	webVitalsHandler := NewWebVitalsHandler()
	r.With(
		httprate.LimitByIP(120, 1*time.Minute),
	).Post("/api/v1/web-vitals", webVitalsHandler.Ingest)

	// Public: Web error reports (Phase 46 / Prompt 01). The SPA's global
	// error reporter POSTs uncaught exceptions, unhandled promise
	// rejections, React render errors, and TanStack Query failures here.
	// Mounted OUTSIDE the /api/v1 ForwardAuth subrouter so we can
	// capture login-loop bugs even when the user's auth token is
	// expired. The handler bounds payload size + label cardinality;
	// abuse is bounded by a tight per-IP rate limit (errors are bursty
	// — 50 reports/minute is generous without enabling spam). The
	// summary endpoint below is admin-only and shares the same handler
	// instance so the rolling-window state is consistent.
	webErrorHandler := NewWebErrorHandler()
	r.With(
		httprate.LimitByIP(50, 1*time.Minute),
	).Post("/api/v1/web-errors", webErrorHandler.Ingest)

	// Public: Auth session-info endpoint (Phase 46 / Prompt 05). The
	// SPA polls this every 5 minutes so it can surface the
	// SessionExpiringModal countdown ~60s before the upstream
	// ForwardAuth cookie expires, and the SessionExpiredModal hard-
	// block once it has expired. Mounted OUTSIDE the /api/v1
	// ForwardAuth subrouter and ALWAYS returns 200 OK — if it returned
	// 401 when unauthenticated the polling SPA would hit the same
	// expired-session path that drove it here, infinite-looping the
	// hard-expired modal. Per-IP rate limit is generous (60/min)
	// because every SPA tab independently polls.
	authSessionHandler := NewAuthSessionHandler(cfg)
	r.With(
		httprate.LimitByIP(60, 1*time.Minute),
	).Get("/api/v1/auth/session", authSessionHandler.Session)

	// System state (Phase 46 / Prompt 04): single-row maintenance/degraded-mode
	// banner state. Repo + handler + maintenance provider are constructed
	// once here so the GET /system/health closure and the admin POST share
	// the same store and env-vs-DB resolver semantics.
	systemStateRepo := database.NewSystemStateRepo(db)
	adminMaintenanceHandler := NewAdminMaintenanceHandler(systemStateRepo, cfg, db)
	maintenanceProvider := BuildMaintenanceProvider(systemStateRepo, cfg)

	// Phase 46 / Prompt 08: in-app feedback widget. Repo is shared
	// between the public POST ingest endpoint (rate-limited per
	// submitter) and the admin queue endpoints (list + patch + optional
	// GitHub Issues bridge). The bridge is wired at construction time
	// from cfg.GitHub; when Repo or Token is empty, NewGitHubIssuesClient
	// returns nil and the admin endpoint flips github_bridge_enabled to
	// false in its response so the SPA hides the Forward action.
	userFeedbackRepo := database.NewUserFeedbackRepo(db)
	feedbackHandler := NewFeedbackHandler(userFeedbackRepo, cfg)
	githubIssuesClient := integrations.NewGitHubIssuesClient(integrations.GitHubIssuesConfig{
		Repo:  cfg.GitHub.Repo,
		Token: cfg.GitHub.Token,
	})
	var githubBridge GitHubIssuesPoster
	if githubIssuesClient != nil {
		githubBridge = githubIssuesClient
	}
	adminFeedbackHandler := NewAdminFeedbackHandler(userFeedbackRepo, cfg, db, githubBridge)


	// API v1 routes
	r.Route("/api/v1", func(r chi.Router) {
		// APICallLog middleware: persist every inbound /api/v1 request to
		// api_call_logs (service="teslasync-api"). Mounted BEFORE
		// ForwardAuthMiddleware so 401 responses from the auth layer are
		// also captured. Skip predicate excludes streaming/health/metrics
		// and the api-logs admin UI itself (feedback loop). The admin
		// live log stream (phase-46/34) is also excluded so the
		// SSE viewer doesn't recursively log itself.
		r.Use(APICallLogMiddleware(GetAPICallLogger(), cfg.APILogs.CaptureBodies, func(p string) bool {
			if p == AdminLogStreamPath {
				return true
			}
			return DefaultAPILogSkip(p)
		}))

		// ForwardAuth: protect all /api/v1/* routes via reverse-proxy header.
		// No-op when ForwardAuthHeader is empty (dev mode / no auth configured).
		r.Use(ForwardAuthMiddleware(cfg.Auth.ForwardAuthHeader))

		// Auth (stricter rate limits to prevent brute force)
		r.Route("/auth", func(r chi.Router) {
			r.Use(httprate.LimitByIP(10, 1*time.Minute))
			r.Get("/login", authHandler.Login)
			r.Post("/url", authHandler.Login)
			r.Get("/callback", authHandler.Callback)
			r.Post("/refresh", authHandler.Refresh)
			r.Get("/status", authHandler.Status)
			// Phase-46 / Prompt 31 — destructive: revokes Tesla
			// refresh token and clears credentials. Sudo gated.
			r.With(RequireSudo(sudoStore, sudoCfg)).Post("/disconnect", authHandler.Disconnect)
			// Phase-46 / Prompt 31 — Sudo step-up reauth. POST a
			// password OR totp_code to mint a 5-minute X-Sudo-Token
			// the SPA echoes on subsequent destructive requests. In
			// open mode this returns 200 mode="open" without minting
			// anything; the dialog falls back to typed-confirmation.
			r.Post("/reauth", sudoHandler.Reauth)
			// Phase-46 / Prompt 35 — per-user TOTP enrollment.
			// /totp                              GET    status pill backing
			// /totp/enroll                       POST   start enrollment
			// /totp/verify                       POST   confirm enrollment
			// /totp/sudo                         POST   mint sudo token via per-user TOTP
			// /totp                              DELETE revoke (sudo-gated)
			// /totp/backup-codes/regenerate      POST   rotate backup codes (sudo-gated)
			r.Route("/totp", func(r chi.Router) {
				r.Get("/", totpHandler.GetStatus)
				r.Post("/enroll", totpHandler.Enroll)
				r.Post("/verify", totpHandler.Verify)
				r.Post("/sudo", totpHandler.VerifySudo)
				r.With(RequireSudo(sudoStore, sudoCfg)).Delete("/", totpHandler.Revoke)
				r.With(RequireSudo(sudoStore, sudoCfg)).Post("/backup-codes/regenerate", totpHandler.RegenerateBackupCodes)
			})
		})

		// Onboarding (Phase 40 / Prompt 18): first-run gate status.
		// Reports whether the install has connected a Tesla account,
		// has any vehicles, and has received recent telemetry. The
		// frontend polls this endpoint and routes the user to
		// <OnboardingPage> until is_complete flips to true.
		r.Get("/onboarding/status", onboardingHandler.Status)

		// Vehicles
		r.Route("/vehicles", func(r chi.Router) {
			r.Get("/", vehicleHandler.List)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/sync", vehicleHandler.SyncFromTesla)
			r.Route("/{vehicleID}", func(r chi.Router) {
				r.Get("/", vehicleHandler.Get)
				// Phase-46 / Prompt 31 — destructive: requires sudo.
				r.With(RequireSudo(sudoStore, sudoCfg)).Delete("/", vehicleHandler.Delete)
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

				// Vehicle access: drivers & share invitations
				r.Route("/drivers", func(r chi.Router) {
					r.Get("/", vehicleAccessHandler.ListDrivers)
					r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/refresh", vehicleAccessHandler.RefreshDrivers)
					r.With(httprate.LimitByIP(5, 1*time.Minute)).Delete("/", vehicleAccessHandler.RemoveDriver)
				})
				r.Route("/invitations", func(r chi.Router) {
					r.Get("/", vehicleAccessHandler.ListInvitations)
					r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/", vehicleAccessHandler.CreateInvitation)
					r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/refresh", vehicleAccessHandler.RefreshInvitations)
					r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/{invitationID}/revoke", vehicleAccessHandler.RevokeInvitation)
				})

				// Vehicle info: mobile access, options, specs
				r.Get("/mobile-enabled", vehicleInfoHandler.MobileEnabled)
				r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/mobile-enabled/refresh", vehicleInfoHandler.RefreshMobileEnabled)
				r.Get("/options", vehicleInfoHandler.VehicleOptions)
				r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/options/refresh", vehicleInfoHandler.RefreshVehicleOptions)
				r.Get("/specs", vehicleInfoHandler.VehicleSpecs)
				r.With(httprate.LimitByIP(2, 1*time.Minute)).Post("/specs/refresh", vehicleInfoHandler.RefreshVehicleSpecs)

				// Vehicle lifecycle: subscriptions & upgrades
				r.Get("/subscriptions", vehicleInfoHandler.SubscriptionEligibility)
				r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/subscriptions/refresh", vehicleInfoHandler.RefreshSubscriptionEligibility)
				r.Get("/upgrades", vehicleInfoHandler.UpgradeEligibility)
				r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/upgrades/refresh", vehicleInfoHandler.RefreshUpgradeEligibility)

				// Guard Mode (anti-theft)
				r.Route("/guard", func(r chi.Router) {
					r.Get("/", guardHandler.GetConfig)
					r.Post("/", guardHandler.SetConfig)
					r.Get("/events", guardHandler.ListEvents)
					r.Post("/events/{eventID}/acknowledge", guardHandler.AcknowledgeEvent)
					r.With(httprate.LimitByIP(3, 1*time.Minute)).Post("/panic", guardHandler.Panic)
				})

				// FSM debug diagnostics
				r.Get("/fsm/debug", func(w http.ResponseWriter, req *http.Request) {
					fh := telemetryHandler.FSMHandler()
					if fh == nil {
						writeError(w, http.StatusNotFound, "FSM not enabled")
						return
					}
					fh.HandleDebug(w, req)
				})
			})
		})

		// Drives
		r.Route("/drives", func(r chi.Router) {
			r.Get("/", driveHandler.ListByVehicle)
			r.Get("/stats", driveHandler.Stats)
			r.Get("/score", driveHandler.Score)
			r.Get("/dynamics", driveHandler.Dynamics)
			r.Get("/acceleration-distribution", driveHandler.AccelerationDistribution)
			// Bulk delete (Phase-40 / Prompt 51)
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Delete("/bulk", driveHandler.BulkDelete)
			r.Route("/{driveID}", func(r chi.Router) {
				r.Get("/", driveHandler.Get)
				r.Get("/positions", driveHandler.Positions)
				r.Get("/telemetry", driveHandler.TelemetryReadings)
				// Share link management
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/share", shareHandler.Create)
				r.Get("/shares", shareHandler.List)
			})
		})

		// Share link revocation (by token, not by drive)
		r.With(httprate.LimitByIP(20, 1*time.Minute)).Delete("/shares/{token}", shareHandler.Revoke)

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
			// Bulk delete (Phase-40 / Prompt 51)
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Delete("/bulk", chargingHandler.BulkDelete)
			r.Route("/{sessionID}", func(r chi.Router) {
				r.Get("/", chargingHandler.Get)
				r.Get("/telemetry", chargingHandler.TelemetryReadings)
			})
		})

		// Tesla Charging History (Supercharger/DC billing records)
		r.Route("/tesla/charging", func(r chi.Router) {
			r.Route("/history", func(r chi.Router) {
				r.Get("/", teslaChargingHistoryHandler.List)
				r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/refresh", teslaChargingHistoryHandler.Refresh)
			})
			r.Get("/invoice/{contentID}", teslaChargingHistoryHandler.Invoice)
			// Fleet charging sessions (business accounts only)
			r.Route("/sessions", func(r chi.Router) {
				r.Get("/", teslaChargingSessionHandler.List)
				r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/refresh", teslaChargingSessionHandler.Refresh)
			})
		})

		// Tesla Energy Sites (product discovery)
		r.Get("/tesla/energy-sites", energySiteHandler.List)
		r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/tesla/energy-sites/refresh", energySiteHandler.Refresh)

		// Tesla Energy Site History (calendar_history + telemetry_history)
		r.Route("/tesla/energy-sites/{siteID}", func(r chi.Router) {
			// Site info (configuration, components, firmware)
			r.Get("/site-info", energySiteHandler.SiteInfo)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/site-info/refresh", energySiteHandler.RefreshSiteInfo)

			r.Get("/energy-history", teslaEnergyHistoryHandler.EnergyHistory)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/energy-history/refresh", teslaEnergyHistoryHandler.RefreshEnergyHistory)
			r.Get("/backup-history", teslaEnergyHistoryHandler.BackupHistory)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/backup-history/refresh", teslaEnergyHistoryHandler.RefreshBackupHistory)
			r.Get("/charging-history", teslaEnergyHistoryHandler.ChargingHistory)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/charging-history/refresh", teslaEnergyHistoryHandler.RefreshChargingHistory)

			// Live status (power flow snapshots)
			r.Get("/live-status", teslaEnergyLiveStatusHandler.LiveStatus)
			r.Get("/live-status/history", teslaEnergyLiveStatusHandler.LiveStatusHistory)
			r.With(httprate.LimitByIP(10, 1*time.Minute)).Post("/live-status/refresh", teslaEnergyLiveStatusHandler.RefreshLiveStatus)

			// Time-of-Use settings (rate plan / tariff)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/tou-settings", energySiteHandler.UpdateTOUSettings)
		})

		// Tesla Fleet Telemetry Errors (partner-level — all vehicles)
		r.Route("/tesla/fleet-telemetry", func(r chi.Router) {
			r.Get("/error-vins", fleetTelemetryErrorHandler.ErrorVINs)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/error-vins/refresh", fleetTelemetryErrorHandler.RefreshErrorVINs)
			r.Get("/errors", fleetTelemetryErrorHandler.Errors)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/errors/refresh", fleetTelemetryErrorHandler.RefreshErrors)
		})

		// Tesla User Config (feature flags, region) and Orders
		r.Route("/tesla/user", func(r chi.Router) {
			r.Get("/feature-config", teslaUserConfigHandler.FeatureConfig)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/feature-config/refresh", teslaUserConfigHandler.RefreshFeatureConfig)
			r.Get("/region", teslaUserConfigHandler.Region)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/region/refresh", teslaUserConfigHandler.RefreshRegion)
			r.Get("/orders", teslaUserOrderHandler.Orders)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/orders/refresh", teslaUserOrderHandler.RefreshOrders)
			r.Get("/profile", teslaUserProfileHandler.Profile)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/profile/refresh", teslaUserProfileHandler.RefreshProfile)
		})

		// Tesla Warranty Details (account-level)
		r.Get("/tesla/warranty", vehicleInfoHandler.WarrantyDetails)
		r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/tesla/warranty/refresh", vehicleInfoHandler.RefreshWarrantyDetails)

		// Geofences
		r.Route("/geofences", func(r chi.Router) {
			r.Get("/", geofenceHandler.List)
			r.Post("/", geofenceHandler.Create)
			// Bulk operations (Phase-45 / Prompt 32) — kept ahead of the
			// {geofenceID} subrouter so chi matches the static path first.
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/bulk", geofenceHandler.BulkUpdate)
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
			r.Get("/settings/dashboard-layouts", settingsHandler.GetDashboardLayouts)
			r.Put("/settings/dashboard-layouts", settingsHandler.UpdateDashboardLayouts)
		})

		// Named dashboard layout library (Phase 40 / Prompt 30).
		// Coexists with /settings/dashboard-layouts above — that endpoint
		// holds the active in-app blob, this is the per-row "save as
		// preset" library scoped per-vehicle.
		r.Route("/dashboard/layouts", func(r chi.Router) {
			r.Use(httprate.LimitByIP(20, 1*time.Minute))
			r.Get("/", dashboardLayoutHandler.List)
			r.Post("/", dashboardLayoutHandler.Create)
			r.Put("/{id}", dashboardLayoutHandler.Update)
			r.Delete("/{id}", dashboardLayoutHandler.Delete)
			r.Post("/{id}/apply", dashboardLayoutHandler.Apply)
		})

		// Chart annotations (Phase 40 / Prompt 43) — durable storage for the
		// user-authored event markers rendered on time-series charts. Replaces
		// the previous localStorage-only store so annotations survive a device
		// swap or fresh browser profile.
		r.Route("/annotations", func(r chi.Router) {
			r.Use(httprate.LimitByIP(60, 1*time.Minute))
			r.Get("/", chartAnnotationHandler.List)
			r.Post("/", chartAnnotationHandler.Create)
			r.Patch("/{id}", chartAnnotationHandler.Update)
			r.Delete("/{id}", chartAnnotationHandler.Delete)
		})

		// Pinned items (Phase 40 / Prompt 48) — unified per-user "pin" storage
		// powering pinned-first ordering across vehicles, dashboard widgets,
		// alert rules, geofences, automations, and commands.
		r.Route("/pinned", func(r chi.Router) {
			r.Use(httprate.LimitByIP(60, 1*time.Minute))
			r.Get("/", pinnedHandler.List)
			r.Post("/", pinnedHandler.Create)
			r.Patch("/{id}", pinnedHandler.Update)
			r.Delete("/{id}", pinnedHandler.Delete)
		})

		// Saved views (Phase 40 / Prompt 50) — durable named URL querystrings
		// for list pages (filters, sort, pagination). Each row is a snapshot
		// the user can recall later from the SavedViewMenu component; one
		// view per (user, route) may be marked default and auto-applies on
		// mount when the URL has no querystring.
		r.Route("/saved-views", func(r chi.Router) {
			r.Use(httprate.LimitByIP(60, 1*time.Minute))
			r.Get("/", savedViewsHandler.List)
			r.Post("/", savedViewsHandler.Create)
			r.Put("/{id}", savedViewsHandler.Update)
			r.Delete("/{id}", savedViewsHandler.Delete)
		})

		// Web Push (VAPID) — Phase 40 / Prompt 52. Browser subscription
		// registration + listing + removal. The VAPID public key is also
		// served unauthenticated (it is, by spec, public) — but rate
		// limiting still applies via the parent router. Push delivery
		// itself runs out-of-band in the notification worker.
		r.Route("/push", func(r chi.Router) {
			r.Use(httprate.LimitByIP(60, 1*time.Minute))
			r.Get("/public-key", pushHandler.PublicKey)
			r.Get("/subscribe", pushHandler.List)
			r.Post("/subscribe", pushHandler.Subscribe)
			r.Delete("/subscribe", pushHandler.Unsubscribe)
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
			r.Get("/metrics", alertHandler.ListMetrics)
			r.Get("/rules", alertHandler.ListRules)
			r.Post("/rules", alertHandler.CreateRule)
			r.Put("/rules/{ruleID}", alertHandler.UpdateRule)
			r.Delete("/rules/{ruleID}", alertHandler.DeleteRule)
			r.Post("/rules/{ruleID}/snooze", alertHandler.SnoozeRule)
			// Bulk enable/disable (Phase-40 / Prompt 51)
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/rules/bulk/enable", alertHandler.BulkEnableRules)
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/rules/bulk/disable", alertHandler.BulkDisableRules)
			r.Post("/test", alertHandler.TestRule)
			// Phase-46 / Prompt 20 — alert acknowledgement + audit timeline.
			// Registered AFTER the static `/rules`, `/metrics`, `/test` routes
			// above so chi's static-first matching routes them correctly.
			r.Get("/{alertID}", alertHandler.GetAlert)
			r.With(httprate.LimitByIP(60, 1*time.Minute)).Post("/{alertID}/acknowledge", alertHandler.AcknowledgeAlert)
			r.With(httprate.LimitByIP(60, 1*time.Minute)).Post("/{alertID}/comment", alertHandler.CommentAlert)
			r.With(httprate.LimitByIP(60, 1*time.Minute)).Post("/{alertID}/reopen", alertHandler.ReopenAlert)
		})

		// Automations
		r.Route("/automations", func(r chi.Router) {
			r.Get("/", automationHandler.List)
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/", automationHandler.Create)

			// Bulk operations (Phase-45 / Prompt 32) — registered before the
			// {id} subrouter so chi matches the static `/bulk` path first.
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/bulk", automationHandler.BulkUpdate)

			// SSE stream for real-time automation events (static route before {id} param)
			// Protected by ForwardAuthMiddleware on the parent /api/v1 group
			r.Get("/events", SSEHandler(automationEventHub))

			// Import/Export (static routes before {id} param)
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/export", automationHandler.ExportBatch)
			r.With(httprate.LimitByIP(10, 1*time.Minute)).Post("/import", automationHandler.Import)

			// Execution history (static routes before {id} param)
			r.Route("/history", func(r chi.Router) {
				r.Get("/", automationHandler.ListHistory)
				r.Get("/{historyId}", automationHandler.GetHistoryDetail)
			})

			// Presets (static routes before {id} param)
			r.Route("/presets", func(r chi.Router) {
				r.Get("/", automationHandler.ListPresets)
				r.Get("/{presetId}", automationHandler.GetPreset)
			})

			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", automationHandler.Get)
				r.Get("/export", automationHandler.ExportOne)
				r.Get("/history", automationHandler.ListAutomationHistory)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Put("/", automationHandler.Update)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Delete("/", automationHandler.Delete)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Patch("/toggle", automationHandler.Toggle)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Patch("/re-enable", automationHandler.ReEnable)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/test-run", automationHandler.TestRun)
				r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/undo", automationHandler.UndoLast)
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
		r.Get("/analytics/lifetime", lifetimeHandler.GetLifetimeStats)
		r.Get("/analytics/year-review", yearReviewHandler.GetYearReview)

		// Charge Planner (smart scheduling)
		r.Route("/charge-planner", func(r chi.Router) {
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/optimize", chargePlannerHandler.Optimize)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/apply", chargePlannerHandler.Apply)
			r.Get("/history", chargePlannerHandler.ListPlans)
			r.Get("/rate-plans", chargePlannerHandler.ListRatePlans)
		})

		// Trip Planner (route planning with charging stop estimation)
		r.Route("/trip-planner", func(r chi.Router) {
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/plan", tripPlannerHandler.Plan)
		})

		// Geocoding (forward address search + reverse coordinate lookup)
		r.With(httprate.LimitByIP(30, 1*time.Minute)).Get("/geocode/search", geocodeHandler.Search)
		r.With(httprate.LimitByIP(30, 1*time.Minute)).Get("/geocode/reverse", geocodeHandler.Reverse)

		// Global app-wide entity search (vehicles/drives/charging/alerts/...).
		// Rate-limited because each call fans out into ~9 ILIKE sub-queries.
		r.With(httprate.LimitByIP(30, 1*time.Minute)).Get("/search", searchHandler.Search)

		// Notifications
		r.Route("/notifications", func(r chi.Router) {
			r.Get("/", notificationHandler.ListChannels)
			r.Post("/", notificationHandler.CreateChannel)
			r.Get("/logs", notificationHandler.GetLogs)
			r.Get("/stats", notificationHandler.GetStats)
			r.Get("/unread-count", notificationHandler.UnreadCount)
			r.Post("/mark-read", notificationHandler.MarkRead)
			r.Post("/mark-unread", notificationHandler.MarkUnread)
			r.Post("/archive", notificationHandler.Archive)
			r.Post("/unarchive", notificationHandler.Unarchive)
			r.Delete("/logs", notificationHandler.DeleteBulk)
			r.Get("/analytics", notifScheduleHandler.GetAnalytics)
			r.Route("/schedules", func(r chi.Router) {
				r.Get("/", notifScheduleHandler.ListSchedules)
				r.Post("/", notifScheduleHandler.CreateSchedule)
				r.Delete("/{scheduleID}", notifScheduleHandler.DeleteSchedule)
			})
			// Phase-46 / Prompt 19 — Do-Not-Disturb windows. Mounted
			// before /{channelID} so chi's path matcher does not treat
			// "quiet-hours" as a channel id.
			r.Route("/quiet-hours", func(r chi.Router) {
				r.Get("/", quietHoursHandler.List)
				r.Post("/", quietHoursHandler.Create)
				r.Patch("/{id}", quietHoursHandler.Patch)
				r.Delete("/{id}", quietHoursHandler.Delete)
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
			r.Patch("/sessions/{id}", chatbotHandler.RenameSession)
			r.Delete("/sessions/{id}", chatbotHandler.DeleteSession)
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
					"enabled":  true,
					"stats":    stats,
					"vehicles": fh.VehicleSnapshots(),
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
					"data":     records,
					"total":    total,
					"page":     page,
					"per_page": perPage,
				})
			})
		})

		// Real-time SSE stream — protected by ForwardAuthMiddleware on the parent /api/v1 group
		r.Get("/events", SSEHandler(eventHub))
		// Backward-compat stub: frontend still calls fetchSSEToken() until it is removed
		r.Get("/sse-token", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{"token": ""})
		})

		// System endpoints
		r.Route("/system", func(r chi.Router) {
			r.Get("/status", SystemStatusHandler(db, teslaClient, mqttClient, health, cfg))
			// Build telemetry buffer stats callback if telemetry is active
			var bufferStats func() (int, int)
			if telemetryHandler != nil {
				if st := telemetryHandler.SessionTracker(); st != nil {
					bufferStats = func() (int, int) {
						return st.DriveBufferLen(), st.ChargeBufferLen()
					}
				}
			}
			r.Get("/health", ExtendedHealthCheck(db, health, bufferStats, maintenanceProvider))
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
			r.Get("/openapi", OpenAPIHandler())

			// Phase-46 / Prompt 33 — Aggregated self-test endpoint.
			// Single click runs ~10 checks (DB, MQTT, Redis, Tesla
			// token + breaker, signal_log freshness, migrations,
			// runtime, health monitor) and returns a structured
			// DiagnosticReport. Per-IP rate-limited because each
			// call fans out concurrent probes against every shared
			// dependency.
			diagnosticHandler := NewDiagnosticHandler(db, teslaClient, mqttClient, opt.CacheStore, health, cfg)
			r.With(httprate.LimitByIP(20, 1*time.Minute)).
				Post("/diagnostic", diagnosticHandler.ServeHTTP)
		})

		// Per-user activity feed (Phase-40 / Prompt 49 — Recent Activity Discoverability).
		// Returns the requesting caller's audit_logs entries scoped by the
		// configured ForwardAuth header value. Sibling to /system/audit, which
		// remains the admin-wide view.
		r.Get("/users/me/activity", auditHandler.UserActivity)

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
				// Phase-46 / Prompt 31 — destructive: requires sudo.
				r.With(RequireSudo(sudoStore, sudoCfg)).Delete("/", apiKeyHandler.Delete)
				r.With(RequireSudo(sudoStore, sudoCfg)).Post("/revoke", apiKeyHandler.Revoke)
			})
		})

		// Admin: frontend error reporting summary (Phase 46 / Prompt 01).
		// Last-hour rolling counts read from the same WebErrorHandler
		// instance that the public /api/v1/web-errors POST endpoint
		// writes to, so the summary stays in sync without going through
		// Prometheus. Auth-protected by the parent /api/v1 ForwardAuth
		// middleware.
		r.Route("/admin/web-errors", func(r chi.Router) {
			r.Get("/summary", webErrorHandler.Summary)
		})

		// Admin: operator-controlled maintenance/degraded banner
		// (Phase 46 / Prompt 04). GET returns the persisted DB row
		// plus an env-override marker; POST validates and writes the
		// row, audits the change via logAuditFromRequest, and rate-
		// limits per IP because state-change endpoints are otherwise
		// trivially abusable. Auth-protected by the parent /api/v1
		// ForwardAuth middleware (any authenticated user can write —
		// audit trail is the accountability surface; a future RBAC
		// layer can wrap this without changing the response shape).
		r.Route("/admin/maintenance", func(r chi.Router) {
			r.Use(httprate.LimitByIP(30, 1*time.Minute))
			r.Get("/", adminMaintenanceHandler.Get)
			r.Post("/", adminMaintenanceHandler.Set)
		})

		// In-app feedback / report-bug widget (Phase 46 / Prompt 08).
		// POST /feedback is the public ingest path used by the SPA's
		// <FeedbackModal> (sidebar button + Cmd+K command palette
		// entry). Mounted INSIDE this ForwardAuth subrouter so anonymous
		// spam is bounded (per the prompt's Out-of-scope: "Anonymous
		// feedback (must be authenticated to prevent spam)"). Per-row
		// rate limit (3/hour) is enforced inside the handler against
		// user_feedback so it survives pod restarts; a tighter per-IP
		// httprate ceiling guards against payload-flooding even when
		// the DB lookup fails open.
		r.With(httprate.LimitByIP(20, 1*time.Hour)).Post("/feedback", feedbackHandler.Submit)

		// Admin feedback queue (Phase 46 / Prompt 08): list / get /
		// patch the user_feedback rows. PATCH optionally forwards the
		// row to GitHub Issues when cfg.GitHub is configured. Any
		// authenticated caller can read/write — audit_logs is the
		// accountability surface, mirroring /admin/maintenance.
		r.Route("/admin/feedback", func(r chi.Router) {
			r.Use(httprate.LimitByIP(60, 1*time.Minute))
			r.Get("/", adminFeedbackHandler.List)
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", adminFeedbackHandler.Get)
				r.Patch("/", adminFeedbackHandler.Patch)
			})
		})

		// Admin: live log tail stream (Phase-46 / Prompt 34).
		// SSE endpoint that fans out structured zerolog events to
		// any authenticated browser. Read-only, idempotent — kept
		// behind the parent /api/v1 ForwardAuth gate but
		// intentionally NOT chained through RequireSudo: the SPA
		// uses fetch+ReadableStream (NOT EventSource) so it could
		// send X-Sudo-Token, but the stream itself triggers no side
		// effects so step-up is reserved for destructive admin
		// actions per Prompt 31's intent. httprate caps reconnect
		// storms to 10/min/IP.
		r.Route("/admin/logs", func(r chi.Router) {
			r.Use(httprate.LimitByIP(10, 1*time.Minute))
			r.Get("/stream", logStreamHandler.ServeHTTP)
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
			r.Get("/partner-public-key", devToolsHandler.PartnerPublicKey)
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
			r.Get("/redis-signals", devToolsHandler.RedisSignals)
			r.Get("/redis-signals/keys", devToolsHandler.RedisSignalKeys)

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
					if vid == 0 {
						vid = 1
					}
					signalNames := strings.Split(req.URL.Query().Get("signals"), ",")
					if len(signalNames) == 0 || signalNames[0] == "" {
						writeError(w, http.StatusBadRequest, "signals parameter required")
						return
					}
					from, _ := time.Parse(time.RFC3339, req.URL.Query().Get("from"))
					to, _ := time.Parse(time.RFC3339, req.URL.Query().Get("to"))
					if from.IsZero() {
						from = time.Now().UTC().Add(-1 * time.Hour)
					}
					if to.IsZero() {
						to = time.Now().UTC()
					}
					page, _ := strconv.Atoi(req.URL.Query().Get("page"))
					perPage, _ := strconv.Atoi(req.URL.Query().Get("per_page"))
					entries, total, err := shw.Query(req.Context(), vid, signalNames, from, to, page, perPage)
					if err != nil {
						writeError(w, http.StatusInternalServerError, "query failed")
						return
					}
					totalPages := (total + int64(perPage) - 1) / int64(perPage)
					if perPage == 0 {
						totalPages = 0
					}
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
				if vid == 0 {
					vid = 1
				}
				signals, err := shw.AvailableSignals(req.Context(), vid)
				if err != nil {
					writeError(w, http.StatusInternalServerError, "query failed")
					return
				}
				writeJSON(w, http.StatusOK, signals)
			})
			r.Get("/signals/stats", func(w http.ResponseWriter, req *http.Request) {
				vid, _ := strconv.ParseInt(req.URL.Query().Get("vehicle_id"), 10, 64)
				if vid == 0 {
					vid = 1
				}
				signalNames := strings.Split(req.URL.Query().Get("signals"), ",")
				from, _ := time.Parse(time.RFC3339, req.URL.Query().Get("from"))
				to, _ := time.Parse(time.RFC3339, req.URL.Query().Get("to"))
				if from.IsZero() {
					from = time.Now().UTC().Add(-1 * time.Hour)
				}
				if to.IsZero() {
					to = time.Now().UTC()
				}
				stats, err := shw.Stats(req.Context(), vid, signalNames, from, to)
				if err != nil {
					writeError(w, http.StatusInternalServerError, "query failed")
					return
				}
				writeJSON(w, http.StatusOK, stats)
			})
		}

		// Signal Catalog & Observations (cold-path, ADR-002 + ADR-009).
		// Registered before /signals/{vehicleID} so chi's trie prefers the
		// literal segment over the {vehicleID} param.
		r.Get("/signals/catalog", signalCatalogHandler.ListCatalog)
		r.Get("/signals/observations", signalCatalogHandler.ListObservations)

		// Signal routes
		r.Route("/signals/{vehicleID}", func(r chi.Router) {
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
				if opt.CacheStore != nil {
					if rdb := opt.CacheStore.Underlying(); rdb != nil {
						signalHandler.WithRedisCache(signal.NewRedisSignalCache(rdb))
					}
				}
				if store := telemetryHandler.GetLiveSignalStore(); store != nil {
					signalHandler.WithLiveSignalStore(store)
				}
				r.Get("/live", signalHandler.LiveState)
				r.Get("/snapshot", signalHandler.Snapshot)
				r.Get("/diff", signalHandler.Diff)
				r.Get("/available", signalHandler.AvailableSignals)
				r.Get("/stats", signalHandler.Stats)
				r.Get("/{signalName}/history", signalHandler.History)
			} else {
				// No telemetry handler at all — register with DB-only fallbacks
				signalHandler := NewSignalHandler(nil)
				if db != nil {
					signalHandler.WithDB(db)
				}
				if opt.CacheStore != nil {
					if rdb := opt.CacheStore.Underlying(); rdb != nil {
						signalHandler.WithRedisCache(signal.NewRedisSignalCache(rdb))
					}
				}
				r.Get("/live", signalHandler.LiveState)
				r.Get("/snapshot", signalHandler.Snapshot)
				r.Get("/diff", signalHandler.Diff)
				r.Get("/available", signalHandler.AvailableSignals)
				r.Get("/stats", signalHandler.Stats)
				r.Get("/{signalName}/history", signalHandler.History)
			}
		})

		// Data Repair
		r.Route("/data-repair", func(r chi.Router) {
			r.Use(httprate.LimitByIP(20, 1*time.Minute))
			// GET stays read-only and unguarded; every mutating route
			// below threads through RequireSudo (Phase-46 / Prompt 31).
			r.Get("/stale-sessions", dataRepairHandler.GetStaleSessions)
			r.Route("/charging/{id}", func(r chi.Router) {
				r.With(RequireSudo(sudoStore, sudoCfg)).Put("/", dataRepairHandler.UpdateCharging)
				r.With(RequireSudo(sudoStore, sudoCfg)).Post("/close", dataRepairHandler.CloseCharging)
				r.With(RequireSudo(sudoStore, sudoCfg)).Delete("/", dataRepairHandler.DeleteCharging)
			})
			r.Route("/drive/{id}", func(r chi.Router) {
				r.With(RequireSudo(sudoStore, sudoCfg)).Put("/", dataRepairHandler.UpdateDrive)
				r.With(RequireSudo(sudoStore, sudoCfg)).Post("/close", dataRepairHandler.CloseDrive)
				r.With(RequireSudo(sudoStore, sudoCfg)).Delete("/", dataRepairHandler.DeleteDrive)
			})
		})

		// Backup & Restore
		r.Route("/backup", func(r chi.Router) {
			r.Get("/configs", backupRestoreHandler.ListConfigs)
			r.Post("/configs", backupRestoreHandler.CreateConfig)
			r.Get("/configs/{configID}", backupRestoreHandler.GetConfig)
			r.Put("/configs/{configID}", backupRestoreHandler.UpdateConfig)
			// Phase-46 / Prompt 31 — destructive: requires sudo.
			r.With(RequireSudo(sudoStore, sudoCfg)).Delete("/configs/{configID}", backupRestoreHandler.DeleteConfig)
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
			r.Post("/account", exportJobHandler.SubmitAccountJob)
			// Phase-46 / Prompt 31 — destructive: a settings import
			// can overwrite live config; gate on sudo.
			r.With(RequireSudo(sudoStore, sudoCfg)).Post("/import", exportJobHandler.SubmitImportJob)
			// Bulk operations (Phase-45 / Prompt 32) — registered before
			// /{jobID} so chi matches the static `/bulk` path first.
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/bulk", exportJobHandler.BulkUpdate)
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
		v1DashboardHandler.Register(r) // /dashboard/stats ╬ô├ç├╢ NEW
		v1ChargingHandler.Register(r)  // /charging-sessions ╬ô├ç├╢ NEW (old uses /charging)
		v1ExportHandler.Register(r)    // /exports ╬ô├ç├╢ NEW (old uses /export/jobs)
		v1UserHandler.Register(r)      // /users/me ╬ô├ç├╢ NEW
		// NOTE: /vehicles conflicts with legacy vehicleHandler above; skip new vehicle handler.

		// Suppress unused warnings
		_ = vehicleSvc
		_ = v1VehicleHandler

		// Watch endpoints — lightweight API key auth for wearable devices
		r.Route("/watch", func(r chi.Router) {
			r.Use(APIKeyAuthRequired(db))
			r.Get("/summary", watchHandler.Summary)
			r.Get("/complication", watchHandler.Complication)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/command", watchHandler.Command)
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

// adminLogStreamTapState guards installAdminLogStreamTap so the global
// zerolog.Logger is teed to a LogSubscriberRegistry exactly once per
// process even when NewRouter is invoked multiple times (router tests
// run in parallel inside the same binary). The first call captures the
// pre-existing logger sink as `primary` and re-assigns the global
// log.Logger to a MultiLevelWriter; subsequent calls swap the registry
// pointer in-place via SetTarget so a fresh router still receives
// events without rebuilding the underlying tee.
var adminLogStreamTapState struct {
	mu      sync.Mutex
	primary io.Writer
	current *adminLogStreamTapForwarder
}

// adminLogStreamTapForwarder satisfies zerolog.LevelWriter by
// delegating to a swappable target registry. SetTarget is called on
// every NewRouter invocation so each router instance owns the
// registry it hands to its handler — without this, a stale registry
// from a previous test would silently swallow events.
type adminLogStreamTapForwarder struct {
	mu     sync.RWMutex
	target zerolog.LevelWriter
}

func (f *adminLogStreamTapForwarder) Write(p []byte) (int, error) {
	f.mu.RLock()
	t := f.target
	f.mu.RUnlock()
	if t == nil {
		return len(p), nil
	}
	return t.Write(p)
}

func (f *adminLogStreamTapForwarder) WriteLevel(level zerolog.Level, p []byte) (int, error) {
	f.mu.RLock()
	t := f.target
	f.mu.RUnlock()
	if t == nil {
		return len(p), nil
	}
	return t.WriteLevel(level, p)
}

func (f *adminLogStreamTapForwarder) SetTarget(t zerolog.LevelWriter) {
	f.mu.Lock()
	f.target = t
	f.mu.Unlock()
}

// installAdminLogStreamTap wires the zerolog global logger so every
// log record fans out to the supplied registry in addition to the
// configured primary sink. The first invocation chooses the primary
// sink (ConsoleWriter when TESLASYNC_DEV=true, otherwise os.Stdout)
// and rewires log.Logger via zerolog.MultiLevelWriter; subsequent
// invocations only swap the registry pointer.
func installAdminLogStreamTap(reg *platform.LogSubscriberRegistry) {
	adminLogStreamTapState.mu.Lock()
	defer adminLogStreamTapState.mu.Unlock()
	if adminLogStreamTapState.current == nil {
		var primary io.Writer = os.Stdout
		if strings.EqualFold(os.Getenv("TESLASYNC_DEV"), "true") {
			primary = zerolog.ConsoleWriter{Out: os.Stderr}
		}
		fwd := &adminLogStreamTapForwarder{target: reg}
		adminLogStreamTapState.primary = primary
		adminLogStreamTapState.current = fwd
		log.Logger = log.Logger.Output(zerolog.MultiLevelWriter(primary, fwd))
		return
	}
	adminLogStreamTapState.current.SetTarget(reg)
}
