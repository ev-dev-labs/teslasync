package teslapipeline

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
)

// fakeSoftwareUpdateRecorder is the test double for SoftwareUpdateRecorder.
// It captures every InsertIfChanged call and lets the test pin the return
// value (inserted, error).
type fakeSoftwareUpdateRecorder struct {
	calls         atomic.Int32
	lastVehicleID int64
	lastVersion   string
	lastStatus    string
	returnErr     error
	returnInserted bool
}

func (f *fakeSoftwareUpdateRecorder) InsertIfChanged(_ context.Context, vehicleID int64, version, status string) (bool, error) {
	f.calls.Add(1)
	f.lastVehicleID = vehicleID
	f.lastVersion = version
	f.lastStatus = status
	return f.returnInserted, f.returnErr
}

func TestNewSoftwareUpdateObserver_NilRecorderPanics(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic for nil recorder; got nil")
		}
	}()
	_ = NewSoftwareUpdateObserver(nil, zerolog.Nop())
}

func TestSoftwareUpdateObserver_OnPayloadProcessed_NoVersionField_NoCall(t *testing.T) {
	rec := &fakeSoftwareUpdateRecorder{}
	obs := NewSoftwareUpdateObserver(rec, zerolog.Nop())

	obs.OnPayloadProcessed(context.Background(), 42, []codec.Atomic{
		{Field: "VehicleSpeed", Value: float32(35.0), EmittedAt: time.Now()},
		{Field: "Soc", Value: float32(78.0), EmittedAt: time.Now()},
	})

	if rec.calls.Load() != 0 {
		t.Fatalf("expected 0 InsertIfChanged calls, got %d", rec.calls.Load())
	}
}

func TestSoftwareUpdateObserver_OnPayloadProcessed_EmptyString_NoCall(t *testing.T) {
	rec := &fakeSoftwareUpdateRecorder{}
	obs := NewSoftwareUpdateObserver(rec, zerolog.Nop())

	obs.OnPayloadProcessed(context.Background(), 42, []codec.Atomic{
		{Field: "SoftwareUpdateVersion", Value: "", EmittedAt: time.Now()},
		{Field: "Version", Value: "", EmittedAt: time.Now()},
	})

	if rec.calls.Load() != 0 {
		t.Fatalf("expected 0 InsertIfChanged calls for empty version, got %d", rec.calls.Load())
	}
}

func TestSoftwareUpdateObserver_OnPayloadProcessed_NonStringValue_NoCall(t *testing.T) {
	rec := &fakeSoftwareUpdateRecorder{}
	obs := NewSoftwareUpdateObserver(rec, zerolog.Nop())

	// A producer bug: SoftwareUpdateVersion arrives as something other than
	// a string. The codec contract guarantees string for ValueKindString
	// fields, so this branch is defensive — the observer must NOT panic
	// and MUST NOT call the recorder with a fabricated value.
	obs.OnPayloadProcessed(context.Background(), 42, []codec.Atomic{
		{Field: "SoftwareUpdateVersion", Value: 12345, EmittedAt: time.Now()},
	})

	if rec.calls.Load() != 0 {
		t.Fatalf("expected 0 InsertIfChanged calls for non-string version, got %d", rec.calls.Load())
	}
}

func TestSoftwareUpdateObserver_OnPayloadProcessed_SoftwareUpdateVersion_RecordsWithInstalledStatus(t *testing.T) {
	rec := &fakeSoftwareUpdateRecorder{returnInserted: true}
	obs := NewSoftwareUpdateObserver(rec, zerolog.Nop())

	obs.OnPayloadProcessed(context.Background(), 42, []codec.Atomic{
		{Field: "SoftwareUpdateVersion", Value: "2026.14.6", EmittedAt: time.Now()},
	})

	if got := rec.calls.Load(); got != 1 {
		t.Fatalf("expected 1 InsertIfChanged call, got %d", got)
	}
	if rec.lastVehicleID != 42 {
		t.Errorf("vehicleID = %d, want 42", rec.lastVehicleID)
	}
	if rec.lastVersion != "2026.14.6" {
		t.Errorf("version = %q, want %q", rec.lastVersion, "2026.14.6")
	}
	if rec.lastStatus != "installed" {
		t.Errorf("status = %q, want %q (matches legacy trackVehicleConfig)", rec.lastStatus, "installed")
	}
}

func TestSoftwareUpdateObserver_OnPayloadProcessed_VersionOnly_FallsBackToVersion(t *testing.T) {
	rec := &fakeSoftwareUpdateRecorder{returnInserted: true}
	obs := NewSoftwareUpdateObserver(rec, zerolog.Nop())

	obs.OnPayloadProcessed(context.Background(), 7, []codec.Atomic{
		{Field: "Version", Value: "2026.14.6", EmittedAt: time.Now()},
	})

	if got := rec.calls.Load(); got != 1 {
		t.Fatalf("expected 1 InsertIfChanged call (fallback path), got %d", got)
	}
	if rec.lastVersion != "2026.14.6" {
		t.Errorf("version = %q, want %q (Version fallback)", rec.lastVersion, "2026.14.6")
	}
}

