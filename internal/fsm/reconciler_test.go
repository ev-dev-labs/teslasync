package fsm

import (
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestDeriveExpectedState(t *testing.T) {
	// signalTime is the approximate timestamp stored by the signal
	// store's Update path. We call Update just before tests, so this
	// is effectively time.Now(). Freshness is controlled by the `now`
	// parameter passed to DeriveExpectedState.
	fresh := time.Now()                                       // "now" for fresh signals
	stale := time.Now().Add(3 * time.Minute)                  // "now" that makes signals 3 min old → stale
	slightlyStale := time.Now().Add(SignalFreshnessThreshold) // exactly at threshold boundary

	tests := []struct {
		name       string
		signals    map[string]interface{} // signals to populate
		now        time.Time              // the "now" passed to DeriveExpectedState
		wantState  State
		wantConf   Confidence
		wantReason string
	}{
		{
			name:       "no signals at all",
			signals:    nil,
			now:        fresh,
			wantState:  "",
			wantConf:   ConfidenceNone,
			wantReason: "insufficient signals",
		},
		{
			name:       "all signals stale (3 min old)",
			signals:    map[string]interface{}{"Gear": "D", "ChargeState": "Disconnected"},
			now:        stale,
			wantState:  "",
			wantConf:   ConfidenceNone,
			wantReason: "insufficient signals",
		},
		{
			name:       "fresh Gear=D → Driving high",
			signals:    map[string]interface{}{"Gear": "D"},
			now:        fresh,
			wantState:  Driving,
			wantConf:   ConfidenceHigh,
			wantReason: "Gear=D",
		},
		{
			name:       "fresh Gear=R → Driving high",
			signals:    map[string]interface{}{"Gear": "R"},
			now:        fresh,
			wantState:  Driving,
			wantConf:   ConfidenceHigh,
			wantReason: "Gear=R",
		},
		{
			name:       "fresh Gear=P + ChargeState=Charging → Charging high",
			signals:    map[string]interface{}{"Gear": "P", "ChargeState": "Charging"},
			now:        fresh,
			wantState:  Charging,
			wantConf:   ConfidenceHigh,
			wantReason: "Gear=P + charging",
		},
		{
			name:       "fresh Gear=P + no charge signals → Parked high",
			signals:    map[string]interface{}{"Gear": "P"},
			now:        fresh,
			wantState:  Parked,
			wantConf:   ConfidenceHigh,
			wantReason: "Gear=P + not charging",
		},
		{
			name:       "no Gear + DetailedChargeState=Charging → Charging medium",
			signals:    map[string]interface{}{"DetailedChargeState": "Charging"},
			now:        fresh,
			wantState:  Charging,
			wantConf:   ConfidenceMedium,
			wantReason: "charge state active (no gear)",
		},
		{
			name:       "no Gear + ChargeAmps=32.0 → Charging medium",
			signals:    map[string]interface{}{"ChargeAmps": 32.0},
			now:        fresh,
			wantState:  Charging,
			wantConf:   ConfidenceMedium,
			wantReason: "charge state active (no gear)",
		},
		{
			name:       "no Gear + Speed=65.0 → Driving low",
			signals:    map[string]interface{}{"VehicleSpeed": 65.0},
			now:        fresh,
			wantState:  Driving,
			wantConf:   ConfidenceLow,
			wantReason: "speed > 1.0 (no gear)",
		},
		{
			name:       "fresh Gear=P + ChargeAmps=0 + ChargeState empty → Parked high",
			signals:    map[string]interface{}{"Gear": "P", "ChargeAmps": 0.0, "ChargeState": ""},
			now:        fresh,
			wantState:  Parked,
			wantConf:   ConfidenceHigh,
			wantReason: "Gear=P + not charging",
		},
		{
			name:       "Gear=P + DetailedChargeState=Starting → Charging high",
			signals:    map[string]interface{}{"Gear": "P", "DetailedChargeState": "Starting"},
			now:        fresh,
			wantState:  Charging,
			wantConf:   ConfidenceHigh,
			wantReason: "Gear=P + charging",
		},
		{
			name:       "Gear=P + DetailedChargeState=Complete → Parked high",
			signals:    map[string]interface{}{"Gear": "P", "DetailedChargeState": "Complete"},
			now:        fresh,
			wantState:  Parked,
			wantConf:   ConfidenceHigh,
			wantReason: "Gear=P + not charging",
		},
		{
			name:       "speed=0.5 (below threshold) → ConfidenceNone",
			signals:    map[string]interface{}{"VehicleSpeed": 0.5},
			now:        fresh,
			wantState:  "",
			wantConf:   ConfidenceNone,
			wantReason: "insufficient signals",
		},
		{
			name:       "ChargeAmps=1.0 (at threshold, not above) → ConfidenceNone",
			signals:    map[string]interface{}{"ChargeAmps": 1.0},
			now:        fresh,
			wantState:  "",
			wantConf:   ConfidenceNone,
			wantReason: "insufficient signals",
		},
		{
			name:       "exactly at freshness boundary → still fresh",
			signals:    map[string]interface{}{"Gear": "D"},
			now:        slightlyStale,
			wantState:  Driving,
			wantConf:   ConfidenceHigh,
			wantReason: "Gear=D",
		},
		{
			// Phase-42a: codec canonicalizes proto enum variants to
			// the short form ("Charging", "Starting", ...). The legacy
			// long-form ("DetailedChargeStateCharging") is no longer
			// a valid producer output — protomodel.DecodeValue strips
			// the per-enum prefix at the SINGLE conversion point
			// before the value reaches signal.Store.
			//
			// This case verifies the reconciler treats the canonical
			// short form via the adapter the same way as the
			// ChargeState path above.
			name:       "DetailedChargeState=Charging (canonical) → Charging medium",
			signals:    map[string]interface{}{"DetailedChargeState": "Charging"},
			now:        fresh,
			wantState:  Charging,
			wantConf:   ConfidenceMedium,
			wantReason: "charge state active (no gear)",
		},
		{
			// Phase-42: the SignalAdapter recognises only the canonical
			// proto enum suffixes ("Charging", "Starting") for the
			// DetailedChargeState / ChargeState fields. The legacy
			// "Enable" string emitted by older code paths is no longer
			// in the typed enum (DetailedChargeStateValue ∈ {Unknown,
			// Disconnected, NoPower, Starting, Charging, Complete,
			// Stopped}) and is therefore treated as "not charging" —
			// with no Gear, no ChargeAmps, and no VehicleSpeed signal,
			// the reconciler returns ConfidenceNone even though the
			// freshness gate did pass.
			name:       "DetailedChargeState=Enable (legacy) → ConfidenceNone",
			signals:    map[string]interface{}{"DetailedChargeState": "Enable"},
			now:        fresh,
			wantState:  "",
			wantConf:   ConfidenceNone,
			wantReason: "insufficient signals",
		},
		{
			name:       "ChargeState=Starting → Charging medium",
			signals:    map[string]interface{}{"ChargeState": "Starting"},
			now:        fresh,
			wantState:  Charging,
			wantConf:   ConfidenceMedium,
			wantReason: "charge state active (no gear)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := signal.New()
			vid := int64(1)

			if tt.signals != nil {
				store.Update(vid, tt.signals)
			}

			got := DeriveExpectedState(vid, store, tt.now)

			if got.ExpectedState != tt.wantState {
				t.Errorf("ExpectedState = %q, want %q", got.ExpectedState, tt.wantState)
			}
			if got.Confidence != tt.wantConf {
				t.Errorf("Confidence = %v (%d), want %v (%d)", got.Confidence, got.Confidence, tt.wantConf, tt.wantConf)
			}
			if got.Reason != tt.wantReason {
				t.Errorf("Reason = %q, want %q", got.Reason, tt.wantReason)
			}
		})
	}
}

