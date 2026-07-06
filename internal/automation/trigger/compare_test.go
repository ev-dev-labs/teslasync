package trigger

import (
	"encoding/json"
	"testing"
)

func strPtr(s string) *string   { return &s }
func numPtr(f float64) *float64 { return &f }
func boolPtr(b bool) *bool      { return &b }

func TestTypedComparisonValue(t *testing.T) {
	tests := []struct {
		name      string
		text      *string
		num       *float64
		boolean   *bool
		wantValue any
		wantOK    bool
	}{
		{"text set", strPtr("hi"), nil, nil, "hi", true},
		{"num set", nil, numPtr(3.5), nil, 3.5, true},
		{"bool set", nil, nil, boolPtr(true), true, true},
		{"none set", nil, nil, nil, nil, false},
		{"text wins over num", strPtr("x"), numPtr(9), nil, "x", true},
		{"num wins over bool", nil, numPtr(1), boolPtr(false), 1.0, true},
		{"text zero value", strPtr(""), nil, nil, "", true},
		{"num zero value", nil, numPtr(0), nil, 0.0, true},
		{"bool false value", nil, nil, boolPtr(false), false, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := typedComparisonValue(tt.text, tt.num, tt.boolean)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if ok && got != tt.wantValue {
				t.Fatalf("value = %v (%T), want %v (%T)", got, got, tt.wantValue, tt.wantValue)
			}
		})
	}
}

func TestCompareTypedValues_Bool(t *testing.T) {
	tests := []struct {
		name     string
		actual   any
		op       string
		expected bool
		want     bool
	}{
		{"eq true match", true, "=", true, true},
		{"eq alias match", true, "eq", true, true},
		{"eq mismatch", false, "=", true, false},
		{"neq match", false, "!=", true, true},
		{"neq alias match", false, "neq", true, true},
		{"neq mismatch", true, "!=", true, false},
		{"string actual true", "true", "=", true, true},
		{"string actual 1", "1", "=", true, true},
		{"string actual invalid", "notabool", "=", true, false},
		{"unsupported op gt", true, ">", true, false},
		{"numeric actual not bool", 1.0, "=", true, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := compareTypedValues(tt.actual, tt.op, tt.expected); got != tt.want {
				t.Fatalf("compareTypedValues(%v,%q,%v) = %v, want %v", tt.actual, tt.op, tt.expected, got, tt.want)
			}
		})
	}
}

func TestCompareTypedValues_Float(t *testing.T) {
	tests := []struct {
		name     string
		actual   any
		op       string
		expected float64
		want     bool
	}{
		{"eq", 5.0, "=", 5.0, true},
		{"eq alias", 5.0, "eq", 5.0, true},
		{"eq mismatch", 4.0, "=", 5.0, false},
		{"neq", 4.0, "!=", 5.0, true},
		{"neq alias", 4.0, "neq", 5.0, true},
		{"gt true", 6.0, ">", 5.0, true},
		{"gt alias", 6.0, "gt", 5.0, true},
		{"gt false", 5.0, ">", 5.0, false},
		{"gte equal", 5.0, ">=", 5.0, true},
		{"gte alias", 6.0, "gte", 5.0, true},
		{"lt true", 4.0, "<", 5.0, true},
		{"lt alias", 4.0, "lt", 5.0, true},
		{"lt false", 5.0, "<", 5.0, false},
		{"lte equal", 5.0, "<=", 5.0, true},
		{"lte alias", 4.0, "lte", 5.0, true},
		{"int actual", 6, ">", 5.0, true},
		{"int64 actual", int64(4), "<", 5.0, true},
		{"string numeric actual", "6", ">", 5.0, true},
		{"json.Number actual", json.Number("6"), ">", 5.0, true},
		{"non-numeric actual", true, ">", 5.0, false},
		{"unknown op", 6.0, "??", 5.0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := compareTypedValues(tt.actual, tt.op, tt.expected); got != tt.want {
				t.Fatalf("compareTypedValues(%v,%q,%v) = %v, want %v", tt.actual, tt.op, tt.expected, got, tt.want)
			}
		})
	}
}

func TestCompareTypedValues_String(t *testing.T) {
	tests := []struct {
		name     string
		actual   any
		op       string
		expected string
		want     bool
	}{
		{"eq match", "abc", "=", "abc", true},
		{"eq alias", "abc", "eq", "abc", true},
		{"eq mismatch", "abc", "=", "xyz", false},
		{"neq match", "abc", "!=", "xyz", true},
		{"neq alias", "abc", "neq", "xyz", true},
		{"neq mismatch", "abc", "!=", "abc", false},
		{"numeric actual stringified", 42.0, "=", "42", true},
		{"unsupported op gt", "abc", ">", "abd", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := compareTypedValues(tt.actual, tt.op, tt.expected); got != tt.want {
				t.Fatalf("compareTypedValues(%v,%q,%q) = %v, want %v", tt.actual, tt.op, tt.expected, got, tt.want)
			}
		})
	}
}

func TestCompareTypedValues_UnsupportedExpectedType(t *testing.T) {
	// expected of a type other than bool/float64/string falls through to false.
	if compareTypedValues(1, "=", []int{1}) {
		t.Fatal("expected false for unsupported expected type")
	}
	if compareTypedValues("x", "=", nil) {
		t.Fatal("expected false for nil expected")
	}
}

func TestActualBool(t *testing.T) {
	tests := []struct {
		name   string
		in     any
		want   bool
		wantOK bool
	}{
		{"bool true", true, true, true},
		{"bool false", false, false, true},
		{"string true", "true", true, true},
		{"string false", "false", false, true},
		{"string 1", "1", true, true},
		{"string 0", "0", false, true},
		{"string invalid", "maybe", false, false},
		{"int not supported", 1, false, false},
		{"float not supported", 1.0, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := actualBool(tt.in)
			if ok != tt.wantOK || got != tt.want {
				t.Fatalf("actualBool(%v) = (%v,%v), want (%v,%v)", tt.in, got, ok, tt.want, tt.wantOK)
			}
		})
	}
}

func TestActualFloat(t *testing.T) {
	tests := []struct {
		name   string
		in     any
		want   float64
		wantOK bool
	}{
		{"int", 7, 7, true},
		{"int64", int64(8), 8, true},
		{"float32", float32(1.5), 1.5, true},
		{"float64", 2.25, 2.25, true},
		{"json.Number valid", json.Number("3.5"), 3.5, true},
		{"json.Number invalid", json.Number("nope"), 0, false},
		{"string valid", "4.5", 4.5, true},
		{"string invalid", "abc", 0, false},
		{"bool not supported", true, 0, false},
		{"nil not supported", nil, 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := actualFloat(tt.in)
			if ok != tt.wantOK {
				t.Fatalf("actualFloat(%v) ok = %v, want %v", tt.in, ok, tt.wantOK)
			}
			if ok && got != tt.want {
				t.Fatalf("actualFloat(%v) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}
