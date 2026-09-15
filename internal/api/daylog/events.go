package daylog

import (
	"fmt"
	"sort"
	"strconv"
	"time"

	daylogdb "github.com/ev-dev-labs/teslasync/internal/database/daylog"
)

// dayLogEventCap bounds the events array. Never unbounded: a noisy day
// must degrade to truncated=true, not a multi-MB response.
const dayLogEventCap = 500

// Layer IDs. LayerDefault is always on; the rest are opt-in via
// ?layers= and off by default (too noisy for the hero timeline).
const (
	LayerDefault     = "default"
	LayerTurnSignals = "turn_signals"
	LayerLights      = "lights"
	LayerDoorsWindow = "doors_windows"
	LayerHVAC        = "hvac"
	LayerGear        = "gear"
	LayerHomelink    = "homelink"
)

// ValidLayers is the allowlist for the ?layers= query param.
var ValidLayers = map[string]bool{
	LayerTurnSignals: true,
	LayerLights:      true,
	LayerDoorsWindow: true,
	LayerHVAC:        true,
	LayerGear:        true,
	LayerHomelink:    true,
}

// DefaultSignalFields are always queried from signal_log for the
// default layer, regardless of ?layers=.
var DefaultSignalFields = []string{"RemoteStartActive"}

// layerSignalFields maps each optional layer to its signal_log fields.
// Gear is absent: it reads drive_telemetry, not signal_log.
var layerSignalFields = map[string][]string{
	LayerTurnSignals: {"LightsTurnSignal"},
	LayerLights:      {"LightsHazardsActive", "LightsHighBeams"},
	LayerDoorsWindow: {
		"DoorStateDriverFront", "DoorStateDriverRear",
		"DoorStateFrontTrunk", "DoorStatePassengerFront",
		"DoorStatePassengerRear", "DoorStateRearTrunk",
		"FdWindow", "FpWindow", "RdWindow", "RpWindow",
	},
	LayerHVAC:     {"HvacPower"},
	LayerHomelink: {"HomelinkNearby", "LocatedAtHome", "LocatedAtWork", "LocatedAtFavorite"},
}

// SignalFieldsForLayers returns the deduplicated signal_log field list
// for the default layer plus the requested optional layers.
func SignalFieldsForLayers(layers []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(DefaultSignalFields)+8)
	add := func(f string) {
		if !seen[f] {
			seen[f] = true
			out = append(out, f)
		}
	}
	for _, f := range DefaultSignalFields {
		add(f)
	}
	for _, l := range layers {
		for _, f := range layerSignalFields[l] {
			add(f)
		}
	}
	return out
}

// WantsGear reports whether the gear layer (drive_telemetry source) is
// among the requested layers.
func WantsGear(layers []string) bool {
	for _, l := range layers {
		if l == LayerGear {
			return true
		}
	}
	return false
}

// Event is one timeline entry. RefKind/RefID address the deep-link
// target (drive/charge); Payload carries SI measures with snake_case
// keys and is always non-nil ({} when empty).
type Event struct {
	ID        string         `json:"id"`
	Ts        time.Time      `json:"ts"`
	Type      string         `json:"type"`
	Layer     string         `json:"layer"`
	VehicleID int64          `json:"vehicle_id"`
	RefKind   *string        `json:"ref_kind,omitempty"`
	RefID     *int64         `json:"ref_id,omitempty"`
	Payload   map[string]any `json:"payload"`
}

// Summary aggregates the sessions overlapping the window. Sums skip
// NULL measures; a sum with zero contributors is nil (unknown), never
// a fabricated 0. Counts are exact.
type Summary struct {
	DriveCount     int      `json:"drive_count"`
	ChargeCount    int      `json:"charge_count"`
	DriveDurationS *int64   `json:"drive_duration_s"`
	DriveDistanceM *float64 `json:"drive_distance_m"`
	EnergyAddedWh  *float64 `json:"energy_added_wh"`
	EnergyUsedWh   *float64 `json:"energy_used_wh"`
}

// Source honesty statuses.
const (
	SourceOK          = "ok"
	SourceEmpty       = "empty"
	SourceUnavailable = "unavailable"
)

// Source describes one input stream's contribution: which table was
// read, whether it had rows, and why not when it could not be read.
type Source struct {
	Source string  `json:"source"`
	Status string  `json:"status"`
	Count  int     `json:"count"`
	Reason *string `json:"reason,omitempty"`
}

