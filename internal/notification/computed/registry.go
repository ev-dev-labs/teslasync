package computed

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// MetricFn computes the metric value for one vehicle over [start, end).
// The window string is documented in MetricDef.Windows; implementations
// should treat unrecognized windows as a programming error.
type MetricFn func(ctx context.Context, db *database.DB, vehicleID int64, start, end time.Time) (float64, error)

// MetricDef is a single entry in the computed-metric registry.
type MetricDef struct {
	ID      string   // stable identifier persisted in alert_rules.metric_id
	Label   string   // human label for the rule builder UI
	Unit    string   // 'currency'|'kwh'|'mi'|'wh_per_mi'|'h'|'count'|'currency_per_mi'
	Windows []string // allowed values for alert_rules.metric_window
	Compute MetricFn
}

// MetricSummary is the wire shape returned by GET /alerts/metrics. The
// frontend uses it to build the Metric / Window / Operator dropdowns.
type MetricSummary struct {
	ID      string   `json:"id"`
	Label   string   `json:"label"`
	Unit    string   `json:"unit"`
	Windows []string `json:"windows"`
	Ops     []string `json:"ops"`
}

// ComputedMetricOps is the full operator set supported by the comparator.
// The %_change_ ops compare the current window to the previous
// (same-length) window.
var ComputedMetricOps = []string{">", ">=", "<", "<=", "=", "!=", "%_change_>", "%_change_<"}

// ComputedMetricWindows enumerates every window string accepted by
// alert_rules. Mirrors the CHECK constraint in migration 000158.
var ComputedMetricWindows = []string{"day", "week", "month", "rolling_7d", "rolling_30d"}

// ErrUnknownMetric is returned when a rule references a metric_id that
// is not in the registry — typically because a rule was migrated from an
// older version that knew about a metric we have since removed.
var ErrUnknownMetric = errors.New("unknown computed metric")

// ComputedMetrics is the registry of all available metrics. The keys
// must match alert_rules.metric_id values exactly.
var ComputedMetrics = map[string]MetricDef{
	"charging_cost": {
		ID:      "charging_cost",
		Label:   "Charging cost",
		Unit:    "currency",
		Windows: []string{"day", "week", "month", "rolling_7d", "rolling_30d"},
		Compute: chargingCost,
	},
	"distance": {
		ID:      "distance",
		Label:   "Distance driven",
		Unit:    "mi",
		Windows: []string{"day", "week", "month", "rolling_7d", "rolling_30d"},
		Compute: distanceDriven,
	},
	"energy_consumed": {
		ID:      "energy_consumed",
		Label:   "Energy consumed",
		Unit:    "kwh",
		Windows: []string{"day", "week", "month", "rolling_7d", "rolling_30d"},
		Compute: energyConsumed,
	},
	"energy_charged": {
		ID:      "energy_charged",
		Label:   "Energy charged",
		Unit:    "kwh",
		Windows: []string{"day", "week", "month", "rolling_7d", "rolling_30d"},
		Compute: energyCharged,
	},
	"avg_efficiency": {
		ID:      "avg_efficiency",
		Label:   "Average efficiency",
		Unit:    "wh_per_mi",
		Windows: []string{"day", "rolling_7d", "rolling_30d"},
		Compute: avgEfficiency,
	},
	"idle_time": {
		ID:      "idle_time",
		Label:   "Idle time",
		Unit:    "h",
		Windows: []string{"day", "week", "rolling_7d"},
		Compute: idleTime,
	},
	"drive_count": {
		ID:      "drive_count",
		Label:   "Number of drives",
		Unit:    "count",
		Windows: []string{"day", "week", "month"},
		Compute: driveCount,
	},
	"supercharger_sessions": {
		ID:      "supercharger_sessions",
		Label:   "Supercharger sessions",
		Unit:    "count",
		Windows: []string{"week", "month"},
		Compute: superchargerSessions,
	},
	"cost_per_mile": {
		ID:      "cost_per_mile",
		Label:   "Cost per mile",
		Unit:    "currency_per_mi",
		Windows: []string{"week", "month", "rolling_30d"},
		Compute: costPerMile,
	},
}