func TestDeriveExpectedState_MixedFreshness(t *testing.T) {
	// Test: Gear stale but ChargeState fresh → uses ChargeState path.
	// We populate Gear first, wait, then populate ChargeState.
	// Then call with "now" between the two timestamps.
	store := signal.New()
	vid := int64(42)

	// Step 1: Populate Gear=P (will have timestamp ≈ now)
	store.Update(vid, map[string]interface{}{"Gear": "P"})

	// Step 2: Populate ChargeState (same timestamp range from Update)
	store.Update(vid, map[string]interface{}{"ChargeState": "Charging"})

	// With "now" = current time, both are fresh → Gear=P + charging → ConfidenceHigh
	got := DeriveExpectedState(vid, store, time.Now())
	if got.ExpectedState != Charging {
		t.Errorf("both fresh: ExpectedState = %q, want %q", got.ExpectedState, Charging)
	}
	if got.Confidence != ConfidenceHigh {
		t.Errorf("both fresh: Confidence = %v, want %v", got.Confidence, ConfidenceHigh)
	}

	// With "now" = 3 min from now → both stale → ConfidenceNone
	got = DeriveExpectedState(vid, store, time.Now().Add(3*time.Minute))
	if got.Confidence != ConfidenceNone {
		t.Errorf("both stale: Confidence = %v, want %v", got.Confidence, ConfidenceNone)
	}
}

