package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
	"github.com/ev-dev-labs/teslasync/internal/domain/signal"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

// rawSignalStore is the TimescaleDB-backed adapter for the append-only
// provider-native system of record (raw_signal, migration 000214). It is the
// ONLY place framework/driver types (pgx) appear for this port (H31): the
// repository.RawSignalStore contract and the signal.RawSignalRow DTO it
// exchanges stay pure-domain.
type rawSignalStore struct {
	pool *pgxpool.Pool
}

// Compile-time assertion that *rawSignalStore satisfies the Contract C write
// port. A signature drift in the port fails the build here rather than at the
// first wiring call site.
var _ repository.RawSignalStore = (*rawSignalStore)(nil)

// NewRawSignalStore constructs the production raw-layer writer. A nil pool is a
// wiring bug and panics at process start so the failure surfaces before any
// reading is processed, matching the house pattern of the Tesla pipeline
// writers.
func NewRawSignalStore(pool *pgxpool.Pool) repository.RawSignalStore {
	if pool == nil {
		panic("NewRawSignalStore: pool must be non-nil")
	}
	return &rawSignalStore{pool: pool}
}

// AppendRaw appends provider-native readings to raw_signal.
//
// H17 (append-only) / H24 (idempotent): each row is issued as
// queries.AppendRawSignal — an INSERT ... ON CONFLICT
// (vehicle_id, observed_at, provider_kind) DO NOTHING — so a re-delivered
// reading collapses onto the row already on disk and an existing row is never
// mutated. H13: raw_value is bound verbatim as opaque text; the adapter never
// coerces it to a number.
//
// The whole call is atomic: every row is queued into one pgx.Batch and run
// inside a single transaction, so AppendRaw either persists all of its
// (non-duplicate) rows or none. Running the rows as separate sequential
// statements within that transaction also means an intra-batch duplicate key
// collapses onto the row inserted by the earlier statement (the in-transaction
// uniqueness arbiter sees the not-yet-committed sibling), so a payload that
// repeats a key is handled by the same DO NOTHING path as a cross-delivery
// duplicate.
//
// An empty slice is a no-op and not an error.
func (s *rawSignalStore) AppendRaw(ctx context.Context, rows []signal.RawSignalRow) error {
	if len(rows) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for i := range rows {
		r := rows[i]
		// value_type and privacy_class are SMALLINT on disk; the domain
		// discriminators are int16-based, so bind their underlying width.
		// created_at is omitted so the table's DEFAULT now() stamps it.
		batch.Queue(
			queries.AppendRawSignal,
			r.VehicleID,
			r.ObservedAt,
			r.ProviderKind,
			int16(r.ValueType),
			r.RawValue,
			r.Brand,
			int16(r.PrivacyClass),
		)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("beginning raw_signal append tx: %w", err)
	}

	br := tx.SendBatch(ctx, batch)

	// Drain every queued result before closing — pgx requires the batch
	// results to be fully consumed and Closed, and an error on one statement
	// aborts the surrounding transaction so later Exec calls may return the
	// abort error. Keep the first real error and keep draining so Close does
	// not leave the connection in a poisoned state.
	var execErr error
	for i := range rows {
		if _, err := br.Exec(); err != nil && execErr == nil {
			execErr = fmt.Errorf("appending raw_signal row %d: %w", i, err)
		}
	}
	if closeErr := br.Close(); closeErr != nil && execErr == nil {
		execErr = fmt.Errorf("closing raw_signal batch: %w", closeErr)
	}

	if execErr != nil {
		if rbErr := tx.Rollback(ctx); rbErr != nil {
			return fmt.Errorf("%w (rollback: %v)", execErr, rbErr)
		}
		return execErr
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("committing raw_signal append: %w", err)
	}
	return nil
}
