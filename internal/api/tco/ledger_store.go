package tco

import (
	"context"
	"sync"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// LedgerStore persists fixed-cost entries per vehicle.
type LedgerStore interface {
	List(ctx context.Context, vehicleID int64) ([]LedgerEntry, error)
	Create(ctx context.Context, e *LedgerEntry) error
	Delete(ctx context.Context, vehicleID, id int64) (bool, error)
}

// pgLedgerStore is the postgres-backed LedgerStore.
type pgLedgerStore struct {
	db *database.DB
}

// NewPGLedgerStore wires the store. Panics on nil (fail-fast wiring).
func NewPGLedgerStore(db *database.DB) LedgerStore {
	if db == nil {
		panic("tco: nil database")
	}
	return &pgLedgerStore{db: db}
}

func (s *pgLedgerStore) List(ctx context.Context, vehicleID int64) ([]LedgerEntry, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT id, vehicle_id, category, amount, currency,
		       to_char(incurred_on, 'YYYY-MM-DD'), note,
		       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM tco_ledger_entries
		WHERE vehicle_id = $1
		ORDER BY incurred_on DESC, id DESC`, vehicleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LedgerEntry{}
	for rows.Next() {
		var e LedgerEntry
		if err := rows.Scan(&e.ID, &e.VehicleID, &e.Category, &e.Amount,
			&e.Currency, &e.Incurred, &e.Note, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *pgLedgerStore) Create(ctx context.Context, e *LedgerEntry) error {
	return s.db.Pool.QueryRow(ctx, `
		INSERT INTO tco_ledger_entries (vehicle_id, category, amount, currency, incurred_on, note)
		VALUES ($1, $2, $3, $4, $5::date, $6)
		RETURNING id, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
		e.VehicleID, e.Category, e.Amount, e.Currency, e.Incurred, e.Note,
	).Scan(&e.ID, &e.CreatedAt)
}

func (s *pgLedgerStore) Delete(ctx context.Context, vehicleID, id int64) (bool, error) {
	tag, err := s.db.Pool.Exec(ctx,
		`DELETE FROM tco_ledger_entries WHERE vehicle_id = $1 AND id = $2`,
		vehicleID, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// MemoryLedgerStore is an in-memory LedgerStore for tests.
type MemoryLedgerStore struct {
	mu      sync.Mutex
	next    int64
	entries map[int64][]LedgerEntry
}

// NewMemoryLedgerStore creates an empty MemoryLedgerStore.
func NewMemoryLedgerStore() *MemoryLedgerStore {
	return &MemoryLedgerStore{entries: map[int64][]LedgerEntry{}}
}

func (s *MemoryLedgerStore) List(_ context.Context, vehicleID int64) ([]LedgerEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := append([]LedgerEntry{}, s.entries[vehicleID]...)
	return out, nil
}

func (s *MemoryLedgerStore) Create(_ context.Context, e *LedgerEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.next++
	e.ID = s.next
	s.entries[e.VehicleID] = append(s.entries[e.VehicleID], *e)
	return nil
}

func (s *MemoryLedgerStore) Delete(_ context.Context, vehicleID, id int64) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := s.entries[vehicleID][:0]
	found := false
	for _, e := range s.entries[vehicleID] {
		if e.ID == id {
			found = true
			continue
		}
		kept = append(kept, e)
	}
	s.entries[vehicleID] = kept
	return found, nil
}
