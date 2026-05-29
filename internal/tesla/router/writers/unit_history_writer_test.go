package writers

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// withCapturedLogger redirects the package-level zerolog logger to a
// bytes.Buffer for the duration of the test and restores it on
// cleanup. Tests that call this MUST NOT use t.Parallel() because the
// log.Logger global is shared. The pattern mirrors
// internal/platform/httputil/logging_test.go.
func withCapturedLogger(t *testing.T) *bytes.Buffer {
	t.Helper()
	prev := log.Logger
	var buf bytes.Buffer
	log.Logger = zerolog.New(&buf).Level(zerolog.WarnLevel)
	t.Cleanup(func() { log.Logger = prev })
	return &buf
}

// TestNewUnitHistoryWriter_ReturnsNonNil verifies that the constructor
// takes no arguments and returns a usable router.Writer. The compile-time
// assertion in
// unit_history_writer.go (var _ router.Writer = (*unitHistoryWriter)(nil))
// guarantees interface conformance; this test guards against a future
// refactor that nil-returns the writer (which would fail at the first
// router.New invocation rather than at construction).
func TestNewUnitHistoryWriter_ReturnsNonNil(t *testing.T) {
	w := NewUnitHistoryWriter()
	if w == nil {
		t.Fatal("NewUnitHistoryWriter returned nil; router.New would fail")
	}
}

// TestUnitHistoryWriter_WriteReturnsNilForEverySettingUnit verifies that
// the no-op writer never returns an error. Returning an error would propagate to
// tesla_router_writer_failures_total (see router.go line 168) and
// trigger operator alerts on every Setting*Unit regression; see the
// rationale in unit_history_writer.go.
//
// Iterates all four canonical Setting*Unit fields (matching the four
// `dest: unit_history` entries in routing.yaml lines 830-837) so a
// future contract reversal is caught here rather than via a production
// alert storm.
func TestUnitHistoryWriter_WriteReturnsNilForEverySettingUnit(t *testing.T) {
	_ = withCapturedLogger(t) // suppress noisy WARN output during the loop
	w := NewUnitHistoryWriter()
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)
	const vin = "5YJ3E1EA0KF000042"

	for _, field := range []string{
		"SettingChargeUnit",
		"SettingDistanceUnit",
		"SettingTemperatureUnit",
		"SettingTirePressureUnit",
	} {
		t.Run(field, func(t *testing.T) {
			err := w.Write(context.Background(), codec.Atomic{
				Field:     field,
				Value:     int32(0),
				EmittedAt: ts,
				VehicleID: vin,
			}, router.Entry{
				Field:       field,
				Destination: router.DestUnitHistory,
			})
			if err != nil {
				t.Errorf("Write(%s) returned error %v; no-op contract requires nil", field, err)
			}
		})
	}
}

// TestUnitHistoryWriter_WriteLogsWarnWithFieldName verifies that every
// Write invocation emits a WARN-level structured log entry with the
// offending Field name in
// the message body so operators can pinpoint which Setting*Unit
// short-circuit regressed.
//
// Asserts:
//
//   - the captured output is non-empty (the log line was actually
//     emitted, not silently dropped by an upstream level filter);
//   - the entry's level is "warn";
//   - the structured "field" key carries the canonical field name
//     (operators page-search by signal name);
//   - the message body mentions the field-bearing diagnostic
//     ("Setting*Unit short-circuit ... regressed") so the log alone
//     is enough to start the investigation without cross-referencing
//     this file.
func TestUnitHistoryWriter_WriteLogsWarnWithFieldName(t *testing.T) {
	buf := withCapturedLogger(t)
	w := NewUnitHistoryWriter()

	const field = "SettingDistanceUnit"
	const vin = "5YJ3E1EA0KF000042"
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	err := w.Write(context.Background(), codec.Atomic{
		Field:     field,
		Value:     int32(1),
		EmittedAt: ts,
		VehicleID: vin,
	}, router.Entry{
		Field:       field,
		Destination: router.DestUnitHistory,
	})
	if err != nil {
		t.Fatalf("Write returned error %v; no-op contract requires nil", err)
	}

	out := buf.String()
	if out == "" {
		t.Fatal("expected WARN log entry, got empty output")
	}
	if !strings.Contains(out, `"level":"warn"`) {
		t.Errorf("log entry is not WARN level: %q", out)
	}
	if !strings.Contains(out, `"field":"`+field+`"`) {
		t.Errorf("log entry missing structured field=%q: %q", field, out)
	}
	if !strings.Contains(out, "Setting*Unit short-circuit") {
		t.Errorf("log message missing the diagnostic phrase 'Setting*Unit short-circuit': %q", out)
	}
	if !strings.Contains(out, "should never be called") {
		t.Errorf("log message missing 'should never be called' marker: %q", out)
	}
	if !strings.Contains(out, `"vehicle_id":"`+vin+`"`) {
		t.Errorf("log entry missing structured vehicle_id=%q: %q", vin, out)
	}
	if !strings.Contains(out, `"destination":"unit_history"`) {
		t.Errorf("log entry missing structured destination=unit_history: %q", out)
	}
}

// TestUnitHistoryWriter_SatisfiesRouterWriter is a runtime assertion
// mirroring the file-level compile-time `var _ router.Writer =
// (*unitHistoryWriter)(nil)` declaration. Mirrors the same belt-and-
// braces check in security_event_writer_test.go and
// signal_log_writer_test.go: the compile check catches direct
// signature changes; this runtime check catches subtler breakages
// like the constructor returning the wrong concrete type behind the
// interface (e.g. an embedded type that no longer satisfies Write).
func TestUnitHistoryWriter_SatisfiesRouterWriter(t *testing.T) {
	var w router.Writer = NewUnitHistoryWriter()
	if w == nil {
		t.Fatal("NewUnitHistoryWriter() did not satisfy router.Writer at runtime")
	}
}
