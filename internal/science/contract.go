package science

import "time"

// Honesty strings. Wording complements internal/api/teslaphysics constants
// for the same phenomena; this package never contradicts them.
const (
	ElectrochemHonesty = "Rest-end voltage is an OCV proxy, not demonstrated equilibrium. Timestamp-aligned current steps estimate apparent pack resistance, not isolated ohmic or cell resistance. No plating or inventory claims. Regression intervals assume independent Gaussian errors and are not causal guarantees."
	ThermalHonesty     = "Cabin and pack as lumped heat capacities: time constant tau, predicted-vs-measured residual. Solar stays unknown without irradiance."
	WeatherHonesty     = "Drive residual vs weather is correlation at the drive start location, never proof that wind caused the watt-hours."
	TireHonesty        = "TPMS pressures as recorded, per corner. Underinflation energy is a labeled model with uncertainty. No invented yaw, slip, or ESP."
	NotebookHonesty    = "Generated report of attempted analyses, not a persisted experiment notebook. Missing confidence intervals, holdouts and residuals stay unknown; descriptive rows are not validated causal fits."
	AgingHonesty       = "Throughput and rest exposure are descriptive, not an identified cycle/calendar aging split. The capacity-proxy trend is observational; equivalent cycles use an explicitly assumed reference capacity."
	ArrheniusHonesty   = "ln(IR) vs 1/T with a labeled activation energy. Fewer than 3 temp bins spanning 10 C is unknown, not a two-point line."
)

// NotebookEntry is one statistical lab-notebook row. Every fit in every
// domain produces one; the notebook endpoint aggregates them.
type NotebookEntry struct {
	ID            string         `json:"id"`
	Domain        string         `json:"domain"`
	Hypothesis    string         `json:"hypothesis"`
	VehicleID     int64          `json:"vehicle_id"`
	VIN           string         `json:"vin,omitempty"`
	Start         time.Time      `json:"start"`
	End           time.Time      `json:"end"`
	FirmwareEpoch string         `json:"firmware_epoch"`
	N             int            `json:"n"`
	Method        string         `json:"method"`
	Parameters    map[string]any `json:"parameters,omitempty"`
	CI            map[string]any `json:"ci,omitempty"`
	CIMethod      string         `json:"ci_method"`
	HoldoutFrac   *float64       `json:"holdout_frac"`
	HoldoutRMSE   *float64       `json:"holdout_rmse"`
	ResidualMean  *float64       `json:"residual_mean"`
	ResidualRMSE  *float64       `json:"residual_rmse"`
	SignalsUsed   []string       `json:"signals_used"`
	Missing       []string       `json:"missing_signals,omitempty"`
	Unknown       bool           `json:"unknown"`
	Honesty       string         `json:"honesty"`
}

// OCVPoint is one rest-window observation of pack open-circuit voltage.
type OCVPoint struct {
	At            time.Time `json:"at"`
	OCVPackV      float64   `json:"ocv_pack_v"`
	SocPct        float64   `json:"soc_pct"`
	TempC         *float64  `json:"temp_c"`
	Direction     string    `json:"direction"` // charge_rest | discharge_rest | undetermined
	DwellS        float64   `json:"dwell_s"`
	EnergyWh      *float64  `json:"energy_wh"`
	BrickSpreadMV *float64  `json:"brick_spread_mv"`
}

// OCVBin is one SOC×temp cell of the OCV(SOC) surface.
type OCVBin struct {
	SocLoPct     float64  `json:"soc_lo_pct"`
	SocHiPct     float64  `json:"soc_hi_pct"`
	TempLoC      float64  `json:"temp_lo_c"`
	TempHiC      float64  `json:"temp_hi_c"`
	N            int      `json:"n"`
	MeanOCVV     float64  `json:"mean_ocv_v"`
	SlopeVPerPct *float64 `json:"slope_v_per_pct"`
	Unknown      bool     `json:"unknown"`
}

