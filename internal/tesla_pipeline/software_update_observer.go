package teslapipeline

import (
	"context"
	"time"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/normalize"
)

// softwareUpdateInsertTimeout caps the per-payload InsertIfChanged call.
// The legacy trackVehicleConfig used 5s inside a goroutine; per the
// rubber-duck critique we keep this synchronous (matches SideEffectsObserver
// pattern, no unbounded goroutine fan-out) but shorten the timeout so a
// slow DB cannot stall ingest. 99% of payloads hit ON CONFLICT DO NOTHING
// (no row inserted) so the call is cheap; the timeout is a safety belt
// against pool exhaustion or lock contention.
const softwareUpdateInsertTimeout = 2 * time.Second

// SoftwareUpdateRecorder is the narrow write interface the
// SoftwareUpdateObserver depends on. It is implemented in production by
// *database.SoftwareUpdateRepo and mocked in tests. Keeping the surface to
// a single method avoids pulling the full repo into observer unit tests.
//
// The status argument is forwarded verbatim ("installed" for the observer's
// hot path, matching the legacy trackVehicleConfig behavior). Returns
// inserted=true when a new row was written, inserted=false when ON CONFLICT
// (vehicle_id, version) DO NOTHING absorbed the call as a no-op.
type SoftwareUpdateRecorder interface {
	InsertIfChanged(ctx context.Context, vehicleID int64, version, status string) (bool, error)
}

// SoftwareUpdateObserver is the AtomicsObserver that bridges
// normalize.Pipeline payload completion to the software_updates table.
//
// Background: prior to Phase-42 the legacy ingest path (deleted in
// f31a1736 "delete dead legacy ingest code") called
// (*TelemetryHandler).trackVehicleConfig which inserted firmware version
// changes via SoftwareUpdateRepo.InsertIfChanged. That helper was then
// itself deleted in fa7440a0 ("lint: delete pre-existing dead helpers")
// because it had no remaining callers — the Phase-42 rewrite never
// re-wired this write path, so the software_updates table stopped
// receiving new versions even though the SoftwareUpdateVersion signal is
// being emitted by Fleet Telemetry (visible in /signals/{id}/live).
//
// This observer restores the write path through the new pipeline. It is
// registered against normalize.New as a second AtomicsObserver alongside
// SideEffectsObserver (no ordering dependency — the effects are
// independent). Per the AtomicsObserver contract:
//
//   - OnPayloadProcessed is called exactly once per successful codec
//     decode, after the route loop has drained every atomic.
//   - Panics are recovered inside notifyObserver — observer failures MUST
//     NOT fail the payload.
//   - The interface intentionally returns no error; implementations own
//     their own metrics + logging.
//
// Idempotency: InsertIfChanged relies on the UNIQUE INDEX on
// software_updates(vehicle_id, version) (migration 000197) — every
// version-bearing payload safely retries the insert; only a true
// version transition produces a new row.
type SoftwareUpdateObserver struct {
	recorder SoftwareUpdateRecorder
	log      zerolog.Logger
	timeout  time.Duration
}

// NewSoftwareUpdateObserver constructs an observer. A nil recorder is a
// wiring bug and panics rather than silently no-op'ing the entire
// firmware-version write path (which would leave the Software Updates
// page perpetually stale with no obvious symptom).
func NewSoftwareUpdateObserver(recorder SoftwareUpdateRecorder, logger zerolog.Logger) *SoftwareUpdateObserver {
	if recorder == nil {
		panic("teslapipeline: NewSoftwareUpdateObserver: recorder must be non-nil")
	}
	return &SoftwareUpdateObserver{
		recorder: recorder,
		log:      logger,
		timeout:  softwareUpdateInsertTimeout,
	}
}

// OnPayloadProcessed implements normalize.AtomicsObserver. It scans the
// post-route atomics slice for a firmware version field and, if found,
// records it via recorder.InsertIfChanged.
//
// Per-field MQTT delivers one atomic per payload, so the vast majority
// of payloads do NOT carry a firmware version field — the scan returns
// "" and the observer is a no-op without ever touching the database.
//
// When a version IS present, the call is synchronous but capped by
// softwareUpdateInsertTimeout (2s). Per the rubber-duck critique we
// deliberately do NOT fire-and-forget via a goroutine: unbounded
// goroutine fan-out under a DB stall would pile up faster than the GC
// can drain it, and the sync call still completes in microseconds on
// the common-case ON CONFLICT DO NOTHING path.
func (o *SoftwareUpdateObserver) OnPayloadProcessed(ctx context.Context, vehicleID int64, atomics []codec.Atomic) {
	version := extractFirmwareVersionFromAtomics(atomics)
	if version == "" {
		return
	}

	cctx, cancel := context.WithTimeout(ctx, o.timeout)
	defer cancel()

	inserted, err := o.recorder.InsertIfChanged(cctx, vehicleID, version, "installed")
	if err != nil {
		o.log.Warn().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Str("version", version).
			Msg("teslapipeline: failed to record firmware version")
		return
	}
	if inserted {
		o.log.Info().
			Int64("vehicle_id", vehicleID).
			Str("version", version).
			Msg("teslapipeline: new firmware version recorded")
	}
}

// extractFirmwareVersionFromAtomics returns the firmware version string
// from a payload's atomics slice, preferring "SoftwareUpdateVersion"
// (Field 220, category "vehicle_state") over "Version" (Field 68,
// category "config"). Returns "" if neither field is present or both
// hold an empty / non-string value.
//
// Precedence rationale: SoftwareUpdateVersion is the field the user's
// production Live Signals proves is being emitted by Fleet Telemetry,
// and its name semantically matches the software_updates table's
// purpose. Version is retained as a fallback for installations where
// only the legacy config-category field is emitted.
func extractFirmwareVersionFromAtomics(atomics []codec.Atomic) string {
	var primary, fallback string
	for _, a := range atomics {
		switch a.Field {
		case "SoftwareUpdateVersion":
			if s, ok := a.Value.(string); ok && s != "" {
				primary = s
			}
		case "Version":
			if s, ok := a.Value.(string); ok && s != "" {
				fallback = s
			}
		}
	}
	if primary != "" {
		return primary
	}
	return fallback
}

// PickFirmwareVersionFromSignals returns the firmware version from a
// merged signal-state map (the shape emitted by SignalStore.GetRawMap
// or signal.StateReader.State). It applies the same precedence as
// extractFirmwareVersionFromAtomics — SoftwareUpdateVersion wins over
// Version. Exported because the app startup backfill in
// internal/app/new.go.initPipelineSubscriber needs to share the
// precedence rule with the observer (out-of-sync precedence between
// backfill and observer would produce a confusing flicker on first
// post-deploy boot).
func PickFirmwareVersionFromSignals(signals map[string]any) string {
	if signals == nil {
		return ""
	}
	if v, ok := signals["SoftwareUpdateVersion"]; ok {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	if v, ok := signals["Version"]; ok {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	return ""
}

// Compile-time assertion that *SoftwareUpdateObserver satisfies
// normalize.AtomicsObserver. Triggers a build error if the interface
// ever drifts under either package.
var _ normalize.AtomicsObserver = (*SoftwareUpdateObserver)(nil)