func TestSoftwareUpdateObserver_OnPayloadProcessed_BothFields_PrefersSoftwareUpdateVersion(t *testing.T) {
	rec := &fakeSoftwareUpdateRecorder{returnInserted: true}
	obs := NewSoftwareUpdateObserver(rec, zerolog.Nop())

	// Both Version and SoftwareUpdateVersion present with DIFFERENT values
	// — SoftwareUpdateVersion must win because it's the field the user's
	// production Live Signals proves is being emitted, and its name
	// semantically matches the software_updates table's purpose.
	obs.OnPayloadProcessed(context.Background(), 1, []codec.Atomic{
		{Field: "Version", Value: "2025.44.6", EmittedAt: time.Now()},
		{Field: "SoftwareUpdateVersion", Value: "2026.14.6", EmittedAt: time.Now()},
	})

	if got := rec.calls.Load(); got != 1 {
		t.Fatalf("expected 1 InsertIfChanged call, got %d", got)
	}
	if rec.lastVersion != "2026.14.6" {
		t.Errorf("version = %q, want %q (SoftwareUpdateVersion takes precedence)", rec.lastVersion, "2026.14.6")
	}
}

func TestSoftwareUpdateObserver_OnPayloadProcessed_EmptySoftwareUpdateVersion_FallsBackToVersion(t *testing.T) {
	rec := &fakeSoftwareUpdateRecorder{returnInserted: true}
	obs := NewSoftwareUpdateObserver(rec, zerolog.Nop())

	// SoftwareUpdateVersion is empty (transient producer state); Version
	// is populated. The precedence rule must treat empty as "not present"
	// and fall back to Version.
	obs.OnPayloadProcessed(context.Background(), 1, []codec.Atomic{
		{Field: "SoftwareUpdateVersion", Value: "", EmittedAt: time.Now()},
		{Field: "Version", Value: "2026.14.6", EmittedAt: time.Now()},
	})

	if got := rec.calls.Load(); got != 1 {
		t.Fatalf("expected 1 InsertIfChanged call, got %d", got)
	}
	if rec.lastVersion != "2026.14.6" {
		t.Errorf("version = %q, want %q (Version fallback when SoftwareUpdateVersion is empty)", rec.lastVersion, "2026.14.6")
	}
}

func TestSoftwareUpdateObserver_OnPayloadProcessed_RecorderError_NoPanic(t *testing.T) {
	rec := &fakeSoftwareUpdateRecorder{returnErr: errors.New("simulated DB unavailable")}
	obs := NewSoftwareUpdateObserver(rec, zerolog.Nop())

	// The AtomicsObserver contract is explicit: observer failures MUST
	// NOT fail the payload. A recorder error is logged + swallowed; the
	// observer returns normally.
	obs.OnPayloadProcessed(context.Background(), 42, []codec.Atomic{
		{Field: "SoftwareUpdateVersion", Value: "2026.14.6", EmittedAt: time.Now()},
	})

	if got := rec.calls.Load(); got != 1 {
		t.Fatalf("expected 1 InsertIfChanged call, got %d", got)
	}
}

func TestSoftwareUpdateObserver_OnPayloadProcessed_DuplicateVersion_Silent(t *testing.T) {
	// inserted=false simulates the ON CONFLICT DO NOTHING path: the
	// version was already recorded. The observer should call the recorder
	// (the recorder, not the observer, owns the dedupe decision) but
	// emit NO log line (info-level log is reserved for actual inserts).
	rec := &fakeSoftwareUpdateRecorder{returnInserted: false}
	obs := NewSoftwareUpdateObserver(rec, zerolog.Nop())

	obs.OnPayloadProcessed(context.Background(), 42, []codec.Atomic{
		{Field: "SoftwareUpdateVersion", Value: "2026.14.6", EmittedAt: time.Now()},
	})

	if got := rec.calls.Load(); got != 1 {
		t.Fatalf("expected 1 InsertIfChanged call (idempotent retry), got %d", got)
	}
}

func TestPickFirmwareVersionFromSignals(t *testing.T) {
	cases := []struct {
		name    string
		signals map[string]any
		want    string
	}{
		{"nil map", nil, ""},
		{"empty map", map[string]any{}, ""},
		{"only SoftwareUpdateVersion", map[string]any{"SoftwareUpdateVersion": "2026.14.6"}, "2026.14.6"},
		{"only Version", map[string]any{"Version": "2026.14.6"}, "2026.14.6"},
		{"both same", map[string]any{"SoftwareUpdateVersion": "2026.14.6", "Version": "2026.14.6"}, "2026.14.6"},
		{"both different — SoftwareUpdateVersion wins", map[string]any{"SoftwareUpdateVersion": "2026.14.6", "Version": "2025.44.6"}, "2026.14.6"},
		{"SoftwareUpdateVersion empty falls back to Version", map[string]any{"SoftwareUpdateVersion": "", "Version": "2026.14.6"}, "2026.14.6"},
		{"SoftwareUpdateVersion non-string falls back to Version", map[string]any{"SoftwareUpdateVersion": 12345, "Version": "2026.14.6"}, "2026.14.6"},
		{"both empty", map[string]any{"SoftwareUpdateVersion": "", "Version": ""}, ""},
		{"unrelated keys", map[string]any{"VehicleSpeed": 30.0, "Soc": 78.0}, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := PickFirmwareVersionFromSignals(tc.signals)
			if got != tc.want {
				t.Errorf("PickFirmwareVersionFromSignals() = %q, want %q", got, tc.want)
			}
		})
	}
}
