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
	clocksHonesty = "signal_log time is vehicle event time. Ingest time is unknown unless the envelope stored it. Display time is now. Gaps stay gaps."
	lifeTapeHonesty = "Every second is Confirmed Park, Neutral rolling, Drive, Reverse, plugged-not-charging, Charging, Complete-still-plugged, Unplugged, or Unknown. This is not a GPS trip list."
	contradictionHonesty = "MQTT/live physics vs Tesla charge/gear language. Complete still latched is expected. Gear=P with speed is a contradiction. Neutral is rolling, not parked."
	meterHonesty = "Odometer, MilesSinceReset, and SelfDrivingMilesSinceReset are trip meters. A drop is a reset or a gap. Null is not zero."
	unknownOSHonesty = "Unknown hours are a budget, never a measured zero. Missing Park, Charge, FSD, or motion stays unknown."
	carKeptLivingHonesty = "After carbon or MQTT loss: what may have queued, what replays with original event time, and what the car did that we never received. Queue depth is unknown unless the broker reports it."
	logbookHonesty = "Sessions are narrated as Park, Drive, Reverse, Neutral, Charging, Stopped, Complete, Disconnected — Tesla words, not GPS trips."
	epochHonesty = "Each software version is a physics baseline for this VIN. Changes are correlation, not proof that FSD got better."
	portCourtHonesty = "Latch, door, pack current, ChargeState, and schedule are one evidence chain. Complete-to-unplug is etiquette, not a Tesla penalty score."
	blackBoxHonesty = "High-resolution samples in the 90 seconds before confirmed Park, unplug, or a telemetry gap. Tesla will not give you this black box."
	dictionaryHonesty = "Priors for this car only: Complete-to-unplug, Park confirm dwell, and Complete without a schedule. Missing evidence stays unknown."
	vaultHonesty = "Signed session boundaries plus unknown hours, firmware epochs, and Supercharger etiquette. Not a legal instrument unless HMAC is configured."
	modeHonesty = "Valet, Service, and Transport change what TeslaSync may infer. Service-mode amnesia. Neutral tow is not Park. Unknown mode is unknown."
	nervousHonesty = "BMS, Gear, latch, and trip meters are alive, silent, or contradicting. Silence is not a zero."
	rangeHonesty = "Rated, typical, ideal, and energy remaining can disagree. This panel never picks a true range."

	parkConfirmDuration = 30 * time.Second
	movingSpeedMps      = 1.0
	maxChargeLookback   = 48 * time.Hour
	maxDriveLookback    = 24 * time.Hour
	maxVampireLookback  = 14 * 24 * time.Hour
	maxOutageLookback   = 7 * 24 * time.Hour
	maxExclusiveLookback = 14 * 24 * time.Hour
	unknownGap           = 2 * time.Minute
	blackBoxWindow       = 90 * time.Second
	packCurrentQuietA    = 2.0
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

// PhysicsFrame is one Tesla-physics sample used by TeslaSync-only views.
type PhysicsFrame struct {
	At                 time.Time
	Gear               string
	SpeedMps           *float64
	ChargeState        string
	Latch              string
	DoorOpen           *bool
	PackCurrentA       *float64
	PackVoltageV       *float64
	BatteryPct         *float64
	EnergyRemainingWh  *float64
	RatedRangeM        *float64
	EstRangeM          *float64
	IdealRangeM        *float64
	FSDDistanceM       *float64
	DrivingDistanceM   *float64
	OdometerM          *float64
	Firmware           string
	Valet              *bool
	Service            *bool
	FastChargerPresent *bool
	ScheduledMode      string
}

// ClockReading is event / ingest / display time for one sample.
type ClockReading struct {
	EventTime   time.Time  `json:"event_time"`
	IngestTime  *time.Time `json:"ingest_time"`
	DisplayTime time.Time  `json:"display_time"`
	GapS        *float64   `json:"gap_s"`
	Unknown     bool       `json:"unknown"`
}

// ThreeClocks is the TeslaSync-only clock product.
type ThreeClocks struct {
	VehicleID int64          `json:"vehicle_id"`
	Latest    *ClockReading  `json:"latest"`
	Samples   []ClockReading `json:"samples"`
	Honesty   string         `json:"honesty"`
}

// LifeSegment is one contiguous life-tape state.
type LifeSegment struct {
	State     string    `json:"state"`
	StartedAt time.Time `json:"started_at"`
	EndedAt   time.Time `json:"ended_at"`
	DurationS float64   `json:"duration_s"`
}

