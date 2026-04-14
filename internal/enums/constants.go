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

// DetailedChargeState values from Tesla.
const (
	ChargeStateCharging     = "Charging"
	ChargeStateComplete     = "Complete"
	ChargeStateDisconnected = "Disconnected"
	ChargeStateNoPower      = "NoPower"
	ChargeStateStarting     = "Starting"
	ChargeStateStopped      = "Stopped"
)

// Tesla raw enum prefixes.
const (
	PrefixShiftState     = "ShiftState"
	PrefixDetailedCharge = "DetailedChargeState"
	PrefixHvacPower      = "HvacPowerState"
	PrefixSentryMode     = "SentryModeState"
	PrefixDefrostMode    = "DefrostModeState"
	PrefixWindowState    = "WindowState"
)