func TestDeriveExpectedState_FreshestAt(t *testing.T) {
	store := signal.New()
	vid := int64(7)

	store.Update(vid, map[string]interface{}{"Gear": "D", "VehicleSpeed": 65.0})

	got := DeriveExpectedState(vid, store, time.Now())

	if got.FreshestAt.IsZero() {
		t.Error("FreshestAt should not be zero when signals are present")
	}
	// FreshestAt should be very recent (within last second)
	if time.Since(got.FreshestAt) > time.Second {
		t.Errorf("FreshestAt too old: %v ago", time.Since(got.FreshestAt))
	}
}

func TestConfidence_String(t *testing.T) {
	tests := []struct {
		c    Confidence
		want string
	}{
		{ConfidenceNone, "none"},
		{ConfidenceLow, "low"},
		{ConfidenceMedium, "medium"},
		{ConfidenceHigh, "high"},
		{Confidence(99), "unknown"},
	}
	for _, tt := range tests {
		if got := tt.c.String(); got != tt.want {
			t.Errorf("Confidence(%d).String() = %q, want %q", tt.c, got, tt.want)
		}
	}
}

// fakeReconcileSource is a hand-rolled implementation of
// reconcileSignalSource used by the seam tests below. Each field can
// be configured independently with a value + timestamp + presence
// flag so a test can exercise the freshness / priority ladder
// without standing up a real signal store and without depending on
// the typed-coercion behaviour of *SignalAdapter.
//
// The concrete method shapes intentionally mirror reconcileSignalSource
// exactly — when the interface gains a new method, this fake MUST be
// extended to keep the seam test honest.
type fakeReconcileSource struct {
	last       map[string]signal.Value
	gear       string
	gearOk     bool
	speed      float64
	speedOk    bool
	charging   bool
	chargingOk bool
}

func (f *fakeReconcileSource) Last(_ int64, field string) (signal.Value, bool) {
	v, ok := f.last[field]
	return v, ok
}

func (f *fakeReconcileSource) Gear(_ int64) (string, bool) { return f.gear, f.gearOk }

func (f *fakeReconcileSource) Speed(_ int64) (float64, bool) { return f.speed, f.speedOk }

func (f *fakeReconcileSource) IsCharging(_ int64) (bool, bool) {
	return f.charging, f.chargingOk
}

