package writers

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// secEventRecorder is the in-file secEventDB implementation referenced
// by phase-42a prompt 0018. It mirrors the recorder pattern from
// snapshot_base_test.go but adds QueryRow because the security event
// writer's slow-path disambiguation issues a follow-up SELECT EXISTS
// on top of the primary INSERT (see security_event_writer.go's Write
// godoc).
//
// Each test sets:
//   - rows: RowsAffected reported by the synthesised CommandTag for the
//     primary Exec call.
//   - execErr: error returned verbatim from the primary Exec call.
//   - vehicleExists: value returned by the slow-path QueryRow.Scan.
//   - queryErr: error returned verbatim from the slow-path QueryRow's
//     subsequent Scan call.
//
// All Exec / QueryRow invocations are recorded in execCalls / queryCalls
// for shape assertions (SQL contents + bound args).
type secEventRecorder struct {
	execCalls  []recordedCall
	queryCalls []recordedCall

	rows     int64
	execErr  error
	queryErr error

	vehicleExists bool
}

func (r *secEventRecorder) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	cp := make([]any, len(args))
	copy(cp, args)
	r.execCalls = append(r.execCalls, recordedCall{SQL: sql, Args: cp})
	if r.execErr != nil {
		return pgconn.CommandTag{}, r.execErr
	}
	return pgconn.NewCommandTag(fmt.Sprintf("INSERT 0 %d", r.rows)), nil
}

func (r *secEventRecorder) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	cp := make([]any, len(args))
	copy(cp, args)
	r.queryCalls = append(r.queryCalls, recordedCall{SQL: sql, Args: cp})
	return &secEventRow{exists: r.vehicleExists, err: r.queryErr}
}

// secEventRow implements pgx.Row for the slow-path SELECT EXISTS query.
// Scan binds a single bool argument from the recorder-supplied
// vehicleExists value.
type secEventRow struct {
	exists bool
	err    error
}

func (r *secEventRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != 1 {
		return fmt.Errorf("secEventRow.Scan: expected 1 dest, got %d", len(dest))
	}
	target, ok := dest[0].(*bool)
	if !ok {
		return fmt.Errorf("secEventRow.Scan: expected *bool dest, got %T", dest[0])
	}
	*target = r.exists
	return nil
}

// newSecurityEventTestWriter wires a securityEventWriter against the
// secEventRecorder. We deliberately build the writer directly rather
// than through NewSecurityEventWriter because the public constructor
// takes a *pgxpool.Pool and the recorder is the smaller secEventDB
// interface — same seam pattern as climate_writer_test.go's
// newClimateTestWriter / safety_writer_test.go's newSafetyTestWriter.
func newSecurityEventTestWriter(t *testing.T, rec *secEventRecorder) *securityEventWriter {
	t.Helper()
	return &securityEventWriter{db: rec}
}

// TestSecurityEventWriter_TypeMapMatchesRoutingYAML is the reflective
// coverage gate from phase-42a prompt 0018 Decision #5. It walks
// router.LoadMap() (which parses the embedded routing.yaml), filters
// to entries with Destination == DestSecurityEvent, and asserts the
// securityEventTypeByField map in security_event_writer.go covers the
// exact same field set as routing.yaml — same fields, no extras, no
// missing.
//
// This catches three classes of drift at CI time:
//
//   - routing.yaml adds a security_event route but the writer map does
//     not — Write would return "no event_type mapping" at runtime.
//
//   - the writer map adds an entry that routing.yaml does not — the
//     entry is dead code; the test fails with "extra field".
//
//   - routing.yaml declares a `column:` for a security_event entry,
//     which violates Decision #4's contract that security_event entries
//     have no column declaration (event_type is derived from the
//     field name token, not from a routing.yaml column).
func TestSecurityEventWriter_TypeMapMatchesRoutingYAML(t *testing.T) {
	m, err := router.LoadMap()
	if err != nil {
		t.Fatalf("router.LoadMap: %v", err)
	}

	expected := map[string]router.Entry{}
	for field, e := range m {
		if e.Destination == router.DestSecurityEvent {
			expected[field] = e
		}
	}

	if got, want := len(expected), 3; got != want {
		t.Errorf("routing.yaml has %d security_event entries, expected %d "+
			"(prompt 0018 baseline; if the count legitimately changed update both this assertion and securityEventTypeByField)",
			got, want)
	}

	if got, want := len(securityEventTypeByField), len(expected); got != want {
		t.Errorf("securityEventTypeByField has %d entries, routing.yaml has %d",
			got, want)
	}

	for field, e := range expected {
		if _, ok := securityEventTypeByField[field]; !ok {
			t.Errorf("securityEventTypeByField missing field %q", field)
		}
		if e.Column != "" {
			t.Errorf("routing.yaml entry %q under dest: security_event has column=%q "+
				"(violates Decision #4 — security_event entries must not declare a column; "+
				"event_type is derived from the field name token)",
				field, e.Column)
		}
	}
	for field := range securityEventTypeByField {
		if _, ok := expected[field]; !ok {
			t.Errorf("securityEventTypeByField has extra field %q "+
				"(not declared in routing.yaml under dest: security_event)",
				field)
		}
	}
}

