package teslaphysics

import "time"

const (
	chargeHonesty = "Plugged → Starting → Charging → Stopped/Complete → Disconnected. Stopped is a pause. Complete is at limit, still plugged. Only Disconnected is unplug."
	etiquetteHonesty = "Supercharger etiquette is the time from Complete to Disconnected at DC. It is not a Tesla penalty score."
	scheduleHonesty = "Scheduled-charge truth asks whether Stopped waited for the scheduled window, or charging resumed anyway. Missing schedule signals stay unknown."
	vampireHonesty = "Drain while Gear=P at Complete (still plugged at limit) versus after Disconnected. Neutral is rolling, not parked."
	parkHonesty = "Sentry, cabin overheat, and preconditioning only count after confirmed Park (Gear=P). Neutral is rolling."
	theaterHonesty = "Gear theater is P/R/N/D plus charge-port latch language from the change feed, not a GPS trip."
	heartbeatHonesty = "SelfDrivingMilesSinceReset is a resettable trip meter. A tick is not proof that FSD is on."
	silentHonesty = "Gear=D/R, speed above walking pace, and the FSD trip meter not advancing is counter-silent. It is not a Tesla disengagement."
	certificateHonesty = "Boundaries use confirmed Park to end drives and Disconnected to end charges. The hash covers the canonical JSON, not a legal signature unless HMAC is configured."
	outageHonesty = "After MQTT or carbon loss: last accepted telemetry time, whether the broker is connected, and that replay keeps the original event time when the envelope carries it. Gaps stay unknown."
	cockpitHonesty = "Live Tesla physics: Gear, ChargeState, port latch, BMS, and trip meters. Not an IoT dashboard."

	parkConfirmDuration = 30 * time.Second
	movingSpeedMps      = 1.0
	maxChargeLookback   = 48 * time.Hour
	maxDriveLookback    = 24 * time.Hour
	maxVampireLookback  = 14 * 24 * time.Hour
	maxOutageLookback   = 7 * 24 * time.Hour
)

// ChargePhase is one contiguous Tesla charge-state interval.
type ChargePhase struct {
	State     string     `json:"state"`
	StartedAt time.Time  `json:"started_at"`
	EndedAt   *time.Time `json:"ended_at"`
	DurationS float64    `json:"duration_s"`
	AtLimit   bool       `json:"at_limit"`
}

// SuperchargerEtiquette is Complete → Disconnected dwell at DC.
type SuperchargerEtiquette struct {
	Applicable  bool       `json:"applicable"`
	ChargerType string     `json:"charger_type,omitempty"`
	CompleteAt  *time.Time `json:"complete_at"`
	UnplugAt    *time.Time `json:"unplug_at"`
	DwellS      *float64   `json:"dwell_s"`
	Honesty     string     `json:"honesty"`
}

// ScheduleTruth reports whether Stopped waited for off-peak/schedule.
type ScheduleTruth struct {
	ScheduledMode       *string    `json:"scheduled_mode"`
	ScheduledStartAt    *time.Time `json:"scheduled_start_at"`
	StoppedAt           *time.Time `json:"stopped_at"`
	ChargingResumedAt   *time.Time `json:"charging_resumed_at"`
	WaitedForSchedule   *bool      `json:"waited_for_schedule"`
	ChargedAnyway       *bool      `json:"charged_anyway"`
	Unknown             bool       `json:"unknown"`
	Honesty             string     `json:"honesty"`
}

// ChargePhysics is the charge-session story.
type ChargePhysics struct {
	SessionID             int64                  `json:"session_id"`
	VehicleID             int64                  `json:"vehicle_id"`
	StartedAt             time.Time              `json:"started_at"`
	EndedAt               *time.Time             `json:"ended_at"`
	Story                 []ChargePhase          `json:"story"`
	AtLimitStillPluggedS  *float64               `json:"at_limit_still_plugged_s"`
	Etiquette             SuperchargerEtiquette  `json:"etiquette"`
	Schedule              ScheduleTruth          `json:"schedule"`
	Honesty               string                 `json:"honesty"`
}

