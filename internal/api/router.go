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
	apiadminfb "github.com/ev-dev-labs/teslasync/internal/api/adminfeedback"
	apiadminls "github.com/ev-dev-labs/teslasync/internal/api/adminlogstream"
	apiadminmnt "github.com/ev-dev-labs/teslasync/internal/api/adminmaintenance"
	apianomaly "github.com/ev-dev-labs/teslasync/internal/api/anomaly"
	apicalllog "github.com/ev-dev-labs/teslasync/internal/api/apicalllog"
	apiflagsh "github.com/ev-dev-labs/teslasync/internal/api/apiflagsh"
	apikeyh "github.com/ev-dev-labs/teslasync/internal/api/apikey"
	"github.com/ev-dev-labs/teslasync/internal/api/apperror"
	apiauth "github.com/ev-dev-labs/teslasync/internal/api/auth"
	apiauths "github.com/ev-dev-labs/teslasync/internal/api/authsession"
	apibackup "github.com/ev-dev-labs/teslasync/internal/api/backup"
	apiannot "github.com/ev-dev-labs/teslasync/internal/api/chartannotation"
	apidash "github.com/ev-dev-labs/teslasync/internal/api/dashboardlayout"
	apidq "github.com/ev-dev-labs/teslasync/internal/api/dataquality"
	apidiag "github.com/ev-dev-labs/teslasync/internal/api/diagnostic"
	apidlq "github.com/ev-dev-labs/teslasync/internal/api/dlq"
	apidrived "github.com/ev-dev-labs/teslasync/internal/api/drivediagnostic"
	apiexpcol "github.com/ev-dev-labs/teslasync/internal/api/exportcolumns"
	apifb "github.com/ev-dev-labs/teslasync/internal/api/feedback"
	apigas "github.com/ev-dev-labs/teslasync/internal/api/gasprice"
	apigeocode "github.com/ev-dev-labs/teslasync/internal/api/geocode"
	apigeo "github.com/ev-dev-labs/teslasync/internal/api/geofence"
	apiguard "github.com/ev-dev-labs/teslasync/internal/api/guard"
	apiimpers "github.com/ev-dev-labs/teslasync/internal/api/impersonate"
	apixray "github.com/ev-dev-labs/teslasync/internal/api/ingestxray"
	apilifetime "github.com/ev-dev-labs/teslasync/internal/api/lifetime"
	apimw "github.com/ev-dev-labs/teslasync/internal/api/middleware"
	apimileage "github.com/ev-dev-labs/teslasync/internal/api/mileage"
	apinotif "github.com/ev-dev-labs/teslasync/internal/api/notification"
	apionboard "github.com/ev-dev-labs/teslasync/internal/api/onboarding"
	apiopenapi "github.com/ev-dev-labs/teslasync/internal/api/openapi"
	apiperiod "github.com/ev-dev-labs/teslasync/internal/api/periodstats"
	apipinned "github.com/ev-dev-labs/teslasync/internal/api/pinned"
	apipush "github.com/ev-dev-labs/teslasync/internal/api/push"
	apiquiet "github.com/ev-dev-labs/teslasync/internal/api/quiethours"
	apiratelim "github.com/ev-dev-labs/teslasync/internal/api/ratelimit"
	apirbac "github.com/ev-dev-labs/teslasync/internal/api/rbac"
	apisaved "github.com/ev-dev-labs/teslasync/internal/api/savedviews"
	apischedexp "github.com/ev-dev-labs/teslasync/internal/api/scheduledexports"
	apisearch "github.com/ev-dev-labs/teslasync/internal/api/search"
	apisess "github.com/ev-dev-labs/teslasync/internal/api/session"
	apisignal "github.com/ev-dev-labs/teslasync/internal/api/signalinspect"
	apisigcat "github.com/ev-dev-labs/teslasync/internal/api/signalscatalog"
	apislo "github.com/ev-dev-labs/teslasync/internal/api/slo"
	apisoftupd "github.com/ev-dev-labs/teslasync/internal/api/softwareupdate"
	apisynthetic "github.com/ev-dev-labs/teslasync/internal/api/synthetic"
	apiauthmode "github.com/ev-dev-labs/teslasync/internal/api/sysauthmode"
	apitco "github.com/ev-dev-labs/teslasync/internal/api/tco"
	apitels "github.com/ev-dev-labs/teslasync/internal/api/teslaenergylivestatus"
	apituc "github.com/ev-dev-labs/teslasync/internal/api/teslauserconfig"
	apituo "github.com/ev-dev-labs/teslasync/internal/api/teslauserorder"
	apitup "github.com/ev-dev-labs/teslasync/internal/api/teslauserprofile"
	apitotp "github.com/ev-dev-labs/teslasync/internal/api/totp"
	apitrip "github.com/ev-dev-labs/teslasync/internal/api/trip"
	apitripsd "github.com/ev-dev-labs/teslasync/internal/api/tripsdetail"
	apivamp "github.com/ev-dev-labs/teslasync/internal/api/vampiredrain"
	apiveh "github.com/ev-dev-labs/teslasync/internal/api/vehicle"
	apivehaccess "github.com/ev-dev-labs/teslasync/internal/api/vehicleaccess"
	apivehconfig "github.com/ev-dev-labs/teslasync/internal/api/vehicleconfig"
	apivehinfo "github.com/ev-dev-labs/teslasync/internal/api/vehicleinfo"
	apivehphoto "github.com/ev-dev-labs/teslasync/internal/api/vehiclephoto"
	apivehsettings "github.com/ev-dev-labs/teslasync/internal/api/vehiclesettings"
	apivehstates "github.com/ev-dev-labs/teslasync/internal/api/vehiclestates"
	apivisloc "github.com/ev-dev-labs/teslasync/internal/api/visitedlocation"
	apiwerr "github.com/ev-dev-labs/teslasync/internal/api/weberrors"
	apiwhrx "github.com/ev-dev-labs/teslasync/internal/api/webhookreceiver"
	apivitals "github.com/ev-dev-labs/teslasync/internal/api/webvitals"
	apiweekly "github.com/ev-dev-labs/teslasync/internal/api/weeklydigest"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	aidb "github.com/ev-dev-labs/teslasync/internal/database/ai"
	dbalert "github.com/ev-dev-labs/teslasync/internal/database/alert"
	auditdb "github.com/ev-dev-labs/teslasync/internal/database/audit"
	dbauth "github.com/ev-dev-labs/teslasync/internal/database/auth"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	energydb "github.com/ev-dev-labs/teslasync/internal/database/energy"
	exportdb "github.com/ev-dev-labs/teslasync/internal/database/export"
	geofencedb "github.com/ev-dev-labs/teslasync/internal/database/geofence"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
	quiethoursdb "github.com/ev-dev-labs/teslasync/internal/database/quiethours"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	signaldb "github.com/ev-dev-labs/teslasync/internal/database/signal"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	tripdb "github.com/ev-dev-labs/teslasync/internal/database/trip"
	dbuser "github.com/ev-dev-labs/teslasync/internal/database/user"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	workerdb "github.com/ev-dev-labs/teslasync/internal/database/worker"
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
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/feedback"

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
	aiazure "github.com/ev-dev-labs/teslasync/internal/ai/provider/azure"
	aimock "github.com/ev-dev-labs/teslasync/internal/ai/provider/mock"
	aiollama "github.com/ev-dev-labs/teslasync/internal/ai/provider/ollama"
	aiopenai "github.com/ev-dev-labs/teslasync/internal/ai/provider/openai"

	// Phase-50 / 0011 — U1 Chatbot LLM upgrade. The chatbot strategy +
	// the shared tool registry are constructed at boot and shared with
	// the AI chatbot HTTP handler.
	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	alerttuningsuggestions "github.com/ev-dev-labs/teslasync/internal/ai/strategies/alert-tuning-suggestions"
	anomalyexplanations "github.com/ev-dev-labs/teslasync/internal/ai/strategies/anomaly-explanations"
	autonameunnamedlocations "github.com/ev-dev-labs/teslasync/internal/ai/strategies/auto-name-unnamed-locations"
	autotripnaming "github.com/ev-dev-labs/teslasync/internal/ai/strategies/auto-trip-naming"
	batteryhealthforecastnarrative "github.com/ev-dev-labs/teslasync/internal/ai/strategies/battery-health-forecast-narrative"
	cabintemperatureimpactnarrative "github.com/ev-dev-labs/teslasync/internal/ai/strategies/cabin-temperature-impact-narrative"
	chargingcurvefingerprintclustering "github.com/ev-dev-labs/teslasync/internal/ai/strategies/charging-curve-fingerprint-clustering"
	chargingdiagnosis "github.com/ev-dev-labs/teslasync/internal/ai/strategies/charging-diagnosis"
	chatbotllm "github.com/ev-dev-labs/teslasync/internal/ai/strategies/chatbot-llm"
	costforecastnarration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/cost-forecast-narration"
	crossruleconflictdetection "github.com/ev-dev-labs/teslasync/internal/ai/strategies/cross-rule-conflict-detection"
	datarepairsuggestions "github.com/ev-dev-labs/teslasync/internal/ai/strategies/data-repair-suggestions"
	digestnarration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/digest-narration"
	drivecoaching "github.com/ev-dev-labs/teslasync/internal/ai/strategies/drive-coaching"
	feedbackqueuetriage "github.com/ev-dev-labs/teslasync/internal/ai/strategies/feedback-queue-triage"
	geofenceawareautomationsuggestions "github.com/ev-dev-labs/teslasync/internal/ai/strategies/geofence-aware-automation-suggestions"
	inboxautocategorization "github.com/ev-dev-labs/teslasync/internal/ai/strategies/inbox-auto-categorization"
	incidenttimelinesummarizer "github.com/ev-dev-labs/teslasync/internal/ai/strategies/incident-timeline-summarizer"
	learnedanomalybaselines "github.com/ev-dev-labs/teslasync/internal/ai/strategies/learned-per-vehicle-anomaly-baselines"
	lifetimestatsqa "github.com/ev-dev-labs/teslasync/internal/ai/strategies/lifetime-stats-qa"
	logtracesummarization "github.com/ev-dev-labs/teslasync/internal/ai/strategies/log-trace-summarization"
	mlchargingcurveclustering "github.com/ev-dev-labs/teslasync/internal/ai/strategies/ml-charging-curve-clustering"
	mqttsseinspectorexplanations "github.com/ev-dev-labs/teslasync/internal/ai/strategies/mqtt-sse-inspector-explanations"
	nlalertbuilder "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-alert-builder"
	nlautomationbuilder "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-automation-builder"
	nldashboardcomposer "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-dashboard-composer"
	nldrivesearchreplay "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-drive-search-replay"
	nlgrafanapanel "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-grafana-panel"
	nlsearch "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-search"
	nlsqlplayground "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-sql-playground"
	periodcomparenarration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/period-compare-narration"
	piiredactionsharedexports "github.com/ev-dev-labs/teslasync/internal/ai/strategies/pii-redaction-shared-exports"
	predictivemaintenance "github.com/ev-dev-labs/teslasync/internal/ai/strategies/predictive-maintenance"
	preheatprecoolrecommender "github.com/ev-dev-labs/teslasync/internal/ai/strategies/preheat-precool-recommender"
	quiethourssuggestion "github.com/ev-dev-labs/teslasync/internal/ai/strategies/quiet-hours-suggestion"
	raghelp "github.com/ev-dev-labs/teslasync/internal/ai/strategies/rag-help"
	rangepredictionmodel "github.com/ev-dev-labs/teslasync/internal/ai/strategies/range-prediction-model"
	routeefficiencysuggestions "github.com/ev-dev-labs/teslasync/internal/ai/strategies/route-efficiency-suggestions"
	safetysettingexplainer "github.com/ev-dev-labs/teslasync/internal/ai/strategies/safety-setting-explainer"
	signalexplorernlfilter "github.com/ev-dev-labs/teslasync/internal/ai/strategies/signal-explorer-nl-filter"
	smartchargeschedulesuggestion "github.com/ev-dev-labs/teslasync/internal/ai/strategies/smart-charge-schedule-suggestion"
	softwareupdatechangelogsummarizer "github.com/ev-dev-labs/teslasync/internal/ai/strategies/software-update-changelog-summarizer"
	speedprofileinsights "github.com/ev-dev-labs/teslasync/internal/ai/strategies/speed-profile-insights"
	statemachinedebuggernarrator "github.com/ev-dev-labs/teslasync/internal/ai/strategies/state-machine-debugger-narrator"
	suggestnewgeofences "github.com/ev-dev-labs/teslasync/internal/ai/strategies/suggest-new-geofences"
	tconarration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/tco-narration"
	tirepressuretrendreasoning "github.com/ev-dev-labs/teslasync/internal/ai/strategies/tire-pressure-trend-reasoning"
	tripplannerllmagent "github.com/ev-dev-labs/teslasync/internal/ai/strategies/trip-planner-llm-agent"
	trippostcardsharecardimagegeneration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/trip-postcard-share-card-image-generation"
	vampiredrainexplanation "github.com/ev-dev-labs/teslasync/internal/ai/strategies/vampire-drain-explanation"
	vehiclepaintpreview "github.com/ev-dev-labs/teslasync/internal/ai/strategies/vehicle-paint-preview"
	voicemode "github.com/ev-dev-labs/teslasync/internal/ai/strategies/voice-mode"
	watchfacenlresponse "github.com/ev-dev-labs/teslasync/internal/ai/strategies/watch-face-nl-response"
	yirnarration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/yir-narration"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/alert"
	anomalytool "github.com/ev-dev-labs/teslasync/internal/ai/tools/anomaly"
	automationtool "github.com/ev-dev-labs/teslasync/internal/ai/tools/automation"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/charge"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/coaching"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/curve"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/diagnosis"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/diagnostic"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/digest"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/export"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/forecast"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/lifetime"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/location"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/maintenance"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/nl"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/nlq"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/paint"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/predict"
	routetool "github.com/ev-dev-labs/teslasync/internal/ai/tools/route"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/safety"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/schedule"
	speedtool "github.com/ev-dev-labs/teslasync/internal/ai/tools/speed"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/summary"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/trip"
	tripplantool "github.com/ev-dev-labs/teslasync/internal/ai/tools/tripplan"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/voice"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/yir"
	"github.com/ev-dev-labs/teslasync/internal/ml/anomaly"
	mlchargingcurves "github.com/ev-dev-labs/teslasync/internal/ml/chargingcurves"
	mlrange "github.com/ev-dev-labs/teslasync/internal/ml/range"

	// New hexagonal architecture packages
	pgadapter "github.com/ev-dev-labs/teslasync/internal/adapter/postgres"
	"github.com/ev-dev-labs/teslasync/internal/app/adminobssvc"
	"github.com/ev-dev-labs/teslasync/internal/app/auditviewersvc"
	"github.com/ev-dev-labs/teslasync/internal/app/chargingsvc"
	"github.com/ev-dev-labs/teslasync/internal/app/dashboardsvc"
	"github.com/ev-dev-labs/teslasync/internal/app/exportsvc"
	"github.com/ev-dev-labs/teslasync/internal/app/gdprexportsvc"
	"github.com/ev-dev-labs/teslasync/internal/app/vehiclesvc"
	handlermw "github.com/ev-dev-labs/teslasync/internal/handler/middleware"
	v1handlers "github.com/ev-dev-labs/teslasync/internal/handler/v1"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
)

