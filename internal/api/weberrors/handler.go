package weberrors

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	apivitals "github.com/ev-dev-labs/teslasync/internal/api/webvitals"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/rs/zerolog/log"
)

// Web Errors ingest handler (Phase 46 / Prompt 01).
//
// Accepts SPA error reports, observes bounded Prometheus labels, and keeps a
// best-effort last-hour summary for the admin UI. The ingest route intentionally
// sits outside ForwardAuth so expired-token and login-loop failures can report;
// route-level rate limiting bounds abuse.

const (
	maxWebErrorMessageLen     = 500
	maxWebErrorStackLen       = 8 * 1024 // 8 KB of stack is plenty
	maxWebErrorNameLen        = 64
	maxWebErrorUserAgentLen   = 200
	webErrorsRequestBodyLimit = 32 * 1024 // hard cap on the POST body
	webErrorSummaryWindow     = time.Hour
	webErrorSummaryTopN       = 3

	// maxTrackedErrorRoutes caps distinct route templates on THIS surface.
	// Sized like the web-vitals cap: the SPA has well under this many real
	// routes, and the cap exists so a client POSTing synthetic paths cannot
	// grow the series count without bound.
	maxTrackedErrorRoutes = 80
	// maxNewErrorRoutesPerRequest caps how many previously-unseen templates a
	// single POST may introduce. A web-error report carries exactly one route,
	// so 1 is the honest budget; anything above it is a scraper.
	maxNewErrorRoutesPerRequest = 1
)

// routeAdmitter bounds the `{route}` label on this surface.
//
// Deliberately its OWN registry, not the web-vitals one: sharing would let a
// burst of junk on `/api/v1/web-errors` consume the cardinality budget that
// `/api/v1/web-vitals` needs for its real routes. The normalisation rules and
// caps are identical (both go through `apivitals.NormalizeRoute`), so the two
// surfaces always produce the SAME template for the same input — only the
// accounting is separate. Overflow is counted under
// `teslasync_frontend_label_overflow_total{label="weberrors_route*"}` so the
// split is observable.
//
// Per-IP abuse is bounded independently by the route-level `httprate` limiter
// in internal/api/router.go (50 reports/minute).
var routeAdmitter = apivitals.NewRouteAdmitter("weberrors", maxTrackedErrorRoutes, maxNewErrorRoutesPerRequest)

// allowedWebErrorNames keeps the {name} label cardinality bounded.
// Anything outside this set is bucketed as "Other" so a malicious or
// buggy client cannot spawn unbounded label sets.
var allowedWebErrorNames = map[string]struct{}{
	"Error":                    {},
	"TypeError":                {},
	"ReferenceError":           {},
	"SyntaxError":              {},
	"RangeError":               {},
	"URIError":                 {},
	"EvalError":                {},
	"AbortError":               {},
	"ChunkLoadError":           {},
	"ApiError":                 {},
	"RateLimitError":           {},
	"UpstreamUnavailableError": {},
	"NotFoundError":            {},
}

type webErrorReport struct {
	Name       string `json:"name"`
	Message    string `json:"message"`
	Stack      string `json:"stack,omitempty"`
	Route      string `json:"route"`
	UserAgent  string `json:"userAgent,omitempty"`
	OccurredAt string `json:"occurredAt,omitempty"`
}

var webErrorsTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "web_errors_total",
		Help:      "Browser-side errors reported by the SPA via /api/v1/web-errors, labelled by error name and normalised route.",
	},
	[]string{"name", "route"},
)

var webErrorsRejectedTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "web_errors_rejected_total",
		Help:      "Frontend error reports dropped before observation, labelled by reason.",
	},
	[]string{"reason"},
)

// rollingErrorEntry is one observation kept in the last-hour window.
type rollingErrorEntry struct {
	at    time.Time
	name  string
	route string
}

// Handler accepts browser-side error reports and exposes a
// last-hour rolling summary for the admin panel. Both endpoints share a
// single instance so the summary reflects ingested reports without
// reaching back into Prometheus.
type Handler struct {
	mu      sync.Mutex
	rolling []rollingErrorEntry
	now     func() time.Time
}

// NewHandler constructs an ingest + summary handler.
func NewHandler() *Handler {
	return &Handler{now: time.Now}
}

