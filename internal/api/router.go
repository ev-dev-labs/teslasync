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

	docsfs "github.com/ev-dev-labs/teslasync/docs"
	apiactivity "github.com/ev-dev-labs/teslasync/internal/api/activity"
	apiadminfb "github.com/ev-dev-labs/teslasync/internal/api/adminfeedback"
	apiadminls "github.com/ev-dev-labs/teslasync/internal/api/adminlogstream"
	apiadminmnt "github.com/ev-dev-labs/teslasync/internal/api/adminmaintenance"
	aialert "github.com/ev-dev-labs/teslasync/internal/api/aialert"
	aialerttune "github.com/ev-dev-labs/teslasync/internal/api/aialerttune"
	aianomaly "github.com/ev-dev-labs/teslasync/internal/api/aianomaly"
	aiautomation "github.com/ev-dev-labs/teslasync/internal/api/aiautomation"
	aiautoname "github.com/ev-dev-labs/teslasync/internal/api/aiautoname"
	aiautotripname "github.com/ev-dev-labs/teslasync/internal/api/aiautotripname"
	aibatthealth "github.com/ev-dev-labs/teslasync/internal/api/aibatthealth"
	aichargcurve "github.com/ev-dev-labs/teslasync/internal/api/aichargcurve"
	aichargdiag "github.com/ev-dev-labs/teslasync/internal/api/aichargdiag"
	aichatbot "github.com/ev-dev-labs/teslasync/internal/api/aichatbot"
	aiclimate "github.com/ev-dev-labs/teslasync/internal/api/aiclimate"
	aicostfcst "github.com/ev-dev-labs/teslasync/internal/api/aicostfcst"
	aicrossrule "github.com/ev-dev-labs/teslasync/internal/api/aicrossrule"
	aidatarep "github.com/ev-dev-labs/teslasync/internal/api/aidatarep"
	aidigest "github.com/ev-dev-labs/teslasync/internal/api/aidigest"
	aidrivecoach "github.com/ev-dev-labs/teslasync/internal/api/aidrivecoach"
	aidrivesearch "github.com/ev-dev-labs/teslasync/internal/api/aidrivesearch"
	aifeedtri "github.com/ev-dev-labs/teslasync/internal/api/aifeedtri"
	aifsmnar "github.com/ev-dev-labs/teslasync/internal/api/aifsmnar"
	aigeofautom "github.com/ev-dev-labs/teslasync/internal/api/aigeofautom"
	aiinboxcat "github.com/ev-dev-labs/teslasync/internal/api/aiinboxcat"
	aiincident "github.com/ev-dev-labs/teslasync/internal/api/aiincident"
	ailifetime "github.com/ev-dev-labs/teslasync/internal/api/ailifetime"
	"github.com/ev-dev-labs/teslasync/internal/api/ailogtrace"
	aimlanom "github.com/ev-dev-labs/teslasync/internal/api/aimlanom"
	aimlchargcv "github.com/ev-dev-labs/teslasync/internal/api/aimlchargcv"
	aimlrange "github.com/ev-dev-labs/teslasync/internal/api/aimlrange"
	aimqttsse "github.com/ev-dev-labs/teslasync/internal/api/aimqttsse"
	ainldash "github.com/ev-dev-labs/teslasync/internal/api/ainldash"
	ainlgrafana "github.com/ev-dev-labs/teslasync/internal/api/ainlgrafana"
	ainlsql "github.com/ev-dev-labs/teslasync/internal/api/ainlsql"
	aiperiodcmp "github.com/ev-dev-labs/teslasync/internal/api/aiperiodcmp"
	aipiiredact "github.com/ev-dev-labs/teslasync/internal/api/aipiiredact"
	aipostcard "github.com/ev-dev-labs/teslasync/internal/api/aipostcard"
	aipredmaint "github.com/ev-dev-labs/teslasync/internal/api/aipredmaint"
	aiquiethrs "github.com/ev-dev-labs/teslasync/internal/api/aiquiethrs"
	airaghelp "github.com/ev-dev-labs/teslasync/internal/api/airaghelp"
	airouteeff "github.com/ev-dev-labs/teslasync/internal/api/airouteeff"
	aisafetyexp "github.com/ev-dev-labs/teslasync/internal/api/aisafetyexp"
	aisearch "github.com/ev-dev-labs/teslasync/internal/api/aisearch"
	"github.com/ev-dev-labs/teslasync/internal/api/aisettingsvalidate"
	aisignalnl "github.com/ev-dev-labs/teslasync/internal/api/aisignalnl"
	aismartcharge "github.com/ev-dev-labs/teslasync/internal/api/aismartcharge"
	aispeedprof "github.com/ev-dev-labs/teslasync/internal/api/aispeedprof"
	aisuggeo "github.com/ev-dev-labs/teslasync/internal/api/aisuggeo"
	aiswupd "github.com/ev-dev-labs/teslasync/internal/api/aiswupd"
	aitconar "github.com/ev-dev-labs/teslasync/internal/api/aitconar"
	aitempimpact "github.com/ev-dev-labs/teslasync/internal/api/aitempimpact"
	aitirepress "github.com/ev-dev-labs/teslasync/internal/api/aitirepress"
	aitripplanllm "github.com/ev-dev-labs/teslasync/internal/api/aitripplanllm"
	"github.com/ev-dev-labs/teslasync/internal/api/aiusage"
	aivampire "github.com/ev-dev-labs/teslasync/internal/api/aivampire"
	"github.com/ev-dev-labs/teslasync/internal/api/aivehpaint"
	aivoice "github.com/ev-dev-labs/teslasync/internal/api/aivoice"
	aiwatchnl "github.com/ev-dev-labs/teslasync/internal/api/aiwatchnl"
	aiyir "github.com/ev-dev-labs/teslasync/internal/api/aiyir"
	apialertmsg "github.com/ev-dev-labs/teslasync/internal/api/alertmsg"
	apialerts "github.com/ev-dev-labs/teslasync/internal/api/alerts"
	apianalytics "github.com/ev-dev-labs/teslasync/internal/api/analytics"
	apianomaly "github.com/ev-dev-labs/teslasync/internal/api/anomaly"
	apicalllog "github.com/ev-dev-labs/teslasync/internal/api/apicalllog"
	apiflagsh "github.com/ev-dev-labs/teslasync/internal/api/apiflagsh"
	apikeyh "github.com/ev-dev-labs/teslasync/internal/api/apikey"
	"github.com/ev-dev-labs/teslasync/internal/api/apperror"
	apiaudit "github.com/ev-dev-labs/teslasync/internal/api/audit"
	apiauth "github.com/ev-dev-labs/teslasync/internal/api/auth"
	apiauths "github.com/ev-dev-labs/teslasync/internal/api/authsession"
	apiautomation "github.com/ev-dev-labs/teslasync/internal/api/automation"
	apibackup "github.com/ev-dev-labs/teslasync/internal/api/backup"
	apibattery "github.com/ev-dev-labs/teslasync/internal/api/battery"
	"github.com/ev-dev-labs/teslasync/internal/api/batterycells"
	"github.com/ev-dev-labs/teslasync/internal/api/batterydegradation"
	"github.com/ev-dev-labs/teslasync/internal/api/batterypassport"
	apibenchmark "github.com/ev-dev-labs/teslasync/internal/api/benchmark"
	apicarbon "github.com/ev-dev-labs/teslasync/internal/api/carbon"
	apichargeheatmap "github.com/ev-dev-labs/teslasync/internal/api/chargeheatmap"
	apichargeopt "github.com/ev-dev-labs/teslasync/internal/api/chargeopt"
	"github.com/ev-dev-labs/teslasync/internal/api/chargeplanner"
	apichargetelem "github.com/ev-dev-labs/teslasync/internal/api/chargetelem"
	apicharging "github.com/ev-dev-labs/teslasync/internal/api/charging"
	apiannot "github.com/ev-dev-labs/teslasync/internal/api/chartannotation"
	apichatbot "github.com/ev-dev-labs/teslasync/internal/api/chatbot"
	apiclimate "github.com/ev-dev-labs/teslasync/internal/api/climate"
	apicommand "github.com/ev-dev-labs/teslasync/internal/api/command"
	"github.com/ev-dev-labs/teslasync/internal/api/costforecast"
	apidash "github.com/ev-dev-labs/teslasync/internal/api/dashboardlayout"
	apidq "github.com/ev-dev-labs/teslasync/internal/api/dataquality"
	apidatarepair "github.com/ev-dev-labs/teslasync/internal/api/datarepair"
	apidevtools "github.com/ev-dev-labs/teslasync/internal/api/devtools"
	apidiag "github.com/ev-dev-labs/teslasync/internal/api/diagnostic"
	apidlq "github.com/ev-dev-labs/teslasync/internal/api/dlq"
	apidrived "github.com/ev-dev-labs/teslasync/internal/api/drivediagnostic"
	apidrivedyn "github.com/ev-dev-labs/teslasync/internal/api/drivedyn"
	apidrives "github.com/ev-dev-labs/teslasync/internal/api/drives"
	apidrivetrain "github.com/ev-dev-labs/teslasync/internal/api/drivetrain"
	apidrivingcoach "github.com/ev-dev-labs/teslasync/internal/api/drivingcoach"
	apienergy "github.com/ev-dev-labs/teslasync/internal/api/energy"
	apienergyflow "github.com/ev-dev-labs/teslasync/internal/api/energyflow"
	apienergysite "github.com/ev-dev-labs/teslasync/internal/api/energysite"
	apiexpcol "github.com/ev-dev-labs/teslasync/internal/api/exportcolumns"
	apiexports "github.com/ev-dev-labs/teslasync/internal/api/exports"
	apifb "github.com/ev-dev-labs/teslasync/internal/api/feedback"
	apifleetops "github.com/ev-dev-labs/teslasync/internal/api/fleetops"
	apifleettelem "github.com/ev-dev-labs/teslasync/internal/api/fleettelemetry"
	apifsd "github.com/ev-dev-labs/teslasync/internal/api/fsd"
	apigas "github.com/ev-dev-labs/teslasync/internal/api/gasprice"
	apigeocode "github.com/ev-dev-labs/teslasync/internal/api/geocode"
	apigeo "github.com/ev-dev-labs/teslasync/internal/api/geofence"
	apiguard "github.com/ev-dev-labs/teslasync/internal/api/guard"
	apiimpers "github.com/ev-dev-labs/teslasync/internal/api/impersonate"
	apixray "github.com/ev-dev-labs/teslasync/internal/api/ingestxray"
	apilifetime "github.com/ev-dev-labs/teslasync/internal/api/lifetime"
	apilocsnap "github.com/ev-dev-labs/teslasync/internal/api/locsnap"
	"github.com/ev-dev-labs/teslasync/internal/api/maintenance"
	apimedia "github.com/ev-dev-labs/teslasync/internal/api/media"
	apimw "github.com/ev-dev-labs/teslasync/internal/api/middleware"
	apimileage "github.com/ev-dev-labs/teslasync/internal/api/mileage"
	apimotor "github.com/ev-dev-labs/teslasync/internal/api/motor"
	apinotif "github.com/ev-dev-labs/teslasync/internal/api/notification"
	apionboard "github.com/ev-dev-labs/teslasync/internal/api/onboarding"
	apiopenapi "github.com/ev-dev-labs/teslasync/internal/api/openapi"
	apiperiod "github.com/ev-dev-labs/teslasync/internal/api/periodstats"
	apipinned "github.com/ev-dev-labs/teslasync/internal/api/pinned"
	apipolling "github.com/ev-dev-labs/teslasync/internal/api/polling"
	apipush "github.com/ev-dev-labs/teslasync/internal/api/push"
	apiqueue "github.com/ev-dev-labs/teslasync/internal/api/queuestatus"
	apiquiet "github.com/ev-dev-labs/teslasync/internal/api/quiethours"
	apirangeproj "github.com/ev-dev-labs/teslasync/internal/api/rangeproj"
	apiratelim "github.com/ev-dev-labs/teslasync/internal/api/ratelimit"
	apirbac "github.com/ev-dev-labs/teslasync/internal/api/rbac"
	apiregen "github.com/ev-dev-labs/teslasync/internal/api/regen"
	apirouteeff "github.com/ev-dev-labs/teslasync/internal/api/routeeff"
	apirul "github.com/ev-dev-labs/teslasync/internal/api/rul"
	apisafety "github.com/ev-dev-labs/teslasync/internal/api/safety"
	apisaved "github.com/ev-dev-labs/teslasync/internal/api/savedviews"
	apischedexp "github.com/ev-dev-labs/teslasync/internal/api/scheduledexports"
	apisearch "github.com/ev-dev-labs/teslasync/internal/api/search"
	apisecurity "github.com/ev-dev-labs/teslasync/internal/api/security"
	apisegments "github.com/ev-dev-labs/teslasync/internal/api/segments"
	apiserviceintelligence "github.com/ev-dev-labs/teslasync/internal/api/serviceintelligence"
	apisess "github.com/ev-dev-labs/teslasync/internal/api/session"
	apisettings "github.com/ev-dev-labs/teslasync/internal/api/settings"
	apisetreset "github.com/ev-dev-labs/teslasync/internal/api/settingsreset"
	apishare "github.com/ev-dev-labs/teslasync/internal/api/share"
	apisignal "github.com/ev-dev-labs/teslasync/internal/api/signalinspect"
	apisigcat "github.com/ev-dev-labs/teslasync/internal/api/signalscatalog"
	apisleep "github.com/ev-dev-labs/teslasync/internal/api/sleep"
	apislo "github.com/ev-dev-labs/teslasync/internal/api/slo"
	apisoftupd "github.com/ev-dev-labs/teslasync/internal/api/softwareupdate"
	apispeedprof "github.com/ev-dev-labs/teslasync/internal/api/speedprofile"
	"github.com/ev-dev-labs/teslasync/internal/api/sse"
	apistatus "github.com/ev-dev-labs/teslasync/internal/api/status"
	apisynthetic "github.com/ev-dev-labs/teslasync/internal/api/synthetic"
	apiauthmode "github.com/ev-dev-labs/teslasync/internal/api/sysauthmode"
	apisystem "github.com/ev-dev-labs/teslasync/internal/api/system"
	apitco "github.com/ev-dev-labs/teslasync/internal/api/tco"
	apitelem "github.com/ev-dev-labs/teslasync/internal/api/telemetry"
	"github.com/ev-dev-labs/teslasync/internal/api/tempimpact"
	apiteslachargehist "github.com/ev-dev-labs/teslasync/internal/api/teslachargehist"
	apiteslachargesess "github.com/ev-dev-labs/teslasync/internal/api/teslachargesess"
	apiteslaenergyhist "github.com/ev-dev-labs/teslasync/internal/api/teslaenergyhist"
	apitels "github.com/ev-dev-labs/teslasync/internal/api/teslaenergylivestatus"
	apituc "github.com/ev-dev-labs/teslasync/internal/api/teslauserconfig"
	apituo "github.com/ev-dev-labs/teslasync/internal/api/teslauserorder"
	apitup "github.com/ev-dev-labs/teslasync/internal/api/teslauserprofile"
	apitimemachine "github.com/ev-dev-labs/teslasync/internal/api/timemachine"
	apitirepressure "github.com/ev-dev-labs/teslasync/internal/api/tirepressure"
	apitotp "github.com/ev-dev-labs/teslasync/internal/api/totp"
	apitrip "github.com/ev-dev-labs/teslasync/internal/api/trip"
	apitripplanner "github.com/ev-dev-labs/teslasync/internal/api/tripplanner"
	apitripsd "github.com/ev-dev-labs/teslasync/internal/api/tripsdetail"
	apiuserpref "github.com/ev-dev-labs/teslasync/internal/api/userpref"
	apivamp "github.com/ev-dev-labs/teslasync/internal/api/vampiredrain"
	apiveh "github.com/ev-dev-labs/teslasync/internal/api/vehicle"
	apivehaccess "github.com/ev-dev-labs/teslasync/internal/api/vehicleaccess"
	apivehconfig "github.com/ev-dev-labs/teslasync/internal/api/vehicleconfig"
	apivehinfo "github.com/ev-dev-labs/teslasync/internal/api/vehicleinfo"
	apivehphoto "github.com/ev-dev-labs/teslasync/internal/api/vehiclephoto"
	apivehsettings "github.com/ev-dev-labs/teslasync/internal/api/vehiclesettings"
	apivehstates "github.com/ev-dev-labs/teslasync/internal/api/vehiclestates"
	apivisloc "github.com/ev-dev-labs/teslasync/internal/api/visitedlocation"
	"github.com/ev-dev-labs/teslasync/internal/api/watch"
	apiwerr "github.com/ev-dev-labs/teslasync/internal/api/weberrors"
	apiwhrx "github.com/ev-dev-labs/teslasync/internal/api/webhookreceiver"
	apivitals "github.com/ev-dev-labs/teslasync/internal/api/webvitals"
	apiweekly "github.com/ev-dev-labs/teslasync/internal/api/weeklydigest"
	"github.com/ev-dev-labs/teslasync/internal/api/yearreview"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	actioncenterdb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	advancedintelligencedb "github.com/ev-dev-labs/teslasync/internal/database/advancedintelligence"
	aidb "github.com/ev-dev-labs/teslasync/internal/database/ai"
	dbalert "github.com/ev-dev-labs/teslasync/internal/database/alert"
	auditdb "github.com/ev-dev-labs/teslasync/internal/database/audit"
	dbauth "github.com/ev-dev-labs/teslasync/internal/database/auth"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	energydb "github.com/ev-dev-labs/teslasync/internal/database/energy"
	exportdb "github.com/ev-dev-labs/teslasync/internal/database/export"
	geofencedb "github.com/ev-dev-labs/teslasync/internal/database/geofence"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
	ownershipinteldb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel"
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
	"github.com/ev-dev-labs/teslasync/internal/integrations/nhtsa"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/ops"
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
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"

	"github.com/ev-dev-labs/teslasync/internal/automation"
	"github.com/ev-dev-labs/teslasync/internal/automation/action"

	// F0 AI-Off Contract (ADR-015). The guard
	// package is the only sanctioned mount point for /api/v1/ai/*
	// routes; tools/aivet refuses to merge a router change that
	// introduces an AI route via a bare HandlerFunc.
	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/feedback"

	// F8 Redaction Layer. The decorator is the
	// innermost wire-side wrap so every cloud call is sanitized
	// before audit/trace see the post-redaction text. PolicyFromContext
	// is the resolver — dispatcher.Run installs the strategy's
	// RedactionPolicy into ctx via the redactadapter bridge.
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"

	// F1 Provider Abstraction. The registry +
	// adapters live behind the same hexagonal port so feature code
	// imports only "internal/ai/provider", never the concrete
	// adapter packages. The four concrete adapter imports below are
	// the package-init equivalents — Register is called explicitly
	// in NewRouter so a fresh build cannot accidentally enable a
	// provider by virtue of an unintended import.
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	aianthropic "github.com/ev-dev-labs/teslasync/internal/ai/provider/anthropic"
	aiazure "github.com/ev-dev-labs/teslasync/internal/ai/provider/azure"
	aimock "github.com/ev-dev-labs/teslasync/internal/ai/provider/mock"
	aiollama "github.com/ev-dev-labs/teslasync/internal/ai/provider/ollama"
	aiopenai "github.com/ev-dev-labs/teslasync/internal/ai/provider/openai"

	// U1 Chatbot LLM upgrade. The chatbot strategy +
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
	maintenancetool "github.com/ev-dev-labs/teslasync/internal/ai/tools/maintenance"
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

	// Hexagonal adapters used by legacy route composition.
	pgadapter "github.com/ev-dev-labs/teslasync/internal/adapter/postgres"
	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/app/adminobssvc"
	"github.com/ev-dev-labs/teslasync/internal/app/advancedintelligencesvc"
	"github.com/ev-dev-labs/teslasync/internal/app/auditviewersvc"
	"github.com/ev-dev-labs/teslasync/internal/app/chargingsvc"
	"github.com/ev-dev-labs/teslasync/internal/app/dashboardsvc"
	"github.com/ev-dev-labs/teslasync/internal/app/exportsvc"
	"github.com/ev-dev-labs/teslasync/internal/app/fleetstatesvc"
	"github.com/ev-dev-labs/teslasync/internal/app/gdprexportsvc"
	"github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc"
	"github.com/ev-dev-labs/teslasync/internal/app/vehiclesvc"
	handlermw "github.com/ev-dev-labs/teslasync/internal/handler/middleware"
	v1handlers "github.com/ev-dev-labs/teslasync/internal/handler/v1"
	actioncenterhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
	advancedintelligencehandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/advancedintelligence"
	ownershipintelhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/ownershipintel"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
)

