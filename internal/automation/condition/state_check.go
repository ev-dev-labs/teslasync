package condition

import (
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// fieldKind classifies state fields by their comparison type.
type fieldKind int

const (
	fieldBool fieldKind = iota
	fieldNumeric
	fieldString
)

// fieldDef describes a supported state field: its type and how to extract it.
type fieldDef struct {
	kind    fieldKind
	extract func(*models.VehicleState) any
}

// fieldRegistry is the single source of truth for supported state_check fields.
// It maps field names to their type classification and value extractor.
var fieldRegistry = map[string]fieldDef{
	"is_locked":     {fieldBool, func(s *models.VehicleState) any { return s.IsLocked }},
	"is_charging":   {fieldBool, func(s *models.VehicleState) any { return s.IsCharging }},
	"is_climate_on": {fieldBool, func(s *models.VehicleState) any { return s.IsClimateOn }},
	"sentry_mode":   {fieldBool, func(s *models.VehicleState) any { return s.SentryMode }},
	"battery_level": {fieldNumeric, func(s *models.VehicleState) any { return float64(s.BatteryLevel) }},
	"inside_temp":   {fieldNumeric, func(s *models.VehicleState) any { return s.InsideTemp }},
	"outside_temp":  {fieldNumeric, func(s *models.VehicleState) any { return s.OutsideTemp }},
	"speed":         {fieldNumeric, func(s *models.VehicleState) any { return s.Speed }},
	"state":         {fieldString, func(s *models.VehicleState) any { return s.State }},
}

// operatorSymbols maps operator names to display symbols for reason strings.
var operatorSymbols = map[string]string{
	"eq": "==", "neq": "!=", "gt": ">", "lt": "<", "gte": ">=", "lte": "<=",
}

// StateCheckConfig represents the parsed condition config for state_check conditions.
// Exactly one of BoolValue, NumberValue, or StringValue is non-nil after parsing.
type StateCheckConfig struct {
	Type     string `json:"type"`     // must be "state_check"
	Field    string `json:"field"`    // field name on VehicleState
	Operator string `json:"operator"` // comparison operator

	BoolValue   *bool    `json:"-"` // set when field is boolean
	NumberValue *float64 `json:"-"` // set when field is numeric
	StringValue *string  `json:"-"` // set when field is string
}

// stateCheckSnapshot provides detailed diagnostics for conditions_snapshot logging.
type stateCheckSnapshot struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Expected any    `json:"expected"`
	Actual   any    `json:"actual"`
	Met      bool   `json:"met"`
	Reason   string `json:"reason"`
}