// TestSecurityEventWriter_HappyPath_PerRoute exercises every routed
// field today with its expected codec value type per phase-42a prompt
// 0018 Decision #5. The case asserts that the SQL contains the
// security_events INSERT pattern + VIN-resolving SELECT + NOT EXISTS
// duplicate guard, that the bound args are (vin, ts, event_type,
// to_state) in order, that exactly one Exec call was made, and that
// the slow-path QueryRow was NOT issued (steady-state happy path stays
// at one round-trip).
func TestSecurityEventWriter_HappyPath_PerRoute(t *testing.T) {
	const vin = "5YJ3E1EA0KF000018"
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)

	cases := []struct {
		name        string
		field       string
		val         any
		wantEvent   string
		wantToState string
	}{
		{
			name:        "bool_Locked_true",
			field:       "Locked",
			val:         true,
			wantEvent:   "locked",
			wantToState: "true",
		},
		{
			name:        "bool_Locked_false",
			field:       "Locked",
			val:         false,
			wantEvent:   "locked",
			wantToState: "false",
		},
		{
			name:        "bool_ValetModeEnabled_true",
			field:       "ValetModeEnabled",
			val:         true,
			wantEvent:   "valet_mode_enabled",
			wantToState: "true",
		},
		{
			name:        "stringer_SentryMode_Armed",
			field:       "SentryMode",
			val:         stubStringer("SentryModeStateArmed"),
			wantEvent:   "sentry_mode",
			wantToState: "SentryModeStateArmed",
		},
		{
			name:        "stringer_SentryMode_Off",
			field:       "SentryMode",
			val:         stubStringer("SentryModeStateOff"),
			wantEvent:   "sentry_mode",
			wantToState: "SentryModeStateOff",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &secEventRecorder{rows: 1}
			w := newSecurityEventTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field:     tc.field,
				Value:     tc.val,
				EmittedAt: ts,
				VehicleID: vin,
			}, router.Entry{
				Field:       tc.field,
				Destination: router.DestSecurityEvent,
			})
			if err != nil {
				t.Fatalf("Write: %v", err)
			}
			if got := len(rec.execCalls); got != 1 {
				t.Fatalf("execCalls=%d, want 1", got)
			}
			if got := len(rec.queryCalls); got != 0 {
				t.Errorf("queryCalls=%d, want 0 (slow-path SELECT must NOT run on happy path)", got)
			}
			call := rec.execCalls[0]
			assertSecurityEventInsertShape(t, call)
			wantArgs := []any{vin, ts, tc.wantEvent, tc.wantToState}
			if !reflect.DeepEqual(call.Args, wantArgs) {
				t.Errorf("args=%v, want %v", call.Args, wantArgs)
			}
		})
	}
}

