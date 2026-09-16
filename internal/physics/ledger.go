package physics

import "time"

// Honesty strings. Wording mirrors internal/api/teslaphysics constants for
// the same phenomena; this package must never contradict them.
const (
	PackCurrentQuietA = 2.0
	// LedgerHonesty governs the whole energy/force ledger.
	LedgerHonesty = "Predicted vs measured energy and force from recorded signals. Residual is unexplained, never zero-filled. Unknown inputs stay unknown."
	// DriveHonesty governs the drive energy ledger.
	DriveHonesty = "Drive energy from pack power integrated over recorded samples. Session EnergyUsedWh reconciles, never overwrites."
	// RegenHonesty governs regen vs friction-brake split.
	RegenHonesty = "Regen is estimated from pack charge current while moving. Braking residual requires grade, mass and drivetrain assumptions; it is not a measured friction-brake quantity."
	// ChargeLedgerHonesty governs charge energy and efficiency.
	ChargeLedgerHonesty = "Plugged → Starting → Charging → Stopped/Complete → Disconnected. Stopped is a pause. Complete is at limit, still plugged. Only Disconnected is unplug."
	// ParkLedgerHonesty governs parked drain as watts.
	ParkLedgerHonesty = "Drain while Gear=P only. Neutral is rolling, not parked. Watts, not just daily kWh."
	// ThermalHonesty governs temperature correlation.
	ThermalHonesty = "Pack, cabin, and ambient temperatures as recorded. Heat vs power is correlation. Missing sensors stay unknown."
	// RangeLedgerHonesty governs range disagreement.
	RangeLedgerHonesty = "Rated, typical, ideal, and energy remaining can disagree. This ledger never picks a true range."
	// TireHonesty governs TPMS imbalance.
	TireHonesty = "TPMS pressures as recorded, per corner. Imbalance is max minus min. Missing corners stay unknown."
	// EpochLedgerHonesty governs firmware-baseline residual comparison.
	EpochLedgerHonesty = "Each software version is a physics baseline for this VIN. Residual changes across versions are correlation, not proof of a fix."
	// GapHonesty governs unknown segments.
	GapHonesty = "Unknown hours are a budget, never a measured zero. Gaps longer than the threshold break the segment; energy inside a gap is unknown."
	// BlackBoxLedgerHonesty governs the 90s overlay.
	BlackBoxLedgerHonesty = "High-resolution force, power, and speed in the 90 seconds before the window end, from signal_log only."
)

const (
	// WalkingSpeedMps separates parked/quiet from moving.
	WalkingSpeedMps = 1.0
	// DefaultUnknownGapS breaks a segment when samples stop (matches existing unknownGap).
	DefaultUnknownGapS = 120.0
	// DefaultAirDensityKgM3 is sea-level standard air density.
	DefaultAirDensityKgM3 = 1.225
	// GravityMps2 is standard gravity.
	GravityMps2 = 9.80665
	// DefaultDrivetrainEff is a model, not a measurement (see DrivetrainLossWh).
	DefaultDrivetrainEff = 0.90
	// BlackBoxWindowS is the pre-end overlay duration.
	BlackBoxWindowS = 90.0
)

// Param source labels for mass/CdA/Crr.
const (
	ParamUnknown    = "unknown"
	ParamDefault    = "default"
	ParamConfigured = "configured"
	ParamFitted     = "fitted"
)

// Sample is one vendor-neutral physics observation. Every field is a
// pointer: nil means the signal was not recorded at this time, never zero.
type Sample struct {
	// ElectricalUnaligned rejects asynchronous forward-filled V/I as a
	// synchronous current-step experiment. Aligned fixtures may leave false.
	ElectricalUnaligned bool
	At                  time.Time
	// Motion.
	SpeedMps       *float64
	ElevationM     *float64
	OdometerM      *float64
	Gear           string
	BrakePedalPos  *float64
	TorqueActualNm *float64
	// Pack electrical (Tesla sign: current positive = charging into pack).
	PackVoltageV      *float64
	PackCurrentA      *float64
	EnergyRemainingWh *float64
	SocPct            *float64
	// Brick extremes are pack aggregates (Tesla sends no per-cell current).
	BrickMinV *float64
	BrickMaxV *float64
	// Charger wall power.
	ACPowerW *float64
	DCPowerW *float64
	// Charge language.
	ChargeState         string
	DetailedChargeState string
	ChargePortLatch     string
	ChargePortDoorOpen  *bool
	FastCharger         bool
	// Thermal.
	PackTempMinC *float64
	PackTempMaxC *float64
	InsideTempC  *float64
	OutsideTempC *float64
	// Accessory / HVAC.
	HvacPowerW      *float64
	Preconditioning bool
	BatteryHeaterOn bool
	SentryOn        bool
	CabinOverheatOn bool
	ClimateKeeper   bool
	// Range estimators.
	RatedRangeM *float64
	EstRangeM   *float64
	IdealRangeM *float64
	// Tires (kPa per corner).
	TpmsFLKpa *float64
	TpmsFRKpa *float64
	TpmsRLKpa *float64
	TpmsRRKpa *float64
	// Identity.
	Firmware string
}

