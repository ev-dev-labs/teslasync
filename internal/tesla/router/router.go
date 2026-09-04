package router

import (
	"context"
	"errors"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// routerTracerName is the OpenTelemetry tracer name for spans emitted
// by Router.Route. The trace-coverage audit greps for this exact constant
// so the router stays accounted for in the
// tesla_signal_ingest_to_db flow.
const routerTracerName = "tesla.router"

// ErrNoRoute is returned by Router.Route when the inbound atomic's
// Field is not declared in routing.yaml. Per ADR-004 #8 the router
// is field-static, so an unknown Field is either a producer firmware
// change shipping a new signal before routing.yaml caught up, or a
// regression that deleted an entry. Either way the caller observes
// a typed error and increments tesla_router_no_route_total{field=...}
// for an alert; values are NOT silently swallowed.
var ErrNoRoute = errors.New("router: no routing entry for field")

// writerFailuresTotal is the LOCKED public metric name from ADR-004
// #8: tesla_router_writer_failures_total{dest, reason}. Its
// cardinality is bounded by the size of the closed Destination set
// times the small classifyError tag set, so the Prometheus index can
// never blow up no matter how many distinct errors a backend emits.
//
// The label order (dest, reason) matches the ADR exactly so dashboards
// and alert rules built against the design doc work without rewrites.
var writerFailuresTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "tesla",
	Subsystem: "router",
	Name:      "writer_failures_total",
	Help: "Number of router writer.Write calls that returned an error, " +
		"labelled by destination (closed set from routing.Destination) and " +
		"a coarse reason tag (timeout, canceled, other). Per ADR-004 #8 " +
		"these failures are observable here only and do NOT trigger MQTT " +
		"redelivery — only codec failures cause payload retries.",
}, []string{"dest", "reason"})

// noRouteTotal counts atomics dropped because their Field has no
// routing entry. A non-zero rate here always indicates a deployment
// drift between the vendored proto + protomodel codegen and
// routing.yaml. The label is the offending Field name so the alert
// pinpoints which entry needs to be added.
var noRouteTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "tesla",
	Subsystem: "router",
	Name:      "no_route_total",
	Help: "Atomic values dropped because their Field has no entry in " +
		"routing.yaml. A non-zero rate indicates protomodel/routing drift " +
		"and the labelled Field needs to be added to routing.yaml.",
}, []string{"field"})

// Writer is the per-destination write contract LOCKED by ADR-004 #8.
//
// Implementations MUST be:
//
//   - Best-effort. Internal retries are NOT permitted; transient
//     backend failures must be returned to the caller so the router
//     records them in tesla_router_writer_failures_total. The router
//     in turn surfaces the error to its own caller without retrying;
//     payload-level redelivery is only triggered by codec failures
//     upstream of the router.
//
//   - Idempotent on (vehicle_id, ts, field). The same atomic delivered
//     twice MUST NOT produce two divergent rows. Most implementations
//     achieve this via ON CONFLICT DO UPDATE on the natural key.
//
// dst carries the routing.yaml entry that pointed at this writer, so
// implementations can read e.g. dst.Column to know which hot-table
// column to write into. The router validates dst.Destination is the
// destination this writer is registered for, so writers do not need
// to re-check that themselves.
type Writer interface {
	Write(ctx context.Context, atomic codec.Atomic, dst Entry) error
}

// RoutedAtomic couples an atomic with the field-static routing entry that
// selected its destination. BatchWriter implementations receive this shape so
// they can coalesce rows without re-reading routing.yaml.
type RoutedAtomic struct {
	Atomic codec.Atomic
	Entry  Entry
}

// BatchWriter is an optional extension implemented by writers that can reduce
// database round-trips by persisting multiple atomics together. The returned
// error slice must align one-for-one with items. A nil entry means that item
// was accepted.
//
// Writer remains the mandatory contract so bespoke and low-volume
// destinations can keep their simpler single-item implementation.
type BatchWriter interface {
	WriteBatch(ctx context.Context, items []RoutedAtomic) []error
}

type indexedRoutedAtomic struct {
	index int
	item  RoutedAtomic
}

