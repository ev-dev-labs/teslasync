package database

// ColumnType indicates the Postgres type for type-aware encoding.
type ColumnType int

const (
	ColTypeNumeric   ColumnType = iota // float64 → double precision
	ColTypeVarchar                     // string → text/varchar
	ColTypeBool                        // bool → boolean
	ColTypeTimestamp                    // time.Time → timestamptz
)

// SignalMapping defines how a Tesla signal maps to a DB column.
type SignalMapping struct {
	Column string     // DB column name
	Type   ColumnType // Column type for encoding
}

// SignalCatalog is the single source of truth for Tesla signal → DB column mapping.
// Used by live_state_repo (UPSERT), automation_repo (condition checks),
// position_repo (INSERT), and any future signal consumers.
var SignalCatalog = map[string]SignalMapping{
	// Location
	"Latitude":   {Column: "latitude", Type: ColTypeNumeric},
	"Longitude":  {Column: "longitude", Type: ColTypeNumeric},
	"GpsHeading": {Column: "heading", Type: ColTypeNumeric},
	"GpsState":   {Column: "gps_state", Type: ColTypeVarchar},

	// Driving
	"VehicleSpeed": {Column: "speed_mph", Type: ColTypeNumeric},

	// Battery
	"BatteryLevel":   {Column: "battery_level", Type: ColTypeNumeric},
	"ChargeLimitSoc": {Column: "charge_limit_soc", Type: ColTypeNumeric},

	// Climate
	"InsideTemp":  {Column: "inside_temp_c", Type: ColTypeNumeric},
	"OutsideTemp": {Column: "outside_temp_c", Type: ColTypeNumeric},
	"DefrostMode": {Column: "defrost_mode", Type: ColTypeVarchar},

	// Charging
	"ChargerVoltage": {Column: "charger_voltage", Type: ColTypeNumeric},

	// Security (enum conversion handled in special handlers in live_state_repo)
	"Locked":     {Column: "locked", Type: ColTypeBool},
	"SentryMode": {Column: "sentry_mode", Type: ColTypeBool},
}

// Derived maps (computed once at init, used by live_state_repo)
var (
	SignalToColumn map[string]string
	IsVarcharCol   map[string]bool
	IsTimestampCol map[string]bool
)

func init() {
	SignalToColumn = make(map[string]string, len(SignalCatalog))
	IsVarcharCol = make(map[string]bool)
	IsTimestampCol = make(map[string]bool)
	for signal, m := range SignalCatalog {
		SignalToColumn[signal] = m.Column
		switch m.Type {
		case ColTypeVarchar:
			IsVarcharCol[m.Column] = true
		case ColTypeTimestamp:
			IsTimestampCol[m.Column] = true
		}
	}
}
