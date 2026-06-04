package energy

// EnergyStatsRow represents a single day of energy data from cagg_fleet_stats.
type EnergyStatsRow struct {
	Date             string  `json:"date"`
	EnergyWh         float64 `json:"energy_wh"`
	DistanceM        float64 `json:"distance_m"`
	EfficiencyWhPerM float64 `json:"efficiency_wh_per_m"`
	Cost             float64 `json:"cost"`
}
