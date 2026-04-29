package trigger

import (
	"encoding/json"
	"fmt"
	"strconv"
)

func typedComparisonValue(valueText *string, valueNum *float64, valueBool *bool) (any, bool) {
	switch {
	case valueText != nil:
		return *valueText, true
	case valueNum != nil:
		return *valueNum, true
	case valueBool != nil:
		return *valueBool, true
	default:
		return nil, false
	}
}

func compareTypedValues(actual any, op string, expected any) bool {
	switch e := expected.(type) {
	case bool:
		a, ok := actualBool(actual)
		if !ok {
			return false
		}
		switch op {
		case "=", "eq":
			return a == e
		case "!=", "neq":
			return a != e
		default:
			return false
		}
	case float64:
		a, ok := actualFloat(actual)
		if !ok {
			return false
		}
		switch op {
		case "=", "eq":
			return a == e
		case "!=", "neq":
			return a != e
		case ">", "gt":
			return a > e
		case ">=", "gte":
			return a >= e
		case "<", "lt":
			return a < e
		case "<=", "lte":
			return a <= e
		default:
			return false
		}
	case string:
		a := fmt.Sprint(actual)
		switch op {
		case "=", "eq":
			return a == e
		case "!=", "neq":
			return a != e
		default:
			return false
		}
	default:
		return false
	}
}

func actualBool(v any) (bool, bool) {
	switch t := v.(type) {
	case bool:
		return t, true
	case string:
		parsed, err := strconv.ParseBool(t)
		return parsed, err == nil
	default:
		return false, false
	}
}

func actualFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case float32:
		return float64(t), true
	case float64:
		return t, true
	case json.Number:
		parsed, err := t.Float64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseFloat(t, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}