// VampireWindow is parked drain split by plug state.
type VampireWindow struct {
	Kind          string    `json:"kind"`
	StartedAt     time.Time `json:"started_at"`
	EndedAt       time.Time `json:"ended_at"`
	DurationS     float64   `json:"duration_s"`
	StartSocPct   *float64  `json:"start_soc_pct"`
	EndSocPct     *float64  `json:"end_soc_pct"`
	DrainPct      *float64  `json:"drain_pct"`
	ParkConfirmed bool      `json:"park_confirmed"`
}

// VampireSplit is Complete-plugged drain versus unplugged drain.
type VampireSplit struct {
	VehicleID          int64           `json:"vehicle_id"`
	CompletePlugged    []VampireWindow `json:"complete_plugged"`
	Unplugged          []VampireWindow `json:"unplugged"`
	CompletePluggedPct *float64        `json:"complete_plugged_drain_pct"`
	UnpluggedPct       *float64        `json:"unplugged_drain_pct"`
	Honesty            string          `json:"honesty"`
}

// ParkTruth gates accessory states on confirmed Park.
type ParkTruth struct {
	ConfirmedPark            bool       `json:"confirmed_park"`
	ParkConfirmedAt          *time.Time `json:"park_confirmed_at"`
	NeutralRolling           bool       `json:"neutral_rolling"`
	Gear                     string     `json:"gear,omitempty"`
	SentryReported           bool       `json:"sentry_reported"`
	SentryCounted            bool       `json:"sentry_counted"`
	CabinOverheatReported    bool       `json:"cabin_overheat_reported"`
	CabinOverheatCounted     bool       `json:"cabin_overheat_counted"`
	PreconditioningReported  bool       `json:"preconditioning_reported"`
	PreconditioningCounted   bool       `json:"preconditioning_counted"`
	Rejected                 []string   `json:"rejected"`
	Honesty                  string     `json:"honesty"`
}

// TheaterEvent is one P/R/N/D or charge-port change.
type TheaterEvent struct {
	At                 time.Time `json:"at"`
	Gear               string    `json:"gear,omitempty"`
	ChargePortDoorOpen *bool     `json:"charge_port_door_open"`
	ChargePortLatch    string    `json:"charge_port_latch,omitempty"`
}

// GearTheater is Tesla shift language for one drive.
type GearTheater struct {
	DriveID   int64          `json:"drive_id"`
	VehicleID int64          `json:"vehicle_id"`
	Events    []TheaterEvent `json:"events"`
	Honesty   string         `json:"honesty"`
}

// SilentInterval is counter-silent while moving. Not a disengagement.
type SilentInterval struct {
	StartedAt    time.Time `json:"started_at"`
	EndedAt      time.Time `json:"ended_at"`
	DurationS    float64   `json:"duration_s"`
	Gear         string    `json:"gear"`
	FSDDistanceM *float64  `json:"fsd_distance_m"`
	Label        string    `json:"label"`
}

// SilentReport is the counter-silent view of one drive.
type SilentReport struct {
	DriveID    int64            `json:"drive_id"`
	VehicleID  int64            `json:"vehicle_id"`
	Intervals  []SilentInterval `json:"intervals"`
	Unknown    bool             `json:"unknown"`
	Honesty    string           `json:"honesty"`
}

// Heartbeat is the live FSD trip-meter view.
type Heartbeat struct {
	VehicleID            int64      `json:"vehicle_id"`
	FSDDistanceM         *float64   `json:"fsd_distance_m"`
	DrivingDistanceM     *float64   `json:"driving_distance_m"`
	LastTickAt           *time.Time `json:"last_tick_at"`
	Gear                 string     `json:"gear,omitempty"`
	SpeedMps             *float64   `json:"speed_mps"`
	ValetMode            *bool      `json:"valet_mode"`
	ServiceMode          *bool      `json:"service_mode"`
	FirmwareVersion      string     `json:"firmware_version,omitempty"`
	Label                string     `json:"label"`
	Honesty              string     `json:"honesty"`
}