// LifeTape is every second of this VIN in Tesla physics language.
type LifeTape struct {
	VehicleID int64         `json:"vehicle_id"`
	From      time.Time     `json:"from"`
	To        time.Time     `json:"to"`
	Segments  []LifeSegment `json:"segments"`
	Honesty   string        `json:"honesty"`
}

// Contradiction is one MQTT/live vs Tesla-language disagreement.
type Contradiction struct {
	At      time.Time `json:"at"`
	Kind    string    `json:"kind"`
	Detail  string    `json:"detail"`
	Unknown bool      `json:"unknown"`
}

// ContradictionCourt lists Tesla-physics disagreements. Complete-latched is not one.
type ContradictionCourt struct {
	VehicleID      int64            `json:"vehicle_id"`
	Findings       []Contradiction  `json:"findings"`
	Honesty        string           `json:"honesty"`
}

// MeterReset is a trip-meter drop with context. Null is never a reset to zero.
type MeterReset struct {
	At       time.Time `json:"at"`
	Meter    string    `json:"meter"`
	FromM    *float64  `json:"from_m"`
	ToM      *float64  `json:"to_m"`
	Cause    string    `json:"cause"`
	Unknown  bool      `json:"unknown"`
}

// MeterGenealogy is the family tree of odometer / driving / FSD trip meters.
type MeterGenealogy struct {
	VehicleID        int64        `json:"vehicle_id"`
	OdometerM        *float64     `json:"odometer_m"`
	DrivingDistanceM *float64     `json:"driving_distance_m"`
	FSDDistanceM     *float64     `json:"fsd_distance_m"`
	Resets           []MeterReset `json:"resets"`
	Honesty          string       `json:"honesty"`
}

// UnknownBudget is first-class unknown time, never zero-filled.
type UnknownBudget struct {
	Kind     string  `json:"kind"`
	Hours    float64 `json:"hours"`
	Unknown  bool    `json:"unknown"`
}

// UnknownOS is the unknown operating system for this VIN.
type UnknownOS struct {
	VehicleID    int64           `json:"vehicle_id"`
	WindowHours  float64         `json:"window_hours"`
	SampleHours  *float64        `json:"sample_hours"`
	UnknownHours *float64        `json:"unknown_hours"`
	Budgets      []UnknownBudget `json:"budgets"`
	Honesty      string          `json:"honesty"`
}

// CarKeptLiving is the car's side of an outage.
type CarKeptLiving struct {
	VehicleID                int64      `json:"vehicle_id"`
	LastTelemetryAt          *time.Time `json:"last_telemetry_at"`
	MQTTConnected            *bool      `json:"mqtt_connected"`
	QueuedCount              *int       `json:"queued_count"`
	ReplayPreservesEventTime bool       `json:"replay_preserves_event_time"`
	NeverReceivedGapS        *float64   `json:"never_received_gap_s"`
	Notes                    []string   `json:"notes"`
	Honesty                  string     `json:"honesty"`
}

// LogbookEntry is one Tesla-language session line.
type LogbookEntry struct {
	Word      string     `json:"word"`
	At        time.Time  `json:"at"`
	EndedAt   *time.Time `json:"ended_at"`
	Kind      string     `json:"kind"`
	ID        int64      `json:"id"`
}

// TeslaLogbook narrates sessions in Tesla words.
type TeslaLogbook struct {
	VehicleID int64          `json:"vehicle_id"`
	Entries   []LogbookEntry `json:"entries"`
	Honesty   string         `json:"honesty"`
}

// FirmwareEpoch is one software version's physics baseline for this VIN.
type FirmwareEpoch struct {
	Version              string     `json:"version"`
	StartedAt            time.Time  `json:"started_at"`
	EndedAt              *time.Time `json:"ended_at"`
	FSDMeterStartM       *float64   `json:"fsd_meter_start_m"`
	FSDMeterEndM         *float64   `json:"fsd_meter_end_m"`
	CompleteToUnplugS    *float64   `json:"complete_to_unplug_s"`
	Honesty              string     `json:"honesty"`
}

// FirmwareEpochs splits this VIN's physics by software version.
type FirmwareEpochs struct {
	VehicleID int64           `json:"vehicle_id"`
	Epochs    []FirmwareEpoch `json:"epochs"`
	Honesty   string          `json:"honesty"`
}

