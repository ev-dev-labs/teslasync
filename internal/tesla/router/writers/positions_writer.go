package writers

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// positionsWriter is the router.Writer for the SI-canonical `positions`
// hypertable created by migration 000182_positions_si.up.sql.
//
// Why this writer cannot reuse snapshotWriter and is instead stateful:
//
// `positions.lat` and `positions.lng` are the only NOT NULL non-PK
// columns in the table. The codec FLATTENS the proto Location compound
// into two SEPARATE atomics (LocationLatitude and LocationLongitude)
// per codec/flatten.go, and routing.yaml maps each of those flattened
// atomics to its own column with separate routing entries. The
// snapshot_base per-column upsert pattern would therefore issue TWO
// independent INSERTs for the lat/lng pair, neither of which could
// satisfy the partner's NOT NULL constraint on the initial row creation.
//
// routing.yaml lines 530-537 explicitly designate this writer as the
// pair-up point: "the codec emits both in the same payload with a
// shared EmittedAt timestamp, and the positions writer ... buffers one
// half until the other arrives so the (lat, lng) pair lands on a
// single row. Routing is field-static per ADR-004 #8 — the pair-up
// logic lives in the writer, not here." That comment is the source of
// truth for the writer's stateful contract; the prompt 0011 Decision #2
// reference to a hypothetical compound `Location` atomic is stale —
// the codec never emits one (codec/codec.go:160 dispatches Location to
// flattenLocation which always emits two children) and routing the
// compound `Location` itself is forbidden (routing.yaml:537).
//
// The buffer also collects the two nullable companions (GpsHeading and
// GpsState) so that when both lat AND lng have been observed, a single
// INSERT carries every column observed for the (vehicle_id, ts) up to
// that point. ON CONFLICT DO UPDATE makes the INSERT idempotent so
// late-arriving GpsHeading/GpsState — which can occur in the same
// payload because the codec processes Datum entries in proto-order
// (Location=21 < GpsState=22 < GpsHeading=23, see protomodel signal
// metadata) — re-flush correctly without wiping prior columns.
//
// Concurrency: a single sync.Mutex serialises both buffer mutation and
// flush snapshotting. The DB Exec runs WITHOUT the mutex held so a slow
// or canceled write does not block every concurrent positions Write.
// Re-flushes during a concurrent late arrival are safe because every
// flush snapshots the entry's current values under lock and the SQL
// upsert is naturally idempotent on (vehicle_id, ts).
//
// Memory bound: pendingTTL evicts entries whose lat/lng partner never
// arrives, and maxPending is a hard ceiling that returns an error when
// exceeded so a producer firmware regression that stops emitting
// Location compounds cannot OOM the process.
type positionsWriter struct {
	db pgxPool

	// now is injected to allow deterministic TTL-eviction tests.
	// Production wiring uses time.Now.
	now func() time.Time

	// pendingTTL is the longest a half-pair (lat-only or lng-only or
	// heading-only or gps-only) is retained waiting for its partner.
	// The codec emits all children of one payload in close succession
	// (single Pipeline.Process invocation), so partner arrival is
	// normally <1ms; the 5-minute default gives margin for slow
	// processors without unbounded growth.
	pendingTTL time.Duration

	// maxPending caps the buffer size to bound memory in the worst
	// case (a producer that emits half a Location compound every
	// payload). Hitting this cap is a producer/codec regression
	// signal — a Tesla payload should always carry both halves.
	maxPending int

	// evictionInterval amortises the O(N) TTL sweep so the per-Write
	// cost does not scale linearly with the buffer size.
	evictionInterval time.Duration

	mu            sync.Mutex
	pending       map[positionsKey]*positionsPending
	lastEviction  time.Time
}

// positionsKey is the (VIN, normalised-ts) tuple that pairs lat/lng
// across separate atomics. Both fields are values (not pointers) so
// the struct works as a map key. The ts field is normalised to UTC
// with the monotonic clock stripped before being placed in the key
// to guarantee that two atomics with the same Payload.CreatedAt
// always key-equal.
type positionsKey struct {
	vin string
	ts  time.Time
}

