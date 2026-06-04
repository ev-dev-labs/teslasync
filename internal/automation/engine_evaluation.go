package automation

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/ev-dev-labs/teslasync/internal/automation/condition"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ── Condition Evaluation ───────────────────────────────────────────────

// conditionResult captures the evaluation of a single condition.
type conditionResult struct {
	Index  int    `json:"index"`
	Type   string `json:"type"`
	Result string `json:"result"` // "met", "not_met", "unknown"
	Reason string `json:"reason"`
}

// evaluateConditions evaluates typed CTI condition children. Unknown payloads
// are treated as not met so legacy JSON bridges cannot silently pass runtime.
func (e *Engine) evaluateConditions(a *models.AutomationFull, now time.Time) (bool, json.RawMessage) {
	if len(a.Conditions) == 0 {
		return true, nil
	}

	allMet := true
	results := make([]conditionResult, 0, len(a.Conditions))
	for i, item := range a.Conditions {
		result := e.evaluateTypedCondition(i, item, a, now)
		results = append(results, result)
		if result.Result != "met" {
			allMet = false
		}
	}

	snapshot, _ := json.Marshal(results)
	return allMet, snapshot
}

func (e *Engine) evaluateTypedCondition(index int, item any, a *models.AutomationFull, now time.Time) conditionResult {
	switch c := item.(type) {
	case *models.AutomationStepConditionSignal:
		return e.evaluateSignalCondition(index, c, a)
	case models.AutomationStepConditionSignal:
		return e.evaluateSignalCondition(index, &c, a)
	case *models.AutomationStepConditionTimeWindow:
		return evaluateTimeWindowCondition(index, c, now)
	case models.AutomationStepConditionTimeWindow:
		return evaluateTimeWindowCondition(index, &c, now)
	case *models.AutomationStepConditionGeofence:
		return e.evaluateGeofenceCondition(index, c, a)
	case models.AutomationStepConditionGeofence:
		return e.evaluateGeofenceCondition(index, &c, a)
	case *models.AutomationStepConditionOtherAutomation:
		return e.evaluateOtherAutomationCondition(index, c, now)
	case models.AutomationStepConditionOtherAutomation:
		return e.evaluateOtherAutomationCondition(index, &c, now)
	default:
		return conditionResult{
			Index:  index,
			Type:   "unknown",
			Result: "unknown",
			Reason: fmt.Sprintf("unsupported typed condition payload %T", item),
		}
	}
}

func evaluateTimeWindowCondition(index int, c *models.AutomationStepConditionTimeWindow, now time.Time) conditionResult {
	cfg := &condition.TimeWindowConfig{
		Type:      "time_window",
		StartTime: c.StartTime.Format("15:04"),
		EndTime:   c.EndTime.Format("15:04"),
		Timezone:  c.Timezone,
	}
	res, _, err := condition.EvaluateTimeWindow(cfg, now)
	if err != nil {
		return conditionResult{Index: index, Type: models.AutomationStepKindConditionTimeWindow, Result: "unknown", Reason: "evaluation error: " + err.Error()}
	}
	return withEvalResult(conditionResult{Index: index, Type: models.AutomationStepKindConditionTimeWindow}, res.Met, res.Reason)
}

func (e *Engine) evaluateSignalCondition(index int, c *models.AutomationStepConditionSignal, a *models.AutomationFull) conditionResult {
	base := conditionResult{Index: index, Type: models.AutomationStepKindConditionSignal}
	state, result := e.currentVehicleState(a, base)
	if result != nil {
		return *result
	}

	actual, ok := vehicleStateSignalValue(state, c.Signal)
	if !ok {
		return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: fmt.Sprintf("unsupported signal %q", c.Signal)}
	}
	met, reason := compareConditionSignal(actual, c)
	return withEvalResult(base, met, reason)
}

func (e *Engine) evaluateGeofenceCondition(index int, c *models.AutomationStepConditionGeofence, a *models.AutomationFull) conditionResult {
	base := conditionResult{Index: index, Type: models.AutomationStepKindConditionGeofence}
	if e.placeProvider == nil {
		return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: "no place provider configured"}
	}
	state, result := e.currentVehicleState(a, base)
	if result != nil {
		return *result
	}
	place, err := e.placeProvider.GetByID(context.Background(), c.PlaceID)
	if err != nil {
		return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: "place lookup failed: " + err.Error()}
	}
	if place == nil {
		return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: fmt.Sprintf("place %d not found", c.PlaceID)}
	}
	inside := distanceMeters(state.Latitude, state.Longitude, place.Latitude, place.Longitude) <= float64(place.RadiusM)
	switch c.State {
	case "inside", "dwell":
		return withEvalResult(base, inside, fmt.Sprintf("vehicle inside place %d = %t", c.PlaceID, inside))
	case "outside":
		return withEvalResult(base, !inside, fmt.Sprintf("vehicle outside place %d = %t", c.PlaceID, !inside))
	default:
		return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: fmt.Sprintf("unsupported geofence condition state %q", c.State)}
	}
}