// PortEvidence is one charge-port courtroom sample.
type PortEvidence struct {
	At            time.Time `json:"at"`
	Latch         string    `json:"latch,omitempty"`
	DoorOpen      *bool     `json:"door_open"`
	PackCurrentA  *float64  `json:"pack_current_a"`
	ChargeState   string    `json:"charge_state,omitempty"`
	ScheduledMode string    `json:"scheduled_mode,omitempty"`
}

// ChargePortCourt is latch+door+current+ChargeState+schedule as one chain.
type ChargePortCourt struct {
	VehicleID int64          `json:"vehicle_id"`
	Evidence  []PortEvidence `json:"evidence"`
	Honesty   string         `json:"honesty"`
}

// BlackBox is the last 90s before Park, unplug, or a gap.
type BlackBox struct {
	VehicleID int64          `json:"vehicle_id"`
	Trigger   string         `json:"trigger"`
	From      *time.Time     `json:"from"`
	To        *time.Time     `json:"to"`
	Frames    []PortEvidence `json:"frames"`
	Honesty   string         `json:"honesty"`
}

// OwnerDictionary is learned priors for this car.
type OwnerDictionary struct {
	VehicleID              int64    `json:"vehicle_id"`
	TypicalCompleteUnplugS *float64 `json:"typical_complete_unplug_s"`
	ParkConfirmDwellS      *float64 `json:"park_confirm_dwell_s"`
	CompleteWithoutSchedule *int    `json:"complete_without_schedule"`
	Honesty                string   `json:"honesty"`
}

// PhysicsVault is the resale/service export of TeslaSync-only physics.
type PhysicsVault struct {
	VehicleID         int64              `json:"vehicle_id"`
	Certificate       SessionCertificate `json:"certificate"`
	UnknownHours      *float64           `json:"unknown_hours"`
	FirmwareVersions  []string           `json:"firmware_versions"`
	EtiquetteDwellsS  []float64          `json:"etiquette_dwells_s"`
	Honesty           string             `json:"honesty"`
}

// ModeLaws is Valet/Service/Transport inference policy.
type ModeLaws struct {
	VehicleID     int64    `json:"vehicle_id"`
	Valet         *bool    `json:"valet"`
	Service       *bool    `json:"service"`
	Transport     *bool    `json:"transport"`
	Allowed       []string `json:"allowed"`
	Forbidden     []string `json:"forbidden"`
	Honesty       string   `json:"honesty"`
}

// Nerve is one Tesla field's alive/silent/contradicting status.
type Nerve struct {
	Field  string `json:"field"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

// NervousSystem is BMS/Gear/latch/meters as anatomy.
type NervousSystem struct {
	VehicleID int64   `json:"vehicle_id"`
	Nerves    []Nerve `json:"nerves"`
	Honesty   string  `json:"honesty"`
}

// RangeDisagreement shows Tesla range numbers without picking a winner.
type RangeDisagreement struct {
	VehicleID         int64    `json:"vehicle_id"`
	RatedRangeM       *float64 `json:"rated_range_m"`
	EstRangeM         *float64 `json:"est_range_m"`
	IdealRangeM       *float64 `json:"ideal_range_m"`
	EnergyRemainingWh *float64 `json:"energy_remaining_wh"`
	RecentWhPerKm     *float64 `json:"recent_wh_per_km"`
	Disagree          bool     `json:"disagree"`
	TrueRangeM        *float64 `json:"true_range_m"`
	Honesty           string   `json:"honesty"`
}

// ExclusiveReport is the TeslaSync-only physics pack.
type ExclusiveReport struct {
	VehicleID       int64               `json:"vehicle_id"`
	Clocks          ThreeClocks         `json:"clocks"`
	LifeTape        LifeTape            `json:"life_tape"`
	Contradictions  ContradictionCourt  `json:"contradictions"`
	Meters          MeterGenealogy      `json:"meters"`
	UnknownOS       UnknownOS           `json:"unknown_os"`
	CarKeptLiving   CarKeptLiving       `json:"car_kept_living"`
	Logbook         TeslaLogbook        `json:"logbook"`
	FirmwareEpochs  FirmwareEpochs      `json:"firmware_epochs"`
	ChargePortCourt ChargePortCourt     `json:"charge_port_court"`
	BlackBox        BlackBox            `json:"black_box"`
	Dictionary      OwnerDictionary     `json:"dictionary"`
	Vault           PhysicsVault        `json:"vault"`
	Modes           ModeLaws            `json:"modes"`
	NervousSystem   NervousSystem       `json:"nervous_system"`
	Range           RangeDisagreement   `json:"range"`
}