// ParseStateCheckConfig unmarshals and validates a state_check condition config.
func ParseStateCheckConfig(raw json.RawMessage) (*StateCheckConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("condition config is empty")
	}

	var parsed struct {
		Type     string          `json:"type"`
		Field    string          `json:"field"`
		Operator string          `json:"operator"`
		Value    json.RawMessage `json:"value"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("unmarshal condition config: %w", err)
	}

	if parsed.Type != "" && parsed.Type != "state_check" {
		return nil, fmt.Errorf("expected type \"state_check\", got %q", parsed.Type)
	}

	if parsed.Field == "" {
		return nil, fmt.Errorf("field is required")
	}

	fd, ok := fieldRegistry[parsed.Field]
	if !ok {
		return nil, fmt.Errorf("unsupported field %q", parsed.Field)
	}

	if parsed.Operator == "" {
		return nil, fmt.Errorf("operator is required")
	}
	if _, ok := operatorSymbols[parsed.Operator]; !ok {
		return nil, fmt.Errorf("unsupported operator %q", parsed.Operator)
	}

	// Ordering operators are only valid for numeric fields.
	if fd.kind != fieldNumeric {
		switch parsed.Operator {
		case "gt", "lt", "gte", "lte":
			return nil, fmt.Errorf("operator %q is not supported for %s field %q",
				parsed.Operator, fieldKindName(fd.kind), parsed.Field)
		}
	}

	if len(parsed.Value) == 0 || string(parsed.Value) == "null" {
		return nil, fmt.Errorf("value is required")
	}

	cfg := &StateCheckConfig{
		Type:     parsed.Type,
		Field:    parsed.Field,
		Operator: parsed.Operator,
	}

	switch fd.kind {
	case fieldBool:
		var v *bool
		if err := json.Unmarshal(parsed.Value, &v); err != nil || v == nil {
			return nil, fmt.Errorf("value for boolean field %q must be true or false", parsed.Field)
		}
		cfg.BoolValue = v
	case fieldNumeric:
		var v *float64
		if err := json.Unmarshal(parsed.Value, &v); err != nil || v == nil {
			return nil, fmt.Errorf("value for numeric field %q must be a number", parsed.Field)
		}
		cfg.NumberValue = v
	case fieldString:
		var v *string
		if err := json.Unmarshal(parsed.Value, &v); err != nil || v == nil {
			return nil, fmt.Errorf("value for string field %q must be a string", parsed.Field)
		}
		cfg.StringValue = v
	}

	return cfg, nil
}

// EvaluateStateCheck checks whether the given vehicle state satisfies the
// configured field/operator/value condition.
func EvaluateStateCheck(cfg *StateCheckConfig, state *models.VehicleState) (Result, json.RawMessage, error) {
	if state == nil {
		return Result{}, nil, fmt.Errorf("vehicle state is nil")
	}

	fd, ok := fieldRegistry[cfg.Field]
	if !ok {
		return Result{}, nil, fmt.Errorf("unknown field %q", cfg.Field)
	}

	actual := fd.extract(state)
	expected := cfg.expectedValue()

	met, err := compare(actual, cfg.Operator, expected)
	if err != nil {
		return Result{}, nil, err
	}

	sym := operatorSymbols[cfg.Operator]
	reason := fmt.Sprintf("%s %s %s %s", cfg.Field, formatValue(actual), sym, formatValue(expected))

	snapshot, _ := json.Marshal(stateCheckSnapshot{
		Field:    cfg.Field,
		Operator: cfg.Operator,
		Expected: expected,
		Actual:   actual,
		Met:      met,
		Reason:   reason,
	})

	return Result{Met: met, Reason: reason}, snapshot, nil
}

// expectedValue returns the typed comparison value stored in the config.
func (cfg *StateCheckConfig) expectedValue() any {
	if cfg.BoolValue != nil {
		return *cfg.BoolValue
	}
	if cfg.NumberValue != nil {
		return *cfg.NumberValue
	}
	if cfg.StringValue != nil {
		return *cfg.StringValue
	}
	return nil
}

// compare dispatches to the appropriate typed comparison.
func compare(actual any, op string, expected any) (bool, error) {
	switch a := actual.(type) {
	case bool:
		e, ok := expected.(bool)
		if !ok {
			return false, fmt.Errorf("type mismatch: field is bool, value is %T", expected)
		}
		return compareBool(a, op, e)
	case float64:
		e, ok := expected.(float64)
		if !ok {
			return false, fmt.Errorf("type mismatch: field is numeric, value is %T", expected)
		}
		return compareFloat64(a, op, e)
	case string:
		e, ok := expected.(string)
		if !ok {
			return false, fmt.Errorf("type mismatch: field is string, value is %T", expected)
		}
		return compareString(a, op, e)
	default:
		return false, fmt.Errorf("unsupported field type %T", actual)
	}
}

func compareBool(actual bool, op string, expected bool) (bool, error) {
	switch op {
	case "eq":
		return actual == expected, nil
	case "neq":
		return actual != expected, nil
	default:
		return false, fmt.Errorf("operator %q is not supported for boolean fields", op)
	}
}

func compareFloat64(actual float64, op string, expected float64) (bool, error) {
	switch op {
	case "eq":
		return actual == expected, nil
	case "neq":
		return actual != expected, nil
	case "gt":
		return actual > expected, nil
	case "lt":
		return actual < expected, nil
	case "gte":
		return actual >= expected, nil
	case "lte":
		return actual <= expected, nil
	default:
		return false, fmt.Errorf("unknown operator %q", op)
	}
}

func compareString(actual string, op string, expected string) (bool, error) {
	switch op {
	case "eq":
		return actual == expected, nil
	case "neq":
		return actual != expected, nil
	default:
		return false, fmt.Errorf("operator %q is not supported for string fields", op)
	}
}

// formatValue produces a clean display string for a field or comparison value.
func formatValue(v any) string {
	switch val := v.(type) {
	case bool:
		return strconv.FormatBool(val)
	case float64:
		if val == float64(int64(val)) {
			return strconv.FormatInt(int64(val), 10)
		}
		return strconv.FormatFloat(val, 'f', -1, 64)
	case string:
		return val
	default:
		return fmt.Sprintf("%v", v)
	}
}

// fieldKindName returns a human-readable name for a field kind.
func fieldKindName(k fieldKind) string {
	switch k {
	case fieldBool:
		return "boolean"
	case fieldNumeric:
		return "numeric"
	case fieldString:
		return "string"
	default:
		return "unknown"
	}
}