// Params carries the VIN's physical constants and solver tuning.
type Params struct {
	MassKg        *float64
	MassSource    string
	CdAM2         float64
	CdASource     string
	Crr           float64
	CrrSource     string
	RhoAirKgM3    float64
	UnknownGapS   float64
	DrivetrainEff float64
}

// DefaultParams returns solver tuning with defaults labelled as defaults.
// Mass stays unknown until configured: the solver never assumes kilograms.
func DefaultParams() Params {
	return Params{
		MassKg:        nil,
		MassSource:    ParamUnknown,
		CdAM2:         0.575,
		CdASource:     ParamDefault,
		Crr:           0.009,
		CrrSource:     ParamDefault,
		RhoAirKgM3:    DefaultAirDensityKgM3,
		UnknownGapS:   DefaultUnknownGapS,
		DrivetrainEff: DefaultDrivetrainEff,
	}
}

// Window is one solve request: samples plus session truth to reconcile.
type Window struct {
	VehicleID int64
	Kind      string // drive | charge | park | range
	Start     time.Time
	End       time.Time
	Samples   []Sample
	Params    Params
	// Session truth for reconciliation (nil when no session backs the window).
	SessionEnergyWh  *float64 // drive EnergyUsedWh / charge TotalEnergyAddedWh
	SessionDistanceM *float64
}

// Term is one ledger line: value plus its provenance.
type Term struct {
	ValueWh *float64 `json:"value_wh"`
	Method  string   `json:"method"`
	Unknown bool     `json:"unknown"`
	Missing []string `json:"missing_signals,omitempty"`
}

// DynamicsPoint is one longitudinal-dynamics sample.
type DynamicsPoint struct {
	At             time.Time `json:"at"`
	SpeedMps       *float64  `json:"speed_mps"`
	AccelMps2      *float64  `json:"accel_mps2"`
	ForceLongN     *float64  `json:"force_long_n"`
	PowerMechW     *float64  `json:"power_mech_w"`
	PowerPackW     *float64  `json:"power_pack_w"`
	FrictionBrakeW *float64  `json:"friction_brake_w"`
	Unknown        bool      `json:"unknown"`
}

// LongitudinalDynamics is domain A output.
type LongitudinalDynamics struct {
	Points     []DynamicsPoint `json:"points"`
	MassKg     *float64        `json:"mass_kg"`
	MassSource string          `json:"mass_source"`
	RegenWh    *float64        `json:"regen_wh"`
	FrictionWh *float64        `json:"friction_brake_wh"`
	Unknown    bool            `json:"unknown"`
	Missing    []string        `json:"missing_signals,omitempty"`
	Honesty    string          `json:"honesty"`
}

// DriveLedger is domain B output.
type DriveLedger struct {
	MeasuredWh       Term     `json:"measured_wh"`
	SessionWh        *float64 `json:"session_wh"`
	ReconcileWh      *float64 `json:"reconcile_wh"`
	AeroWh           Term     `json:"aero_wh"`
	RollingWh        Term     `json:"rolling_wh"`
	GradeWh          Term     `json:"grade_wh"`
	InertialWh       Term     `json:"inertial_wh"`
	AccessoryWh      Term     `json:"accessory_wh"`
	DrivetrainLossWh Term     `json:"drivetrain_loss_wh"`
	PredictedWh      *float64 `json:"predicted_wh"`
	UnexplainedWh    *float64 `json:"unexplained_wh"`
	UnexplainedKnown bool     `json:"unexplained_known"`
	Missing          []string `json:"missing_signals,omitempty"`
	Honesty          string   `json:"honesty"`
}

// ChargeLedger is domain C output.
type ChargeLedger struct {
	EnergyAddedWh   *float64 `json:"energy_added_wh"`
	SessionWh       *float64 `json:"session_wh"`
	WallWh          Term     `json:"wall_wh"`
	EfficiencyPct   *float64 `json:"efficiency_pct"`
	EfficiencyKnown bool     `json:"efficiency_known"`
	PreconditionWh  Term     `json:"precondition_wh"`
	DwellCompleteS  *float64 `json:"dwell_complete_s"`
	Unplugged       bool     `json:"unplugged"`
	Unknown         bool     `json:"unknown"`
	Missing         []string `json:"missing_signals,omitempty"`
	Honesty         string   `json:"honesty"`
}

