package chargeautopilot

import (
	"context"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
)

// ProfileStore persists Autopilot profiles per vehicle.
type ProfileStore interface {
	Get(ctx context.Context, vehicleID int64) (*Profile, error)
	Upsert(ctx context.Context, p *Profile) error
}

// SavingsReader totals realized savings from applied charge plans.
type SavingsReader interface {
	TotalSavings(ctx context.Context, vehicleID int64) (total float64, runs int64, err error)
}

// pgProfileStore is the postgres-backed ProfileStore.
type pgProfileStore struct {
	repo *chargingdb.AutopilotProfileRepo
}

// NewPGProfileStore wires the store to a database handle. Panics on nil,
// matching the fail-fast wiring contract of sibling handlers.
func NewPGProfileStore(db *database.DB) ProfileStore {
	if db == nil {
		panic("chargeautopilot: nil database")
	}
	return &pgProfileStore{repo: chargingdb.NewAutopilotProfileRepo(db)}
}

func (s *pgProfileStore) Get(ctx context.Context, vehicleID int64) (*Profile, error) {
	p, err := s.repo.GetByVehicle(ctx, vehicleID)
	if err != nil {
		if err == pgx.ErrNoRows {
			d := DefaultProfile(vehicleID)
			return &d, nil
		}
		return nil, err
	}
	return &Profile{
		VehicleID:          p.VehicleID,
		Enabled:            p.Enabled,
		TargetSOC:          p.TargetSOC,
		ReadyBy:            p.ReadyBy,
		RatePlan:           p.RatePlan,
		DailyCapSOC:        p.DailyCapSOC,
		TripOverride:       p.TripOverride,
		Precondition:       p.Precondition,
		MaxAmps:            p.MaxAmps,
		BatteryCapacityKWh: p.BatteryCapacityKWh,
	}, nil
}

func (s *pgProfileStore) Upsert(ctx context.Context, p *Profile) error {
	return s.repo.Upsert(ctx, &chargingdb.AutopilotProfile{
		VehicleID:          p.VehicleID,
		Enabled:            p.Enabled,
		TargetSOC:          p.TargetSOC,
		ReadyBy:            p.ReadyBy,
		RatePlan:           p.RatePlan,
		DailyCapSOC:        p.DailyCapSOC,
		TripOverride:       p.TripOverride,
		Precondition:       p.Precondition,
		MaxAmps:            p.MaxAmps,
		BatteryCapacityKWh: p.BatteryCapacityKWh,
		UpdatedAt:          time.Now(),
	})
}

// pgSavingsReader sums realized savings from applied/completed plans.
type pgSavingsReader struct {
	repo *chargingdb.AutopilotProfileRepo
}

// NewPGSavingsReader wires the ledger to a database handle.
func NewPGSavingsReader(db *database.DB) SavingsReader {
	if db == nil {
		panic("chargeautopilot: nil database")
	}
	return &pgSavingsReader{repo: chargingdb.NewAutopilotProfileRepo(db)}
}

func (s *pgSavingsReader) TotalSavings(ctx context.Context, vehicleID int64) (float64, int64, error) {
	return s.repo.SumAppliedSavings(ctx, vehicleID)
}

// MemoryProfileStore is an in-memory ProfileStore for tests and
// environments without a migrated database.
type MemoryProfileStore struct {
	mu       sync.RWMutex
	profiles map[int64]Profile
}

// NewMemoryProfileStore creates an empty MemoryProfileStore.
func NewMemoryProfileStore() *MemoryProfileStore {
	return &MemoryProfileStore{profiles: map[int64]Profile{}}
}

func (s *MemoryProfileStore) Get(_ context.Context, vehicleID int64) (*Profile, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if p, ok := s.profiles[vehicleID]; ok {
		cp := p
		return &cp, nil
	}
	d := DefaultProfile(vehicleID)
	return &d, nil
}

func (s *MemoryProfileStore) Upsert(_ context.Context, p *Profile) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.profiles[p.VehicleID] = *p
	return nil
}