type vehicleManagementRouteHandler interface {
	VehicleOptions(http.ResponseWriter, *http.Request)
	RefreshVehicleOptions(http.ResponseWriter, *http.Request)
	VehicleSpecs(http.ResponseWriter, *http.Request)
	RefreshVehicleSpecs(http.ResponseWriter, *http.Request)
	SubscriptionEligibility(http.ResponseWriter, *http.Request)
	RefreshSubscriptionEligibility(http.ResponseWriter, *http.Request)
	UpgradeEligibility(http.ResponseWriter, *http.Request)
	RefreshUpgradeEligibility(http.ResponseWriter, *http.Request)
	WarrantyDetails(http.ResponseWriter, *http.Request)
	RefreshWarrantyDetails(http.ResponseWriter, *http.Request)
	VehiclePricing(http.ResponseWriter, *http.Request)
	EnterpriseRoles(http.ResponseWriter, *http.Request)
	RefreshEnterpriseRoles(http.ResponseWriter, *http.Request)
	EnterprisePayer(http.ResponseWriter, *http.Request)
}

func mountVehicleScopedManagementRoutes(r chi.Router, h vehicleManagementRouteHandler) {
	r.Get("/options", h.VehicleOptions)
	r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/options/refresh", h.RefreshVehicleOptions)
	r.Get("/specs", h.VehicleSpecs)
	r.With(httprate.LimitByIP(2, 1*time.Minute)).Post("/specs/refresh", h.RefreshVehicleSpecs)
	r.Get("/subscriptions", h.SubscriptionEligibility)
	r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/subscriptions/refresh", h.RefreshSubscriptionEligibility)
	r.Get("/upgrades", h.UpgradeEligibility)
	r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/upgrades/refresh", h.RefreshUpgradeEligibility)
	r.Get("/warranty", h.WarrantyDetails)
	r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/warranty/refresh", h.RefreshWarrantyDetails)
	r.Get("/enterprise-roles", h.EnterpriseRoles)
	r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/enterprise-roles/refresh", h.RefreshEnterpriseRoles)
	r.With(httprate.LimitByIP(2, 1*time.Minute)).Post("/enterprise-payer", h.EnterprisePayer)
}

func mountAccountVehicleManagementRoutes(r chi.Router, h vehicleManagementRouteHandler) {
	r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/tesla/vehicle-pricing", h.VehiclePricing)
}

type dataRepairRoutes interface {
	GetStaleSessions(http.ResponseWriter, *http.Request)
	GetSuggestions(http.ResponseWriter, *http.Request)
	ListCases(http.ResponseWriter, *http.Request)
	GetCaseStats(http.ResponseWriter, *http.Request)
	GetCase(http.ResponseWriter, *http.Request)
	ListQuarantines(http.ResponseWriter, *http.Request)
	TransitionCase(http.ResponseWriter, *http.Request)
	AssignCase(http.ResponseWriter, *http.Request)
	AddCaseComment(http.ResponseWriter, *http.Request)
	BulkTransitionCases(http.ResponseWriter, *http.Request)
	ScanCases(http.ResponseWriter, *http.Request)
	QuarantineCase(http.ResponseWriter, *http.Request)
	RestoreQuarantine(http.ResponseWriter, *http.Request)
	UpdateCharging(http.ResponseWriter, *http.Request)
	PreviewCharging(http.ResponseWriter, *http.Request)
	CloseCharging(http.ResponseWriter, *http.Request)
	DeleteCharging(http.ResponseWriter, *http.Request)
	UpdateDrive(http.ResponseWriter, *http.Request)
	PreviewDrive(http.ResponseWriter, *http.Request)
	CloseDrive(http.ResponseWriter, *http.Request)
	DeleteDrive(http.ResponseWriter, *http.Request)
}

func mountDataRepairRoutes(r chi.Router, h dataRepairRoutes, sudo func(http.Handler) http.Handler) {
	r.Route("/data-repair", func(r chi.Router) {
		r.Use(httprate.LimitByIP(20, time.Minute))
		r.Get("/stale-sessions", h.GetStaleSessions)
		r.Get("/suggestions", h.GetSuggestions)
		r.Get("/cases", h.ListCases)
		r.Get("/cases/stats", h.GetCaseStats)
		r.Get("/cases/{id}", h.GetCase)
		r.Get("/quarantine", h.ListQuarantines)
		r.With(httprate.LimitByIP(2, time.Minute), sudo).Post("/cases/scan", h.ScanCases)
		r.With(sudo).Post("/cases/{id}/transition", h.TransitionCase)
		r.With(sudo).Put("/cases/{id}/assignment", h.AssignCase)
		r.With(sudo).Post("/cases/{id}/comments", h.AddCaseComment)
		r.With(sudo).Post("/cases/{id}/quarantine", h.QuarantineCase)
		r.With(sudo).Post("/cases/bulk-transition", h.BulkTransitionCases)
		r.With(sudo).Post("/quarantine/{id}/restore", h.RestoreQuarantine)
		r.Route("/charging/{id}", func(r chi.Router) {
			r.With(sudo).Put("/", h.UpdateCharging)
			r.Post("/preview", h.PreviewCharging)
			r.With(sudo).Post("/close", h.CloseCharging)
			r.With(sudo).Delete("/", h.DeleteCharging)
		})
		r.Route("/drive/{id}", func(r chi.Router) {
			r.With(sudo).Put("/", h.UpdateDrive)
			r.Post("/preview", h.PreviewDrive)
			r.With(sudo).Post("/close", h.CloseDrive)
			r.With(sudo).Delete("/", h.DeleteDrive)
		})
	})
}