// positionsPending holds the buffered atomics for one (vin, ts) until
// both lat AND lng have been observed and the row can be flushed. The
// nullable companions (headingDeg, gpsState) are stored as pointers
// so a nil value distinguishes "not observed yet" from "observed as
// zero / empty" — the latter is a legitimate value the producer can
// emit (heading_deg=0 due North, gps_state="" for unknown lock).
type positionsPending struct {
	hasLat      bool
	hasLng      bool
	lat         float64
	lng         float64
	headingDeg  *float64
	gpsState    *string
	firstSeenAt time.Time
}

// Compile-time assertion that *positionsWriter satisfies router.Writer.
// A signature drift in router.Writer would fail the build here rather
// than at the first integration test.
var _ router.Writer = (*positionsWriter)(nil)

const (
	defaultPositionsPendingTTL       = 5 * time.Minute
	defaultPositionsMaxPending       = 100_000
	defaultPositionsEvictionInterval = 30 * time.Second
)

// NewPositionsWriter constructs the production positions writer. The
// constructor signature is locked by phase-42a prompt 0011 Decision #1.
// A nil pool is a wiring bug and panics at process start so the
// failure is surfaced before any payload is processed.
func NewPositionsWriter(pool *pgxpool.Pool) router.Writer {
	if pool == nil {
		panic("NewPositionsWriter: pool must be non-nil")
	}
	return newPositionsWriter(pool)
}

// newPositionsWriter is the package-private constructor that takes the
// minimal pgxPool interface so tests can inject a recording fake. It
// is also the seam that production wiring would use to override
// pendingTTL / maxPending / now in the future without bumping the
// public surface.
func newPositionsWriter(db pgxPool) *positionsWriter {
	return &positionsWriter{
		db:               db,
		now:              time.Now,
		pendingTTL:       defaultPositionsPendingTTL,
		maxPending:       defaultPositionsMaxPending,
		evictionInterval: defaultPositionsEvictionInterval,
		pending:          make(map[positionsKey]*positionsPending),
	}
}

// positionsUpsertSQL writes one positions row. ON CONFLICT DO UPDATE
// makes the statement idempotent on (vehicle_id, ts) so re-flushes
// (when a late heading_deg or gps_state arrives for an already-
// flushed key) update only the new column, preserving prior columns
// via COALESCE. The vehicle_id is resolved INSIDE the INSERT against
// vehicles.vin so the writer stays at the codec.Atomic.VehicleID
// (string VIN) boundary and never carries the numeric vehicles.id —
// see the VIN RESOLUTION CONTRACT in phase-42a prompt 0011.
//
// $1 = VIN (string), $2 = ts (time.Time), $3 = lat (float64),
// $4 = lng (float64), $5 = heading_deg (float64 or nil),
// $6 = gps_state (string or nil).
const positionsUpsertSQL = `INSERT INTO positions (vehicle_id, ts, lat, lng, heading_deg, gps_state)
SELECT v.id, $2, $3, $4, $5, $6 FROM vehicles v WHERE v.vin = $1
ON CONFLICT (vehicle_id, ts) DO UPDATE SET
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng,
  heading_deg = COALESCE(EXCLUDED.heading_deg, positions.heading_deg),
  gps_state = COALESCE(EXCLUDED.gps_state, positions.gps_state)`

