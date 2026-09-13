package charging

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// AutopilotProfile is the persisted per-vehicle Smart Charging Autopilot
// configuration. ReadyBy is a daily wall-clock "HH:MM" time; the preview
// engine resolves it to the next future occurrence.
type AutopilotProfile struct {
	VehicleID          int64     `json:"vehicle_id" db:"vehicle_id"`
	Enabled            bool      `json:"enabled" db:"enabled"`
	TargetSOC          int       `json:"target_soc" db:"target_soc"`
	ReadyBy            string    `json:"ready_by" db:"ready_by"`
	RatePlan           string    `json:"rate_plan" db:"rate_plan"`
	DailyCapSOC        int       `json:"daily_cap_soc" db:"daily_cap_soc"`
	TripOverride       bool      `json:"trip_override" db:"trip_override"`
	Precondition       bool      `json:"precondition" db:"precondition"`
	MaxAmps            int       `json:"max_amps" db:"max_amps"`
	BatteryCapacityKWh float64   `json:"battery_capacity_kwh" db:"battery_capacity_kwh"`
	UpdatedAt          time.Time `json:"updated_at" db:"updated_at"`
}

// AutopilotProfileRepo provides data access for charge_autopilot_profiles.
type AutopilotProfileRepo struct {
	db *database.DB
}

// NewAutopilotProfileRepo creates a new AutopilotProfileRepo.
func NewAutopilotProfileRepo(db *database.DB) *AutopilotProfileRepo {
	return &AutopilotProfileRepo{db: db}
}

// GetByVehicle returns the profile for a vehicle, or nil when none exists.
func (r *AutopilotProfileRepo) GetByVehicle(ctx context.Context, vehicleID int64) (*AutopilotProfile, error) {
	p := &AutopilotProfile{}
	query := `
		SELECT vehicle_id, enabled, target_soc, ready_by, rate_plan,
		       daily_cap_soc, trip_override, precondition, max_amps,
		       battery_capacity_kwh, updated_at
		FROM charge_autopilot_profiles WHERE vehicle_id = $1`
	err := r.db.Pool.QueryRow(ctx, query, vehicleID).Scan(
		&p.VehicleID, &p.Enabled, &p.TargetSOC, &p.ReadyBy, &p.RatePlan,
		&p.DailyCapSOC, &p.TripOverride, &p.Precondition, &p.MaxAmps,
		&p.BatteryCapacityKWh, &p.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return p, nil
}

// Upsert creates or replaces the profile for a vehicle.
func (r *AutopilotProfileRepo) Upsert(ctx context.Context, p *AutopilotProfile) error {
	query := `
		INSERT INTO charge_autopilot_profiles (
			vehicle_id, enabled, target_soc, ready_by, rate_plan,
			daily_cap_soc, trip_override, precondition, max_amps,
			battery_capacity_kwh, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
		ON CONFLICT (vehicle_id) DO UPDATE SET
			enabled = EXCLUDED.enabled,
			target_soc = EXCLUDED.target_soc,
			ready_by = EXCLUDED.ready_by,
			rate_plan = EXCLUDED.rate_plan,
			daily_cap_soc = EXCLUDED.daily_cap_soc,
			trip_override = EXCLUDED.trip_override,
			precondition = EXCLUDED.precondition,
			max_amps = EXCLUDED.max_amps,
			battery_capacity_kwh = EXCLUDED.battery_capacity_kwh,
			updated_at = NOW()
		RETURNING updated_at`
	return r.db.Pool.QueryRow(ctx, query,
		p.VehicleID, p.Enabled, p.TargetSOC, p.ReadyBy, p.RatePlan,
		p.DailyCapSOC, p.TripOverride, p.Precondition, p.MaxAmps,
		p.BatteryCapacityKWh,
	).Scan(&p.UpdatedAt)
}

// SumAppliedSavings totals the savings recorded on applied/completed charge
// plans for a vehicle — the Autopilot savings ledger.
func (r *AutopilotProfileRepo) SumAppliedSavings(ctx context.Context, vehicleID int64) (total float64, runs int64, err error) {
	query := `
		SELECT COALESCE(SUM(savings), 0), COUNT(*)
		FROM charge_plans
		WHERE vehicle_id = $1 AND status IN ('applied', 'completed')`
	err = r.db.Pool.QueryRow(ctx, query, vehicleID).Scan(&total, &runs)
	return total, runs, err
}
