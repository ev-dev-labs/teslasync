package webvitals

import (
	"encoding/json"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/rs/zerolog/log"
)

// Web Vitals / RUM ingest.
//
// Records SPA Real-User-Monitoring samples as bounded Prometheus series,
// making the frontend performance budget measurable instead of aspirational.
//
// Wire contract (v2, backwards compatible with v1 which sent only `metrics`):
//
//	{
//	  "context": {"device":"desktop","connection":"4g","release":"1.4.2","theme":"dark"},
//	  "metrics": [{"name":"LCP","value":1234,"id":"v3-1","rating":"good","route":"/drives/42","ts":1.5}],
//	  "events":  [{"kind":"query","outcome":"failure","route":"/drives/42"}]
//	}
//
// `context` and `events` are optional. Every field is normalised onto a closed
// or capped label set before it reaches Prometheus (see normalize.go).

const (
	// maxBatchSize bounds memory + label blast radius from a misbehaving or
	// malicious client.
	maxBatchSize = 100
	// maxEventsPerBatch bounds the UX-event side channel independently.
	maxEventsPerBatch = 100
	// requestBodyLimit hard-caps the POST body.
	requestBodyLimit = 64 * 1024
	// maxEventCount bounds a single event's aggregated count so one report
	// cannot arbitrarily inflate a counter.
	maxEventCount = 1000
)

// maxWebVitalsBatchSize is the ingest contract's batch ceiling.
const maxWebVitalsBatchSize = maxBatchSize

type webVitalsBatch struct {
	Context *clientContext    `json:"context,omitempty"`
	Metrics []webVitalsMetric `json:"metrics"`
	Events  []uxEvent         `json:"events,omitempty"`
}

