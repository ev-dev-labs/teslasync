package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

// The real pahomqtt.Client must satisfy the narrow publisher port so the
// production wiring in main() keeps compiling against the same abstraction
// the tests exercise. This is a compile-time assertion only.
var _ publisher = pahomqtt.Client(nil)

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

// fakeToken implements pahomqtt.Token deterministically — no goroutines,
// no channels left open, no sleeps — so every test is race-clean and fast.
type fakeToken struct {
	completed bool // what WaitTimeout/Wait report
	err       error
}

func (t *fakeToken) Wait() bool                     { return t.completed }
func (t *fakeToken) WaitTimeout(time.Duration) bool { return t.completed }
func (t *fakeToken) Error() error                   { return t.err }
func (t *fakeToken) Done() <-chan struct{} {
	ch := make(chan struct{})
	close(ch)
	return ch
}

type publishedMsg struct {
	topic    string
	qos      byte
	retained bool
	payload  []byte
}

// fakePublisher is an in-memory publisher port double. It records every
// successful publish and can be configured to return a nil token, a
// timed-out token, or a delivery error (optionally after N successes).
type fakePublisher struct {
	mu             sync.Mutex
	msgs           []publishedMsg
	attempts       int
	returnNilToken bool
	timeout        bool
	errOnPublish   error
	failAfter      int // number of successful publishes before errOnPublish kicks in
}

func (f *fakePublisher) Publish(topic string, qos byte, retained bool, payload interface{}) pahomqtt.Token {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.returnNilToken {
		return nil
	}
	attempt := f.attempts
	f.attempts++

	if f.timeout {
		return &fakeToken{completed: false}
	}
	if f.errOnPublish != nil && attempt >= f.failAfter {
		return &fakeToken{completed: true, err: f.errOnPublish}
	}
	f.msgs = append(f.msgs, publishedMsg{topic: topic, qos: qos, retained: retained, payload: toBytes(payload)})
	return &fakeToken{completed: true}
}

func (f *fakePublisher) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.msgs)
}

func (f *fakePublisher) topics() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, len(f.msgs))
	for i, m := range f.msgs {
		out[i] = m.topic
	}
	return out
}

func (f *fakePublisher) last() (publishedMsg, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.msgs) == 0 {
		return publishedMsg{}, false
	}
	return f.msgs[len(f.msgs)-1], true
}

func toBytes(payload interface{}) []byte {
	switch p := payload.(type) {
	case []byte:
		return append([]byte(nil), p...)
	case string:
		return []byte(p)
	default:
		b, _ := json.Marshal(p)
		return b
	}
}

// envelope mirrors the wire shape publishField emits.
type wireEnvelope struct {
	Value json.RawMessage `json:"value"`
	TS    string          `json:"ts"`
}

func meta(kind protomodel.ValueKind, enumType, enumPrefix string) *protomodel.SignalMeta {
	return &protomodel.SignalMeta{
		ValueKind:        kind,
		EnumTypeName:     enumType,
		EnumStringPrefix: enumPrefix,
	}
}