// Ingest handles `POST /api/v1/web-errors`. Validates and bounds the
// payload, increments `teslasync_web_errors_total`, records into the
// rolling window, and emits an INFO-level structured log so operators
// can grep for client errors without a Prometheus query.
func (h *Handler) Ingest(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, webErrorsRequestBodyLimit)

	var rep webErrorReport
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&rep); err != nil {
		webErrorsRejectedTotal.WithLabelValues("invalid_payload").Inc()
		httpx.WriteError(w, http.StatusBadRequest, "invalid payload")
		return
	}

	if strings.TrimSpace(rep.Message) == "" && strings.TrimSpace(rep.Name) == "" {
		webErrorsRejectedTotal.WithLabelValues("empty").Inc()
		httpx.WriteError(w, http.StatusBadRequest, "empty error report")
		return
	}

	name := normalizeWebErrorName(rep.Name)
	// One admission batch per request: the route is normalised by the SHARED
	// normaliser (identical template to web-vitals) and then folded onto this
	// surface's own bounded label set.
	route := routeAdmitter.NewBatch().Admit(rep.Route)
	message := truncateWebErrorString(rep.Message, maxWebErrorMessageLen)
	stack := truncateWebErrorString(rep.Stack, maxWebErrorStackLen)
	ua := truncateWebErrorString(rep.UserAgent, maxWebErrorUserAgentLen)

	webErrorsTotal.WithLabelValues(name, route).Inc()
	h.recordRolling(name, route)

	log.Info().
		Str("name", name).
		Str("route", route).
		Str("message", message).
		Str("user_agent", ua).
		Bool("has_stack", stack != "").
		Str("occurred_at", rep.OccurredAt).
		Msg("frontend error reported")

	w.WriteHeader(http.StatusNoContent)
}

// Summary handles `GET /api/v1/admin/web-errors/summary` and returns
// {window_seconds, total, top:[{name, route, count}], as_of}. The body
// is small (top N capped) and safe to poll on the admin page.
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	now := h.callNow()
	cutoff := now.Add(-webErrorSummaryWindow)

	h.mu.Lock()
	kept := h.rolling[:0]
	for _, e := range h.rolling {
		if !e.at.Before(cutoff) {
			kept = append(kept, e)
		}
	}
	h.rolling = kept
	snapshot := append([]rollingErrorEntry(nil), h.rolling...)
	h.mu.Unlock()

	type bucket struct {
		key   string
		Name  string `json:"name"`
		Route string `json:"route"`
		Count int    `json:"count"`
	}
	groups := make(map[string]*bucket, len(snapshot))
	for _, e := range snapshot {
		key := e.name + "|" + e.route
		b, ok := groups[key]
		if !ok {
			b = &bucket{key: key, Name: e.name, Route: e.route}
			groups[key] = b
		}
		b.Count++
	}
	buckets := make([]*bucket, 0, len(groups))
	for _, b := range groups {
		buckets = append(buckets, b)
	}
	sort.Slice(buckets, func(i, j int) bool {
		if buckets[i].Count != buckets[j].Count {
			return buckets[i].Count > buckets[j].Count
		}
		return buckets[i].key < buckets[j].key
	})
	if len(buckets) > webErrorSummaryTopN {
		buckets = buckets[:webErrorSummaryTopN]
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"window_seconds": int(webErrorSummaryWindow.Seconds()),
		"total":          len(snapshot),
		"top":            buckets,
		"as_of":          now.UTC().Format(time.RFC3339),
	})
}

func (h *Handler) recordRolling(name, route string) {
	now := h.callNow()
	cutoff := now.Add(-webErrorSummaryWindow)

	h.mu.Lock()
	defer h.mu.Unlock()

	kept := h.rolling[:0]
	for _, e := range h.rolling {
		if !e.at.Before(cutoff) {
			kept = append(kept, e)
		}
	}
	h.rolling = append(kept, rollingErrorEntry{at: now, name: name, route: route})
}

func (h *Handler) callNow() time.Time {
	if h.now != nil {
		return h.now()
	}
	return time.Now()
}

// normalizeWebErrorName clamps {name} label cardinality; unknown or empty names bucket to "Other".
func normalizeWebErrorName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "Other"
	}
	if len(name) > maxWebErrorNameLen {
		name = name[:maxWebErrorNameLen]
	}
	if _, ok := allowedWebErrorNames[name]; ok {
		return name
	}
	return "Other"
}

func truncateWebErrorString(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