// NewRouter creates and configures the main HTTP router with all API routes,
// middleware (logging, recovery, CORS, rate limiting, security headers), and
// a static file server for the SPA frontend. It wires up handler dependencies
// and returns the ready-to-serve http.Handler.
//
// stateReader is the signal-log-backed cold-path reader (ADR-002).
// It is threaded through here so handlers can adopt it one file at a time.
// The legacy *signaldb.SignalLogReader (signalLogReader below) is preserved
// alongside it during the migration window so the build stays green.
func NewRouter(db *database.DB, teslaClient *tesla.Client, mqttClient *mqtt.Client, cfg *config.Config, health *resilience.HealthMonitor, stateReader signal.StateReader, opts ...RouterOptions) http.Handler {
	r := chi.NewRouter()
	// stateReader is intentionally not wired into individual handlers here.
	// Handlers adopt it one file at a time; the reference below keeps it visible
	// to readers and lets static analyzers see it as a live dependency.
	_ = stateReader

	var opt RouterOptions
	if len(opts) > 0 {
		opt = opts[0]
	}
	eventHub := sse.NewEventHub()

	// Error tracker for centralized error aggregation. apperror.Write
	// (and the writeAppError parent wrapper) routes structured errors
	// into this tracker via apperror.SetTracker; see internal/api/apperror.
	errorTracker := NewErrorTracker(200)
	apperror.SetTracker(errorTracker)
	r.Use(apimw.CapturePeerAddress) // Must precede RealIP; rate limits use the transport peer, not XFF.
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
	// and calls .Flush on its internal encoder. When the response Content-
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
		corsOrigins = make([]string, 0, len(strings.Split(cfg.CORSOrigins, ",")))
		for _, origin := range strings.Split(cfg.CORSOrigins, ",") {
			if origin = strings.TrimSpace(origin); origin != "" {
				corsOrigins = append(corsOrigins, origin)
			}
		}
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
	vehicleSvc := service.NewVehicleService(db)
	energySvc := service.NewEnergyService(db)

	// Layered live-state reader (ADR-002 / ADR-007). Composes the in-process
	// L1 signal.Store + L2 Redis HSET (LiveSignalStore) with the cold-path
	// signal_log StateReader as fallback. /latest handlers and any "current
	// state" code path MUST go through this boundary so that:
	// * fields routed to typed snapshot tables (climate, motor, tire
	// pressure, media, security, vehicle_config, safety, etc.) are
	// served from L1+L2 instead of returning empty maps from
	// signal_log; and
	// * infrequent fields like Latitude / Longitude on a parked vehicle
	// still surface from signal_log when L1+L2 has no entry.
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
	vehicleHandler := apiveh.NewHandler(vehicleSvc, teslaClient, stateReader)
	// Fleet-wide batch current-state read (ADR-009: handler/v1 + app/*svc).
	// It shares service.VehicleService.ResolveCurrentState with the
	// single-vehicle GET /vehicles/{id}/state above, so the two surfaces
	// cannot report different truths for the same car. `liveSignalStore` is
	// the same L1+L2 boundary the single read uses (a no-op store when no
	// telemetry source is configured) — no snapshot tables are involved.
	//
	// CacheTTL enables coalescing + a 1s successful-result micro-cache: the
	// SPA's multi-tab / SSE-burst thundering herd collapses into ONE storage
	// read. Failures are never cached and every caller gets its own copy.
	fleetStateHandler := v1handlers.NewFleetStateHandler(fleetstatesvc.New(fleetstatesvc.Options{
		Vehicles: vehicledb.NewVehicleRepo(db),
		Resolver: vehicleSvc,
		Live:     liveSignalStore,
		CacheTTL: fleetstatesvc.DefaultCacheTTL,
		OnResolverError: func(ctx context.Context, vehicleID int64, err error) {
			span := trace.SpanFromContext(ctx)
			log.Warn().
				Err(err).
				Int64("vehicle_id", vehicleID).
				Str("trace_id", span.SpanContext().TraceID().String()).
				Msg("fleet state: vehicle resolution failed; reported as a failed item")
		},
		OnResolverPanic: func(ctx context.Context, vehicleID int64, recovered any) {
			span := trace.SpanFromContext(ctx)
			log.Error().
				Int64("vehicle_id", vehicleID).
				Interface("panic", recovered).
				Str("trace_id", span.SpanContext().TraceID().String()).
				Msg("fleet state: vehicle resolution panicked; reported as a failed item")
		},
		OnPrefetchError: func(ctx context.Context, err error) {
			span := trace.SpanFromContext(ctx)
			log.Warn().
				Err(err).
				Str("trace_id", span.SpanContext().TraceID().String()).
				Msg("fleet state: bulk prefetch unavailable; falling back to per-vehicle reads")
		},
		OnCacheOutcome: func(ctx context.Context, outcome fleetstatesvc.CacheOutcome) {
			// Span attributes only: a per-request log line here would be pure
			// noise on the hot path, and cache behaviour is a latency story
			// that belongs on the trace.
			span := trace.SpanFromContext(ctx)
			if !span.IsRecording() {
				return
			}
			span.SetAttributes(
				attribute.Bool("fleet.cache_hit", outcome.Hit),
				attribute.Bool("fleet.cache_coalesced", outcome.Coalesced),
				attribute.Float64("fleet.cache_age_seconds", outcome.Age.Seconds()),
			)
		},
	}))
	driveHandler := apidrives.NewDriveDetail(db, stateReader, liveStateReader)
	chargingHandler := apicharging.NewChargingHandler(db, stateReader, liveStateReader)
	geofenceHandler := apigeo.NewHandler(db, apigeo.WithAuditFunc(
		func(r *http.Request, action string, entityID *int64, detail string) {
			logAuditFromRequest(db, r, "", action, "geofence", entityID, detail)
		},
	))
	authHandler := apiauth.NewHandler(db, teslaClient, opt.Encryptor)
	// Sudo step-up. Construct the in-memory
	// token store and the reauth HTTP handler once and share them
	// across the route table. The store is the source of truth for
	// step-up authorisation; the middleware reads from it on every
	// gated request, the handler writes to it on a successful
	// /auth/reauth.
	sudoCfg := LoadSudoConfig(cfg)
	sudoStore := dbauth.NewSudoTokenStore(sudoCfg.TTL)
	// wire the real RFC 6238 verifier so the
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

	// per-user TOTP enrollment. Owns its own
	// pending/active tables; mints sudo tokens via the shared sudoStore
	// so a successful per-user TOTP step-up is indistinguishable downstream
	// from a successful password step-up.
	totpRepo := dbauth.NewTOTPRepo(db)
	totpHandler := apitotp.NewTOTPHandler(totpRepo, opt.Encryptor, sudoStore, cfg.Auth.ForwardAuthHeader)

	// active sessions / device management.
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

	// Auth-mode contract.
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

	// Live log tail. Build a process-wide
	// pub/sub registry for zerolog events and tee the global logger
	// through it so every Info/Warn/Error/etc. fans out to any
	// connected SSE subscriber. The tee is idempotent: installAdminLogStreamTap
	// guards against double-wrapping when NewRouter is called more
	// than once in the same process (e.g. parallel router tests).
	logTap := platform.NewLogSubscriberRegistry()
	installAdminLogStreamTap(logTap)
	logStreamHandler := apiadminls.NewAdminLogStreamHandler(logTap)
	settingsHandler := apisettings.NewSettingsHandler(db)

	// F0 AI-Off Contract (ADR-015).
	//
	// The guard is built once here and shared across every
	// /api/v1/ai/* route so the per-request feature-gate logic
	// (mode != "off" AND feature toggle on) lives in exactly one
	// place. Settings is the same SettingsRepo the rest of the
	// app uses; the AIMode/AIFeatureEnabled methods on it are
	// fail-closed (return "off"/false on any error).
	aiSettingsRepo := settingsdb.NewSettingsRepo(db)
	aiGuard := guard.New(aiSettingsRepo)

	// F1 Provider Abstraction.
	// The registry composes adapter factories with decorators and rereads settings
	// on each For call so saves take effect without restart. aiSettingsReader
	// adapts SettingsRepo without widening the repo surface; F3 adds async audit.
	aiCallLogRepo := aidb.NewAICallLogRepo(db)
	aiAuditWriter := provider.NewAsyncAuditWriter(context.Background(), aiCallLogRepo, 1024)
	aiRegistry := provider.NewRegistry(
		aiSettingsReader{repo: aiSettingsRepo},
		// F8 redaction sits INNERMOST in the
		// chain: WithRedaction is applied first so audit/trace
		// (above it in source order, outer at runtime) observe
		// the post-redaction request text. The resolver
		// (redact.PolicyFromContext) reads the per-request policy
		// installed by dispatch.Run from Strategy.RedactionPolicy.
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
	// settings export/import. The serializer
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
	settingsExportHandler := apisettings.NewSettingsExportHandler(settingsSerializer, cfg.Auth.ForwardAuthHeader)
	settingsImportHandler := apisettings.NewSettingsImportHandler(settingsSerializer, cfg.Auth.ForwardAuthHeader)
	// per-section + global "Reset to defaults".
	// Sudo-gated at the route below so the SPA's <ReauthDialog>
	// always pops on the danger-zone "Reset ALL settings" button.
	settingsResetRepo := settingsdb.NewSettingsResetRepo(db)
	settingsResetHandler := apisetreset.NewSettingsResetHandler(settingsResetRepo, cfg.Auth.ForwardAuthHeader)
	// recurring scheduled exports.
	//
	// Owner identity comes from the configured FORWARD_AUTH_HEADER on
	// every read/write — the handler NEVER trusts owner_subject in the
	// request body. The repo's per-row UPDATE/DELETE statements scope
	// by (id, owner_subject) so cross-user mutations collapse to 404.
	scheduledExportRepo := exportdb.NewScheduledExportRepo(db)
	scheduledExportsHandler := apischedexp.NewScheduledExportsHandler(scheduledExportRepo, cfg.Auth.ForwardAuthHeader, nil)
	// per-vehicle settings layer.
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

	// vehicle photo upload. The handler
	// owns the on-disk write/read pipeline plus the per-vehicle
	// upload mutex; the repo is a thin SQL facade that persists
	// the rendered paths in vehicle_photos.
	vehiclePhotoRepo := vehicledb.NewVehiclePhotoRepo(db)
	vehiclePhotoHandler := apivehphoto.NewHandler(
		vehiclePhotoRepo,
		apivehsettings.NewVehicleExistenceChecker(vehicleSettingsRepoForRouter),
		cfg.VehiclePhotoDir,
	)

	// RBAC matrix admin handler.
	// Matrix bindings live in role_permissions; permissions are a
	// hand-maintained catalog in internal/auth. The handler is
	// auth-mode aware (501 AUTH_MODE_OPEN in open mode) and the PUT
	// route is wrapped in RequireSudo below.
	rolePermissionsRepo := dbauth.NewRolePermissionsRepo(db)
	rbacHandler := apirbac.NewRBACHandler(rolePermissionsRepo, cfg.Auth.ForwardAuthHeader)

	// admin impersonation. The store mints
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
	alertHandler := apialerts.NewAlertHandler(db, eventHub, pahoForAlerts, alertLiveSignalStore)
	alertMessageHandler := apialertmsg.NewAlertMessageHandler()
	commandHandler := apicommand.NewCommandHandler(db, teslaClient)
	guardHandler := apiguard.NewGuardHandler(systemdb.NewGuardRepo(db.Pool), vehicledb.NewVehicleRepo(db), teslaClient, cfg)
	energyHandler := apienergy.NewEnergyHandler(energySvc)
	signalLogReader := signaldb.NewSignalLogReader(db)
	batteryHandler := apibattery.NewBatteryHandler(db, stateReader)
	analyticsHandler := apianalytics.NewAnalyticsHandler(db, stateReader)
	notificationHandler := apinotif.NewHandler(db)
	notificationChannelHandler := apinotif.NewChannelHandler(db)
	notifScheduleHandler := apinotif.NewScheduleHandler(db)
	// Wire the dynamic outbound-sink lookup into carved subpackages so
	// notification adapters and devtools probes keep recording to api_call_logs
	// through SetOutboundSink hot-reloads.
	apinotif.SinkProvider = apisystem.CurrentOutboundSink
	apidevtools.SinkProvider = apisystem.CurrentOutboundSink
	quietHoursHandler := apiquiet.NewHandler(quiethoursdb.NewQuietHoursRepo(db), cfg)
	chatbotHandler := apichatbot.NewChatbotHandler(db, vehicleSvc, stateReader, liveStateReader)

	// U1 Chatbot LLM upgrade.
	// The tool registry is process-wide; the chatbot strategy is per-feature and
	// paired with its dispatcher in the handler. aiToolsStateAdapter bridges the
	// SignalAt return type without leaking signal types into ai/tools.
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
	// register the digest-narration
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
	// register the yir-narration
	// slice's read-only tool on the SAME process-wide registry so
	// the dispatcher can resolve `query_year_in_review_context`
	// for the yir-narration strategy. Same ordering rule: the
	// builtins + digest tools above must register first so the
	// pin tests continue to see the canonical sets unchanged.
	yir.RegisterYearReviewTools(aiToolRegistry, yir.YearReviewSources{
		Drives:  drivedb.NewDriveRepo(db),
		Charges: chargingdb.NewChargingRepo(db),
	})
	// Helix Chat searches the embedded application documentation locally. This
	// corpus works when AI is enabled after startup and adds no embedding-provider
	// egress or dependency on the separate rag-help feature toggle.
	aiChatbotKnowledgeRetriever, err := rag.NewLexicalDocsRetriever(docsfs.FS)
	if err != nil {
		log.Fatal().Err(err).Msg("ai chatbot: knowledge retriever wiring failed")
	}
	tools.RegisterChatbotKnowledgeTool(aiToolRegistry, tools.HelpSources{
		Retriever: aiChatbotKnowledgeRetriever,
	})
	aiChatbotHandler := aichatbot.NewHandler(
		dbnotif.NewChatRepo(db),
		aiRegistry,
		aiToolRegistry,
		chatbotllm.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Weekly digest narration handler.
	// One per process; stateless beyond constructor inputs.
	aiDigestHandler := aidigest.NewHandler(
		aiRegistry,
		aiToolRegistry,
		digestnarration.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Year-in-review narration handler.
	// One per process; stateless beyond constructor inputs.
	aiYIRHandler := aiyir.NewHandler(
		aiRegistry,
		aiToolRegistry,
		yirnarration.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	tirePressureHandler := apitirepressure.NewTirePressureHandler(stateReader, liveStateReader)
	motorHandler := apimotor.NewMotorHandler(stateReader, liveStateReader)
	driveDynamicsHandler := apidrivedyn.NewDriveDynamicsHandler(stateReader, liveStateReader)
	climateHandler := apiclimate.NewClimateHandler(stateReader, liveStateReader)
	securityHandler := apisecurity.NewSecurityHandler(stateReader, liveStateReader)
	chargingTelemetryHandler := apichargetelem.NewChargingTelemetryHandler(stateReader, liveStateReader)
	mediaHandler := apimedia.NewMediaHandler(stateReader, liveStateReader)
	vehicleConfigHandler := apivehconfig.NewHandler(stateReader, liveStateReader)
	locationSnapshotHandler := apilocsnap.NewLocationSnapshotHandler(stateReader, liveStateReader)
	safetyHandler := apisafety.NewSafetyHandler(stateReader, liveStateReader)
	userPreferenceHandler := apiuserpref.NewUserPreferenceHandler(stateReader, liveStateReader)
	softwareUpdateHandler := apisoftupd.NewHandler(db)
	activityHandler := apiactivity.NewHandler(db)
	tcoHandler := apitco.NewHandler(db)
	sleepHandler := apisleep.NewSleepHandler(db)
	//: VampireDrainHandler deleted (vampire_drain_events).
	visitedLocationHandler := apivisloc.NewHandler(db)
	//: legacy mileage handler deleted (daily_mileage); TCO derives
	// distance via SUM(distance_m) FROM drives.
	tripHandler := apitrip.NewHandler(db)
	//: VehicleStateHandler deleted (vehicle_states);
	// current state is sourced from fsm_transitions / signal.StateReader.
	backupHandler := apibackup.NewHandler(db)
	backupRestoreHandler := apibackup.NewRestoreHandler(db)
	regenHandler := apiregen.NewRegenHandler(db)
	batteryDegradationHandler := batterydegradation.NewHandler(db, stateReader)
	batteryPassportHandler := batterypassport.NewBatteryPassportHandler(db)
	carbonHandler := apicarbon.NewCarbonHandler(db)
	rulHandler := apirul.NewRULHandler(db)
	auditHandler := apiaudit.NewAuditHandler(db, cfg.Auth.ForwardAuthHeader)
	maskedRevealHandler := apiaudit.NewMaskedRevealHandler(auditRepo, cfg.Auth.ForwardAuthHeader)
	apiCallLogHandler := apicalllog.NewHandler(db)
	apiKeyHandler := apikeyh.NewHandler(db, cfg.Auth.ForwardAuthHeader, apikeyh.WithAuditFunc(
		func(r *http.Request, headerName, action, resource string, entityID *int64, detail string) {
			logAuditFromRequest(db, r, headerName, action, resource, entityID, detail)
		},
	))
	//: SignalCatalogHandler deleted (signal_catalog +
	// signal_observations); the typed signal_log pipeline (000167+) is the
	// authoritative catalog/observation surface.
	chargingHeatmapHandler := apichargeheatmap.NewChargingHeatmapHandler(db)
	speedProfileHandler := apispeedprof.NewSpeedProfileHandler(db)
	// Data repair: read-only evidence diagnosis + explicit, audited apply.
	// The diagnosis source is only installed when a database is present; with
	// no pool the suggestions endpoint reports 503 rather than pretending the
	// worklist is clean.
	dataRepairOpts := []apidatarepair.Option{
		apidatarepair.WithForwardAuthHeader(cfg.Auth.ForwardAuthHeader),
	}
	if opt.DataRepairScanner != nil {
		dataRepairOpts = append(dataRepairOpts, apidatarepair.WithScanner(opt.DataRepairScanner))
	}
	if db != nil {
		dataRepairOpts = append(dataRepairOpts,
			apidatarepair.WithDiagnosisSource(datarepairdb.NewRepo(db)))
	}
	dataRepairHandler := apidatarepair.NewDataRepairHandler(db, dataRepairOpts...)
	tempImpactHandler := tempimpact.NewHandler(db)
	// FSD Insights reads the two resettable SI-meter distance counters
	// (SelfDrivingMilesSinceReset / MilesSinceReset) straight off the
	// signal_log change feed and derives reset-safe per-local-day deltas
	// server-side, so the browser never downloads a raw counter history.
	fsdInsightsHandler := apifsd.NewHandler(db)
	routeEfficiencyHandler := apirouteeff.NewRouteEfficiencyHandler(db)
	timeMachineHandler := apitimemachine.NewTimeMachineHandler(db)
	segmentsHandler := apisegments.NewSegmentsHandler(db)
	batteryCellsHandler := batterycells.NewHandler(db, alertLiveSignalStore, stateReader, signalLogReader)
	rangeProjectionHandler := apirangeproj.NewRangeProjectionHandler(db, stateReader)
	drivetrainHealthHandler := apidrivetrain.NewDrivetrainHealthHandler(db, stateReader)
	maintenanceHandler := maintenance.NewHandler(db)
	periodStatsHandler := apiperiod.NewHandler(db)
	drivingCoachHandler := apidrivingcoach.NewDrivingCoachHandler(db)
	costForecastHandler := costforecast.NewHandler(db)
	chargingOptimizerHandler := apichargeopt.NewChargingOptimizerHandler(db)
	anomalyHandler := apianomaly.NewHandler(db)
	benchmarkHandler := apibenchmark.NewBenchmarkHandler(db, cfg.Auth.ForwardAuthHeader)
	advancedIntelligenceService := advancedintelligencesvc.New(
		advancedintelligencedb.NewSourceRepository(db),
		stateReader,
		advancedintelligencedb.NewDurableRepository(db),
	)
	advancedIntelligenceHandler := advancedintelligencehandler.NewHandler(
		advancedIntelligenceService,
		cfg.Auth.ForwardAuthHeader,
	)
	ownershipIntelService := ownershipintelsvc.New(
		ownershipinteldb.NewSourceRepository(db),
		ownershipinteldb.NewDurableRepository(db),
	)
	ownershipIntelHandler := ownershipintelhandler.NewHandler(
		ownershipIntelService,
		cfg.Auth.ForwardAuthHeader,
	)
	actionCenterService := actioncentersvc.New(
		actioncenterdb.NewSourceRepository(db),
		actioncenterdb.NewStateRepository(db),
		actioncentersvc.WithAdvancedIntelligence(advancedIntelligenceService),
	)
	actionCenterHandler := actioncenterhandler.NewHandler(
		actionCenterService,
		cfg.Auth.ForwardAuthHeader,
	)
	fleetOpsHandler := apifleetops.NewHandler(db)
	nhtsaClient := nhtsa.NewClient(nhtsa.Config{})
	communicationsProvider := apiserviceintelligence.NewDatabaseManufacturerCommunicationsProvider(db)
	communicationsBulkClient := nhtsa.NewCommunicationsBulkClient(nhtsa.CommunicationsBulkConfig{})
	communicationsImportService := apiserviceintelligence.NewCommunicationsImportService(
		db,
		communicationsBulkClient,
	)
	communicationsAdminHandler := apiserviceintelligence.NewCommunicationsAdminHandler(
		communicationsImportService,
	)
	serviceIntelligenceHandler := apiserviceintelligence.NewServiceIntelligenceHandler(
		apiserviceintelligence.NewService(
			apiserviceintelligence.NewDatabaseVehicleReader(db),
			apiserviceintelligence.NewSignalObservationReader(db),
			nhtsaClient,
			communicationsProvider,
		),
	)
	// register the anomaly-explanations
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
	// Anomaly explanation handler.
	// One per process; stateless beyond constructor inputs. Must
	// be constructed AFTER the tool registration above so the
	// dispatcher can resolve the strategy's allowedTools at boot.
	aiAnomalyHandler := aianomaly.NewHandler(
		aiRegistry,
		aiToolRegistry,
		anomalyexplanations.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Natural-language alert builder.
	// Register the slice's PROPOSE-only typed tools on the SAME
	// process-wide registry so the dispatcher can resolve
	// `draft_alert_rule` + `validate_alert_rule` for the
	// nl-alert-builder strategy. Registered AFTER
	// RegisterAnomalyTools so the registry's alphabetical Names
	// list grows deterministically.
	//
	// aialert.RuleValidator delegates to the canonical validation path in
	// the non-AI alerts subpackage. Drafts accepted by the AI tool are
	// byte-equivalent to drafts accepted by the canonical handler (ADR-015
	// §I3 baseline-intact).
	alert.RegisterAlertBuilderTools(aiToolRegistry, alert.AlertBuilderSources{
		Validator: aialert.NewRuleValidator(),
	})
	aiAlertHandler := aialert.NewHandler(
		aiRegistry,
		aiToolRegistry,
		nlalertbuilder.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Natural-language automation-builder wiring mirrors the
	// alert-builder wiring above. aiautomation.GraphValidator is a
	// thin wrapper around the automation subpackage validator in
	// internal/api/automation/decode.go — same code path the canonical
	// POST /api/v1/automations handler uses. Drafts
	// accepted by the AI tool are byte-equivalent to drafts accepted
	// by the canonical handler (ADR-015 §I3 baseline-intact).
	automationtool.RegisterAutomationBuilderTools(aiToolRegistry, automationtool.AutomationBuilderSources{
		Validator: aiautomation.NewGraphValidator(),
	})
	aiAutomationHandler := aiautomation.NewHandler(
		aiRegistry,
		aiToolRegistry,
		nlautomationbuilder.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Natural-language search wiring mirrors the
	// alert-builder / automation-builder wiring above. The
	// retriever is constructed via rag.New (the F7 single
	// retrieval entry point) which fail-closes to NoopRetriever
	// when ai_mode='off' (ADR-015 §I1, §I4 — zero outbound egress
	// in off mode). The Hydrator is the aisearch package adapter,
	// which delegates per-source-type lookups
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
	aisearch.RegisterTools(aiToolRegistry, aiSearchRetriever, apisearch.NewPGSearcher(db))
	aiSearchHandler := aisearch.NewHandler(
		aiRegistry,
		aiToolRegistry,
		nlsearch.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Per-drive coaching narrative.
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
	aiDriveCoachHandler := aidrivecoach.NewHandler(
		aiRegistry,
		aiToolRegistry,
		drivecoaching.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// charging-diagnosis tools. Adds
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
	aiChargingDiagnosisHandler := aichargdiag.NewHandler(
		aiRegistry,
		aiToolRegistry,
		chargingdiagnosis.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// RAG-backed app help.
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
	// rag-help tools. Adds
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
	aiRagHelpHandler := airaghelp.NewHandler(
		aiRegistry,
		aiToolRegistry,
		raghelp.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Natural-language drive search and
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
	// request — the gated background job `ai_drive_indexer`
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
	// nl-drive-search-replay tools.
	// Adds `retrieve_drive_chunks` + `hydrate_drive_replay` to the
	// shared tool registry so the dispatcher can resolve them for
	// the nl-drive-search-replay strategy. Same ordering rule as
	// the other slice tools above: must be registered before the
	// handler constructor below so the strategy's allowedTools
	// resolve at boot. The Hydrator is the aidrivesearch adapter,
	// which delegates per-source-type
	// lookups to the existing canonical pgSearcher — same code
	// path the typed GET /api/v1/search baseline uses (ADR-015 §I3
	// baseline-intact: no duplicate read path is introduced by
	// this slice).
	trip.RegisterDriveSearchTools(aiToolRegistry, trip.DriveSearchSources{
		Retriever: aiDriveSearchRetriever,
		Hydrator:  aidrivesearch.NewHydrator(apisearch.NewPGSearcher(db)),
	})
	// Natural-language drive search and replay handler. One per
	// process; stateless beyond constructor inputs. Must be
	// constructed AFTER the tool registration above so the
	// dispatcher can resolve the strategy's allowedTools at boot.
	aiDriveSearchHandler := aidrivesearch.NewHandler(
		aiRegistry,
		aiToolRegistry,
		nldrivesearchreplay.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Speed-profile insights.
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
	aiSpeedProfileInsightsHandler := aispeedprof.NewHandler(
		aiRegistry,
		aiToolRegistry,
		speedprofileinsights.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// Route-efficiency suggestions.
	// Build the per-feature F7 retriever scoped to the
	// route-efficiency-suggestions feature id. The retriever
	// embeds queries with the local nomic-embed-text model and
	// fans out across the user_subject's chunks in `signal_log`
	// (the embedding store; the retriever scopes by user_subject
	// at the SQL boundary). Only the drive_summary corpus is
	// populated today; route_efficiency + weather_context are
	// forward-compat reservations per the request — the
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
	// route-efficiency-suggestions tools.
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
	aiRouteEfficiencySuggestionsHandler := airouteeff.NewHandler(
		aiRegistry,
		aiToolRegistry,
		routeefficiencysuggestions.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// Auto trip naming.
	// Construct the shared TripsDetailRepo once so both the
	// auto-trip-naming AI tool path and (eventually) the
	// canonical /api/v1/trips/{trip_id} handler share a single
	// read path against the trips/trip_drives schema. Today the
	// canonical handler still builds its own repo inline at the
	// mount point; the duplicate is intentional and short-lived —
	// a future cleanup slice can consolidate.
	aiAutoTripNamingDetailRepo := tripdb.NewTripsDetailRepo(db.Pool)
	// auto-trip-naming tools.
	// Adds `draft_trip_name` + `validate_trip_name` to the shared
	// tool registry. Both tools are PROPOSE-only — they construct
	// or validate trip-name DTOs but do NOT touch the database;
	// the dispatcher's deny-all confirm gate is therefore never
	// triggered. The actual trip-name persistence flows through
	// an explicit user confirmation in the TripDetailPage UI
	// (out of scope for this slice).
	trip.RegisterAutoTripNamingTools(aiToolRegistry, trip.AutoTripNamingSources{
		Trips:     aiautotripname.NewAITripSourceAdapter(aiAutoTripNamingDetailRepo),
		Details:   aiAutoTripNamingDetailRepo,
		Validator: aiautotripname.NewAITripNameValidator(),
	})
	// Auto-trip-naming handler. One per process; stateless beyond
	// constructor inputs. Must be constructed AFTER the tool
	// registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiAutoTripNameHandler := aiautotripname.NewHandler(
		aiRegistry,
		aiToolRegistry,
		autotripnaming.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	lifetimeHandler := apilifetime.NewHandler(db, eventHub)
	chargePlannerHandler := chargeplanner.NewHandler(db, teslaClient, cfg, stateReader)
	yearReviewHandler := yearreview.NewHandler(db)
	energyFlowHandler := apienergyflow.NewEnergyFlowHandler(db, stateReader, liveStateReader)
	weeklyDigestHandler := apiweekly.NewHandler(db)
	teslaChargingHistoryHandler := apiteslachargehist.NewTeslaChargingHistoryHandler(teslaClient, db)
	teslaChargingSessionHandler := apiteslachargesess.NewTeslaChargingSessionHandler(teslaClient, db)
	teslaEnergyHistoryHandler := apiteslaenergyhist.NewTeslaEnergyHistoryHandler(teslaClient, db)
	teslaEnergyLiveStatusHandler := apitels.NewHandler(teslaClient, db)
	energySiteHandler := apienergysite.NewEnergySiteHandler(teslaClient, db)
	fleetTelemetryErrorHandler := apifleettelem.NewFleetTelemetryErrorHandler(teslaClient, db)
	// Wire the package-derived Fleet Telemetry coverage handler.
	// It is intentionally DB-free: the routing snapshot comes from the embedded routing.yaml
	// via router.LoadMap and the subscription view comes from
	// teslaconfig.Builder. The handler is mounted inside the existing
	// /tesla/fleet-telemetry route block below.
	fleetTelemetryHandler := apifleettelem.NewFleetTelemetryHandler(cfg)
	teslaUserConfigHandler := apituc.NewHandler(teslaClient, db)
	teslaUserOrderHandler := apituo.NewHandler(teslaClient, db)
	teslaUserProfileHandler := apitup.NewHandler(teslaClient, db)
	vehicleAccessHandler := apivehaccess.NewHandler(teslaClient, db)
	vehicleInfoHandler := apivehinfo.NewHandler(teslaClient, db)
	tripPlannerHandler := apitripplanner.NewTripPlannerHandler(db, opt.CacheStore, stateReader)

	// trip-planner-llm-agent tools.
	// Adds `query_chargers_along_route`, `query_user_charge_dwells`,
	// and `draft_trip_plan` to the shared tool registry. All three
	// are PROPOSE-only / READ-only — the first two read the existing
	// charging_sessions table via the shared ChargeSource port; the
	// third delegates to the canonical tripplanner ComputePlan
	// path via a narrow TripPlanComputer port satisfied by
	// AITripPlanComputer. The dispatcher's deny-all confirm gate is
	// therefore never triggered; the actual trip-plan persistence
	// flows through the existing canonical Plan button in the
	// TripPlannerPage UI (unchanged baseline).
	tripplantool.RegisterTripPlannerLLMAgentTools(aiToolRegistry, tripplantool.TripPlannerLLMAgentSources{
		Chargers: chargingdb.NewChargingRepo(db),
		Planner:  aitripplanllm.NewAITripPlanComputer(tripPlannerHandler),
	})
	// trip-planner-llm-agent handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiTripPlannerLLMHandler := aitripplanllm.NewHandler(
		aiRegistry,
		aiToolRegistry,
		tripplannerllmagent.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// smart-charge-schedule-suggestion tools
	// Adds `draft_charge_schedule` and
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
		Planner: aismartcharge.NewAIChargeScheduleComputer(chargePlannerHandler),
	})
	// smart-charge-schedule-suggestion handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiSmartChargeScheduleHandler := aismartcharge.NewHandler(
		aiRegistry,
		aiToolRegistry,
		smartchargeschedulesuggestion.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// battery-health-forecast-narrative
	// Registers `query_battery_health_forecast` to the
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
		Forecaster: aibatthealth.NewAIBatteryHealthForecaster(db, stateReader, signalLogReader),
	})
	// battery-health-forecast-narrative handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiBatteryHealthHandler := aibatthealth.NewHandler(
		aiRegistry,
		aiToolRegistry,
		batteryhealthforecastnarrative.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// charging-curve-fingerprint-clustering
	// The shared rag.Retriever is constructed per-feature
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
	// charging-curve-fingerprint-clustering tools.
	// Adds `retrieve_charge_curve_chunks` +
	// `query_charge_curve_features` to the shared tool registry so
	// the dispatcher can resolve them for the
	// charging-curve-fingerprint-clustering strategy. Must be
	// registered before the handler constructor below so the
	// strategy's allowedTools resolve at boot.
	// query_charge_curve_features calls ChargingRepo.GetByVehicle
	// and derives the per-cluster fingerprint envelope in-memory
	// mirroring the deterministic L1/L2/DC bucketing the SPA's
	// helpers.ts already applies — no new SQL is written.
	curve.RegisterChargingCurveFingerprintClusteringTools(aiToolRegistry, curve.ChargingCurveFingerprintClusteringSources{
		Retriever: aiChargeCurveRetriever,
		Charges:   chargingdb.NewChargingRepo(db),
	})
	// charging-curve-fingerprint-clustering handler. One per
	// process; stateless beyond constructor inputs. Must be
	// constructed AFTER the tool registration above so the
	// dispatcher can resolve the strategy's allowedTools at boot.
	aiChargingCurveClusteringHandler := aichargcurve.NewHandler(
		aiRegistry,
		aiToolRegistry,
		chargingcurvefingerprintclustering.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// cost-forecast-narration tools
	// Adds `query_cost_forecast` to the shared tool
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
		Forecaster: costforecast.NewAICostForecaster(db),
	})
	// cost-forecast-narration handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiCostForecastNarrationHandler := aicostfcst.NewHandler(
		aiRegistry,
		aiToolRegistry,
		costforecastnarration.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// period-compare-narration tools
	// Adds `query_period_compare` to the shared tool
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
		Comparator: aiperiodcmp.NewPeriodCompareSource(db),
	})
	// period-compare-narration handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiPeriodCompareNarrationHandler := aiperiodcmp.NewHandler(
		aiRegistry,
		aiToolRegistry,
		periodcomparenarration.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// lifetime-stats-qa.
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
	// lifetime-stats-qa tools.
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
		LifetimeStats: ailifetime.NewLifetimeStatsSource(db),
	})
	// lifetime-stats-qa handler. One per process; stateless beyond
	// constructor inputs. Must be constructed AFTER the tool
	// registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiLifetimeStatsQAHandler := ailifetime.NewHandler(
		aiRegistry,
		aiToolRegistry,
		lifetimestatsqa.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// incident-timeline-summarizer.
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
	// incident-timeline-summarizer tools.
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
		IncidentTimeline: aiincident.NewIncidentTimelineSource(dbobs.NewIncidentRepo(db)),
	})
	// incident-timeline-summarizer handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiIncidentTimelineSummarizerHandler := aiincident.NewHandler(
		aiRegistry,
		aiToolRegistry,
		incidenttimelinesummarizer.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// data-repair-suggestions.
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
		Validator: aidatarep.NewPlanValidator(),
	})
	// data-repair-suggestions handler. Constructed after the tool
	// registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiDataRepairSuggestionsHandler := aidatarep.NewHandler(
		aiRegistry,
		aiToolRegistry,
		datarepairsuggestions.New(),
		aidatarep.NewSource(db),
		cfg.Auth.ForwardAuthHeader,
	)

	// signal-explorer-nl-filter.
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
		Validator: aisignalnl.NewSignalFilterValidator(),
	})
	// signal-explorer-nl-filter handler. Constructed after the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiSignalExplorerNlFilterHandler := aisignalnl.NewHandler(
		aiRegistry,
		aiToolRegistry,
		signalexplorernlfilter.New(),
		aisignalnl.NewSignalCatalogSource(),
		cfg.Auth.ForwardAuthHeader,
	)

	// log-trace-summarization.
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
	// log-trace-summarization tools.
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
		TraceWindow: ailogtrace.NewTraceWindowSource(),
	})
	// log-trace-summarization handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiLogTraceSummarizationHandler := ailogtrace.NewHandler(
		aiRegistry,
		aiToolRegistry,
		logtracesummarization.New(),
		ailogtrace.NewTraceWindowSource(),
		cfg.Auth.ForwardAuthHeader,
	)

	// vampire-drain-explanation.
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
	// vampire-drain-explanation tools.
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
		Drains:    aivampire.NewSource(drivedb.NewVampireDrainRepo(db.Pool)),
	})
	// vampire-drain-explanation handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiVampireDrainExplanationHandler := aivampire.NewHandler(
		aiRegistry,
		aiToolRegistry,
		vampiredrainexplanation.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// preheat-precool-recommender tools.
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
		Advisor: aiclimate.NewAdvisor(),
	})
	// preheat-precool-recommender handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiPreheatPrecoolRecommenderHandler := aiclimate.NewHandler(
		aiRegistry,
		aiToolRegistry,
		preheatprecoolrecommender.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// T2 cabin-temperature-impact-narrative
	// tool registration. The single read-only tool
	// `query_temperature_impact` is registered on the process-wide
	// tool registry so the dispatcher can resolve the strategy's
	// allowedTools at boot. The AITemperatureImpactSource adapter
	// runs the SAME bucket / monthly-trend SQL the canonical
	// tempImpactHandler.Get already runs — no parallel write
	// path; the LLM never persists.
	forecast.RegisterCabinTemperatureImpactNarrativeTools(aiToolRegistry, forecast.CabinTemperatureImpactNarrativeSources{
		Source: aitempimpact.NewAITemperatureImpactSource(db),
	})
	// cabin-temperature-impact-narrative handler. One per
	// process; stateless beyond constructor inputs. Must be
	// constructed AFTER the tool registration above so the
	// dispatcher can resolve the strategy's allowedTools at boot.
	aiCabinTemperatureImpactNarrativeHandler := aitempimpact.NewHandler(
		aiRegistry,
		aiToolRegistry,
		cabintemperatureimpactnarrative.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// T3 tire-pressure-trend-reasoning tool
	// registration. The single read-only tool
	// `query_tire_pressure_trend` is registered on the
	// process-wide tool registry so the dispatcher can resolve
	// the strategy's allowedTools at boot. The
	// AITirePressureTrendSource adapter runs the SAME
	// signal.StateReader.Timeline projection the canonical
	// TirePressureHandler.List already runs — no parallel write
	// path; the LLM never persists.
	maintenancetool.RegisterTirePressureTrendReasoningTools(aiToolRegistry, maintenancetool.TirePressureTrendReasoningSources{
		Source: aitirepress.NewAITirePressureTrendSource(stateReader),
	})
	// tire-pressure-trend-reasoning handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiTirePressureTrendReasoningHandler := aitirepress.NewHandler(
		aiRegistry,
		aiToolRegistry,
		tirepressuretrendreasoning.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// A1 alert-tuning-suggestions tool
	// registration. The single read-only tool
	// `draft_alert_rule_patch` is registered on the
	// process-wide tool registry so the dispatcher can resolve
	// the strategy's allowedTools at boot. The `validate_alert_rule`
	// tool used by this strategy was already registered by N1
	// (tool group) above; the dispatcher resolves both at boot
	// from the SAME registry. AIAlertTuningSource adapts the
	// canonical AlertRuleRepo + NotificationRepo so the LLM
	// reads the SAME rows the manual AlertStudio path reads —
	// no parallel write path; the LLM never persists.
	alert.RegisterAlertTuningSuggestionsTools(aiToolRegistry, alert.AlertTuningSuggestionsSources{
		Source: aialerttune.NewAIAlertTuningSource(dbalert.NewAlertRuleRepo(db), dbnotif.NewNotificationRepo(db)),
	})
	// alert-tuning-suggestions handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiAlertTuningHandler := aialerttune.NewHandler(
		aiRegistry,
		aiToolRegistry,
		alerttuningsuggestions.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// A2 inbox-auto-categorization tool
	// registration. The two read-only tools
	// `draft_alert_categories` + `validate_alert_category`
	// are registered on the process-wide tool registry so
	// the dispatcher can resolve the strategy's allowedTools
	// at boot. aiinboxcat.Source adapts the
	// canonical NotificationRepo + AlertRuleRepo so the LLM
	// reads the SAME rows the manual InboxBody path reads —
	// no parallel write path; the LLM never persists.
	nl.RegisterInboxAutoCategorizationTools(aiToolRegistry, nl.InboxAutoCategorizationSources{
		Source: aiinboxcat.NewSource(dbnotif.NewNotificationRepo(db), dbalert.NewAlertRuleRepo(db)),
	})
	// inbox-auto-categorization handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiInboxCategorizationHandler := aiinboxcat.NewHandler(
		aiRegistry,
		aiToolRegistry,
		inboxautocategorization.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// A3 cross-rule-conflict-detection tool
	// registration. The two read-only tools
	// `query_alert_rules` + `detect_rule_conflicts` are
	// registered on the process-wide tool registry so the
	// dispatcher can resolve the strategy's allowedTools at
	// boot. aicrossrule.Source adapts the canonical
	// AlertRuleRepo so the LLM reads the SAME rows the manual
	// AlertStudio path reads — no parallel write path; the
	// LLM never persists. The pure-functional structural
	// detector lives in internal/ai/tools/cross_rule_conflict.go
	// (DetectRuleConflicts) and is exercised in unit tests
	// without IO.
	diagnostic.RegisterCrossRuleConflictDetectionTools(aiToolRegistry, diagnostic.CrossRuleConflictDetectionSources{
		Source: aicrossrule.NewSource(dbalert.NewAlertRuleRepo(db)),
	})
	// cross-rule-conflict-detection handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiCrossRuleConflictHandler := aicrossrule.NewHandler(
		aiRegistry,
		aiToolRegistry,
		crossruleconflictdetection.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	// G1 auto-name-unnamed-locations tool
	// registration. The two propose-only tools
	// `draft_location_name` + `validate_location_name` are
	// registered on the process-wide tool registry so the
	// dispatcher can resolve the strategy's allowedTools at
	// boot. aiautoname.LocationSource derives the visited-location
	// aggregate from the SI canonical drives table (the legacy
	// visited_locations table no longer exists; visited-location
	// aggregates are derived on demand) so the LLM reads the SAME aggregate the canonical
	// VisitedLocationRepo emits. aiautoname.LocationNameValidator
	// mirrors the byte-equivalent shape rules the canonical
	// save handler will enforce (1-200 chars, no control chars,
	// no leading/trailing whitespace).
	location.RegisterAutoNameUnnamedLocationsTools(aiToolRegistry, location.AutoNameUnnamedLocationsSources{
		Locations: aiautoname.NewLocationSource(db),
		Validator: aiautoname.NewLocationNameValidator(),
	})
	// auto-name-unnamed-locations handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiAutoNameUnnamedLocationsHandler := aiautoname.NewHandler(
		aiRegistry,
		aiToolRegistry,
		autonameunnamedlocations.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// G2 suggest-new-geofences tool registration.
	// The two propose-only tools `draft_geofence` +
	// `validate_geofence` are registered on the process-wide tool
	// registry so the dispatcher can resolve the strategy's
	// allowedTools at boot. We REUSE the shared
	// aiautoname.LocationSource adapter — both strategies grok the same
	// *geomodel.VisitedLocation aggregate (drives-table grouped on
	// vehicle_id + end_place), so duplicating the adapter would
	// be a wiring smell rather than an actual decoupling.
	// SuggestGeofenceValidator mirrors the byte-equivalent
	// shape rules the canonical geofence_handler.go's
	// validateGeofence enforces (1-200 chars, no control chars,
	// no leading/trailing whitespace, radius 50-1000 meters).
	location.RegisterSuggestNewGeofencesTools(aiToolRegistry, location.SuggestNewGeofencesSources{
		Locations: aiautoname.NewLocationSource(db),
		Validator: aisuggeo.NewSuggestGeofenceValidator(),
	})
	// suggest-new-geofences handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiSuggestNewGeofencesHandler := aisuggeo.NewHandler(
		aiRegistry,
		aiToolRegistry,
		suggestnewgeofences.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// G3 geofence-aware automation suggestions.
	// Reuse the shared automation tools because re-registering duplicate names
	// would panic. The handler injects only deterministic geofence id/name/category;
	// lat/lon stays out of LLM context by policy.
	aiGeofenceAwareAutomationHandler := aigeofautom.NewHandler(
		aiRegistry,
		aiToolRegistry,
		geofenceawareautomationsuggestions.New(),
		geofencedb.NewGeofenceRepo(db),
		cfg.Auth.ForwardAuthHeader,
	)

	// learned-per-vehicle-anomaly-baselines
	// 0062) tools — train_anomaly_baseline + query_anomaly_baseline.
	// Both READ-only; the trainer reads signal_log via the
	// SignalSampleSource adapter and returns a per-signal learned
	// envelope (mean / stddev / p5 / p95) clamped to the static
	// safe-range envelope, with safe-range fallback per signal when
	// fewer than anomaly.DefaultMinSamples observations exist in
	// the lookback window. Tools registered BEFORE the handler is
	// constructed so the dispatcher can resolve the strategy's
	// allowedTools at boot.
	predict.RegisterLearnedAnomalyBaselineTools(aiToolRegistry, predict.LearnedAnomalyBaselineSources{
		Trainer: anomaly.NewTrainer(aimlanom.NewSignalSampleSource(db)),
	})
	// learned-per-vehicle-anomaly-baselines handler. One per
	// process; stateless beyond constructor inputs. Must be
	// constructed AFTER the tool registration above.
	aiLearnedAnomalyBaselinesHandler := aimlanom.NewHandler(
		aiRegistry,
		aiToolRegistry,
		learnedanomalybaselines.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// range-prediction-model tools —
	// train_range_model + query_range_prediction. Both READ-only;
	// the trainer reads the `drives` table via the aimlrange DriveStatsSource
	// adapter (SI columns: distance_m, energy_used_wh, avg_speed_mps,
	// ambient_temp_c_avg per migration 000185) and returns a
	// per-bucket learned envelope (mean Wh/km plus stddev / p5 / p95)
	// with linear-fallback to the static heuristic curve per bucket
	// when fewer than mlrange.DefaultMinSamplesPerBucket=5 drives
	// exist in the lookback window. Tools registered BEFORE the
	// handler is constructed so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	predict.RegisterRangePredictorTools(aiToolRegistry, predict.RangePredictorSources{
		Trainer: mlrange.NewTrainer(aimlrange.NewDriveStatsSource(db)),
	})
	// range-prediction-model handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the tool
	// registration above.
	aiRangePredictionHandler := aimlrange.NewHandler(
		aiRegistry,
		aiToolRegistry,
		rangepredictionmodel.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// ml-charging-curve-clustering tools —
	// train_charge_curve_clusters + query_charge_curve_clusters.
	// Both READ-only; the trainer reads the `charging_sessions`
	// table via the aimlchargcv.ChargingSessionSource adapter (SI columns
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
		Trainer: mlchargingcurves.NewTrainer(aimlchargcv.NewChargingSessionSource(chargingdb.NewChargingRepo(db))),
	})
	// ml-charging-curve-clustering handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiMLChargingCurveClusteringHandler := aimlchargcv.NewHandler(
		aiRegistry,
		aiToolRegistry,
		mlchargingcurveclustering.New(),
		cfg.Auth.ForwardAuthHeader,
	)
	geocodeHandler := apigeocode.NewHandler(geocoding.NewSearcher("TeslaSync/1.0"), geocoding.NewGeocoder(cfg.GoogleMaps.APIKey, cfg.AzureMaps.APIKey))
	shareHandler := apishare.NewShareHandler(db)
	watchHandler := watch.NewHandler(db, teslaClient)
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
	// redisSignalCache is also consumed by the migration V2
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
	//.
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
	automationEventHub := sse.NewEventHub()
	automationPublisher := apiautomation.NewAutomationEventPublisher(automationEventHub)

	// Wire MQTT publisher for automation config change notifications
	var automationMQTTPublisher apiautomation.AutomationMQTTPublisher
	if mqttClient != nil {
		automationMQTTPublisher = apiautomation.NewMQTTReloader(mqttClient)
	}

	automationHandler := apiautomation.NewAutomationHandler(db,
		apiautomation.WithCommandExecutor(action.NewCommandExecutor(
			vehicledb.NewVehicleRepo(db),
			energydb.NewCommandLogRepo(db),
			&settingsCheckerAdapter{settingsdb.NewSettingsRepo(db)},
			teslaClient,
		)),
		apiautomation.WithAutomationEventPublisher(automationPublisher),
		apiautomation.WithAutomationAuditor(automation.NewAuditor(NewDBAuditWriter(db))),
		apiautomation.WithAutomationMQTTPublisher(automationMQTTPublisher),
	)
	telemetryHandler := opt.TelemetryHandler
	if telemetryHandler == nil {
		telemetryHandler = apitelem.NewHandler(db, mqttClient, eventHub, 5*time.Minute, geocoding.NewGeocoder(cfg.GoogleMaps.APIKey, cfg.AzureMaps.APIKey))
	} else {
		// Reusing handler from main ╬ô├ç├╢ wire the eventHub created by the router
		telemetryHandler.SetEventHub(eventHub)
	}
	// install the cold-path signal.StateReader on the
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
	devToolsHandler := apidevtools.NewDevToolsHandler(teslaClient,
		apidevtools.WithDB(db),
		apidevtools.WithMQTTClient(mqttClient),
		apidevtools.WithConfig(cfg),
		apidevtools.WithRedisSignalCache(redisSignalCache),
		apidevtools.WithSignalStore(opt.SignalStore),
	)

	// Wire telemetry handler into vehicle handler for streaming-aware state
	vehicleHandler.SetTelemetrySource(telemetryHandler)

	// Wire signal.StateReader into vehicle service for the durable
	// last-value backstop used by BuildStateFromSignalStore (ADR-002).
	vehicleSvc.WithStateReader(stateReader)

	// Wire telemetry handler into settings handler for capture toggle sync
	settingsHandler.SetTelemetryHandler(telemetryHandler)
	r.Get("/healthz", HealthHandler(opt.LivenessChecks...))
	r.Get("/readyz", ReadyHandler(db, teslaClient))

	// Internal: READ-ONLY drain contract. The mutating drain endpoint
	// (/internal/flush) is NOT mounted here — it is one-way and
	// pod-fatal, so a public route would let any caller that reaches the
	// ingress permanently remove a healthy pod from service. It lives on
	// the isolated internal listener in internal/app/drain.go, on a port
	// no Service or Ingress targets.
	// (Signal store no longer has Postgres flush — Redis + signal_log handle persistence)
	r.Get(ops.DrainStatusPath, DrainStatusHandler(cfg.DrainPort))
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

	// Public: Web Vitals ingest. Anonymous browsers
	// POST batches of LCP/INP/CLS/FCP/TTFB samples here. Mounted outside
	// the /api/v1 ForwardAuth subrouter so logged-out clients can still
	// report — the body carries no PII and the handler caps batch size +
	// label cardinality. Rate-limited per IP to bound abuse.
	webVitalsHandler := apivitals.NewHandler()
	r.With(
		httprate.LimitByIP(120, 1*time.Minute),
	).Post("/api/v1/web-vitals", webVitalsHandler.Ingest)

	// Public: Web error reports. The SPA's global
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

	// Public: Auth session-info endpoint. The
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

	// System state: single-row maintenance/degraded-mode
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

	// in-app feedback widget. Repo is shared
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

	// feedback-queue-triage.
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
	// feedback-queue-triage tools.
	// Adds `draft_feedback_triage` + `validate_feedback_triage` +
	// `retrieve_feedback_chunks` to the shared tool registry so
	// the dispatcher can resolve them for the
	// feedback-queue-triage strategy. Same ordering rule as the
	// other slice tools above: must be registered before the
	// handler constructor below so the strategy's allowedTools
	// resolve at boot. The Source is the production
	// FeedbackTriageSource adapter that wraps userFeedbackRepo
	// and PII-minimizes the row into a FeedbackTriageEntry.
	aiFeedbackTriageSource := aifeedtri.NewFeedbackTriageSource(userFeedbackRepo)
	feedback.RegisterFeedbackQueueTriageTools(aiToolRegistry, feedback.FeedbackQueueTriageSources{
		Source:    aiFeedbackTriageSource,
		Retriever: aiFeedbackTriageRetriever,
	})
	// feedback-queue-triage handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiFeedbackQueueTriageHandler := aifeedtri.NewHandler(
		aiRegistry,
		aiToolRegistry,
		feedbackqueuetriage.New(),
		aiFeedbackTriageSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// mqtt-sse-inspector-explanations.
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
	// mqtt-sse-inspector-explanations tools
	// Adds `query_stream_inspector` +
	// `retrieve_stream_chunks` to the shared tool registry so the
	// dispatcher can resolve them for the
	// mqtt-sse-inspector-explanations strategy. Same ordering
	// rule as the other slice tools above: must be registered
	// before the handler constructor below so the strategy's
	// allowedTools resolve at boot. The Source is the production
	// StreamInspectorSource adapter that returns a
	// deterministic empty envelope describing the bound window;
	// the canonical baseline /api/v1/admin/mqtt/status surface
	// remains reachable to the operator at all times.
	aiStreamInspectorSource := aimqttsse.NewStreamInspectorSource()
	diagnostic.RegisterMqttSseInspectorExplanationsTools(aiToolRegistry, diagnostic.MqttSseInspectorExplanationsSources{
		Retriever:       aiMqttSseInspectorExplanationsRetriever,
		StreamInspector: aiStreamInspectorSource,
	})
	// mqtt-sse-inspector-explanations handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiMqttSseInspectorExplanationsHandler := aimqttsse.NewHandler(
		aiRegistry,
		aiToolRegistry,
		mqttsseinspectorexplanations.New(),
		aiStreamInspectorSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// state-machine-debugger-narrator.
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
	// state-machine-debugger-narrator tools
	// Adds `query_fsm_trace` + `retrieve_fsm_chunks` to
	// the shared tool registry so the dispatcher can resolve them
	// for the state-machine-debugger-narrator strategy. Same
	// ordering rule as the other slice tools above: must be
	// registered before the handler constructor below so the
	// strategy's allowedTools resolve at boot. The Source is the
	// production FSMTraceSource adapter that returns a
	// deterministic empty envelope describing the bound tuple;
	// the canonical baseline /api/v1/fsm/transitions surface
	// remains reachable to the operator at all times.
	aiFSMTraceSource := aifsmnar.NewFSMTraceSource()
	summary.RegisterStateMachineDebuggerNarratorTools(aiToolRegistry, summary.StateMachineDebuggerNarratorSources{
		Retriever: aiStateMachineDebuggerNarratorRetriever,
		FSMTrace:  aiFSMTraceSource,
	})
	// state-machine-debugger-narrator handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiStateMachineDebuggerNarratorHandler := aifsmnar.NewHandler(
		aiRegistry,
		aiToolRegistry,
		statemachinedebuggernarrator.New(),
		aiFSMTraceSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// predictive-maintenance retriever
	// The strategy's retrieve_maintenance_chunks tool
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
	// predictive-maintenance tools.
	// Adds `query_maintenance_context` + `retrieve_maintenance_chunks`
	// to the shared tool registry so the dispatcher can resolve
	// them for the predictive-maintenance strategy. Same ordering
	// rule as the other slice tools above: must be registered
	// before the handler constructor below so the strategy's
	// allowedTools resolve at boot. The Source is the production
	// aipredmaint.ContextSource adapter that wraps the
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
	aiPredictiveMaintenanceContextSource := aipredmaint.NewContextSource(db, aiPredictiveMaintenanceRedisCache)
	maintenancetool.RegisterPredictiveMaintenanceTools(aiToolRegistry, maintenancetool.PredictiveMaintenanceSources{
		Retriever:          aiPredictiveMaintenanceRetriever,
		MaintenanceContext: aiPredictiveMaintenanceContextSource,
	})
	// predictive-maintenance handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiPredictiveMaintenanceHandler := aipredmaint.NewHandler(
		aiRegistry,
		aiToolRegistry,
		predictivemaintenance.New(),
		aiPredictiveMaintenanceContextSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// tco-narration tools. Adds
	// `query_tco_summary` to the shared tool registry so the
	// dispatcher can resolve it for the tco-narration
	// strategy. Must be registered before the handler
	// constructor below so the strategy's allowedTools resolve
	// at boot. The TCOSummarizer adapter delegates to the same
	// package-level tco.ComputeTCOSummary helper that also
	// backs the canonical GET /api/v1/analytics/tco handler —
	// the AI narrator quotes the SAME deterministic envelope
	// the chart renders (no duplicated SQL).
	lifetime.RegisterTCONarrationTools(aiToolRegistry, lifetime.TCONarrationSources{
		Summarizer: aitconar.NewTCOSummarizer(db),
	})
	// tco-narration handler. One per process; stateless beyond
	// constructor inputs. Must be constructed AFTER the tool
	// registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiTCONarrationHandler := aitconar.NewHandler(
		aiRegistry,
		aiToolRegistry,
		tconarration.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// software-update-changelog-summarizer retriever.
	// The strategy's retrieve_update_notes
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
	// software-update-changelog-summarizer tools.
	// Adds `query_vehicle_software` +
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
	aiVehicleSoftwareSource := aiswupd.NewVehicleSoftwareSource(systemdb.NewSoftwareUpdateRepo(db))
	summary.RegisterSoftwareUpdateChangelogSummarizerTools(aiToolRegistry, summary.SoftwareUpdateChangelogSummarizerSources{
		Retriever:       aiSoftwareUpdateChangelogSummarizerRetriever,
		VehicleSoftware: aiVehicleSoftwareSource,
	})
	// software-update-changelog-summarizer handler. One per
	// process; stateless beyond constructor inputs. Must be
	// constructed AFTER the tool registration above so the
	// dispatcher can resolve the strategy's allowedTools at
	// boot.
	aiSoftwareUpdateChangelogSummarizerHandler := aiswupd.NewHandler(
		aiRegistry,
		aiToolRegistry,
		softwareupdatechangelogsummarizer.New(),
		aiVehicleSoftwareSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// pii-redaction-shared-exports tools
	// Adds `draft_export_redaction_plan` +
	// `validate_export_redaction_plan` to the shared tool
	// registry so the dispatcher can resolve them for the
	// pii-redaction-shared-exports strategy. Both tools wrap a
	// STATIC in-process Go catalog and a pure-Go validator; NO
	// database IO is performed by either tool. The
	// deterministic GET/POST /api/v1/export/jobs endpoints
	// remain the canonical baseline export pipeline; this
	// slice's tools never trigger an export and never touch the
	// existing handlers. Registered AFTER the tool group tools
	// above so the registry's Names list grows deterministically.
	export.RegisterPiiRedactionSharedExportsTools(aiToolRegistry)
	// pii-redaction-shared-exports handler. One per process;
	// stateless beyond constructor inputs. Must be constructed
	// AFTER the tool registration above so the dispatcher can
	// resolve the strategy's allowedTools at boot.
	aiPiiRedactionSharedExportsHandler := aipiiredact.NewHandler(
		aiRegistry,
		aiToolRegistry,
		piiredactionsharedexports.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// quiet-hours-suggestion tools
	// Adds `draft_quiet_hours_window` +
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
	// Registered AFTER the tool group tools above so the
	// registry's Names list grows deterministically.
	aiQuietHoursSuggestionSource := aiquiethrs.NewSource(
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
	aiQuietHoursSuggestionHandler := aiquiethrs.NewHandler(
		aiRegistry,
		aiToolRegistry,
		quiethourssuggestion.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// safety-setting-explainer source.
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
	// the tool group tools above so the registry's Names
	// list grows deterministically.
	aiSafetySettingExplainerSource := aisafetyexp.NewSource(aiSettingsRepo)
	safety.RegisterSafetySettingExplainerTools(aiToolRegistry, safety.SafetySettingExplainerSources{
		Source: aiSafetySettingExplainerSource,
	})
	// safety-setting-explainer handler. One per process;
	// stateless beyond constructor inputs. Must be
	// constructed AFTER the tool registration above so the
	// dispatcher can resolve the strategy's allowedTools at
	// boot.
	aiSafetySettingExplainerHandler := aisafetyexp.NewHandler(
		aiRegistry,
		aiToolRegistry,
		safetysettingexplainer.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// voice-mode sources.
	// The voice-mode AI surface layers an opt-in browser
	// STT/TTS conversational overlay on top of the existing
	// /chatbot text panel. Its single read-only tool
	// stream_chatbot_response bundles:
	//
	// - the recent chat history for the in-scope session
	// (read via the canonical *dbnotif.ChatRepo — the
	// SAME repo the deterministic /chatbot endpoint uses)
	// - the install-wide vehicle snapshot (VIN, display_name,
	// soc_percent, charging_state, last_drive_summary —
	// projected from VehicleRepo + LiveStateReader +
	// DriveRepo so the LLM reads the SAME values the rest
	// of the API surface already does; GPS / street names
	// are deliberately omitted)
	//
	// NO new SQL is written; both adapters wrap existing
	// readers. Registered AFTER the tool group tools above so
	// the registry's Names list grows deterministically.
	aiVoiceModeChatSource := aivoice.NewChatContextSource(dbnotif.NewChatRepo(db))
	aiVoiceModeVehicleSource := aivoice.NewVehicleSnapshotSource(
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
	aiVoiceModeHandler := aivoice.NewHandler(
		dbnotif.NewChatRepo(db),
		aiRegistry,
		aiToolRegistry,
		voicemode.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// watch-face-nl-response sources.
	// The watch-face-nl-response AI surface layers an opt-in
	// Helix narrator on top of the existing /watch deterministic
	// surface. Its single read-only tool query_watch_context
	// bundles:
	//
	// - the primary-vehicle snapshot (vehicle_name from
	// VehicleRepo + scalar live-state from the canonical
	// RedisSignalCache — the SAME two readers the
	// deterministic /watch/summary handler uses)
	// - the trailing-24h non-critical recent-alert list,
	// projected to {severity, age_seconds} pairs only (no
	// title, no message body, no PII) — read via the
	// canonical NotificationRepo.
	//
	// NO new SQL is written; both adapters wrap existing
	// readers. Registered AFTER the tool group tools above so
	// the registry's Names list grows deterministically.
	aiWatchFaceNLContextSource := aiwatchnl.NewContextSource(
		vehicledb.NewVehicleRepo(db),
		redisSignalCache,
	)
	aiWatchFaceNLAlertHistorySource := aiwatchnl.NewAlertHistorySource(
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
	aiWatchFaceNLResponseHandler := aiwatchnl.NewHandler(
		aiRegistry,
		aiToolRegistry,
		watchfacenlresponse.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// nl-sql-playground sources.
	// The nl-sql-playground AI surface layers an opt-in Helix
	// translator on top of the manual SQL editor at /power/sql.
	// Its two propose-only tools (draft_readonly_sql +
	// validate_readonly_sql) build a typed ReadonlySQLDraft for
	// the user to review and copy into the existing manual SQL
	// editor; the AI never executes SQL itself. The curated
	// install-wide schema catalog (drives, charging_sessions,
	// vehicles, alerts, signal_log_view) is hardcoded in
	// ainlsql.SchemaCatalogSourceImpl — adding a table is a
	// deliberate per-prompt decision, not a default. NO new SQL
	// is written by this slice; the executor remains the
	// canonical baseline manual editor + the user's Run button.
	// Registered AFTER the tool group tools above so the
	// registry's Names list grows deterministically.
	aiNLSqlPlaygroundCatalogSource := ainlsql.NewSchemaCatalogSource()
	aiNLSqlPlaygroundValidator := ainlsql.NewValidator()
	nlq.RegisterNLSqlPlaygroundTools(aiToolRegistry, nlq.NLSqlPlaygroundSources{
		Validator: aiNLSqlPlaygroundValidator,
	})
	// nl-sql-playground handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiNLSqlPlaygroundHandler := ainlsql.NewHandler(
		aiRegistry,
		aiToolRegistry,
		nlsqlplayground.New(),
		aiNLSqlPlaygroundCatalogSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// nl-grafana-panel sources.
	// The nl-grafana-panel AI surface layers an opt-in Helix
	// translator on top of the manual Grafana panel JSON editor
	// at /power/grafana. Its two propose-only tools
	// (draft_grafana_panel + validate_grafana_panel) build a
	// typed GrafanaPanelDraft for the user to review and copy
	// into the existing manual JSON editor; the AI never pushes
	// to Grafana itself. The three curated install-wide
	// catalogs (panel-types, datasource-types, tables) are
	// hardcoded in ainlgrafana.NLGrafanaPanelCatalogSourceImpl — adding
	// any of these is a deliberate per-prompt decision, not a
	// default. The table catalog is shared with nl-sql-playground
	// so the two slices stay in lock-step. Registered AFTER the
	// tool group tools above so the registry's Names list grows
	// deterministically.
	aiNLGrafanaPanelCatalogSource := ainlgrafana.NewNLGrafanaPanelCatalogSource()
	aiNLGrafanaPanelValidator := ainlgrafana.NewNLGrafanaValidator()
	nlq.RegisterNLGrafanaPanelTools(aiToolRegistry, nlq.NLGrafanaPanelSources{
		Validator: aiNLGrafanaPanelValidator,
	})
	// nl-grafana-panel handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiNLGrafanaPanelHandler := ainlgrafana.NewHandler(
		aiRegistry,
		aiToolRegistry,
		nlgrafanapanel.New(),
		aiNLGrafanaPanelCatalogSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// nl-dashboard-composer (PU3). Registers
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
	// hardcoded in ainldash.CatalogSourceImpl —
	// adding a panel is a deliberate per-prompt decision, not a
	// default. Registered AFTER nl-grafana-panel above so the
	// registry's Names list grows deterministically.
	aiNLDashboardComposerCatalogSource := ainldash.NewCatalogSource()
	aiNLDashboardComposerValidator := ainldash.NewValidator()
	nlq.RegisterNLDashboardComposerTools(aiToolRegistry, nlq.NLDashboardComposerSources{
		Validator: aiNLDashboardComposerValidator,
	})
	// nl-dashboard-composer handler. One per process; stateless
	// beyond constructor inputs. Must be constructed AFTER the
	// tool registration above so the dispatcher can resolve the
	// strategy's allowedTools at boot.
	aiNLDashboardComposerHandler := ainldash.NewHandler(
		aiRegistry,
		aiToolRegistry,
		nldashboardcomposer.New(),
		aiNLDashboardComposerCatalogSource,
		cfg.Auth.ForwardAuthHeader,
	)

	// trip-postcard-share-card-image-generation (the migration,
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
	aiTripPostcardShareCardImageGenerationHandler := aipostcard.NewHandler(
		aiRegistry,
		aiToolRegistry,
		trippostcardsharecardimagegeneration.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// vehicle-paint-preview. Registers
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
	aiVehiclePaintPreviewHandler := aivehpaint.NewHandler(
		aiRegistry,
		aiToolRegistry,
		vehiclepaintpreview.New(),
		cfg.Auth.ForwardAuthHeader,
	)

	// rate-limit status counters. Construct two
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

	// worker heartbeat store powering the
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
	r.Route("/api/v1", func(r chi.Router) {
		// count every /api/v1 request and every
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
		// live log stream is also excluded so the
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

		// All authenticated mutations prove browser same-origin intent and are
		// bounded by a shared per-client backstop. Public browser telemetry is
		// mounted outside this group so anonymous ingestion remains unaffected;
		// credential and destructive routes retain their stricter local limits.
		r.Use(apimw.CSRFProtectionWithOptions(apimw.CSRFOptions{
			AllowedOrigins:       apimw.ParseAllowedOrigins(cfg.CORSOrigins),
			AllowLoopbackOrigins: cfg.Auth.ForwardAuthHeader == "",
		}))
		r.Use(apimw.NewWriteRateLimiter(apimw.DefaultWriteLimit, time.Minute, cfg.Auth.ForwardAuthHeader).Middleware)

		// Subject recorder. MUST run AFTER
		// ForwardAuthMiddleware (so the principal header is the
		// authoritative one for this request) and BEFORE both the
		// session tracker and the impersonation rewrite (so the
		// recorded subject is the *original* admin identity even
		// during an active impersonation, matching the contract that
		// auth_subjects materialises every distinct human operator
		// who has touched the API). Open mode is a passthrough.
		r.Use(tsauth.SubjectRecorderMiddleware(cfg.Auth.ForwardAuthHeader, subjectRecorder))

		// Session tracker. MUST run AFTER
		// ForwardAuthMiddleware so the principal header is guaranteed
		// present. Mints + binds a TeslaSync-issued cookie on the first
		// authenticated request, validates it on every subsequent one,
		// and rejects revoked cookies with 401 + clear-cookie. Open mode
		// (no FORWARD_AUTH_HEADER configured) is a passthrough.
		r.Use(tsauth.Middleware(cfg.Auth.ForwardAuthHeader, authSessionsRepo, tsauth.SessionTrackerOptions{}))

		// Impersonation middleware. MUST run
		// AFTER the session tracker so the tracker pins the cookie to
		// the actual admin identity (not the rewritten target). The
		// middleware verifies the HMAC-signed impersonation cookie,
		// re-binds it against the live admin subject, and rewrites the
		// FORWARD_AUTH header to the impersonation target so all
		// downstream handlers transparently "see what the target sees".
		// Open mode is a passthrough.
		r.Use(tsauth.ImpersonationMiddleware(cfg.Auth.ForwardAuthHeader, impersonationStore))

		r.With(httprate.LimitByIP(60, 1*time.Minute)).Post("/audit/reveal", maskedRevealHandler.Reveal)

		// Auth (stricter rate limits to prevent brute force)
		r.Route("/auth", func(r chi.Router) {
			r.Use(httprate.LimitByIP(10, 1*time.Minute))
			r.Get("/login", authHandler.Login)
			r.Post("/url", authHandler.Login)
			r.Get("/callback", authHandler.Callback)
			r.Post("/refresh", authHandler.Refresh)
			r.Get("/status", authHandler.Status)
			// destructive: revokes Tesla
			// refresh token and clears credentials. Sudo gated.
			// Blocked during impersonation so
			// an admin cannot accidentally disconnect the target's
			// Tesla account; the original admin must end impersonation
			// first.
			r.With(tsauth.RequireNotImpersonating(), RequireSudo(sudoStore, sudoCfg)).Post("/disconnect", authHandler.Disconnect)
			// Sudo step-up reauth. POST a
			// password OR totp_code to mint a 5-minute X-Sudo-Token
			// the SPA echoes on subsequent destructive requests. In
			// open mode this returns 200 mode="open" without minting
			// anything; the dialog falls back to typed-confirmation.
			// Blocked during impersonation so
			// no fresh sudo tokens can be minted under the target's
			// rewritten principal. Existing tokens won't validate
			// either (token subject != rewritten subject), so this is
			// belt-and-suspenders.
			r.With(tsauth.RequireNotImpersonating()).Post("/reauth", sudoHandler.Reauth)
			// per-user TOTP enrollment.
			// /totp GET status pill backing
			// /totp/enroll POST start enrollment
			// /totp/verify POST confirm enrollment
			// /totp/sudo POST mint sudo token via per-user TOTP
			// /totp DELETE revoke (sudo-gated)
			// /totp/backup-codes/regenerate POST rotate backup codes (sudo-gated)
			//
			// The entire /totp subtree is
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
			// Active sessions / device
			// management. List is read-only; both DELETE routes are
			// sudo-gated (RequireSudo is a passthrough in open mode,
			// so the handler's own AUTH_MODE_OPEN check is what
			// guards the resource semantics there).
			//
			// DELETEs are blocked during
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

		// Onboarding: first-run gate status.
		// Reports whether the install has connected a Tesla account,
		// has any vehicles, and has received recent telemetry, PLUS the
		// durable setup_required/setup_complete contract: once an
		// install is durably configured (persisted in the
		// onboarding_state table — see internal/database/user's
		// OnboardingStateRepo and migration 000230), a later Fleet
		// Telemetry outage or an expired Tesla token does NOT flip it
		// back to setup_required. is_complete is kept as a
		// backward-compatible alias of setup_complete. The frontend
		// polls this endpoint and routes the user to <OnboardingPage>
		// until is_complete flips to true.
		r.Get("/onboarding/status", onboardingHandler.Status)
		r.Route("/vehicles", func(r chi.Router) {
			r.Get("/", vehicleHandler.List)
			// Batch current state for the whole fleet in ONE request.
			// Registered as a STATIC segment inside this group so chi's trie
			// resolves it ahead of the /{vehicleID} parameter node below
			// (same precedence the existing static /sync route relies on).
			r.Get("/states", fleetStateHandler.List)
			r.With(httprate.LimitByIP(5, 1*time.Minute)).Post("/sync", vehicleHandler.SyncFromTesla)
			r.Route("/{vehicleID}", func(r chi.Router) {
				r.Get("/", vehicleHandler.Get)
				// destructive: requires sudo.
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

				// Battery Passport — a verifiable, tamper-evident SoH
				// provenance certificate. Both routes are read-only: the
				// GET builds the certificate (and best-effort appends an
				// audit-ledger snapshot), and /verify recomputes the
				// provenance hash so a buyer can detect tampering. No rate
				// limit — the SPA reads them on page load and the ledger
				// write is off the read's critical path.
				r.Get("/battery-passport", batteryPassportHandler.Get)
				r.Get("/battery-passport/verify", batteryPassportHandler.Verify)
				r.Get("/weekly-digest", weeklyDigestHandler.Get)

				// Vehicle Time Machine — reconstruct the complete signal
				// state at any past instant from the signal_log cold path.
				// Both routes are read-only and rate-limit-free: the SPA
				// polls them as the user drags the timeline scrubber, and
				// the point-in-time query is index-served + field-capped.
				r.Get("/time-machine", timeMachineHandler.State)
				r.Get("/time-machine/range", timeMachineHandler.Range)

				// Carbon Intelligence — grid-aware CO2 accounting for
				// charging. /summary attributes CO2 to each session by its
				// charging hour and scores the timing vs a gas-car baseline;
				// /recommendation surfaces the greenest charging window. Both
				// are read-only and rate-limit-free (the SPA reads them on page
				// load; the diurnal grid model is a tiny 24-row table). The
				// vehicle-independent curve is served at the top-level
				// GET /api/v1/carbon/intensity route below.
				r.Get("/carbon/summary", carbonHandler.Summary)
				r.Get("/carbon/recommendation", carbonHandler.Recommendation)

				// Remaining Useful Life — predictive component prognostics.
				// /rul returns the whole health board (per-component remaining
				// days/km, projected replace-by date, confidence, status) plus
				// the nearest upcoming service; /rul/{component} adds the
				// configured reference figures and a forecast series for the
				// end-of-life chart. Both are read-only and rate-limit-free (the
				// SPA reads them on page load; the prognosis is computed from
				// cached daily roll-ups + a tiny config table).
				r.Get("/rul", rulHandler.RUL)
				r.Get("/rul/{component}", rulHandler.Component)

				// Ghost Racing / EV Segments — Strava-style route segments.
				// /segments detects the vehicle's repeated start→end routes
				// from its drive history, best-effort persists each (so it
				// earns a stable id), and returns a personal-best-by-time /
				// -by-efficiency summary per segment. Read-only and
				// rate-limit-free: the SPA reads it on page load and the
				// clustering is computed from the bounded drives table. The
				// segment-scoped leaderboard + ghost race live at the
				// top-level /api/v1/segments/{segmentID}/* routes below.
				r.Get("/segments", segmentsHandler.List)

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
				mountVehicleScopedManagementRoutes(r, vehicleInfoHandler)

				// /guard endpoints restored.
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

				// per-vehicle settings.
				// GET is read-only and unguarded; PUT/DELETE are
				// rate-limited by IP at 60/min — the SPA only fires
				// these on user save/reset clicks, but the guard
				// keeps a buggy or malicious client from saturating
				// the upsert path.
				r.Get("/settings", vehicleSettingsHandler.List)
				r.With(httprate.LimitByIP(60, 1*time.Minute)).Put("/settings/{key}", vehicleSettingsHandler.Put)
				r.With(httprate.LimitByIP(60, 1*time.Minute)).Delete("/settings/{key}", vehicleSettingsHandler.Delete)

				// vehicle hero photo. POST
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
		r.Route("/drives", func(r chi.Router) {
			r.Get("/", driveHandler.ListByVehicle)
			r.Get("/stats", driveHandler.Stats)
			r.Get("/score", driveHandler.Score)
			r.Get("/dynamics", driveHandler.Dynamics)
			r.Get("/acceleration-distribution", driveHandler.AccelerationDistribution)
			// Bulk delete
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Delete("/bulk", driveHandler.BulkDelete)
			r.Route("/{driveID}", func(r chi.Router) {
				r.Get("/", driveHandler.Get)
				r.Get("/positions", driveHandler.Positions)
				r.Get("/telemetry", driveHandler.TelemetryReadings)
				// Share link management
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/share", shareHandler.Create)
				r.Get("/shares", shareHandler.List)
				//
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
		r.Get("/drivetrain/health", drivetrainHealthHandler.Get)
		r.Route("/maintenance", func(r chi.Router) {
			r.Get("/", maintenanceHandler.List)
			r.Get("/records", maintenanceHandler.Records)
		})
		r.Route("/charging", func(r chi.Router) {
			r.Get("/", chargingHandler.ListByVehicle)
			// Bulk delete
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
			// package-derived routing snapshot for the
			// admin Fleet Telemetry Coverage page. Read-only, DB-free.
			// Rate limiting matches the admin /system endpoints' 60/min
			// ceiling. The sibling /subscription endpoint owned by the
			// same handler is intentionally NOT mounted here — no
			// frontend caller exists today and the request allows only
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

		// Tesla Vehicle Management account-level endpoints.
		mountAccountVehicleManagementRoutes(r, vehicleInfoHandler)

		// Geofences
		r.Route("/geofences", func(r chi.Router) {
			r.Get("/", geofenceHandler.List)
			r.Post("/", geofenceHandler.Create)
			// Bulk operations, the "Needs Setup" queue, and the bulk
			// current-rates lookup are all kept ahead of the
			// {geofenceID} subrouter so chi matches the static path first.
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/bulk", geofenceHandler.BulkUpdate)
			r.Get("/needs-review", geofenceHandler.NeedsReview)
			r.Get("/rates/current", geofenceHandler.CurrentRates)
			r.Route("/{geofenceID}", func(r chi.Router) {
				r.Get("/", geofenceHandler.Get)
				r.Put("/", geofenceHandler.Update)
				r.Delete("/", geofenceHandler.Delete)

				// Charging-place discovery review + archive lifecycle
				// (migration 000228_geofence_charging_place_pricing).
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/archive", geofenceHandler.Archive)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/unarchive", geofenceHandler.Unarchive)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/reviewed", geofenceHandler.MarkReviewed)

				// Time-versioned electricity rates.
				r.Get("/rates", geofenceHandler.ListRates)
				r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/rates", geofenceHandler.CreateRate)
				r.Route("/rates/{rateID}", func(r chi.Router) {
					r.With(httprate.LimitByIP(20, 1*time.Minute)).Delete("/", geofenceHandler.DeleteRate)
					// Preview is read-only (no DB writes) but still
					// rate-limited: it runs the same candidate-session
					// scan ApplyRate does and must not become a free DoS
					// vector against charging_sessions.
					r.With(httprate.LimitByIP(30, 1*time.Minute)).Get("/preview", geofenceHandler.PreviewApplyRate)
					r.With(httprate.LimitByIP(10, 1*time.Minute)).Post("/apply", geofenceHandler.ApplyRate)
				})

				// Read-only charging-activity views for this place.
				r.Get("/charging-summary", geofenceHandler.ChargingSummary)
				r.Get("/charging-activity", geofenceHandler.ChargingActivity)
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
			// pre-flight provider config
			// validation for the Settings → AI form. Lives on the
			// settings sub-tree (NOT under /api/v1/ai/*) because
			// users call it WHILE opting in (ai_mode='off' at the
			// moment of the call); the /api/v1/ai/* sub-tree 404s
			// in off mode by ADR-015 §I6. Auth-only — no sudo —
			// because the worst-case write the call enables is
			// the same one /settings allows already.
			r.Post("/settings/ai/validate-config", aisettingsvalidate.Handler(aiRegistry, aiSettingsReader{repo: aiSettingsRepo}))
			// JSON bundle export + import.
			// Export is read-only; import is sudo-gated because a
			// large alert-rule replay or bulk geofence rewrite is a
			// destructive action that should always carry a fresh
			// credential. Both routes carry the parent rate limit.
			r.Get("/settings/export", settingsExportHandler.Export)
			r.With(RequireSudo(sudoStore, sudoCfg)).Post("/settings/import", settingsImportHandler.Import)
			// POST /settings/reset.
			// Sudo-gated for the same reason as /settings/import: every
			// reset is destructive (wipes alert rules, geofences, or
			// the entire user-discoverable preference surface) and
			// should always carry a fresh credential.
			r.With(RequireSudo(sudoStore, sudoCfg)).Post("/settings/reset", settingsResetHandler.Reset)
		})

		// Named dashboard layout library.
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

		// Chart annotations — durable storage for the
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

		// Pinned items — unified per-user "pin" storage
		// powering pinned-first ordering across vehicles, dashboard widgets,
		// alert rules, geofences, automations, and commands.
		r.Route("/pinned", func(r chi.Router) {
			r.Use(httprate.LimitByIP(60, 1*time.Minute))
			r.Get("/", pinnedHandler.List)
			r.Post("/", pinnedHandler.Create)
			r.Patch("/{id}", pinnedHandler.Update)
			r.Delete("/{id}", pinnedHandler.Delete)
		})

		// Saved views — durable named URL querystrings
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

		// Web Push (VAPID). Browser subscription
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
			// Bulk enable/disable
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/rules/bulk/enable", alertHandler.BulkEnableRules)
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/rules/bulk/disable", alertHandler.BulkDisableRules)
			r.Post("/test", alertHandler.TestRule)
			// alert message template helpers.
			// These are static read paths registered BEFORE the
			// catch-all `/{alertID}` route below so chi resolves them
			// correctly. They are intentionally unauthenticated only
			// to the same degree the surrounding /alerts subtree is —
			// the route group inherits whatever middleware is mounted
			// above.
			r.Get("/message-presets", alertMessageHandler.MessagePresets)
			r.Get("/message-placeholders", alertMessageHandler.MessagePlaceholders)
			r.Post("/message-preview", alertMessageHandler.MessagePreview)
			// alert acknowledgement + audit timeline.
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

			// Bulk operations — registered before the
			// {id} subrouter so chi matches the static `/bulk` path first.
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/bulk", automationHandler.BulkUpdate)

			// SSE stream for real-time automation events (static route before {id} param)
			// Protected by ForwardAuthMiddleware on the parent /api/v1 group
			r.Get("/events", sse.SSEHandler(automationEventHub, sse.WithDrainSignal(ShutdownGate.Drained())))

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

		// Carbon Intelligence — the vehicle-independent diurnal grid
		// carbon-intensity model (seeded, admin-editable). Mounted as a
		// top-level /api/v1 route because the curve is shared by every
		// vehicle; the per-vehicle carbon summary/recommendation live under
		// /vehicles/{vehicleID}/carbon/* above.
		r.Get("/carbon/intensity", carbonHandler.Intensity)

		// Ghost Racing / EV Segments — segment-scoped reads addressed by the
		// stable route_segments id (the per-vehicle list at
		// /vehicles/{vehicleID}/segments above persists and hands out the id).
		// /leaderboard ranks every attempt on the segment by time AND by energy
		// efficiency; /ghost aligns two attempts (a=&b=) onto a shared
		// distance-fraction axis for a head-to-head ghost playback. Both are
		// read-only and rate-limit-free.
		r.Get("/segments/{segmentID}/leaderboard", segmentsHandler.Leaderboard)
		r.Get("/segments/{segmentID}/ghost", segmentsHandler.Ghost)
		r.Get("/analytics/sleep", sleepHandler.GetSleepAnalytics)
		r.Get("/analytics/regen", regenHandler.Stats)
		r.Get("/analytics/battery-degradation", batteryDegradationHandler.Predict)
		r.Get("/analytics/battery-health", batteryDegradationHandler.Health)
		r.Get("/analytics/charging-heatmap", chargingHeatmapHandler.Get)
		r.Get("/analytics/speed-profile", speedProfileHandler.Get)
		r.Get("/analytics/temperature-impact", tempImpactHandler.Get)
		// Supervised self-driving distance analytics. Server-side
		// aggregation keeps the raw counter change feed off the wire; the
		// response is canonical SI meters plus explicit data-quality
		// metadata (baselines, resets, coverage).
		r.Get("/analytics/fsd", fsdInsightsHandler.Insights)
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

		// Privacy-preserving cohort benchmarks require a stable authenticated
		// subject so consent and epsilon accounting cannot be reset in open mode.
		r.Route("/benchmarks", func(r chi.Router) {
			r.Use(tsauth.RequireSubjectMiddleware(cfg.Auth.ForwardAuthHeader))
			r.Get("/privacy", benchmarkHandler.Status)
			r.With(httprate.LimitByIP(10, time.Minute)).
				Put("/privacy/consent", benchmarkHandler.Consent)
			r.With(httprate.LimitByIP(10, time.Minute)).
				Delete("/privacy/consent", benchmarkHandler.Revoke)
			r.Get("/releases", benchmarkHandler.ListReleases)
			r.With(httprate.LimitByIP(10, time.Minute)).
				Post("/releases", benchmarkHandler.CreateRelease)
		})

		// Unified decision inbox. Forward-auth users receive isolated state;
		// open-mode installs use one local subject because no identity exists.
		advancedIntelligenceHandler.MountRoutes(r)
		ownershipIntelHandler.MountRoutes(r)
		r.Get("/action-center", actionCenterHandler.List)
		r.Get("/action-center/{recommendationID}/history", actionCenterHandler.History)
		r.With(httprate.LimitByIP(30, time.Minute)).
			Post("/action-center/{recommendationID}/actions", actionCenterHandler.ApplyAction)

		// Fleet operations owns its write throttles. Service-intelligence
		// vehicle reads use the local normalized NHTSA catalog; bulk catalog
		// imports require sudo and carry their own strict write throttle.
		apifleetops.MountRoutes(r, fleetOpsHandler)
		apiserviceintelligence.Mount(r, serviceIntelligenceHandler)
		r.Get(
			"/admin/service-intelligence/communications/status",
			communicationsAdminHandler.Status,
		)
		r.With(
			httprate.LimitByIP(10, time.Hour),
			RequireSudo(sudoStore, sudoCfg),
		).Post(
			"/admin/service-intelligence/communications/import",
			communicationsAdminHandler.Import,
		)

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
			// Stable component-health notification event-type catalog
			// (event_type, component, transition, default_enabled,
			// description) — lets the Channels UI render toggles for
			// system.<component>.<outage|recovery> event types without
			// hardcoding or guessing the strings. Static/DB-free; mounted
			// before /{channelID} so chi does not treat "event-types" as
			// a channel id (same reasoning as /quiet-hours and
			// /webhooks/preview-signature below).
			r.Get("/event-types", apinotif.EventTypesHandler)
			r.Route("/schedules", func(r chi.Router) {
				r.Get("/", notifScheduleHandler.ListSchedules)
				r.Post("/", notifScheduleHandler.CreateSchedule)
				r.Delete("/{scheduleID}", notifScheduleHandler.DeleteSchedule)
			})
			// Do-Not-Disturb windows. Mounted
			// before /{channelID} so chi's path matcher does not treat
			// "quiet-hours" as a channel id.
			r.Route("/quiet-hours", func(r chi.Router) {
				r.Get("/", quietHoursHandler.List)
				r.Post("/", quietHoursHandler.Create)
				r.Patch("/{id}", quietHoursHandler.Patch)
				r.Delete("/{id}", quietHoursHandler.Delete)
			})
			// webhook signature preview is a
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
				// HMAC-aware webhook test. Sibling
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

		// Unified operations-intelligence activity timeline — read-only,
		// composed at query time from drives, charging_sessions,
		// notification_logs, software_updates, and chart_annotations. See
		// internal/database/activity for the UNION ALL composition and
		// internal/models/activity for why maintenance/service events are
		// intentionally excluded.
		r.Get("/activity", activityHandler.List)

		// /vampire-drain + /vampire-drain/stats are derived
		// live from fsm_transitions because vampire_drain_events no longer exists.
		// Parked windows come from
		// fsm_transitions (mig 000187) where fsm_name='vehicle' transitions into 'parked' — paired with
		// signal_log.field='BatteryLevel' for the SOC endpoints, with
		// charging windows excluded via signal_log.field='ChargeState'
		// (int_value > 1). Same admin-style rate limit as /mileage and
		// /vehicle-states.
		vampireDrainHandler := apivamp.NewVampireDrainHandler(drivedb.NewVampireDrainRepo(db.Pool))
		r.Route("/vampire-drain", func(r chi.Router) {
			r.Use(httprate.LimitByIP(60, 1*time.Minute))
			r.Get("/", vampireDrainHandler.Events)
			r.Get("/stats", vampireDrainHandler.Stats)
		})

		// Visited Locations
		r.Get("/locations", visitedLocationHandler.List)

		// /mileage/{monthly,stats} are derived live from the SI-canonical drives
		// table because daily_mileage no longer exists.
		// Shapes use distance_m / 1000 → km and energy_used_wh /
		// 1000 → kWh. Frontend hooks useMonthlyMileage / useMileageStats
		// stop returning 404. Same admin-style rate limit as
		// /vehicle-states.
		mileageHandler := apimileage.NewHandler(drivedb.NewMileageRepo(db.Pool))
		r.Route("/mileage", func(r chi.Router) {
			r.Use(httprate.LimitByIP(60, 1*time.Minute))
			r.Get("/monthly", mileageHandler.Monthly)
			r.Get("/stats", mileageHandler.Stats)
			// Per-day buckets for MileagePage.tsx's "Odometer Over Time" +
			// "Daily Distance" charts, derived without the legacy daily_mileage handler.
			r.Get("/daily", mileageHandler.Daily)
		})

		// Trips
		r.Get("/trips", tripHandler.List)

		// GET /trips/{trip_id} restores the
		// per-trip detail endpoint that the frontend useTrip hook
		// (web/src/api/hooks/useTrips.ts) calls to populate
		// TripDetailPage. Aggregates the trip header + constituent
		// drives (via trip_drives) + a vehicle-scoped time-window
		// charging_sessions overlap to surface drive_count /
		// charge_count / total_cost. Uses the same admin-style rate limit
		// (60/min) as related admin reads.
		tripsDetailHandler := apitripsd.NewHandler(tripdb.NewTripsDetailRepo(db.Pool))
		r.With(httprate.LimitByIP(60, 1*time.Minute)).Get("/trips/{trip_id}", tripsDetailHandler.Get)

		// /vehicle-states/{timeline,summary} are derived from
		// fsm_transitions because the vehicle_states snapshot table no longer exists.
		// The query filters mig 000187 rows to fsm_name='vehicle' so
		// frontend hooks useStateTimeline / useTimeline / useStateSummary
		// stop returning 404. Same admin-style rate limit as /system/queues.
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
		r.Get("/events", sse.SSEHandler(eventHub, sse.WithDrainSignal(ShutdownGate.Drained())))
		// Backward-compat stub: frontend still calls fetchSSEToken until it is removed
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

			// Auth-mode contract endpoint.
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
			r.Get("/config-validation", apisystem.ConfigValidation(cfg))
			r.Get("/audit", auditHandler.List)
			r.Get("/errors/stats", ErrorStatsHandler(errorTracker))
			r.Get("/errors/catalog", ErrorCatalogHandler())
			r.Get("/map-config", apisystem.MapConfigHandler(cfg))

			// Version & update endpoints
			ver := opt.AppVersion
			if ver == "" {
				ver = "dev"
			}
			r.Get("/version", apisystem.VersionHandler(ver, cfg))
			r.Get("/update-check", apisystem.UpdateCheckHandler())
			r.Get("/workers", apisystem.WorkersHealthHandler())
			r.Get("/metrics-catalog", MetricsCatalogHandler())
			r.Get("/openapi", apiopenapi.Handler())

			// Aggregated self-test endpoint.
			// Single click runs ~10 checks (DB, MQTT, Redis, Tesla
			// token + breaker, signal_log freshness, migrations,
			// runtime, health monitor) and returns a structured
			// DiagnosticReport. Per-IP rate-limited because each
			// call fans out concurrent probes against every shared
			// dependency.
			diagnosticHandler := apidiag.NewHandler(db, teslaClient, mqttClient, opt.CacheStore, health, cfg)
			r.With(httprate.LimitByIP(20, 1*time.Minute)).
				Post("/diagnostic", diagnosticHandler.ServeHTTP)

			// Rate-limit status panel feed.
			// Read-only; cheap (no DB / no Redis); polled every 30s
			// by the admin status panel. Per-IP throttle still
			// applies in case a misconfigured client busy-loops it.
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/rate-limits", rateLimitHandler.ServeHTTP)

			// Job queue status feed.
			// Aggregates pending / in-progress / 24h success-fail
			// counts across notification, export, automation
			// workers, plus latest heartbeat (Redis). Both routes
			// are GET-only and per-IP throttled at 60/min — the
			// SPA polls /system/queues every 30s and lazy-loads
			// the per-worker drawer on demand.
			queueStatusHandler := apiqueue.NewQueueStatusHandler(apiqueue.QueueStatusHandlerConfig{
				QueueRepo:      workerdb.NewWorkerQueueRepo(db),
				HeartbeatStore: queueHeartbeatStore,
			})
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/queues", queueStatusHandler.ServeStatus)
			r.With(httprate.LimitByIP(60, 1*time.Minute)).
				Get("/queues/{worker}/jobs", queueStatusHandler.ServeJobs)

			// DLQ
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

			// Feature
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

			//
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

		// / Status API: operator-grade /api/v1/status/* endpoints.
		// Stable contract for external integrations (Grafana, Uptime Kuma,
		// Home Assistant, etc.). The SPA's System Status page also subscribes
		// to /status/live (SSE) so it can drop polling. Inherits the parent
		// /api/v1 ForwardAuth gate.
		ver := opt.AppVersion
		if ver == "" {
			ver = "dev"
		}
		incidentsRepo := dbobs.NewIncidentRepo(db)
		incidentsHandler := apistatus.NewStatusIncidentsHandler(incidentsRepo)
		statusV1 := apistatus.NewStatusV1Handler(apistatus.StatusV1Config{
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

		// Operator confidence admin surface. Five
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

			// SOTA observability batch (p46: slo, p46-dq-lineage,
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

		// Per-user activity feed.
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
			handlers := apipolling.PollEngineHandlers(opt.PollEngine)
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
				// destructive: requires sudo.
				r.With(RequireSudo(sudoStore, sudoCfg)).Delete("/", apiKeyHandler.Delete)
				r.With(RequireSudo(sudoStore, sudoCfg)).Post("/revoke", apiKeyHandler.Revoke)
			})
		})

		// Admin: frontend error reporting summary.
		// Last-hour rolling counts read from the same web error handler
		// instance that the public /api/v1/web-errors POST endpoint
		// writes to, so the summary stays in sync without going through
		// Prometheus. Auth-protected by the parent /api/v1 ForwardAuth
		// middleware.
		r.Route("/admin/web-errors", func(r chi.Router) {
			r.Get("/summary", webErrorHandler.Summary)
		})

		// Admin: operator-controlled maintenance/degraded banner
		//. GET returns the persisted DB row
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

		// In-app feedback / report-bug widget.
		// POST /feedback is the public ingest path used by the SPA's
		// <FeedbackModal> (sidebar button + Cmd+K command palette
		// entry). Mounted INSIDE this ForwardAuth subrouter so anonymous
		// spam is bounded (per the request's Out-of-scope: "Anonymous
		// feedback (must be authenticated to prevent spam)"). Per-row
		// rate limit (3/hour) is enforced inside the handler against
		// user_feedback so it survives pod restarts; a tighter per-IP
		// httprate ceiling guards against payload-flooding even when
		// the DB lookup fails open.
		r.With(httprate.LimitByIP(20, 1*time.Hour)).Post("/feedback", feedbackHandler.Submit)

		// Admin feedback queue: list / get /
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

		// RBAC matrix admin endpoints.
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

		// Admin impersonation endpoints.
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

		// Admin: live log tail stream.
		// SSE endpoint that fans out structured zerolog events to
		// any authenticated browser. Read-only, idempotent — kept
		// behind the parent /api/v1 ForwardAuth gate but
		// intentionally NOT chained through RequireSudo: the SPA
		// uses fetch+ReadableStream (NOT EventSource) so it could
		// send X-Sudo-Token, but the stream itself triggers no side
		// effects so step-up is reserved for destructive admin
		// actions per the request's intent. httprate caps reconnect
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
		if telemetryHandler != nil && telemetryHandler.SignalHistoryWriter() != nil {
			shw := telemetryHandler.SignalHistoryWriter()
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

		// /signals/catalog and /signals/observations
		// restored after the migration deleted the legacy
		// signal_catalog_handler.go. The catalog spine is parsed from
		// routing.yaml (router.Load) at handler construction; aggregates
		// + observations come from signal_log (mig 000186). Frontend hooks
		// useSignalCatalog / useSignalObservations stop returning 404. Same
		// admin-style rate limit as /vehicle-states + /system/queues
		//.
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
				if telemetryHandler.SignalLogRepo() != nil {
					mongoRepo = telemetryHandler.SignalLogRepo()
				}
				signalHandler := apisignal.NewHandler(mongoRepo)
				if db != nil {
					signalHandler.WithDB(db)
				}
				if telemetryHandler.SignalHistoryWriter() != nil {
					signalHandler.WithSignalHistory(telemetryHandler.SignalHistoryWriter())
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
				r.Get("/transport-agreement", signalHandler.TransportAgreement)
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
				r.Get("/transport-agreement", signalHandler.TransportAgreement)
				r.Get("/{signalName}/history", signalHandler.History)
			}
		})

		// Data Repair
		mountDataRepairRoutes(r, dataRepairHandler, RequireSudo(sudoStore, sudoCfg))

		// Backup & Restore
		r.Route("/backup", func(r chi.Router) {
			r.Get("/configs", backupRestoreHandler.ListConfigs)
			r.Post("/configs", backupRestoreHandler.CreateConfig)
			r.Get("/configs/{configID}", backupRestoreHandler.GetConfig)
			r.Put("/configs/{configID}", backupRestoreHandler.UpdateConfig)
			// destructive: requires sudo.
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
		r.With(httprate.LimitByIP(10, 1*time.Minute)).Get("/export/{type}", apiexports.NewExportHandler(db))

		// Export Jobs (async, MQTT-backed)
		var pahoClient pahomqtt.Client
		if mqttClient != nil {
			pahoClient = mqttClient.Underlying()
		}
		exportJobHandler := apiexports.NewExportJobHandler(db, pahoClient)
		exportColumnsHandler := apiexpcol.NewHandler()
		// column-selector UI fetches the publishable
		// column catalog for the active export type. Read-only and cheap;
		// rate-limited to soak up accidental SPA loops.
		r.With(httprate.LimitByIP(60, 1*time.Minute)).Get("/exports/columns", exportColumnsHandler.ListColumns)
		r.Route("/export/jobs", func(r chi.Router) {
			r.Post("/", exportJobHandler.SubmitJob)
			r.Post("/account", exportJobHandler.SubmitAccountJob)
			// destructive: a settings import
			// can overwrite live config; gate on sudo.
			r.With(RequireSudo(sudoStore, sudoCfg)).Post("/import", exportJobHandler.SubmitImportJob)
			// Bulk operations — registered before
			// /{jobID} so chi matches the static `/bulk` path first.
			r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/bulk", exportJobHandler.BulkUpdate)
			r.Get("/", exportJobHandler.ListJobs)
			r.Get("/{jobID}", exportJobHandler.GetJob)
			r.Get("/{jobID}/download", exportJobHandler.DownloadJob)
		})

		// recurring scheduled exports.
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

		// Wire OTel FSM tracers so every Fire emits a span. The fsm.Tracer
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

		// F0 AI-Off Contract.
		//
		// Mount every /api/v1/ai/* route through the guard. The
		// guard returns 404 unless ai_mode is non-off AND the
		// per-feature toggle is on (ADR-015 §I6, §I7). Fresh
		// installs ship with ai_mode='off' so this entire subtree
		// is invisible until the user opts in via Settings.
		mountAIRoutes(r, aiGuard, aiRegistry, aiSettingsRepo, RequireSudo(sudoStore, sudoCfg), AIHandlers{
			Chatbot:                              aiChatbotHandler,
			Digest:                               aiDigestHandler,
			YIR:                                  aiYIRHandler,
			Anomaly:                              aiAnomalyHandler,
			Alert:                                aiAlertHandler,
			Automation:                           aiAutomationHandler,
			Search:                               aiSearchHandler,
			DriveCoach:                           aiDriveCoachHandler,
			ChargingDiagnosis:                    aiChargingDiagnosisHandler,
			RagHelp:                              aiRagHelpHandler,
			DriveSearch:                          aiDriveSearchHandler,
			SpeedProfileInsights:                 aiSpeedProfileInsightsHandler,
			RouteEfficiencySuggestions:           aiRouteEfficiencySuggestionsHandler,
			AutoTripName:                         aiAutoTripNameHandler,
			TripPlannerLLM:                       aiTripPlannerLLMHandler,
			SmartChargeSchedule:                  aiSmartChargeScheduleHandler,
			BatteryHealth:                        aiBatteryHealthHandler,
			ChargingCurveClustering:              aiChargingCurveClusteringHandler,
			CostForecastNarration:                aiCostForecastNarrationHandler,
			VampireDrainExplanation:              aiVampireDrainExplanationHandler,
			PreheatPrecoolRecommender:            aiPreheatPrecoolRecommenderHandler,
			CabinTemperatureImpactNarrative:      aiCabinTemperatureImpactNarrativeHandler,
			TirePressureTrendReasoning:           aiTirePressureTrendReasoningHandler,
			AlertTuning:                          aiAlertTuningHandler,
			InboxCategorize:                      aiInboxCategorizationHandler,
			CrossRuleConflict:                    aiCrossRuleConflictHandler,
			AutoNameUnnamedLocations:             aiAutoNameUnnamedLocationsHandler,
			SuggestNewGeofences:                  aiSuggestNewGeofencesHandler,
			GeofenceAwareAutomation:              aiGeofenceAwareAutomationHandler,
			LearnedAnomalyBaselines:              aiLearnedAnomalyBaselinesHandler,
			RangePrediction:                      aiRangePredictionHandler,
			MLChargingCurveClustering:            aiMLChargingCurveClusteringHandler,
			PeriodCompareNarration:               aiPeriodCompareNarrationHandler,
			LifetimeStatsQA:                      aiLifetimeStatsQAHandler,
			IncidentTimelineSummarizer:           aiIncidentTimelineSummarizerHandler,
			DataRepairSuggestions:                aiDataRepairSuggestionsHandler,
			SignalExplorerNlFilter:               aiSignalExplorerNlFilterHandler,
			LogTraceSummarization:                aiLogTraceSummarizationHandler,
			FeedbackQueueTriage:                  aiFeedbackQueueTriageHandler,
			MqttSseInspectorExplanations:         aiMqttSseInspectorExplanationsHandler,
			StateMachineDebuggerNarrator:         aiStateMachineDebuggerNarratorHandler,
			PredictiveMaintenance:                aiPredictiveMaintenanceHandler,
			TCONarration:                         aiTCONarrationHandler,
			SoftwareUpdateChangelogSummarizer:    aiSoftwareUpdateChangelogSummarizerHandler,
			PiiRedactionSharedExports:            aiPiiRedactionSharedExportsHandler,
			QuietHoursSuggestion:                 aiQuietHoursSuggestionHandler,
			SafetySettingExplainer:               aiSafetySettingExplainerHandler,
			VoiceMode:                            aiVoiceModeHandler,
			WatchFaceNLResponse:                  aiWatchFaceNLResponseHandler,
			NLSqlPlayground:                      aiNLSqlPlaygroundHandler,
			NLGrafanaPanel:                       aiNLGrafanaPanelHandler,
			NLDashboardComposer:                  aiNLDashboardComposerHandler,
			TripPostcardShareCardImageGeneration: aiTripPostcardShareCardImageGenerationHandler,
			VehiclePaintPreview:                  aiVehiclePaintPreviewHandler,
		})

		// F3 AI Usage Card endpoints.
		//
		// /api/v1/ai/usage/{today,by-feature,recent} surface the
		// audit log written by the audit decorator above. The
		// usage routes special-case the per-feature toggle (the
		// __usage__ meta-feature has no toggle of its own) but
		// still 404 in off mode (ADR-015 §I6) — the wrapper inside
		// mountAIUsageRoutes carves out the exception precisely.
		aiusage.MountUsageRoutes(r, aiSettingsRepo, aiCallLogRepo, cfg.Auth.ForwardAuthHeader)

		// F8 AI Admin endpoints (redaction-bypass report).
		//
		// /api/v1/ai/admin/redaction-bypass surfaces the
		// per-(feature, provider) bypass summary written by the
		// redact decorator above. Like /ai/usage, the admin route
		// special-cases the per-feature toggle (the
		// __redaction_bypass__ meta-feature has no toggle of its
		// own) but still 404s in off mode (ADR-015 §I6) — the
		// wrapper inside mountAIAdminRoutes carves out the
		// exception precisely.
		aiusage.MountAdminRoutes(r, aiSettingsRepo, aiCallLogRepo)

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

	return apimw.WithMatchedRoute(r)
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
// the existing typed Get and pulling out the AIProviderConfig
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