func (e *Engine) evaluateOtherAutomationCondition(index int, c *models.AutomationStepConditionOtherAutomation, now time.Time) conditionResult {
	base := conditionResult{Index: index, Type: models.AutomationStepKindConditionOtherAutomation}
	switch c.State {
	case "enabled", "disabled":
		other, err := e.automationRepo.GetByID(context.Background(), c.OtherAutomationID)
		if err != nil {
			return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: "other automation lookup failed: " + err.Error()}
		}
		if other == nil {
			return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: fmt.Sprintf("automation %d not found", c.OtherAutomationID)}
		}
		met := other.Enabled
		if c.State == "disabled" {
			met = !other.Enabled
		}
		return withEvalResult(base, met, fmt.Sprintf("automation %d is %s = %t", c.OtherAutomationID, c.State, met))
	case "recently_triggered":
		count, err := e.historyRepo.CountSinceByAutomation(context.Background(), c.OtherAutomationID, now.Add(-time.Hour))
		if err != nil {
			return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: "history lookup failed: " + err.Error()}
		}
		return withEvalResult(base, count > 0, fmt.Sprintf("automation %d executions in last hour = %d", c.OtherAutomationID, count))
	default:
		return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: fmt.Sprintf("unsupported other automation state %q", c.State)}
	}
}

func (e *Engine) currentVehicleState(a *models.AutomationFull, base conditionResult) (*vehiclemodel.VehicleState, *conditionResult) {
	if e.stateProvider == nil {
		return nil, &conditionResult{Index: base.Index, Type: base.Type, Result: "unknown", Reason: "no state provider configured"}
	}
	if a.VehicleID == nil {
		return nil, &conditionResult{Index: base.Index, Type: base.Type, Result: "unknown", Reason: "no vehicle scope"}
	}
	state, err := e.stateProvider.GetVehicleState(context.Background(), *a.VehicleID)
	if err != nil {
		return nil, &conditionResult{Index: base.Index, Type: base.Type, Result: "unknown", Reason: "state lookup failed: " + err.Error()}
	}
	if state == nil {
		return nil, &conditionResult{Index: base.Index, Type: base.Type, Result: "unknown", Reason: "no state data"}
	}
	return state, nil
}

func withEvalResult(base conditionResult, met bool, reason string) conditionResult {
	if met {
		base.Result = "met"
	} else {
		base.Result = "not_met"
	}
	base.Reason = reason
	return base
}

func validateTypedTriggers(a *models.AutomationFull) (string, error) {
	triggerSteps := make(map[int64]string)
	var firstKind string
	for _, step := range a.Steps {
		switch step.Kind {
		case models.AutomationStepKindTriggerSignal,
			models.AutomationStepKindTriggerGeofence,
			models.AutomationStepKindTriggerSchedule,
			models.AutomationStepKindTriggerEvent:
			triggerSteps[step.ID] = step.Kind
			if firstKind == "" {
				firstKind = step.Kind
			}
		}
	}
	if len(triggerSteps) == 0 {
		return "", fmt.Errorf("automation has no typed trigger step")
	}

	seen := make(map[int64]string, len(a.Triggers))
	for _, item := range a.Triggers {
		switch t := item.(type) {
		case *models.AutomationStepTriggerSignal:
			seen[t.StepID] = models.AutomationStepKindTriggerSignal
		case models.AutomationStepTriggerSignal:
			seen[t.StepID] = models.AutomationStepKindTriggerSignal
		case *models.AutomationStepTriggerGeofence:
			seen[t.StepID] = models.AutomationStepKindTriggerGeofence
		case models.AutomationStepTriggerGeofence:
			seen[t.StepID] = models.AutomationStepKindTriggerGeofence
		case *models.AutomationStepTriggerSchedule:
			seen[t.StepID] = models.AutomationStepKindTriggerSchedule
		case models.AutomationStepTriggerSchedule:
			seen[t.StepID] = models.AutomationStepKindTriggerSchedule
		case *models.AutomationStepTriggerEvent:
			seen[t.StepID] = models.AutomationStepKindTriggerEvent
		case models.AutomationStepTriggerEvent:
			seen[t.StepID] = models.AutomationStepKindTriggerEvent
		default:
			return "", fmt.Errorf("unsupported trigger payload %T", item)
		}
	}
	for stepID, kind := range triggerSteps {
		if seenKind, ok := seen[stepID]; !ok {
			return "", fmt.Errorf("missing typed trigger child for step %d kind %s", stepID, kind)
		} else if seenKind != kind {
			return "", fmt.Errorf("trigger child kind %s does not match step %d kind %s", seenKind, stepID, kind)
		}
	}
	return firstKind, nil
}