// DayLogResponse is the GET /api/v1/day-log envelope. All field names
// are snake_case, matching the frontend types one-for-one.
type DayLogResponse struct {
	VehicleID int64     `json:"vehicle_id"`
	Date      string    `json:"date"`
	Timezone  string    `json:"timezone"`
	DayStart  time.Time `json:"day_start"`
	DayEnd    time.Time `json:"day_end"`
	Truncated bool      `json:"truncated"`
	Layers    []string  `json:"layers"`
	Summary   Summary   `json:"summary"`
	Sources   []Source  `json:"sources"`
	Events    []Event   `json:"events"`
}

// TimelineInput is the raw per-source repo output for one day window.
type TimelineInput struct {
	VehicleID      int64
	WindowStart    time.Time
	WindowEnd      time.Time
	Layers         []string
	Drives         []daylogdb.DayDrive
	Charges        []daylogdb.DayCharge
	FSM            []daylogdb.DayFSMTransition
	Security       []daylogdb.DaySecurityEvent
	Signals        []daylogdb.DaySignalRow
	SignalOverflow bool
	Gears          []daylogdb.DayGearTick
	GearOverflow   bool
	Software       []daylogdb.DaySoftwareUpdate
}

// TimelineOutput is the assembled timeline: sorted, capped events plus
// summary and source honesty.
type TimelineOutput struct {
	Events    []Event
	Summary   Summary
	Sources   []Source
	Truncated bool
}

func strPtr(s string) *string { return &s }
func int64Ptr(v int64) *int64 { return &v }

func newEvent(vehicleID int64, id string, ts time.Time, typ, layer string) Event {
	return Event{ID: id, Ts: ts, Type: typ, Layer: layer, VehicleID: vehicleID, Payload: map[string]any{}}
}

func inWindow(ts, start, end time.Time) bool {
	return !ts.Before(start) && !ts.After(end)
}

