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

	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/pquerna/otp/totp"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/automation"
	"github.com/ev-dev-labs/teslasync/internal/automation/action"

	// Phase-50 / 0001 — F0 AI-Off Contract (ADR-015). The guard
	// package is the only sanctioned mount point for /api/v1/ai/*
	// routes; tools/aivet refuses to merge a router change that
	// introduces an AI route via a bare HandlerFunc.
	"github.com/ev-dev-labs/teslasync/internal/ai/guard"

	// Phase-50 / 0009 — F8 Redaction Layer. The decorator is the
	// innermost wire-side wrap so every cloud call is sanitized
	// before audit/trace see the post-redaction text. PolicyFromContext
	// is the resolver — dispatcher.Run installs the strategy's
	// RedactionPolicy() into ctx via the redactadapter bridge.
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"

	// Phase-50 / 0002 — F1 Provider Abstraction. The registry +
	// adapters live behind the same hexagonal port so feature code
	// imports only "internal/ai/provider", never the concrete
	// adapter packages. The four concrete adapter imports below are
	// the package-init equivalents — Register() is called explicitly
	// in NewRouter so a fresh build cannot accidentally enable a
	// provider by virtue of an unintended import.
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	aianthropic "github.com/ev-dev-labs/teslasync/internal/ai/provider/anthropic"
	aimock "github.com/ev-dev-labs/teslasync/internal/ai/provider/mock"
	aiollama "github.com/ev-dev-labs/teslasync/internal/ai/provider/ollama"
	aiopenai "github.com/ev-dev-labs/teslasync/internal/ai/provider/openai"

	// Phase-50 / 0011 — U1 Chatbot LLM upgrade. The chatbot strategy +
	// the shared tool registry are constructed at boot and shared with
	// the AI chatbot HTTP handler.
	chatbotllm "github.com/ev-dev-labs/teslasync/internal/ai/strategies/chatbot-llm"
	digestnarration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/digest-narration"
	yirnarration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/yir-narration"
	anomalyexplanations "github.com/ev-dev-labs/teslasync/internal/ai/strategies/anomaly-explanations"
	nlalertbuilder "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-alert-builder"
	nlautomationbuilder "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-automation-builder"
	nlsearch "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-search"
	drivecoaching "github.com/ev-dev-labs/teslasync/internal/ai/strategies/drive-coaching"
	chargingdiagnosis "github.com/ev-dev-labs/teslasync/internal/ai/strategies/charging-diagnosis"
	raghelp "github.com/ev-dev-labs/teslasync/internal/ai/strategies/rag-help"
	nldrivesearchreplay "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-drive-search-replay"
	speedprofileinsights "github.com/ev-dev-labs/teslasync/internal/ai/strategies/speed-profile-insights"
	routeefficiencysuggestions "github.com/ev-dev-labs/teslasync/internal/ai/strategies/route-efficiency-suggestions"
	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"

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
	r.Use(PrometheusMiddleware)                  // Legacy {method,path,status} HTTP metrics (kept for back-compat dashboards)
	r.Use(MetricsMiddleware)                     // RED metrics: http_requests_total / http_request_errors_total / http_request_duration_seconds with status_class
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

	// Request body size limit (1 MB default). The vehicle photo
	// upload endpoint legitimately ships up to ~12 MB (8 MB image
	// + multipart envelope), so bypass the cap on that exact
	// path. Wrapping a wrapped MaxBytesReader can't loosen the
	// inner limit, so this MUST happen here in the global
	// middleware rather than inside the handler.
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			limit := int64(1 << 20)
			if isVehiclePhotoUploadPath(req.Method, req.URL.Path) {
				limit = 12 << 20
			}
			req.Body = http.MaxBytesReader(w, req.Body, limit)
			next.ServeHTTP(w, req)
		})
	})

	// Services
	vehicleSvc := service.NewVehicleService(db)
	energySvc := service.NewEnergyService(db)

	// Layered live-state reader (ADR-002 / ADR-007). Composes the in-process
	// L1 signal.Store + L2 Redis HSET (LiveSignalStore) with the cold-path
	// signal_log StateReader as fallback. /latest handlers and any "current
	// state" code path MUST go through this boundary so that:
	//   * fields routed to typed snapshot tables (climate, motor, tire
	//     pressure, media, security, vehicle_config, safety, etc.) are
	//     served from L1+L2 instead of returning empty maps from
	//     signal_log; and
	//   * infrequent fields like Latitude / Longitude on a parked vehicle
	//     still surface from signal_log when L1+L2 has no entry.
	// When TelemetryHandler is nil (test wiring), a NoopLiveSignalStore is
	// used so the StateReader fallback alone serves the request.
	var liveSignalStore signal.LiveSignalStore
	if opt.TelemetryHandler != nil {
		liveSignalStore = opt.TelemetryHandler.GetLiveSignalStore()
	}
	if liveSignalStore == nil {
		liveSignalStore = signal.NewNoopLiveSignalStore()
	}
	liveStateReader := signal.MustNewLiveStateReader(liveSignalStore, stateReader)

	// Handlers
	vehicleHandler := NewVehicleHandler(vehicleSvc, teslaClient, stateReader)
	driveHandler := NewDriveDetail(db, stateReader, liveStateReader)
	chargingHandler := NewChargingHandler(db, stateReader, liveStateReader)
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

	// Phase-46 / Prompt 42 — active sessions / device management.
	// TeslaSync mints its OWN per-device cookie on the first
	// authenticated request from a browser (auth.Middleware below)
	// and persists the (subject, cookie hash) tuple here so the
	// Settings page can list devices and revoke individual sessions
	// without touching the upstream IdP. The repo's HMAC signing
	// secret is freshly generated on every restart — desired
	// semantics for a "local session" primitive; operators wanting
	// cross-restart persistence already get it from the upstream IdP.
	authSessionsRepo := database.NewAuthSessionsRepo(db)
	sessionHandler := NewSessionHandler(authSessionsRepo, cfg.Auth.ForwardAuthHeader)

	// Phase-46 / Prompt 57 — Auth-mode contract.
	//
	// The auth_subjects materialisation table is the single source
	// of truth for "every distinct subject this deployment has ever
	// seen". The recorder middleware (mounted on the /api/v1 group
	// below, AFTER ForwardAuthMiddleware so the header is the
	// authoritative one) bumps last_seen_at on every request via an
	// in-process per-subject debounce so we never spam the DB.
	//
	// systemAuthModeHandler answers GET /system/auth-mode — the SPA's
	// source of truth for "what mode am I in, and who am I". Mounted
	// inside /system below; deliberately NOT sudo-gated and NOT
	// wrapped in RequireSubjectMiddleware so it stays reachable in
	// open mode AND when the upstream proxy strips the header on a
	// specific request.
	authSubjectsRepo := database.NewAuthSubjectsRepo(db)
	subjectRecorder := tsauth.NewSubjectRecorder(authSubjectsStoreAdapter{repo: authSubjectsRepo}, tsauth.SubjectRecorderOptions{})
	systemAuthModeHandler := NewSystemAuthModeHandler(cfg.Auth.ForwardAuthHeader, cfg.Auth.ProviderHint)
	_ = authSubjectsRepo // referenced via subjectRecorder; held for future per-user tables.

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

	// Phase-50 / 0001 — F0 AI-Off Contract (ADR-015).
	//
	// The guard is built once here and shared across every
	// /api/v1/ai/* route so the per-request feature-gate logic
	// (mode != "off" AND feature toggle on) lives in exactly one
	// place. Settings is the same SettingsRepo the rest of the
	// app uses; the AIMode/AIFeatureEnabled methods on it are
	// fail-closed (return "off"/false on any error).
	aiSettingsRepo := database.NewSettingsRepo(db)
	aiGuard := guard.New(aiSettingsRepo)

	// Phase-50 / 0002 — F1 Provider Abstraction.
	//
	// The provider registry composes adapter factories with the
	// standard decorator chain (currently only OTel WithTrace; F3
	// adds audit, F8 adds redaction, F9 adds rate/cost cap). The
	// registry reads settings on every For() call so a Settings
	// save takes effect on the next request without restart.
	//
	// SettingsReader is satisfied by aiSettingsReader below — the
	// existing *database.SettingsRepo already implements
	// AIMode + AIFeatureEnabled but does not yet expose a typed
	// AIProviderConfig accessor; the inline adapter pulls the
	// JSONB column out of Get() so F1 does not have to mutate
	// the repo (R5 mitigation — keep settings repo single-purpose).
	//
	// Phase-50 / 0004 — F3 inserts the audit decorator into the
	// chain. The async writer wraps the AICallLogRepo (which
	// satisfies provider.AuditSink) and survives for the lifetime
	// of the process; a buffer of 1024 absorbs short bursts and
	// drops the oldest entry on overflow with a Prometheus counter.
	aiCallLogRepo := database.NewAICallLogRepo(db)
	aiAuditWriter := provider.NewAsyncAuditWriter(context.Background(), aiCallLogRepo, 1024)
	aiRegistry := provider.NewRegistry(
		aiSettingsReader{repo: aiSettingsRepo},
		// Phase-50 / 0009 — F8 redaction sits INNERMOST in the
		// chain: WithRedaction is applied first so audit/trace
		// (above it in source order, outer at runtime) observe
		// the post-redaction request text. The resolver
		// (redact.PolicyFromContext) reads the per-request policy
		// installed by dispatch.Run from Strategy.RedactionPolicy().
		// A missing policy means deny-all — see redact.DefaultPolicy.
		provider.WithRedaction(redact.PolicyFromContext),
		provider.WithAudit(aiAuditWriter),
		provider.WithTrace,
	)
	aiRegistry.Register(provider.NameOllama, aiollama.Builder)
	aiRegistry.Register(provider.NameOpenAI, aiopenai.Builder)
	aiRegistry.Register(provider.NameAnthropic, aianthropic.Builder)
	// The mock adapter is registered so ops + the F6 eval harness
	// can pin "default": "mock" in settings to short-circuit a
	// flaky upstream during incident response. ADR-015 §I1 still
	// applies — the mock builder is unreachable in off mode.
	aiRegistry.Register(provider.NameMock, func(cfg provider.ProviderConfig) (provider.Provider, error) {
		return aimock.New(provider.Capabilities{
			Tools: true, Streaming: true, Embeddings: true, MaxContext: 4096,
		}), nil
	})
	// Phase-46 / Prompt 36 — settings export/import. The serializer
	// fans out across four repos (settings, alert_rules, geofences,
	// notification_quiet_hours); construct it once + share between
	// the export + import handlers so future repos can be added in a
	// single place. Apply is sudo-gated by RequireSudo on the import
	// route below; export is read-only and runs unguarded.
	settingsSerializer := database.NewSettingsSerializer(
		database.NewSettingsRepo(db),
		database.NewAlertRuleRepo(db),
		database.NewGeofenceRepo(db),
		database.NewQuietHoursRepo(db),
	)
	settingsExportHandler := NewSettingsExportHandler(settingsSerializer, cfg.Auth.ForwardAuthHeader)
	settingsImportHandler := NewSettingsImportHandler(settingsSerializer, cfg.Auth.ForwardAuthHeader)
	// Phase-46 / Prompt 50 — per-section + global "Reset to defaults".
	// Sudo-gated at the route below so the SPA's <ReauthDialog>
	// always pops on the danger-zone "Reset ALL settings" button.
	settingsResetRepo := database.NewSettingsResetRepo(db)
	settingsResetHandler := NewSettingsResetHandler(settingsResetRepo, cfg.Auth.ForwardAuthHeader)
	// Phase-46 / Prompt 65 — recurring scheduled exports.
	//
	// Owner identity comes from the configured FORWARD_AUTH_HEADER on
	// every read/write — the handler NEVER trusts owner_subject in the
	// request body. The repo's per-row UPDATE/DELETE statements scope
	// by (id, owner_subject) so cross-user mutations collapse to 404.
	scheduledExportRepo := database.NewScheduledExportRepo(db)
	scheduledExportsHandler := NewScheduledExportsHandler(scheduledExportRepo, cfg.Auth.ForwardAuthHeader, nil)
	// Phase-46 / Prompt 43 — per-vehicle settings layer.
	//
	// The resolver layers vehicle-scoped overrides on top of the
	// existing install-global SettingsRepo and the vehicles base
	// table. Construct here so the same SettingsRepo + VehicleRepo
	// instances back both the global settings handler above and
	// the per-vehicle resolver below.
	vehicleSettingsRepo := database.NewVehicleSettingsRepo(db)
	vehicleSettingsRepoForRouter := database.NewVehicleRepo(db)
	vehicleSettingsResolver := database.NewVehicleSettingsResolver(
		vehicleSettingsRepo,
		database.NewVehicleNameLookup(vehicleSettingsRepoForRouter),
		database.NewUserSettingsLookup(database.NewSettingsRepo(db)),
	)
	vehicleSettingsHandler := NewVehicleSettingsHandler(
		vehicleSettingsRepo,
		vehicleSettingsResolver,
		NewVehicleExistenceChecker(vehicleSettingsRepoForRouter),
	)

	// Phase-46 / Prompt 54 — vehicle photo upload. The handler
	// owns the on-disk write/read pipeline plus the per-vehicle
	// upload mutex; the repo is a thin SQL facade that persists
	// the rendered paths in vehicle_photos.
	vehiclePhotoRepo := database.NewVehiclePhotoRepo(db)
	vehiclePhotoHandler := NewVehiclePhotoHandler(
		vehiclePhotoRepo,
		NewVehicleExistenceChecker(vehicleSettingsRepoForRouter),
		cfg.VehiclePhotoDir,
	)

	// Phase-46 / Prompt 44 — RBAC matrix admin handler.
	// Matrix bindings live in role_permissions; permissions are a
	// hand-maintained catalog in internal/auth. The handler is
	// auth-mode aware (501 AUTH_MODE_OPEN in open mode) and the PUT
	// route is wrapped in RequireSudo below.
	rolePermissionsRepo := database.NewRolePermissionsRepo(db)
	rbacHandler := NewRBACHandler(rolePermissionsRepo, cfg.Auth.ForwardAuthHeader)

	// Phase-46 / Prompt 46 — admin impersonation. The store mints
	// HMAC-signed cookies (15-min TTL) carrying the original-admin /
	// target pair; the middleware mounted further down rewrites the
	// principal header so downstream handlers see the impersonation
	// target as the request principal. The audit repo doubles as the
	// candidates store via its ListDistinctActiveSubjects helper —
	// see audit_repo.go for the rationale on co-locating that query.
	auditRepo := database.NewAuditRepoWithDB(db)
	impersonationStore := tsauth.MustNewImpersonationStore()
	impersonationHandler := NewImpersonationHandler(
		impersonationStore,
		auditRepo,
		auditRepo,
		cfg.Auth.ForwardAuthHeader,
	)

	dashboardLayoutHandler := NewDashboardLayoutHandler(db)
	chartAnnotationHandler := NewChartAnnotationHandler(db)
	pinnedHandler := NewPinnedHandler(db)
	savedViewsHandler := NewSavedViewsHandler(db, cfg.Auth.ForwardAuthHeader)
	pushHandler := NewPushHandler(db, webpush.Default(), cfg.Auth.ForwardAuthHeader)
	var pahoForAlerts pahomqtt.Client
	if mqttClient != nil {
		pahoForAlerts = mqttClient.Underlying()
	}
	// alertLiveSignalStore is the same concrete store as liveSignalStore
	// (above) when TelemetryHandler is set; we keep the local for clarity
	// at the AlertHandler call site, which has its own narrow contract.
	alertLiveSignalStore := liveSignalStore
	alertHandler := NewAlertHandler(db, eventHub, pahoForAlerts, alertLiveSignalStore)
	alertMessageHandler := NewAlertMessageHandler()
	commandHandler := NewCommandHandler(db, teslaClient)
	guardHandler := NewGuardHandler(database.NewGuardRepo(db.Pool), database.NewVehicleRepo(db), teslaClient, cfg)
	energyHandler := NewEnergyHandler(energySvc)
	signalLogReader := database.NewSignalLogReader(db)
	batteryHandler := NewBatteryHandler(db, stateReader)
	analyticsHandler := NewAnalyticsHandler(db, stateReader)
	notificationHandler := NewNotificationHandler(db)
	notificationChannelHandler := NewNotificationChannelHandler(db)
	notifScheduleHandler := NewNotificationScheduleHandler(db)
	quietHoursHandler := NewQuietHoursHandler(database.NewQuietHoursRepo(db), cfg)
	chatbotHandler := NewChatbotHandler(db, vehicleSvc, stateReader, liveStateReader)

	// Phase-50 / 0011 — U1 Chatbot LLM upgrade. Construct the
	// shared tool registry + the chatbot strategy + the AI HTTP
	// handler. The tool registry is process-wide (one per boot)
	// and shared across every future AI feature handler; the
	// strategy is per-feature and is paired with the dispatcher
	// inside the AI handler.
	//
	// Sources are the existing typed repos. ai/tools.VehicleStateSource
	// expects SignalAt(...) (any, error); signal.StateReader returns
	// (signal.SignalValue, error) and signal.SignalValue is a defined
	// type whose underlying type is any — Go interface satisfaction is
	// by identity, so a small wrapping adapter (aiToolsStateAdapter
	// below) bridges the two without leaking types across packages.
	aiToolRegistry := tools.NewRegistry()
	tools.Register12Builtins(aiToolRegistry, tools.Sources{
		Vehicles:      database.NewVehicleRepo(db),
		VehicleState:  aiToolsStateAdapter{r: stateReader},
		Drives:        database.NewDriveRepo(db),
		Charges:       database.NewChargingRepo(db),
		AlertRules:    database.NewAlertRuleRepo(db),
		Notifications: database.NewNotificationRepo(db),
		Geofences:     database.NewGeofenceRepo(db),
		Efficiency:    database.NewDriveRepo(db),
	})
	// Phase-50 / U2 (slice 0012) — register the digest-narration
	// slice's read-only tool on the SAME process-wide registry so
	// the dispatcher can resolve `query_weekly_digest_context` for
	// the digest-narration strategy. Register12Builtins must run
	// FIRST so the BuiltinNames-pin test continues to see the 12
	// canonical builtins; this call extends the registry beyond
	// that pinned set.
	tools.RegisterDigestTools(aiToolRegistry, tools.DigestSources{
		Drives:  database.NewDriveRepo(db),
		Charges: database.NewChargingRepo(db),
	})
	// Phase-50 / U3 (slice 0013) — register the yir-narration
	// slice's read-only tool on the SAME process-wide registry so
	// the dispatcher can resolve `query_year_in_review_context`
	// for the yir-narration strategy. Same ordering rule: the
	// builtins + digest tools above must register first so the
	// pin tests continue to see the canonical sets unchanged.
	tools.RegisterYearReviewTools(aiToolRegistry, tools.YearReviewSources{
		Drives:  database.NewDriveRepo(db),
		Charges: database.NewChargingRepo(db),
	})
	aiChatbotHandler := NewAIChatbotHandler(
		database.NewChatRepo(db),
		aiRegistry,
		aiToolRegistry,
		chatbotllm.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Phase-50 / U2 (slice 0012) — Weekly digest narration handler.
	// One per process; stateless beyond constructor inputs.
	aiDigestHandler := NewAIDigestHandler(
		aiRegistry,
		aiToolRegistry,
		digestnarration.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Phase-50 / U3 (slice 0013) — Year-in-review narration handler.
	// One per process; stateless beyond constructor inputs.
	aiYIRHandler := NewAIYearReviewHandler(
		aiRegistry,
		aiToolRegistry,
		yirnarration.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	tirePressureHandler := NewTirePressureHandler(stateReader, liveStateReader)
	motorHandler := NewMotorHandler(stateReader, liveStateReader)
	driveDynamicsHandler := NewDriveDynamicsHandler(stateReader, liveStateReader)
	climateHandler := NewClimateHandler(stateReader, liveStateReader)
	securityHandler := NewSecurityHandler(stateReader, liveStateReader)
	chargingTelemetryHandler := NewChargingTelemetryHandler(stateReader, liveStateReader)
	mediaHandler := NewMediaHandler(stateReader, liveStateReader)
	vehicleConfigHandler := NewVehicleConfigHandler(stateReader, liveStateReader)
	locationSnapshotHandler := NewLocationSnapshotHandler(stateReader, liveStateReader)
	safetyHandler := NewSafetyHandler(stateReader, liveStateReader)
	userPreferenceHandler := NewUserPreferenceHandler(stateReader, liveStateReader)
	softwareUpdateHandler := NewSoftwareUpdateHandler(db)
	tcoHandler := NewTCOHandler(db)
	sleepHandler := NewSleepHandler(db)
	// Phase-42 (prompt 0077): VampireDrainHandler deleted (vampire_drain_events).
	visitedLocationHandler := NewVisitedLocationHandler(db)
	// Phase-42 (prompt 0077): MileageHandler deleted (daily_mileage); TCO derives
	// distance via SUM(distance_m) FROM drives.
	tripHandler := NewTripHandler(db)
	// Phase-42 (prompt 0077): VehicleStateHandler deleted (vehicle_states);
	// current state is sourced from fsm_transitions / signal.StateReader.
	backupHandler := NewBackupHandler(db)
	backupRestoreHandler := NewBackupRestoreHandler(db)
	regenHandler := NewRegenHandler(db)
	batteryDegradationHandler := NewBatteryDegradationHandler(db, stateReader, signalLogReader)
	auditHandler := NewAuditHandler(db, cfg.Auth.ForwardAuthHeader)
	apiCallLogHandler := NewAPICallLogHandler(db)
	apiKeyHandler := NewAPIKeyHandler(db, cfg.Auth.ForwardAuthHeader)
	// Phase-42 (prompt 0077): SignalCatalogHandler deleted (signal_catalog +
	// signal_observations); the typed signal_log pipeline (000167+) is the
	// authoritative catalog/observation surface.
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
	// Phase-50 / U4 (slice 0014) — register the anomaly-explanations
	// slice's read-only tool on the SAME process-wide registry so
	// the dispatcher can resolve `query_anomaly_context` for the
	// anomaly-explanations strategy. Must register AFTER
	// Register12Builtins + RegisterDigestTools + RegisterYearReviewTools
	// so the BuiltinNames-pin test continues to see the canonical
	// builtins; this call extends the registry beyond the pinned set.
	// AnomalyHandler implements aitools.AnomalySource via
	// (*AnomalyHandler).DetectAnomalies — see anomaly_handler.go.
	tools.RegisterAnomalyTools(aiToolRegistry, tools.AnomalySources{
		Anomaly: anomalyHandler,
	})
	// Phase-50 / U4 (slice 0014) — Anomaly explanation handler.
	// One per process; stateless beyond constructor inputs. Must
	// be constructed AFTER the tool registration above so the
	// dispatcher can resolve the strategy's allowedTools at boot.
	aiAnomalyHandler := NewAIAnomalyHandler(
		aiRegistry,
		aiToolRegistry,
		anomalyexplanations.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Phase-50 / N1 (slice 0015) — Natural-language alert builder.
	// Register the slice's PROPOSE-only typed tools on the SAME
	// process-wide registry so the dispatcher can resolve
	// `draft_alert_rule` + `validate_alert_rule` for the
	// nl-alert-builder strategy. Registered AFTER
	// RegisterAnomalyTools so the registry's alphabetical Names
	// list grows deterministically.
	//
	// AIAlertRuleValidator is a thin wrapper around the unexported
	// validateAlertRule function in alert_handler_rules.go — same
	// code path the canonical POST /api/v1/alerts/rules handler
	// uses. Drafts accepted by the AI tool are byte-equivalent to
	// drafts accepted by the canonical handler (ADR-015 §I3
	// baseline-intact).
	tools.RegisterAlertBuilderTools(aiToolRegistry, tools.AlertBuilderSources{
		Validator: NewAIAlertRuleValidator(),
	})
	aiAlertHandler := NewAIAlertHandler(
		aiRegistry,
		aiToolRegistry,
		nlalertbuilder.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Phase-50 / N2 (slice 0016) nl-automation-builder. Mirrors the
	// alert-builder wiring above. AIAutomationGraphValidator is a
	// thin wrapper around the unexported decodeAutomationInputDTO
	// function in automation_handler_decode.go — same code path the
	// canonical POST /api/v1/automations handler uses. Drafts
	// accepted by the AI tool are byte-equivalent to drafts accepted
	// by the canonical handler (ADR-015 §I3 baseline-intact).
	tools.RegisterAutomationBuilderTools(aiToolRegistry, tools.AutomationBuilderSources{
		Validator: NewAIAutomationGraphValidator(),
	})
	aiAutomationHandler := NewAIAutomationHandler(
		aiRegistry,
		aiToolRegistry,
		nlautomationbuilder.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Phase-50 / N3 (slice 0017) nl-search. Mirrors the
	// alert-builder / automation-builder wiring above. The
	// retriever is constructed via rag.New (the F7 single
	// retrieval entry point) which fail-closes to NoopRetriever
	// when ai_mode='off' (ADR-015 §I1, §I4 — zero outbound egress
	// in off mode). The Hydrator is the in-package adapter
	// aiSearchHydrator, which delegates per-source-type lookups
	// to the existing canonical pgSearcher — same code path the
	// typed GET /api/v1/search baseline uses (ADR-015 §I3
	// baseline-intact: no duplicate read path is introduced by
	// this slice).
	aiSearchRetriever, err := rag.New(
		context.Background(),
		aiSettingsRepo,
		db,
		aiRegistry,
		nlsearch.FeatureID,
		rag.ModelNomicEmbedText,
	)
	if err != nil {
		// rag.New only returns a non-nil error when ai_mode is on
		// AND the model is unknown / db is nil / resolver is nil.
		// In our wiring all three are valid and the model is
		// hard-coded to a known constant; an error here is a boot-
		// time misconfiguration we should fail loudly on rather
		// than silently boot with a half-wired AI search surface.
		log.Fatal().Err(err).Msg("ai search: rag.New failed during boot wiring")
	}
	tools.RegisterSearchTools(aiToolRegistry, tools.SearchSources{
		Retriever: aiSearchRetriever,
		Hydrator:  newAISearchHydrator(newPGSearcher(db)),
	})
	aiSearchHandler := NewAISearchHandler(
		aiRegistry,
		aiToolRegistry,
		nlsearch.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Phase-50 / N4 (slice 0018) — Per-drive coaching narrative.
	// Register the slice's read-only tool on the SAME process-wide
	// registry so the dispatcher can resolve
	// `query_drive_telemetry_summary` for the drive-coaching
	// strategy. Same ordering rule: builtins + digest + yir +
	// anomaly + alert + automation + search tools above must
	// register first so the alphabetical Names list grows
	// deterministically (the new tool sorts AFTER
	// `query_drive_detail` / `query_drives_recent` /
	// `query_anomaly_context` / `query_year_in_review_context`).
	tools.RegisterDriveCoachingTools(aiToolRegistry, tools.DriveCoachingSources{
		Drives: database.NewDriveRepo(db),
	})
	// Per-drive coaching handler. One per process; stateless beyond
	// constructor inputs. Must be constructed AFTER the tool
	// registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiDriveCoachHandler := NewAIDriveCoachHandler(
		aiRegistry,
		aiToolRegistry,
		drivecoaching.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// charging-diagnosis tools (Phase-50 / N5, slice 0019). Adds
	// `query_charge_session` + `query_charging_aggregation` to the
	// shared tool registry so the dispatcher can resolve them for
	// the charging-diagnosis strategy. Same ordering rule as the
	// other slice tools above: must be registered before the
	// handler constructor below so the strategy's allowedTools
	// resolve at boot.
	tools.RegisterChargingDiagnosisTools(aiToolRegistry, tools.ChargingDiagnosisSources{
		Charges: database.NewChargingRepo(db),
	})
	// Per-charging-session diagnosis handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiChargingDiagnosisHandler := NewAIChargingDiagnosisHandler(
		aiRegistry,
		aiToolRegistry,
		chargingdiagnosis.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Phase-50 / N6 (slice 0020) — RAG-backed app help.
	//
	// Reuse the F7 retriever pattern from nl-search: rag.New
	// returns a NoopRetriever when ai_mode='off' so retrieve_docs
	// returns ([], nil) without touching the embedding API or the
	// vector DB (ADR-015 §I1, §I4 — zero outbound egress in off
	// mode). The retriever is wired against the rag-help feature
	// id so the per-feature settings resolution path is honoured.
	//
	// The help corpus is GLOBAL: retrieve_docs passes
	// user_subject="" to the retriever (see
	// internal/ai/tools/help.go), matching the F7 docs_indexer's
	// userSubject="" convention. Today only the docs corpus has a
	// production indexer (the F7 docs_indexer); the runbooks +
	// i18n corpora are populated by the gated background job
	// `ai_docs_indexer` (registered in features.Registry; today a
	// fail-closed gate stub awaiting a future fan-out slice).
	aiRagHelpRetriever, err := rag.New(
		context.Background(),
		aiSettingsRepo,
		db,
		aiRegistry,
		raghelp.FeatureID,
		rag.ModelNomicEmbedText,
	)
	if err != nil {
		log.Fatal().Err(err).Msg("ai rag-help: rag.New failed during boot wiring")
	}
	// rag-help tools (Phase-50 / N6, slice 0020). Adds
	// `retrieve_docs` + `cite_help_chunk` to the shared tool
	// registry so the dispatcher can resolve them for the rag-help
	// strategy. Same ordering rule as the other slice tools above:
	// must be registered before the handler constructor below so
	// the strategy's allowedTools resolve at boot.
	tools.RegisterHelpTools(aiToolRegistry, tools.HelpSources{
		Retriever: aiRagHelpRetriever,
	})
	// RAG-backed app help handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiRagHelpHandler := NewAIRAGHelpHandler(
		aiRegistry,
		aiToolRegistry,
		raghelp.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Phase-50 / D1 (slice 0021) — Natural-language drive search and
	// replay.
	//
	// Reuse the F7 retriever pattern from nl-search / rag-help:
	// rag.New returns a NoopRetriever when ai_mode='off' so
	// retrieve_drive_chunks returns ([], nil) without touching the
	// embedding API or the vector DB (ADR-015 §I1, §I4 — zero
	// outbound egress in off mode). The retriever is wired against
	// the nl-drive-search-replay feature id so the per-feature
	// settings resolution path is honoured.
	//
	// The drive corpus is per-user: retrieve_drive_chunks passes
	// the calling user_subject from ctx to the retriever (the F7
	// retriever scopes by user_subject at the SQL boundary). The
	// drive_summary corpus is populated today; route_segment +
	// location_summary are forward-compat reservations per the
	// slice prompt — the gated background job `ai_drive_indexer`
	// is the future fan-out point and is registered in
	// features.Registry as a fail-closed gate stub today.
	aiDriveSearchRetriever, err := rag.New(
		context.Background(),
		aiSettingsRepo,
		db,
		aiRegistry,
		nldrivesearchreplay.FeatureID,
		rag.ModelNomicEmbedText,
	)
	if err != nil {
		log.Fatal().Err(err).Msg("ai drive search: rag.New failed during boot wiring")
	}
	// nl-drive-search-replay tools (Phase-50 / D1, slice 0021).
	// Adds `retrieve_drive_chunks` + `hydrate_drive_replay` to the
	// shared tool registry so the dispatcher can resolve them for
	// the nl-drive-search-replay strategy. Same ordering rule as
	// the other slice tools above: must be registered before the
	// handler constructor below so the strategy's allowedTools
	// resolve at boot. The Hydrator is the in-package adapter
	// aiDriveSearchHydrator, which delegates per-source-type
	// lookups to the existing canonical pgSearcher — same code
	// path the typed GET /api/v1/search baseline uses (ADR-015 §I3
	// baseline-intact: no duplicate read path is introduced by
	// this slice).
	tools.RegisterDriveSearchTools(aiToolRegistry, tools.DriveSearchSources{
		Retriever: aiDriveSearchRetriever,
		Hydrator:  newAIDriveSearchHydrator(newPGSearcher(db)),
	})
	// Natural-language drive search and replay handler. One per
	// process; stateless beyond constructor inputs. Must be
	// constructed AFTER the tool registration above so the
	// dispatcher can resolve the strategy's allowedTools at boot.
	aiDriveSearchHandler := NewAIDriveSearchHandler(
		aiRegistry,
		aiToolRegistry,
		nldrivesearchreplay.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Phase-50 / D2 (slice 0022) — Speed-profile insights.
	// Register the slice's two read-only tools on the SAME
	// process-wide registry so the dispatcher can resolve
	// `query_speed_profile` + `query_drive_context` for the
	// speed-profile-insights strategy. Same ordering rule as the
	// other slice tools above: must be registered before the
	// handler constructor below so the strategy's allowedTools
	// resolve at boot. Both tools call DriveRepo.GetByID and
	// derive their envelopes in-memory; no new SQL is written by
	// this slice.
	tools.RegisterSpeedProfileInsightsTools(aiToolRegistry, tools.SpeedProfileInsightsSources{
		Drives: database.NewDriveRepo(db),
	})
	// Per-drive speed-profile insights handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiSpeedProfileInsightsHandler := NewAISpeedProfileInsightsHandler(
		aiRegistry,
		aiToolRegistry,
		speedprofileinsights.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Phase-50 / D3 (slice 0023) — Route-efficiency suggestions.
	// Build the per-feature F7 retriever scoped to the
	// route-efficiency-suggestions feature id. The retriever
	// embeds queries with the local nomic-embed-text model and
	// fans out across the user_subject's chunks in `signal_log`
	// (the embedding store; the retriever scopes by user_subject
	// at the SQL boundary). Only the drive_summary corpus is
	// populated today; route_efficiency + weather_context are
	// forward-compat reservations per the slice prompt — the
	// gated background job `ai_route_indexer` is the future
	// fan-out point and is registered in features.Registry as a
	// fail-closed gate stub today.
	aiRouteEfficiencyRetriever, err := rag.New(
		context.Background(),
		aiSettingsRepo,
		db,
		aiRegistry,
		routeefficiencysuggestions.FeatureID,
		rag.ModelNomicEmbedText,
	)
	if err != nil {
		log.Fatal().Err(err).Msg("ai route-efficiency suggestions: rag.New failed during boot wiring")
	}
	// route-efficiency-suggestions tools (Phase-50 / D3, slice 0023).
	// Adds `retrieve_route_chunks` + `query_route_efficiency` to
	// the shared tool registry so the dispatcher can resolve them
	// for the route-efficiency-suggestions strategy. Same ordering
	// rule as the other slice tools above: must be registered
	// before the handler constructor below so the strategy's
	// allowedTools resolve at boot. query_route_efficiency calls
	// DriveRepo.GetByVehicle and derives the per-route aggregates
	// in-memory mirroring the deterministic
	// /api/v1/analytics/route-efficiency baseline shape — no new
	// SQL is written by this slice.
	tools.RegisterRouteEfficiencySuggestionsTools(aiToolRegistry, tools.RouteEfficiencySuggestionsSources{
		Retriever: aiRouteEfficiencyRetriever,
		Drives:    database.NewDriveRepo(db),
	})
	// Route-efficiency-suggestions handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiRouteEfficiencySuggestionsHandler := NewAIRouteEfficiencySuggestionsHandler(
		aiRegistry,
		aiToolRegistry,
		routeefficiencysuggestions.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	lifetimeHandler := NewLifetimeHandler(db, eventHub)
	yearReviewHandler := NewYearReviewHandler(db)
	chargePlannerHandler := NewChargePlannerHandler(db, teslaClient, cfg, stateReader)
	energyFlowHandler := NewEnergyFlowHandler(db, stateReader, liveStateReader)
	weeklyDigestHandler := NewWeeklyDigestHandler(db)
	teslaChargingHistoryHandler := NewTeslaChargingHistoryHandler(teslaClient, db)
	teslaChargingSessionHandler := NewTeslaChargingSessionHandler(teslaClient, db)
	teslaEnergyHistoryHandler := NewTeslaEnergyHistoryHandler(teslaClient, db)
	teslaEnergyLiveStatusHandler := NewTeslaEnergyLiveStatusHandler(teslaClient, db)
	energySiteHandler := NewEnergySiteHandler(teslaClient, db)
	fleetTelemetryErrorHandler := NewFleetTelemetryErrorHandler(teslaClient, db)
	// Phase-43a/0002 — wire the package-derived Fleet Telemetry coverage
	// handler authored by Phase-42 prompt 0068. It is intentionally
	// DB-free: the routing snapshot comes from the embedded routing.yaml
	// via router.LoadMap() and the subscription view comes from
	// teslaconfig.Builder. The handler is mounted inside the existing
	// /tesla/fleet-telemetry route block below.
	fleetTelemetryHandler := NewFleetTelemetryHandler(cfg)
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

	// Wire Redis signal cache to handlers that read live vehicle state.
	// driveHandler + chargingHandler now read live state via the
	// LiveStateReader boundary (composed once at the top of NewRouter), so
	// they no longer need a direct Redis cache injection. The remaining
	// handlers in this block still read raw Redis for their own narrow
	// purposes (wake state, command pre-checks, watch streams, range
	// projection short-cuts, signal-key listing) and keep the legacy
	// fluent setter until they migrate to LiveStateReader.
	if opt.CacheStore != nil {
		if rdb := opt.CacheStore.Underlying(); rdb != nil {
			redisSignalCache := signal.NewRedisSignalCache(rdb)
			maintenanceHandler.WithRedisCache(redisSignalCache)
			commandHandler.WithRedisCache(redisSignalCache)
			watchHandler.WithRedisCache(redisSignalCache)
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

	// Phase-46 / Prompt 40 — rate-limit status counters. Construct two
	// sliding-window observers (one for every /api/v1 request, one
	// scoped to writes only) and a handler that joins them with the
	// Tesla client's bucket snapshot. Counters are attached as plain
	// chi middleware below; the GET /system/rate-limits route reads
	// from them on demand.
	apiRequestCounter := platform.NewWindowCounter()
	apiWriteCounter := platform.NewWindowCounter()
	rateLimitHandler := NewRateLimitHandler(RateLimitHandlerConfig{
		TeslaClient:  teslaClient,
		APICounter:   apiRequestCounter,
		WriteCounter: apiWriteCounter,
	})

	// Phase-46 / Prompt 41 — worker heartbeat store powering the
	// /system/queues panel. Backed by Redis when available so
	// every worker process can write its heartbeat to the same
	// snapshot the API server reads. Falls back to an in-memory
	// store when Redis is disabled — the panel will then report
	// every worker as "down (no heartbeat)" which honestly
	// reflects the deployment state rather than fabricating an
	// "ok" reading.
	var queueHeartbeatStore database.WorkerStatusStore
	if opt.CacheStore != nil {
		if rdb := opt.CacheStore.Underlying(); rdb != nil {
			queueHeartbeatStore = database.NewRedisWorkerStatusStore(rdb)
		}
	}
	if queueHeartbeatStore == nil {
		queueHeartbeatStore = database.NewMemoryWorkerStatusStore()
	}

	// API v1 routes
	r.Route("/api/v1", func(r chi.Router) {
		// Phase-46 / Prompt 40 — count every /api/v1 request and every
		// write-method request before any rate-limit middleware so the
		// status panel reflects raw load even when downstream limiters
		// are rejecting traffic. Mounted BEFORE APICallLog so a panic
		// inside log persistence doesn't leak counter state.
		r.Use(apiRequestCounter.Middleware(nil))
		r.Use(apiWriteCounter.Middleware(platform.WriteMethodFilter()))

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

		// Phase-46 / Prompt 57 — Subject recorder. MUST run AFTER
		// ForwardAuthMiddleware (so the principal header is the
		// authoritative one for this request) and BEFORE both the
		// session tracker and the impersonation rewrite (so the
		// recorded subject is the *original* admin identity even
		// during an active impersonation, matching the contract that
		// auth_subjects materialises every distinct human operator
		// who has touched the API). Open mode is a passthrough.
		r.Use(tsauth.SubjectRecorderMiddleware(cfg.Auth.ForwardAuthHeader, subjectRecorder))

		// Phase-46 / Prompt 42 — Session tracker. MUST run AFTER
		// ForwardAuthMiddleware so the principal header is guaranteed
		// present. Mints + binds a TeslaSync-issued cookie on the first
		// authenticated request, validates it on every subsequent one,
		// and rejects revoked cookies with 401 + clear-cookie. Open mode
		// (no FORWARD_AUTH_HEADER configured) is a passthrough.
		r.Use(tsauth.Middleware(cfg.Auth.ForwardAuthHeader, authSessionsRepo, tsauth.SessionTrackerOptions{}))

		// Phase-46 / Prompt 46 — Impersonation middleware. MUST run
		// AFTER the session tracker so the tracker pins the cookie to
		// the actual admin identity (not the rewritten target). The
		// middleware verifies the HMAC-signed impersonation cookie,
		// re-binds it against the live admin subject, and rewrites the
		// FORWARD_AUTH header to the impersonation target so all
		// downstream handlers transparently "see what the target sees".
		// Open mode is a passthrough.
		r.Use(tsauth.ImpersonationMiddleware(cfg.Auth.ForwardAuthHeader, impersonationStore))

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
			// Phase-46 / Prompt 46 — Blocked during impersonation so
			// an admin cannot accidentally disconnect the target's
			// Tesla account; the original admin must end impersonation
			// first.
			r.With(tsauth.RequireNotImpersonating(), RequireSudo(sudoStore, sudoCfg)).Post("/disconnect", authHandler.Disconnect)
			// Phase-46 / Prompt 31 — Sudo step-up reauth. POST a
			// password OR totp_code to mint a 5-minute X-Sudo-Token
			// the SPA echoes on subsequent destructive requests. In
			// open mode this returns 200 mode="open" without minting
			// anything; the dialog falls back to typed-confirmation.
			// Phase-46 / Prompt 46 — Blocked during impersonation so
			// no fresh sudo tokens can be minted under the target's
			// rewritten principal. Existing tokens won't validate
			// either (token subject != rewritten subject), so this is
			// belt-and-suspenders.
			r.With(tsauth.RequireNotImpersonating()).Post("/reauth", sudoHandler.Reauth)
			// Phase-46 / Prompt 35 — per-user TOTP enrollment.
			// /totp                              GET    status pill backing
			// /totp/enroll                       POST   start enrollment
			// /totp/verify                       POST   confirm enrollment
			// /totp/sudo                         POST   mint sudo token via per-user TOTP
			// /totp                              DELETE revoke (sudo-gated)
			// /totp/backup-codes/regenerate      POST   rotate backup codes (sudo-gated)
			//
			// Phase-46 / Prompt 46 — The entire /totp subtree is
			// blocked during impersonation. Enrollment, verification,
			// and sudo-token mints all read the principal from the
			// (rewritten) header and would otherwise act as the target.
			r.Route("/totp", func(r chi.Router) {
				r.Use(tsauth.RequireNotImpersonating())
				r.Get("/", totpHandler.GetStatus)
				r.Post("/enroll", totpHandler.Enroll)
				r.Post("/verify", totpHandler.Verify)
				r.Post("/sudo", totpHandler.VerifySudo)
				r.With(RequireSudo(sudoStore, sudoCfg)).Delete("/", totpHandler.Revoke)
				r.With(RequireSudo(sudoStore, sudoCfg)).Post("/backup-codes/regenerate", totpHandler.RegenerateBackupCodes)
			})
			// Phase-46 / Prompt 42 — Active sessions / device
			// management. List is read-only; both DELETE routes are
			// sudo-gated (RequireSudo is a passthrough in open mode,
			// so the handler's own AUTH_MODE_OPEN check is what
			// guards the resource semantics there).
			//
			// Phase-46 / Prompt 46 — DELETEs are blocked during
			// impersonation so an admin cannot revoke the target's
			// real sessions. List is allowed because it's read-only
			// and reflects what the target sees, which is exactly the
			// "see what they see" contract.
			r.Route("/sessions", func(r chi.Router) {
				r.Get("/", sessionHandler.List)
				// `all-others` MUST be registered BEFORE `/{id}` so chi
				// doesn't bind the literal as a UUID param.
				r.With(tsauth.RequireNotImpersonating(), RequireSudo(sudoStore, sudoCfg)).Delete("/all-others", sessionHandler.RevokeAllOthers)
				r.With(tsauth.RequireNotImpersonating(), RequireSudo(sudoStore, sudoCfg)).Delete("/{id}", sessionHandler.Revoke)
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

				// Phase-43a / Prompt 0006 — /guard endpoints restored.
				// Status + Events are read-only and rate-limit-free
				// (the SPA polls these from the dashboard). Acknowledge
				// is a soft mark-read with per-IP rate-limit at 60/min
				// matching every other vehicle-scoped POST. Panic is
				// destructive (wakes the car, sounds horn, costs energy)
				// and is sudo-gated + tightly rate-limited at 5/min.
				r.Route("/guard", func(r chi.Router) {
					r.Get("/", guardHandler.Status)
					r.Get("/events", guardHandler.Events)
					r.With(httprate.LimitByIP(60, 1*time.Minute)).Post("/events/{eventID}/acknowledge", guardHandler.Acknowledge)
					r.With(httprate.LimitByIP(5, 1*time.Minute), RequireSudo(sudoStore, sudoCfg)).Post("/panic", guardHandler.Panic)
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

				// Phase-46 / Prompt 43 — per-vehicle settings.
				// GET is read-only and unguarded; PUT/DELETE are
				// rate-limited by IP at 60/min — the SPA only fires
				// these on user save/reset clicks, but the guard
				// keeps a buggy or malicious client from saturating
				// the upsert path.
				r.Get("/settings", vehicleSettingsHandler.List)
				r.With(httprate.LimitByIP(60, 1*time.Minute)).Put("/settings/{key}", vehicleSettingsHandler.Put)
				r.With(httprate.LimitByIP(60, 1*time.Minute)).Delete("/settings/{key}", vehicleSettingsHandler.Delete)

				// Phase-46 / Prompt 54 — vehicle hero photo. POST
				// + DELETE are rate-limited at 5/min (uploads are
				// expensive and the SPA only fires them on
				// explicit user action). GET routes are unguarded
				// — they're served frequently by the hero card.
				r.Get("/photo", vehiclePhotoHandler.GetMeta)
				r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/photo", vehiclePhotoHandler.Upload)
				r.With(httprate.LimitByIP(5, 1*time.Minute)).Delete("/photo", vehiclePhotoHandler.Delete)
				r.Get("/photo/{size}", vehiclePhotoHandler.GetFile)
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
			// Phase-43a/0002 — package-derived routing snapshot for the
			// admin Fleet Telemetry Coverage page. Read-only, DB-free.
			// Rate limiting matches the admin /system endpoints' 60/min
			// ceiling. The sibling /subscription endpoint owned by the
			// same handler is intentionally NOT mounted here — no
			// frontend caller exists today and the prompt allows only
			// one new route.
			r.With(httprate.LimitByIP(60, 1*time.Minute)).Get("/coverage", fleetTelemetryHandler.Coverage)
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
			// Phase-50 / 0003 / F2 — pre-flight provider config
			// validation for the Settings → AI form. Lives on the
			// settings sub-tree (NOT under /api/v1/ai/*) because
			// users call it WHILE opting in (ai_mode='off' at the
			// moment of the call); the /api/v1/ai/* sub-tree 404s
			// in off mode by ADR-015 §I6. Auth-only — no sudo —
			// because the worst-case write the call enables is
			// the same one /settings allows already.
			r.Post("/settings/ai/validate-config", AISettingsValidateHandler())
			// Phase-46 / Prompt 36 — JSON bundle export + import.
			// Export is read-only; import is sudo-gated because a
			// large alert-rule replay or bulk geofence rewrite is a
			// destructive action that should always carry a fresh
			// credential. Both routes carry the parent rate limit.
			r.Get("/settings/export", settingsExportHandler.Export)
			r.With(RequireSudo(sudoStore, sudoCfg)).Post("/settings/import", settingsImportHandler.Import)
			// Phase-46 / Prompt 50 — POST /settings/reset.
			// Sudo-gated for the same reason as /settings/import: every
			// reset is destructive (wipes alert rules, geofences, or
			// the entire user-discoverable preference surface) and
			// should always carry a fresh credential.
			r.With(RequireSudo(sudoStore, sudoCfg)).Post("/settings/reset", settingsResetHandler.Reset)
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
			// Phase-50 / ADR-005 — alert message template helpers.
			// These are static read paths registered BEFORE the
			// catch-all `/{alertID}` route below so chi resolves them
			// correctly. They are intentionally unauthenticated only
			// to the same degree the surrounding /alerts subtree is —
			// the route group inherits whatever middleware is mounted
			// above.
			r.Get("/message-presets", alertMessageHandler.MessagePresets)
			r.Get("/message-placeholders", alertMessageHandler.MessagePlaceholders)
			r.Post("/message-preview", alertMessageHandler.MessagePreview)
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
			// Phase-46 / Prompt 37 — webhook signature preview is a
			// pure utility (no DB touch, no outbound call); rate-limited
			// because it computes HMAC SHA-256 on caller-supplied input.
			// Mounted before /{channelID} for the same reason as
			// /quiet-hours above — chi otherwise binds "webhooks" as
			// the channel id.
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Post("/webhooks/preview-signature", notificationChannelHandler.WebhookSignaturePreview)
			r.Route("/{channelID}", func(r chi.Router) {
				r.Get("/", notificationHandler.GetChannel)
				r.Put("/", notificationHandler.UpdateChannel)
				r.Delete("/", notificationHandler.DeleteChannel)
				r.Post("/toggle", notificationHandler.ToggleChannel)
				r.Post("/test", notificationHandler.TestChannel)
				// Phase-46 / Prompt 37 — HMAC-aware webhook test. Sibling
				// of /test so the legacy generic test stays available;
				// this endpoint exists solely for webhook-kind channels
				// and 404s on any other kind.
				r.With(httprate.LimitByIP(20, 1*time.Minute)).
					Post("/webhook-test", notificationChannelHandler.WebhookTest)
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

		// Driving Dynamics (G-force + pedal usage live surface)
		r.Route("/drive-dynamics", func(r chi.Router) {
			r.Get("/", driveDynamicsHandler.List)
			r.Get("/latest", driveDynamicsHandler.Latest)
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

		// Phase-43a / Prompt 0005: /vampire-drain + /vampire-drain/stats
		// restored after Phase-42 prompt 0077 removed them with the
		// vampire_drain_events table. The two endpoints are now derived
		// live from fsm_transitions (mig 000187) — parked windows from
		// fsm_name='vehicle' transitions into 'parked' — paired with
		// signal_log.field='BatteryLevel' for the SOC endpoints, with
		// charging windows excluded via signal_log.field='ChargeState'
		// (int_value > 1). Same admin-style rate limit as /mileage and
		// /vehicle-states (Phase-43a precedent).
		vampireDrainHandler := NewVampireDrainHandler(database.NewVampireDrainRepo(db.Pool))
		r.Route("/vampire-drain", func(r chi.Router) {
			r.Use(httprate.LimitByIP(60, 1*time.Minute))
			r.Get("/", vampireDrainHandler.Events)
			r.Get("/stats", vampireDrainHandler.Stats)
		})

		// Visited Locations
		r.Get("/locations", visitedLocationHandler.List)

		// Phase-43a / Prompt 0004: /mileage/{monthly,stats} restored after
		// Phase-42 prompt 0077 removed them with the daily_mileage table.
		// Both shapes are now derived live from the SI-canonical drives
		// table (mig 000185) — distance_m / 1000 → km, energy_used_wh /
		// 1000 → kWh. Frontend hooks useMonthlyMileage / useMileageStats
		// stop returning 404. Same admin-style rate limit as
		// /vehicle-states (Phase-43a / Prompt 0003 precedent).
		mileageHandler := NewMileageHandler(database.NewMileageRepo(db.Pool))
		r.Route("/mileage", func(r chi.Router) {
			r.Use(httprate.LimitByIP(60, 1*time.Minute))
			r.Get("/monthly", mileageHandler.Monthly)
			r.Get("/stats", mileageHandler.Stats)
		})

		// Trips
		r.Get("/trips", tripHandler.List)

		// Phase-43a / Prompt 0008: GET /trips/{trip_id} restores the
		// per-trip detail endpoint that the frontend useTrip hook
		// (web/src/api/hooks/useTrips.ts) calls to populate
		// TripDetailPage. Aggregates the trip header + constituent
		// drives (via trip_drives) + a vehicle-scoped time-window
		// charging_sessions overlap to surface drive_count /
		// charge_count / total_cost. Same admin-style rate limit
		// (60/min) as the rest of the Phase-43a admin reads.
		tripsDetailHandler := NewTripsDetailHandler(database.NewTripsDetailRepo(db.Pool))
		r.With(httprate.LimitByIP(60, 1*time.Minute)).Get("/trips/{trip_id}", tripsDetailHandler.Get)

		// Phase-43a / Prompt 0003: /vehicle-states/{timeline,summary} restored
		// after Phase-42 prompt 0077 removed them with the vehicle_states
		// snapshot table. The two endpoints are now derived from
		// fsm_transitions (mig 000187) filtered to fsm_name='vehicle' so
		// frontend hooks useStateTimeline / useTimeline / useStateSummary
		// stop returning 404. Same admin-style rate limit as /system/queues
		// (Phase-46 / Prompt 41 precedent).
		vehicleStatesHandler := NewVehicleStatesHandler(database.NewVehicleStatesRepo(db.Pool))
		r.Route("/vehicle-states", func(r chi.Router) {
			r.Use(httprate.LimitByIP(60, 1*time.Minute))
			r.Get("/timeline", vehicleStatesHandler.Timeline)
			r.Get("/summary", vehicleStatesHandler.Summary)
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
				fsmName := req.URL.Query().Get("fsm_name")

				// Canonical filter shape: explicit start/end (YYYY-MM-DD) takes
				// precedence so the UI's RangePicker can request arbitrary
				// historical windows (yesterday, lastMonth, custom calendar
				// pick) — not just rolling-from-now ranges. The legacy `hours`
				// param remains as a backward-compatible fallback so dashboard
				// widgets and old permalinks keep working without changes.
				var from, to time.Time
				if s, e := parseDateRange(req); !s.IsZero() {
					from = s
					if !e.IsZero() {
						to = e
					} else {
						to = time.Now().UTC()
					}
				} else {
					hours := 1
					if h := req.URL.Query().Get("hours"); h != "" {
						if v, err := strconv.Atoi(h); err == nil && v >= 0 {
							hours = v
						}
					}
					if hours == 0 {
						from = time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
					} else {
						from = time.Now().UTC().Add(-time.Duration(hours) * time.Hour)
					}
					to = time.Now().UTC()
				}
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
				records, total, err := fsmTransRepo.Query(req.Context(), vehicleID, fsmName, from, to, perPage, (page-1)*perPage)
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

			// Phase-46 / Prompt 57 — Auth-mode contract endpoint.
			// Always reachable; deliberately NOT sudo-gated and NOT
			// wrapped in RequireSubjectMiddleware because the SPA's
			// session-monitor + RequiresAuth components rely on this
			// endpoint to discover the deployment's mode and the
			// current request's resolved subject — even when the
			// upstream proxy stripped the header on this specific
			// request. Per-IP rate-limited because the SPA polls it
			// at boot and on focus refresh.
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/auth-mode", systemAuthModeHandler.ServeHTTP)

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

			// Phase-46 / Prompt 40 — Rate-limit status panel feed.
			// Read-only; cheap (no DB / no Redis); polled every 30s
			// by the admin status panel. Per-IP throttle still
			// applies in case a misconfigured client busy-loops it.
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/rate-limits", rateLimitHandler.ServeHTTP)

			// Phase-46 / Prompt 41 — Job queue status feed.
			// Aggregates pending / in-progress / 24h success-fail
			// counts across notification, export, automation
			// workers, plus latest heartbeat (Redis). Both routes
			// are GET-only and per-IP throttled at 60/min — the
			// SPA polls /system/queues every 30s and lazy-loads
			// the per-worker drawer on demand.
			queueStatusHandler := NewQueueStatusHandler(QueueStatusHandlerConfig{
				QueueRepo:      database.NewWorkerQueueRepo(db),
				HeartbeatStore: queueHeartbeatStore,
			})
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/queues", queueStatusHandler.ServeStatus)
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/queues/{worker}/jobs", queueStatusHandler.ServeJobs)
		})

		// Phase-2 / Status API — operator-grade /api/v1/status/* endpoints.
		// Stable contract for external integrations (Grafana, Uptime Kuma,
		// Home Assistant, etc.). The SPA's System Status page also subscribes
		// to /status/live (SSE) so it can drop polling. Inherits the parent
		// /api/v1 ForwardAuth gate.
		ver := opt.AppVersion
		if ver == "" {
			ver = "dev"
		}
		incidentsRepo := database.NewIncidentRepo(db)
		incidentsHandler := NewIncidentsHandler(incidentsRepo)
		statusV1 := NewStatusV1Handler(StatusV1Config{
			Health:           health,
			AppVersion:       ver,
			MaintenanceState: maintenanceProvider,
			IncidentStore:    incidentsHandler,
			StartedAt:        startTime,
		})
		r.Route("/status", func(r chi.Router) {
			r.With(httprate.LimitByIP(120, 1*time.Minute)).Get("/", statusV1.Overall)
			r.With(httprate.LimitByIP(120, 1*time.Minute)).Get("/components", statusV1.Components)
			r.With(httprate.LimitByIP(120, 1*time.Minute)).Get("/resources", statusV1.Resources)
			r.With(httprate.LimitByIP(120, 1*time.Minute)).Get("/uptime", statusV1.Uptime)
			// SSE endpoint — no per-IP rate limit because it's a long-lived
			// connection. The connection itself acts as the throttle.
			r.Get("/live", statusV1.Live)
			// Incidents CRUD + timeline append.
			r.Route("/incidents", func(r chi.Router) {
				r.With(httprate.LimitByIP(120, 1*time.Minute)).Get("/", incidentsHandler.List)
				r.With(httprate.LimitByIP(30, 1*time.Minute)).Post("/", incidentsHandler.Create)
				r.Route("/{id}", func(r chi.Router) {
					r.With(httprate.LimitByIP(120, 1*time.Minute)).Get("/", incidentsHandler.Get)
					r.With(httprate.LimitByIP(60, 1*time.Minute)).Patch("/", incidentsHandler.Patch)
					r.With(httprate.LimitByIP(60, 1*time.Minute)).Post("/updates", incidentsHandler.AppendUpdate)
					r.With(httprate.LimitByIP(30, 1*time.Minute)).Delete("/", incidentsHandler.Delete)
				})
			})
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

		// Phase-46 / Prompt 44 — RBAC matrix admin endpoints.
		// GET is unguarded so any authenticated caller can render
		// the page; PUT is sudo-gated since it changes the
		// authorisation matrix the install runs under. In open mode
		// both endpoints return 501 AUTH_MODE_OPEN inside the
		// handler before any DB work — the RequireSudo wrapper is a
		// passthrough in open mode anyway.
		r.Route("/admin/rbac", func(r chi.Router) {
			r.Use(httprate.LimitByIP(60, 1*time.Minute))
			r.Get("/matrix", rbacHandler.GetMatrix)
			r.With(RequireSudo(sudoStore, sudoCfg)).Put("/matrix", rbacHandler.UpsertMatrix)
		})

		// Phase-46 / Prompt 46 — Admin impersonation endpoints.
		// GET state + GET candidates are read-only and unguarded so
		// the SPA can poll them to render the banner. POST start is
		// sudo-gated AND blocked while already impersonating so a
		// nested impersonation cannot be initiated. POST end is NOT
		// sudo-gated — exiting impersonation should always succeed
		// without a re-auth prompt — and is idempotent, so a
		// parallel-tab end click does not surface an error toast.
		// In open mode every endpoint returns 501 AUTH_MODE_OPEN
		// inside the handler.
		r.Route("/admin/impersonate", func(r chi.Router) {
			r.Use(httprate.LimitByIP(30, 1*time.Minute))
			r.Get("/", impersonationHandler.GetState)
			r.Get("/candidates", impersonationHandler.Candidates)
			r.With(tsauth.RequireNotImpersonating(), RequireSudo(sudoStore, sudoCfg)).Post("/", impersonationHandler.Start)
			r.Post("/end", impersonationHandler.End)
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
			// Destructive cache-purge ops — share a single 5-req/min
			// limiter instance across both endpoints so a bot can't
			// loop the per-vehicle path to bulk-purge by stealth. The
			// shared limiter caps total destructive calls at 5/min/IP
			// (per-vehicle + cluster-wide combined).
			redisPurgeLimiter := httprate.LimitByIP(5, 1*time.Minute)
			r.With(redisPurgeLimiter).Delete("/redis-signals", devToolsHandler.RedisSignalsPurge)
			r.With(redisPurgeLimiter).Delete("/redis-signals/keys", devToolsHandler.RedisSignalsPurgeAll)

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

		// Phase-43a / Prompt 0007: /signals/catalog and /signals/observations
		// restored after Phase-42 prompt 0077 deleted the legacy
		// signal_catalog_handler.go. The catalog spine is parsed from
		// routing.yaml (router.Load) at handler construction; aggregates
		// + observations come from signal_log (mig 000186). Frontend hooks
		// useSignalCatalog / useSignalObservations stop returning 404. Same
		// admin-style rate limit as /vehicle-states + /system/queues
		// (Phase-43a / Prompt 0003 + Phase-46 / Prompt 41 precedent).
		// Mounted BEFORE /signals/{vehicleID} so the static paths take
		// precedence under chi v5's longest-static-prefix matching.
		signalsCatalogHandler := NewSignalsCatalogHandler(database.NewSignalsCatalogRepo(db.Pool))
		r.With(httprate.LimitByIP(60, 1*time.Minute)).Get("/signals/catalog", signalsCatalogHandler.Catalog)
		r.With(httprate.LimitByIP(60, 1*time.Minute)).Get("/signals/observations", signalsCatalogHandler.Observations)

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
		exportColumnsHandler := NewExportColumnsHandler()
		// Phase-46 / Prompt 62 — column-selector UI fetches the publishable
		// column catalog for the active export type. Read-only and cheap;
		// rate-limited to soak up accidental SPA loops.
		r.With(httprate.LimitByIP(60, 1*time.Minute)).Get("/exports/columns", exportColumnsHandler.ListColumns)
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

		// Phase-46 / Prompt 65 — recurring scheduled exports.
		// Five routes mounted as a separate /scheduled-exports
		// subtree (NOT /export/jobs/scheduled) because they
		// describe schedule rows, not one-shot job rows. Owner
		// identity flows from the configured FORWARD_AUTH_HEADER on
		// every call; the handler refuses owner_subject in the body
		// (DisallowUnknownFields). Per-row writes are scoped at the
		// SQL layer so cross-user mutations collapse to 404.
		r.Route("/scheduled-exports", func(r chi.Router) {
			r.With(httprate.LimitByIP(60, 1*time.Minute)).Get("/", scheduledExportsHandler.List)
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/", scheduledExportsHandler.Create)
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Put("/{id}", scheduledExportsHandler.Update)
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Delete("/{id}", scheduledExportsHandler.Delete)
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/{id}/run", scheduledExportsHandler.RunNow)
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

		// Phase-50 / 0001 — F0 AI-Off Contract.
		//
		// Mount every /api/v1/ai/* route through the guard. The
		// guard returns 404 unless ai_mode is non-off AND the
		// per-feature toggle is on (ADR-015 §I6, §I7). Fresh
		// installs ship with ai_mode='off' so this entire subtree
		// is invisible until the user opts in via Settings.
		mountAIRoutes(r, aiGuard, aiRegistry, RequireSudo(sudoStore, sudoCfg), aiChatbotHandler, aiDigestHandler, aiYIRHandler, aiAnomalyHandler, aiAlertHandler, aiAutomationHandler, aiSearchHandler, aiDriveCoachHandler, aiChargingDiagnosisHandler, aiRagHelpHandler, aiDriveSearchHandler, aiSpeedProfileInsightsHandler, aiRouteEfficiencySuggestionsHandler)

		// Phase-50 / 0004 — F3 AI Usage Card endpoints.
		//
		// /api/v1/ai/usage/{today,by-feature,recent} surface the
		// audit log written by the audit decorator above. The
		// usage routes special-case the per-feature toggle (the
		// __usage__ meta-feature has no toggle of its own) but
		// still 404 in off mode (ADR-015 §I6) — the wrapper inside
		// mountAIUsageRoutes carves out the exception precisely.
		mountAIUsageRoutes(r, aiSettingsRepo, aiCallLogRepo, cfg.Auth.ForwardAuthHeader)

		// Phase-50 / 0009 — F8 AI Admin endpoints (redaction-bypass report).
		//
		// /api/v1/ai/admin/redaction-bypass surfaces the
		// per-(feature, provider) bypass summary written by the
		// redact decorator above. Like /ai/usage, the admin route
		// special-cases the per-feature toggle (the
		// __redaction_bypass__ meta-feature has no toggle of its
		// own) but still 404s in off mode (ADR-015 §I6) — the
		// wrapper inside mountAIAdminRoutes carves out the
		// exception precisely.
		mountAIAdminRoutes(r, aiSettingsRepo, aiCallLogRepo)

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

// isVehiclePhotoUploadPath returns true when the request is the
// vehicle photo upload endpoint (POST /api/v1/vehicles/{id}/photo).
// Used by the global body-limit middleware to bypass the 1 MB cap
// for photo uploads — a wrapped http.MaxBytesReader can't be
// loosened later, so the bypass MUST happen at the global layer.
func isVehiclePhotoUploadPath(method, path string) bool {
	if method != http.MethodPost {
		return false
	}
	const prefix = "/api/v1/vehicles/"
	if !strings.HasPrefix(path, prefix) {
		return false
	}
	rest := path[len(prefix):]
	idx := strings.Index(rest, "/")
	if idx <= 0 {
		return false
	}
	tail := rest[idx:]
	// Accept exactly /photo (no trailing slash, no sub-path) so
	// future endpoints under /vehicles/{id}/photo/X don't
	// inherit the 12 MB limit.
	return tail == "/photo"
}

// aiSettingsReader adapts *database.SettingsRepo to the
// provider.SettingsReader port. The repo natively exposes
// AIMode + AIFeatureEnabled (cheap single-row PK lookups). The
// AIProviderConfig accessor is implemented here by calling
// the existing typed Get() and pulling out the AIProviderConfig
// JSONB field — keeping the repo single-purpose (R5 mitigation)
// and avoiding a settings-repo migration in slice F1.
type aiSettingsReader struct {
	repo *database.SettingsRepo
}

func (a aiSettingsReader) AIMode(ctx context.Context) (string, error) {
	return a.repo.AIMode(ctx)
}

func (a aiSettingsReader) AIFeatureEnabled(ctx context.Context, featureID string) (bool, error) {
	return a.repo.AIFeatureEnabled(ctx, featureID)
}

func (a aiSettingsReader) AIProviderConfig(ctx context.Context) (map[string]any, error) {
	s, err := a.repo.Get(ctx)
	if err != nil {
		return nil, err
	}
	if s == nil || s.AIProviderConfig == nil {
		return map[string]any{}, nil
	}
	return s.AIProviderConfig, nil
}

// aiToolsStateAdapter bridges signal.StateReader (whose SignalAt
// returns signal.SignalValue, a defined type whose underlying type
// is any) to ai/tools.VehicleStateSource (whose SignalAt returns
// any). Go interface satisfaction is by type identity, not
// underlying-type compatibility, so a tiny wrapper is the minimal
// safe bridge.
//
// The adapter forwards the call verbatim; the implicit conversion
// from SignalValue to any is the entire bridge. Any future change
// to either signature will surface here as a compile error before
// the AI handler ships.
type aiToolsStateAdapter struct {
	r signal.StateReader
}

// SignalAt implements ai/tools.VehicleStateSource.
func (a aiToolsStateAdapter) SignalAt(ctx context.Context, vehicleID int64, name string, at time.Time) (any, error) {
	return a.r.SignalAt(ctx, vehicleID, name, at)
}
