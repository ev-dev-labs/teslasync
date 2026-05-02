// Hand-written behavioural tests for the generated enum parsers in
// enum_parsers_gen.go. The five enums covered below were chosen by the
// rubber-duck design review to exercise every shape of LCP that the
// production proto ships today:
//
//   - ShiftState              : enum name == LCP, short suffixes (P/R/N/D)
//   - SentryModeState         : enum name == LCP, multiword name + suffixes
//   - ChargingState           : enum name != LCP   (LCP "ChargeState")
//   - DetailedChargeStateValue: enum name has "Value" suffix dropped from LCP
//   - BMSStateValue           : same shape, but with an all-caps prefix ("BMS")
//
// Each case asserts:
//   - the full proto-cased token parses to the expected typed constant
//   - the bare suffix parses to the SAME constant (cross-form invariance)
//   - the parsed value's int32 number matches the proto-declared number
//   - unknown and empty strings return a wrapped error of the form
//     `unknown <EnumName> "<input>"` and never panic.
package protomodel

import (
	"errors"
	"strings"
	"testing"
)

func TestParseEnumKnownAndSuffix(t *testing.T) {
	type parseFn func(string) (int32, error)

	// Each row binds a Parse* to the data we want to assert against.
	// We adapt every typed parser to (int32, error) so the table is
	// homogeneous — the cast is value-preserving because the generated
	// enum types are explicitly `int32`-backed.
	cases := []struct {
		enum       string
		parse      parseFn
		fullToken  string
		bareSuffix string
		wantNumber int32
	}{
		{
			enum:  "ShiftState",
			parse: func(s string) (int32, error) { v, err := ParseShiftState(s); return int32(v), err },
			// ShiftStateP = 2
			fullToken:  "ShiftStateP",
			bareSuffix: "P",
			wantNumber: 2,
		},
		{
			enum:  "SentryModeState",
			parse: func(s string) (int32, error) { v, err := ParseSentryModeState(s); return int32(v), err },
			// SentryModeStateArmed = 3
			fullToken:  "SentryModeStateArmed",
			bareSuffix: "Armed",
			wantNumber: 3,
		},
		{
			enum:  "ChargingState",
			parse: func(s string) (int32, error) { v, err := ParseChargingState(s); return int32(v), err },
			// ChargeStateCharging = 4 (note: enum name "ChargingState",
			// LCP across values is "ChargeState")
			fullToken:  "ChargeStateCharging",
			bareSuffix: "Charging",
			wantNumber: 4,
		},
		{
			enum: "DetailedChargeStateValue",
			parse: func(s string) (int32, error) {
				v, err := ParseDetailedChargeStateValue(s)
				return int32(v), err
			},
			// DetailedChargeStateComplete = 5 (note: enum name
			// "DetailedChargeStateValue", LCP across values is
			// "DetailedChargeState" — the "Value" suffix is enum-only)
			fullToken:  "DetailedChargeStateComplete",
			bareSuffix: "Complete",
			wantNumber: 5,
		},
		{
			enum:  "BMSStateValue",
			parse: func(s string) (int32, error) { v, err := ParseBMSStateValue(s); return int32(v), err },
			// BMSStateFEIM = 5 (note: all-caps prefix "BMS" exercises the
			// LCP algorithm against a non-Pascal-cased boundary)
			fullToken:  "BMSStateFEIM",
			bareSuffix: "FEIM",
			wantNumber: 5,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.enum+"/full_token", func(t *testing.T) {
			got, err := tc.parse(tc.fullToken)
			if err != nil {
				t.Fatalf("Parse%s(%q) returned error: %v", tc.enum, tc.fullToken, err)
			}
			if got != tc.wantNumber {
				t.Errorf("Parse%s(%q) = %d, want %d", tc.enum, tc.fullToken, got, tc.wantNumber)
			}
		})

		t.Run(tc.enum+"/bare_suffix", func(t *testing.T) {
			got, err := tc.parse(tc.bareSuffix)
			if err != nil {
				t.Fatalf("Parse%s(%q) returned error: %v", tc.enum, tc.bareSuffix, err)
			}
			if got != tc.wantNumber {
				t.Errorf("Parse%s(%q) = %d, want %d", tc.enum, tc.bareSuffix, got, tc.wantNumber)
			}
		})

		t.Run(tc.enum+"/cross_form_invariance", func(t *testing.T) {
			fromFull, err := tc.parse(tc.fullToken)
			if err != nil {
				t.Fatalf("Parse%s(%q) errored unexpectedly: %v", tc.enum, tc.fullToken, err)
			}
			fromBare, err := tc.parse(tc.bareSuffix)
			if err != nil {
				t.Fatalf("Parse%s(%q) errored unexpectedly: %v", tc.enum, tc.bareSuffix, err)
			}
			if fromFull != fromBare {
				t.Errorf("Parse%s: full token %q = %d, bare suffix %q = %d (must be equal)",
					tc.enum, tc.fullToken, fromFull, tc.bareSuffix, fromBare)
			}
		})

		t.Run(tc.enum+"/unknown", func(t *testing.T) {
			_, err := tc.parse("DefinitelyNotAValue_xyz")
			if err == nil {
				t.Fatalf("Parse%s(\"DefinitelyNotAValue_xyz\") returned nil error", tc.enum)
			}
			if !strings.Contains(err.Error(), "unknown "+tc.enum) {
				t.Errorf("Parse%s error %q does not contain prefix %q", tc.enum, err.Error(), "unknown "+tc.enum)
			}
			if !strings.Contains(err.Error(), `"DefinitelyNotAValue_xyz"`) {
				t.Errorf("Parse%s error %q does not quote the offending input", tc.enum, err.Error())
			}
		})

		t.Run(tc.enum+"/empty", func(t *testing.T) {
			_, err := tc.parse("")
			if err == nil {
				t.Fatalf("Parse%s(\"\") returned nil error; empty input must not silently match", tc.enum)
			}
			if !strings.Contains(err.Error(), "unknown "+tc.enum) {
				t.Errorf("Parse%s empty-input error %q does not contain expected prefix %q", tc.enum, err.Error(), "unknown "+tc.enum)
			}
		})
	}
}