// HysteresisBin is charge-rest minus discharge-rest at one SOC bin.
type HysteresisBin struct {
	TempLoC    float64  `json:"temp_lo_c"`
	TempHiC    float64  `json:"temp_hi_c"`
	SocLoPct   float64  `json:"soc_lo_pct"`
	SocHiPct   float64  `json:"soc_hi_pct"`
	NCharge    int      `json:"n_charge"`
	NDischarge int      `json:"n_discharge"`
	DeltaV     *float64 `json:"delta_v"`
	Unknown    bool     `json:"unknown"`
}

// IRPoint is one DCIR observation (pack-equivalent ohms).
type IRPoint struct {
	At        time.Time `json:"at"`
	IRPackOhm float64   `json:"ir_pack_ohm"`
	TempC     *float64  `json:"temp_c"`
	SocPct    *float64  `json:"soc_pct"`
	DeltaIV   float64   `json:"delta_i_a"`
	DeltaVV   float64   `json:"delta_v_v"`
	DtS       float64   `json:"dt_s"`
	Context   string    `json:"context"` // drive_step | charge_step
}

// ArrheniusFit is ln(IR) vs 1/T with activation energy.
type ArrheniusFit struct {
	Fit
	EaJPerMol  *float64 `json:"ea_j_per_mol"`
	EaCI95Low  *float64 `json:"ea_ci95_low"`
	EaCI95High *float64 `json:"ea_ci95_high"`
	TempBins   int      `json:"temp_bins"`
	TempSpanC  float64  `json:"temp_span_c"`
	Unknown    bool     `json:"unknown"`
	Honesty    string   `json:"honesty"`
}

// AgingSplit reports descriptive exposure and an observational capacity-proxy trend.
type AgingSplit struct {
	NominalPackWh     float64  `json:"nominal_pack_wh"`
	NominalPackSource string   `json:"nominal_pack_source"`
	ThroughputWh      *float64 `json:"throughput_wh"`
	EquivFullCycles   *float64 `json:"equiv_full_cycles"`
	RestHours         float64  `json:"rest_hours"`
	HighSocRestHours  float64  `json:"high_soc_rest_hours"`
	ProxySlopeWhPerD  *float64 `json:"proxy_slope_wh_per_day"`
	ProxyCI95Low      *float64 `json:"proxy_ci95_low"`
	ProxyCI95High     *float64 `json:"proxy_ci95_high"`
	ProxyN            int      `json:"proxy_n"`
	HoldoutRMSEWh     *float64 `json:"holdout_rmse_wh"`
	Unknown           bool     `json:"unknown"`
	Honesty           string   `json:"honesty"`
}

// ElectrochemReport is the flagship domain payload.
type ElectrochemReport struct {
	VehicleID     int64           `json:"vehicle_id"`
	VIN           string          `json:"vin,omitempty"`
	Start         time.Time       `json:"start"`
	End           time.Time       `json:"end"`
	OCVPoints     []OCVPoint      `json:"ocv_points"`
	OCVBins       []OCVBin        `json:"ocv_bins"`
	Hysteresis    []HysteresisBin `json:"hysteresis"`
	IRPoints      []IRPoint       `json:"ir_points"`
	Arrhenius     ArrheniusFit    `json:"arrhenius"`
	PulseIR       []IRPoint       `json:"pulse_ir"`
	Aging         AgingSplit      `json:"aging"`
	CapacityProxy *float64        `json:"capacity_proxy_wh"`
	CapacityUnk   bool            `json:"capacity_proxy_unknown"`
	FirmwareEpoch string          `json:"firmware_epoch"`
	PooledEpochs  bool            `json:"pooled_epochs"`
	SignalsUsed   []string        `json:"signals_used"`
	Missing       []string        `json:"missing_signals,omitempty"`
	Truncated     bool            `json:"truncated"`
	Honesty       string          `json:"honesty"`
}

// ThermalFit is one lumped-capacity transient.
type ThermalFit struct {
	Start       time.Time `json:"start"`
	End         time.Time `json:"end"`
	Kind        string    `json:"kind"` // pack_cooldown | cabin_cooldown | heat_soak
	TauS        *float64  `json:"tau_s"`
	TauCI95Low  *float64  `json:"tau_ci95_low"`
	TauCI95High *float64  `json:"tau_ci95_high"`
	TInfC       *float64  `json:"t_inf_c"`
	N           int       `json:"n"`
	R2          *float64  `json:"r2"`
	ResidualC   *float64  `json:"residual_rmse_c"`
	SolarUnk    bool      `json:"solar_unknown"`
	Unknown     bool      `json:"unknown"`
}