// ListMetricSummaries returns every registered metric as MetricSummary,
// sorted by ID for stable wire output.
func ListMetricSummaries() []MetricSummary {
	out := make([]MetricSummary, 0, len(ComputedMetrics))
	for _, m := range ComputedMetrics {
		out = append(out, MetricSummary{
			ID:      m.ID,
			Label:   m.Label,
			Unit:    m.Unit,
			Windows: append([]string(nil), m.Windows...),
			Ops:     append([]string(nil), ComputedMetricOps...),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// IsValidWindow returns true when window is in the metric's allowed set.
func (m MetricDef) IsValidWindow(window string) bool {
	for _, w := range m.Windows {
		if w == window {
			return true
		}
	}
	return false
}

// IsValidComputedMetricOp returns true when op is in ComputedMetricOps.
func IsValidComputedMetricOp(op string) bool {
	for _, candidate := range ComputedMetricOps {
		if candidate == op {
			return true
		}
	}
	return false
}

// ─── compute helpers ──────────────────────────────────────────────────────

// Aggregates below read from the SI-canonical drives and charging_sessions
// schemas introduced by migrations 000184 and 000185. SQL converts to the
// legacy display units expected by alert metrics (mi, kWh, minutes) so
// public metric values remain stable.

func chargingCost(ctx context.Context, db *database.DB, vehicleID int64, start, end time.Time) (float64, error) {
	var sum *float64
	err := db.Pool.QueryRow(ctx,
		`SELECT SUM(cost_decimal::float8) FROM charging_sessions
		 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3`,
		vehicleID, start, end).Scan(&sum)
	if err != nil {
		return 0, fmt.Errorf("charging_cost: %w", err)
	}
	if sum == nil {
		return 0, nil
	}
	return *sum, nil
}

func distanceDriven(ctx context.Context, db *database.DB, vehicleID int64, start, end time.Time) (float64, error) {
	var sum *float64
	err := db.Pool.QueryRow(ctx,
		`SELECT SUM(distance_m) / 1609.344 FROM drives
		 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3`,
		vehicleID, start, end).Scan(&sum)
	if err != nil {
		return 0, fmt.Errorf("distance: %w", err)
	}
	if sum == nil {
		return 0, nil
	}
	return *sum, nil
}

func energyConsumed(ctx context.Context, db *database.DB, vehicleID int64, start, end time.Time) (float64, error) {
	var sum *float64
	err := db.Pool.QueryRow(ctx,
		`SELECT SUM(energy_used_wh) / 1000.0 FROM drives
		 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3`,
		vehicleID, start, end).Scan(&sum)
	if err != nil {
		return 0, fmt.Errorf("energy_consumed: %w", err)
	}
	if sum == nil {
		return 0, nil
	}
	return *sum, nil
}

func energyCharged(ctx context.Context, db *database.DB, vehicleID int64, start, end time.Time) (float64, error) {
	var sum *float64
	err := db.Pool.QueryRow(ctx,
		`SELECT SUM(total_energy_added_wh) / 1000.0 FROM charging_sessions
		 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3`,
		vehicleID, start, end).Scan(&sum)
	if err != nil {
		return 0, fmt.Errorf("energy_charged: %w", err)
	}
	if sum == nil {
		return 0, nil
	}
	return *sum, nil
}

// avgEfficiency in Wh/mi = sum(energy_used_wh) / sum(distance_m) * 1609.344.
// Returns 0 when distance is 0 to avoid spurious "0 Wh/mi" alerts.
func avgEfficiency(ctx context.Context, db *database.DB, vehicleID int64, start, end time.Time) (float64, error) {
	var energyWh, distM *float64
	err := db.Pool.QueryRow(ctx,
		`SELECT SUM(energy_used_wh), SUM(distance_m) FROM drives
		 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3`,
		vehicleID, start, end).Scan(&energyWh, &distM)
	if err != nil {
		return 0, fmt.Errorf("avg_efficiency: %w", err)
	}
	if energyWh == nil || distM == nil || *distM <= 0 {
		return 0, nil
	}
	return (*energyWh * 1609.344) / *distM, nil
}

// idleTime in hours = window length - SUM(drive duration) - SUM(charging duration).
// Approximation; doesn't account for sessions overlapping the window boundary.
func idleTime(ctx context.Context, db *database.DB, vehicleID int64, start, end time.Time) (float64, error) {
	var driveMin, chargeMin *float64
	if err := db.Pool.QueryRow(ctx,
		`SELECT SUM(duration_s) / 60.0 FROM drives
		 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3`,
		vehicleID, start, end).Scan(&driveMin); err != nil {
		return 0, fmt.Errorf("idle_time drives: %w", err)
	}
	if err := db.Pool.QueryRow(ctx,
		`SELECT SUM(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60.0)
		   FROM charging_sessions
		  WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3
		    AND ended_at IS NOT NULL`,
		vehicleID, start, end).Scan(&chargeMin); err != nil {
		return 0, fmt.Errorf("idle_time charging: %w", err)
	}
	totalHours := end.Sub(start).Hours()
	used := 0.0
	if driveMin != nil {
		used += *driveMin / 60.0
	}
	if chargeMin != nil {
		used += *chargeMin / 60.0
	}
	idle := totalHours - used
	if idle < 0 {
		idle = 0
	}
	return idle, nil
}

func driveCount(ctx context.Context, db *database.DB, vehicleID int64, start, end time.Time) (float64, error) {
	var count int64
	err := db.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM drives
		 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3`,
		vehicleID, start, end).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("drive_count: %w", err)
	}
	return float64(count), nil
}

func superchargerSessions(ctx context.Context, db *database.DB, vehicleID int64, start, end time.Time) (float64, error) {
	var count int64
	err := db.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM charging_sessions
		 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3
		   AND charger_type = 'Supercharger'`,
		vehicleID, start, end).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("supercharger_sessions: %w", err)
	}
	return float64(count), nil
}

func costPerMile(ctx context.Context, db *database.DB, vehicleID int64, start, end time.Time) (float64, error) {
	var cost, dist *float64
	if err := db.Pool.QueryRow(ctx,
		`SELECT SUM(cost_decimal::float8) FROM charging_sessions
		 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3`,
		vehicleID, start, end).Scan(&cost); err != nil {
		return 0, fmt.Errorf("cost_per_mile cost: %w", err)
	}
	if err := db.Pool.QueryRow(ctx,
		`SELECT SUM(distance_m) / 1609.344 FROM drives
		 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3`,
		vehicleID, start, end).Scan(&dist); err != nil {
		return 0, fmt.Errorf("cost_per_mile distance: %w", err)
	}
	if cost == nil || dist == nil || *dist <= 0 {
		return 0, nil
	}
	return *cost / *dist, nil
}
