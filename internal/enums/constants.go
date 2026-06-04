package enums

// Gear states (normalized from Tesla's ShiftState* enum).
const (
	GearDrive   = "D"
	GearReverse = "R"
	GearPark    = "P"
	GearNeutral = "N"
)

// Vehicle operational states.
const (
	StateDriving  = "driving"
	StateCharging = "charging"
	StateParked   = "parked"
	StateAsleep   = "asleep"
	StateOnline   = "online"
	StateOffline  = "offline"
)

// DetailedChargeState values from Tesla proto (DetailedChargeStateValue).
const (
	ChargeStateCharging     = "Charging"
	ChargeStateComplete     = "Complete"
	ChargeStateDisconnected = "Disconnected"
	ChargeStateNoPower      = "NoPower"
	ChargeStateStarting     = "Starting"
	ChargeStateStopped      = "Stopped"
)

// SentryMode states from Tesla proto (SentryModeState).
const (
	SentryOff   = "Off"
	SentryIdle  = "Idle"
	SentryArmed = "Armed"
	SentryAware = "Aware"
	SentryPanic = "Panic"
	SentryQuiet = "Quiet"
)

// HvacPower states from Tesla proto (HvacPowerState).
const (
	HvacOff             = "Off"
	HvacOn              = "On"
	HvacPrecondition    = "Precondition"
	HvacOverheatProtect = "OverheatProtect"
)

// DefrostMode states from Tesla proto (DefrostModeState).
const (
	DefrostOff       = "Off"
	DefrostNormal    = "Normal"
	DefrostMax       = "Max"
	DefrostAutoDefog = "AutoDefog"
)

// ClimateKeeperMode states from Tesla proto (ClimateKeeperModeState).
const (
	ClimateKeeperOff   = "Off"
	ClimateKeeperOn    = "On"
	ClimateKeeperDog   = "Dog"
	ClimateKeeperParty = "Party"
)

// CabinOverheatProtection mode states from Tesla proto.
const (
	CabinOverheatOff     = "Off"
	CabinOverheatOn      = "On"
	CabinOverheatFanOnly = "FanOnly"
)

// DisplayState values from Tesla proto (DisplayState).
const (
	DisplayOff           = "Off"
	DisplayDim           = "Dim"
	DisplayAccessory     = "Accessory"
	DisplayOn            = "On"
	DisplayDriving       = "Driving"
	DisplayCharging      = "Charging"
	DisplayLock          = "Lock"
	DisplaySentry        = "Sentry"
	DisplayDog           = "Dog"
	DisplayEntertainment = "Entertainment"
)

// MediaPlaybackStatus from Tesla proto (MediaStatus).
const (
	MediaStopped = "Stopped"
	MediaPlaying = "Playing"
	MediaPaused  = "Paused"
)

// BMS states from Tesla proto (BMSStateValue).
const (
	BMSStandby = "Standby"
	BMSDrive   = "Drive"
	BMSSupport = "Support"
	BMSCharge  = "Charge"
	BMSFault   = "Fault"
)

// Tesla raw enum prefixes — used by parsers to strip prefix from raw strings.
const (
	PrefixShiftState              = "ShiftState"
	PrefixDetailedCharge          = "DetailedChargeState"
	PrefixHvacPower               = "HvacPowerState"
	PrefixSentryMode              = "SentryModeState"
	PrefixDefrostMode             = "DefrostModeState"
	PrefixWindowState             = "WindowState"
	PrefixChargePort              = "ChargePort"
	PrefixChargePortLatch         = "ChargePortLatch"
	PrefixCabinOverheatProtection = "CabinOverheatProtectionModeState"
	PrefixClimateKeeper           = "ClimateKeeperModeState"
	PrefixBMSState                = "BMSState"
	PrefixDisplayState            = "DisplayState"
	PrefixMediaStatus             = "MediaStatus"
	PrefixFollowDistance          = "FollowDistance"
	PrefixForwardCollision        = "ForwardCollisionSensitivity"
	PrefixLaneAssist              = "LaneAssistLevel"
	PrefixSpeedAssist             = "SpeedAssistLevel"
	PrefixDriveInverterState      = "DriveInverterState"
	PrefixTonneauPosition         = "TonneauPositionState"
	PrefixTonneauTentMode         = "TonneauTentMode"
	PrefixPowershareState         = "PowershareState"
	PrefixPowershareStopReason    = "PowershareStopReason"
	PrefixPowershareType          = "PowershareType"
	PrefixTurnSignal              = "TurnSignalState"
	PrefixScheduledChargingMode   = "ScheduledChargingMode"
	PrefixHvacAutoMode            = "HvacAutoModeState"
)
