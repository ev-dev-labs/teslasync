package webvitals

import (
	"math"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Real-User-Monitoring metric contracts.
//
// Every series exported from this package obeys three hard rules:
//
//  1. SI units on the wire. Browsers report Web Vitals in milliseconds; we
//     divide by 1000 and export `_seconds` so PromQL thresholds match the
//     `slo/catalog.yaml` objectives byte-for-byte. CLS is a unitless layout
//     score and is exported as `_ratio`.
//  2. Bounded cardinality. Every label value comes from a closed set or from
//     a capped registry (see routeRegistry / releaseRegistry). A hostile or
//     buggy client can never mint a new series beyond the cap.
//  3. No PII. Route templates are ID-, VIN- and coordinate-redacted before
//     they ever reach a label (see normalize.go). Raw URLs, query strings,
//     fragments, user agents and geographic coordinates are never labels.
//
// Dimension slicing (device / connection / theme) deliberately lives on a
// separate counter WITHOUT the route label. Cross-producting route with four
// more dimensions on the latency histograms would multiply the series count by
// ~240x for no analytical gain — SLOs need per-route latency, product
// analytics needs per-device rates, and neither needs both at once.

const (
	// maxTrackedRoutes caps the number of distinct normalised route templates
	// that may appear as a Prometheus label. The SPA has well under this many
	// real routes; the cap exists so a client POSTing synthetic paths cannot
	// grow the series count without bound.
	maxTrackedRoutes = 80

	// overflowRoute is the sink label for routes beyond maxTrackedRoutes. The
	// double-underscore form cannot collide with a real SPA pathname because
	// NormalizeRoute lower-cases and would keep a literal "/__other__" route
	// distinct only if the app actually shipped one.
	overflowRoute = "/__other__"

	// maxTrackedReleases caps distinct release labels. Deployments roll
	// forward; a handful of versions are in flight at once (old tabs still
	// open, staged rollout). Anything past the cap buckets to overflowRelease.
	maxTrackedReleases = 12
	overflowRelease    = "other"

	// maxNewRoutesPerBatch caps how many previously-unseen route templates a
	// single request may admit. A real client reports one or two routes per
	// 2-second flush window; anything more is a scraper walking synthetic
	// paths. Combined with the "only after accepted content" gate in the
	// handler, this bounds how fast an anonymous caller can consume the
	// global route cap.
	maxNewRoutesPerBatch = 4

	// unknownLabel is the shared sink for absent or unrecognised dimensions.
	unknownLabel = "unknown"

	// Sanity ceilings. A sample above these is a broken client clock or a
	// deliberate poison value, never a real user experience.
	maxTimeSampleMillis = 600_000 // 10 minutes
	maxScoreSample      = 100     // CLS above 100 is nonsense
)

// Metric names accepted on the ingest endpoint. The first five are the
// standard web-vitals library metrics; the last two are TeslaSync-specific
// navigation metrics emitted by web/src/lib/webVitalsReporter.ts.
const (
	MetricLCP         = "LCP"
	MetricINP         = "INP"
	MetricCLS         = "CLS"
	MetricFCP         = "FCP"
	MetricTTFB        = "TTFB"
	MetricRouteChange = "RouteChange"
	MetricTTUC        = "TTUC"
)

// vitalSpec describes how one accepted metric name maps onto a histogram.
type vitalSpec struct {
	histogram *prometheus.HistogramVec
	// divisor converts the client-reported value into the histogram's unit.
	// 1000 for millisecond→second metrics, 1 for unitless scores.
	divisor float64
	// maxValue is the pre-divisor sanity ceiling.
	maxValue float64
}

func newVitalHistogram(name, help string, buckets []float64) *prometheus.HistogramVec {
	return promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Subsystem: "frontend",
		Name:      name,
		Help:      help,
		Buckets:   buckets,
	}, []string{"route"})
}