// clientContext carries the batch-level bounded dimensions. These are stable
// for the lifetime of a flush window, so shipping them once per batch keeps
// the payload small without losing fidelity.
type clientContext struct {
	Device     string `json:"device,omitempty"`
	Connection string `json:"connection,omitempty"`
	Release    string `json:"release,omitempty"`
	Theme      string `json:"theme,omitempty"`
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

// uxEvent is the non-timing frontend signal contract: resource load failures,
// query lifecycle, retries, cache hits/misses, cancellations, user actions.
type uxEvent struct {
	Kind    string `json:"kind"`
	Outcome string `json:"outcome"`
	Route   string `json:"route,omitempty"`
	Count   int    `json:"count,omitempty"`
}

// Handler ingests browser-side RUM samples.
type Handler struct{}

// NewHandler constructs a stateless ingest handler.
func NewHandler() *Handler { return &Handler{} }

// pendingSample is a metric that passed validation but has not yet consumed
// any cardinality budget. Routes are still RAW at this point.
type pendingSample struct {
	name     string
	value    float64
	rating   string
	rawRoute string
}

// pendingEvent is the UX-event analogue of pendingSample.
type pendingEvent struct {
	kind     string
	outcome  string
	rawRoute string
	count    int
}

// Ingest handles `POST /api/v1/web-vitals`. The endpoint is intentionally
// public (no auth) — the body carries no PII, requests come from anonymous
// browser sessions, and rate-limiting at the route layer is the only guard
// required.
//
// Because it is anonymous, admission to the capped route/release registries is
// strictly two-phase:
//
//	pass 1  validate every metric and event. Nothing is admitted, no gauge is
//	        published, no counter labelled with client-controlled data moves.
//	pass 2  ONLY if pass 1 accepted something, spend a bounded per-request
//	        admission budget on the routes and the release.
//
// A batch that validates to nothing is a 400 and leaves the registries — and
// the release/deployment annotations — completely untouched.
func (h *Handler) Ingest(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	// Cap the read so a malicious client can't pin the process on JSON
	// decode of an unbounded body.
	r.Body = http.MaxBytesReader(w, r.Body, requestBodyLimit)

	var batch webVitalsBatch
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&batch); err != nil {
		samplesRejectedTotal.WithLabelValues("invalid_payload").Inc()
		httpx.WriteError(w, http.StatusBadRequest, "invalid payload")
		return
	}

	if len(batch.Metrics) == 0 && len(batch.Events) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "empty batch")
		return
	}
	if len(batch.Metrics) > maxBatchSize || len(batch.Events) > maxEventsPerBatch {
		httpx.WriteError(w, http.StatusBadRequest, "batch too large")
		return
	}

	// ── Pass 1: validate only. No registry writes, no gauges. ───────────────
	pendingSamples := make([]pendingSample, 0, len(batch.Metrics))
	for _, m := range batch.Metrics {
		rating := normalizeRating(m.Rating)
		if ok, reason := validateVital(m.Name, m.Value); !ok {
			samplesRejectedTotal.WithLabelValues(reason).Inc()
			continue
		}
		pendingSamples = append(pendingSamples, pendingSample{
			name: m.Name, value: m.Value, rating: rating, rawRoute: m.Route,
		})
	}

	pendingEvents := make([]pendingEvent, 0, len(batch.Events))
	for _, e := range batch.Events {
		kind, kindOK := normalizeUXKind(e.Kind)
		if !kindOK {
			samplesRejectedTotal.WithLabelValues("unknown_ux_kind").Inc()
			continue
		}
		outcome, outcomeOK := normalizeUXOutcome(e.Outcome)
		if !outcomeOK {
			samplesRejectedTotal.WithLabelValues("unknown_ux_outcome").Inc()
			continue
		}
		count := e.Count
		if count <= 0 {
			count = 1
		}
		if count > maxEventCount {
			samplesRejectedTotal.WithLabelValues("ux_count_out_of_range").Inc()
			continue
		}
		pendingEvents = append(pendingEvents, pendingEvent{
			kind: kind, outcome: outcome, rawRoute: e.Route, count: count,
		})
	}

	if len(pendingSamples) == 0 && len(pendingEvents) == 0 {
		// Nothing survived validation. Reject WITHOUT admitting a route or a
		// release: an anonymous caller must not be able to consume cardinality
		// capacity, or mint a deployment annotation, with a junk payload.
		batchesRejectedTotal.Inc()
		httpx.WriteError(w, http.StatusBadRequest, "no valid samples")
		return
	}

	// ── Pass 2: the batch carried real content; spend bounded budget. ───────
	routeBatch := defaultRouteAdmitter.NewBatch()
	releaseBudget := newAdmissionBudget(1)
	dims := resolveContext(batch.Context, releaseBudget)

	accepted := 0
	for _, p := range pendingSamples {
		route := routeBatch.Admit(p.rawRoute)
		if ok, reason := observeVital(p.name, p.value, p.rating, route, dims); !ok {
			samplesRejectedTotal.WithLabelValues(reason).Inc()
			continue
		}
		accepted++
	}

	acceptedEvents := 0
	for _, p := range pendingEvents {
		uxEventsTotal.
			WithLabelValues(p.kind, p.outcome, routeBatch.Admit(p.rawRoute)).
			Add(float64(p.count))
		acceptedEvents++
	}

	samplesIngestedTotal.Add(float64(accepted))
	batchesIngestedTotal.Inc()

	// Debug-only structured log so noisy histograms don't fill prod logs.
	// Deliberately logs counts and bounded dimensions only — never a raw
	// route, VIN, user agent or metric ID.
	log.Debug().
		Int("count", len(batch.Metrics)).
		Int("accepted", accepted).
		Int("events", len(batch.Events)).
		Int("accepted_events", acceptedEvents).
		Str("device", dims.Device).
		Str("connection", dims.Connection).
		Str("theme", dims.Theme).
		Str("release", dims.Release).
		Msg("web-vitals batch ingested")

	w.WriteHeader(http.StatusNoContent)
}

// resolveContext folds the optional client context onto the bounded label
// sets, defaulting every dimension to "unknown" when absent. The release is
// admitted here — and only here — which is why the caller must already have
// established that the batch carried acceptable content.
func resolveContext(c *clientContext, releaseBudget *admissionBudget) dimensions {
	if c == nil {
		return dimensions{
			Device:     unknownLabel,
			Connection: unknownLabel,
			Theme:      unknownLabel,
			Release:    unknownLabel,
		}
	}
	return dimensions{
		Device:     normalizeDevice(c.Device),
		Connection: normalizeConnection(c.Connection),
		Theme:      normalizeTheme(c.Theme),
		Release:    admitRelease(validateRelease(c.Release), releaseBudget),
	}
}