// TestSecurityEventWriter_IdempotentDuplicate covers phase-42a prompt
// 0018 Decision #3: a re-delivered (vehicle_id, ts, event_type) MUST
// be treated as a no-op success outcome, NOT a writer failure. The
// router's writer_failures_total counter MUST NOT increment on this
// path.
//
// The test simulates the slow-path disambiguation: primary Exec
// returns RowsAffected==0 (because the row already exists), then the
// follow-up SELECT EXISTS returns true (vehicle is registered), so
// Write returns nil.
func TestSecurityEventWriter_IdempotentDuplicate(t *testing.T) {
	const vin = "5YJ3E1EA0KF000019"
	ts := time.Date(2026, 5, 6, 13, 0, 0, 0, time.UTC)
	rec := &secEventRecorder{rows: 0, vehicleExists: true}
	w := newSecurityEventTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "Locked",
		Value:     true,
		EmittedAt: ts,
		VehicleID: vin,
	}, router.Entry{
		Field:       "Locked",
		Destination: router.DestSecurityEvent,
	})
	if err != nil {
		t.Fatalf("Write: idempotent dup MUST return nil, got %v", err)
	}
	if got := len(rec.execCalls); got != 1 {
		t.Errorf("execCalls=%d, want 1", got)
	}
	if got := len(rec.queryCalls); got != 1 {
		t.Errorf("queryCalls=%d, want 1 (slow-path SELECT MUST run when RowsAffected==0)", got)
	}
	if got := rec.queryCalls[0].Args; !reflect.DeepEqual(got, []any{vin}) {
		t.Errorf("query args=%v, want [vin]", got)
	}
	if !strings.Contains(rec.queryCalls[0].SQL, "SELECT EXISTS") {
		t.Errorf("query SQL missing SELECT EXISTS: %q", rec.queryCalls[0].SQL)
	}
}

// TestSecurityEventWriter_UnknownVehicle covers the second slow-path
// branch: primary Exec returns RowsAffected==0 because the SELECT
// found no vehicle, and the follow-up SELECT EXISTS confirms the VIN
// is unregistered. Write MUST return a typed error WITHOUT the VIN
// in the message (PII rule).
func TestSecurityEventWriter_UnknownVehicle(t *testing.T) {
	const vin = "VIN-NOT-REGISTERED-DEADBEEF"
	rec := &secEventRecorder{rows: 0, vehicleExists: false}
	w := newSecurityEventTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "SentryMode",
		Value:     stubStringer("SentryModeStateArmed"),
		EmittedAt: time.Now().UTC(),
		VehicleID: vin,
	}, router.Entry{
		Field:       "SentryMode",
		Destination: router.DestSecurityEvent,
	})
	if err == nil {
		t.Fatal("expected error when RowsAffected==0 + vehicle absent, got nil")
	}
	if !strings.Contains(err.Error(), "vehicle not registered") {
		t.Errorf("error does not mention unknown vehicle: %q", err.Error())
	}
	if strings.Contains(err.Error(), vin) {
		t.Errorf("error message must NOT include VIN (PII): %q", err.Error())
	}
	if !strings.Contains(err.Error(), "security_events") {
		t.Errorf("error must include destination table for log correlation: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "SentryMode") {
		t.Errorf("error must include field name for log correlation: %q", err.Error())
	}
	if got := len(rec.execCalls); got != 1 {
		t.Errorf("execCalls=%d, want 1", got)
	}
	if got := len(rec.queryCalls); got != 1 {
		t.Errorf("queryCalls=%d, want 1", got)
	}
}

