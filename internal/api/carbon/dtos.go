package carbon

// DTOs for the Carbon Intelligence endpoints. All JSON tags are snake_case to
// match the frontend wire contract; numeric fields are rounded at the handler
// boundary. SI-canonical: energy in kWh, mass in kg, intensity in gCO2/kWh.

// IntensityCurveResponse is the body of GET /api/v1/carbon/intensity: the full
// 24-hour diurnal grid model plus its derived extremes. GreenestHours and
// DirtiestHours are always non-nil (possibly empty) slices so the frontend can
// highlight the cleanest/dirtiest bars without a null check.
type IntensityCurveResponse struct {
	Curve         []HourIntensity `json:"curve"`
	Min           float64         `json:"min"`
	Max           float64         `json:"max"`
	GreenestHours []int           `json:"greenest_hours"`
	DirtiestHours []int           `json:"dirtiest_hours"`
}

// MonthlyCO2 is one YYYY-MM row of the CO2 trend: the attributed CO2 (kg) and
// the energy (kWh) charged that month.
type MonthlyCO2 struct {
	Month     string  `json:"month"`
	CO2Kg     float64 `json:"co2_kg"`
	EnergyKwh float64 `json:"energy_kwh"`
}

// SummaryResponse is the body of GET /api/v1/vehicles/{vehicleID}/carbon/summary.
//
//   - TotalCO2Kg     — sum over sessions of energy_kwh * intensity(hour) / 1000.
//   - GasEquivCO2Kg  — distance-based ICE baseline (GasBaselineKgCO2PerKm).
//   - CO2SavedKg     — GasEquivCO2Kg - TotalCO2Kg (can be negative on a dirty grid).
//   - GreenScore     — 0..100 timing score (see GreenScore); 0 when nothing scored.
//   - Monthly        — always a non-nil slice, ascending by month.
type SummaryResponse struct {
	TotalEnergyKwh float64      `json:"total_energy_kwh"`
	TotalCO2Kg     float64      `json:"total_co2_kg"`
	GasEquivCO2Kg  float64      `json:"gas_equiv_co2_kg"`
	CO2SavedKg     float64      `json:"co2_saved_kg"`
	GreenScore     float64      `json:"green_score"`
	SessionsScored int          `json:"sessions_scored"`
	Monthly        []MonthlyCO2 `json:"monthly"`
}

// GreenestWindowDTO describes the recommended charging window. StartHour is
// inclusive, EndHour is exclusive (both 0..23, wrapping past midnight).
type GreenestWindowDTO struct {
	StartHour    int     `json:"start_hour"`
	EndHour      int     `json:"end_hour"`
	AvgIntensity float64 `json:"avg_intensity"`
}

// RecommendationResponse is the body of
// GET /api/v1/vehicles/{vehicleID}/carbon/recommendation: how the driver's
// realized charging intensity compares to shifting into the greenest window.
type RecommendationResponse struct {
	CurrentAvgIntensity  float64           `json:"current_avg_intensity"`
	GreenestWindow       GreenestWindowDTO `json:"greenest_window"`
	PotentialCO2SavingKg float64           `json:"potential_co2_saving_kg"`
	PotentialSavingPct   float64           `json:"potential_saving_pct"`
}
