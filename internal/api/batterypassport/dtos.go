package batterypassport

// DTOs for the Battery Passport endpoints. All JSON tags are snake_case to
// match the frontend wire contract; numeric fields are rounded at the
// handler boundary before both the JSON body and the provenance hash are
// derived from them, so the hash reproduces the displayed facts exactly.

// ThermalExposure is the share of drives whose ambient temperature fell in
// each band, expressed as a percentage (0..100). The three bands sum to 100
// when at least one drive carried an ambient reading; otherwise all are 0.
type ThermalExposure struct {
	ColdPct    float64 `json:"cold_pct"`
	NominalPct float64 `json:"nominal_pct"`
	HotPct     float64 `json:"hot_pct"`
}

// TrendPoint is one day of the State-of-Health degradation trend. Date is a
// YYYY-MM-DD calendar day (UTC); SohPct is the estimated pack SoH for that
// day (0..100).
type TrendPoint struct {
	Date   string  `json:"date"`
	SohPct float64 `json:"soh_pct"`
}

// Passport is the complete Battery Passport certificate payload.
//
// FirstObservedAt is a nullable RFC 3339 timestamp — a vehicle with no
// drives and no charging sessions yet has no first-observed instant, so the
// frontend must render its "issued/observed" header null-safely.
type Passport struct {
	VehicleID            int64           `json:"vehicle_id"`
	VinMasked            string          `json:"vin_masked"`
	IssuedAt             string          `json:"issued_at"`
	FirstObservedAt      *string         `json:"first_observed_at"`
	SohPct               float64         `json:"soh_pct"`
	CapacityKwh          float64         `json:"capacity_kwh"`
	OriginalCapacityKwh  float64         `json:"original_capacity_kwh"`
	EquivalentFullCycles float64         `json:"equivalent_full_cycles"`
	FastChargeRatio      float64         `json:"fast_charge_ratio"`
	AvgChargeLimitPct    float64         `json:"avg_charge_limit_pct"`
	ThermalExposure      ThermalExposure `json:"thermal_exposure"`
	HealthGrade          string          `json:"health_grade"`
	DegradationTrend     []TrendPoint    `json:"degradation_trend"`
	Recommendations      []string        `json:"recommendations"`
	ProvenanceHash       string          `json:"provenance_hash"`
}

// VerifyResponse is the tamper-evidence result: Valid is true when the
// caller-supplied hash matches the freshly recomputed ExpectedHash.
type VerifyResponse struct {
	Valid        bool   `json:"valid"`
	ExpectedHash string `json:"expected_hash"`
	ProvidedHash string `json:"provided_hash"`
}
