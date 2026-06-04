package signal

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"
)

// fakeAsOfReader is a hand-rolled signal.StateReader for SnapshotAt tests.
// Captures the (vehicleID, at) the function passes through so tests can
// assert delegation; behavior is configured by setting stateFn or err.
type fakeAsOfReader struct {
	stateFn func(ctx context.Context, vehicleID int64, at time.Time) (State, error)
	err     error

	gotVehicleID int64
	gotAt        time.Time
	calls        int
}

func (f *fakeAsOfReader) State(ctx context.Context, vehicleID int64, at time.Time) (State, error) {
	f.calls++
	f.gotVehicleID = vehicleID
	f.gotAt = at
	if f.err != nil {
		return nil, f.err
	}
	if f.stateFn == nil {
		return State{}, nil
	}
	return f.stateFn(ctx, vehicleID, at)
}

func (f *fakeAsOfReader) SignalAt(ctx context.Context, vehicleID int64, name string, at time.Time) (SignalValue, error) {
	return nil, nil
}

func (f *fakeAsOfReader) Timeline(ctx context.Context, vehicleID int64, fields []FieldMapping, from, to time.Time, opts TimelineOptions) ([]TimelineRow, error) {
	return nil, nil
}

var _ StateReader = (*fakeAsOfReader)(nil)

// --- ParseAsOf tests ------------------------------------------------------

func TestParseAsOf_AbsentReturnsZeroFalseNil(t *testing.T) {
	values := url.Values{}
	got, ok, err := ParseAsOf(values, time.Now())
	if err != nil {
		t.Fatalf("err: want nil, got %v", err)
	}
	if ok {
		t.Fatalf("ok: want false (no param), got true")
	}
	if !got.IsZero() {
		t.Fatalf("got: want zero time, got %v", got)
	}
}

func TestParseAsOf_EmptyStringReturnsZeroFalseNil(t *testing.T) {
	values := url.Values{}
	values.Set(AsOfQueryParam, "")
	got, ok, err := ParseAsOf(values, time.Now())
	if err != nil {
		t.Fatalf("err: want nil, got %v", err)
	}
	if ok {
		t.Fatalf("ok: want false (empty param), got true")
	}
	if !got.IsZero() {
		t.Fatalf("got: want zero time, got %v", got)
	}
}

func TestParseAsOf_ValidRFC3339Parses(t *testing.T) {
	now := time.Date(2024, 11, 15, 12, 0, 0, 0, time.UTC)
	want := time.Date(2024, 11, 12, 14, 30, 0, 0, time.UTC)
	values := url.Values{}
	values.Set(AsOfQueryParam, want.Format(time.RFC3339))

	got, ok, err := ParseAsOf(values, now)
	if err != nil {
		t.Fatalf("err: want nil, got %v", err)
	}
	if !ok {
		t.Fatalf("ok: want true (valid param), got false")
	}
	if !got.Equal(want) {
		t.Fatalf("got: want %v, got %v", want, got)
	}
}

func TestParseAsOf_NormalisesToUTC(t *testing.T) {
	now := time.Date(2024, 11, 15, 12, 0, 0, 0, time.UTC)
	loc, _ := time.LoadLocation("America/New_York")
	if loc == nil {
		t.Skip("America/New_York timezone unavailable on this host")
	}
	input := time.Date(2024, 11, 12, 9, 30, 0, 0, loc) // -05:00 → 14:30 UTC
	values := url.Values{}
	values.Set(AsOfQueryParam, input.Format(time.RFC3339))

	got, ok, err := ParseAsOf(values, now)
	if err != nil {
		t.Fatalf("err: want nil, got %v", err)
	}
	if !ok {
		t.Fatalf("ok: want true, got false")
	}
	if got.Location() != time.UTC {
		t.Fatalf("location: want UTC, got %v", got.Location())
	}
	if !got.Equal(input) {
		t.Fatalf("instant: want %v, got %v", input, got)
	}
}