func hasTopic(topics []string, want string) bool {
	for _, tpc := range topics {
		if tpc == want {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// fieldAt
// ---------------------------------------------------------------------------

func TestFieldAt(t *testing.T) {
	rec := []string{"a", "b", "c"}
	tests := []struct {
		name string
		rec  []string
		idx  int
		want string
	}{
		{"first", rec, 0, "a"},
		{"middle", rec, 1, "b"},
		{"last", rec, 2, "c"},
		{"one past end", rec, 3, ""},
		{"far past end", rec, 99, ""},
		{"negative", rec, -1, ""},
		{"empty slice", []string{}, 0, ""},
		{"nil slice", nil, 0, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := fieldAt(tt.rec, tt.idx); got != tt.want {
				t.Errorf("fieldAt(%v, %d) = %q, want %q", tt.rec, tt.idx, got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// parseCSVTimestamp
// ---------------------------------------------------------------------------

func TestParseCSVTimestamp(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    time.Time
		wantErr bool
	}{
		{
			name:  "postgres +00 with fractional",
			input: "2026-04-17 02:47:24.891511+00",
			want:  time.Date(2026, 4, 17, 2, 47, 24, 891511000, time.UTC),
		},
		{
			name:  "space no timezone",
			input: "2026-04-18 00:22:00",
			want:  time.Date(2026, 4, 18, 0, 22, 0, 0, time.UTC),
		},
		{
			name:  "space fractional no timezone",
			input: "2026-04-18 00:22:00.5",
			want:  time.Date(2026, 4, 18, 0, 22, 0, 500000000, time.UTC),
		},
		{
			name:  "explicit offset converted to UTC",
			input: "2026-04-18 00:22:00-0700",
			want:  time.Date(2026, 4, 18, 7, 22, 0, 0, time.UTC),
		},
		{
			name:  "rfc3339",
			input: "2026-04-18T00:22:00Z",
			want:  time.Date(2026, 4, 18, 0, 22, 0, 0, time.UTC),
		},
		{
			name:  "surrounding whitespace trimmed",
			input: "  2026-04-18 00:22:00  ",
			want:  time.Date(2026, 4, 18, 0, 22, 0, 0, time.UTC),
		},
		{name: "empty", input: "", wantErr: true},
		{name: "whitespace only", input: "   ", wantErr: true},
		{name: "garbage", input: "not-a-timestamp", wantErr: true},
		{name: "partial date", input: "2026-04", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseCSVTimestamp(tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("parseCSVTimestamp(%q) err = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}
			if !got.Equal(tt.want) {
				t.Errorf("parseCSVTimestamp(%q) = %v, want %v", tt.input, got, tt.want)
			}
			if got.Location() != time.UTC {
				t.Errorf("parseCSVTimestamp(%q) location = %v, want UTC", tt.input, got.Location())
			}
		})
	}
}

// ---------------------------------------------------------------------------
// parseTimeFilter
// ---------------------------------------------------------------------------

func TestParseTimeFilter(t *testing.T) {
	def := time.Date(1999, 1, 1, 0, 0, 0, 0, time.UTC)
	tests := []struct {
		name    string
		input   string
		want    time.Time
		wantErr bool
	}{
		{"empty returns default", "", def, false},
		{"whitespace returns default", "   ", def, false},
		{"valid parsed", "2026-04-18 00:22:00", time.Date(2026, 4, 18, 0, 22, 0, 0, time.UTC), false},
		{"invalid returns error", "not-a-time", time.Time{}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseTimeFilter(tt.input, def)
			if (err != nil) != tt.wantErr {
				t.Fatalf("parseTimeFilter(%q) err = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
			if tt.wantErr {
				if !got.IsZero() {
					t.Errorf("parseTimeFilter(%q) on error = %v, want zero", tt.input, got)
				}
				return
			}
			if !got.Equal(tt.want) {
				t.Errorf("parseTimeFilter(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// indexHeaders
// ---------------------------------------------------------------------------

func TestIndexHeaders(t *testing.T) {
	want := []string{"signal", "value_num", "value_str", "value_bool", "created_at"}

	t.Run("all present in order", func(t *testing.T) {
		got, err := indexHeaders([]string{"signal", "value_num", "value_str", "value_bool", "created_at"}, want)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		expect := map[string]int{"signal": 0, "value_num": 1, "value_str": 2, "value_bool": 3, "created_at": 4}
		if !reflect.DeepEqual(got, expect) {
			t.Errorf("indexHeaders = %v, want %v", got, expect)
		}
	})

	t.Run("whitespace trimmed and extra columns tolerated", func(t *testing.T) {
		got, err := indexHeaders([]string{"vehicle_id", " signal ", "value_num", "value_str", "value_bool", "created_at"}, want)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got["signal"] != 1 {
			t.Errorf("signal index = %d, want 1 (trimmed)", got["signal"])
		}
		if got["created_at"] != 5 {
			t.Errorf("created_at index = %d, want 5", got["created_at"])
		}
	})

	t.Run("reordered columns", func(t *testing.T) {
		got, err := indexHeaders([]string{"created_at", "value_bool", "value_str", "value_num", "signal"}, want)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got["created_at"] != 0 || got["signal"] != 4 {
			t.Errorf("indices wrong for reordered header: %v", got)
		}
	})

	t.Run("missing single column errors", func(t *testing.T) {
		got, err := indexHeaders([]string{"signal", "value_num", "value_str", "value_bool"}, want)
		if err == nil {
			t.Fatal("expected error for missing created_at")
		}
		if got != nil {
			t.Errorf("expected nil map on error, got %v", got)
		}
		if !strings.Contains(err.Error(), "created_at") {
			t.Errorf("error should name missing column, got %q", err.Error())
		}
	})

	t.Run("missing multiple columns errors", func(t *testing.T) {
		_, err := indexHeaders([]string{"signal", "value_num"}, want)
		if err == nil {
			t.Fatal("expected error for multiple missing columns")
		}
		if !strings.Contains(err.Error(), "missing required columns") {
			t.Errorf("unexpected error text: %q", err.Error())
		}
	})
}

// ---------------------------------------------------------------------------
// enum canonicalisers
// ---------------------------------------------------------------------------

func TestCanonicaliseShiftState(t *testing.T) {
	tests := []struct {
		in     string
		want   string
		wantOk bool
	}{
		{"P", "ShiftStateP", true},
		{"p", "ShiftStateP", true},
		{"R", "ShiftStateR", true},
		{"N", "ShiftStateN", true},
		{"D", "ShiftStateD", true},
		{"d", "ShiftStateD", true},
		{"INVALID", "ShiftStateInvalid", true},
		{"sna", "ShiftStateSNA", true},
		{"ShiftStateD", "ShiftStateD", true},
		{"X", "", false},
		{"", "", false},
		{"Drive", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			got, ok := canonicaliseShiftState(tt.in)
			if ok != tt.wantOk || got != tt.want {
				t.Errorf("canonicaliseShiftState(%q) = (%q, %v), want (%q, %v)", tt.in, got, ok, tt.want, tt.wantOk)
			}
		})
	}
}

func TestCanonicaliseChargingState(t *testing.T) {
	tests := []struct {
		in     string
		want   string
		wantOk bool
	}{
		{"ChargeStateCharging", "ChargeStateCharging", true},
		{"Idle", "ChargeStateStopped", true},
		{"Authorizing", "ChargeStateStopped", true},
		{"WaitForLineVoltage", "ChargeStateStarting", true},
		{"Charging", "ChargeStateCharging", true},
		{"Stopped", "ChargeStateStopped", true},
		{"Disconnected", "ChargeStateDisconnected", true},
		{"Complete", "ChargeStateComplete", true},
		{"NoPower", "ChargeStateNoPower", true},
		{"Bogus", "", false},
		{"", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			got, ok := canonicaliseChargingState(tt.in)
			if ok != tt.wantOk || got != tt.want {
				t.Errorf("canonicaliseChargingState(%q) = (%q, %v), want (%q, %v)", tt.in, got, ok, tt.want, tt.wantOk)
			}
		})
	}
}

func TestCanonicaliseDetailedChargeState(t *testing.T) {
	tests := []struct {
		in     string
		want   string
		wantOk bool
	}{
		{"DetailedChargeStateComplete", "DetailedChargeStateComplete", true},
		{"Idle", "DetailedChargeStateStopped", true},
		{"Authorizing", "DetailedChargeStateStopped", true},
		{"WaitForLineVoltage", "DetailedChargeStateStarting", true},
		{"Charging", "DetailedChargeStateCharging", true},
		{"NoPower", "DetailedChargeStateNoPower", true},
		{"Nope", "", false},
		{"", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			got, ok := canonicaliseDetailedChargeState(tt.in)
			if ok != tt.wantOk || got != tt.want {
				t.Errorf("canonicaliseDetailedChargeState(%q) = (%q, %v), want (%q, %v)", tt.in, got, ok, tt.want, tt.wantOk)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// encodeEnumValue
// ---------------------------------------------------------------------------

func TestEncodeEnumValue(t *testing.T) {
	tests := []struct {
		name       string
		meta       *protomodel.SignalMeta
		row        csvRow
		want       any
		wantReason string
	}{
		{
			name: "shift state short form",
			meta: meta(protomodel.ValueKindEnum, "ShiftState", "ShiftState"),
			row:  csvRow{valueStr: "D"},
			want: "ShiftStateD",
		},
		{
			name: "shift state falls back to value_num",
			meta: meta(protomodel.ValueKindEnum, "ShiftState", "ShiftState"),
			row:  csvRow{valueNum: "R"},
			want: "ShiftStateR",
		},
		{
			name:       "shift state both empty",
			meta:       meta(protomodel.ValueKindEnum, "ShiftState", "ShiftState"),
			row:        csvRow{},
			wantReason: "enum: empty value_str/value_num",
		},
		{
			name:       "shift state unrecognised",
			meta:       meta(protomodel.ValueKindEnum, "ShiftState", "ShiftState"),
			row:        csvRow{valueStr: "X"},
			wantReason: "enum ShiftState: unrecognised X",
		},
		{
			name: "charging state legacy idle",
			meta: meta(protomodel.ValueKindEnum, "ChargingState", "ChargeState"),
			row:  csvRow{valueStr: "Idle"},
			want: "ChargeStateStopped",
		},
		{
			name:       "charging state unknown",
			meta:       meta(protomodel.ValueKindEnum, "ChargingState", "ChargeState"),
			row:        csvRow{valueStr: "Bogus"},
			wantReason: "enum ChargingState: unknown value Bogus",
		},
		{
			name: "detailed charge state complete",
			meta: meta(protomodel.ValueKindEnum, "DetailedChargeStateValue", "DetailedChargeState"),
			row:  csvRow{valueStr: "Complete"},
			want: "DetailedChargeStateComplete",
		},
		{
			name:       "detailed charge state unknown",
			meta:       meta(protomodel.ValueKindEnum, "DetailedChargeStateValue", "DetailedChargeState"),
			row:        csvRow{valueStr: "Weird"},
			wantReason: "enum DetailedChargeStateValue: unknown value Weird",
		},
		{
			name: "default enum prepends prefix",
			meta: meta(protomodel.ValueKindEnum, "DriveInverterState", "DriveInverterState"),
			row:  csvRow{valueStr: "Fault"},
			want: "DriveInverterStateFault",
		},
		{
			name: "default enum already prefixed passthrough",
			meta: meta(protomodel.ValueKindEnum, "DriveInverterState", "DriveInverterState"),
			row:  csvRow{valueStr: "DriveInverterStateFault"},
			want: "DriveInverterStateFault",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, reason := encodeEnumValue(tt.meta, tt.row)
			if reason != tt.wantReason {
				t.Errorf("reason = %q, want %q", reason, tt.wantReason)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("value = %#v, want %#v", got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// encodeRowValue
// ---------------------------------------------------------------------------

func TestEncodeRowValue(t *testing.T) {
	tests := []struct {
		name       string
		meta       *protomodel.SignalMeta
		row        csvRow
		want       any
		wantReason string
	}{
		{
			name: "float valid",
			meta: meta(protomodel.ValueKindFloat, "", ""),
			row:  csvRow{signal: "VehicleSpeed", valueNum: "27.78"},
			want: float32(27.78),
		},
		{
			name:       "float invalid",
			meta:       meta(protomodel.ValueKindFloat, "", ""),
			row:        csvRow{signal: "VehicleSpeed", valueNum: "abc"},
			wantReason: "float parse error",
		},
		{
			name: "double valid",
			meta: meta(protomodel.ValueKindDouble, "", ""),
			row:  csvRow{signal: "D", valueNum: "3.14159265358979"},
			want: float64(3.14159265358979),
		},
		{
			name:       "double invalid",
			meta:       meta(protomodel.ValueKindDouble, "", ""),
			row:        csvRow{signal: "D", valueNum: "xx"},
			wantReason: "double parse error",
		},
		{
			name: "int32 valid",
			meta: meta(protomodel.ValueKindInt32, "", ""),
			row:  csvRow{signal: "I", valueNum: "42"},
			want: int32(42),
		},
		{
			name: "int32 float fallback truncates",
			meta: meta(protomodel.ValueKindInt32, "", ""),
			row:  csvRow{signal: "I", valueNum: "42.9"},
			want: int32(42),
		},
		{
			name:       "int32 invalid",
			meta:       meta(protomodel.ValueKindInt32, "", ""),
			row:        csvRow{signal: "I", valueNum: "nope"},
			wantReason: "int32 parse error",
		},
		{
			name: "int64 valid",
			meta: meta(protomodel.ValueKindInt64, "", ""),
			row:  csvRow{signal: "L", valueNum: "9999999999"},
			want: int64(9999999999),
		},
		{
			name: "int64 float fallback",
			meta: meta(protomodel.ValueKindInt64, "", ""),
			row:  csvRow{signal: "L", valueNum: "12.0"},
			want: int64(12),
		},
		{
			name:       "int64 invalid",
			meta:       meta(protomodel.ValueKindInt64, "", ""),
			row:        csvRow{signal: "L", valueNum: "bad"},
			wantReason: "int64 parse error",
		},
		{
			name: "bool true word",
			meta: meta(protomodel.ValueKindBool, "", ""),
			row:  csvRow{signal: "B", valueBool: "true"},
			want: true,
		},
		{
			name: "bool t shorthand",
			meta: meta(protomodel.ValueKindBool, "", ""),
			row:  csvRow{signal: "B", valueBool: "t"},
			want: true,
		},
		{
			name: "bool yes",
			meta: meta(protomodel.ValueKindBool, "", ""),
			row:  csvRow{signal: "B", valueBool: "YES"},
			want: true,
		},
		{
			name: "bool false zero",
			meta: meta(protomodel.ValueKindBool, "", ""),
			row:  csvRow{signal: "B", valueBool: "0"},
			want: false,
		},
		{
			name:       "bool empty",
			meta:       meta(protomodel.ValueKindBool, "", ""),
			row:        csvRow{signal: "B", valueBool: "   "},
			wantReason: "bool: empty value_bool",
		},
		{
			name:       "bool unrecognised",
			meta:       meta(protomodel.ValueKindBool, "", ""),
			row:        csvRow{signal: "B", valueBool: "maybe"},
			wantReason: "bool: unrecognised value",
		},
		{
			name: "string valid",
			meta: meta(protomodel.ValueKindString, "", ""),
			row:  csvRow{signal: "GpsState", valueStr: "GoodFix"},
			want: "GoodFix",
		},
		{
			name:       "string empty",
			meta:       meta(protomodel.ValueKindString, "", ""),
			row:        csvRow{signal: "GpsState", valueStr: "  "},
			wantReason: "string: empty value_str",
		},
		{
			name: "enum delegates",
			meta: meta(protomodel.ValueKindEnum, "ShiftState", "ShiftState"),
			row:  csvRow{signal: "Gear", valueStr: "P"},
			want: "ShiftStateP",
		},
		{
			name: "compound passthrough raw",
			meta: meta(protomodel.ValueKindCompound, "", ""),
			row:  csvRow{signal: "Location", valueStr: `{"latitude":1.5,"longitude":2.5}`},
			want: json.RawMessage(`{"latitude":1.5,"longitude":2.5}`),
		},
		{
			name:       "compound empty",
			meta:       meta(protomodel.ValueKindCompound, "", ""),
			row:        csvRow{signal: "Location", valueStr: ""},
			wantReason: "compound: empty body (CSV export decomposes compounds)",
		},
		{
			name: "time valid",
			meta: meta(protomodel.ValueKindTime, "", ""),
			row:  csvRow{signal: "T", valueStr: "12:00:00"},
			want: "12:00:00",
		},
		{
			name:       "time empty",
			meta:       meta(protomodel.ValueKindTime, "", ""),
			row:        csvRow{signal: "T", valueStr: ""},
			wantReason: "time: empty value_str",
		},
		{
			name:       "sentinel empty signal",
			meta:       meta(protomodel.ValueKindFloat, "", ""),
			row:        csvRow{signal: ""},
			wantReason: "bare lat/lon (consumed by Location pair)",
		},
		{
			name:       "unsupported value kind",
			meta:       meta(protomodel.ValueKindInvalid, "", ""),
			row:        csvRow{signal: "X"},
			wantReason: "unsupported ValueKind: ValueKindInvalid",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, reason := encodeRowValue(tt.meta, tt.row)
			if reason != tt.wantReason {
				t.Errorf("reason = %q, want %q", reason, tt.wantReason)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("value = %#v (%T), want %#v (%T)", got, got, tt.want, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// topReasons
// ---------------------------------------------------------------------------

func TestTopReasons(t *testing.T) {
	t.Run("empty map", func(t *testing.T) {
		got := topReasons(map[string]int{}, 10)
		if len(got) != 0 {
			t.Errorf("len = %d, want 0", len(got))
		}
	})

	t.Run("sorted descending, all returned when n exceeds len", func(t *testing.T) {
		got := topReasons(map[string]int{"a": 5, "b": 3, "c": 1}, 10)
		want := []reasonCount{{"a", 5}, {"b", 3}, {"c", 1}}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})

	t.Run("truncated to n", func(t *testing.T) {
		got := topReasons(map[string]int{"a": 5, "b": 3, "c": 1}, 2)
		want := []reasonCount{{"a", 5}, {"b", 3}}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})

	t.Run("single entry", func(t *testing.T) {
		got := topReasons(map[string]int{"only": 7}, 5)
		if len(got) != 1 || got[0].reason != "only" || got[0].count != 7 {
			t.Errorf("got %v, want single {only 7}", got)
		}
	})
}

// ---------------------------------------------------------------------------
// pairLatLonRows
// ---------------------------------------------------------------------------

func findRow(rows []csvRow, signal string) (csvRow, bool) {
	for _, r := range rows {
		if r.signal == signal {
			return r, true
		}
	}
	return csvRow{}, false
}

func countSignal(rows []csvRow, signal string) int {
	n := 0
	for _, r := range rows {
		if r.signal == signal {
			n++
		}
	}
	return n
}

func newStats() *replayStats {
	return &replayStats{skipReasons: map[string]int{}, unknownSignals: map[string]int{}}
}

func TestPairLatLonRows(t *testing.T) {
	ts := time.Date(2026, 4, 18, 0, 22, 2, 0, time.UTC)

	t.Run("matched pair folds into Location", func(t *testing.T) {
		rows := []csvRow{
			{signal: "Latitude", valueNum: "37.7749", createdAt: ts},
			{signal: "Longitude", valueNum: "-122.4194", createdAt: ts},
		}
		stats := newStats()
		out := pairLatLonRows(rows, stats)

		loc, ok := findRow(out, "Location")
		if !ok {
			t.Fatal("expected a synthetic Location row")
		}
		if !loc.createdAt.Equal(ts) {
			t.Errorf("Location createdAt = %v, want %v", loc.createdAt, ts)
		}
		var decoded map[string]float64
		if err := json.Unmarshal([]byte(loc.valueStr), &decoded); err != nil {
			t.Fatalf("Location valueStr not valid JSON: %v", err)
		}
		if decoded["latitude"] != 37.7749 || decoded["longitude"] != -122.4194 {
			t.Errorf("Location compound = %v, want lat 37.7749 lon -122.4194", decoded)
		}
		// Original scalars are consumed to the "" sentinel.
		if countSignal(out, "Latitude") != 0 || countSignal(out, "Longitude") != 0 {
			t.Errorf("expected lat/lon consumed to sentinel, got %v", out)
		}
		if countSignal(out, "") != 2 {
			t.Errorf("expected 2 sentinel rows, got %d", countSignal(out, ""))
		}
		if stats.datumsEncoded != 1 {
			t.Errorf("datumsEncoded = %d, want 1", stats.datumsEncoded)
		}
	})

	t.Run("half pair left intact", func(t *testing.T) {
		rows := []csvRow{{signal: "Latitude", valueNum: "37.7749", createdAt: ts}}
		stats := newStats()
		out := pairLatLonRows(rows, stats)
		if _, ok := findRow(out, "Location"); ok {
			t.Error("did not expect a Location row for a half pair")
		}
		if countSignal(out, "Latitude") != 1 {
			t.Error("expected Latitude to survive unpaired")
		}
		if stats.datumsEncoded != 0 {
			t.Errorf("datumsEncoded = %d, want 0", stats.datumsEncoded)
		}
	})

	t.Run("different timestamps not paired", func(t *testing.T) {
		rows := []csvRow{
			{signal: "Latitude", valueNum: "37.7749", createdAt: ts},
			{signal: "Longitude", valueNum: "-122.4194", createdAt: ts.Add(time.Second)},
		}
		out := pairLatLonRows(rows, newStats())
		if _, ok := findRow(out, "Location"); ok {
			t.Error("did not expect pairing across different timestamps")
		}
		if countSignal(out, "Latitude") != 1 || countSignal(out, "Longitude") != 1 {
			t.Error("expected both scalars to survive when timestamps differ")
		}
	})

	t.Run("unparseable coordinate not paired", func(t *testing.T) {
		rows := []csvRow{
			{signal: "Latitude", valueNum: "not-a-number", createdAt: ts},
			{signal: "Longitude", valueNum: "-122.4194", createdAt: ts},
		}
		out := pairLatLonRows(rows, newStats())
		if _, ok := findRow(out, "Location"); ok {
			t.Error("did not expect pairing when a coordinate fails to parse")
		}
		if countSignal(out, "Latitude") != 1 {
			t.Error("expected Latitude to survive when unparseable")
		}
	})

	t.Run("empty input", func(t *testing.T) {
		out := pairLatLonRows(nil, newStats())
		if len(out) != 0 {
			t.Errorf("expected empty output, got %v", out)
		}
	})

	t.Run("unrelated signal in same group preserved", func(t *testing.T) {
		rows := []csvRow{
			{signal: "Latitude", valueNum: "1", createdAt: ts},
			{signal: "Longitude", valueNum: "2", createdAt: ts},
			{signal: "VehicleSpeed", valueNum: "30", createdAt: ts},
		}
		out := pairLatLonRows(rows, newStats())
		if _, ok := findRow(out, "Location"); !ok {
			t.Error("expected Location row")
		}
		if countSignal(out, "VehicleSpeed") != 1 {
			t.Error("expected unrelated VehicleSpeed row to survive")
		}
	})
}

// ---------------------------------------------------------------------------
// publishField
// ---------------------------------------------------------------------------

func TestPublishFieldSuccessWireShape(t *testing.T) {
	fake := &fakePublisher{}
	ts := time.Date(2026, 4, 18, 0, 22, 0, 123456789, time.UTC)

	n, err := publishField(fake, "telemetry", "TESTVIN", "GpsState", "GoodFix", ts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if n <= 0 {
		t.Errorf("returned byte count = %d, want > 0", n)
	}
	msg, ok := fake.last()
	if !ok {
		t.Fatal("no message recorded")
	}
	if msg.topic != "telemetry/TESTVIN/v/GpsState" {
		t.Errorf("topic = %q, want telemetry/TESTVIN/v/GpsState", msg.topic)
	}
	if msg.qos != 1 {
		t.Errorf("qos = %d, want 1", msg.qos)
	}
	if msg.retained {
		t.Error("retained should be false")
	}
	if n != len(msg.payload) {
		t.Errorf("returned n=%d but payload len=%d", n, len(msg.payload))
	}

	var env wireEnvelope
	if err := json.Unmarshal(msg.payload, &env); err != nil {
		t.Fatalf("payload not a valid envelope: %v", err)
	}
	if string(env.Value) != `"GoodFix"` {
		t.Errorf("envelope value = %s, want \"GoodFix\"", env.Value)
	}
	if env.TS != ts.UTC().Format(time.RFC3339Nano) {
		t.Errorf("envelope ts = %q, want %q", env.TS, ts.UTC().Format(time.RFC3339Nano))
	}
}

func TestPublishFieldCompoundValue(t *testing.T) {
	fake := &fakePublisher{}
	raw := json.RawMessage(`{"latitude":1.5,"longitude":2.5}`)
	_, err := publishField(fake, "telemetry", "V", "Location", raw, time.Unix(0, 0).UTC())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	msg, _ := fake.last()
	var env wireEnvelope
	if err := json.Unmarshal(msg.payload, &env); err != nil {
		t.Fatalf("bad envelope: %v", err)
	}
	var loc map[string]float64
	if err := json.Unmarshal(env.Value, &loc); err != nil {
		t.Fatalf("compound value not passed through as object: %v", err)
	}
	if loc["latitude"] != 1.5 || loc["longitude"] != 2.5 {
		t.Errorf("compound = %v, want lat 1.5 lon 2.5", loc)
	}
}

func TestPublishFieldErrors(t *testing.T) {
	ts := time.Unix(0, 0).UTC()
	sentinel := errors.New("broker down")

	tests := []struct {
		name       string
		fake       *fakePublisher
		value      any
		wantErrSub string
		wantWrap   error
	}{
		{
			name:       "marshal failure",
			fake:       &fakePublisher{},
			value:      make(chan int), // channels cannot be JSON-marshalled
			wantErrSub: "marshal envelope",
		},
		{
			name:       "nil token",
			fake:       &fakePublisher{returnNilToken: true},
			value:      "ok",
			wantErrSub: "nil token",
		},
		{
			name:       "timeout",
			fake:       &fakePublisher{timeout: true},
			value:      "ok",
			wantErrSub: "timed out",
		},
		{
			name:       "delivery error wrapped",
			fake:       &fakePublisher{errOnPublish: sentinel},
			value:      "ok",
			wantErrSub: "publish",
			wantWrap:   sentinel,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			n, err := publishField(tt.fake, "telemetry", "V", "F", tt.value, ts)
			if err == nil {
				t.Fatal("expected error")
			}
			if n != 0 {
				t.Errorf("byte count = %d, want 0 on error", n)
			}
			if !strings.Contains(err.Error(), tt.wantErrSub) {
				t.Errorf("error %q does not contain %q", err.Error(), tt.wantErrSub)
			}
			if tt.wantWrap != nil && !errors.Is(err, tt.wantWrap) {
				t.Errorf("error %q does not wrap sentinel", err.Error())
			}
		})
	}
}

// ---------------------------------------------------------------------------
// runSynthetic
// ---------------------------------------------------------------------------

func TestRunSynthetic(t *testing.T) {
	const fieldsPerBurst = 6

	t.Run("publishes full fan-out per burst", func(t *testing.T) {
		fake := &fakePublisher{}
		if err := runSynthetic(fake, "telemetry", "VIN1", 2, 0); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if fake.count() != fieldsPerBurst*2 {
			t.Fatalf("published %d msgs, want %d", fake.count(), fieldsPerBurst*2)
		}
		topics := fake.topics()
		for _, field := range []string{"BatteryLevel", "Soc", "VehicleSpeed", "ACChargingPower", "Gear", "Location"} {
			if !hasTopic(topics, "telemetry/VIN1/v/"+field) {
				t.Errorf("missing publish for field %q", field)
			}
		}
	})

	t.Run("zero count publishes nothing", func(t *testing.T) {
		fake := &fakePublisher{}
		if err := runSynthetic(fake, "telemetry", "VIN1", 0, 0); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if fake.count() != 0 {
			t.Errorf("published %d msgs, want 0", fake.count())
		}
	})

	t.Run("publish error is returned and wrapped", func(t *testing.T) {
		sentinel := errors.New("nope")
		fake := &fakePublisher{errOnPublish: sentinel, failAfter: 0}
		err := runSynthetic(fake, "telemetry", "VIN1", 1, 0)
		if err == nil {
			t.Fatal("expected error")
		}
		if !strings.Contains(err.Error(), "synthetic burst 0") {
			t.Errorf("error %q missing burst context", err.Error())
		}
		if !errors.Is(err, sentinel) {
			t.Errorf("error %q does not wrap sentinel", err.Error())
		}
	})

	t.Run("mid-burst failure surfaces", func(t *testing.T) {
		fake := &fakePublisher{errOnPublish: errors.New("mid"), failAfter: 3}
		if err := runSynthetic(fake, "telemetry", "VIN1", 1, 0); err == nil {
			t.Fatal("expected error after 3 successful publishes")
		}
		if fake.count() != 3 {
			t.Errorf("recorded %d successful publishes, want 3 before failure", fake.count())
		}
	})
}

// ---------------------------------------------------------------------------
// runCSVReplay
// ---------------------------------------------------------------------------

func writeCSV(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "signals.csv")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write temp csv: %v", err)
	}
	return path
}

const sampleCSV = `vehicle_id,signal,value_num,value_str,value_bool,created_at
1,VehicleSpeed,27.8,,,2026-04-18 00:22:00
1,Gear,,D,,2026-04-18 00:22:01
1,Latitude,37.7749,,,2026-04-18 00:22:02
1,Longitude,-122.4194,,,2026-04-18 00:22:02
1,BatteryLevel,78.5,,,2026-04-18 00:22:03
1,UnknownSignalXYZ,1,,,2026-04-18 00:22:04
1,GpsState,,GoodFix,,2026-04-18 00:22:05
`

func TestRunCSVReplayHappyPath(t *testing.T) {
	fake := &fakePublisher{}
	path := writeCSV(t, sampleCSV)

	if err := runCSVReplay(fake, "telemetry", "VIN", path, "", "", 0, 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// VehicleSpeed, Gear, Location (paired), BatteryLevel, GpsState = 5.
	// Unknown skipped; bare Latitude/Longitude folded into Location.
	if fake.count() != 5 {
		t.Fatalf("published %d msgs, want 5 (topics: %v)", fake.count(), fake.topics())
	}
	topics := fake.topics()
	for _, want := range []string{
		"telemetry/VIN/v/VehicleSpeed",
		"telemetry/VIN/v/Gear",
		"telemetry/VIN/v/Location",
		"telemetry/VIN/v/BatteryLevel",
		"telemetry/VIN/v/GpsState",
	} {
		if !hasTopic(topics, want) {
			t.Errorf("missing expected publish %q", want)
		}
	}
	for _, unwanted := range []string{
		"telemetry/VIN/v/Latitude",
		"telemetry/VIN/v/Longitude",
		"telemetry/VIN/v/UnknownSignalXYZ",
	} {
		if hasTopic(topics, unwanted) {
			t.Errorf("did not expect publish %q", unwanted)
		}
	}
}

func TestRunCSVReplayTimeWindow(t *testing.T) {
	fake := &fakePublisher{}
	path := writeCSV(t, sampleCSV)

	// Only rows at/after 00:22:03 — BatteryLevel and GpsState publish;
	// UnknownSignalXYZ is in-window but skipped as unknown.
	if err := runCSVReplay(fake, "telemetry", "VIN", path, "2026-04-18 00:22:03", "", 0, 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if fake.count() != 2 {
		t.Errorf("published %d msgs, want 2 (topics: %v)", fake.count(), fake.topics())
	}
}

func TestRunCSVReplayLimit(t *testing.T) {
	fake := &fakePublisher{}
	path := writeCSV(t, sampleCSV)

	if err := runCSVReplay(fake, "telemetry", "VIN", path, "", "", 0, 2); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if fake.count() != 2 {
		t.Errorf("published %d msgs, want 2 (limit)", fake.count())
	}
}

func TestRunCSVReplayShortRowsTolerated(t *testing.T) {
	// A truncated row must be skipped, not panic (bounds-safe fieldAt).
	content := `vehicle_id,signal,value_num,value_str,value_bool,created_at
1,VehicleSpeed,27.8,,,2026-04-18 00:22:00
1,BatteryLevel
`
	fake := &fakePublisher{}
	path := writeCSV(t, content)
	if err := runCSVReplay(fake, "telemetry", "VIN", path, "", "", 0, 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if fake.count() != 1 {
		t.Errorf("published %d msgs, want 1 (short row skipped)", fake.count())
	}
}

func TestRunCSVReplayErrors(t *testing.T) {
	t.Run("missing file", func(t *testing.T) {
		fake := &fakePublisher{}
		err := runCSVReplay(fake, "telemetry", "VIN", filepath.Join(t.TempDir(), "nope.csv"), "", "", 0, 0)
		if err == nil || !strings.Contains(err.Error(), "open csv") {
			t.Fatalf("err = %v, want open csv error", err)
		}
	})

	t.Run("missing required column", func(t *testing.T) {
		content := "vehicle_id,signal,value_num,value_str,value_bool\n1,VehicleSpeed,27.8,,\n"
		fake := &fakePublisher{}
		err := runCSVReplay(fake, "telemetry", "VIN", writeCSV(t, content), "", "", 0, 0)
		if err == nil || !strings.Contains(err.Error(), "missing required columns") {
			t.Fatalf("err = %v, want missing column error", err)
		}
	})

	t.Run("invalid start filter", func(t *testing.T) {
		fake := &fakePublisher{}
		err := runCSVReplay(fake, "telemetry", "VIN", writeCSV(t, sampleCSV), "garbage", "", 0, 0)
		if err == nil || !strings.Contains(err.Error(), "parse --start") {
			t.Fatalf("err = %v, want start filter error", err)
		}
	})

	t.Run("invalid end filter", func(t *testing.T) {
		fake := &fakePublisher{}
		err := runCSVReplay(fake, "telemetry", "VIN", writeCSV(t, sampleCSV), "", "garbage", 0, 0)
		if err == nil || !strings.Contains(err.Error(), "parse --end") {
			t.Fatalf("err = %v, want end filter error", err)
		}
	})

	t.Run("no rows in window", func(t *testing.T) {
		fake := &fakePublisher{}
		err := runCSVReplay(fake, "telemetry", "VIN", writeCSV(t, sampleCSV), "2099-01-01 00:00:00", "", 0, 0)
		if err == nil || !strings.Contains(err.Error(), "no rows in window") {
			t.Fatalf("err = %v, want no rows error", err)
		}
	})

	t.Run("all rows unparseable timestamps", func(t *testing.T) {
		content := "vehicle_id,signal,value_num,value_str,value_bool,created_at\n1,VehicleSpeed,27.8,,,not-a-time\n"
		fake := &fakePublisher{}
		err := runCSVReplay(fake, "telemetry", "VIN", writeCSV(t, content), "", "", 0, 0)
		if err == nil || !strings.Contains(err.Error(), "no rows in window") {
			t.Fatalf("err = %v, want no rows error", err)
		}
	})

	t.Run("publish error propagates", func(t *testing.T) {
		fake := &fakePublisher{errOnPublish: errors.New("broker gone")}
		err := runCSVReplay(fake, "telemetry", "VIN", writeCSV(t, sampleCSV), "", "", 0, 0)
		if err == nil || !strings.Contains(err.Error(), "publish row") {
			t.Fatalf("err = %v, want publish row error", err)
		}
	})
}
