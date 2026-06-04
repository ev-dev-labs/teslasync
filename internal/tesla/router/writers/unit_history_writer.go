package writers

import (
	"context"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// unitHistoryWriter is the no-op router.Writer registered for
// router.DestUnitHistory. The four SettingDistanceUnit /
// SettingTemperatureUnit / SettingTirePressureUnit / SettingChargeUnit
// atomics that routing.yaml maps to dest: unit_history NEVER reach
// router.Route in steady state — normalize.Pipeline.processOne
// (internal/tesla/normalize/pipeline.go:191-212) checks
// protomodel.SignalMeta.IsSettingUnit FIRST and short-circuits these
// fields through observeSettingUnit, which writes to
// vehicle_unit_history via unithistory.Repo.Record and then returns
// before calling router.Route. The routing.yaml entries (lines
// 815-837) document this dual write-path explicitly: they exist
// purely so the reflective coverage test (every protomodel.Signals
// atomic must have exactly one routing entry) stays green and so
// the YAML accurately accounts for every Setting*Unit field.
//
// router.New still requires a router.Writer registered for every
// non-DestDrop destination that appears in routing.yaml (router.go
// line 127-129) — including DestUnitHistory. Without this writer
// the constructor would return
//
//	router: routing.yaml uses destination "unit_history" for field
//	"SettingChargeUnit" with no writer registered
//
// at process start. So the no-op exists to satisfy that constructor
// contract; its Write method is "should never be called" code.
//
// Why Write logs WARN instead of returning an error: returning an
// error would propagate to tesla_router_writer_failures_total
// (router.go line 168) which feeds the operator alert page. An
// invocation here means the IsSettingUnit short-circuit upstream
// regressed — that IS a code bug worth surfacing — but a 5xx-page on
// every Setting*Unit atomic would be a self-inflicted denial of
// service while the regression is being diagnosed. WARN is loud
// enough to catch in a dashboard ("non-zero rate of unit_history
// writer invocations") and discoverable in the structured log search,
// without paging on every event. The error counter
// tesla_router_writer_failures_total stays clean for the destinations
// where a non-zero rate genuinely indicates backend trouble.
//
// Concurrency: the struct holds no mutable state, so the value is
// safe for concurrent use across the pipeline's goroutines.
type unitHistoryWriter struct{}

// Compile-time assertion that *unitHistoryWriter satisfies
// router.Writer. Mirrors the pattern in snapshot_base.go,
// positions_writer.go, security_event_writer.go, signal_log_writer.go,
// and tire_pressure_writer.go — a signature drift in router.Writer
// would fail the build here rather than the first integration test.
var _ router.Writer = (*unitHistoryWriter)(nil)

// NewUnitHistoryWriter constructs the no-op router.Writer for
// destination unit_history.
//
// The signature deliberately takes no *pgxpool.Pool — unlike every
// other writer in this package — because this writer is genuinely
// stateless and never touches the database. The four Setting*Unit
// fields land in vehicle_unit_history via the
// normalize.observeSettingUnit short-circuit, NOT through this writer.
// See the unitHistoryWriter type godoc for the full rationale and the
// invariant this writer defends.
//
// Returns the router.Writer so callers can wire it like the other
// destination writers.
func NewUnitHistoryWriter() router.Writer {
	return &unitHistoryWriter{}
}

// Write implements router.Writer for destination unit_history. It logs
// a WARN-level structured event and returns nil — it does NOT touch the
// database and does NOT return an error.
//
// Reaching this method means normalize.Pipeline.processOne's
// IsSettingUnit short-circuit failed: either a code regression has
// removed the meta.IsSettingUnit branch, or routing.yaml has been
// edited to point a non-Setting*Unit field at dest: unit_history
// (which would also fail the protomodel coverage assertion at startup
// but is worth defending against here for belt-and-braces).
//
// The WARN log carries the offending field name, vehicle id (VIN),
// and emitted-at timestamp so the operator can pinpoint the
// regression source. dst is included so a misrouted entry's
// Destination string is captured even if the contract violation came
// from routing.yaml rather than from the pipeline.
func (w *unitHistoryWriter) Write(_ context.Context, atom codec.Atomic, dst router.Entry) error {
	log.Warn().
		Str("field", atom.Field).
		Str("vehicle_id", atom.VehicleID).
		Time("emitted_at", atom.EmittedAt).
		Str("destination", string(dst.Destination)).
		Msg("unitHistoryWriter: Write invoked — Setting*Unit short-circuit in normalize.Pipeline.processOne regressed; this writer should never be called")
	return nil
}