// Router dispatches each codec.Atomic to the writer registered for
// the destination declared in routing.yaml. Lookup is purely keyed by
// atomic.Field — per ADR-004 #8 routing is field-static and
// vehicle-agnostic, and per-vehicle filtering belongs in the writer.
//
// A *Router is safe for concurrent use. The entries map is built
// once at New time and never mutated; the writers map is also
// snapshotted at New time. There are no per-call allocations on the
// hot path other than what the underlying Writer requires.
type Router struct {
	entries map[string]Entry
	writers map[Destination]Writer
}

// New loads the embedded routing.yaml, validates it, and returns a
// Router that dispatches to the supplied writers map.
//
// New errors if:
//
//   - routing.yaml is malformed or contains a duplicate Field /
//     unknown Destination (delegated to LoadMap);
//   - the writers map contains a key that is NOT in the closed
//     Destination set (typo guard — a writer registered under
//     "positons" would silently never be called);
//   - routing.yaml uses a Destination for which no writer is
//     supplied (DestDrop is exempted because it is the explicit
//     no-op destination).
//
// Passing a nil writers map is legal for tests and for prompts (like
// this one) where routing.yaml is empty: with no entries there are
// no destinations to satisfy and the validation pass is a no-op.
func New(writers map[Destination]Writer) (*Router, error) {
	entries, err := LoadMap()
	if err != nil {
		return nil, err
	}
	if writers == nil {
		writers = map[Destination]Writer{}
	}
	for dest := range writers {
		if _, ok := validDestinations[dest]; !ok {
			return nil, fmt.Errorf("router: writer registered for unknown destination %q", dest)
		}
	}
	for field, e := range entries {
		if e.Destination == DestDrop {
			continue
		}
		if _, ok := writers[e.Destination]; !ok {
			return nil, fmt.Errorf("router: routing.yaml uses destination %q for field %q with no writer registered", e.Destination, field)
		}
	}
	return &Router{entries: entries, writers: writers}, nil
}