// TestDeriveExpectedState_SeamFakeSource exercises the
// adapter-driven core (deriveExpectedState) via a hand-rolled fake
// reconcileSignalSource, without any signal store dependency. This
// is the interface seam introduced in phase-42 prompt 0067.
func TestDeriveExpectedState_SeamFakeSource(t *testing.T) {
	now := time.Date(2026, 5, 4, 12, 0, 0, 0, time.UTC)
	fresh := now.Add(-30 * time.Second)
	stale := now.Add(-10 * time.Minute)

	tests := []struct {
		name      string
		src       *fakeReconcileSource
		wantState State
		wantConf  Confidence
		wantReas  string
	}{
		{
			name:      "no fields → ConfidenceNone",
			src:       &fakeReconcileSource{last: map[string]signal.Value{}},
			wantState: "",
			wantConf:  ConfidenceNone,
			wantReas:  "insufficient signals",
		},
		{
			name: "all fields stale → ConfidenceNone",
			src: &fakeReconcileSource{
				last: map[string]signal.Value{
					"Gear":         {Raw: "D", Timestamp: stale},
					"VehicleSpeed": {Raw: 65.0, Timestamp: stale},
				},
				gear:    "D",
				gearOk:  true,
				speed:   65.0,
				speedOk: true,
			},
			wantState: "",
			wantConf:  ConfidenceNone,
			wantReas:  "insufficient signals",
		},
		{
			name: "fresh Gear=D → Driving high",
			src: &fakeReconcileSource{
				last:   map[string]signal.Value{"Gear": {Raw: "D", Timestamp: fresh}},
				gear:   "D",
				gearOk: true,
			},
			wantState: Driving,
			wantConf:  ConfidenceHigh,
			wantReas:  "Gear=D",
		},
		{
			name: "fresh Gear=P + IsCharging true → Charging high",
			src: &fakeReconcileSource{
				last: map[string]signal.Value{
					"Gear":        {Raw: "P", Timestamp: fresh},
					"ChargeState": {Raw: "Charging", Timestamp: fresh},
				},
				gear:       "P",
				gearOk:     true,
				charging:   true,
				chargingOk: true,
			},
			wantState: Charging,
			wantConf:  ConfidenceHigh,
			wantReas:  "Gear=P + charging",
		},
		{
			name: "fresh Gear=P + no charge → Parked high",
			src: &fakeReconcileSource{
				last:   map[string]signal.Value{"Gear": {Raw: "P", Timestamp: fresh}},
				gear:   "P",
				gearOk: true,
			},
			wantState: Parked,
			wantConf:  ConfidenceHigh,
			wantReas:  "Gear=P + not charging",
		},
		{
			name: "no Gear + IsCharging true → Charging medium",
			src: &fakeReconcileSource{
				last: map[string]signal.Value{
					"DetailedChargeState": {Raw: "Charging", Timestamp: fresh},
				},
				charging:   true,
				chargingOk: true,
			},
			wantState: Charging,
			wantConf:  ConfidenceMedium,
			wantReas:  "charge state active (no gear)",
		},
		{
			name: "no Gear + ChargeAmps>1.0 fallback → Charging medium",
			src: &fakeReconcileSource{
				last: map[string]signal.Value{
					"ChargeAmps": {Raw: 32.0, Timestamp: fresh},
				},
			},
			wantState: Charging,
			wantConf:  ConfidenceMedium,
			wantReas:  "charge state active (no gear)",
		},
		{
			name: "no Gear + ChargeAmps=1.0 (at threshold) → ConfidenceNone",
			src: &fakeReconcileSource{
				last: map[string]signal.Value{
					"ChargeAmps": {Raw: 1.0, Timestamp: fresh},
				},
			},
			wantState: "",
			wantConf:  ConfidenceNone,
			wantReas:  "insufficient signals",
		},
		{
			name: "no Gear + Speed>1.0 → Driving low",
			src: &fakeReconcileSource{
				last: map[string]signal.Value{
					"VehicleSpeed": {Raw: 65.0, Timestamp: fresh},
				},
				speed:   65.0,
				speedOk: true,
			},
			wantState: Driving,
			wantConf:  ConfidenceLow,
			wantReas:  "speed > 1.0 (no gear)",
		},
		{
			name: "no Gear + Speed=0.5 (below threshold) → ConfidenceNone",
			src: &fakeReconcileSource{
				last: map[string]signal.Value{
					"VehicleSpeed": {Raw: 0.5, Timestamp: fresh},
				},
				speed:   0.5,
				speedOk: true,
			},
			wantState: "",
			wantConf:  ConfidenceNone,
			wantReas:  "insufficient signals",
		},
		{
			name: "Gear lookup returns ok=false → falls through priorities",
			src: &fakeReconcileSource{
				// Field present (so isFresh succeeds) but Gear() returns
				// ok=false (e.g. ValueKind mismatch in the real adapter).
				last: map[string]signal.Value{
					"Gear":         {Raw: 0, Timestamp: fresh},
					"VehicleSpeed": {Raw: 65.0, Timestamp: fresh},
				},
				gear:    "",
				gearOk:  false,
				speed:   65.0,
				speedOk: true,
			},
			wantState: Driving,
			wantConf:  ConfidenceLow,
			wantReas:  "speed > 1.0 (no gear)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := deriveExpectedState(99, tt.src, now)
			if got.ExpectedState != tt.wantState {
				t.Errorf("ExpectedState = %q, want %q", got.ExpectedState, tt.wantState)
			}
			if got.Confidence != tt.wantConf {
				t.Errorf("Confidence = %v, want %v", got.Confidence, tt.wantConf)
			}
			if got.Reason != tt.wantReas {
				t.Errorf("Reason = %q, want %q", got.Reason, tt.wantReas)
			}
		})
	}
}

// TestSignalAdapterSatisfiesReconcileSignalSource is a compile-time
// guarantee that *SignalAdapter (the production implementation) is
// always assignable to the seam interface. If the adapter loses any
// of the methods listed in reconcileSignalSource, this test fails
// to compile rather than at runtime.
func TestSignalAdapterSatisfiesReconcileSignalSource(t *testing.T) {
	var _ reconcileSignalSource = (*SignalAdapter)(nil)
}
