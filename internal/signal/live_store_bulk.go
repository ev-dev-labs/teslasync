package signal

// Bulk live-signal reads across the L1+L2 boundary.
//
// This is the fleet-scale counterpart of GetAll: same merge rule, same
// freshness semantics, same layering — but ONE Redis round trip for the whole
// page instead of one per vehicle. Nothing here reads a snapshot/mirror table
// and nothing here changes what a single-vehicle read returns.

import (
	"context"
	"fmt"
)

// BulkLiveSignalStore is the OPTIONAL bulk-read capability of a
// LiveSignalStore.
//
// It is deliberately a separate interface rather than a new method on
// LiveSignalStore: consumers type-assert for it, so a store that predates the
// capability keeps compiling and keeps working through the per-vehicle path.
// Both production stores (HybridLiveSignalStore, NoopLiveSignalStore)
// implement it — see the compile-time assertions below.
type BulkLiveSignalStore interface {
	LiveSignalStore

	// GetAllBulk returns one LiveSignalRead per REQUESTED vehicle id.
	//
	// The outer error is reserved for whole-call failures (nil context,
	// invalid id). Transport failures are attributed per vehicle through
	// LiveSignalRead.Err so a partially-degraded Redis degrades exactly the
	// affected vehicles — never the whole fleet.
	GetAllBulk(ctx context.Context, vehicleIDs []int64, preference LiveSignalReadPreference) (map[int64]LiveSignalRead, error)
}

var (
	_ BulkLiveSignalStore = (*HybridLiveSignalStore)(nil)
	_ BulkLiveSignalStore = (*NoopLiveSignalStore)(nil)
)

// GetAllBulk reads the live signals of many vehicles in one pass.
//
// Layer behaviour mirrors GetAll exactly:
//   - LiveSignalReadLocal preference, or LiveSignalStoreModeLocal mode, reads
//     L1 only and NEVER touches Redis (the local-mode rollback switch keeps
//     working);
//   - distributed reads merge L1 and L2 per the ADR-007 per-signal merge rule
//     (newer non-zero Timestamp wins, ties prefer L2, legacy zero-Timestamp
//     loses to any non-zero Timestamp, both-zero keeps L1);
//   - stale and legacy values are RETAINED — freshness is informational, and
//     the boundary never drops a value based on age.
//
// A vehicle whose L2 read failed carries Err and nil Values, matching the
// single-vehicle contract where a Redis error is surfaced rather than silently
// downgraded to an L1-only answer: the caller decides to degrade to the
// durable signal_log fallback, and it can only make that decision if it is
// told the live layer was unavailable.
func (s *HybridLiveSignalStore) GetAllBulk(
	ctx context.Context,
	vehicleIDs []int64,
	preference LiveSignalReadPreference,
) (map[int64]LiveSignalRead, error) {
	if err := validateLiveSignalContext(ctx); err != nil {
		return nil, err
	}
	for _, id := range vehicleIDs {
		if err := validateLiveSignalVehicleID(id); err != nil {
			return nil, err
		}
	}
	ids := dedupeVehicleIDs(vehicleIDs)
	out := make(map[int64]LiveSignalRead, len(ids))
	if len(ids) == 0 {
		return out, nil
	}

	l2 := s.redisCache()
	if preference != LiveSignalReadDistributed || l2 == nil {
		for _, id := range ids {
			out[id] = LiveSignalRead{Values: cloneSignalValues(s.l1.GetAll(id))}
		}
		return out, nil
	}

	l2Reads, err := l2.GetAllValuesBulk(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("bulk read Redis live signals for %d vehicles: %w", len(ids), err)
	}
	for _, id := range ids {
		read, ok := l2Reads[id]
		if !ok {
			// The L2 layer owes an entry per requested id; a hole is a bug in
			// the bulk reader, reported as this vehicle's failure rather than
			// silently answered as "no signals".
			out[id] = LiveSignalRead{Err: fmt.Errorf("bulk read Redis live signals: no reply for vehicle %d", id)}
			continue
		}
		if read.Err != nil {
			out[id] = LiveSignalRead{Err: fmt.Errorf("read Redis live signals for vehicle %d: %w", id, read.Err)}
			continue
		}
		l1Values := s.l1.GetAll(id)
		if len(l1Values) == 0 && len(read.Values) == 0 {
			out[id] = LiveSignalRead{Values: cloneSignalValues(l1Values)}
			continue
		}
		out[id] = LiveSignalRead{Values: mergeSignalMaps(l1Values, read.Values)}
	}
	return out, nil
}

// GetAllBulk answers with an empty read per vehicle: the no-op store holds no
// state, and an empty read is an absence of live signals, never a failure.
func (*NoopLiveSignalStore) GetAllBulk(
	_ context.Context,
	vehicleIDs []int64,
	_ LiveSignalReadPreference,
) (map[int64]LiveSignalRead, error) {
	out := make(map[int64]LiveSignalRead, len(vehicleIDs))
	for _, id := range dedupeVehicleIDs(vehicleIDs) {
		out[id] = LiveSignalRead{Values: map[string]*Value{}}
	}
	return out, nil
}