// TestSecurityEventWriter_UnknownFieldReturnsError covers Decision #5:
// a Field that is NOT routed to security_event must produce a "no
// event_type mapping" error and MUST NOT touch the DB.
//
// VehicleSpeed is a deliberate choice — it IS a routed field
// (dest: drive_telemetry per routing.yaml) so the test also implicitly
// guards against accidentally widening the security event map to
// swallow non-security fields.
func TestSecurityEventWriter_UnknownFieldReturnsError(t *testing.T) {
	rec := &secEventRecorder{rows: 1}
	w := newSecurityEventTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "VehicleSpeed",
		Value:     float64(60),
		EmittedAt: time.Now().UTC(),
		VehicleID: "VIN",
	}, router.Entry{
		Field:       "VehicleSpeed",
		Destination: router.DestSecurityEvent,
	})
	if err == nil {
		t.Fatal("expected error for unrouted field, got nil")
	}
	if !strings.Contains(err.Error(), "no event_type mapping for field") {
		t.Errorf("error does not mention missing mapping: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "VehicleSpeed") {
		t.Errorf("error does not name the offending field: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "security_events") {
		t.Errorf("error does not name the destination table: %q", err.Error())
	}
	if got := len(rec.execCalls); got != 0 {
		t.Errorf("expected zero db calls when field is unrouted, got %d", got)
	}
}

// TestSecurityEventWriter_BindStateRejectsBadValues covers
// bindSecurityEventState's rejection branches: nil, unsupported types,
// empty string, and a Stringer that returns empty.
func TestSecurityEventWriter_BindStateRejectsBadValues(t *testing.T) {
	cases := []struct {
		name    string
		val     any
		wantSub string
	}{
		{name: "nil", val: nil, wantSub: "nil value not allowed"},
		{name: "int", val: int(7), wantSub: "unsupported value type"},
		{name: "float64", val: float64(1.5), wantSub: "unsupported value type"},
		{name: "byte_slice", val: []byte("x"), wantSub: "unsupported value type"},
		{name: "empty_string", val: "", wantSub: "empty string not allowed"},
		{name: "empty_stringer", val: stubStringer(""), wantSub: "returned empty string"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &secEventRecorder{rows: 1}
			w := newSecurityEventTestWriter(t, rec)
			err := w.Write(context.Background(), codec.Atomic{
				Field:     "Locked",
				Value:     tc.val,
				EmittedAt: time.Now().UTC(),
				VehicleID: "VIN",
			}, router.Entry{
				Field:       "Locked",
				Destination: router.DestSecurityEvent,
			})
			if err == nil {
				t.Fatalf("expected error for value %T(%v), got nil", tc.val, tc.val)
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Errorf("error %q does not contain %q", err.Error(), tc.wantSub)
			}
			if got := len(rec.execCalls); got != 0 {
				t.Errorf("expected zero db calls for bad value, got %d", got)
			}
		})
	}
}

// TestSecurityEventWriter_DBExecErrorWrapped pins the error-wrapping
// format the router's classifyError tag set depends on. The wrapped
// error must be unwrappable via errors.Is so context.DeadlineExceeded
// / context.Canceled are still detectable downstream.
func TestSecurityEventWriter_DBExecErrorWrapped(t *testing.T) {
	sentinel := errors.New("simulated db failure")
	rec := &secEventRecorder{execErr: sentinel}
	w := newSecurityEventTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "Locked",
		Value:     true,
		EmittedAt: time.Now().UTC(),
		VehicleID: "VIN",
	}, router.Entry{
		Field:       "Locked",
		Destination: router.DestSecurityEvent,
	})
	if err == nil {
		t.Fatal("expected error from db.Exec, got nil")
	}
	if !errors.Is(err, sentinel) {
		t.Errorf("wrapped error does not unwrap to sentinel: %v", err)
	}
	if !strings.Contains(err.Error(), "securityEventWriter[security_events].Locked:") {
		t.Errorf("error missing standard prefix: %q", err.Error())
	}
	// The slow-path SELECT MUST NOT run when the primary Exec errors —
	// the failure mode is "DB unreachable / schema drift", which the
	// disambiguation query would also fail on; running it would just
	// double the load on a struggling backend.
	if got := len(rec.queryCalls); got != 0 {
		t.Errorf("queryCalls=%d, want 0 (slow-path SELECT must not run when primary Exec errors)", got)
	}
}

