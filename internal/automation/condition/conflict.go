package condition

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// Conflict describes a potential conflict between two automations.
// These are advisory warnings displayed in the UI — they do not block creation.
type Conflict struct {
	AutomationID   int64  `json:"automation_id"`
	AutomationName string `json:"automation_name"`
	Reason         string `json:"reason"`
	Severity       string `json:"severity"` // "warning" (clear conflict) or "info" (possible conflict)
}

// oppositeCommands maps commands to their logical opposite.
// Both directions are listed explicitly for O(1) lookup.
var oppositeCommands = map[string]string{
	"lock":          "unlock",
	"unlock":        "lock",
	"climate_on":    "climate_off",
	"climate_off":   "climate_on",
	"sentry_on":     "sentry_off",
	"sentry_off":    "sentry_on",
	"charge_start":  "charge_stop",
	"charge_stop":   "charge_start",
	"open_charge_port":  "close_charge_port",
	"close_charge_port": "open_charge_port",
	"charge_port_open":  "charge_port_close",
	"charge_port_close": "charge_port_open",
	"vent_windows":  "close_windows",
	"close_windows": "vent_windows",
	"valet_on":      "valet_off",
	"valet_off":     "valet_on",
	"guest_mode_on":  "guest_mode_off",
	"guest_mode_off": "guest_mode_on",
}

// actionEntry represents a single action parsed from the automation's actions JSON.
type actionEntry struct {
	Type    string          `json:"type"`
	Command string          `json:"command"`
	Params  json.RawMessage `json:"params"`
}

// triggerSummary normalizes trigger details for comparison.
type triggerSummary struct {
	triggerType string
	cronExpr   string
	timezone   string
	event      string   // vehicle_state event name, geofence event
	fromState  *string  // vehicle_state optional filter
	toState    *string  // vehicle_state optional filter
	geofenceID int64    // geofence trigger
	events     []string // expanded event list (geofence "both" → ["enter","leave"])
}

// DetectConflicts scans other automations for potential conflicts with the candidate.
// Returns a list of advisory Conflict warnings. The context parameter is reserved
// for future use (e.g., condition-aware analysis that may need data lookups).
func DetectConflicts(_ context.Context, candidate *models.AutomationFull, others []*models.AutomationFull) []Conflict {
	if candidate == nil || len(others) == 0 {
		return nil
	}

	candidateActions := parseActions(marshalSlice(candidate.Actions))
	if len(candidateActions) == 0 {
		return nil
	}

	candidateCommands := extractCommands(candidateActions)
	if len(candidateCommands) == 0 {
		return nil
	}

	candidateTrigger := parseTriggerSummary(candidate.TriggerType(), candidate.TriggerConfig())

	var conflicts []Conflict
	for _, other := range others {
		if other.ID == candidate.ID {
			continue
		}
		if !other.Enabled || other.AutoDisabled() {
			continue
		}
		if !vehicleScopeOverlaps(candidate.VehicleID, other.VehicleID) {
			continue
		}

		otherActions := parseActions(marshalSlice(other.Actions))
		otherCommands := extractCommands(otherActions)
		if len(otherCommands) == 0 {
			continue
		}

		opposites := findOppositeCommands(candidateCommands, otherCommands)
		if len(opposites) == 0 {
			continue
		}

		otherTrigger := parseTriggerSummary(other.TriggerType(), other.TriggerConfig())

		if reason := checkTriggerOverlap(candidateTrigger, otherTrigger, opposites); reason != "" {
			severity := "warning"
			if hasConditions(candidate) || hasConditions(other) {
				severity = "info"
			}
			conflicts = append(conflicts, Conflict{
				AutomationID:   other.ID,
				AutomationName: other.Name,
				Reason:         reason,
				Severity:       severity,
			})
		}
	}

	return conflicts
}

