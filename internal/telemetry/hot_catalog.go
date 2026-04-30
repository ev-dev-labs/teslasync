package telemetry

// SignalKind classifies how a raw Fleet Telemetry value is converted before write.
type SignalKind string

const (
	KindNumeric          SignalKind = "numeric"
	KindText             SignalKind = "text"
	KindBool             SignalKind = "bool"
	KindEnumNormalized   SignalKind = "enum_normalized"
	KindCompoundDoors    SignalKind = "compound_doors"
	KindCompoundWindows  SignalKind = "compound_windows"
	KindCompoundLocation SignalKind = "compound_location"
	KindCompoundTime     SignalKind = "compound_time"
	KindCompoundShift    SignalKind = "compound_shift"
)

// Transformer converts a raw Fleet Telemetry value to the typed value
// the destination column expects. nil = pass-through.
type Transformer func(raw any) (any, error)

// HotRoute tells the telemetry handler "for signal X, write to table T column C
// using transformer F". An empty Column means the entry is a compound that must
// be Flatten()-ed first into atomic sub-signals which then re-route through the
// catalog.
type HotRoute struct {
	Name        string
	Table       string
	Column      string
	Kind        SignalKind
	Transformer Transformer
}

// HotCatalog is the static routing table. Keys are Tesla signal names exactly
// as Fleet Telemetry emits them. Populated by per-table init blocks in
// hot_catalog_*.go files (prompts 03-08).
var HotCatalog = map[string]HotRoute{}

// LookupHot returns the routing entry, or nil if the signal is cold
// (i.e., should land in signal_observations).
func LookupHot(name string) *HotRoute {
	if h, ok := HotCatalog[name]; ok {
		return &h
	}
	return nil
}
