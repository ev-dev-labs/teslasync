package condition

import (
	"context"
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
	"lock":              "unlock",
	"unlock":            "lock",
	"climate_on":        "climate_off",
	"climate_off":       "climate_on",
	"sentry_on":         "sentry_off",
	"sentry_off":        "sentry_on",
	"charge_start":      "charge_stop",
	"charge_stop":       "charge_start",
	"open_charge_port":  "close_charge_port",
	"close_charge_port": "open_charge_port",
	"charge_port_open":  "charge_port_close",
	"charge_port_close": "charge_port_open",
	"vent_windows":      "close_windows",
	"close_windows":     "vent_windows",
	"valet_on":          "valet_off",
	"valet_off":         "valet_on",
	"guest_mode_on":     "guest_mode_off",
	"guest_mode_off":    "guest_mode_on",
}

type actionEntry struct {
	Type        string
	CommandName string
}

// triggerSummary normalizes trigger details for comparison.
type triggerSummary struct {
	triggerType string
	cronExpr    string
	timezone    string
	event       string
	geofenceID  int64
	events      []string // expanded event list (geofence "both" → ["enter","leave"])
}

// DetectConflicts scans other automations for potential conflicts with the candidate.
// Returns a list of advisory Conflict warnings. The context parameter is reserved
// for future use (e.g., condition-aware analysis that may need data lookups).
func DetectConflicts(_ context.Context, candidate *models.AutomationFull, others []*models.AutomationFull) []Conflict {
	if candidate == nil || len(others) == 0 {
		return nil
	}

	candidateActions := typedCommandActions(candidate.Actions)
	if len(candidateActions) == 0 {
		return nil
	}

	candidateCommands := extractCommands(candidateActions)
	if len(candidateCommands) == 0 {
		return nil
	}

	candidateTrigger := typedTriggerSummary(candidate.Triggers)

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

		otherActions := typedCommandActions(other.Actions)
		otherCommands := extractCommands(otherActions)
		if len(otherCommands) == 0 {
			continue
		}

		opposites := findOppositeCommands(candidateCommands, otherCommands)
		if len(opposites) == 0 {
			continue
		}

		otherTrigger := typedTriggerSummary(other.Triggers)

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
	case models.AutomationStepKindTriggerSchedule:
		return checkCronOverlap(a, b, cmdDesc)
	case models.AutomationStepKindTriggerEvent:
		return checkSameTriggerOverlap("event", a, b, cmdDesc)
	case models.AutomationStepKindTriggerGeofence:
		return checkGeofenceOverlap(a, b, cmdDesc)
	case models.AutomationStepKindTriggerSignal:
		return checkSameTriggerOverlap("signal", a, b, cmdDesc)
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

func typedTriggerSummary(triggers []any) triggerSummary {
	if len(triggers) == 0 {
		return triggerSummary{}
	}
	switch t := triggers[0].(type) {
	case *models.AutomationStepTriggerSchedule:
		return triggerSummary{triggerType: models.AutomationStepKindTriggerSchedule, cronExpr: t.CronExpr, timezone: t.Timezone}
	case models.AutomationStepTriggerSchedule:
		return triggerSummary{triggerType: models.AutomationStepKindTriggerSchedule, cronExpr: t.CronExpr, timezone: t.Timezone}
	case *models.AutomationStepTriggerGeofence:
		return geofenceSummary(t.PlaceID, t.Event)
	case models.AutomationStepTriggerGeofence:
		return geofenceSummary(t.PlaceID, t.Event)
	case *models.AutomationStepTriggerEvent:
		return triggerSummary{triggerType: models.AutomationStepKindTriggerEvent, event: t.EventType}
	case models.AutomationStepTriggerEvent:
		return triggerSummary{triggerType: models.AutomationStepKindTriggerEvent, event: t.EventType}
	case *models.AutomationStepTriggerSignal:
		return triggerSummary{triggerType: models.AutomationStepKindTriggerSignal, event: t.Signal}
	case models.AutomationStepTriggerSignal:
		return triggerSummary{triggerType: models.AutomationStepKindTriggerSignal, event: t.Signal}
	default:
		return triggerSummary{}
	}
}

func geofenceSummary(placeID int64, event string) triggerSummary {
	ts := triggerSummary{triggerType: models.AutomationStepKindTriggerGeofence, geofenceID: placeID, event: event}
	switch event {
	case "both":
		ts.events = []string{"enter", "leave"}
	case "enter", "leave", "exit", "dwell":
		ts.events = []string{event}
	}
	return ts
}

func typedCommandActions(actions []any) []actionEntry {
	entries := make([]actionEntry, 0, len(actions))
	for _, item := range actions {
		switch a := item.(type) {
		case *models.AutomationAction:
			entries = append(entries, actionEntry{Type: models.AutomationStepKindActionCommand, CommandName: a.CommandName})
		case models.AutomationAction:
			entries = append(entries, actionEntry{Type: models.AutomationStepKindActionCommand, CommandName: a.CommandName})
		}
	}
	return entries
}

func extractCommands(actions []actionEntry) []string {
	var cmds []string
	for _, a := range actions {
		if a.CommandName != "" {
			cmds = append(cmds, a.CommandName)
		}
	}
	return cmds
}

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