// TestParseShiftStateZeroOnError confirms that on an unknown input the
// generated parser returns the typed zero value (not an arbitrary
// constant), matching the documented contract for every Parse<Enum>.
func TestParseShiftStateZeroOnError(t *testing.T) {
	got, err := ParseShiftState("not-a-shift-state")
	if err == nil {
		t.Fatal("ParseShiftState returned nil error for unknown input")
	}
	if got != ShiftState(0) {
		t.Errorf("ParseShiftState returned %v on error, want zero value (ShiftState(0))", got)
	}
}

// TestParseSentryModeStateErrorIsWrapped confirms the parser returns a
// real error value (non-nil, non-sentinel) that callers can compare with
// errors.As / errors.Is when classifying — i.e. it isn't returning a
// shared package-level singleton or a panic-recovered placeholder.
func TestParseSentryModeStateErrorIsWrapped(t *testing.T) {
	_, err := ParseSentryModeState("invalid")
	if err == nil {
		t.Fatal("ParseSentryModeState returned nil error for unknown input")
	}
	// Must not be the same instance as a previous call (fmt.Errorf
	// returns a fresh value each call). This guards against a future
	// optimisation that accidentally hoists the error literal into a
	// package-level variable shared across calls.
	_, err2 := ParseSentryModeState("invalid")
	if err2 == nil {
		t.Fatal("second ParseSentryModeState returned nil error")
	}
	if errors.Is(err, err2) && err == err2 {
		t.Errorf("ParseSentryModeState returned the same error instance twice; should be a fresh fmt.Errorf each call")
	}
}
