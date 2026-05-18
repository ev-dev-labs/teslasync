package signal

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// ErrNilLiveSignalStore is returned when constructing a LiveStateReader without
// a backing LiveSignalStore.
var ErrNilLiveSignalStore = errors.New("live state reader live signal store must not be nil")

// nowFn is the clock source for LiveStateReader's signal_log fallback. It is a
// package var so tests can pin it; production wiring uses time.Now.
var nowFn = time.Now

// LiveStateReader is the read boundary HTTP handlers use when answering
// "current state" questions about a vehicle (the `/latest` family of
// endpoints, /vehicles/{id}/state, /vehicles/{id}/battery, /vehicles/{id}/energy
// in their no-as_of branches, etc).
//
// It composes the live signal layers (L1 in-process Store + optional L2
// Redis HSET, fronted by LiveSignalStore) with an OPTIONAL StateReader
// fallback over signal_log so that fields which are NOT routed to the
// in-memory store (e.g. infrequent fields like Latitude/Longitude on a
// parked vehicle that have not re-emitted since the API pod last booted)
// can still surface in the response. See ADR-002 / ADR-007.
//
// # Why a new boundary
//
//   - StateReader (signal_log) alone is wrong for "current": routing.yaml
//     sends ~140 of 286 fields to typed snapshot tables (climate_snapshot,
//     motor_snapshot, etc) and only ~11 dual-write to signal_log, so
//     reading "current" from signal_log returns mostly empty maps.
//   - LiveSignalStore alone is wrong for cross-pod cold starts: an API
//     pod that has never warmed for vehicleID has empty L1 and would
//     return empty maps until L2 mirrors arrive.
//
// LiveStateReader fixes both: it asks the LiveSignalStore at the
// distributed (L1+L2 merged) read preference first, then for any signal
// keys still absent it falls back to the signal_log StateReader. The
// returned map is always caller-owned and safe to mutate.
//
// # Hot-path contract
//
// LiveStateReader is COLD-PATH ONLY. Telemetry ingest, FSM/reconciliation,
// and session boundary detection MUST keep reading directly from
// signal.Store (L1) at LiveSignalReadLocal preference per ADR-007.
type LiveStateReader interface {
	// LiveState returns the union of every known live signal for vehicleID
	// at the time of the call. Live signals (L1+L2) take precedence; only
	// keys not present in the live layer are filled from the signal_log
	// fallback. The returned map is never nil and is safe to mutate.
	LiveState(ctx context.Context, vehicleID int64) (State, error)

	// LiveSignal returns a single signal value, with the same precedence
	// rules as LiveState. Returns (nil, nil) when the signal has never
	// been observed in either layer.
	LiveSignal(ctx context.Context, vehicleID int64, name string) (SignalValue, error)
}

// hybridLiveStateReader composes a LiveSignalStore (L1+L2) with an
// optional StateReader fallback (signal_log).
type hybridLiveStateReader struct {
	live     LiveSignalStore
	fallback StateReader
}

// NewLiveStateReader creates the production LiveStateReader. The live
// argument is required; fallback may be nil to disable signal_log
// backfill (recommended only for tests — production callers should pass
// the same StateReader that handlers already receive so that infrequent
// fields like Latitude/Longitude on a parked vehicle remain visible).
func NewLiveStateReader(live LiveSignalStore, fallback StateReader) (LiveStateReader, error) {
	if live == nil {
		return nil, ErrNilLiveSignalStore
	}
	return &hybridLiveStateReader{live: live, fallback: fallback}, nil
}

func (h *hybridLiveStateReader) LiveState(ctx context.Context, vehicleID int64) (State, error) {
	out := State{}

	// L1+L2 merged read.
	live, err := h.live.GetAll(ctx, vehicleID, LiveSignalReadDistributed)
	if err != nil {
		return nil, fmt.Errorf("live state reader live get all vehicle %d: %w", vehicleID, err)
	}
	for k, v := range live {
		if v == nil {
			continue
		}
		out[k] = v.Raw
	}

	// signal_log backfill for keys missing from the live layer.
	if h.fallback != nil {
		cold, err := h.fallback.State(ctx, vehicleID, nowFn())
		if err != nil {
			return nil, fmt.Errorf("live state reader fallback state vehicle %d: %w", vehicleID, err)
		}
		for k, v := range cold {
			if _, ok := out[k]; ok {
				continue
			}
			out[k] = v
		}
	}

	return out, nil
}

func (h *hybridLiveStateReader) LiveSignal(ctx context.Context, vehicleID int64, name string) (SignalValue, error) {
	v, err := h.live.GetSignal(ctx, vehicleID, name, LiveSignalReadDistributed)
	if err != nil {
		return nil, fmt.Errorf("live state reader live signal %q vehicle %d: %w", name, vehicleID, err)
	}
	if v != nil {
		return v.Raw, nil
	}
	if h.fallback == nil {
		return nil, nil
	}
	val, err := h.fallback.SignalAt(ctx, vehicleID, name, nowFn())
	if err != nil {
		return nil, fmt.Errorf("live state reader fallback signal %q vehicle %d: %w", name, vehicleID, err)
	}
	return val, nil
}