// Route dispatches a single Atomic to the writer for its routed
// destination and, per ADR-001, also dual-writes
// the atomic to signal_log so that signal_log remains the universal
// durable history of every non-drop signal (see ARCHITECTURE.md
// ADR-001: "All vehicle telemetry data lives in ONE table:
// signal_log... READ from signal_log for any historical telemetry
// query"). Hot tables (positions, drive_telemetry, climate_snapshot,
// etc.) remain the fast-path projection for "current state" reads;
// signal_log carries the full change feed for charts, point-in-time
// reconstruction, drive/charge completion, analytics, and replay.
//
// The dual-write is the SECONDARY operation; the primary destination
// remains authoritative for the hot-table contract. Skipped when:
//
//   - the primary destination IS signal_log (no double-write);
//   - the primary destination is unit_history (Setting*Unit atomics
//     are unit-context only, not telemetry — and Pipeline.Process
//     short-circuits these before Route in any case, so this branch
//     is defence in depth);
//   - no signal_log writer is registered in the writers map (graceful
//     for tests that intentionally omit it; production wiring in
//     cmd/teslasync/main.go always registers it).
//
// The legacy `also_signal_log: true` flag in routing.yaml entries is
// preserved for backward compatibility but no longer required — the
// dual-write is now the default for every hot-routed atomic. The
// flag still parses (Entry.ToColdLogToo) and tooling/tests may use
// it for documentation, but the router does not branch on it.
//
// Error semantics (both failure paths increment
// tesla_router_writer_failures_total{dest, reason} independently):
//
//   - Primary write failure is returned to the caller verbatim. The
//     caller (normalize.Pipeline.Process) logs and continues; per
//     ADR-004 #8 the error MUST NOT propagate to MQTT redelivery.
//   - Secondary (signal_log) write failure is logged + counted but
//     NOT returned. signal_log durability is best-effort from the
//     router's perspective; a transient blip on the cold path must
//     not mask a successful primary write at the API layer.
//   - Both failures: primary error is returned (most informative for
//     the caller); secondary failure is observable only via the
//     metric.
//
// Returns ErrNoRoute (wrapped with the offending Field name) when
// atomic.Field has no entry in routing.yaml. The caller is expected
// to log + count this and continue with the next atomic.
//
// Returns nil for entries whose Destination is DestDrop — that is
// the explicit "discard" path and is a successful outcome.
func (r *Router) Route(ctx context.Context, atomic codec.Atomic) (err error) {
	ctx, span := otel.Tracer(routerTracerName).Start(
		ctx,
		"tesla.router.route",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(
			attribute.String("field", atomic.Field),
		),
	)
	defer func() {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "router.route")
		}
		span.End()
	}()

	e, ok := r.entries[atomic.Field]
	if !ok {
		noRouteTotal.WithLabelValues(atomic.Field).Inc()
		span.SetAttributes(attribute.String("outcome", "no_route"))
		return fmt.Errorf("%w: %s", ErrNoRoute, atomic.Field)
	}
	span.SetAttributes(attribute.String("destination", string(e.Destination)))
	if e.Destination == DestDrop {
		span.SetAttributes(attribute.String("outcome", "drop"))
		return nil
	}
	w, ok := r.writers[e.Destination]
	if !ok {
		// Unreachable because New() rejects this state, but defended
		// here so a future refactor that registers writers post-New
		// fails loudly rather than nil-dereferencing.
		span.SetAttributes(attribute.String("outcome", "no_writer"))
		return fmt.Errorf("router: no writer for destination %q (field %s)", e.Destination, atomic.Field)
	}

	// The write.role context value is propagated into the writer so
	// the writer's own tesla.writer.<dest> child span can stamp
	// write.role={primary|dual}. The writer doesn't import the router
	// package — the key type is shared via the codec.Atomic ctx
	// propagation chain. The key constant is declared in tracing.go.
	primaryCtx := contextWithWriteRole(ctx, writeRolePrimary)
	primaryErr := w.Write(primaryCtx, atomic, e)
	if primaryErr != nil {
		writerFailuresTotal.WithLabelValues(string(e.Destination), classifyError(primaryErr)).Inc()
	}

	// Secondary: dual-write to signal_log so cold-path history is
	// universal. Independent of primary outcome — see godoc above for
	// the reasoning. Synthesises a fresh Entry with Destination =
	// DestSignalLog so the signal_log writer's compile-time contract
	// (dst.Destination == its registered destination) is preserved.
	dualWriteAttempted := false
	if e.Destination != DestSignalLog && e.Destination != DestUnitHistory {
		if logWriter, ok := r.writers[DestSignalLog]; ok {
			dualWriteAttempted = true
			logEntry := Entry{Field: e.Field, Destination: DestSignalLog}
			dualCtx := contextWithWriteRole(ctx, writeRoleDual)
			if logErr := logWriter.Write(dualCtx, atomic, logEntry); logErr != nil {
				writerFailuresTotal.WithLabelValues(string(DestSignalLog), classifyError(logErr)).Inc()
				// Best-effort: do not surface to caller. Observable
				// via the metric. See godoc for reasoning.
			}
		}
	}
	span.SetAttributes(
		attribute.Bool("dual_log_write", dualWriteAttempted),
		attribute.String("outcome", routeOutcome(primaryErr)),
	)

	return primaryErr
}