// ParkLedger is domain D output.
type ParkLedger struct {
	DurationS       float64  `json:"duration_s"`
	AvgWattsW       *float64 `json:"avg_watts_w"`
	EnergyWh        *float64 `json:"energy_wh"`
	SentryWh        Term     `json:"sentry_wh"`
	CabinOverheatWh Term     `json:"cabin_overheat_wh"`
	PreconditionWh  Term     `json:"precondition_wh"`
	QuietPackWh     Term     `json:"quiet_pack_wh"`
	PluggedAtLimit  bool     `json:"plugged_at_limit"`
	Trusted         bool     `json:"trusted"`
	Unknown         bool     `json:"unknown"`
	Missing         []string `json:"missing_signals,omitempty"`
	Honesty         string   `json:"honesty"`
}

// ThermalLedger is domain E output.
type ThermalLedger struct {
	PackMinC     *float64 `json:"pack_min_c"`
	PackMaxC     *float64 `json:"pack_max_c"`
	PackStartC   *float64 `json:"pack_start_c"`
	PackEndC     *float64 `json:"pack_end_c"`
	InsideC      *float64 `json:"inside_c"`
	OutsideC     *float64 `json:"outside_c"`
	HeatVsPowerR *float64 `json:"heat_vs_power_r"`
	Unknown      bool     `json:"unknown"`
	Missing      []string `json:"missing_signals,omitempty"`
	Honesty      string   `json:"honesty"`
}

// RangeLedger is domain F output.
type RangeLedger struct {
	RatedM        *float64 `json:"rated_m"`
	EstM          *float64 `json:"est_m"`
	IdealM        *float64 `json:"ideal_m"`
	EnergyWh      *float64 `json:"energy_wh"`
	ImpliedWhPerM *float64 `json:"implied_wh_per_m"`
	SpreadM       *float64 `json:"spread_m"`
	Disagree      bool     `json:"disagree"`
	Unknown       bool     `json:"unknown"`
	Missing       []string `json:"missing_signals,omitempty"`
	Honesty       string   `json:"honesty"`
}

// TireLedger is domain G output.
type TireLedger struct {
	FLKpa        *float64 `json:"fl_kpa"`
	FRKpa        *float64 `json:"fr_kpa"`
	RLKpa        *float64 `json:"rl_kpa"`
	RRKpa        *float64 `json:"rr_kpa"`
	ImbalanceKpa *float64 `json:"imbalance_kpa"`
	Unknown      bool     `json:"unknown"`
	Missing      []string `json:"missing_signals,omitempty"`
	Honesty      string   `json:"honesty"`
}

// EpochResidual is one firmware baseline's residual (correlation only).
type EpochResidual struct {
	Firmware      string   `json:"firmware"`
	MeasuredWh    *float64 `json:"measured_wh"`
	PredictedWh   *float64 `json:"predicted_wh"`
	UnexplainedWh *float64 `json:"unexplained_wh"`
	SampleCount   int      `json:"sample_count"`
	Honesty       string   `json:"honesty"`
}

// UnknownInterval is one gap: time with no usable samples.
type UnknownInterval struct {
	StartedAt time.Time `json:"started_at"`
	EndedAt   time.Time `json:"ended_at"`
	DurationS float64   `json:"duration_s"`
	Reason    string    `json:"reason"`
}

// BlackBoxPoint overlays force, power, and speed before the window end.
type BlackBoxPoint struct {
	At         time.Time `json:"at"`
	SpeedMps   *float64  `json:"speed_mps"`
	PowerPackW *float64  `json:"power_pack_w"`
	ForceLongN *float64  `json:"force_long_n"`
	Latch      string    `json:"latch,omitempty"`
}

// Marker is one day-log-spine chapter boundary (drive/charge only).
type Marker struct {
	At   time.Time `json:"at"`
	Kind string    `json:"kind"`
	ID   int64     `json:"id"`
	Edge string    `json:"edge"`
}

// Ledger is the full auditable energy/force output for one window.
type Ledger struct {
	VehicleID      int64                 `json:"vehicle_id"`
	Kind           string                `json:"kind"`
	Start          time.Time             `json:"start"`
	End            time.Time             `json:"end"`
	Dynamics       *LongitudinalDynamics `json:"dynamics"`
	Drive          *DriveLedger          `json:"drive"`
	Charge         *ChargeLedger         `json:"charge"`
	Park           *ParkLedger           `json:"park"`
	Thermal        *ThermalLedger        `json:"thermal"`
	Range          *RangeLedger          `json:"range"`
	Tires          *TireLedger           `json:"tires"`
	Epochs         []EpochResidual       `json:"epochs"`
	Unknown        []UnknownInterval     `json:"unknown_intervals"`
	UnknownHours   float64               `json:"unknown_hours"`
	BlackBox       []BlackBoxPoint       `json:"black_box"`
	Contradictions []string              `json:"contradictions,omitempty"`
	Markers        []Marker              `json:"markers,omitempty"`
	Truncated      bool                  `json:"truncated"`
	MissingSignals []string              `json:"missing_signals,omitempty"`
	Honesty        string                `json:"honesty"`
}
