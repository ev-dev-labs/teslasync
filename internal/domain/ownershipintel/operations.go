package ownershipintel

import "time"

// ---------------------------------------------------------------------------
// 4. Driver fingerprinting and attribution
// ---------------------------------------------------------------------------

// DriverProfile is a named identity that drives can be attributed to.
type DriverProfile struct {
	ID        int64     `json:"id"`
	VehicleID int64     `json:"vehicle_id"`
	Name      string    `json:"name"`
	Accent    string    `json:"accent"`
	IsPrimary bool      `json:"is_primary"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// CreateDriverProfileRequest registers a named driver.
type CreateDriverProfileRequest struct {
	VehicleID int64  `json:"vehicle_id"`
	Name      string `json:"name"`
	Accent    string `json:"accent"`
	IsPrimary bool   `json:"is_primary"`
}

// AssignDriveRequest is a manual attribution that also supervises clustering.
type AssignDriveRequest struct {
	DriveID         int64 `json:"drive_id"`
	DriverProfileID int64 `json:"driver_profile_id"`
	Confirmed       bool  `json:"confirmed"`
}

// FingerprintFeature is one normalised behavioural dimension.
type FingerprintFeature struct {
	Code       string  `json:"code"`
	Label      string  `json:"label"`
	RawValue   float64 `json:"raw_value"`
	SIUnit     string  `json:"si_unit"`
	Normalised float64 `json:"normalised"`
	Weight     float64 `json:"weight"`
}

// DriveFingerprint is one drive reduced to a behavioural vector plus verdict.
type DriveFingerprint struct {
	DriveID         int64                `json:"drive_id"`
	StartedAt       time.Time            `json:"started_at"`
	DistanceM       float64              `json:"distance_m"`
	DurationS       int64                `json:"duration_s"`
	Features        []FingerprintFeature `json:"features"`
	ClusterID       int                  `json:"cluster_id"`
	DriverProfileID *int64               `json:"driver_profile_id"`
	DriverName      *string              `json:"driver_name"`
	Source          string               `json:"source"`
	ConfidencePct   float64              `json:"confidence_pct"`
	DistanceToOwn   float64              `json:"distance_to_own_centroid"`
	DistanceToNext  *float64             `json:"distance_to_next_centroid"`
	Ambiguous       bool                 `json:"ambiguous"`
}

// DriverCluster summarises one behavioural group.
type DriverCluster struct {
	ClusterID        int                  `json:"cluster_id"`
	DriverProfileID  *int64               `json:"driver_profile_id"`
	DriverName       *string              `json:"driver_name"`
	Accent           string               `json:"accent"`
	DriveCount       int                  `json:"drive_count"`
	SharePct         float64              `json:"share_pct"`
	DistanceM        float64              `json:"distance_m"`
	DurationS        int64                `json:"duration_s"`
	EnergyWh         float64              `json:"energy_wh"`
	EfficiencyWhPerM *float64             `json:"efficiency_wh_per_m"`
	AvgSpeedMps      *float64             `json:"avg_speed_mps"`
	PeakPowerW       *float64             `json:"peak_power_w"`
	RegenSharePct    *float64             `json:"regen_share_pct"`
	NightSharePct    float64              `json:"night_share_pct"`
	AggressionScore  float64              `json:"aggression_score"`
	CostShareMinor   *int64               `json:"cost_share_minor"`
	Centroid         []FingerprintFeature `json:"centroid"`
	Cohesion         float64              `json:"cohesion"`
	LabelledCount    int                  `json:"labelled_count"`
}

// DriverAttributionReport is the complete attribution answer.
type DriverAttributionReport struct {
	VehicleID          int64              `json:"vehicle_id"`
	Window             Window             `json:"window"`
	Profiles           []DriverProfile    `json:"profiles"`
	Clusters           []DriverCluster    `json:"clusters"`
	Fingerprints       []DriveFingerprint `json:"fingerprints"`
	Total              int                `json:"total"`
	Limit              int                `json:"limit"`
	Offset             int                `json:"offset"`
	SeparationScore    *float64           `json:"separation_score"`
	SeparationVerdict  string             `json:"separation_verdict"`
	LabelledDriveCount int                `json:"labelled_drive_count"`
	InferredCount      int                `json:"inferred_drive_count"`
	AmbiguousCount     int                `json:"ambiguous_drive_count"`
	Currency           string             `json:"currency"`
	Quality            DataQuality        `json:"quality"`
	Evidence           []Evidence         `json:"evidence"`
}

// ---------------------------------------------------------------------------
// 8. Jurisdictional compliance and road-usage charge
// ---------------------------------------------------------------------------

// JurisdictionRate is a bounding-box taxing authority with its rates.
type JurisdictionRate struct {
	ID                   int64     `json:"id"`
	JurisdictionCode     string    `json:"jurisdiction_code"`
	Label                string    `json:"label"`
	Currency             string    `json:"currency"`
	RoadUsageMinorPerM   float64   `json:"road_usage_minor_per_m"`
	RegistrationFeeMinor int64     `json:"registration_fee_minor"`
	GridIntensityGPerWh  float64   `json:"grid_intensity_g_per_wh"`
	MinLat               float64   `json:"min_lat"`
	MaxLat               float64   `json:"max_lat"`
	MinLng               float64   `json:"min_lng"`
	MaxLng               float64   `json:"max_lng"`
	Version              int       `json:"version"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

// CreateJurisdictionRateRequest registers a taxing authority.
type CreateJurisdictionRateRequest struct {
	JurisdictionCode     string  `json:"jurisdiction_code"`
	Label                string  `json:"label"`
	Currency             string  `json:"currency"`
	RoadUsageMinorPerM   float64 `json:"road_usage_minor_per_m"`
	RegistrationFeeMinor int64   `json:"registration_fee_minor"`
	GridIntensityGPerWh  float64 `json:"grid_intensity_g_per_wh"`
	MinLat               float64 `json:"min_lat"`
	MaxLat               float64 `json:"max_lat"`
	MinLng               float64 `json:"min_lng"`
	MaxLng               float64 `json:"max_lng"`
}

// JurisdictionApportionment is one authority's share of distance and energy.
type JurisdictionApportionment struct {
	JurisdictionCode   string   `json:"jurisdiction_code"`
	Label              string   `json:"label"`
	Currency           string   `json:"currency"`
	DistanceM          float64  `json:"distance_m"`
	DistanceSharePct   float64  `json:"distance_share_pct"`
	EnergyWh           float64  `json:"energy_wh"`
	DriveCount         int      `json:"drive_count"`
	RoadUsageChargeMin int64    `json:"road_usage_charge_minor"`
	RegistrationMinor  int64    `json:"registration_fee_minor"`
	TotalLiabilityMin  int64    `json:"total_liability_minor"`
	EmissionsG         float64  `json:"emissions_g"`
	EmissionsGPerM     *float64 `json:"emissions_g_per_m"`
	Confidence         float64  `json:"confidence_pct"`
}

// ComplianceApportionment is the apportionment answer for a filing period.
type ComplianceApportionment struct {
	VehicleID              int64                       `json:"vehicle_id"`
	Window                 Window                      `json:"window"`
	Currency               string                      `json:"currency"`
	Jurisdictions          []JurisdictionApportionment `json:"jurisdictions"`
	TotalDistanceM         float64                     `json:"total_distance_m"`
	TotalEnergyWh          float64                     `json:"total_energy_wh"`
	AssignedDistanceM      float64                     `json:"assigned_distance_m"`
	UnassignedDistanceM    float64                     `json:"unassigned_distance_m"`
	UnassignedSharePct     float64                     `json:"unassigned_share_pct"`
	TotalRoadUsageMinor    int64                       `json:"total_road_usage_charge_minor"`
	TotalRegistrationMinor int64                       `json:"total_registration_fee_minor"`
	TotalLiabilityMinor    int64                       `json:"total_liability_minor"`
	TotalEmissionsG        float64                     `json:"total_emissions_g"`
	DriveCount             int                         `json:"drive_count"`
	Digest                 string                      `json:"digest"`
	Quality                DataQuality                 `json:"quality"`
	Evidence               []Evidence                  `json:"evidence"`
}

// ComplianceFiling is an immutable snapshot of an apportionment period.
type ComplianceFiling struct {
	ID               int64      `json:"id"`
	VehicleID        int64      `json:"vehicle_id"`
	PeriodStart      time.Time  `json:"period_start"`
	PeriodEnd        time.Time  `json:"period_end"`
	Status           string     `json:"status"`
	TotalDistanceM   float64    `json:"total_distance_m"`
	TotalEnergyWh    float64    `json:"total_energy_wh"`
	TotalChargeMinor int64      `json:"total_charge_minor"`
	Currency         string     `json:"currency"`
	Digest           string     `json:"digest"`
	FiledAt          *time.Time `json:"filed_at"`
	CreatedAt        time.Time  `json:"created_at"`
}

// CreateFilingRequest freezes an apportionment window into a filing.
type CreateFilingRequest struct {
	VehicleID   int64     `json:"vehicle_id"`
	PeriodStart time.Time `json:"period_start"`
	PeriodEnd   time.Time `json:"period_end"`
	Confirmed   bool      `json:"confirmed"`
}

// ---------------------------------------------------------------------------
// 9. Consumables and wear parts
// ---------------------------------------------------------------------------

// ConsumableCategory enumerates the supported wear-part families.
type ConsumableCategory string

const (
	ConsumableTire        ConsumableCategory = "tire"
	ConsumableCabinFilter ConsumableCategory = "cabin_filter"
	ConsumableHEPAFilter  ConsumableCategory = "hepa_filter"
	ConsumableWiper       ConsumableCategory = "wiper"
	ConsumableBrakeFluid  ConsumableCategory = "brake_fluid"
	ConsumableCoolant     ConsumableCategory = "coolant"
	ConsumableBrakePad    ConsumableCategory = "brake_pad"
	ConsumableSuspension  ConsumableCategory = "suspension"
	ConsumableKeyBattery  ConsumableCategory = "key_battery"
	ConsumableOther       ConsumableCategory = "other"
)

// ConsumableItem is a stored wear part with its rated life.
type ConsumableItem struct {
	ID                 int64              `json:"id"`
	VehicleID          int64              `json:"vehicle_id"`
	Category           ConsumableCategory `json:"category"`
	Label              string             `json:"label"`
	Position           string             `json:"position"`
	InstalledAt        time.Time          `json:"installed_at"`
	InstalledOdometerM float64            `json:"installed_odometer_m"`
	RatedLifeM         *float64           `json:"rated_life_m"`
	RatedLifeS         *int64             `json:"rated_life_s"`
	CostMinor          int64              `json:"cost_minor"`
	Currency           string             `json:"currency"`
	RetiredAt          *time.Time         `json:"retired_at"`
	Notes              string             `json:"notes"`
	Version            int                `json:"version"`
	CreatedAt          time.Time          `json:"created_at"`
	UpdatedAt          time.Time          `json:"updated_at"`
}

// CreateConsumableItemRequest registers a wear part.
type CreateConsumableItemRequest struct {
	VehicleID          int64              `json:"vehicle_id"`
	Category           ConsumableCategory `json:"category"`
	Label              string             `json:"label"`
	Position           string             `json:"position"`
	InstalledAt        time.Time          `json:"installed_at"`
	InstalledOdometerM float64            `json:"installed_odometer_m"`
	RatedLifeM         *float64           `json:"rated_life_m"`
	RatedLifeS         *int64             `json:"rated_life_s"`
	CostMinor          int64              `json:"cost_minor"`
	Currency           string             `json:"currency"`
	Notes              string             `json:"notes"`
}

// ConsumableEventKind is the type of maintenance touchpoint logged against a
// wear part. The values mirror the consumable_events_kind_check constraint.
type ConsumableEventKind string

const (
	ConsumableInspect ConsumableEventKind = "inspect"
	ConsumableRotate  ConsumableEventKind = "rotate"
	ConsumableService ConsumableEventKind = "service"
	ConsumableReplace ConsumableEventKind = "replace"
	ConsumableNote    ConsumableEventKind = "note"
)

// ConsumableEvent is a maintenance touchpoint against a wear part.
type ConsumableEvent struct {
	ID         int64               `json:"id"`
	ItemID     int64               `json:"item_id"`
	Kind       ConsumableEventKind `json:"kind"`
	OccurredAt time.Time           `json:"occurred_at"`
	OdometerM  *float64            `json:"odometer_m"`
	CostMinor  int64               `json:"cost_minor"`
	Note       string              `json:"note"`
	CreatedAt  time.Time           `json:"created_at"`
}

// CreateConsumableEventRequest logs a maintenance touchpoint.
type CreateConsumableEventRequest struct {
	ItemID     int64               `json:"item_id"`
	Kind       ConsumableEventKind `json:"kind"`
	OccurredAt time.Time           `json:"occurred_at"`
	OdometerM  *float64            `json:"odometer_m"`
	CostMinor  int64               `json:"cost_minor"`
	Note       string              `json:"note"`
}

// DutyCycleStress explains why a part is wearing faster or slower than rated.
type DutyCycleStress struct {
	Code        string  `json:"code"`
	Label       string  `json:"label"`
	Multiplier  float64 `json:"multiplier"`
	ObservedVal float64 `json:"observed_value"`
	BaselineVal float64 `json:"baseline_value"`
	SIUnit      string  `json:"si_unit"`
	Narrative   string  `json:"narrative"`
}

// ConsumableLifecycle projects the remaining life of one wear part.
type ConsumableLifecycle struct {
	Item                ConsumableItem    `json:"item"`
	Events              []ConsumableEvent `json:"events"`
	DistanceUsedM       float64           `json:"distance_used_m"`
	DurationUsedS       int64             `json:"duration_used_s"`
	DistanceLifeUsedPct *float64          `json:"distance_life_used_pct"`
	TimeLifeUsedPct     *float64          `json:"time_life_used_pct"`
	StressMultiplier    float64           `json:"stress_multiplier"`
	StressFactors       []DutyCycleStress `json:"stress_factors"`
	AdjustedLifeM       *float64          `json:"adjusted_life_m"`
	RemainingM          *float64          `json:"remaining_m"`
	RemainingS          *int64            `json:"remaining_s"`
	HealthPct           float64           `json:"health_pct"`
	ProjectedReplaceAt  *time.Time        `json:"projected_replace_at"`
	BindingLimit        string            `json:"binding_limit"`
	CostPerMMinor       *float64          `json:"cost_per_m_minor"`
	ReplacementCostMin  int64             `json:"replacement_cost_minor"`
	Status              string            `json:"status"`
	Narrative           string            `json:"narrative"`
}

// ConsumablesReport is the whole wear-part portfolio for a vehicle.
type ConsumablesReport struct {
	VehicleID          int64                 `json:"vehicle_id"`
	AsOf               time.Time             `json:"as_of"`
	OdometerM          *float64              `json:"odometer_m"`
	Currency           string                `json:"currency"`
	Items              []ConsumableLifecycle `json:"items"`
	DueSoonCount       int                   `json:"due_soon_count"`
	OverdueCount       int                   `json:"overdue_count"`
	NextReplaceAt      *time.Time            `json:"next_replace_at"`
	TwelveMonthCostMin int64                 `json:"twelve_month_cost_minor"`
	LifetimeSpendMinor int64                 `json:"lifetime_spend_minor"`
	BlendedCostPerMMin *float64              `json:"blended_cost_per_m_minor"`
	FleetStressAverage float64               `json:"fleet_stress_average"`
	Quality            DataQuality           `json:"quality"`
	Evidence           []Evidence            `json:"evidence"`
}