// vitalsSpecs is the closed registry of accepted metric names. Lookup failure
// is the ONLY way a sample is rejected for its name, which keeps the allowed
// set and the histogram set impossible to drift apart.
var vitalsSpecs = map[string]vitalSpec{
	MetricLCP: {
		histogram: newVitalHistogram(
			"web_vitals_lcp_seconds",
			"Largest Contentful Paint reported by real browser sessions, in seconds.",
			[]float64{0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10},
		),
		divisor:  1000,
		maxValue: maxTimeSampleMillis,
	},
	MetricINP: {
		histogram: newVitalHistogram(
			"web_vitals_inp_seconds",
			"Interaction to Next Paint reported by real browser sessions, in seconds.",
			[]float64{0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 2, 5},
		),
		divisor:  1000,
		maxValue: maxTimeSampleMillis,
	},
	MetricFCP: {
		histogram: newVitalHistogram(
			"web_vitals_fcp_seconds",
			"First Contentful Paint reported by real browser sessions, in seconds.",
			[]float64{0.3, 0.6, 1, 1.5, 1.8, 2.5, 4, 6},
		),
		divisor:  1000,
		maxValue: maxTimeSampleMillis,
	},
	MetricTTFB: {
		histogram: newVitalHistogram(
			"web_vitals_ttfb_seconds",
			"Time To First Byte reported by real browser sessions, in seconds.",
			[]float64{0.05, 0.1, 0.2, 0.4, 0.8, 1.2, 1.8, 3},
		),
		divisor:  1000,
		maxValue: maxTimeSampleMillis,
	},
	MetricCLS: {
		histogram: newVitalHistogram(
			"web_vitals_cls_ratio",
			"Cumulative Layout Shift score reported by real browser sessions (unitless).",
			[]float64{0.01, 0.05, 0.1, 0.15, 0.25, 0.5, 1},
		),
		divisor:  1,
		maxValue: maxScoreSample,
	},
	MetricRouteChange: {
		histogram: newVitalHistogram(
			"route_transition_seconds",
			"SPA route paint: navigation start to the first paint after the new route committed, in seconds. Responsiveness signal only — the route may have painted skeletons. Usability is teslasync_frontend_time_to_usable_content_seconds.",
			[]float64{0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1.2, 2, 5},
		),
		divisor:  1000,
		maxValue: maxTimeSampleMillis,
	},
	MetricTTUC: {
		histogram: newVitalHistogram(
			"time_to_usable_content_seconds",
			"Time from navigation start until the route's primary data finished rendering, in seconds. Populated ONLY by pages that explicitly call markContentReady(token); there is no automatic completion, so an empty histogram means no page has been wired yet.",
			[]float64{0.1, 0.25, 0.5, 1, 1.5, 2.5, 4, 6, 10},
		),
		divisor:  1000,
		maxValue: maxTimeSampleMillis,
	},
}

// legacyVitalsHistogram preserves the pre-existing
// `teslasync_web_vitals_value` series (milliseconds for time metrics, raw
// score for CLS). It is referenced by the admin observability copy in
// web/src/i18n and by any dashboards built before the SI split, so it stays
// until those callers are migrated. New SLOs MUST use the `_seconds` families
// above.
var legacyVitalsHistogram = promauto.NewHistogramVec(
	prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "web_vitals_value",
		Help:      "Deprecated: client-reported Web Vitals values (ms for time-based metrics, score for CLS). Use teslasync_frontend_web_vitals_*_seconds instead.",
		Buckets:   []float64{0.05, 0.1, 0.25, 0.5, 1, 2.5, 10, 50, 100, 250, 500, 1000, 2500, 5000, 10000},
	},
	[]string{"name", "rating", "route"},
)

// vitalsDimensionsTotal carries the bounded product dimensions. Route is
// deliberately absent — see the cardinality note at the top of this file.
// Series ceiling: 7 names x 4 ratings x 4 device classes x 6 connection
// classes x 3 themes = 2016.
var vitalsDimensionsTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Namespace: "teslasync",
		Subsystem: "frontend",
		Name:      "web_vitals_samples_total",
		Help:      "Web Vitals samples by metric name, rating and bounded client dimensions (device class, effective connection class, theme).",
	},
	[]string{"name", "rating", "device", "connection", "theme"},
)

// releaseInfo is the release/deployment metadata gauge. Grafana dashboards
// annotate deploys from releaseFirstSeen; releaseInfo supports joins so a
// panel can label a series with the release that produced it.
var releaseInfo = promauto.NewGaugeVec(
	prometheus.GaugeOpts{
		Namespace: "teslasync",
		Subsystem: "frontend",
		Name:      "release_info",
		Help:      "Always 1. One series per frontend release observed reporting RUM samples.",
	},
	[]string{"release"},
)

var releaseFirstSeen = promauto.NewGaugeVec(
	prometheus.GaugeOpts{
		Namespace: "teslasync",
		Subsystem: "frontend",
		Name:      "release_first_seen_timestamp_seconds",
		Help:      "Unix timestamp when a frontend release was first observed reporting RUM samples. Grafana uses this for deployment annotations.",
	},
	[]string{"release"},
)

// uxEventsTotal is the bounded contract for non-timing frontend signals:
// resource load failures, query lifecycle, retries, cache hits/misses,
// request cancellations and explicit user actions. Both `kind` and `outcome`
// come from closed sets; `route` uses the capped route registry.
var uxEventsTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Namespace: "teslasync",
		Subsystem: "frontend",
		Name:      "ux_events_total",
		Help:      "Bounded frontend UX events by kind (error/resource/query/retry/cache/cancellation/user_action), outcome and normalised route template.",
	},
	[]string{"kind", "outcome", "route"},
)

// Ingest health counters.
var (
	batchesIngestedTotal = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "web_vitals_batches_ingested_total",
		Help:      "Total Web Vitals batches successfully ingested from clients.",
	})

	samplesIngestedTotal = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "web_vitals_samples_ingested_total",
		Help:      "Total Web Vitals individual samples observed.",
	})

	samplesRejectedTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "web_vitals_samples_rejected_total",
		Help:      "Web Vitals samples dropped before observation, labelled by reason.",
	}, []string{"reason"})

	batchesRejectedTotal = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "web_vitals_batches_rejected_total",
		Help:      "Batches rejected because nothing in them passed validation. These consume no route or release cardinality.",
	})

	cardinalityOverflowTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Subsystem: "frontend",
		Name:      "label_overflow_total",
		Help:      "Times a RUM label value was folded into an overflow bucket because the per-label cardinality cap was reached.",
	}, []string{"label"})
)

