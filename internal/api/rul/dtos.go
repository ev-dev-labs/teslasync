package rul

// DTOs and configuration types for the Remaining Useful Life endpoints. All
// JSON tags are snake_case to match the frontend wire contract; nullable Go
// pointers map to `T | null` in TypeScript. Numeric fields are rounded at the
// handler/pure-core boundary. SI-canonical: distance in km, time in days.

// ComponentConfig is one row of the seeded, admin-editable component_lifespans
// table (migration 000218). Nullable columns are pointers so an absent km life
// (calendar-wear part) or days life (distance-wear part) is distinguishable
// from a zero.
type ComponentConfig struct {
	Component       string
	NominalLifeKm   *float64
	NominalLifeDays *int
	EOLThreshold    *float64
	Notes           string
}

// ComponentRUL is the per-component prognosis returned by both endpoints.
//
//   - HealthPct        — the display health metric: % State of Health for the
//     HV battery, % of nominal life remaining for wear/age parts.
//   - WearRatePerDay   — decline in HealthPct per day (SoH %/day for the
//     battery, life %/day for wear/age parts).
//   - RemainingDays    — projected days until the EOL threshold. 0 when overdue;
//     a large sentinel when no measurable wear yet (see ProjectedEOLDate).
//   - RemainingKm      — projected km until EOL for distance-wear parts; null
//     for the battery and calendar-wear parts.
//   - ProjectedEOLDate — YYYY-MM-DD "replace-by" date; null when the rate is
//     indeterminate (sparse/flat data) so the UI shows "—" rather than a
//     fabricated date.
//   - Confidence       — 0..1 trust in the estimate.
//   - Status           — healthy | watch | replace_soon | overdue.
//   - Basis            — human-readable sentence explaining how it was derived.
type ComponentRUL struct {
	Component        string   `json:"component"`
	Label            string   `json:"label"`
	HealthPct        float64  `json:"health_pct"`
	WearRatePerDay   float64  `json:"wear_rate_per_day"`
	RemainingDays    float64  `json:"remaining_days"`
	RemainingKm      *float64 `json:"remaining_km"`
	ProjectedEOLDate *string  `json:"projected_eol_date"`
	Confidence       float64  `json:"confidence"`
	Status           string   `json:"status"`
	Basis            string   `json:"basis"`
}

// NextService is the single most-urgent upcoming replacement — the component
// with the nearest projected EOL date. Date is null when nothing is
// projectable.
type NextService struct {
	Component string  `json:"component"`
	Date      *string `json:"date"`
}

// RULResponse is the body of GET /api/v1/vehicles/{vehicleID}/rul. Components is
// always a non-nil slice (possibly empty) so the frontend never guards a null
// array; NextService is null when no component has a projectable EOL date.
type RULResponse struct {
	VehicleID   int64          `json:"vehicle_id"`
	Components  []ComponentRUL `json:"components"`
	NextService *NextService   `json:"next_service"`
}

// ComponentDetailResponse is the body of
// GET /api/v1/vehicles/{vehicleID}/rul/{component}: the component's prognosis
// (embedded, so its fields inline into the JSON object) plus the configured
// reference figures and a forecast series from today to the projected EOL for
// the chart.
type ComponentDetailResponse struct {
	ComponentRUL
	EOLThreshold    *float64          `json:"eol_threshold"`
	NominalLifeKm   *float64          `json:"nominal_life_km"`
	NominalLifeDays *int              `json:"nominal_life_days"`
	Notes           string            `json:"notes"`
	Projection      []ProjectionPoint `json:"projection"`
}