// checkTriggerOverlap determines if two triggers can fire in a way that
// produces the given opposite command pairs. Returns a human-readable reason
// or empty string if no overlap is detected.
func checkTriggerOverlap(a, b triggerSummary, opposites []commandPair) string {
	if a.triggerType != b.triggerType {
		return ""
	}

	cmdDesc := formatCommandPairs(opposites)

	switch a.triggerType {
	case "cron":
		return checkCronOverlap(a, b, cmdDesc)
	case "vehicle_state":
		return checkVehicleStateOverlap(a, b, cmdDesc)
	case "geofence":
		return checkGeofenceOverlap(a, b, cmdDesc)
	case "battery":
		return checkSameTriggerOverlap("battery threshold", a, b, cmdDesc)
	case "sunrise_sunset":
		return checkSameTriggerOverlap("sunrise/sunset", a, b, cmdDesc)
	case "energy":
		return checkSameTriggerOverlap("energy", a, b, cmdDesc)
	case "mqtt":
		return checkSameTriggerOverlap("MQTT", a, b, cmdDesc)
	case "webhook":
		return checkSameTriggerOverlap("webhook", a, b, cmdDesc)
	case "calendar":
		return checkSameTriggerOverlap("calendar", a, b, cmdDesc)
	default:
		return ""
	}
}

func checkCronOverlap(a, b triggerSummary, cmdDesc string) string {
	if a.cronExpr == "" || b.cronExpr == "" {
		return ""
	}

	aTZ := normalizeTimezone(a.timezone)
	bTZ := normalizeTimezone(b.timezone)

	if a.cronExpr == b.cronExpr && aTZ == bTZ {
		return fmt.Sprintf("same schedule (%s %s) with contradicting actions: %s",
			a.cronExpr, aTZ, cmdDesc)
	}
	return ""
}

func checkVehicleStateOverlap(a, b triggerSummary, cmdDesc string) string {
	if !vehicleStateEventsOverlap(a, b) {
		return ""
	}
	return fmt.Sprintf("same vehicle state event (%s) with contradicting actions: %s",
		describeVehicleStateEvent(a, b), cmdDesc)
}

func checkGeofenceOverlap(a, b triggerSummary, cmdDesc string) string {
	if a.geofenceID == 0 || b.geofenceID == 0 {
		return ""
	}
	if a.geofenceID != b.geofenceID {
		return ""
	}

	if !geofenceEventsOverlap(a.events, b.events) {
		return ""
	}

	sharedEvents := intersectStrings(a.events, b.events)
	return fmt.Sprintf("same geofence (ID %d) on %s with contradicting actions: %s",
		a.geofenceID, strings.Join(sharedEvents, "/"), cmdDesc)
}

func checkSameTriggerOverlap(triggerLabel string, a, b triggerSummary, cmdDesc string) string {
	if a.event != "" && b.event != "" && a.event == b.event {
		return fmt.Sprintf("same %s event (%s) with contradicting actions: %s",
			triggerLabel, a.event, cmdDesc)
	}
	// For triggers without a distinguishing event, any overlap of same type is flagged.
	if a.event == "" && b.event == "" {
		return fmt.Sprintf("same %s trigger type with contradicting actions: %s",
			triggerLabel, cmdDesc)
	}
	return ""
}

// vehicleStateEventsOverlap checks if two vehicle_state triggers can fire
// on the same FSM transition. The "state_change" event is a wildcard that
// matches any transition, so it overlaps with all other events.
func vehicleStateEventsOverlap(a, b triggerSummary) bool {
	// state_change is a wildcard — overlaps everything.
	if a.event == "state_change" || b.event == "state_change" {
		return true
	}

	if a.event != b.event {
		return false
	}

	// Same event — check if from_state/to_state filters are mutually exclusive.
	if a.fromState != nil && b.fromState != nil && *a.fromState != *b.fromState {
		return false
	}
	if a.toState != nil && b.toState != nil && *a.toState != *b.toState {
		return false
	}

	return true
}

func describeVehicleStateEvent(a, b triggerSummary) string {
	if a.event == "state_change" || b.event == "state_change" {
		specific := a.event
		if specific == "state_change" {
			specific = b.event
		}
		if specific == "state_change" {
			return "state_change (any transition)"
		}
		return fmt.Sprintf("state_change overlaps %s", specific)
	}
	return a.event
}

func geofenceEventsOverlap(aEvents, bEvents []string) bool {
	for _, ae := range aEvents {
		for _, be := range bEvents {
			if ae == be {
				return true
			}
		}
	}
	return false
}

