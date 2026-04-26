package fsm

import (
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestDeriveExpectedState(t *testing.T) {
	// signalTime is the approximate timestamp stored by signal.Store.Update.
	// We call Update just before tests, so this is effectively time.Now().
	// Freshness is controlled by the `now` parameter passed to DeriveExpectedState.
	fresh := time.Now()                                    // "now" for fresh signals
	stale := time.Now().Add(3 * time.Minute)               // "now" that makes signals 3 min old → stale
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
			name:       "no Gear + DetailedChargeState=ChargeStateCharging → Charging medium",
			signals:    map[string]interface{}{"DetailedChargeState": "ChargeStateCharging"},
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
			name:       "DetailedChargeState=DetailedChargeStateCharging → Charging medium",
			signals:    map[string]interface{}{"DetailedChargeState": "DetailedChargeStateCharging"},
			now:        fresh,
			wantState:  Charging,
			wantConf:   ConfidenceMedium,
			wantReason: "charge state active (no gear)",
		},
		{
			name:       "DetailedChargeState=Enable → Charging medium",
			signals:    map[string]interface{}{"DetailedChargeState": "Enable"},
			now:        fresh,
			wantState:  Charging,
			wantConf:   ConfidenceMedium,
			wantReason: "charge state active (no gear)",
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