// BuildTimeline merges per-source rows into one time-ordered,
// hard-capped event list. Pure Go: no I/O, fully unit-testable.
func BuildTimeline(in TimelineInput) TimelineOutput {
	events := make([]Event, 0, 64)
	vid := in.VehicleID

	for _, d := range in.Drives {
		if inWindow(d.StartedAt, in.WindowStart, in.WindowEnd) {
			e := newEvent(vid, fmt.Sprintf("drive:%d:start", d.ID), d.StartedAt, "drive_start", LayerDefault)
			e.RefKind, e.RefID = strPtr("drive"), int64Ptr(d.ID)
			if d.StartPlace != nil {
				e.Payload["start_place"] = *d.StartPlace
			}
			if d.StartSocPct != nil {
				e.Payload["start_soc_pct"] = *d.StartSocPct
			}
			events = append(events, e)
		}
		if d.EndedAt != nil && inWindow(*d.EndedAt, in.WindowStart, in.WindowEnd) {
			e := newEvent(vid, fmt.Sprintf("drive:%d:end", d.ID), *d.EndedAt, "drive_end", LayerDefault)
			e.RefKind, e.RefID = strPtr("drive"), int64Ptr(d.ID)
			if d.EndPlace != nil {
				e.Payload["end_place"] = *d.EndPlace
			}
			if d.DistanceM != nil {
				e.Payload["distance_m"] = *d.DistanceM
			}
			if d.DurationS != nil {
				e.Payload["duration_s"] = *d.DurationS
			}
			if d.EnergyUsedWh != nil {
				e.Payload["energy_used_wh"] = *d.EnergyUsedWh
			}
			if d.EndSocPct != nil {
				e.Payload["end_soc_pct"] = *d.EndSocPct
			}
			events = append(events, e)
		}
	}

	for _, c := range in.Charges {
		if inWindow(c.StartedAt, in.WindowStart, in.WindowEnd) {
			e := newEvent(vid, fmt.Sprintf("charge:%d:start", c.ID), c.StartedAt, "charge_start", LayerDefault)
			e.RefKind, e.RefID = strPtr("charge"), int64Ptr(c.ID)
			if c.StartPlace != nil {
				e.Payload["start_place"] = *c.StartPlace
			}
			if c.StartSocPct != nil {
				e.Payload["start_soc_pct"] = *c.StartSocPct
			}
			events = append(events, e)
		}
		if c.EndedAt != nil && inWindow(*c.EndedAt, in.WindowStart, in.WindowEnd) {
			e := newEvent(vid, fmt.Sprintf("charge:%d:end", c.ID), *c.EndedAt, "charge_end", LayerDefault)
			e.RefKind, e.RefID = strPtr("charge"), int64Ptr(c.ID)
			durS := c.EndedAt.Sub(c.StartedAt).Seconds()
			if durS < 0 {
				durS = 0
			}
			e.Payload["duration_s"] = int64(durS)
			if c.TotalEnergyAddedWh != nil {
				e.Payload["energy_added_wh"] = *c.TotalEnergyAddedWh
			}
			if c.EndSocPct != nil {
				e.Payload["end_soc_pct"] = *c.EndSocPct
			}
			events = append(events, e)
		}
	}

	for _, t := range in.FSM {
		typ, ok := fsmEventType(t.ToState)
		if !ok {
			// driving/charging targets are session-covered; skip.
			continue
		}
		e := newEvent(vid, fmt.Sprintf("fsm:%d", t.ID), t.Ts, typ, LayerDefault)
		if t.FromState != nil {
			e.Payload["from_state"] = *t.FromState
		}
		if typ == "state_change" {
			e.Payload["to_state"] = t.ToState
		}
		events = append(events, e)
	}

	for _, s := range in.Security {
		switch s.EventType {
		case "locked":
			typ := "lock_unknown"
			if s.ToState != nil {
				switch *s.ToState {
				case "true":
					typ = "locked"
				case "false":
					typ = "unlocked"
				}
			}
			e := newEvent(vid, fmt.Sprintf("sec:%d", s.ID), s.Ts, typ, LayerDefault)
			if typ == "lock_unknown" && s.ToState != nil {
				e.Payload["state"] = *s.ToState
			}
			events = append(events, e)
		case "sentry_mode":
			typ := "sentry_unknown"
			if s.ToState != nil && *s.ToState != "" {
				if *s.ToState == sentryModeOffToken || *s.ToState == sentryModeUnknownToken {
					typ = "sentry_off"
				} else {
					typ = "sentry_on"
				}
			}
			e := newEvent(vid, fmt.Sprintf("sec:%d", s.ID), s.Ts, typ, LayerDefault)
			if s.ToState != nil {
				e.Payload["state"] = *s.ToState
			}
			events = append(events, e)
		default:
			// valet_mode_enabled and future types are out of v1 scope.
		}
	}

	for _, edge := range signalEdges(in.Signals) {
		events = append(events, signalEdgeEvents(vid, edge)...)
	}

	for _, g := range gearEdges(in.Gears) {
		e := newEvent(vid, fmt.Sprintf("gear:%d", g.Ts.UnixNano()), g.Ts, "gear", LayerGear)
		e.Payload["gear"] = g.Gear
		events = append(events, e)
	}

	for _, u := range in.Software {
		if inWindow(u.CreatedAt, in.WindowStart, in.WindowEnd) {
			e := newEvent(vid, fmt.Sprintf("sw:%d:created", u.ID), u.CreatedAt, "sw_update", LayerDefault)
			e.Payload["version"] = u.Version
			e.Payload["status"] = u.Status
			events = append(events, e)
		}
		if u.InstalledAt != nil && inWindow(*u.InstalledAt, in.WindowStart, in.WindowEnd) {
			e := newEvent(vid, fmt.Sprintf("sw:%d:installed", u.ID), *u.InstalledAt, "sw_update_installed", LayerDefault)
			e.Payload["version"] = u.Version
			events = append(events, e)
		}
	}

	sort.SliceStable(events, func(i, j int) bool {
		if events[i].Ts.Equal(events[j].Ts) {
			return events[i].ID < events[j].ID
		}
		return events[i].Ts.Before(events[j].Ts)
	})

	truncated := in.SignalOverflow || in.GearOverflow
	if len(events) > dayLogEventCap {
		events = events[:dayLogEventCap]
		truncated = true
	}

	return TimelineOutput{
		Events:    events,
		Summary:   buildSummary(in.Drives, in.Charges),
		Sources:   buildSources(in),
		Truncated: truncated,
	}
}

// fsmEventType maps an FSM target state to its event type. Driving and
// charging targets report ok=false: session rows already carry those
// boundaries and emitting both would double count every trip. Unknown
// targets degrade to a generic state_change carrying from/to.
func fsmEventType(toState string) (typ string, ok bool) {
	switch toState {
	case "parked":
		return "parked", true
	case "online":
		return "online", true
	case "asleep":
		return "asleep", true
	case "offline":
		return "offline", true
	case "driving", "Driving", "charging", "Charging":
		return "", false
	default:
		return "state_change", true
	}
}

// sentryModeOffToken + sentryModeUnknownToken mirror the guard repo's
// rule (internal/database/system/guard_repo.go): these two proto-enum
// String() outputs mean Sentry is NOT active; every other state means
// it is enabled even when not alarming.
const (
	sentryModeOffToken     = "SentryModeStateOff"
	sentryModeUnknownToken = "SentryModeStateUnknown"
)

