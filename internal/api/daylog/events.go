package daylog

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	daylogdb "github.com/ev-dev-labs/teslasync/internal/database/daylog"
)

// dayLogDefaultLimit is the page size when the caller passes no limit.
// Paging exists so a huge day stays transferable; completeness comes
// from total_events + offset paging, never from silently dropping rows.
const dayLogDefaultLimit = 500

// dayLogMaxLimit caps a single page so one request cannot demand an
// unbounded response. Callers page with offset to reach every event.
const dayLogMaxLimit = 2000

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

// AllLayers is every optional layer, in stable order. An omitted or
// blank ?layers= param resolves to AllLayers: the default view is the
// complete history, not a filtered subset.
var AllLayers = []string{
	LayerTurnSignals,
	LayerLights,
	LayerDoorsWindow,
	LayerHVAC,
	LayerGear,
	LayerHomelink,
}

// Event sources, one per backing table. Served on every event so the
// UI can show provenance and unrecognized types keep their identity.
const (
	SourceDrives    = "drives"
	SourceCharges   = "charging_sessions"
	SourceFSM       = "fsm_transitions"
	SourceSecurity  = "security_events"
	SourceSoftware  = "software_updates"
	SourceSignalLog = "signal_log"
	SourceGear      = "drive_telemetry"
)

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

// FieldLayersForLayers inverts the layer→fields table for the requested
// layers (plus the default fields), so generic fallback events land on
// the layer that queried them.
func FieldLayersForLayers(layers []string) map[string]string {
	out := map[string]string{}
	for _, f := range DefaultSignalFields {
		out[f] = LayerDefault
	}
	for _, l := range layers {
		for _, f := range layerSignalFields[l] {
			out[f] = l
		}
	}
	return out
}