func TestParseAsOf_MalformedRejected(t *testing.T) {
	values := url.Values{}
	values.Set(AsOfQueryParam, "not-a-date")
	_, ok, err := ParseAsOf(values, time.Now())
	if ok {
		t.Fatalf("ok: want false, got true")
	}
	if !errors.Is(err, ErrAsOfMalformed) {
		t.Fatalf("err: want ErrAsOfMalformed, got %v", err)
	}
}

func TestParseAsOf_FutureRejected(t *testing.T) {
	now := time.Date(2024, 11, 15, 12, 0, 0, 0, time.UTC)
	future := now.Add(1 * time.Hour)
	values := url.Values{}
	values.Set(AsOfQueryParam, future.Format(time.RFC3339))

	_, ok, err := ParseAsOf(values, now)
	if ok {
		t.Fatalf("ok: want false, got true")
	}
	if !errors.Is(err, ErrAsOfFuture) {
		t.Fatalf("err: want ErrAsOfFuture, got %v", err)
	}
}

func TestParseAsOf_TooOldRejected(t *testing.T) {
	now := time.Date(2024, 11, 15, 12, 0, 0, 0, time.UTC)
	tooOld := now.Add(-MaxAsOfLookback - 1*time.Hour)
	values := url.Values{}
	values.Set(AsOfQueryParam, tooOld.Format(time.RFC3339))

	_, ok, err := ParseAsOf(values, now)
	if ok {
		t.Fatalf("ok: want false, got true")
	}
	if !errors.Is(err, ErrAsOfTooOld) {
		t.Fatalf("err: want ErrAsOfTooOld, got %v", err)
	}
}

func TestParseAsOf_BoundaryWithinWindow(t *testing.T) {
	now := time.Date(2024, 11, 15, 12, 0, 0, 0, time.UTC)
	// Exactly at the lower edge of the window — must be accepted.
	edge := now.Add(-MaxAsOfLookback)
	values := url.Values{}
	values.Set(AsOfQueryParam, edge.Format(time.RFC3339))

	got, ok, err := ParseAsOf(values, now)
	if err != nil {
		t.Fatalf("err: want nil, got %v", err)
	}
	if !ok {
		t.Fatalf("ok: want true (lower edge in window), got false")
	}
	if !got.Equal(edge) {
		t.Fatalf("got: want %v, got %v", edge, got)
	}
}

func TestParseAsOf_BoundaryEqualsNow(t *testing.T) {
	now := time.Date(2024, 11, 15, 12, 0, 0, 0, time.UTC)
	values := url.Values{}
	values.Set(AsOfQueryParam, now.Format(time.RFC3339))

	got, ok, err := ParseAsOf(values, now)
	if err != nil {
		t.Fatalf("err: want nil (t == now is allowed), got %v", err)
	}
	if !ok {
		t.Fatalf("ok: want true, got false")
	}
	if !got.Equal(now) {
		t.Fatalf("got: want %v, got %v", now, got)
	}
}

// --- SnapshotAt tests ----------------------------------------------------

func TestSnapshotAt_NilReaderRejected(t *testing.T) {
	at := time.Date(2024, 11, 12, 14, 30, 0, 0, time.UTC)
	_, err := SnapshotAt(context.Background(), nil, 42, at)
	if err == nil {
		t.Fatalf("err: want non-nil for nil reader, got nil")
	}
	if !strings.Contains(err.Error(), "reader is nil") {
		t.Fatalf("err: want mention of nil reader, got %v", err)
	}
}

func TestSnapshotAt_ZeroAtRejected(t *testing.T) {
	reader := &fakeAsOfReader{}
	_, err := SnapshotAt(context.Background(), reader, 42, time.Time{})
	if err == nil {
		t.Fatalf("err: want non-nil for zero at, got nil")
	}
	if !strings.Contains(err.Error(), "non-zero") {
		t.Fatalf("err: want mention of non-zero, got %v", err)
	}
	if reader.calls != 0 {
		t.Fatalf("reader.calls: want 0 (rejected before delegation), got %d", reader.calls)
	}
}