// signalEdge is one in-window value transition for a field.
type signalEdge struct {
	Field string
	Ts    time.Time
	Row   daylogdb.DaySignalRow
}

// signalEdges detects per-field transitions over chronological rows.
// The first observation per field is the baseline and emits nothing:
// state-at-midnight is not something that happened today. Rows with no
// typed value are uninterpretable and skipped.
func signalEdges(rows []daylogdb.DaySignalRow) []signalEdge {
	seen := map[string]string{}
	out := make([]signalEdge, 0)
	for _, r := range rows {
		repr, ok := signalRepr(r)
		if !ok {
			continue
		}
		prev, exists := seen[r.Field]
		seen[r.Field] = repr
		if !exists || prev == repr {
			continue
		}
		out = append(out, signalEdge{Field: r.Field, Ts: r.Ts, Row: r})
	}
	return out
}

// signalRepr is the canonical comparable form of a signal row. HvacPower
// is binary (off = exactly 0 watts, on = anything else) so normal power
// fluctuation does not emit an edge per tick.
func signalRepr(r daylogdb.DaySignalRow) (string, bool) {
	if r.Field == "HvacPower" {
		if r.FloatValue == nil {
			return "", false
		}
		if *r.FloatValue == 0 {
			return "p:off", true
		}
		return "p:on", true
	}
	switch {
	case r.BoolValue != nil:
		return "b:" + strconv.FormatBool(*r.BoolValue), true
	case r.IntValue != nil:
		return "i:" + strconv.FormatInt(*r.IntValue, 10), true
	case r.FloatValue != nil:
		return "f:" + strconv.FormatFloat(*r.FloatValue, 'g', -1, 64), true
	case r.StrValue != nil:
		return "s:" + *r.StrValue, true
	default:
		return "", false
	}
}

// doorFieldSuffix maps DoorState* fields to short door IDs. Explicit
// map, not runtime camelCase surgery, so the reviewer sees every token.
var doorFieldSuffix = map[string]string{
	"DoorStateDriverFront":    "driver_front",
	"DoorStateDriverRear":     "driver_rear",
	"DoorStateFrontTrunk":     "front_trunk",
	"DoorStatePassengerFront": "passenger_front",
	"DoorStatePassengerRear":  "passenger_rear",
	"DoorStateRearTrunk":      "rear_trunk",
}

// windowFieldSuffix maps *Window fields to short window IDs.
var windowFieldSuffix = map[string]string{
	"FdWindow": "fd",
	"FpWindow": "fp",
	"RdWindow": "rd",
	"RpWindow": "rp",
}

// typedSignalValue returns the row's non-nil typed value for payloads.
func typedSignalValue(r daylogdb.DaySignalRow) any {
	switch {
	case r.BoolValue != nil:
		return *r.BoolValue
	case r.IntValue != nil:
		return *r.IntValue
	case r.FloatValue != nil:
		return *r.FloatValue
	case r.StrValue != nil:
		return *r.StrValue
	default:
		return nil
	}
}