// ── Parsing helpers ─────────────────────────────────────

func parseTriggerSummary(triggerType string, raw json.RawMessage) triggerSummary {
	ts := triggerSummary{triggerType: triggerType}
	if len(raw) == 0 {
		return ts
	}

	switch triggerType {
	case "cron":
		var cfg struct {
			CronExpr string `json:"cron_expr"`
			Timezone string `json:"timezone"`
		}
		if json.Unmarshal(raw, &cfg) == nil {
			ts.cronExpr = cfg.CronExpr
			ts.timezone = cfg.Timezone
		}

	case "vehicle_state":
		var cfg struct {
			Event     string  `json:"event"`
			FromState *string `json:"from_state"`
			ToState   *string `json:"to_state"`
		}
		if json.Unmarshal(raw, &cfg) == nil {
			ts.event = cfg.Event
			ts.fromState = cfg.FromState
			ts.toState = cfg.ToState
		}

	case "geofence":
		var cfg struct {
			GeofenceID int64  `json:"geofence_id"`
			Event      string `json:"event"`
		}
		if json.Unmarshal(raw, &cfg) == nil {
			ts.geofenceID = cfg.GeofenceID
			ts.event = cfg.Event
			switch cfg.Event {
			case "both":
				ts.events = []string{"enter", "leave"}
			case "enter", "leave":
				ts.events = []string{cfg.Event}
			}
		}

	default:
		// Generic: try to extract an "event" field if present.
		var cfg struct {
			Event string `json:"event"`
		}
		if json.Unmarshal(raw, &cfg) == nil {
			ts.event = cfg.Event
		}
	}

	return ts
}

func parseActions(raw json.RawMessage) []actionEntry {
	if len(raw) == 0 {
		return nil
	}
	var actions []actionEntry
	if err := json.Unmarshal(raw, &actions); err != nil {
		return nil
	}
	return actions
}

func extractCommands(actions []actionEntry) []string {
	var cmds []string
	for _, a := range actions {
		if a.Command != "" {
			cmds = append(cmds, a.Command)
		}
	}
	return cmds
}

// commandPair records two conflicting commands.
type commandPair struct {
	ours   string
	theirs string
}

func findOppositeCommands(ours, theirs []string) []commandPair {
	theirSet := make(map[string]bool, len(theirs))
	for _, c := range theirs {
		theirSet[c] = true
	}

	seen := make(map[string]bool)
	var pairs []commandPair
	for _, cmd := range ours {
		opp, ok := oppositeCommands[cmd]
		if !ok {
			continue
		}
		if theirSet[opp] {
			// Deduplicate by sorting the pair.
			key := cmd + ":" + opp
			if cmd > opp {
				key = opp + ":" + cmd
			}
			if !seen[key] {
				seen[key] = true
				pairs = append(pairs, commandPair{ours: cmd, theirs: opp})
			}
		}
	}
	return pairs
}

func formatCommandPairs(pairs []commandPair) string {
	parts := make([]string, 0, len(pairs))
	for _, p := range pairs {
		parts = append(parts, fmt.Sprintf("%s vs %s", p.ours, p.theirs))
	}
	return strings.Join(parts, ", ")
}

// vehicleScopeOverlaps checks whether two automations can affect the same vehicle.
// nil vehicle_id means "all vehicles" (global scope).
func vehicleScopeOverlaps(a, b *int64) bool {
	if a == nil || b == nil {
		return true // at least one is global
	}
	return *a == *b
}

func hasConditions(a *models.AutomationFull) bool {
	return len(a.Conditions) > 0
}

// marshalSlice converts a []any (typed CTI children) back to JSON so the
// legacy parseActions helper can extract command strings.
func marshalSlice(v []any) json.RawMessage {
	if len(v) == 0 {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}

func normalizeTimezone(tz string) string {
	if tz == "" {
		return "UTC"
	}
	return tz
}

func intersectStrings(a, b []string) []string {
	bSet := make(map[string]bool, len(b))
	for _, s := range b {
		bSet[s] = true
	}
	var result []string
	for _, s := range a {
		if bSet[s] {
			result = append(result, s)
		}
	}
	return result
}