// ThermalReport is the domain 2 payload.
type ThermalReport struct {
	VehicleID   int64        `json:"vehicle_id"`
	Start       time.Time    `json:"start"`
	End         time.Time    `json:"end"`
	Fits        []ThermalFit `json:"fits"`
	SignalsUsed []string     `json:"signals_used"`
	Missing     []string     `json:"missing_signals,omitempty"`
	Truncated   bool         `json:"truncated"`
	Honesty     string       `json:"honesty"`
}

// WeatherPoint joins one drive to archive weather at its start.
type WeatherPoint struct {
	DriveID        int64     `json:"drive_id"`
	At             time.Time `json:"at"`
	Lat            float64   `json:"lat"`
	Lon            float64   `json:"lon"`
	TempC          *float64  `json:"temp_c"`
	PressureHpa    *float64  `json:"pressure_hpa"`
	WindMps        *float64  `json:"wind_mps"`
	PrecipMm       *float64  `json:"precip_mm"`
	DensityKgM3    *float64  `json:"density_kg_m3"`
	ResidualWhPerM *float64  `json:"residual_wh_per_m"`
	SessionWhPerM  *float64  `json:"session_wh_per_m"`
}

// WeatherReport is the domain 3 payload.
type WeatherReport struct {
	VehicleID   int64          `json:"vehicle_id"`
	Start       time.Time      `json:"start"`
	End         time.Time      `json:"end"`
	Points      []WeatherPoint `json:"points"`
	DensityR    *float64       `json:"density_r"`
	WindR       *float64       `json:"wind_r"`
	RainN       int            `json:"rain_n"`
	DryN        int            `json:"dry_n"`
	WeatherUnk  bool           `json:"weather_unknown"`
	SignalsUsed []string       `json:"signals_used"`
	Missing     []string       `json:"missing_signals,omitempty"`
	Honesty     string         `json:"honesty"`
}

// TireReport is the domain 4 payload.
type TireReport struct {
	VehicleID      int64     `json:"vehicle_id"`
	Start          time.Time `json:"start"`
	End            time.Time `json:"end"`
	FLKpa          *float64  `json:"fl_kpa"`
	FRKpa          *float64  `json:"fr_kpa"`
	RLKpa          *float64  `json:"rl_kpa"`
	RRKpa          *float64  `json:"rr_kpa"`
	ImbalanceKpa   *float64  `json:"imbalance_kpa"`
	RecommendedKpa *float64  `json:"recommended_kpa"`
	UnderinflFrac  *float64  `json:"underinflation_frac"`
	ExtraWh        *float64  `json:"extra_wh"`
	ExtraModelLow  *float64  `json:"extra_model_low"`
	ExtraModelHigh *float64  `json:"extra_model_high"`
	DistanceM      *float64  `json:"distance_m"`
	Unknown        bool      `json:"unknown"`
	SignalsUsed    []string  `json:"signals_used"`
	Missing        []string  `json:"missing_signals,omitempty"`
	Honesty        string    `json:"honesty"`
}

// ChargeIRReport is the optional per-session pulse-IR payload.
type ChargeIRReport struct {
	SessionID   int64     `json:"session_id"`
	VehicleID   int64     `json:"vehicle_id"`
	Points      []IRPoint `json:"points"`
	SignalsUsed []string  `json:"signals_used"`
	Missing     []string  `json:"missing_signals,omitempty"`
	Honesty     string    `json:"honesty"`
}

// Notebook is the aggregated lab-notebook payload.
type Notebook struct {
	VehicleID int64           `json:"vehicle_id"`
	VIN       string          `json:"vin,omitempty"`
	Start     time.Time       `json:"start"`
	End       time.Time       `json:"end"`
	Entries   []NotebookEntry `json:"entries"`
	Honesty   string          `json:"honesty"`
}