// signalEdgeEvents maps one edge to its event(s). Unknown fields emit
// nothing: only taxonomy-mapped fields reach the timeline.
func signalEdgeEvents(vehicleID int64, edge signalEdge) []Event {
	mk := func(typ, layer string) Event {
		return newEvent(vehicleID, fmt.Sprintf("sig:%s:%d", edge.Field, edge.Ts.UnixNano()), edge.Ts, typ, layer)
	}
	boolVal := edge.Row.BoolValue != nil && *edge.Row.BoolValue

	switch edge.Field {
	case "RemoteStartActive":
		if boolVal {
			return []Event{mk("remote_start_on", LayerDefault)}
		}
		return []Event{mk("remote_start_off", LayerDefault)}
	case "LightsTurnSignal":
		e := mk("turn_signal", LayerTurnSignals)
		// Enum number, deliberately unlabeled: hand-written enum
		// parsers are forbidden, so the raw value rides along.
		e.Payload["value"] = typedSignalValue(edge.Row)
		return []Event{e}
	case "LightsHazardsActive":
		if boolVal {
			return []Event{mk("hazards_on", LayerLights)}
		}
		return []Event{mk("hazards_off", LayerLights)}
	case "LightsHighBeams":
		if boolVal {
			return []Event{mk("high_beams_on", LayerLights)}
		}
		return []Event{mk("high_beams_off", LayerLights)}
	case "HvacPower":
		if boolVal || (edge.Row.FloatValue != nil && *edge.Row.FloatValue != 0) {
			e := mk("hvac_on", LayerHVAC)
			if edge.Row.FloatValue != nil {
				e.Payload["power_w"] = *edge.Row.FloatValue
			}
			return []Event{e}
		}
		return []Event{mk("hvac_off", LayerHVAC)}
	case "HomelinkNearby":
		if boolVal {
			return []Event{mk("homelink_nearby_on", LayerHomelink)}
		}
		return []Event{mk("homelink_nearby_off", LayerHomelink)}
	case "LocatedAtHome":
		if boolVal {
			return []Event{mk("arrived_home", LayerHomelink)}
		}
		return []Event{mk("left_home", LayerHomelink)}
	case "LocatedAtWork":
		if boolVal {
			return []Event{mk("arrived_work", LayerHomelink)}
		}
		return []Event{mk("left_work", LayerHomelink)}
	case "LocatedAtFavorite":
		if boolVal {
			return []Event{mk("arrived_favorite", LayerHomelink)}
		}
		return []Event{mk("left_favorite", LayerHomelink)}
	default:
		if door, ok := doorFieldSuffix[edge.Field]; ok {
			var e Event
			if boolVal {
				e = mk("door_open", LayerDoorsWindow)
			} else {
				e = mk("door_closed", LayerDoorsWindow)
			}
			e.Payload["door"] = door
			return []Event{e}
		}
		if window, ok := windowFieldSuffix[edge.Field]; ok {
			e := mk("window", LayerDoorsWindow)
			e.Payload["window"] = window
			e.Payload["value"] = typedSignalValue(edge.Row)
			return []Event{e}
		}
		return nil
	}
}

// gearEdges detects gear changes over chronological ticks. The first
// tick is the baseline and emits nothing.
func gearEdges(ticks []daylogdb.DayGearTick) []daylogdb.DayGearTick {
	out := make([]daylogdb.DayGearTick, 0)
	var prev string
	var seen bool
	for _, t := range ticks {
		if !seen {
			prev, seen = t.Gear, true
			continue
		}
		if t.Gear != prev {
			out = append(out, t)
			prev = t.Gear
		}
	}
	return out
}

func buildSummary(drives []daylogdb.DayDrive, charges []daylogdb.DayCharge) Summary {
	s := Summary{DriveCount: len(drives), ChargeCount: len(charges)}
	var dur int64
	var durN int
	var dist, added, used float64
	var distN, addedN, usedN int
	for _, d := range drives {
		if d.DurationS != nil {
			dur += *d.DurationS
			durN++
		}
		if d.DistanceM != nil {
			dist += *d.DistanceM
			distN++
		}
		if d.EnergyUsedWh != nil {
			used += *d.EnergyUsedWh
			usedN++
		}
	}
	for _, c := range charges {
		if c.TotalEnergyAddedWh != nil {
			added += *c.TotalEnergyAddedWh
			addedN++
		}
	}
	if durN > 0 {
		s.DriveDurationS = &dur
	}
	if distN > 0 {
		s.DriveDistanceM = &dist
	}
	if addedN > 0 {
		s.EnergyAddedWh = &added
	}
	if usedN > 0 {
		s.EnergyUsedWh = &used
	}
	return s
}

func sourceStatus(count int) string {
	if count > 0 {
		return SourceOK
	}
	return SourceEmpty
}

func buildSources(in TimelineInput) []Source {
	sources := []Source{
		{Source: "drives", Status: sourceStatus(len(in.Drives)), Count: len(in.Drives)},
		{Source: "charging_sessions", Status: sourceStatus(len(in.Charges)), Count: len(in.Charges)},
		{Source: "fsm_transitions", Status: sourceStatus(len(in.FSM)), Count: len(in.FSM)},
		{Source: "security_events", Status: sourceStatus(len(in.Security)), Count: len(in.Security)},
		{Source: "software_updates", Status: sourceStatus(len(in.Software)), Count: len(in.Software)},
		{Source: "signal_log", Status: sourceStatus(len(in.Signals)), Count: len(in.Signals)},
	}
	if WantsGear(in.Layers) {
		sources = append(sources, Source{Source: "drive_telemetry", Status: sourceStatus(len(in.Gears)), Count: len(in.Gears)})
	}
	// user_present has no telemetry signal and no table; the legacy
	// security_snapshots table is dropped (ADR-001). Reported as
	// unavailable so the UI can say so instead of guessing.
	sources = append(sources, Source{
		Source: "user_presence",
		Status: SourceUnavailable,
		Count:  0,
		Reason: strPtr("no signal or table records occupant presence"),
	})
	return sources
}