// NewRouter creates and configures the main HTTP router with all API routes,
// middleware (logging, recovery, CORS, rate limiting, security headers), and
// a static file server for the SPA frontend. It wires up handler dependencies
// and returns the ready-to-serve http.Handler.
//
// stateReader is the new signal-log-backed cold-path reader (ADR-002 / phase-39).
// It is threaded through here so that handler migrations in phases 10–36 can
// take it as a constructor dependency one file at a time. The legacy
// *signaldb.SignalLogReader (signalLogReader below) is intentionally preserved
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

	// Error tracker for centralized error aggregation. apperror.Write
	// (and the writeAppError parent wrapper) routes structured errors
	// into this tracker via apperror.SetTracker; see internal/api/apperror.
	errorTracker := NewErrorTracker(200)
	apperror.SetTracker(errorTracker)

	// Global middleware
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(apimw.Tracing)
	r.Use(apimw.Logger)
	r.Use(apimw.Recovery)                        // Enhanced recovery that logs panics as structured errors
	r.Use(ErrorTrackingMiddleware(errorTracker)) // Centralized error aggregation
	r.Use(apimw.Prometheus)                      // Legacy {method,path,status} HTTP metrics (kept for back-compat dashboards)
	r.Use(apimw.Metrics)                         // RED metrics: http_requests_total / http_request_errors_total / http_request_duration_seconds with status_class
	// Conditionally apply chi's Compress middleware. We MUST bypass it for
	// Server-Sent Events: chi v5.0.12's compressor wraps the response writer
	// and calls .Flush() on its internal encoder. When the response Content-
	// Type is text/event-stream the encoder is never engaged (per chi's
	// default content-type allowlist), but the wrapper still dereferences
	// the nil encoder on Flush, triggering a nil-pointer panic in the
	// stream consumer goroutine. Bypassing for /api/v1/ai/* is sufficient
	// since those are the only SSE producers; everything else gets gzip
	// as before.
	compressMW := chimw.Compress(5)
	r.Use(func(next http.Handler) http.Handler {
		wrapped := compressMW(next)
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if strings.HasPrefix(req.URL.Path, "/api/v1/ai/") {
				next.ServeHTTP(w, req)
				return
			}
			wrapped.ServeHTTP(w, req)
		})
	})

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
	r.Use(apimw.SecurityHeaders)

	// Request body size limit (1 MB default). The vehicle photo
	// upload endpoint legitimately ships up to ~12 MB (8 MB image
	// + multipart envelope), so bypass the cap on that exact
	// path. Wrapping a wrapped MaxBytesReader can't loosen the
	// inner limit, so this MUST happen here in the global
	// middleware rather than inside the handler.
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			limit := int64(1 << 20)
			if apivehphoto.IsUploadPath(req.Method, req.URL.Path) {
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
	vehicleHandler := apiveh.NewHandler(vehicleSvc, teslaClient, stateReader)
	driveHandler := NewDriveDetail(db, stateReader, liveStateReader)
	chargingHandler := NewChargingHandler(db, stateReader, liveStateReader)
	geofenceHandler := apigeo.NewHandler(db, apigeo.WithAuditFunc(
		func(r *http.Request, action string, entityID *int64, detail string) {
			logAuditFromRequest(db, r, "", action, "geofence", entityID, detail)
		},
	))
	authHandler := apiauth.NewHandler(db, teslaClient, opt.Encryptor)
	// Phase-46 / Prompt 31 — Sudo step-up. Construct the in-memory
	// token store and the reauth HTTP handler once and share them
	// across the route table. The store is the source of truth for
	// step-up authorisation; the middleware reads from it on every
	// gated request, the handler writes to it on a successful
	// /auth/reauth.
	sudoCfg := LoadSudoConfig(cfg)
	sudoStore := dbauth.NewSudoTokenStore(sudoCfg.TTL)
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
	totpRepo := dbauth.NewTOTPRepo(db)
	totpHandler := apitotp.NewTOTPHandler(totpRepo, opt.Encryptor, sudoStore, cfg.Auth.ForwardAuthHeader)

	// Phase-46 / Prompt 42 — active sessions / device management.
	// TeslaSync mints its OWN per-device cookie on the first
	// authenticated request from a browser (auth.Middleware below)
	// and persists the (subject, cookie hash) tuple here so the
	// Settings page can list devices and revoke individual sessions
	// without touching the upstream IdP. The repo's HMAC signing
	// secret is freshly generated on every restart — desired
	// semantics for a "local session" primitive; operators wanting
	// cross-restart persistence already get it from the upstream IdP.
	authSessionsRepo := dbauth.NewAuthSessionsRepo(db)
	sessionHandler := apisess.NewSessionHandler(authSessionsRepo, cfg.Auth.ForwardAuthHeader)

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
	authSubjectsRepo := dbauth.NewAuthSubjectsRepo(db)
	subjectRecorder := tsauth.NewSubjectRecorder(apiauthmode.NewAuthSubjectsStore(authSubjectsRepo), tsauth.SubjectRecorderOptions{})
	systemAuthModeHandler := apiauthmode.NewHandler(cfg.Auth.ForwardAuthHeader, cfg.Auth.ProviderHint)
	_ = authSubjectsRepo // referenced via subjectRecorder; held for future per-user tables.

	// Phase-46 / Prompt 34 — Live log tail. Build a process-wide
	// pub/sub registry for zerolog events and tee the global logger
	// through it so every Info/Warn/Error/etc. fans out to any
	// connected SSE subscriber. The tee is idempotent: installAdminLogStreamTap
	// guards against double-wrapping when NewRouter is called more
	// than once in the same process (e.g. parallel router tests).
	logTap := platform.NewLogSubscriberRegistry()
	installAdminLogStreamTap(logTap)
	logStreamHandler := apiadminls.NewAdminLogStreamHandler(logTap)
	settingsHandler := NewSettingsHandler(db)

	// Phase-50 / 0001 — F0 AI-Off Contract (ADR-015).
	//
	// The guard is built once here and shared across every
	// /api/v1/ai/* route so the per-request feature-gate logic
	// (mode != "off" AND feature toggle on) lives in exactly one
	// place. Settings is the same SettingsRepo the rest of the
	// app uses; the AIMode/AIFeatureEnabled methods on it are
	// fail-closed (return "off"/false on any error).
	aiSettingsRepo := settingsdb.NewSettingsRepo(db)
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
	// existing *settingsdb.SettingsRepo already implements
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
	aiCallLogRepo := aidb.NewAICallLogRepo(db)
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
	aiRegistry.Register(provider.NameAzure, aiazure.Builder)
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
	settingsSerializer := settingsdb.NewSettingsSerializer(
		settingsdb.NewSettingsRepo(db),
		dbalert.NewAlertRuleRepo(db),
		geofencedb.NewGeofenceRepo(db),
		quiethoursdb.NewQuietHoursRepo(db),
	)
	settingsExportHandler := NewSettingsExportHandler(settingsSerializer, cfg.Auth.ForwardAuthHeader)
	settingsImportHandler := NewSettingsImportHandler(settingsSerializer, cfg.Auth.ForwardAuthHeader)
	// Phase-46 / Prompt 50 — per-section + global "Reset to defaults".
	// Sudo-gated at the route below so the SPA's <ReauthDialog>
	// always pops on the danger-zone "Reset ALL settings" button.
	settingsResetRepo := settingsdb.NewSettingsResetRepo(db)
	settingsResetHandler := NewSettingsResetHandler(settingsResetRepo, cfg.Auth.ForwardAuthHeader)
	// Phase-46 / Prompt 65 — recurring scheduled exports.
	//
	// Owner identity comes from the configured FORWARD_AUTH_HEADER on
	// every read/write — the handler NEVER trusts owner_subject in the
	// request body. The repo's per-row UPDATE/DELETE statements scope
	// by (id, owner_subject) so cross-user mutations collapse to 404.
	scheduledExportRepo := exportdb.NewScheduledExportRepo(db)
	scheduledExportsHandler := apischedexp.NewScheduledExportsHandler(scheduledExportRepo, cfg.Auth.ForwardAuthHeader, nil)
	// Phase-46 / Prompt 43 — per-vehicle settings layer.
	//
	// The resolver layers vehicle-scoped overrides on top of the
	// existing install-global SettingsRepo and the vehicles base
	// table. Construct here so the same SettingsRepo + VehicleRepo
	// instances back both the global settings handler above and
	// the per-vehicle resolver below.
	vehicleSettingsRepo := settingsdb.NewVehicleSettingsRepo(db)
	vehicleSettingsRepoForRouter := vehicledb.NewVehicleRepo(db)
	vehicleSettingsResolver := settingsdb.NewVehicleSettingsResolver(
		vehicleSettingsRepo,
		vehicledb.NewNameLookup(vehicleSettingsRepoForRouter),
		settingsdb.NewUserSettingsLookup(settingsdb.NewSettingsRepo(db)),
	)
	vehicleSettingsHandler := apivehsettings.NewHandler(
		vehicleSettingsRepo,
		vehicleSettingsResolver,
		apivehsettings.NewVehicleExistenceChecker(vehicleSettingsRepoForRouter),
	)

	// Phase-46 / Prompt 54 — vehicle photo upload. The handler
	// owns the on-disk write/read pipeline plus the per-vehicle
	// upload mutex; the repo is a thin SQL facade that persists
	// the rendered paths in vehicle_photos.
	vehiclePhotoRepo := vehicledb.NewVehiclePhotoRepo(db)
	vehiclePhotoHandler := apivehphoto.NewHandler(
		vehiclePhotoRepo,
		apivehsettings.NewVehicleExistenceChecker(vehicleSettingsRepoForRouter),
		cfg.VehiclePhotoDir,
	)

	// Phase-46 / Prompt 44 — RBAC matrix admin handler.
	// Matrix bindings live in role_permissions; permissions are a
	// hand-maintained catalog in internal/auth. The handler is
	// auth-mode aware (501 AUTH_MODE_OPEN in open mode) and the PUT
	// route is wrapped in RequireSudo below.
	rolePermissionsRepo := dbauth.NewRolePermissionsRepo(db)
	rbacHandler := apirbac.NewRBACHandler(rolePermissionsRepo, cfg.Auth.ForwardAuthHeader)

	// Phase-46 / Prompt 46 — admin impersonation. The store mints
	// HMAC-signed cookies (15-min TTL) carrying the original-admin /
	// target pair; the middleware mounted further down rewrites the
	// principal header so downstream handlers see the impersonation
	// target as the request principal. The audit repo doubles as the
	// candidates store via its ListDistinctActiveSubjects helper —
	// see audit_repo.go for the rationale on co-locating that query.
	auditRepo := auditdb.NewAuditRepoWithDB(db)
	impersonationStore := tsauth.MustNewImpersonationStore()
	impersonationHandler := apiimpers.NewHandler(
		impersonationStore,
		auditRepo,
		auditRepo,
		cfg.Auth.ForwardAuthHeader,
	)

	dashboardLayoutHandler := apidash.NewDashboardLayoutHandler(db)
	chartAnnotationHandler := apiannot.NewChartAnnotationHandler(db)
	pinnedHandler := apipinned.NewHandler(db)
	savedViewsHandler := apisaved.NewHandler(db, cfg.Auth.ForwardAuthHeader, apisaved.WithAuditFunc(
		func(r *http.Request, headerName, action, resource string, entityID *int64, detail string) {
			logAuditFromRequest(db, r, headerName, action, resource, entityID, detail)
		},
	))
	pushHandler := apipush.NewPushHandler(db, webpush.Default(), cfg.Auth.ForwardAuthHeader, apipush.WithAuditFunc(
		func(r *http.Request, headerName, action, resource string, entityID *int64, detail string) {
			logAuditFromRequest(db, r, headerName, action, resource, entityID, detail)
		},
	))
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
	guardHandler := apiguard.NewGuardHandler(systemdb.NewGuardRepo(db.Pool), vehicledb.NewVehicleRepo(db), teslaClient, cfg)
	energyHandler := NewEnergyHandler(energySvc)
	signalLogReader := signaldb.NewSignalLogReader(db)
	batteryHandler := NewBatteryHandler(db, stateReader)
	analyticsHandler := NewAnalyticsHandler(db, stateReader)
	notificationHandler := apinotif.NewHandler(db)
	notificationChannelHandler := apinotif.NewChannelHandler(db)
	notifScheduleHandler := apinotif.NewScheduleHandler(db)
	// Wire the dynamic outbound-sink lookup into the carved notification
	// subpackage so Discord/Slack/Telegram/Webhook/Ntfy/Pushover adapters
	// keep recording to api_call_logs through SetOutboundSink hot-reloads.
	apinotif.SinkProvider = currentOutboundSink
	quietHoursHandler := apiquiet.NewHandler(quiethoursdb.NewQuietHoursRepo(db), cfg)
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
		Vehicles:      vehicledb.NewVehicleRepo(db),
		VehicleState:  aiToolsStateAdapter{r: stateReader},
		Drives:        drivedb.NewDriveRepo(db),
		Charges:       chargingdb.NewChargingRepo(db),
		AlertRules:    dbalert.NewAlertRuleRepo(db),
		Notifications: dbnotif.NewNotificationRepo(db),
		Geofences:     geofencedb.NewGeofenceRepo(db),
		Efficiency:    drivedb.NewDriveRepo(db),
	})
	// Phase-50 / U2 (slice 0012) — register the digest-narration
	// slice's read-only tool on the SAME process-wide registry so
	// the dispatcher can resolve `query_weekly_digest_context` for
	// the digest-narration strategy. Register12Builtins must run
	// FIRST so the BuiltinNames-pin test continues to see the 12
	// canonical builtins; this call extends the registry beyond
	// that pinned set.
	digest.RegisterDigestTools(aiToolRegistry, digest.DigestSources{
		Drives:  drivedb.NewDriveRepo(db),
		Charges: chargingdb.NewChargingRepo(db),
	})
	// Phase-50 / U3 (slice 0013) — register the yir-narration
	// slice's read-only tool on the SAME process-wide registry so
	// the dispatcher can resolve `query_year_in_review_context`
	// for the yir-narration strategy. Same ordering rule: the
	// builtins + digest tools above must register first so the
	// pin tests continue to see the canonical sets unchanged.
	yir.RegisterYearReviewTools(aiToolRegistry, yir.YearReviewSources{
		Drives:  drivedb.NewDriveRepo(db),
		Charges: chargingdb.NewChargingRepo(db),
	})
	aiChatbotHandler := NewAIChatbotHandler(
		dbnotif.NewChatRepo(db),
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
	vehicleConfigHandler := apivehconfig.NewHandler(stateReader, liveStateReader)
	locationSnapshotHandler := NewLocationSnapshotHandler(stateReader, liveStateReader)
	safetyHandler := NewSafetyHandler(stateReader, liveStateReader)
	userPreferenceHandler := NewUserPreferenceHandler(stateReader, liveStateReader)
	softwareUpdateHandler := apisoftupd.NewHandler(db)
	tcoHandler := apitco.NewHandler(db)
	sleepHandler := NewSleepHandler(db)
	// Phase-42 (prompt 0077): VampireDrainHandler deleted (vampire_drain_events).
	visitedLocationHandler := apivisloc.NewHandler(db)
	// Phase-42 (prompt 0077): legacy mileage handler deleted (daily_mileage); TCO derives
	// distance via SUM(distance_m) FROM drives.
	tripHandler := apitrip.NewHandler(db)
	// Phase-42 (prompt 0077): VehicleStateHandler deleted (vehicle_states);
	// current state is sourced from fsm_transitions / signal.StateReader.
	backupHandler := apibackup.NewHandler(db)
	backupRestoreHandler := apibackup.NewRestoreHandler(db)
	regenHandler := NewRegenHandler(db)
	batteryDegradationHandler := NewBatteryDegradationHandler(db, stateReader, signalLogReader)
	auditHandler := NewAuditHandler(db, cfg.Auth.ForwardAuthHeader)
	apiCallLogHandler := apicalllog.NewHandler(db)
	apiKeyHandler := apikeyh.NewHandler(db, cfg.Auth.ForwardAuthHeader, apikeyh.WithAuditFunc(
		func(r *http.Request, headerName, action, resource string, entityID *int64, detail string) {
			logAuditFromRequest(db, r, headerName, action, resource, entityID, detail)
		},
	))
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
	periodStatsHandler := apiperiod.NewHandler(db)
	drivingCoachHandler := NewDrivingCoachHandler(db)
	costForecastHandler := NewCostForecastHandler(db)
	chargingOptimizerHandler := NewChargingOptimizerHandler(db)
	anomalyHandler := apianomaly.NewHandler(db)
	// Phase-50 / U4 (slice 0014) — register the anomaly-explanations
	// slice's read-only tool on the SAME process-wide registry so
	// the dispatcher can resolve `query_anomaly_context` for the
	// anomaly-explanations strategy. Must register AFTER
	// Register12Builtins + RegisterDigestTools + RegisterYearReviewTools
	// so the BuiltinNames-pin test continues to see the canonical
	// builtins; this call extends the registry beyond the pinned set.
	// apianomaly.Handler implements aitools.AnomalySource via
	// (*apianomaly.Handler).DetectAnomalies — see internal/api/anomaly/handler.go.
	anomalytool.RegisterAnomalyTools(aiToolRegistry, anomalytool.AnomalySources{
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
	alert.RegisterAlertBuilderTools(aiToolRegistry, alert.AlertBuilderSources{
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
	automationtool.RegisterAutomationBuilderTools(aiToolRegistry, automationtool.AutomationBuilderSources{
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
		Hydrator:  newAISearchHydrator(apisearch.NewPGSearcher(db)),
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
	coaching.RegisterDriveCoachingTools(aiToolRegistry, coaching.DriveCoachingSources{
		Drives: drivedb.NewDriveRepo(db),
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
	diagnosis.RegisterChargingDiagnosisTools(aiToolRegistry, diagnosis.ChargingDiagnosisSources{
		Charges: chargingdb.NewChargingRepo(db),
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
	trip.RegisterDriveSearchTools(aiToolRegistry, trip.DriveSearchSources{
		Retriever: aiDriveSearchRetriever,
		Hydrator:  newAIDriveSearchHydrator(apisearch.NewPGSearcher(db)),
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
	speedtool.RegisterSpeedProfileInsightsTools(aiToolRegistry, speedtool.SpeedProfileInsightsSources{
		Drives: drivedb.NewDriveRepo(db),
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
	routetool.RegisterRouteEfficiencySuggestionsTools(aiToolRegistry, routetool.RouteEfficiencySuggestionsSources{
		Retriever: aiRouteEfficiencyRetriever,
		Drives:    drivedb.NewDriveRepo(db),
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

	// Phase-50 / D4 (slice 0024) — Auto trip naming.
	// Construct the shared TripsDetailRepo once so both the
	// auto-trip-naming AI tool path and (eventually) the
	// canonical /api/v1/trips/{trip_id} handler share a single
	// read path against the trips/trip_drives schema. Today the
	// canonical handler still builds its own repo inline at the
	// mount point; the duplicate is intentional and short-lived —
	// a future cleanup slice can consolidate.
	aiAutoTripNamingDetailRepo := tripdb.NewTripsDetailRepo(db.Pool)
	// auto-trip-naming tools (Phase-50 / D4, slice 0024).
	// Adds `draft_trip_name` + `validate_trip_name` to the shared
	// tool registry. Both tools are PROPOSE-only — they construct
	// or validate trip-name DTOs but do NOT touch the database;
	// the dispatcher's deny-all confirm gate is therefore never
	// triggered. The actual trip-name persistence flows through
	// an explicit user confirmation in the TripDetailPage UI
	// (out of scope for this slice).
	trip.RegisterAutoTripNamingTools(aiToolRegistry, trip.AutoTripNamingSources{
		Trips:     NewAITripSourceAdapter(aiAutoTripNamingDetailRepo),
		Details:   aiAutoTripNamingDetailRepo,
		Validator: NewAITripNameValidator(),
	})
	// Auto-trip-naming handler. One per process; stateless beyond
	// constructor inputs. Must be constructed AFTER the tool
	// registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiAutoTripNameHandler := NewAIAutoTripNameHandler(
		aiRegistry,
		aiToolRegistry,
		autotripnaming.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	lifetimeHandler := apilifetime.NewHandler(db, eventHub)
	yearReviewHandler := NewYearReviewHandler(db)
	chargePlannerHandler := NewChargePlannerHandler(db, teslaClient, cfg, stateReader)
	energyFlowHandler := NewEnergyFlowHandler(db, stateReader, liveStateReader)
	weeklyDigestHandler := apiweekly.NewHandler(db)
	teslaChargingHistoryHandler := NewTeslaChargingHistoryHandler(teslaClient, db)
	teslaChargingSessionHandler := NewTeslaChargingSessionHandler(teslaClient, db)
	teslaEnergyHistoryHandler := NewTeslaEnergyHistoryHandler(teslaClient, db)
	teslaEnergyLiveStatusHandler := apitels.NewHandler(teslaClient, db)
	energySiteHandler := NewEnergySiteHandler(teslaClient, db)
	fleetTelemetryErrorHandler := NewFleetTelemetryErrorHandler(teslaClient, db)
	// Phase-43a/0002 — wire the package-derived Fleet Telemetry coverage
	// handler authored by Phase-42 prompt 0068. It is intentionally
	// DB-free: the routing snapshot comes from the embedded routing.yaml
	// via router.LoadMap() and the subscription view comes from
	// teslaconfig.Builder. The handler is mounted inside the existing
	// /tesla/fleet-telemetry route block below.
	fleetTelemetryHandler := NewFleetTelemetryHandler(cfg)
	teslaUserConfigHandler := apituc.NewHandler(teslaClient, db)
	teslaUserOrderHandler := apituo.NewHandler(teslaClient, db)
	teslaUserProfileHandler := apitup.NewHandler(teslaClient, db)
	vehicleAccessHandler := apivehaccess.NewHandler(teslaClient, db)
	vehicleInfoHandler := apivehinfo.NewHandler(teslaClient, db)
	tripPlannerHandler := NewTripPlannerHandler(db, opt.CacheStore, stateReader)

	// trip-planner-llm-agent tools (Phase-50 / D5, slice 0025).
	// Adds `query_chargers_along_route`, `query_user_charge_dwells`,
	// and `draft_trip_plan` to the shared tool registry. All three
	// are PROPOSE-only / READ-only — the first two read the existing
	// charging_sessions table via the shared ChargeSource port; the
	// third delegates to the canonical TripPlannerHandler.computePlan
	// path via a narrow TripPlanComputer port satisfied by
	// AITripPlanComputer. The dispatcher's deny-all confirm gate is
	// therefore never triggered; the actual trip-plan persistence
	// flows through the existing canonical Plan button in the
	// TripPlannerPage UI (unchanged baseline).
	tripplantool.RegisterTripPlannerLLMAgentTools(aiToolRegistry, tripplantool.TripPlannerLLMAgentSources{
		Chargers: chargingdb.NewChargingRepo(db),
		Planner:  NewAITripPlanComputer(tripPlannerHandler),
	})
	// trip-planner-llm-agent handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiTripPlannerLLMHandler := NewAITripPlannerLLMHandler(
		aiRegistry,
		aiToolRegistry,
		tripplannerllmagent.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// smart-charge-schedule-suggestion tools (Phase-50 / C1, slice
	// 0026). Adds `draft_charge_schedule` and
	// `validate_charge_schedule` to the shared tool registry. Both
	// are PROPOSE-only / READ-only — draft_charge_schedule delegates
	// to the canonical ChargePlannerHandler.computeSchedule path
	// via a narrow ChargeScheduleComputer port satisfied by
	// AIChargeScheduleComputer; validate_charge_schedule is pure-Go
	// arithmetic on the typed envelope. The dispatcher's deny-all
	// confirm gate is therefore never triggered; the actual
	// schedule persistence flows through the existing canonical
	// Schedule button in the SmartChargePage UI (unchanged
	// baseline).
	schedule.RegisterSmartChargeScheduleSuggestionTools(aiToolRegistry, schedule.SmartChargeScheduleSuggestionSources{
		Planner: NewAIChargeScheduleComputer(chargePlannerHandler),
	})
	// smart-charge-schedule-suggestion handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiSmartChargeScheduleHandler := NewAISmartChargeScheduleHandler(
		aiRegistry,
		aiToolRegistry,
		smartchargeschedulesuggestion.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// battery-health-forecast-narrative (Phase-50 / C2, slice
	// 0027). Registers `query_battery_health_forecast` to the
	// shared tool registry. The tool is READ-only — it composes
	// the same package-level helpers (synthesizeBatterySnapshots,
	// predictDegradation, computeRiskFactors,
	// lookupVehicleCapacityWh) that back the deterministic
	// GET /api/v1/analytics/battery-degradation handler via a
	// narrow BatteryHealthForecaster port satisfied by
	// AIBatteryHealthForecaster. The dispatcher's deny-all
	// confirm gate is therefore never triggered; the
	// deterministic chart / hero-cards / recommendations panel
	// on /battery (BatteryHealthPage) remain the canonical
	// baseline.
	predict.RegisterBatteryHealthForecastNarrativeTools(aiToolRegistry, predict.BatteryHealthForecastNarrativeSources{
		Forecaster: NewAIBatteryHealthForecaster(db, stateReader, signalLogReader),
	})
	// battery-health-forecast-narrative handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiBatteryHealthHandler := NewAIBatteryHealthHandler(
		aiRegistry,
		aiToolRegistry,
		batteryhealthforecastnarrative.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// charging-curve-fingerprint-clustering (Phase-50 / C3, slice
	// 0028). The shared rag.Retriever is constructed per-feature
	// so the rate-limit + cost-cap decorators on the embedding
	// provider apply per-strategy. The retriever uses the same
	// nomic-embed-text 768-dim physical table as the other RAG
	// slices; the per-feature source-type allowlist
	// {charge_curve, charge_session} is enforced in
	// retrieve_charge_curve_chunks's Validate. The feature is
	// registered as needing `ai_charge_curve_indexer` (gated
	// indexer stub — see internal/jobs/ai_charge_curve_indexer.go);
	// the F7 indexer fan-out point for `charge_curve` is reserved
	// by string but not yet wired to any embedding job.
	aiChargeCurveRetriever, err := rag.New(
		context.Background(),
		aiSettingsRepo,
		db,
		aiRegistry,
		chargingcurvefingerprintclustering.FeatureID,
		rag.ModelNomicEmbedText,
	)
	if err != nil {
		log.Fatal().Err(err).Msg("ai charging-curve-fingerprint-clustering: rag.New failed during boot wiring")
	}
	// charging-curve-fingerprint-clustering tools (Phase-50 / C3,
	// slice 0028). Adds `retrieve_charge_curve_chunks` +
	// `query_charge_curve_features` to the shared tool registry so
	// the dispatcher can resolve them for the
	// charging-curve-fingerprint-clustering strategy. Same
	// ordering rule as the other slice tools above: must be
	// registered before the handler constructor below so the
	// strategy's allowedTools resolve at boot.
	// query_charge_curve_features calls ChargingRepo.GetByVehicle
	// and derives the per-cluster fingerprint envelope in-memory
	// mirroring the deterministic L1/L2/DC bucketing the SPA's
	// helpers.ts already applies — no new SQL is written by this
	// slice.
	curve.RegisterChargingCurveFingerprintClusteringTools(aiToolRegistry, curve.ChargingCurveFingerprintClusteringSources{
		Retriever: aiChargeCurveRetriever,
		Charges:   chargingdb.NewChargingRepo(db),
	})
	// charging-curve-fingerprint-clustering handler. One per
	// process; stateless beyond constructor inputs. Must be
	// constructed AFTER the tool registration above so the
	// dispatcher can resolve the strategy's allowedTools at boot.
	aiChargingCurveClusteringHandler := NewAIChargingCurveClusteringHandler(
		aiRegistry,
		aiToolRegistry,
		chargingcurvefingerprintclustering.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// cost-forecast-narration tools (Phase-50 / C4, slice
	// 0029). Adds `query_cost_forecast` to the shared tool
	// registry so the dispatcher can resolve it for the
	// cost-forecast-narration strategy. Same ordering rule as
	// the other slice tools above: must be registered before the
	// handler constructor below so the strategy's allowedTools
	// resolve at boot. The CostForecaster adapter delegates to
	// the same package-level api.ComputeCostForecast helper that
	// also backs the canonical
	// GET /api/v1/analytics/cost-forecast handler — the AI
	// narrator quotes the SAME deterministic forecast the chart
	// renders (no duplicated SQL).
	forecast.RegisterCostForecastNarrationTools(aiToolRegistry, forecast.CostForecastNarrationSources{
		Forecaster: NewAICostForecaster(db),
	})
	// cost-forecast-narration handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiCostForecastNarrationHandler := NewAICostForecastNarrationHandler(
		aiRegistry,
		aiToolRegistry,
		costforecastnarration.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// period-compare-narration tools (Phase-50 / X1, slice
	// 0040). Adds `query_period_compare` to the shared tool
	// registry so the dispatcher can resolve it for the
	// period-compare-narration strategy. Must be registered
	// before the handler constructor below so the strategy's
	// allowedTools resolve at boot. The PeriodComparator adapter
	// delegates to the same package-level apiperiod.ComputePeriodStats
	// helper that also backs the canonical
	// GET /api/v1/analytics/period-stats handler — the AI
	// narrator quotes the SAME deterministic per-period
	// envelope the chart on /period-compare (and its alias
	// /analytics/compare) renders (no duplicated SQL).
	forecast.RegisterPeriodCompareNarrationTools(aiToolRegistry, forecast.PeriodCompareNarrationSources{
		Comparator: NewAIPeriodCompareSource(db),
	})
	// period-compare-narration handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiPeriodCompareNarrationHandler := NewAIPeriodCompareNarrationHandler(
		aiRegistry,
		aiToolRegistry,
		periodcomparenarration.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// lifetime-stats-qa (Phase-50 / X2, slice 0041).
	// The shared rag.Retriever is constructed per-feature so the
	// rate-limit + cost-cap decorators on the embedding provider
	// apply per-strategy. The retriever uses the same
	// nomic-embed-text 768-dim physical table as the other RAG
	// slices; the per-feature source-type allowlist
	// {analytics_lifetime, drive_summary, charge_session} is
	// enforced in retrieve_analytics_chunks's Validate. The
	// `analytics_lifetime` source type is reserved as a string
	// (not promoted to a rag.Source* constant) for forward-compat
	// without widening the F7 contract.
	aiAnalyticsRetriever, err := rag.New(
		context.Background(),
		aiSettingsRepo,
		db,
		aiRegistry,
		lifetimestatsqa.FeatureID,
		rag.ModelNomicEmbedText,
	)
	if err != nil {
		log.Fatal().Err(err).Msg("ai lifetime-stats-qa: rag.New failed during boot wiring")
	}
	// lifetime-stats-qa tools (Phase-50 / X2, slice 0041).
	// Adds `query_lifetime_stats` + `retrieve_analytics_chunks` to
	// the shared tool registry so the dispatcher can resolve them
	// for the lifetime-stats-qa strategy. Same ordering rule as
	// the other slice tools above: must be registered before the
	// handler constructor below so the strategy's allowedTools
	// resolve at boot. query_lifetime_stats composes the SAME
	// api.ComputeLifetimeStats helper that backs the canonical
	// baseline GET /api/v1/analytics/lifetime handler — no new
	// SQL is written by this slice.
	lifetime.RegisterLifetimeStatsQATools(aiToolRegistry, lifetime.LifetimeStatsQASources{
		Retriever:     aiAnalyticsRetriever,
		LifetimeStats: NewAILifetimeStatsSource(db),
	})
	// lifetime-stats-qa handler. One per process; stateless beyond
	// constructor inputs. Must be constructed AFTER the tool
	// registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiLifetimeStatsQAHandler := NewAILifetimeStatsQAHandler(
		aiRegistry,
		aiToolRegistry,
		lifetimestatsqa.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// incident-timeline-summarizer (Phase-50 / S1, slice 0042).
	// The shared rag.Retriever is constructed per-feature so the
	// rate-limit + cost-cap decorators on the embedding provider
	// apply per-strategy. The retriever uses the same
	// nomic-embed-text 768-dim physical table as the other RAG
	// slices; the per-feature source-type allowlist
	// {system_event, audit_log} is enforced in
	// retrieve_system_chunks's Validate. Both source types are
	// reserved as strings (not promoted to rag.Source* constants)
	// for forward-compat without widening the F7 contract.
	aiSystemRetriever, err := rag.New(
		context.Background(),
		aiSettingsRepo,
		db,
		aiRegistry,
		incidenttimelinesummarizer.FeatureID,
		rag.ModelNomicEmbedText,
	)
	if err != nil {
		log.Fatal().Err(err).Msg("ai incident-timeline-summarizer: rag.New failed during boot wiring")
	}
	// incident-timeline-summarizer tools (Phase-50 / S1, slice 0042).
	// Adds `query_incident_timeline` + `retrieve_system_chunks` to
	// the shared tool registry so the dispatcher can resolve them
	// for the incident-timeline-summarizer strategy. Same ordering
	// rule as the other slice tools above: must be registered
	// before the handler constructor below so the strategy's
	// allowedTools resolve at boot. query_incident_timeline composes
	// the SAME dbobs.IncidentRepo.Get path that backs the
	// canonical baseline GET /api/v1/status/incidents/{id} handler
	// — no new SQL is written by this slice.
	summary.RegisterIncidentTimelineSummarizerTools(aiToolRegistry, summary.IncidentTimelineSummarizerSources{
		Retriever:        aiSystemRetriever,
		IncidentTimeline: NewAIIncidentTimelineSource(dbobs.NewIncidentRepo(db)),
	})
	// incident-timeline-summarizer handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiIncidentTimelineSummarizerHandler := NewAIIncidentTimelineSummarizerHandler(
		aiRegistry,
		aiToolRegistry,
		incidenttimelinesummarizer.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// data-repair-suggestions (Phase-50 / S2, slice 0043).
	// Adds `draft_data_repair_plan` + `validate_data_repair_plan`
	// to the shared tool registry so the dispatcher can resolve
	// them for the data-repair-suggestions strategy. Same
	// ordering rule as the other slice tools above: must be
	// registered before the handler constructor below so the
	// strategy's allowedTools resolve at boot. Both tools are
	// PROPOSE-only; the actual save/close/discard mutation
	// flows through the existing typed
	// PUT/POST/DELETE /api/v1/data-repair/{kind}/{id}{...}
	// handlers AFTER the user explicitly clicks the canonical
	// button on the baseline /system/data-repair edit form. No
	// new SQL is written by this slice — the source port
	// composes the SAME ChargingRepo.GetStale + DriveRepo.GetStale
	// paths that back the baseline DataRepairHandler.GetStaleSessions.
	diagnostic.RegisterDataRepairSuggestionsTools(aiToolRegistry, diagnostic.DataRepairSuggestionsSources{
		Validator: NewAIDataRepairPlanValidator(),
	})
	// data-repair-suggestions handler. Constructed after the tool
	// registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiDataRepairSuggestionsHandler := NewAIDataRepairSuggestionsHandler(
		aiRegistry,
		aiToolRegistry,
		datarepairsuggestions.New(),
		NewAIDataRepairSource(db),
		cfg.Auth.ForwardAuthHeader,
	)

	// signal-explorer-nl-filter (Phase-50 / S3, slice 0044).
	// Adds `draft_signal_filter` + `validate_signal_filter` to
	// the shared tool registry so the dispatcher can resolve them
	// for the signal-explorer-nl-filter strategy. Same ordering
	// rule as the other slice tools above: must be registered
	// before the handler constructor below so the strategy's
	// allowedTools resolve at boot. Both tools are PROPOSE-only;
	// the actual filter application flows through the existing
	// SignalSelector + RangePicker on /signals/explorer AFTER the
	// user explicitly clicks the Apply button in the AI side
	// panel. No new SQL is written by this slice — the source
	// port composes the SAME proto-derived AvailableSignals
	// catalog that backs the baseline
	// GET /api/v1/signals/{vehicleID}/available endpoint.
	nl.RegisterSignalExplorerNlFilterTools(aiToolRegistry, nl.SignalExplorerNlFilterSources{
		Validator: NewAISignalFilterValidator(),
	})
	// signal-explorer-nl-filter handler. Constructed after the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiSignalExplorerNlFilterHandler := NewAISignalExplorerNlFilterHandler(
		aiRegistry,
		aiToolRegistry,
		signalexplorernlfilter.New(),
		NewAISignalCatalogSource(),
		cfg.Auth.ForwardAuthHeader,
	)

	// log-trace-summarization (Phase-50 / S4, slice 0045).
	// The shared rag.Retriever is constructed per-feature so the
	// rate-limit + cost-cap decorators on the embedding provider
	// apply per-strategy. The retriever uses the same
	// nomic-embed-text 768-dim physical table as the other RAG
	// slices; the per-feature source-type allowlist
	// {log_event, trace_span} is enforced in retrieve_log_chunks's
	// Validate. Both source types are reserved as strings (not
	// promoted to rag.Source* constants) for forward-compat
	// without widening the F7 contract — a future indexer slice
	// will land the actual log-event / trace-span chunk indexing.
	aiLogTraceRetriever, err := rag.New(
		context.Background(),
		aiSettingsRepo,
		db,
		aiRegistry,
		logtracesummarization.FeatureID,
		rag.ModelNomicEmbedText,
	)
	if err != nil {
		log.Fatal().Err(err).Msg("ai log-trace-summarization: rag.New failed during boot wiring")
	}
	// log-trace-summarization tools (Phase-50 / S4, slice 0045).
	// Adds `query_trace_window` + `retrieve_log_chunks` to the
	// shared tool registry so the dispatcher can resolve them for
	// the log-trace-summarization strategy. Same ordering rule as
	// the other slice tools above: must be registered before the
	// handler constructor below so the strategy's allowedTools
	// resolve at boot. The TraceWindow source is a deterministic
	// EMPTY adapter — the operator-facing log surface is
	// stream-only and has no historical reader yet; the strategy's
	// goldens cover the zero-data path.
	summary.RegisterLogTraceSummarizerTools(aiToolRegistry, summary.LogTraceSummarizerSources{
		Retriever:   aiLogTraceRetriever,
		TraceWindow: NewAILogTraceWindowSource(),
	})
	// log-trace-summarization handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiLogTraceSummarizationHandler := NewAILogTraceSummarizationHandler(
		aiRegistry,
		aiToolRegistry,
		logtracesummarization.New(),
		NewAILogTraceWindowSource(),
		cfg.Auth.ForwardAuthHeader,
	)

	// vampire-drain-explanation (Phase-50 / C5, slice 0030).
	// The shared rag.Retriever is constructed per-feature so the
	// rate-limit + cost-cap decorators on the embedding provider
	// apply per-strategy. The retriever uses the same
	// nomic-embed-text 768-dim physical table as the other RAG
	// slices; the per-feature source-type allowlist
	// {idle_drain, vehicle_state, climate_state} is enforced in
	// retrieve_idle_drain_chunks's Validate. The feature is
	// registered as needing `ai_idle_drain_indexer` (gated
	// indexer stub — see internal/jobs/ai_idle_drain_indexer.go);
	// the F7 indexer fan-out point for those source types is
	// reserved by string but not yet wired to any embedding job.
	aiIdleDrainRetriever, err := rag.New(
		context.Background(),
		aiSettingsRepo,
		db,
		aiRegistry,
		vampiredrainexplanation.FeatureID,
		rag.ModelNomicEmbedText,
	)
	if err != nil {
		log.Fatal().Err(err).Msg("ai vampire-drain-explanation: rag.New failed during boot wiring")
	}
	// vampire-drain-explanation tools (Phase-50 / C5, slice 0030).
	// Adds `retrieve_idle_drain_chunks` + `query_vampire_drain_windows`
	// to the shared tool registry so the dispatcher can resolve
	// them for the vampire-drain-explanation strategy. Same
	// ordering rule as the other slice tools above: must be
	// registered before the handler constructor below so the
	// strategy's allowedTools resolve at boot.
	// query_vampire_drain_windows composes the SAME
	// *drivedb.VampireDrainRepo.Events + .Stats methods that
	// back the canonical baseline GET /vampire-drain + GET
	// /vampire-drain/stats handlers — no new SQL is written by
	// this slice.
	lifetime.RegisterVampireDrainExplanationTools(aiToolRegistry, lifetime.VampireDrainExplanationSources{
		Retriever: aiIdleDrainRetriever,
		Drains:    NewAIVampireDrainSource(drivedb.NewVampireDrainRepo(db.Pool)),
	})
	// vampire-drain-explanation handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiVampireDrainExplanationHandler := NewAIVampireDrainHandler(
		aiRegistry,
		aiToolRegistry,
		vampiredrainexplanation.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// preheat-precool-recommender tools (Phase-50 / T1, slice 0031).
	// Adds `draft_climate_schedule` + `validate_climate_schedule`
	// to the shared tool registry so the dispatcher can resolve
	// them for the preheat-precool-recommender strategy. Same
	// ordering rule as the other slice tools above: must be
	// registered before the handler constructor below so the
	// strategy's allowedTools resolve at boot. The
	// AIClimateScheduleAdvisor adapter implements the same
	// deterministic departure heuristic the SPA's manual
	// climate-controls baseline runs — no parallel SQL path,
	// no parallel write path; the LLM never persists.
	schedule.RegisterPreheatPrecoolRecommenderTools(aiToolRegistry, schedule.PreheatPrecoolRecommenderSources{
		Advisor: NewAIClimateScheduleAdvisor(),
	})
	// preheat-precool-recommender handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiPreheatPrecoolRecommenderHandler := NewAIClimateScheduleHandler(
		aiRegistry,
		aiToolRegistry,
		preheatprecoolrecommender.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// Phase-50 / 0032 — T2 cabin-temperature-impact-narrative
	// tool registration. The single read-only tool
	// `query_temperature_impact` is registered on the process-wide
	// tool registry so the dispatcher can resolve the strategy's
	// allowedTools at boot. The AITemperatureImpactSource adapter
	// runs the SAME bucket / monthly-trend SQL the canonical
	// TempImpactHandler.Get already runs — no parallel write
	// path; the LLM never persists.
	forecast.RegisterCabinTemperatureImpactNarrativeTools(aiToolRegistry, forecast.CabinTemperatureImpactNarrativeSources{
		Source: NewAITemperatureImpactSource(db),
	})
	// cabin-temperature-impact-narrative handler. One per
	// process; stateless beyond constructor inputs. Must be
	// constructed AFTER the tool registration above so the
	// dispatcher can resolve the strategy's allowedTools at boot.
	aiCabinTemperatureImpactNarrativeHandler := NewAICabinTemperatureImpactHandler(
		aiRegistry,
		aiToolRegistry,
		cabintemperatureimpactnarrative.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Phase-50 / 0033 — T3 tire-pressure-trend-reasoning tool
	// registration. The single read-only tool
	// `query_tire_pressure_trend` is registered on the
	// process-wide tool registry so the dispatcher can resolve
	// the strategy's allowedTools at boot. The
	// AITirePressureTrendSource adapter runs the SAME
	// signal.StateReader.Timeline projection the canonical
	// TirePressureHandler.List already runs — no parallel write
	// path; the LLM never persists.
	maintenance.RegisterTirePressureTrendReasoningTools(aiToolRegistry, maintenance.TirePressureTrendReasoningSources{
		Source: NewAITirePressureTrendSource(stateReader),
	})
	// tire-pressure-trend-reasoning handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiTirePressureTrendReasoningHandler := NewAITirePressureTrendHandler(
		aiRegistry,
		aiToolRegistry,
		tirepressuretrendreasoning.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Phase-50 / 0034 — A1 alert-tuning-suggestions tool
	// registration. The single read-only tool
	// `draft_alert_rule_patch` is registered on the
	// process-wide tool registry so the dispatcher can resolve
	// the strategy's allowedTools at boot. The `validate_alert_rule`
	// tool used by this strategy was already registered by N1
	// (slice 0015) above; the dispatcher resolves both at boot
	// from the SAME registry. AIAlertTuningSource adapts the
	// canonical AlertRuleRepo + NotificationRepo so the LLM
	// reads the SAME rows the manual AlertStudio path reads —
	// no parallel write path; the LLM never persists.
	alert.RegisterAlertTuningSuggestionsTools(aiToolRegistry, alert.AlertTuningSuggestionsSources{
		Source: NewAIAlertTuningSource(dbalert.NewAlertRuleRepo(db), dbnotif.NewNotificationRepo(db)),
	})
	// alert-tuning-suggestions handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiAlertTuningHandler := NewAIAlertTuningHandler(
		aiRegistry,
		aiToolRegistry,
		alerttuningsuggestions.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Phase-50 / 0035 — A2 inbox-auto-categorization tool
	// registration. The two read-only tools
	// `draft_alert_categories` + `validate_alert_category`
	// are registered on the process-wide tool registry so
	// the dispatcher can resolve the strategy's allowedTools
	// at boot. AIInboxCategorizationSource adapts the
	// canonical NotificationRepo + AlertRuleRepo so the LLM
	// reads the SAME rows the manual InboxBody path reads —
	// no parallel write path; the LLM never persists.
	nl.RegisterInboxAutoCategorizationTools(aiToolRegistry, nl.InboxAutoCategorizationSources{
		Source: NewAIInboxCategorizationSource(dbnotif.NewNotificationRepo(db), dbalert.NewAlertRuleRepo(db)),
	})
	// inbox-auto-categorization handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiInboxCategorizationHandler := NewAIInboxCategorizationHandler(
		aiRegistry,
		aiToolRegistry,
		inboxautocategorization.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Phase-50 / 0036 — A3 cross-rule-conflict-detection tool
	// registration. The two read-only tools
	// `query_alert_rules` + `detect_rule_conflicts` are
	// registered on the process-wide tool registry so the
	// dispatcher can resolve the strategy's allowedTools at
	// boot. AICrossRuleConflictSource adapts the canonical
	// AlertRuleRepo so the LLM reads the SAME rows the manual
	// AlertStudio path reads — no parallel write path; the
	// LLM never persists. The pure-functional structural
	// detector lives in internal/ai/tools/cross_rule_conflict.go
	// (DetectRuleConflicts) and is exercised in unit tests
	// without IO.
	diagnostic.RegisterCrossRuleConflictDetectionTools(aiToolRegistry, diagnostic.CrossRuleConflictDetectionSources{
		Source: NewAICrossRuleConflictSource(dbalert.NewAlertRuleRepo(db)),
	})
	// cross-rule-conflict-detection handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiCrossRuleConflictHandler := NewAICrossRuleConflictHandler(
		aiRegistry,
		aiToolRegistry,
		crossruleconflictdetection.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Phase-50 / 0037 — G1 auto-name-unnamed-locations tool
	// registration. The two propose-only tools
	// `draft_location_name` + `validate_location_name` are
	// registered on the process-wide tool registry so the
	// dispatcher can resolve the strategy's allowedTools at
	// boot. AILocationSource derives the visited-location
	// aggregate from the SI canonical drives table (the legacy
	// visited_locations table was dropped in Phase-42 / Prompt
	// 0076; visited-location aggregates are derived on demand)
	// so the LLM reads the SAME aggregate the canonical
	// VisitedLocationRepo emits. AILocationNameValidator
	// mirrors the byte-equivalent shape rules the canonical
	// save handler will enforce (1-200 chars, no control chars,
	// no leading/trailing whitespace).
	location.RegisterAutoNameUnnamedLocationsTools(aiToolRegistry, location.AutoNameUnnamedLocationsSources{
		Locations: NewAILocationSource(db),
		Validator: NewAILocationNameValidator(),
	})
	// auto-name-unnamed-locations handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiAutoNameUnnamedLocationsHandler := NewAIAutoNameUnnamedLocationsHandler(
		aiRegistry,
		aiToolRegistry,
		autonameunnamedlocations.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// Phase-50 / 0038 — G2 suggest-new-geofences tool registration.
	// The two propose-only tools `draft_geofence` +
	// `validate_geofence` are registered on the process-wide tool
	// registry so the dispatcher can resolve the strategy's
	// allowedTools at boot. We REUSE the slice-0037
	// *AILocationSource adapter — both strategies grok the same
	// *geomodel.VisitedLocation aggregate (drives-table grouped on
	// vehicle_id + end_place), so duplicating the adapter would
	// be a wiring smell rather than an actual decoupling.
	// AISuggestGeofenceValidator mirrors the byte-equivalent
	// shape rules the canonical geofence_handler.go's
	// validateGeofence enforces (1-200 chars, no control chars,
	// no leading/trailing whitespace, radius 50-1000 meters).
	location.RegisterSuggestNewGeofencesTools(aiToolRegistry, location.SuggestNewGeofencesSources{
		Locations: NewAILocationSource(db),
		Validator: NewAISuggestGeofenceValidator(),
	})
	// suggest-new-geofences handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiSuggestNewGeofencesHandler := NewAISuggestNewGeofencesHandler(
		aiRegistry,
		aiToolRegistry,
		suggestnewgeofences.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// Phase-50 / 0039 — G3 geofence-aware-automation-suggestions
	// handler. The strategy REUSES the slice-0016
	// nl-automation-builder tool pair (draft_automation_graph +
	// validate_automation_graph) registered earlier in this file
	// for the AIAutomationHandler — re-registering would panic on
	// duplicate name. The handler ALSO needs read access to the
	// user's existing geofence catalog so it can inject a
	// deterministic id+name+category list into the synthesised
	// user message; the LLM never sees lat/lon (PolicyAlertBuilder
	// denies coordinate prose). One per process; stateless beyond
	// constructor inputs.
	aiGeofenceAwareAutomationHandler := NewAIGeofenceAwareAutomationHandler(
		aiRegistry,
		aiToolRegistry,
		geofenceawareautomationsuggestions.New(),
		geofencedb.NewGeofenceRepo(db),
		cfg.Auth.ForwardAuthHeader,
	)

	// learned-per-vehicle-anomaly-baselines (Phase-50 / ML1, slice
	// 0062) tools — train_anomaly_baseline + query_anomaly_baseline.
	// Both READ-only; the trainer reads signal_log via the
	// AISignalSampleSource adapter and returns a per-signal learned
	// envelope (mean / stddev / p5 / p95) clamped to the static
	// safe-range envelope, with safe-range fallback per signal when
	// fewer than anomaly.DefaultMinSamples observations exist in
	// the lookback window. Tools registered BEFORE the handler is
	// constructed so the dispatcher can resolve the strategy's
	// allowedTools at boot.
	predict.RegisterLearnedAnomalyBaselineTools(aiToolRegistry, predict.LearnedAnomalyBaselineSources{
		Trainer: anomaly.NewTrainer(NewAISignalSampleSource(db)),
	})
	// learned-per-vehicle-anomaly-baselines handler. One per
	// process; stateless beyond constructor inputs. Must be
	// constructed AFTER the tool registration above.
	aiLearnedAnomalyBaselinesHandler := NewAILearnedAnomalyBaselineHandler(
		aiRegistry,
		aiToolRegistry,
		learnedanomalybaselines.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// range-prediction-model (Phase-50 / ML2, slice 0063) tools —
	// train_range_model + query_range_prediction. Both READ-only;
	// the trainer reads the `drives` table via the AIDriveStatsSource
	// adapter (SI columns: distance_m, energy_used_wh, avg_speed_mps,
	// ambient_temp_c_avg per migration 000185) and returns a
	// per-bucket learned envelope (mean Wh/km plus stddev / p5 / p95)
	// with linear-fallback to the static heuristic curve per bucket
	// when fewer than mlrange.DefaultMinSamplesPerBucket=5 drives
	// exist in the lookback window. Tools registered BEFORE the
	// handler is constructed so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	predict.RegisterRangePredictorTools(aiToolRegistry, predict.RangePredictorSources{
		Trainer: mlrange.NewTrainer(NewAIDriveStatsSource(db)),
	})
	// range-prediction-model handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the tool
	// registration above.
	aiRangePredictionHandler := NewAIRangePredictionHandler(
		aiRegistry,
		aiToolRegistry,
		rangepredictionmodel.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// ml-charging-curve-clustering (Phase-50 / ML3, slice 0064) tools —
	// train_charge_curve_clusters + query_charge_curve_clusters.
	// Both READ-only; the trainer reads the `charging_sessions`
	// table via the AIChargingSessionSource adapter (SI columns
	// peak_power_w / avg_power_w / total_energy_wh / duration_min /
	// charger_type / start_time / etc per migration 000185) and
	// returns a per-cluster (L1/L2/DC/unknown) learned envelope
	// (mean peak power plus stddev / p5 / p95 per cluster, mean
	// avg power / total energy / duration / ramp shape; rule-label
	// fallback per cluster when fewer than
	// mlchargingcurves.DefaultMinSessionsPerCluster=3 sessions
	// exist in the lookback window). Tools registered BEFORE the
	// handler is constructed so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	charge.RegisterChargeCurveClustersTools(aiToolRegistry, charge.ChargeCurveClustersSources{
		Trainer: mlchargingcurves.NewTrainer(NewAIChargingSessionSource(chargingdb.NewChargingRepo(db))),
	})
	// ml-charging-curve-clustering handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiMLChargingCurveClusteringHandler := NewAIMLChargingCurveHandler(
		aiRegistry,
		aiToolRegistry,
		mlchargingcurveclustering.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	geocodeHandler := apigeocode.NewHandler(geocoding.NewSearcher("TeslaSync/1.0"), geocoding.NewGeocoder(cfg.GoogleMaps.APIKey, cfg.AzureMaps.APIKey))
	shareHandler := NewShareHandler(db)
	watchHandler := NewWatchHandler(db, teslaClient)
	onboardingHandler := apionboard.NewHandler(db, opt.Encryptor)
	searchHandler := apisearch.NewHandler(db)

	// Wire Redis signal cache to handlers that read live vehicle state.
	// driveHandler + chargingHandler now read live state via the
	// LiveStateReader boundary (composed once at the top of NewRouter), so
	// they no longer need a direct Redis cache injection. The remaining
	// handlers in this block still read raw Redis for their own narrow
	// purposes (wake state, command pre-checks, watch streams, range
	// projection short-cuts, signal-key listing) and keep the legacy
	// fluent setter until they migrate to LiveStateReader.
	//
	// redisSignalCache is also consumed by the Phase-50 / 0056 V2
	// AIWatchFaceNLContextSource adapter below; declaring it at this
	// outer scope lets the adapter reuse the same instance the
	// watchHandler already does (one cache per router). The variable
	// stays nil when CacheStore is unconfigured; the AI source
	// constructor tolerates nil and degrades to a vehicle-name-only
	// envelope (the canonical /watch/summary handler's degraded-mode
	// behaviour, mirrored honestly).
	var redisSignalCache *signal.RedisSignalCache
	if opt.CacheStore != nil {
		if rdb := opt.CacheStore.Underlying(); rdb != nil {
			redisSignalCache = signal.NewRedisSignalCache(rdb)
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
			vehicledb.NewVehicleRepo(db),
			energydb.NewCommandLogRepo(db),
			&settingsCheckerAdapter{settingsdb.NewSettingsRepo(db)},
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
	// *signaldb.SignalLogReader.SnapshotAt /
	// *signaldb.SignalHistoryWriter.SnapshotAt code paths that this prompt
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
	vehicleHandler.SetTelemetrySource(telemetryHandler)

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
		webhookReceiver := apiwhrx.NewHandler(opt.WebhookTrigger)
		r.With(
			httprate.Limit(60, 1*time.Minute, httprate.WithKeyFuncs(
				apiwhrx.WebhookTokenKeyFunc,
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
	webVitalsHandler := apivitals.NewHandler()
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
	webErrorHandler := apiwerr.NewHandler()
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
	authSessionHandler := apiauths.NewHandler(cfg)
	r.With(
		httprate.LimitByIP(60, 1*time.Minute),
	).Get("/api/v1/auth/session", authSessionHandler.Session)

	// System state (Phase 46 / Prompt 04): single-row maintenance/degraded-mode
	// banner state. Repo + handler + maintenance provider are constructed
	// once here so the GET /system/health closure and the admin POST share
	// the same store and env-vs-DB resolver semantics.
	systemStateRepo := systemdb.NewSystemStateRepo(db)
	adminMaintenanceHandler := apiadminmnt.NewAdminMaintenanceHandler(
		systemStateRepo,
		cfg,
		apiadminmnt.WithAuditFunc(func(r *http.Request, headerName, action, resource string, entityID *int64, detail string) {
			logAuditFromRequest(db, r, headerName, action, resource, entityID, detail)
		}),
	)
	maintenanceProvider := apiadminmnt.BuildMaintenanceProvider(systemStateRepo, cfg)

	// Phase 46 / Prompt 08: in-app feedback widget. Repo is shared
	// between the public POST ingest endpoint (rate-limited per
	// submitter) and the admin queue endpoints (list + patch + optional
	// GitHub Issues bridge). The bridge is wired at construction time
	// from cfg.GitHub; when Repo or Token is empty, NewGitHubIssuesClient
	// returns nil and the admin endpoint flips github_bridge_enabled to
	// false in its response so the SPA hides the Forward action.
	userFeedbackRepo := dbuser.NewUserFeedbackRepo(db)
	feedbackHandler := apifb.NewHandler(userFeedbackRepo, cfg)
	githubIssuesClient := integrations.NewGitHubIssuesClient(integrations.GitHubIssuesConfig{
		Repo:  cfg.GitHub.Repo,
		Token: cfg.GitHub.Token,
	})
	var githubBridge apiadminfb.GitHubIssuesPoster
	if githubIssuesClient != nil {
		githubBridge = githubIssuesClient
	}
	adminFeedbackHandler := apiadminfb.NewAdminFeedbackHandler(userFeedbackRepo, cfg, db, githubBridge)

	// feedback-queue-triage (Phase-50 / S5, slice 0046).
	// The shared rag.Retriever is constructed per-feature so the
	// rate-limit + cost-cap decorators on the embedding provider
	// apply per-strategy. The retriever uses the same
	// nomic-embed-text 768-dim physical table as the other RAG
	// slices; the per-feature source-type allowlist
	// {feedback_item, audit_log} is enforced in
	// retrieve_feedback_chunks's Validate. Both source types are
	// reserved as strings (not promoted to rag.Source* constants)
	// for forward-compat without widening the F7 contract — a
	// future indexer slice will land the actual feedback / audit
	// chunk indexing.
	aiFeedbackTriageRetriever, err := rag.New(
		context.Background(),
		aiSettingsRepo,
		db,
		aiRegistry,
		feedbackqueuetriage.FeatureID,
		rag.ModelNomicEmbedText,
	)
	if err != nil {
		log.Fatal().Err(err).Msg("ai feedback-queue-triage: rag.New failed during boot wiring")
	}
	// feedback-queue-triage tools (Phase-50 / S5, slice 0046).
	// Adds `draft_feedback_triage` + `validate_feedback_triage` +
	// `retrieve_feedback_chunks` to the shared tool registry so
	// the dispatcher can resolve them for the
	// feedback-queue-triage strategy. Same ordering rule as the
	// other slice tools above: must be registered before the
	// handler constructor below so the strategy's allowedTools
	// resolve at boot. The Source is the production
	// AIFeedbackTriageSource adapter that wraps userFeedbackRepo
	// and PII-minimizes the row into a FeedbackTriageEntry.
	aiFeedbackTriageSource := NewAIFeedbackTriageSource(userFeedbackRepo)
	feedback.RegisterFeedbackQueueTriageTools(aiToolRegistry, feedback.FeedbackQueueTriageSources{
		Source:    aiFeedbackTriageSource,
		Retriever: aiFeedbackTriageRetriever,
	})
	// feedback-queue-triage handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiFeedbackQueueTriageHandler := NewAIFeedbackQueueTriageHandler(
		aiRegistry,
		aiToolRegistry,
		feedbackqueuetriage.New(),
		aiFeedbackTriageSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// mqtt-sse-inspector-explanations (Phase-50 / S6, slice 0047).
	// The shared rag.Retriever is constructed per-feature so the
	// rate-limit + cost-cap decorators on the embedding provider
	// apply per-strategy. The retriever uses the same
	// nomic-embed-text 768-dim physical table as the other RAG
	// slices; the per-feature source-type allowlist
	// {mqtt_status, sse_status, job_status} is enforced in
	// retrieve_stream_chunks's Validate. All three source types
	// are reserved as strings (not promoted to rag.Source*
	// constants) for forward-compat without widening the F7
	// contract — a future indexer slice will land the actual
	// broker / SSE / job chunk indexing.
	aiMqttSseInspectorExplanationsRetriever, err := rag.New(
		context.Background(),
		aiSettingsRepo,
		db,
		aiRegistry,
		mqttsseinspectorexplanations.FeatureID,
		rag.ModelNomicEmbedText,
	)
	if err != nil {
		log.Fatal().Err(err).Msg("ai mqtt-sse-inspector-explanations: rag.New failed during boot wiring")
	}
	// mqtt-sse-inspector-explanations tools (Phase-50 / S6, slice
	// 0047). Adds `query_stream_inspector` +
	// `retrieve_stream_chunks` to the shared tool registry so the
	// dispatcher can resolve them for the
	// mqtt-sse-inspector-explanations strategy. Same ordering
	// rule as the other slice tools above: must be registered
	// before the handler constructor below so the strategy's
	// allowedTools resolve at boot. The Source is the production
	// AIStreamInspectorSource adapter that returns a
	// deterministic empty envelope describing the bound window;
	// the canonical baseline /api/v1/admin/mqtt/status surface
	// remains reachable to the operator at all times.
	aiStreamInspectorSource := NewAIStreamInspectorSource()
	diagnostic.RegisterMqttSseInspectorExplanationsTools(aiToolRegistry, diagnostic.MqttSseInspectorExplanationsSources{
		Retriever:       aiMqttSseInspectorExplanationsRetriever,
		StreamInspector: aiStreamInspectorSource,
	})
	// mqtt-sse-inspector-explanations handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiMqttSseInspectorExplanationsHandler := NewAIMqttSseInspectorExplanationsHandler(
		aiRegistry,
		aiToolRegistry,
		mqttsseinspectorexplanations.New(),
		aiStreamInspectorSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// state-machine-debugger-narrator (Phase-50 / S7, slice 0048).
	// The shared rag.Retriever is constructed per-feature so the
	// rate-limit + cost-cap decorators on the embedding provider
	// apply per-strategy. The retriever uses the same
	// nomic-embed-text 768-dim physical table as the other RAG
	// slices; the per-feature source-type allowlist
	// {fsm_transition, signal_history_summary} is enforced in
	// retrieve_fsm_chunks's Validate. Both source types are
	// reserved as strings (not promoted to rag.Source* constants)
	// for forward-compat without widening the F7 contract — a
	// future indexer slice will land the actual fsm-transition /
	// signal-history chunk indexing.
	aiStateMachineDebuggerNarratorRetriever, err := rag.New(
		context.Background(),
		aiSettingsRepo,
		db,
		aiRegistry,
		statemachinedebuggernarrator.FeatureID,
		rag.ModelNomicEmbedText,
	)
	if err != nil {
		log.Fatal().Err(err).Msg("ai state-machine-debugger-narrator: rag.New failed during boot wiring")
	}
	// state-machine-debugger-narrator tools (Phase-50 / S7, slice
	// 0048). Adds `query_fsm_trace` + `retrieve_fsm_chunks` to
	// the shared tool registry so the dispatcher can resolve them
	// for the state-machine-debugger-narrator strategy. Same
	// ordering rule as the other slice tools above: must be
	// registered before the handler constructor below so the
	// strategy's allowedTools resolve at boot. The Source is the
	// production AIFSMTraceSource adapter that returns a
	// deterministic empty envelope describing the bound tuple;
	// the canonical baseline /api/v1/fsm/transitions surface
	// remains reachable to the operator at all times.
	aiFSMTraceSource := NewAIFSMTraceSource()
	summary.RegisterStateMachineDebuggerNarratorTools(aiToolRegistry, summary.StateMachineDebuggerNarratorSources{
		Retriever: aiStateMachineDebuggerNarratorRetriever,
		FSMTrace:  aiFSMTraceSource,
	})
	// state-machine-debugger-narrator handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiStateMachineDebuggerNarratorHandler := NewAIStateMachineDebuggerNarratorHandler(
		aiRegistry,
		aiToolRegistry,
		statemachinedebuggernarrator.New(),
		aiFSMTraceSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// predictive-maintenance retriever (Phase-50 / M1, slice
	// 0049). The strategy's retrieve_maintenance_chunks tool
	// composes a thin wrapper around this rag.Retriever
	// scoped to {maintenance_event, vehicle_state, ml_anomaly}
	// source types — the allowlist is enforced at the tool
	// boundary by retrieve_maintenance_chunks's Validate. All
	// three source types are reserved as strings (not promoted
	// to rag.Source* constants) for forward-compat without
	// widening the F7 contract — future indexer slices will
	// land the actual maintenance-event / vehicle-state /
	// ml-anomaly chunk indexing.
	aiPredictiveMaintenanceRetriever, err := rag.New(
		context.Background(),
		aiSettingsRepo,
		db,
		aiRegistry,
		predictivemaintenance.FeatureID,
		rag.ModelNomicEmbedText,
	)
	if err != nil {
		log.Fatal().Err(err).Msg("ai predictive-maintenance: rag.New failed during boot wiring")
	}
	// predictive-maintenance tools (Phase-50 / M1, slice 0049).
	// Adds `query_maintenance_context` + `retrieve_maintenance_chunks`
	// to the shared tool registry so the dispatcher can resolve
	// them for the predictive-maintenance strategy. Same ordering
	// rule as the other slice tools above: must be registered
	// before the handler constructor below so the strategy's
	// allowedTools resolve at boot. The Source is the production
	// AIPredictiveMaintenanceContextSource adapter that wraps the
	// SAME default-items + Redis-odometer reader the canonical
	// baseline /api/v1/maintenance handler already serves; the
	// canonical baseline surface remains reachable to the
	// operator at all times. The Redis signal cache is recreated
	// locally here (the canonical maintenanceHandler creation
	// site's cache is out of scope by this point) using the same
	// opt.CacheStore check; nil Redis ⇒ unknown-mileage fallback
	// (the source reports current_mileage as nil pointer, and
	// the strategy's system prompt instructs the LLM to prefer
	// time-based reasoning when current_mileage is null).
	var aiPredictiveMaintenanceRedisCache *signal.RedisSignalCache
	if opt.CacheStore != nil {
		if rdb := opt.CacheStore.Underlying(); rdb != nil {
			aiPredictiveMaintenanceRedisCache = signal.NewRedisSignalCache(rdb)
		}
	}
	aiPredictiveMaintenanceContextSource := NewAIPredictiveMaintenanceContextSource(db, aiPredictiveMaintenanceRedisCache)
	maintenance.RegisterPredictiveMaintenanceTools(aiToolRegistry, maintenance.PredictiveMaintenanceSources{
		Retriever:          aiPredictiveMaintenanceRetriever,
		MaintenanceContext: aiPredictiveMaintenanceContextSource,
	})
	// predictive-maintenance handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiPredictiveMaintenanceHandler := NewAIPredictiveMaintenanceHandler(
		aiRegistry,
		aiToolRegistry,
		predictivemaintenance.New(),
		aiPredictiveMaintenanceContextSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// tco-narration tools (Phase-50 / M2, slice 0050). Adds
	// `query_tco_summary` to the shared tool registry so the
	// dispatcher can resolve it for the tco-narration
	// strategy. Must be registered before the handler
	// constructor below so the strategy's allowedTools resolve
	// at boot. The TCOSummarizer adapter delegates to the same
	// package-level api.ComputeTCOSummary helper that also
	// backs the canonical GET /api/v1/analytics/tco handler —
	// the AI narrator quotes the SAME deterministic envelope
	// the chart renders (no duplicated SQL).
	lifetime.RegisterTCONarrationTools(aiToolRegistry, lifetime.TCONarrationSources{
		Summarizer: NewAITCOSummarizer(db),
	})
	// tco-narration handler. One per process; stateless beyond
	// constructor inputs. Must be constructed AFTER the tool
	// registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiTCONarrationHandler := NewAITCONarrationHandler(
		aiRegistry,
		aiToolRegistry,
		tconarration.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// software-update-changelog-summarizer retriever (Phase-50
	// / M3, slice 0051). The strategy's retrieve_update_notes
	// tool composes a thin wrapper around this rag.Retriever
	// scoped to {software_update, docs} source types — the
	// allowlist is enforced at the tool boundary by
	// retrieve_update_notes's Validate. Both source types are
	// reserved as strings (not promoted to rag.Source*
	// constants) for forward-compat without widening the F7
	// contract — the future ai_update_notes_indexer slice will
	// land the actual per-version release-note chunk indexing
	// (the ai_update_notes_indexer cron job in this slice
	// ships as a fail-closed stub).
	aiSoftwareUpdateChangelogSummarizerRetriever, err := rag.New(
		context.Background(),
		aiSettingsRepo,
		db,
		aiRegistry,
		softwareupdatechangelogsummarizer.FeatureID,
		rag.ModelNomicEmbedText,
	)
	if err != nil {
		log.Fatal().Err(err).Msg("ai software-update-changelog-summarizer: rag.New failed during boot wiring")
	}
	// software-update-changelog-summarizer tools (Phase-50 /
	// M3, slice 0051). Adds `query_vehicle_software` +
	// `retrieve_update_notes` to the shared tool registry so
	// the dispatcher can resolve them for the
	// software-update-changelog-summarizer strategy. Same
	// ordering rule as the other slice tools above: must be
	// registered before the handler constructor below so the
	// strategy's allowedTools resolve at boot. The
	// VehicleSoftware adapter wraps the SAME
	// systemdb.SoftwareUpdateRepo.GetByVehicle reader the
	// canonical baseline GET /api/v1/vehicles/{id}/software-updates
	// handler already serves; the canonical baseline surface
	// remains reachable to the operator at all times.
	aiVehicleSoftwareSource := NewAIVehicleSoftwareSource(systemdb.NewSoftwareUpdateRepo(db))
	summary.RegisterSoftwareUpdateChangelogSummarizerTools(aiToolRegistry, summary.SoftwareUpdateChangelogSummarizerSources{
		Retriever:       aiSoftwareUpdateChangelogSummarizerRetriever,
		VehicleSoftware: aiVehicleSoftwareSource,
	})
	// software-update-changelog-summarizer handler. One per
	// process; stateless beyond constructor inputs. Must be
	// constructed AFTER the tool registration above so the
	// dispatcher can resolve the strategy's allowedTools at
	// boot.
	aiSoftwareUpdateChangelogSummarizerHandler := NewAISoftwareUpdateChangelogSummarizerHandler(
		aiRegistry,
		aiToolRegistry,
		softwareupdatechangelogsummarizer.New(),
		aiVehicleSoftwareSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// pii-redaction-shared-exports tools (Phase-50 / P1, slice
	// 0052). Adds `draft_export_redaction_plan` +
	// `validate_export_redaction_plan` to the shared tool
	// registry so the dispatcher can resolve them for the
	// pii-redaction-shared-exports strategy. Both tools wrap a
	// STATIC in-process Go catalog and a pure-Go validator; NO
	// database IO is performed by either tool. The
	// deterministic GET/POST /api/v1/export/jobs endpoints
	// remain the canonical baseline export pipeline; this
	// slice's tools never trigger an export and never touch the
	// existing handlers. Registered AFTER the slice 0051 tools
	// above so the registry's Names list grows deterministically.
	export.RegisterPiiRedactionSharedExportsTools(aiToolRegistry)
	// pii-redaction-shared-exports handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiPiiRedactionSharedExportsHandler := NewAIPiiRedactionSharedExportsHandler(
		aiRegistry,
		aiToolRegistry,
		piiredactionsharedexports.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// quiet-hours-suggestion tools (Phase-50 / P2, slice
	// 0053). Adds `draft_quiet_hours_window` +
	// `validate_quiet_hours_window` to the shared tool
	// registry so the dispatcher can resolve them for the
	// quiet-hours-suggestion strategy. The draft tool wraps
	// the canonical NotificationRepo + QuietHoursRepo readers
	// (per-hour aggregation of non-critical notification_logs
	// in the user's local timezone, plus the count of existing
	// quiet-hours windows); NO new SQL is written and the
	// validator is pure-Go. The deterministic
	// /api/v1/notifications/quiet-hours endpoints remain the
	// canonical baseline write path; this slice's tools never
	// trigger a save and never touch the existing handlers.
	// Registered AFTER the slice 0052 tools above so the
	// registry's Names list grows deterministically.
	aiQuietHoursSuggestionSource := NewAIQuietHoursSuggestionSource(
		dbnotif.NewNotificationRepo(db),
		quiethoursdb.NewQuietHoursRepo(db),
	)
	schedule.RegisterQuietHoursSuggestionTools(aiToolRegistry, schedule.QuietHoursSuggestionSources{
		Source: aiQuietHoursSuggestionSource,
	})
	// quiet-hours-suggestion handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiQuietHoursSuggestionHandler := NewAIQuietHoursSuggestionHandler(
		aiRegistry,
		aiToolRegistry,
		quiethourssuggestion.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// safety-setting-explainer (Phase-50 / 0054 P3) source.
	// Wraps the canonical SettingsRepo so the AI tool reads
	// the SAME settings row the deterministic Settings UI
	// already does — no new SQL, no duplicate read paths.
	// The tool surfaces a typed envelope of every safety-
	// related toggle (quiet hours, alert digest mode,
	// critical-flash, tab-badge, api_suspended) so the LLM
	// can quote current_value + default_value verbatim and
	// never invents a setting that does not exist. Tool
	// produces NO mutations and never triggers a save and
	// never touches the existing handlers. Registered AFTER
	// the slice 0053 tools above so the registry's Names
	// list grows deterministically.
	aiSafetySettingExplainerSource := NewAISafetySettingExplainerSource(aiSettingsRepo)
	safety.RegisterSafetySettingExplainerTools(aiToolRegistry, safety.SafetySettingExplainerSources{
		Source: aiSafetySettingExplainerSource,
	})
	// safety-setting-explainer handler. One per process;
	// stateless beyond constructor inputs. Must be
	// constructed AFTER the tool registration above so the
	// dispatcher can resolve the strategy's allowedTools at
	// boot.
	aiSafetySettingExplainerHandler := NewAISafetySettingExplainerHandler(
		aiRegistry,
		aiToolRegistry,
		safetysettingexplainer.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// voice-mode (Phase-50 / 0055 V1) sources.
	// The voice-mode AI surface layers an opt-in browser
	// STT/TTS conversational overlay on top of the existing
	// /chatbot text panel. Its single read-only tool
	// stream_chatbot_response bundles:
	//
	//   - the recent chat history for the in-scope session
	//     (read via the canonical *dbnotif.ChatRepo — the
	//     SAME repo the deterministic /chatbot endpoint uses)
	//   - the install-wide vehicle snapshot (VIN, display_name,
	//     soc_percent, charging_state, last_drive_summary —
	//     projected from VehicleRepo + LiveStateReader +
	//     DriveRepo so the LLM reads the SAME values the rest
	//     of the API surface already does; GPS / street names
	//     are deliberately omitted)
	//
	// NO new SQL is written; both adapters wrap existing
	// readers. Registered AFTER the slice 0054 tools above so
	// the registry's Names list grows deterministically.
	aiVoiceModeChatSource := NewAIVoiceModeChatContextSource(dbnotif.NewChatRepo(db))
	aiVoiceModeVehicleSource := NewAIVoiceModeVehicleSnapshotSource(
		vehicledb.NewVehicleRepo(db),
		drivedb.NewDriveRepo(db),
		liveStateReader,
	)
	voice.RegisterVoiceModeTools(aiToolRegistry, voice.VoiceModeSources{
		Chat:    aiVoiceModeChatSource,
		Vehicle: aiVoiceModeVehicleSource,
	})
	// voice-mode handler. One per process; stateless beyond
	// constructor inputs. Must be constructed AFTER the tool
	// registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiVoiceModeHandler := NewAIVoiceModeHandler(
		dbnotif.NewChatRepo(db),
		aiRegistry,
		aiToolRegistry,
		voicemode.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// watch-face-nl-response (Phase-50 / 0056 V2) sources.
	// The watch-face-nl-response AI surface layers an opt-in
	// Helix narrator on top of the existing /watch deterministic
	// surface. Its single read-only tool query_watch_context
	// bundles:
	//
	//   - the primary-vehicle snapshot (vehicle_name from
	//     VehicleRepo + scalar live-state from the canonical
	//     RedisSignalCache — the SAME two readers the
	//     deterministic /watch/summary handler uses)
	//   - the trailing-24h non-critical recent-alert list,
	//     projected to {severity, age_seconds} pairs only (no
	//     title, no message body, no PII) — read via the
	//     canonical NotificationRepo.
	//
	// NO new SQL is written; both adapters wrap existing
	// readers. Registered AFTER the slice 0055 tools above so
	// the registry's Names list grows deterministically.
	aiWatchFaceNLContextSource := NewAIWatchFaceNLContextSource(
		vehicledb.NewVehicleRepo(db),
		redisSignalCache,
	)
	aiWatchFaceNLAlertHistorySource := NewAIWatchFaceNLAlertHistorySource(
		dbnotif.NewNotificationRepo(db),
	)
	nl.RegisterWatchFaceNLResponseTools(aiToolRegistry, nl.WatchFaceNLResponseSources{
		Source: aiWatchFaceNLContextSource,
		Alerts: aiWatchFaceNLAlertHistorySource,
	})
	// watch-face-nl-response handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiWatchFaceNLResponseHandler := NewAIWatchFaceNLResponseHandler(
		aiRegistry,
		aiToolRegistry,
		watchfacenlresponse.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// nl-sql-playground (Phase-50 / 0057 PU1) sources.
	// The nl-sql-playground AI surface layers an opt-in Helix
	// translator on top of the manual SQL editor at /power/sql.
	// Its two propose-only tools (draft_readonly_sql +
	// validate_readonly_sql) build a typed ReadonlySQLDraft for
	// the user to review and copy into the existing manual SQL
	// editor; the AI never executes SQL itself. The curated
	// install-wide schema catalog (drives, charging_sessions,
	// vehicles, alerts, signal_log_view) is hardcoded in
	// AINLSQLSchemaCatalogSourceImpl — adding a table is a
	// deliberate per-prompt decision, not a default. NO new SQL
	// is written by this slice; the executor remains the
	// canonical baseline manual editor + the user's Run button.
	// Registered AFTER the slice 0056 tools above so the
	// registry's Names list grows deterministically.
	aiNLSqlPlaygroundCatalogSource := NewAINLSQLSchemaCatalogSource()
	aiNLSqlPlaygroundValidator := NewAINLSQLValidator()
	nlq.RegisterNLSqlPlaygroundTools(aiToolRegistry, nlq.NLSqlPlaygroundSources{
		Validator: aiNLSqlPlaygroundValidator,
	})
	// nl-sql-playground handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiNLSqlPlaygroundHandler := NewAINLSQLPlaygroundHandler(
		aiRegistry,
		aiToolRegistry,
		nlsqlplayground.New(),
		aiNLSqlPlaygroundCatalogSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// nl-grafana-panel (Phase-50 / 0058 PU2) sources.
	// The nl-grafana-panel AI surface layers an opt-in Helix
	// translator on top of the manual Grafana panel JSON editor
	// at /power/grafana. Its two propose-only tools
	// (draft_grafana_panel + validate_grafana_panel) build a
	// typed GrafanaPanelDraft for the user to review and copy
	// into the existing manual JSON editor; the AI never pushes
	// to Grafana itself. The three curated install-wide
	// catalogs (panel-types, datasource-types, tables) are
	// hardcoded in AINLGrafanaPanelCatalogSourceImpl — adding
	// any of these is a deliberate per-prompt decision, not a
	// default. The table catalog is shared with nl-sql-playground
	// so the two slices stay in lock-step. Registered AFTER the
	// slice 0057 tools above so the registry's Names list grows
	// deterministically.
	aiNLGrafanaPanelCatalogSource := NewAINLGrafanaPanelCatalogSource()
	aiNLGrafanaPanelValidator := NewAINLGrafanaValidator()
	nlq.RegisterNLGrafanaPanelTools(aiToolRegistry, nlq.NLGrafanaPanelSources{
		Validator: aiNLGrafanaPanelValidator,
	})
	// nl-grafana-panel handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiNLGrafanaPanelHandler := NewAINLGrafanaPanelHandler(
		aiRegistry,
		aiToolRegistry,
		nlgrafanapanel.New(),
		aiNLGrafanaPanelCatalogSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// Phase-50 / 0059 — nl-dashboard-composer (PU3). Registers
	// the two propose-only typed tools (draft_dashboard_layout +
	// validate_dashboard_layout) with the same shared
	// install-wide tool registry so the dispatcher can resolve
	// them by name when the strategy's allowedTools whitelist is
	// applied. The tools share the SAME single-dimension
	// allowlist enforcement: every slot.panel_name MUST be in
	// the in-scope curated panel catalog the handler installs in
	// ctx via nlq.WithDashboardComposerScope. The validator is
	// permissive (shape checks already in the tool); kept as an
	// adapter for future semantic checks. The curated install-
	// wide panel catalog (six install-wide panel templates) is
	// hardcoded in AINLDashboardComposerCatalogSourceImpl —
	// adding a panel is a deliberate per-prompt decision, not a
	// default. Registered AFTER nl-grafana-panel above so the
	// registry's Names list grows deterministically.
	aiNLDashboardComposerCatalogSource := NewAINLDashboardComposerCatalogSource()
	aiNLDashboardComposerValidator := NewAINLDashboardComposerValidator()
	nlq.RegisterNLDashboardComposerTools(aiToolRegistry, nlq.NLDashboardComposerSources{
		Validator: aiNLDashboardComposerValidator,
	})
	// nl-dashboard-composer handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiNLDashboardComposerHandler := NewAINLDashboardComposerHandler(
		aiRegistry,
		aiToolRegistry,
		nldashboardcomposer.New(),
		aiNLDashboardComposerCatalogSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// trip-postcard-share-card-image-generation (Phase-50 / 0060,
	// GEN1 slice). Registers the propose-only draft_image_prompt
	// + render_share_card_preview tools on the shared registry so
	// the dispatcher can resolve them when the strategy runs;
	// production wiring reuses the existing *tripdb.TripsDetailRepo
	// (same read path the GET /api/v1/trips/{id} baseline handler
	// uses). Registered AFTER nl-dashboard-composer above so the
	// registry's Names list grows deterministically.
	trip.RegisterTripPostcardShareCardImageGenerationTools(aiToolRegistry, trip.TripPostcardShareCardImageGenerationSources{
		Details: aiAutoTripNamingDetailRepo,
	})
	// trip-postcard-share-card-image-generation handler. One per
	// process; stateless beyond constructor inputs. Must be
	// constructed AFTER the tool registration above so the
	// dispatcher can resolve the strategy's allowedTools at boot.
	aiTripPostcardShareCardImageGenerationHandler := NewAITripPostcardShareCardImageGenerationHandler(
		aiRegistry,
		aiToolRegistry,
		trippostcardsharecardimagegeneration.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// vehicle-paint-preview (Phase-50 / 0061, GEN2 slice). Registers
	// the propose-only draft_paint_preview_prompt tool on the shared
	// registry so the dispatcher can resolve it when the strategy
	// runs; production wiring reuses *vehicledb.VehicleRepo (the same
	// read path the GET /api/v1/vehicles handlers already use, so
	// no new SQL is added). Registered AFTER trip-postcard above so
	// the registry's Names list grows deterministically.
	paint.RegisterVehiclePaintPreviewTools(aiToolRegistry, paint.VehiclePaintPreviewSources{
		Vehicles: vehicledb.NewVehicleRepo(db),
	})
	// vehicle-paint-preview handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiVehiclePaintPreviewHandler := NewAIVehiclePaintPreviewHandler(
		aiRegistry,
		aiToolRegistry,
		vehiclepaintpreview.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// Phase-46 / Prompt 40 — rate-limit status counters. Construct two
	// sliding-window observers (one for every /api/v1 request, one
	// scoped to writes only) and a handler that joins them with the
	// Tesla client's bucket snapshot. Counters are attached as plain
	// chi middleware below; the GET /system/rate-limits route reads
	// from them on demand.
	apiRequestCounter := platform.NewWindowCounter()
	apiWriteCounter := platform.NewWindowCounter()
	rateLimitHandler := apiratelim.NewHandler(apiratelim.RateLimitHandlerConfig{
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
	var queueHeartbeatStore workerdb.WorkerStatusStore
	if opt.CacheStore != nil {
		if rdb := opt.CacheStore.Underlying(); rdb != nil {
			queueHeartbeatStore = workerdb.NewRedisWorkerStatusStore(rdb)
		}
	}
	if queueHeartbeatStore == nil {
		queueHeartbeatStore = workerdb.NewMemoryWorkerStatusStore()
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
			if p == apiadminls.AdminLogStreamPath {
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
				// Phase-44 / observability-batch / Prompt F10 —
				// Drive-end diagnostic. Returns the fsm_transitions
				// + signal_window centered on the drive's end_ts
				// (or NOW for in-progress drives), explaining WHY
				// the FSM ended the drive. Read-only, 60/min IP
				// throttle, inherits /api/v1 forward-auth gate.
				driveDiagnosticHandler := apidrived.NewHandler(
					drivedb.NewDriveRepo(db),
					drivedb.NewDriveDiagnosticRepo(db.Pool),
				)
				r.With(httprate.LimitByIP(60, 1*time.Minute)).
					Get("/why-ended", driveDiagnosticHandler.Get)
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
			r.Post("/settings/ai/validate-config", AISettingsValidateHandler(aiRegistry, aiSettingsReader{repo: aiSettingsRepo}))
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
			gasPriceHandler := apigas.NewHandler(db, opt.GasPriceWorker)
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
		vampireDrainHandler := apivamp.NewVampireDrainHandler(drivedb.NewVampireDrainRepo(db.Pool))
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
		mileageHandler := apimileage.NewHandler(drivedb.NewMileageRepo(db.Pool))
		r.Route("/mileage", func(r chi.Router) {
			r.Use(httprate.LimitByIP(60, 1*time.Minute))
			r.Get("/monthly", mileageHandler.Monthly)
			r.Get("/stats", mileageHandler.Stats)
			// Phase-43a / Prompt 0009 (fix/misc-fixes): per-day buckets
			// for MileagePage.tsx's "Odometer Over Time" + "Daily
			// Distance" charts. Page was 404ing since Phase-42/0077
			// deleted the legacy daily_mileage handler.
			r.Get("/daily", mileageHandler.Daily)
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
		tripsDetailHandler := apitripsd.NewHandler(tripdb.NewTripsDetailRepo(db.Pool))
		r.With(httprate.LimitByIP(60, 1*time.Minute)).Get("/trips/{trip_id}", tripsDetailHandler.Get)

		// Phase-43a / Prompt 0003: /vehicle-states/{timeline,summary} restored
		// after Phase-42 prompt 0077 removed them with the vehicle_states
		// snapshot table. The two endpoints are now derived from
		// fsm_transitions (mig 000187) filtered to fsm_name='vehicle' so
		// frontend hooks useStateTimeline / useTimeline / useStateSummary
		// stop returning 404. Same admin-style rate limit as /system/queues
		// (Phase-46 / Prompt 41 precedent).
		vehicleStatesHandler := apivehstates.NewHandler(vehicledb.NewVehicleStatesRepo(db.Pool))
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
				fsmTransRepo := dbobs.NewFSMTransitionRepo(db)
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
			r.Get("/openapi", apiopenapi.Handler())

			// Phase-46 / Prompt 33 — Aggregated self-test endpoint.
			// Single click runs ~10 checks (DB, MQTT, Redis, Tesla
			// token + breaker, signal_log freshness, migrations,
			// runtime, health monitor) and returns a structured
			// DiagnosticReport. Per-IP rate-limited because each
			// call fans out concurrent probes against every shared
			// dependency.
			diagnosticHandler := apidiag.NewHandler(db, teslaClient, mqttClient, opt.CacheStore, health, cfg)
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
				QueueRepo:      workerdb.NewWorkerQueueRepo(db),
				HeartbeatStore: queueHeartbeatStore,
			})
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/queues", queueStatusHandler.ServeStatus)
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/queues/{worker}/jobs", queueStatusHandler.ServeJobs)

			// Phase-44 / observability-batch / Prompt F4 — DLQ
			// Inspector. List + per-entry GET are read-only and
			// per-IP throttled at 60/min. Replay is gated by
			// sudo-token (RequireSudo) AND by DLQ_REPLAY_ENABLED
			// (cfg.Features.DLQReplayEnabled). Audit endpoints
			// are read-only. The handler degrades to 503 when
			// opt.DLQInspector or opt.DLQReplayAuditRepo is nil,
			// so a deployment without MQTT still serves the rest
			// of /system unchanged.
			dlqHandler := apidlq.NewHandler(
				opt.DLQInspector,
				opt.DLQReplayAuditRepo,
				cfg.Auth.ForwardAuthHeader,
				cfg.Features.DLQReplayEnabled,
			)
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/dlq", dlqHandler.List)
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/dlq/audit", dlqHandler.Audit)
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/dlq/{id}", dlqHandler.Get)
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/dlq/{id}/audit", dlqHandler.Audit)
			r.With(
				httprate.LimitByIP(10, 1*time.Minute),
				RequireSudo(sudoStore, sudoCfg),
			).Post("/dlq/{id}/replay", dlqHandler.Replay)

			// Phase-44 / observability-batch / Prompt F8 — Feature
			// Flags. List + GET + audit are read-only (60/min).
			// PUT + DELETE are sudo-gated + audited via the
			// feature_flag_changes table; the dynamic
			// internal/flags store invalidates other processes via
			// Redis Pub/Sub. The handler degrades to 503 when
			// opt.FlagStore is nil so a redis-disabled deployment
			// still serves the rest of /system unchanged.
			flagsHandler := apiflagsh.NewHandler(
				opt.FlagStore,
				opt.FeatureFlagChangesRepo,
				cfg.Auth.ForwardAuthHeader,
			)
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/flags", flagsHandler.List)
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/flags/changes", flagsHandler.Changes)
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/flags/{key}", flagsHandler.Get)
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/flags/{key}/changes", flagsHandler.Changes)
			r.With(
				httprate.LimitByIP(20, 1*time.Minute),
				RequireSudo(sudoStore, sudoCfg),
			).Put("/flags/{key}", flagsHandler.Set)
			r.With(
				httprate.LimitByIP(20, 1*time.Minute),
				RequireSudo(sudoStore, sudoCfg),
			).Delete("/flags/{key}", flagsHandler.Delete)

			// Phase-44 / observability-batch / Prompt F6 —
			// Per-vehicle ingest X-Ray. Returns per-field
			// sample counts + last-seen + time-bucket histogram
			// over a configurable window. Read-only, 60/min IP
			// throttle, inherits /api/v1 forward-auth gate. The
			// vehicleID is in the URL because the cost of an
			// unbounded fleet-wide query is too high for the
			// signal_log hypertable.
			ingestXRayHandler := apixray.NewHandler(dbobs.NewIngestXRayRepo(db.Pool))
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/ingest-xray/{vehicleID}", ingestXRayHandler.Get)
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
		incidentsRepo := dbobs.NewIncidentRepo(db)
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

		// Phase-45 — Operator confidence admin surface. Five
		// read-only observability routes + audit viewer + GDPR
		// export download. Each backing repo can be nil; the
		// handler returns 503 SUBSYSTEM_NOT_CONFIGURED instead of
		// crashing. Sudo gating is intentionally NOT applied yet —
		// the routes are read-only (or stream-only for GDPR
		// download which is governed by the artifact's expires_at
		// TTL); a future tightening will move them behind the
		// sudoStore middleware once the page-builder UI is shipped.
		adminobsSvc := adminobssvc.New(adminobssvc.Options{
			Rotation:      opt.RotationTracker,
			SchemaPool:    db.Pool,
			SchemaSeed:    opt.SchemaSeed,
			SlowQueries:   opt.SlowQueriesRepo,
			Hypertable:    opt.HypertableMetricsRepo,
			IngestXRay:    opt.IngestXRayRepo,
			AuditRecorder: opt.AuditRecorder,
			ExcludeTables: []string{"schema_migrations"},
		})
		auditViewerSvc := auditviewersvc.New(opt.AuditLogQueryRepo, opt.AuditRecorder)
		v1AdminObs := v1handlers.NewAdminObservabilityHandler(adminobsSvc)
		v1AdminAudit := v1handlers.NewAdminAuditHandler(auditViewerSvc)
		v1GDPRExport := v1handlers.NewGDPRExportHandler(gdprexportsvc.New(opt.GDPRArtifactRepo))
		r.Group(func(r chi.Router) {
			r.Use(httprate.LimitByIP(60, 1*time.Minute))
			r.Use(handlermw.QueryBudget(handlermw.QueryBudgets{
				"GET /admin/observability/schema-drift":    5,
				"GET /admin/observability/slow-queries":    3,
				"GET /admin/observability/vehicle-cost":    3,
				"GET /admin/observability/disk-forecast":   5,
				"GET /admin/observability/secret-rotation": 2,
				"GET /admin/observability/slo":             3,
				"GET /admin/observability/data-quality":    3,
				"GET /admin/observability/lineage":         1,
				"GET /admin/observability/synthetic":       1,
				"GET /admin/audit-log":                     3,
				"GET /admin/audit-log/categories":          2,
				"GET /admin/audit-log/actions":             2,
				"GET /admin/audit-log/verify":              2,
				"GET /admin/gdpr/exports/{id}":             2,
			}))
			v1AdminObs.Register(r)
			v1AdminAudit.Register(r)
			v1GDPRExport.Register(r)

			// Phase-46 SOTA observability batch (p46-slo, p46-dq-lineage,
			// p46-synthetic). Each handler degrades to 503 SUBSYSTEM_NOT_CONFIGURED
			// when its backing subsystem wasn't wired in opt — see
			// RouterOptions for the optionality contract.
			sloHandler := apislo.NewHandler(opt.SLOCatalog, opt.SLOTracker)
			r.Get("/admin/observability/slo", sloHandler.Snapshot)

			dqHandler := apidq.NewHandler(opt.DataQualityScorer)
			r.Get("/admin/observability/data-quality", dqHandler.Score)
			r.Get("/admin/observability/lineage", dqHandler.Lineage)

			syntheticHandler := apisynthetic.NewHandler(opt.SyntheticRunner)
			r.Get("/admin/observability/synthetic", syntheticHandler.Snapshot)
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
		// Last-hour rolling counts read from the same web error handler
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
		signalsCatalogHandler := apisigcat.NewHandler(signaldb.NewSignalsCatalogRepo(db.Pool))
		r.With(httprate.LimitByIP(60, 1*time.Minute)).Get("/signals/catalog", signalsCatalogHandler.Catalog)
		r.With(httprate.LimitByIP(60, 1*time.Minute)).Get("/signals/observations", signalsCatalogHandler.Observations)

		// Signal routes
		r.Route("/signals/{vehicleID}", func(r chi.Router) {
			// Signal History (Postgres primary, MongoDB optional fallback)
			if telemetryHandler != nil {
				var mongoRepo *signaldb.SignalLogRepo
				if telemetryHandler.signalLogRepo != nil {
					mongoRepo = telemetryHandler.signalLogRepo
				}
				signalHandler := apisignal.NewHandler(mongoRepo)
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
				signalHandler := apisignal.NewHandler(nil)
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
		exportColumnsHandler := apiexpcol.NewHandler()
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

		// Wire OTel FSM tracers so every Fire() emits a span. The fsm.Tracer
		// port is implemented by tracing.NewFSMTracer (the OTel adapter); the
		// svc layer depends only on the port (ADR-006: zero-deps domain).
		// Each tracer name surfaces as the instrumentation scope in Tempo, so
		// dashboards can filter `fsm.vehicle` vs `fsm.charging` etc.
		vehicleSvc.SetTracer(tracing.NewFSMTracer("fsm.vehicle"))
		chargingSvc.SetTracer(tracing.NewFSMTracer("fsm.charging"))
		exportSvc.SetTracer(tracing.NewFSMTracer("fsm.export"))

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
		mountAIRoutes(r, aiGuard, aiRegistry, aiSettingsRepo, RequireSudo(sudoStore, sudoCfg), aiChatbotHandler, aiDigestHandler, aiYIRHandler, aiAnomalyHandler, aiAlertHandler, aiAutomationHandler, aiSearchHandler, aiDriveCoachHandler, aiChargingDiagnosisHandler, aiRagHelpHandler, aiDriveSearchHandler, aiSpeedProfileInsightsHandler, aiRouteEfficiencySuggestionsHandler, aiAutoTripNameHandler, aiTripPlannerLLMHandler, aiSmartChargeScheduleHandler, aiBatteryHealthHandler, aiChargingCurveClusteringHandler, aiCostForecastNarrationHandler, aiVampireDrainExplanationHandler, aiPreheatPrecoolRecommenderHandler, aiCabinTemperatureImpactNarrativeHandler, aiTirePressureTrendReasoningHandler, aiAlertTuningHandler, aiInboxCategorizationHandler, aiCrossRuleConflictHandler, aiAutoNameUnnamedLocationsHandler, aiSuggestNewGeofencesHandler, aiGeofenceAwareAutomationHandler, aiLearnedAnomalyBaselinesHandler, aiRangePredictionHandler, aiMLChargingCurveClusteringHandler, aiPeriodCompareNarrationHandler, aiLifetimeStatsQAHandler, aiIncidentTimelineSummarizerHandler, aiDataRepairSuggestionsHandler, aiSignalExplorerNlFilterHandler, aiLogTraceSummarizationHandler, aiFeedbackQueueTriageHandler, aiMqttSseInspectorExplanationsHandler, aiStateMachineDebuggerNarratorHandler, aiPredictiveMaintenanceHandler, aiTCONarrationHandler, aiSoftwareUpdateChangelogSummarizerHandler, aiPiiRedactionSharedExportsHandler, aiQuietHoursSuggestionHandler, aiSafetySettingExplainerHandler, aiVoiceModeHandler, aiWatchFaceNLResponseHandler, aiNLSqlPlaygroundHandler, aiNLGrafanaPanelHandler, aiNLDashboardComposerHandler, aiTripPostcardShareCardImageGenerationHandler, aiVehiclePaintPreviewHandler)

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

	// Subscribe to export status events from the export worker and relay via SSE.
	// The publish path injects W3C trace context into the MQTT envelope so the
	// SSE relay span here chains under the worker's processJob span — Tempo can
	// then render export-publish→export-process→export.status→sse.broadcast as a
	// single end-to-end trace across processes.
	if mqttClient != nil {
		mqttClient.Underlying().Subscribe("teslasync/events/export.status", 1, func(_ pahomqtt.Client, msg pahomqtt.Message) {
			consumeCtx, payload := mqtt.ExtractTraceContext(context.Background(), msg.Payload())
			var evt map[string]interface{}
			if err := json.Unmarshal(payload, &evt); err != nil {
				return
			}
			eventHub.BroadcastWithContext(consumeCtx, "export_status", evt)
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

// aiSettingsReader adapts *settingsdb.SettingsRepo to the
// provider.SettingsReader port. The repo natively exposes
// AIMode + AIFeatureEnabled (cheap single-row PK lookups). The
// AIProviderConfig accessor is implemented here by calling
// the existing typed Get() and pulling out the AIProviderConfig
// JSONB field — keeping the repo single-purpose (R5 mitigation)
// and avoiding a settings-repo migration in slice F1.
type aiSettingsReader struct {
	repo *settingsdb.SettingsRepo
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