func vehicleStateSignalValue(state *vehiclemodel.VehicleState, signal string) (any, bool) {
	switch signal {
	case "state":
		return state.State, true
	case "latitude":
		return state.Latitude, true
	case "longitude":
		return state.Longitude, true
	case "speed":
		return state.Speed, true
	case "power":
		return state.Power, true
	case "battery_level":
		return float64(state.BatteryLevel), true
	case "rated_range":
		return state.RatedRange, true
	case "ideal_range":
		return state.IdealRange, true
	case "odometer":
		return state.Odometer, true
	case "inside_temp":
		return state.InsideTemp, true
	case "outside_temp":
		return state.OutsideTemp, true
	case "is_climate_on":
		return state.IsClimateOn, true
	case "is_charging":
		return state.IsCharging, true
	case "charger_power":
		return state.ChargerPower, true
	case "charge_rate":
		return state.ChargeRate, true
	case "time_to_full_charge":
		return state.TimeToFullChg, true
	case "is_locked":
		return state.IsLocked, true
	case "sentry_mode":
		return state.SentryMode, true
	case "software_version":
		return state.SoftwareVersion, true
	default:
		return nil, false
	}
}

func compareConditionSignal(actual any, c *models.AutomationStepConditionSignal) (bool, string) {
	if c.Op == "between" {
		actualNum, ok := numberValue(actual)
		if !ok || c.ValueMin == nil || c.ValueMax == nil {
			return false, fmt.Sprintf("%s between requires numeric actual, value_min, and value_max", c.Signal)
		}
		met := actualNum >= *c.ValueMin && actualNum <= *c.ValueMax
		return met, fmt.Sprintf("%s=%v between %v and %v", c.Signal, actualNum, *c.ValueMin, *c.ValueMax)
	}

	expected, ok := expectedConditionValue(c)
	if !ok {
		return false, fmt.Sprintf("%s condition has no expected value", c.Signal)
	}
	met := compareValue(actual, c.Op, expected)
	return met, fmt.Sprintf("%s=%v %s %v", c.Signal, actual, c.Op, expected)
}

func expectedConditionValue(c *models.AutomationStepConditionSignal) (any, bool) {
	switch {
	case c.ValueText != nil:
		return *c.ValueText, true
	case c.ValueNum != nil:
		return *c.ValueNum, true
	case c.ValueBool != nil:
		return *c.ValueBool, true
	default:
		return nil, false
	}
}

func compareValue(actual any, op string, expected any) bool {
	switch e := expected.(type) {
	case bool:
		a, ok := actual.(bool)
		if !ok {
			return false
		}
		switch op {
		case "=":
			return a == e
		case "!=":
			return a != e
		default:
			return false
		}
	case float64:
		a, ok := numberValue(actual)
		if !ok {
			return false
		}
		switch op {
		case "=":
			return a == e
		case "!=":
			return a != e
		case ">":
			return a > e
		case ">=":
			return a >= e
		case "<":
			return a < e
		case "<=":
			return a <= e
		default:
			return false
		}
	case string:
		a := fmt.Sprint(actual)
		switch op {
		case "=":
			return a == e
		case "!=":
			return a != e
		case "in":
			return a == e
		default:
			return false
		}
	default:
		return false
	}
}

func numberValue(v any) (float64, bool) {
	switch n := v.(type) {
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case float32:
		return float64(n), true
	case float64:
		return n, true
	default:
		return 0, false
	}
}

func distanceMeters(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusM = 6371000.0
	toRad := func(deg float64) float64 { return deg * math.Pi / 180 }
	dLat := toRad(lat2 - lat1)
	dLon := toRad(lon2 - lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*math.Sin(dLon/2)*math.Sin(dLon/2)
	return earthRadiusM * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}