// Event is one timeline entry. RefKind/RefID address the deep-link
// target (drive/charge); Payload carries SI measures with snake_case
// keys and is always non-nil ({} when empty). Source names the backing
// table so rows keep their provenance in the UI.
type Event struct {
	ID        string         `json:"id"`
	Ts        time.Time      `json:"ts"`
	Type      string         `json:"type"`
	Layer     string         `json:"layer"`
	VehicleID int64          `json:"vehicle_id"`
	Source    string         `json:"source"`
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
// are snake_case, matching the frontend types one-for-one. total_events
// counts every assembled event before paging; a page is complete only
// when offset+len(events) reaches it.
type DayLogResponse struct {
	VehicleID   int64     `json:"vehicle_id"`
	Date        string    `json:"date"`
	Timezone    string    `json:"timezone"`
	DayStart    time.Time `json:"day_start"`
	DayEnd      time.Time `json:"day_end"`
	Truncated   bool      `json:"truncated"`
	TotalEvents int       `json:"total_events"`
	Limit       int       `json:"limit"`
	Offset      int       `json:"offset"`
	Layers      []string  `json:"layers"`
	Summary     Summary   `json:"summary"`
	Sources     []Source  `json:"sources"`
	Events      []Event   `json:"events"`
}

// TimelineInput is the raw per-source repo output for one day window.
type TimelineInput struct {
	VehicleID   int64
	WindowStart time.Time
	WindowEnd   time.Time
	Layers      []string
	// FieldLayers maps each queried signal field to its layer, so
	// generic fallback events keep the right layer. Built from the
	// same layer→fields table as the query.
	FieldLayers map[string]string
	// PrevSecurity holds the latest pre-window to_state per security
	// event type, seeding previous-state reporting for the first
	// in-window transition of each series.
	PrevSecurity   map[string]*string
	Drives         []daylogdb.DayDrive
	Charges        []daylogdb.DayCharge
	FSM            []daylogdb.DayFSMTransition
	Security       []daylogdb.DaySecurityEvent
	Signals        []daylogdb.DaySignalRow
	SignalOverflow bool
	Gears          []daylogdb.DayGearTick
	GearOverflow   bool
	Software       []daylogdb.DaySoftwareUpdate
	// Limit/Offset page the merged list. Limit <= 0 means the default
	// page size; callers clamp to dayLogMaxLimit first.
	Limit  int
	Offset int
}

// TimelineOutput is the assembled timeline: sorted, paged events plus
// summary and source honesty. Total counts every event before paging;
// Truncated reports data LOSS (input caps hit), never paging.
type TimelineOutput struct {
	Events    []Event
	Summary   Summary
	Sources   []Source
	Total     int
	Truncated bool
}

func strPtr(s string) *string { return &s }
func int64Ptr(v int64) *int64 { return &v }

func newEvent(vehicleID int64, id string, ts time.Time, typ, layer, source string) Event {
	return Event{ID: id, Ts: ts, Type: typ, Layer: layer, VehicleID: vehicleID, Source: source, Payload: map[string]any{}}
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
			e := newEvent(vid, fmt.Sprintf("drive:%d:start", d.ID), d.StartedAt, "drive_start", LayerDefault, SourceDrives)
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
			e := newEvent(vid, fmt.Sprintf("drive:%d:end", d.ID), *d.EndedAt, "drive_end", LayerDefault, SourceDrives)
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
			e := newEvent(vid, fmt.Sprintf("charge:%d:start", c.ID), c.StartedAt, "charge_start", LayerDefault, SourceCharges)
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
			e := newEvent(vid, fmt.Sprintf("charge:%d:end", c.ID), *c.EndedAt, "charge_end", LayerDefault, SourceCharges)
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
		e := newEvent(vid, fmt.Sprintf("fsm:%d", t.ID), t.Ts, typ, LayerDefault, SourceFSM)
		if t.FromState != nil {
			e.Payload["from"] = *t.FromState
		}
		e.Payload["to"] = t.ToState
		events = append(events, e)
	}

	// lastSecurity chains previous states within the window, seeded
	// with the pre-window baseline: rows arrive chronological, so the
	// previous row of the same series is the honest "from".
	lastSecurity := map[string]*string{}
	for typ, prev := range in.PrevSecurity {
		lastSecurity[typ] = prev
	}
	for _, s := range in.Security {
		from := lastSecurity[s.EventType]
		lastSecurity[s.EventType] = s.ToState
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
			e := newEvent(vid, fmt.Sprintf("sec:%d", s.ID), s.Ts, typ, LayerDefault, SourceSecurity)
			setSecurityFromTo(e.Payload, from, s.ToState, true)
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
			e := newEvent(vid, fmt.Sprintf("sec:%d", s.ID), s.Ts, typ, LayerDefault, SourceSecurity)
			setSecurityFromTo(e.Payload, from, s.ToState, false)
			events = append(events, e)
		case "valet_mode_enabled":
			typ := "valet_unknown"
			if s.ToState != nil {
				switch *s.ToState {
				case "true":
					typ = "valet_on"
				case "false":
					typ = "valet_off"
				}
			}
			e := newEvent(vid, fmt.Sprintf("sec:%d", s.ID), s.Ts, typ, LayerDefault, SourceSecurity)
			setSecurityFromTo(e.Payload, from, s.ToState, true)
			events = append(events, e)
		default:
			// Unrecognized security types surface as generic events
			// with their source label — they must not disappear.
			e := newEvent(vid, fmt.Sprintf("sec:%d", s.ID), s.Ts, "security", LayerDefault, SourceSecurity)
			e.Payload["event_type"] = s.EventType
			setSecurityFromTo(e.Payload, from, s.ToState, false)
			events = append(events, e)
		}
	}

	for _, edge := range signalEdges(in.Signals) {
		events = append(events, signalEdgeEvents(vid, edge, in.FieldLayers)...)
	}

	for _, g := range gearEdges(in.Gears) {
		e := newEvent(vid, fmt.Sprintf("gear:%d", g.To.Ts.UnixNano()), g.To.Ts, "gear", LayerGear, SourceGear)
		fromShort, _ := gearShortForm(g.From.Gear)
		toShort, _ := gearShortForm(g.To.Gear)
		e.Payload["from"] = fromShort
		e.Payload["to"] = toShort
		// Raw stored tokens ride along: the writer stores proto
		// String() ("ShiftStateD"), sometimes short ("D").
		e.Payload["from_raw"] = g.From.Gear
		e.Payload["to_raw"] = g.To.Gear
		events = append(events, e)
	}

	for _, u := range in.Software {
		if inWindow(u.CreatedAt, in.WindowStart, in.WindowEnd) {
			e := newEvent(vid, fmt.Sprintf("sw:%d:created", u.ID), u.CreatedAt, "sw_update", LayerDefault, SourceSoftware)
			e.Payload["version"] = u.Version
			e.Payload["status"] = u.Status
			events = append(events, e)
		}
		if u.InstalledAt != nil && inWindow(*u.InstalledAt, in.WindowStart, in.WindowEnd) {
			e := newEvent(vid, fmt.Sprintf("sw:%d:installed", u.ID), *u.InstalledAt, "sw_update_installed", LayerDefault, SourceSoftware)
			e.Payload["version"] = u.Version
			events = append(events, e)
		}
	}

	// Stable by ts only: same-timestamp rows keep their per-source DB
	// order (each query carries an id tiebreak), and cross-source ties
	// keep assembly order — a documented, deterministic choice, since
	// no global order exists across tables.
	sort.SliceStable(events, func(i, j int) bool {
		return events[i].Ts.Before(events[j].Ts)
	})

	total := len(events)
	limit := in.Limit
	if limit <= 0 {
		limit = dayLogDefaultLimit
	}
	offset := in.Offset
	if offset < 0 {
		offset = 0
	}
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	page := events[offset:end]

	return TimelineOutput{
		Events:    page,
		Summary:   buildSummary(in.Drives, in.Charges),
		Sources:   buildSources(in),
		Total:     total,
		Truncated: in.SignalOverflow || in.GearOverflow,
	}
}