// TestSecurityEventWriter_DBQueryErrorWrapped covers the slow-path
// failure mode: the primary Exec succeeds with RowsAffected==0 but the
// follow-up SELECT EXISTS errors. The wrapped error must include the
// "disambiguation query" sub-prefix so an operator can tell which
// statement failed, and must remain unwrappable to the sentinel.
func TestSecurityEventWriter_DBQueryErrorWrapped(t *testing.T) {
	sentinel := errors.New("simulated query failure")
	rec := &secEventRecorder{rows: 0, queryErr: sentinel}
	w := newSecurityEventTestWriter(t, rec)
	err := w.Write(context.Background(), codec.Atomic{
		Field:     "Locked",
		Value:     true,
		EmittedAt: time.Now().UTC(),
		VehicleID: "VIN",
	}, router.Entry{
		Field:       "Locked",
		Destination: router.DestSecurityEvent,
	})
	if err == nil {
		t.Fatal("expected error from slow-path QueryRow, got nil")
	}
	if !errors.Is(err, sentinel) {
		t.Errorf("wrapped error does not unwrap to sentinel: %v", err)
	}
	if !strings.Contains(err.Error(), "disambiguation query") {
		t.Errorf("error does not mention disambiguation query: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "securityEventWriter[security_events].Locked:") {
		t.Errorf("error missing standard prefix: %q", err.Error())
	}
}

// TestSecurityEventWriter_TimestampNormalisation pins the EmittedAt
// → UTC + Round(0) normalisation: a non-UTC monotonic-bearing
// timestamp must still bind as the equivalent UTC instant. This
// matches positions_writer.go's normalisation and ensures any future
// signal_log/security_event cross-table JOIN on (vehicle_id, ts) lines
// up bit-for-bit.
func TestSecurityEventWriter_TimestampNormalisation(t *testing.T) {
	la, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Skipf("America/Los_Angeles not available: %v", err)
	}
	tsLA := time.Date(2026, 5, 6, 5, 34, 56, 0, la) // 12:34:56 UTC
	wantUTC := tsLA.UTC()

	rec := &secEventRecorder{rows: 1}
	w := newSecurityEventTestWriter(t, rec)
	err = w.Write(context.Background(), codec.Atomic{
		Field:     "Locked",
		Value:     true,
		EmittedAt: tsLA,
		VehicleID: "VIN",
	}, router.Entry{
		Field:       "Locked",
		Destination: router.DestSecurityEvent,
	})
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if got := len(rec.execCalls); got != 1 {
		t.Fatalf("execCalls=%d, want 1", got)
	}
	gotTS, ok := rec.execCalls[0].Args[1].(time.Time)
	if !ok {
		t.Fatalf("arg[1]=%T, want time.Time", rec.execCalls[0].Args[1])
	}
	if !gotTS.Equal(wantUTC) {
		t.Errorf("ts=%v, want %v (UTC normalisation)", gotTS, wantUTC)
	}
	if gotTS.Location() != time.UTC {
		t.Errorf("ts.Location()=%v, want UTC", gotTS.Location())
	}
}

// TestNewSecurityEventWriter_NilPoolPanics locks the constructor's
// fail-fast contract from phase-42a prompt 0018 Decision #1. A nil
// pool is a wiring bug and panics so the failure surfaces at process
// start, not at the first payload.
func TestNewSecurityEventWriter_NilPoolPanics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected NewSecurityEventWriter(nil) to panic, did not")
		}
		msg, ok := r.(string)
		if !ok {
			t.Fatalf("panic value is %T %v, want string", r, r)
		}
		if !strings.Contains(msg, "pool must be non-nil") {
			t.Errorf("panic message %q does not mention nil pool", msg)
		}
	}()
	_ = NewSecurityEventWriter(nil)
}

// TestSecurityEventWriter_SatisfiesRouterWriter is a runtime
// confirmation of the compile-time assertion in
// security_event_writer.go. Keeping it as a runtime test as well makes
// the contract greppable from the tests folder.
func TestSecurityEventWriter_SatisfiesRouterWriter(t *testing.T) {
	rec := &secEventRecorder{rows: 1}
	w := newSecurityEventTestWriter(t, rec)
	var _ router.Writer = w
}

// assertSecurityEventInsertShape factors the SQL-shape assertions every
// happy-path test repeats: the rendered SQL must contain the
// security_events INSERT clause, the VIN-lookup SELECT against
// vehicles, and the NOT EXISTS duplicate guard.
func assertSecurityEventInsertShape(t *testing.T, call recordedCall) {
	t.Helper()
	if !strings.Contains(call.SQL, "INSERT INTO security_events") {
		t.Errorf("SQL missing INSERT INTO security_events: %q", call.SQL)
	}
	if !strings.Contains(call.SQL, "(vehicle_id, ts, event_type, to_state)") {
		t.Errorf("SQL missing column list (vehicle_id, ts, event_type, to_state): %q", call.SQL)
	}
	if !strings.Contains(call.SQL, "FROM vehicles v WHERE v.vin = $1") {
		t.Errorf("SQL missing VIN lookup: %q", call.SQL)
	}
	if !strings.Contains(call.SQL, "NOT EXISTS") {
		t.Errorf("SQL missing NOT EXISTS duplicate guard: %q", call.SQL)
	}
}

// stubStringer is the test stand-in for the proto-generated enum types
// the codec returns for ValueKindEnum fields (e.g. ftproto.SentryModeState).
// It satisfies fmt.Stringer so the bindSecurityEventState dispatch
// exercises the same code path the production codec output would.
type stubStringer string

func (s stubStringer) String() string { return string(s) }
