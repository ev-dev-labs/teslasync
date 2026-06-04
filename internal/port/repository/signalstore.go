package repository

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/signal"
)

// This file declares the Contract C persistence ports for the two-layer signal
// store (ADR-0091): the append-only provider-native raw layer (raw_signal,
// migration 000214) and the SI-united canonical query layer (canonical_signal,
// migration 000215). The JDBC/Timescale implementation is Phase 5 (an adapter
// under internal/adapter/*); these are interface contracts only.
//
// Repo adaptation note: the source prompt (Phase 2 / prompt 05) specifies a
// framework-free Kotlin SignalStore under
// packages/contract-storage/interfaces/. This repository is Go on a hexagonal
// layout, so the port lives here and its row DTOs are pure-domain structs in
// internal/domain/signal (the Go analogue of the Kotlin data classes). H31 is
// satisfied structurally: per internal/arch.TestPortPurity this package may
// import only stdlib + internal/domain/* + sibling internal/port/* — no Spring
// (no DI framework), no JDBC/pgx, and no proto types can leak into the
// contract.

// RawSignalStore is the write port for the append-only raw layer.
type RawSignalStore interface {
	// AppendRaw appends provider-native readings to raw_signal. The layer is
	// append-only (H17): there is no update or delete path; a correction is a
	// new row with a later ObservedAt for the same (vehicle_id, provider_kind).
	//
	// The write is idempotent (H24): re-delivering a reading whose
	// (vehicle_id, observed_at, provider_kind) key already exists is a no-op,
	// implemented by the adapter as
	//   INSERT ... ON CONFLICT (vehicle_id, observed_at, provider_kind) DO NOTHING
	// so a duplicate at-least-once redelivery silently collapses onto the row
	// already on disk. Passing an empty slice is a no-op and not an error.
	AppendRaw(ctx context.Context, rows []signal.RawSignalRow) error
}

// CanonicalSignalStore is the read/write port for the SI-united canonical
// query layer that dashboards, alerts, and automations consume.
type CanonicalSignalStore interface {
	// UpsertCanonical writes SI-canonical readings to canonical_signal
	// idempotently (H24 / TL-7). The adapter upserts via
	//   INSERT ... ON CONFLICT (vehicle_id, observed_at, canonical_kind) DO NOTHING
	// so a re-delivery of the same derived reading collapses onto the existing
	// row rather than double-writing. NumValue is consumed verbatim as SI
	// (H13); the writer never re-converts units. Passing an empty slice is a
	// no-op and not an error.
	UpsertCanonical(ctx context.Context, rows []signal.CanonicalSignalRow) error

	// Latest returns the most recent canonical reading for one vehicle and one
	// canonical kind (Q1 single-series tail), or (nil, nil) when the series has
	// no rows. Backed by idx_canonical_signal_vehicle_kind_observed_at.
	Latest(ctx context.Context, vehicleID int64, kind string) (*signal.CanonicalSignalRow, error)

	// Range returns the canonical readings for one vehicle and one canonical
	// kind whose ObservedAt falls within [from, to] (Q1 single-series window),
	// newest first. An empty window yields an empty, non-nil-error result.
	Range(ctx context.Context, vehicleID int64, kind string, from, to time.Time) ([]signal.CanonicalSignalRow, error)
}

// SignalStore is the unified two-layer port the Phase-5 writer implements and
// the read paths depend on. It composes the per-table ports so a consumer that
// only writes raw, or only reads canonical, can depend on the narrower
// interface (interface segregation) while the writer depends on the whole.
type SignalStore interface {
	RawSignalStore
	CanonicalSignalStore
}