// setSecurityFromTo records the previous → new state on a security
// payload. Known bool series (locked, valet) normalize "true"/"false"
// to JSON booleans; everything else keeps the raw stored token.
// Absent states are omitted, never invented.
func setSecurityFromTo(payload map[string]any, from, to *string, bools bool) {
	setOne := func(key string, v *string) {
		if v == nil || *v == "" {
			return
		}
		if bools {
			switch *v {
			case "true":
				payload[key] = true
				return
			case "false":
				payload[key] = false
				return
			}
		}
		payload[key] = *v
	}
	setOne("from", from)
	setOne("to", to)
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

// signalEdge is one in-window value transition for a field, carrying
// both rows so payloads can report previous → new.
type signalEdge struct {
	Field string
	Ts    time.Time
	From  daylogdb.DaySignalRow
	To    daylogdb.DaySignalRow
}

// signalEdges detects per-field transitions over chronological rows.
// The first observation per field is the baseline and emits nothing:
// state-at-midnight is not something that happened today. Rows with no
// typed value are uninterpretable and skipped. Rapid repeat
// transitions are preserved, never merged: every change is an edge.
func signalEdges(rows []daylogdb.DaySignalRow) []signalEdge {
	seen := map[string]daylogdb.DaySignalRow{}
	out := make([]signalEdge, 0)
	for _, r := range rows {
		repr, ok := signalRepr(r)
		if !ok {
			continue
		}
		prev, exists := seen[r.Field]
		seen[r.Field] = r
		if !exists {
			continue
		}
		prevRepr, ok := signalRepr(prev)
		if !ok || prevRepr == repr {
			continue
		}
		out = append(out, signalEdge{Field: r.Field, Ts: r.Ts, From: prev, To: r})
	}
	return out
}

// signalRepr is the canonical comparable form of a signal row: the
// first non-nil typed column, tagged by kind.
func signalRepr(r daylogdb.DaySignalRow) (string, bool) {
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

// Display labels for signal_log enum numbers. These are READ-side
// display maps only: they interpret already-stored ints for the
// timeline, they do not touch the ingest pipeline, and they neither
// import the proto bindings nor re-run prefix-stripping. Each map cites
// its generated source; the parity test pins every entry against the
// generated String() output so proto drift fails loudly instead of
// mislabeling.
var (
	// TurnSignalState (api/proto/tesla/vehicle_data.proto,
	// protomodel TurnSignalState 0..4). Direction IS in the data.
	turnSignalShort = map[int64]string{
		0: "unknown",
		1: "off",
		2: "left",
		3: "right",
		4: "both",
	}
	// WindowState (protomodel WindowState 0..3).
	windowShort = map[int64]string{
		0: "unknown",
		1: "closed",
		2: "partial",
		3: "open",
	}
	// HvacPowerState (protomodel HvacPowerState 0..4). HvacPower is
	// an enum in signal_log, not watts — int_value carries it.
	hvacShort = map[int64]string{
		0: "unknown",
		1: "off",
		2: "on",
		3: "precondition",
		4: "overheat_protect",
	}
)

// enumShort resolves a stored enum number through a display map. ok is
// false for unknown numbers: callers must show the raw number, never
// guess a label.
func enumShort(m map[int64]string, v *int64) (string, bool) {
	if v == nil {
		return "", false
	}
	s, ok := m[*v]
	return s, ok
}

// gearShortForm normalizes a drive_telemetry.gear token to its short
// form. The writer stores proto String() ("ShiftStateD") and accepts
// pre-shortened values ("D"), so both are legitimate stored forms and
// both map here — this is read-side display normalization of stored
// text, not pipeline enum parsing. Unknown tokens pass through raw
// with ok=false so the UI shows them verbatim instead of inventing.
func gearShortForm(stored string) (string, bool) {
	switch stored {
	case "P", "R", "N", "D":
		return stored, true
	case "ShiftStateP":
		return "P", true
	case "ShiftStateR":
		return "R", true
	case "ShiftStateN":
		return "N", true
	case "ShiftStateD":
		return "D", true
	case "ShiftStateUnknown", "ShiftStateInvalid", "ShiftStateSNA":
		return strings.ToLower(strings.TrimPrefix(stored, "ShiftState")), true
	case "unknown", "invalid", "sna":
		return stored, true
	default:
		return stored, false
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

// signalEdgeEvents maps one edge to its event(s). Every mapped edge
// reports previous → new in from/to; unmapped fields surface as
// generic signal events with their source field — never dropped.
func signalEdgeEvents(vehicleID int64, edge signalEdge, fieldLayers map[string]string) []Event {
	mk := func(typ, layer string) Event {
		return newEvent(vehicleID, fmt.Sprintf("sig:%s:%d", edge.Field, edge.Ts.UnixNano()), edge.Ts, typ, layer, SourceSignalLog)
	}
	layerOf := func(fallback string) string {
		if l, ok := fieldLayers[edge.Field]; ok {
			return l
		}
		return fallback
	}
	toBool := edge.To.BoolValue != nil && *edge.To.BoolValue
	setBoolFromTo := func(e *Event) {
		if edge.From.BoolValue != nil {
			e.Payload["from"] = *edge.From.BoolValue
		}
		if edge.To.BoolValue != nil {
			e.Payload["to"] = *edge.To.BoolValue
		}
	}

	switch edge.Field {
	case "RemoteStartActive":
		var e Event
		if toBool {
			e = mk("remote_start_on", LayerDefault)
		} else {
			e = mk("remote_start_off", LayerDefault)
		}
		setBoolFromTo(&e)
		return []Event{e}
	case "LightsTurnSignal":
		{
			e := mk("turn_signal", LayerTurnSignals)
			fromShort, fromOK := enumShort(turnSignalShort, edge.From.IntValue)
			toShort, toOK := enumShort(turnSignalShort, edge.To.IntValue)
			// The direction component comes from the NEW state; the
			// previous state rides in from/to for the transition line.
			if toOK {
				e.Payload["component"] = toShort
			}
			e.Payload["from"] = enumDisplay(fromShort, fromOK, edge.From.IntValue)
			e.Payload["to"] = enumDisplay(toShort, toOK, edge.To.IntValue)
			e.Payload["from_value"] = typedSignalValue(edge.From)
			e.Payload["to_value"] = typedSignalValue(edge.To)
			return []Event{e}
		}
	case "LightsHazardsActive":
		{
			var e Event
			if toBool {
				e = mk("hazards_on", LayerLights)
			} else {
				e = mk("hazards_off", LayerLights)
			}
			setBoolFromTo(&e)
			return []Event{e}
		}
	case "LightsHighBeams":
		{
			var e Event
			if toBool {
				e = mk("high_beams_on", LayerLights)
			} else {
				e = mk("high_beams_off", LayerLights)
			}
			setBoolFromTo(&e)
			return []Event{e}
		}
	case "HvacPower":
		{
			toShort, toOK := enumShort(hvacShort, edge.To.IntValue)
			fromShort, fromOK := enumShort(hvacShort, edge.From.IntValue)
			var e Event
			// On-ish targets (on, precondition, overheat protection)
			// read as hvac_on; off/unknown read as hvac_off. Exact
			// states stay in from/to so nothing is lost.
			if toOK && toShort != "off" && toShort != "unknown" {
				e = mk("hvac_on", LayerHVAC)
			} else {
				e = mk("hvac_off", LayerHVAC)
			}
			e.Payload["from"] = enumDisplay(fromShort, fromOK, edge.From.IntValue)
			e.Payload["to"] = enumDisplay(toShort, toOK, edge.To.IntValue)
			e.Payload["from_value"] = typedSignalValue(edge.From)
			e.Payload["to_value"] = typedSignalValue(edge.To)
			return []Event{e}
		}
	case "HomelinkNearby":
		{
			var e Event
			if toBool {
				e = mk("homelink_nearby_on", LayerHomelink)
			} else {
				e = mk("homelink_nearby_off", LayerHomelink)
			}
			setBoolFromTo(&e)
			return []Event{e}
		}
	case "LocatedAtHome":
		{
			var e Event
			if toBool {
				e = mk("arrived_home", LayerHomelink)
			} else {
				e = mk("left_home", LayerHomelink)
			}
			setBoolFromTo(&e)
			return []Event{e}
		}
	case "LocatedAtWork":
		{
			var e Event
			if toBool {
				e = mk("arrived_work", LayerHomelink)
			} else {
				e = mk("left_work", LayerHomelink)
			}
			setBoolFromTo(&e)
			return []Event{e}
		}
	case "LocatedAtFavorite":
		{
			var e Event
			if toBool {
				e = mk("arrived_favorite", LayerHomelink)
			} else {
				e = mk("left_favorite", LayerHomelink)
			}
			setBoolFromTo(&e)
			return []Event{e}
		}
	default:
		if door, ok := doorFieldSuffix[edge.Field]; ok {
			var e Event
			if toBool {
				e = mk("door_open", LayerDoorsWindow)
			} else {
				e = mk("door_closed", LayerDoorsWindow)
			}
			e.Payload["door"] = door
			setBoolFromTo(&e)
			return []Event{e}
		}
		if window, ok := windowFieldSuffix[edge.Field]; ok {
			e := mk("window", LayerDoorsWindow)
			e.Payload["window"] = window
			fromShort, fromOK := enumShort(windowShort, edge.From.IntValue)
			toShort, toOK := enumShort(windowShort, edge.To.IntValue)
			e.Payload["from"] = enumDisplay(fromShort, fromOK, edge.From.IntValue)
			e.Payload["to"] = enumDisplay(toShort, toOK, edge.To.IntValue)
			e.Payload["from_value"] = typedSignalValue(edge.From)
			e.Payload["to_value"] = typedSignalValue(edge.To)
			return []Event{e}
		}
		// Generic fallback: unrecognized fields keep their source
		// label and raw values. Reachable whenever the queried field
		// set outgrows this switch.
		e := mk("signal", layerOf(LayerDefault))
		e.Payload["field"] = edge.Field
		e.Payload["from"] = typedSignalValue(edge.From)
		e.Payload["to"] = typedSignalValue(edge.To)
		return []Event{e}
	}
}

// enumDisplay renders a stored enum number: the short label when the
// number is known, the raw number otherwise. Never invents a label.
func enumDisplay(short string, ok bool, raw *int64) any {
	if ok {
		return short
	}
	if raw != nil {
		return *raw
	}
	return nil
}

// gearEdge is one in-window gear transition with both ticks.
type gearEdge struct {
	From daylogdb.DayGearTick
	To   daylogdb.DayGearTick
}

// gearEdges detects gear changes over chronological ticks. The first
// tick is the baseline and emits nothing. Every change is preserved.
func gearEdges(ticks []daylogdb.DayGearTick) []gearEdge {
	out := make([]gearEdge, 0)
	var prev daylogdb.DayGearTick
	var seen bool
	for _, t := range ticks {
		if !seen {
			prev, seen = t, true
			continue
		}
		if t.Gear != prev.Gear {
			out = append(out, gearEdge{From: prev, To: t})
			prev = t
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