// boundedRegistry folds an unbounded input domain onto a capped label set.
// The first `limit` distinct values keep their identity; everything after is
// reported as `overflow`. Admission is sticky: once a value is admitted it
// stays admitted for the process lifetime, so a route does not flap between
// its own series and the overflow bucket.
//
// Admission is ALSO budgeted per request (see admissionBudget). A single
// anonymous POST must not be able to consume a meaningful share of the global
// cap, and — enforced by the caller — must not be able to consume any of it
// at all unless the request contained at least one valid sample.
type boundedRegistry struct {
	mu       sync.Mutex
	seen     map[string]struct{}
	limit    int
	overflow string
	label    string
	onAdmit  func(value string)
}

func newBoundedRegistry(label string, limit int, overflow string) *boundedRegistry {
	return &boundedRegistry{
		seen:     make(map[string]struct{}, limit),
		limit:    limit,
		overflow: overflow,
		label:    label,
	}
}

// admissionBudget caps how many NEW label values one request may introduce.
// A nil budget means "unbudgeted" and is only used by tests exercising the
// global cap in isolation.
type admissionBudget struct {
	remaining int
}

func newAdmissionBudget(n int) *admissionBudget { return &admissionBudget{remaining: n} }

func (b *admissionBudget) take() bool {
	if b == nil {
		return true
	}
	if b.remaining <= 0 {
		return false
	}
	b.remaining--
	return true
}

// Admit returns the label value to use for `value`, consuming one unit of the
// per-request budget when the value is new.
func (r *boundedRegistry) Admit(value string, budget *admissionBudget) string {
	r.mu.Lock()
	if _, ok := r.seen[value]; ok {
		r.mu.Unlock()
		return value
	}
	if len(r.seen) >= r.limit {
		r.mu.Unlock()
		cardinalityOverflowTotal.WithLabelValues(r.label).Inc()
		return r.overflow
	}
	r.mu.Unlock()

	// Budget is checked outside the registry lock and before insertion so a
	// budget-exhausted request leaves the registry completely untouched.
	if !budget.take() {
		cardinalityOverflowTotal.WithLabelValues(r.label + "_batch_budget").Inc()
		return r.overflow
	}

	r.mu.Lock()
	if _, ok := r.seen[value]; ok {
		r.mu.Unlock()
		return value
	}
	if len(r.seen) >= r.limit {
		r.mu.Unlock()
		cardinalityOverflowTotal.WithLabelValues(r.label).Inc()
		return r.overflow
	}
	r.seen[value] = struct{}{}
	onAdmit := r.onAdmit
	r.mu.Unlock()

	if onAdmit != nil {
		onAdmit(value)
	}
	return value
}

// Size reports how many distinct values are currently admitted.
func (r *boundedRegistry) Size() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.seen)
}

var (
	releaseRegistry = newReleaseRegistry()
)

func newReleaseRegistry() *boundedRegistry {
	r := newBoundedRegistry("release", maxTrackedReleases, overflowRelease)
	// Publishing the deployment gauges on first admission keeps the
	// "when did this release start serving traffic" annotation accurate
	// without a per-request write.
	r.onAdmit = func(value string) {
		releaseInfo.WithLabelValues(value).Set(1)
		releaseFirstSeen.WithLabelValues(value).Set(float64(nowFunc().Unix()))
	}
	return r
}

// nowFunc is swappable so release-annotation tests are deterministic.
var nowFunc = time.Now

// validateVital checks a client-reported sample WITHOUT touching any metric or
// registry. Returning (false, reason) means the sample must be discarded and
// must not be allowed to spend cardinality budget.
func validateVital(name string, rawValue float64) (bool, string) {
	spec, ok := vitalsSpecs[name]
	if !ok {
		return false, "unknown_name"
	}
	if math.IsNaN(rawValue) || math.IsInf(rawValue, 0) {
		return false, "non_finite_value"
	}
	if rawValue < 0 {
		return false, "negative_value"
	}
	if rawValue > spec.maxValue {
		return false, "value_out_of_range"
	}
	return true, ""
}

// observeVital records one sample. It returns false when the sample was
// rejected, along with the rejection reason for the counter. Validation is
// re-run so the function is safe to call directly (tests, future callers)
// without relying on the handler having validated first.
func observeVital(name string, rawValue float64, rating, route string, dims dimensions) (bool, string) {
	if ok, reason := validateVital(name, rawValue); !ok {
		return false, reason
	}
	spec := vitalsSpecs[name]

	spec.histogram.WithLabelValues(route).Observe(rawValue / spec.divisor)
	legacyVitalsHistogram.WithLabelValues(name, rating, route).Observe(rawValue)
	vitalsDimensionsTotal.
		WithLabelValues(name, rating, dims.Device, dims.Connection, dims.Theme).
		Inc()
	return true, ""
}