// Write implements router.Writer for the positions destination.
//
// Algorithm:
//
//  1. Validate atom.Field is one of the four routed fields and that
//     atom.Value's runtime type matches the column's storage type.
//     Validation runs BEFORE any state mutation so a malformed atomic
//     never leaves a partial entry in the buffer.
//
//  2. Normalise atom.EmittedAt to UTC with the monotonic clock stripped
//     so two atomics carrying the same Payload.CreatedAt always
//     key-equal.
//
//  3. Under mu, opportunistically evict TTL-expired entries (amortised
//     to evictionInterval), look up or create the (vin, ts) entry,
//     merge the new value into it, then snapshot the entry's flushable
//     columns and release mu.
//
//  4. If the snapshot does NOT have both lat AND lng, return nil — the
//     atomic is buffered until the partner arrives or TTL evicts.
//     Pipeline.processOne counts this as outcome=ok because the data
//     IS at least temporarily stored; per ADR-004 #8 transient writer
//     buffering does NOT trigger MQTT redelivery.
//
//  5. If the snapshot has both lat AND lng, issue the upsert. On
//     success the entry is RETAINED in the buffer (TTL-bounded) so
//     late-arriving GpsHeading/GpsState for the same (vin, ts) re-
//     flush idempotently via ON CONFLICT DO UPDATE. On failure the
//     entry is also retained so a future Write triggers a retry.
//
// Failure modes (per ADR-004 #8 these are surfaced to the router
// caller — they MUST NOT propagate to MQTT redelivery):
//
//   - atom.Field not in the routed set: returns "unrouted field" error
//     per Decision #5. Defence-in-depth — routing.yaml is the gate so
//     this is reachable only on a routing.yaml/positions_writer.go
//     drift.
//
//   - atom.Value's runtime type does not match the column's storage
//     type: producer/codec contract drift, returns error.
//
//   - len(pending) >= maxPending and the atomic is for a new key:
//     producer/codec regression signal, returns error.
//
//   - db.Exec returns an error: backend transient or schema drift,
//     wrapped with the positionsWriter[positions] prefix so the
//     router's classifyError tag set picks up timeouts / cancellations
//     from the wrapped chain.
//
//   - tag.RowsAffected() == 0: the VIN is not registered in vehicles.
//     Returns a typed error WITHOUT the VIN in the message (PII). The
//     entry stays in the buffer in case the vehicle is registered
//     before TTL evicts.
//
// dst is part of the Writer interface contract but the positions
// writer deliberately does NOT consult dst.Column — the column
// mapping is a hard-coded switch on atom.Field per Decision #5
// because the four routed fields each map to a different column in
// the same INSERT statement.
func (w *positionsWriter) Write(ctx context.Context, atom codec.Atomic, dst router.Entry) error {
	_ = dst // see godoc above — column mapping is hard-coded per Decision #5.

	ctx, span, end := startWriterSpan(ctx, "positions", atom.Field)
	var err error
	defer func() { end(err) }()

	// 1. Validate field + runtime value type WITHOUT mutating writer state.
	var lat, lng *float64
	var headingDeg *float64
	var gpsState *string
	switch atom.Field {
	case "LocationLatitude":
		v, ok := atom.Value.(float64)
		if !ok {
			err = fmt.Errorf("positionsWriter[positions].LocationLatitude: expected float64, got %T", atom.Value)
			return err
		}
		lat = &v
	case "LocationLongitude":
		v, ok := atom.Value.(float64)
		if !ok {
			err = fmt.Errorf("positionsWriter[positions].LocationLongitude: expected float64, got %T", atom.Value)
			return err
		}
		lng = &v
	case "GpsHeading":
		// GpsHeading is ValueKindFloat per protomodel signal metadata;
		// the codec returns float32 from ftproto.Value_FloatValue. We
		// promote to float64 here at the writer boundary because
		// pgx.Exec can bind either, but storing float64 in the buffer
		// keeps the snapshotted struct uniform.
		v, ok := coercePositionsFloat(atom.Value)
		if !ok {
			err = fmt.Errorf("positionsWriter[positions].GpsHeading: expected float32 or float64, got %T", atom.Value)
			return err
		}
		headingDeg = &v
	case "GpsState":
		v, ok := atom.Value.(string)
		if !ok {
			err = fmt.Errorf("positionsWriter[positions].GpsState: expected string, got %T", atom.Value)
			return err
		}
		gpsState = &v
	default:
		// routing.yaml is the gate — any field here is a drift between
		// routing.yaml and this switch. The error message is verbatim
		// per Decision #5.
		err = fmt.Errorf("positionsWriter: unrouted field %q", atom.Field)
		return err
	}

	// 2. Normalise timestamp. EmittedAt comes from timestamppb.AsTime()
	// which already strips monotonic, but the explicit Round(0) +
	// .UTC() is defensive against future producers that might supply a
	// time.Time with a Location set.
	ts := atom.EmittedAt.UTC().Round(0)
	key := positionsKey{vin: atom.VehicleID, ts: ts}

	// 3. Merge into pending under mu; snapshot if flushable.
	w.mu.Lock()
	w.maybeEvictExpiredLocked()

	p, exists := w.pending[key]
	if !exists {
		if len(w.pending) >= w.maxPending {
			w.mu.Unlock()
			err = fmt.Errorf("positionsWriter[positions]: pending buffer full (max=%d)", w.maxPending)
			return err
		}
		p = &positionsPending{firstSeenAt: w.now()}
		w.pending[key] = p
	}

	if lat != nil {
		p.lat = *lat
		p.hasLat = true
	}
	if lng != nil {
		p.lng = *lng
		p.hasLng = true
	}
	if headingDeg != nil {
		p.headingDeg = headingDeg
	}
	if gpsState != nil {
		p.gpsState = gpsState
	}

	if !p.hasLat || !p.hasLng {
		// 4. Buffered; partner not yet arrived.
		w.mu.Unlock()
		span.SetAttributes(attribute.String("outcome", "buffered"))
		return nil
	}

	// 5. Snapshot for flush so we can release mu before DB I/O. The
	// snapshot is a value copy of the flushable columns; if a
	// concurrent Write modifies the entry between here and the next
	// flush, the next Write's snapshot will include the newer values
	// and the upsert will re-write the row idempotently.
	snapLat := p.lat
	snapLng := p.lng
	var snapHeading any
	if p.headingDeg != nil {
		snapHeading = *p.headingDeg
	}
	var snapGpsState any
	if p.gpsState != nil {
		snapGpsState = *p.gpsState
	}
	w.mu.Unlock()

	tag, err := w.db.Exec(ctx, positionsUpsertSQL, atom.VehicleID, ts, snapLat, snapLng, snapHeading, snapGpsState)
	if err != nil {
		return fmt.Errorf("positionsWriter[positions]: %w", err)
	}
	span.SetAttributes(attribute.Int64("rows_affected", tag.RowsAffected()), attribute.String("outcome", "flushed"))
	if tag.RowsAffected() == 0 {
		// VIN deliberately not in the message — it is PII. The
		// router's writer_failures_total{dest=positions, reason="other"}
		// counter increments on this path; the upstream MQTT
		// subscriber log already records the (topic, vehicle) context
		// if forensic correlation is needed.
		err = fmt.Errorf("positionsWriter[positions]: vehicle not registered")
		return err
	}
	return nil
}