func TestSnapshotAt_DelegatesToReader(t *testing.T) {
	at := time.Date(2024, 11, 12, 14, 30, 0, 0, time.UTC)
	reader := &fakeAsOfReader{
		stateFn: func(ctx context.Context, vehicleID int64, at time.Time) (State, error) {
			return State{
				"VehicleSpeed": float64(65),
				"BatteryLevel": float64(72),
				"Latitude":     float64(37.7),
				"Longitude":    float64(-122.4),
			}, nil
		},
	}

	got, err := SnapshotAt(context.Background(), reader, int64(42), at)
	if err != nil {
		t.Fatalf("err: want nil, got %v", err)
	}
	if reader.calls != 1 {
		t.Fatalf("reader.calls: want 1, got %d", reader.calls)
	}
	if reader.gotVehicleID != 42 {
		t.Fatalf("reader.gotVehicleID: want 42, got %d", reader.gotVehicleID)
	}
	if !reader.gotAt.Equal(at) {
		t.Fatalf("reader.gotAt: want %v, got %v", at, reader.gotAt)
	}
	if got["VehicleSpeed"] != float64(65) {
		t.Fatalf("VehicleSpeed: want 65, got %v", got["VehicleSpeed"])
	}
	if len(got) != 4 {
		t.Fatalf("got: want 4 signals, got %d", len(got))
	}
}

func TestSnapshotAt_NilStateBecomesEmptyMap(t *testing.T) {
	at := time.Date(2024, 11, 12, 14, 30, 0, 0, time.UTC)
	reader := &fakeAsOfReader{
		stateFn: func(ctx context.Context, vehicleID int64, at time.Time) (State, error) {
			return nil, nil
		},
	}

	got, err := SnapshotAt(context.Background(), reader, int64(42), at)
	if err != nil {
		t.Fatalf("err: want nil, got %v", err)
	}
	if got == nil {
		t.Fatalf("got: want non-nil empty State (range-safe), got nil")
	}
	if len(got) != 0 {
		t.Fatalf("got: want 0 entries, got %d", len(got))
	}
}

func TestSnapshotAt_PropagatesReaderError(t *testing.T) {
	at := time.Date(2024, 11, 12, 14, 30, 0, 0, time.UTC)
	boom := errors.New("db down")
	reader := &fakeAsOfReader{err: boom}

	_, err := SnapshotAt(context.Background(), reader, int64(42), at)
	if err == nil {
		t.Fatalf("err: want non-nil, got nil")
	}
	if !errors.Is(err, boom) {
		t.Fatalf("err: want wrapped %v, got %v", boom, err)
	}
}

// TestParseAsOf_ReadOnlyContract is a guardrail test: it asserts that
// ParseAsOf and SnapshotAt are pure read paths by exercising every
// success and failure branch and confirming the fake reader is never
// asked to do anything beyond the StateReader contract. This belt-and-
// braces complements the gate's READ_ONLY_GUARD scan.
func TestParseAsOf_ReadOnlyContract(t *testing.T) {
	now := time.Date(2024, 11, 15, 12, 0, 0, 0, time.UTC)
	at := time.Date(2024, 11, 12, 14, 30, 0, 0, time.UTC)
	values := url.Values{}
	values.Set(AsOfQueryParam, at.Format(time.RFC3339))

	parsed, ok, err := ParseAsOf(values, now)
	if err != nil || !ok {
		t.Fatalf("preflight: ParseAsOf must accept a valid value, err=%v ok=%v", err, ok)
	}

	reader := &fakeAsOfReader{
		stateFn: func(ctx context.Context, vehicleID int64, at time.Time) (State, error) {
			return State{}, nil
		},
	}
	if _, err := SnapshotAt(context.Background(), reader, int64(1), parsed); err != nil {
		t.Fatalf("SnapshotAt: want nil err, got %v", err)
	}
	if reader.calls != 1 {
		t.Fatalf("reader.calls: want exactly 1 (read-only), got %d", reader.calls)
	}
}