// SessionBoundary is one drive or charge used in a certificate.
type SessionBoundary struct {
	Kind      string     `json:"kind"`
	ID        int64      `json:"id"`
	StartedAt time.Time  `json:"started_at"`
	EndedAt   *time.Time `json:"ended_at"`
	EndRule   string     `json:"end_rule"`
}

// SessionCertificate is a hashed export of Park/unplug boundaries.
type SessionCertificate struct {
	VehicleID       int64              `json:"vehicle_id"`
	IssuedAt        time.Time          `json:"issued_at"`
	From            time.Time          `json:"from"`
	To              time.Time          `json:"to"`
	Rules           string             `json:"rules"`
	Drives          []SessionBoundary  `json:"drives"`
	Charges         []SessionBoundary  `json:"charges"`
	IntegritySHA256 string             `json:"integrity_sha256"`
	HMACSHA256      *string            `json:"hmac_sha256"`
	Honesty         string             `json:"honesty"`
}

// OutageAutobiography describes catch-up after MQTT/carbon loss.
type OutageAutobiography struct {
	VehicleID                 int64      `json:"vehicle_id"`
	LastTelemetryAt           *time.Time `json:"last_telemetry_at"`
	GapS                      *float64   `json:"gap_s"`
	MQTTConnected             *bool      `json:"mqtt_connected"`
	ReplayPreservesEventTime  bool       `json:"replay_preserves_event_time"`
	UnknownSince              *time.Time `json:"unknown_since"`
	Notes                     []string   `json:"notes"`
	Honesty                   string     `json:"honesty"`
}

// Cockpit is the live Tesla physics view.
type Cockpit struct {
	VehicleID              int64      `json:"vehicle_id"`
	Gear                   string     `json:"gear,omitempty"`
	ChargeState            string     `json:"charge_state,omitempty"`
	DetailedChargeState    string     `json:"detailed_charge_state,omitempty"`
	ChargePortLatch        string     `json:"charge_port_latch,omitempty"`
	ChargePortDoorOpen     *bool      `json:"charge_port_door_open"`
	BatteryLevelPct        *float64   `json:"battery_level_pct"`
	EnergyRemainingWh      *float64   `json:"energy_remaining_wh"`
	PackCurrentA           *float64   `json:"pack_current_a"`
	PackVoltageV           *float64   `json:"pack_voltage_v"`
	FSDDistanceM           *float64   `json:"fsd_distance_m"`
	DrivingDistanceM       *float64   `json:"driving_distance_m"`
	SpeedMps               *float64   `json:"speed_mps"`
	SentryMode             string     `json:"sentry_mode,omitempty"`
	ValetMode              *bool      `json:"valet_mode"`
	ServiceMode            *bool      `json:"service_mode"`
	Park                   ParkTruth  `json:"park"`
	Honesty                string     `json:"honesty"`
}

// ChargeSample is the bounded input for charge-physics derivation.
type ChargeSample struct {
	At                    time.Time
	DetailedChargeState   string
	ChargeState           string
	FastChargerPresent    *bool
	FastChargerType       string
	ScheduledMode         string
	ScheduledStart        *time.Time
	BatteryPct            *float64
}

// MotionSample is Gear/speed/FSD for silent-counter derivation.
type MotionSample struct {
	At           time.Time
	Gear         string
	SpeedMps     *float64
	FSDDistanceM *float64
}

// ParkSample is Gear plus accessory flags.
type ParkSample struct {
	At              time.Time
	Gear            string
	Sentry          bool
	CabinOverheat   bool
	Preconditioning bool
}

// VampireSample is parked-drain input.
type VampireSample struct {
	At          time.Time
	Gear        string
	ChargeState string
	BatteryPct  *float64
}

// TheaterSample is gear/port input.
type TheaterSample struct {
	At                 time.Time
	Gear               string
	ChargePortDoorOpen *bool
	ChargePortLatch    string
}
