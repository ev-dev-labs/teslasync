package webvitals

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/rs/zerolog/log"
)

// Phase 45 / Prompt 12 — Web Vitals ingest records SPA Core Web Vitals as
// bounded Prometheus histograms, making the frontend performance budget
// measurable instead of aspirational.

const (
	// Hard cap on batch size to bound memory + label-cardinality blast
	// radius from a misbehaving or malicious client.
	maxWebVitalsBatchSize = 100
	// Hard cap on the route label length AFTER normalisation. Browsers can
	// produce arbitrarily deep paths via SPA history; we don't want a
	// pathological client blowing up our histogram label set.
	maxRouteLabelLength = 50
)

type webVitalsBatch struct {
	Metrics []webVitalsMetric `json:"metrics"`
}

type webVitalsMetric struct {
	Name           string  `json:"name"`
	Value          float64 `json:"value"`
	ID             string  `json:"id"`
	Rating         string  `json:"rating"`
	NavigationType string  `json:"navigationType,omitempty"`
	Route          string  `json:"route"`
	TsMs           float64 `json:"ts"`
}

// allowedVitalNames is the closed set of metric names we accept. Anything
// else is dropped to bound label cardinality.
var allowedVitalNames = map[string]struct{}{
	"LCP":  {},
	"INP":  {},
	"CLS":  {},
	"FCP":  {},
	"TTFB": {},
}

// allowedRatings mirrors the strings emitted by the web-vitals JS library.
// Unknown ratings are normalised to "unknown" so a client that ships a
// novel rating string can't spawn an unbounded label.
var allowedRatings = map[string]struct{}{
	"good":              {},
	"needs-improvement": {},
	"poor":              {},
}

// webVitalsHistogram uses one bucket set for time metrics and CLS because
// Prometheus quantiles are computed per metric-name label set.
var webVitalsHistogram = promauto.NewHistogramVec(
	prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "web_vitals_value",
		Help:      "Client-reported Web Vitals values (ms for time-based metrics, score for CLS).",
		Buckets:   []float64{0.05, 0.1, 0.25, 0.5, 1, 2.5, 10, 50, 100, 250, 500, 1000, 2500, 5000, 10000},
	},
	[]string{"name", "rating", "route"},
)

// webVitalsBatchesIngestedTotal lets us alert on traffic loss / spikes.
var webVitalsBatchesIngestedTotal = promauto.NewCounter(
	prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "web_vitals_batches_ingested_total",
		Help:      "Total Web Vitals batches successfully ingested from clients.",
	},
)

var webVitalsSamplesIngestedTotal = promauto.NewCounter(
	prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "web_vitals_samples_ingested_total",
		Help:      "Total Web Vitals individual samples observed.",
	},
)

var webVitalsSamplesRejectedTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "web_vitals_samples_rejected_total",
		Help:      "Web Vitals samples dropped before observation, labelled by reason.",
	},
	[]string{"reason"},
)

// Handler ingests browser-side Web Vitals samples.
type Handler struct{}

// NewHandler constructs a stateless ingest handler.
func NewHandler() *Handler { return &Handler{} }

// Ingest handles `POST /api/v1/web-vitals`. The endpoint is intentionally
// public (no auth) — the body carries no PII, requests come from anonymous
// browser sessions, and rate-limiting at the route layer is the only
// guard required.
func (h *Handler) Ingest(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	// Cap the read so a malicious client can't pin the process on JSON
	// decode of an unbounded body.
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)

	var batch webVitalsBatch
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&batch); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid payload")
		return
	}

	if len(batch.Metrics) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "empty batch")
		return
	}
	if len(batch.Metrics) > maxWebVitalsBatchSize {
		httpx.WriteError(w, http.StatusBadRequest, "batch too large")
		return
	}

	accepted := 0
	for _, m := range batch.Metrics {
		if _, ok := allowedVitalNames[m.Name]; !ok {
			webVitalsSamplesRejectedTotal.WithLabelValues("unknown_name").Inc()
			continue
		}
		rating := m.Rating
		if _, ok := allowedRatings[rating]; !ok {
			rating = "unknown"
		}
		webVitalsHistogram.
			WithLabelValues(m.Name, rating, NormalizeRoute(m.Route)).
			Observe(m.Value)
		accepted++
	}

	webVitalsSamplesIngestedTotal.Add(float64(accepted))
	webVitalsBatchesIngestedTotal.Inc()

	// Debug-only structured log so noisy histograms don't fill prod logs.
	log.Debug().
		Int("count", len(batch.Metrics)).
		Int("accepted", accepted).
		Msg("web-vitals batch ingested")

	w.WriteHeader(http.StatusNoContent)
}

// idLikeSegment replaces integer, UUID-like, and long opaque path segments to
// keep route label cardinality bounded.
var (
	intSegmentRE  = regexp.MustCompile(`^\d+$`)
	uuidSegmentRE = regexp.MustCompile(`^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$`)
	hexBlobRE     = regexp.MustCompile(`^[0-9a-fA-F]{20,}$`)
)

// NormalizeRoute bounds metric-cardinality by replacing ID-like path segments,
// lower-casing, trimming trailing slashes, and length-capping labels. It is more
// permissive than saved-view route validation because browsers report arbitrary
// SPA pathnames.
func NormalizeRoute(p string) string {
	if p == "" {
		return "/"
	}

	// Be defensive even though clients should send pathnames only.
	if i := strings.IndexAny(p, "?#"); i >= 0 {
		p = p[:i]
	}

	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}

	parts := strings.Split(p, "/")
	for i, part := range parts {
		switch {
		case part == "":
			// Preserve leading "" (from leading "/") and any internal empty
			// segments — they collapse harmlessly when we Join below.
		case intSegmentRE.MatchString(part):
			parts[i] = ":id"
		case uuidSegmentRE.MatchString(part):
			parts[i] = ":id"
		case hexBlobRE.MatchString(part):
			parts[i] = ":id"
		default:
			parts[i] = strings.ToLower(part)
		}
	}
	out := strings.Join(parts, "/")

	// Collapse any double slashes and strip a trailing slash (except root).
	for strings.Contains(out, "//") {
		out = strings.ReplaceAll(out, "//", "/")
	}
	if len(out) > 1 && strings.HasSuffix(out, "/") {
		out = strings.TrimRight(out, "/")
	}
	if out == "" {
		out = "/"
	}

	if len(out) > maxRouteLabelLength {
		out = out[:maxRouteLabelLength]
	}
	return out
}