// RouteBatch applies the same routing and dual-write semantics as Route while
// allowing batch-capable writers to collapse database work. Results align
// one-for-one with atomics and report primary-destination failures only;
// signal_log dual-write failures remain metric-only per ADR-004 #8.
func (r *Router) RouteBatch(ctx context.Context, atomics []codec.Atomic) (results []error, err error) {
	ctx, span := otel.Tracer(routerTracerName).Start(
		ctx,
		"tesla.router.route_batch",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(attribute.Int("signal.count", len(atomics))),
	)
	defer func() {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "router.route_batch")
		}
		span.End()
	}()

	results = make([]error, len(atomics))
	primaryGroups := make(map[Destination][]indexedRoutedAtomic)
	primaryOrder := make([]Destination, 0, len(r.writers))
	dualItems := make([]indexedRoutedAtomic, 0, len(atomics))

	for i, atomic := range atomics {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return results, ctxErr
		}
		entry, ok := r.entries[atomic.Field]
		if !ok {
			noRouteTotal.WithLabelValues(atomic.Field).Inc()
			results[i] = fmt.Errorf("%w: %s", ErrNoRoute, atomic.Field)
			continue
		}
		if entry.Destination == DestDrop {
			continue
		}
		if _, seen := primaryGroups[entry.Destination]; !seen {
			primaryOrder = append(primaryOrder, entry.Destination)
		}
		item := indexedRoutedAtomic{
			index: i,
			item:  RoutedAtomic{Atomic: atomic, Entry: entry},
		}
		primaryGroups[entry.Destination] = append(primaryGroups[entry.Destination], item)
		if entry.Destination != DestSignalLog && entry.Destination != DestUnitHistory {
			dualItems = append(dualItems, indexedRoutedAtomic{
				index: i,
				item: RoutedAtomic{
					Atomic: atomic,
					Entry:  Entry{Field: entry.Field, Destination: DestSignalLog},
				},
			})
		}
	}

	for _, destination := range primaryOrder {
		items := primaryGroups[destination]
		writer, ok := r.writers[destination]
		if !ok {
			for _, item := range items {
				results[item.index] = fmt.Errorf(
					"router: no writer for destination %q (field %s)",
					destination,
					item.item.Atomic.Field,
				)
			}
			continue
		}
		batchErrors := writeBatch(
			contextWithWriteRole(ctx, writeRolePrimary),
			writer,
			routedItems(items),
		)
		for i, item := range items {
			if batchErrors[i] == nil {
				continue
			}
			results[item.index] = batchErrors[i]
			writerFailuresTotal.WithLabelValues(
				string(destination),
				classifyError(batchErrors[i]),
			).Inc()
		}
	}

	if len(dualItems) > 0 {
		if writer, ok := r.writers[DestSignalLog]; ok {
			batchErrors := writeBatch(
				contextWithWriteRole(ctx, writeRoleDual),
				writer,
				routedItems(dualItems),
			)
			for i := range dualItems {
				if batchErrors[i] != nil {
					writerFailuresTotal.WithLabelValues(
						string(DestSignalLog),
						classifyError(batchErrors[i]),
					).Inc()
				}
			}
		}
	}

	if ctxErr := ctx.Err(); ctxErr != nil {
		return results, ctxErr
	}
	return results, nil
}

func routedItems(indexed []indexedRoutedAtomic) []RoutedAtomic {
	items := make([]RoutedAtomic, len(indexed))
	for i := range indexed {
		items[i] = indexed[i].item
	}
	return items
}

func writeBatch(ctx context.Context, writer Writer, items []RoutedAtomic) []error {
	if batchWriter, ok := writer.(BatchWriter); ok {
		results := batchWriter.WriteBatch(ctx, items)
		if len(results) == len(items) {
			return results
		}
		err := fmt.Errorf(
			"router: batch writer returned %d results for %d items",
			len(results),
			len(items),
		)
		results = make([]error, len(items))
		for i := range results {
			results[i] = err
		}
		return results
	}

	results := make([]error, len(items))
	for i := range items {
		results[i] = writer.Write(ctx, items[i].Atomic, items[i].Entry)
	}
	return results
}

func routeOutcome(primaryErr error) string {
	if primaryErr == nil {
		return "ok"
	}
	if errors.Is(primaryErr, context.Canceled) {
		return "canceled"
	}
	if errors.Is(primaryErr, context.DeadlineExceeded) {
		return "timeout"
	}
	return "primary_error"
}

// classifyError reduces a writer error to a short bounded label for
// the `reason` dimension of tesla_router_writer_failures_total. We
// intentionally collapse arbitrary backend errors into "other" so
// the Prometheus label cardinality stays a small constant — a
// per-error-string label would let a backend with rich error
// messages turn the metric into a memory leak.
func classifyError(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, context.Canceled):
		return "canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	default:
		return "other"
	}
}