// maybeEvictExpiredLocked is the amortised TTL sweep. The pending map
// is iterated only every evictionInterval to keep the per-Write cost
// independent of the buffer size on the hot path. On every sweep a
// single Warn log records how many entries were dropped so silent
// data loss (the "lone half" or "lone heading/gps" case) is at least
// observable in operator logs. The log message deliberately omits the
// VIN/ts of the evicted entries — those are PII and the count alone
// is sufficient for an operator to notice a producer regression.
//
// CALLER MUST HOLD w.mu.
func (w *positionsWriter) maybeEvictExpiredLocked() {
	now := w.now()
	if now.Sub(w.lastEviction) < w.evictionInterval {
		return
	}
	w.lastEviction = now
	if len(w.pending) == 0 {
		return
	}
	cutoff := now.Add(-w.pendingTTL)
	var evicted int
	for k, p := range w.pending {
		if p.firstSeenAt.Before(cutoff) {
			delete(w.pending, k)
			evicted++
		}
	}
	if evicted > 0 {
		log.Warn().
			Int("evicted", evicted).
			Dur("ttl", w.pendingTTL).
			Int("remaining", len(w.pending)).
			Msg("positionsWriter: evicted stale pending entries (lat/lng partner never arrived)")
	}
}

// coercePositionsFloat narrows codec.Atomic.Value to float64 for the
// GpsHeading column. The codec emits float32 from
// ftproto.Value_FloatValue (ValueKindFloat) but float64 is also
// accepted defensively in case a future protomodel change promotes
// the wire type. nil and any other type is rejected so a producer/
// codec contract drift is observable rather than silently coerced.
func coercePositionsFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	default:
		return 0, false
	}
}
