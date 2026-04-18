package condition

import (
	"encoding/json"
	"fmt"
	"strconv"
)

// variableCheckOperators lists the operators accepted by variable_check conditions.
var variableCheckOperators = map[string]bool{
	"eq": true, "neq": true, "gt": true, "lt": true, "gte": true, "lte": true,
}

// VariableCheckConfig represents the parsed condition config for variable_check conditions.
type VariableCheckConfig struct {
	Type     string `json:"type"`     // "variable_check"
	Key      string `json:"key"`      // automation variable key
	Operator string `json:"operator"` // comparison operator
	Value    string `json:"value"`    // comparison value (string)
}

// variableCheckSnapshot provides detailed diagnostics for conditions_snapshot logging.
type variableCheckSnapshot struct {
	Key      string  `json:"key"`
	Operator string  `json:"operator"`
	Expected string  `json:"expected"`
	Actual   *string `json:"actual"`
	Met      bool    `json:"met"`
	Reason   string  `json:"reason"`
}

// ParseVariableCheckConfig unmarshals and validates a variable_check condition config.
func ParseVariableCheckConfig(raw json.RawMessage) (*VariableCheckConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("condition config is empty")
	}

	var cfg VariableCheckConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal condition config: %w", err)
	}

	if cfg.Type != "" && cfg.Type != "variable_check" {
		return nil, fmt.Errorf("expected type \"variable_check\", got %q", cfg.Type)
	}

	if cfg.Key == "" {
		return nil, fmt.Errorf("key is required")
	}

	if cfg.Operator == "" {
		return nil, fmt.Errorf("operator is required")
	}

	if !variableCheckOperators[cfg.Operator] {
		return nil, fmt.Errorf("unsupported operator %q", cfg.Operator)
	}

	// Value can be empty string for eq/neq comparisons (checking if variable is "").
	// Ordering operators require a parseable numeric value.
	switch cfg.Operator {
	case "gt", "lt", "gte", "lte":
		if _, err := strconv.ParseFloat(cfg.Value, 64); err != nil {
			return nil, fmt.Errorf("value %q must be numeric for operator %q", cfg.Value, cfg.Operator)
		}
	}

	return &cfg, nil
}

// EvaluateVariableCheck checks whether a stored automation variable satisfies
// the configured key/operator/value condition.
//
// currentValue is the variable's current stored value, or nil if the variable
// has not been set. When nil, the condition is NOT met (variable does not exist).
//
// Equality operators (eq, neq) compare as strings.
// Ordering operators (gt, lt, gte, lte) attempt numeric comparison; if the
// stored value is not a valid number, the condition is NOT met.
func EvaluateVariableCheck(cfg *VariableCheckConfig, currentValue *string) (Result, json.RawMessage, error) {
	sym := operatorSymbols[cfg.Operator]

	// Variable not set → condition not met.
	if currentValue == nil {
		reason := fmt.Sprintf("variable %q is not set", cfg.Key)
		snapshot, _ := json.Marshal(variableCheckSnapshot{
			Key:      cfg.Key,
			Operator: cfg.Operator,
			Expected: cfg.Value,
			Actual:   nil,
			Met:      false,
			Reason:   reason,
		})
		return Result{Met: false, Reason: reason}, snapshot, nil
	}

	actual := *currentValue
	expected := cfg.Value
	var met bool

	switch cfg.Operator {
	case "eq":
		met = actual == expected
	case "neq":
		met = actual != expected
	case "gt", "lt", "gte", "lte":
		actualNum, err := strconv.ParseFloat(actual, 64)
		if err != nil {
			reason := fmt.Sprintf("variable %q value %q is not numeric", cfg.Key, actual)
			snapshot, _ := json.Marshal(variableCheckSnapshot{
				Key:      cfg.Key,
				Operator: cfg.Operator,
				Expected: expected,
				Actual:   currentValue,
				Met:      false,
				Reason:   reason,
			})
			return Result{Met: false, Reason: reason}, snapshot, nil
		}
		// Numeric parse of expected was already validated in ParseVariableCheckConfig.
		expectedNum, _ := strconv.ParseFloat(expected, 64)

		switch cfg.Operator {
		case "gt":
			met = actualNum > expectedNum
		case "lt":
			met = actualNum < expectedNum
		case "gte":
			met = actualNum >= expectedNum
		case "lte":
			met = actualNum <= expectedNum
		}
	default:
		return Result{}, nil, fmt.Errorf("unsupported operator %q", cfg.Operator)
	}

	reason := fmt.Sprintf("variable %q: %s %s %s", cfg.Key, actual, sym, expected)

	snapshot, _ := json.Marshal(variableCheckSnapshot{
		Key:      cfg.Key,
		Operator: cfg.Operator,
		Expected: expected,
		Actual:   currentValue,
		Met:      met,
		Reason:   reason,
	})

	return Result{Met: met, Reason: reason}, snapshot, nil
}
