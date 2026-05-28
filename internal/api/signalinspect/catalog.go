package signalinspect

import (
	"sort"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

// AvailableSignal is the JSON shape returned by the signal-catalog APIs
// (e.g. GET /api/v1/signals/{vehicleID}/available). It mirrors the
// vendor-neutral protomodel.SignalMeta with snake_case keys so the
// frontend can switch on `value_kind` to render the correct typed
// editor without parsing strings.
type AvailableSignal struct {
	Name          string `json:"name"`
	Category      string `json:"category"`
	ValueKind     string `json:"value_kind"`
	UnitKind      string `json:"unit_kind"`
	IsCompound    bool   `json:"is_compound"`
	IsSettingUnit bool   `json:"is_setting_unit"`
}

// AvailableSignals returns the canonical Tesla telemetry signal catalog
// derived from protomodel.Signals. Driving the catalog from the vendored
// proto means the API never drifts from the codec / router layer (see
// ADR-004 #2 — the routing layer is the single source of truth for
// "what's actively ingested"). Sentinel proto entries (Unknown,
// Deprecated_*, Experimental_*, Semitruck*) are filtered out so the
// frontend only sees fields that actually flow through the pipeline.
//
// Compound parents (IsCompound=true, e.g. Location) are kept in the
// catalog so callers can discover the parent name; the codec flattens
// compounds into typed atomic children before they reach the live store
// or signal_log, so the queryable history keys are the children, not
// the parent. The is_compound flag lets the frontend distinguish.
func AvailableSignals() []AvailableSignal {
	out := make([]AvailableSignal, 0, len(protomodel.Signals))
	for i := range protomodel.Signals {
		s := &protomodel.Signals[i]
		if !isSubscribableSignal(s) {
			continue
		}
		out = append(out, AvailableSignal{
			Name:          s.Field,
			Category:      s.Category,
			ValueKind:     s.ValueKind.String(),
			UnitKind:      s.UnitKind.String(),
			IsCompound:    s.IsCompound,
			IsSettingUnit: s.IsSettingUnit,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// SubscribedSignals lists the Tesla Fleet Telemetry signal names that
// the API actively subscribes to. Derived from protomodel.Signals at
// process start so the list cannot drift from the vendored proto. The
// /system/status health response surfaces it as `supported_signals`.
//
// Forward-only / Phase-42: replaces the hand-curated static list that
// used to live in this file. The static list shipped pre-Phase-42 and
// would silently fall behind whenever the proto bumped; deriving from
// protomodel makes a proto bump automatically refresh the catalog.
var SubscribedSignals = subscribedSignalsFromProtomodel()

func subscribedSignalsFromProtomodel() []string {
	names := make([]string, 0, len(protomodel.Signals))
	for i := range protomodel.Signals {
		s := &protomodel.Signals[i]
		if !isSubscribableSignal(s) {
			continue
		}
		names = append(names, s.Field)
	}
	sort.Strings(names)
	return names
}

// isSubscribableSignal returns false for proto sentinels and
// reserved-bucket fields that are not real telemetry: Unknown (proto
// enum number 0), Deprecated_*, Experimental_*, and the Semitruck*
// fields. These exist in the vendored proto for forward / backward
// compatibility but should never appear in subscriptions or in the
// frontend signal catalog. Entries with ValueKindUnknown are also
// filtered — the codec cannot decode them, so exposing them would
// invite the frontend to query for data that never lands.
func isSubscribableSignal(s *protomodel.SignalMeta) bool {
	if s == nil || s.Field == "" || s.Field == "Unknown" {
		return false
	}
	if strings.HasPrefix(s.Field, "Deprecated_") {
		return false
	}
	if strings.HasPrefix(s.Field, "Experimental_") {
		return false
	}
	if strings.HasPrefix(s.Field, "Semitruck") {
		return false
	}
	if s.ValueKind == protomodel.ValueKindUnknown {
		return false
	}
	return true
}
