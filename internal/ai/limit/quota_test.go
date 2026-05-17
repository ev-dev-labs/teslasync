package limit

import "testing"

func TestQuotaIsZero(t *testing.T) {
	t.Parallel()
	if !(Quota{}).IsZero() {
		t.Errorf("zero-value Quota should report IsZero true")
	}
	if (Quota{BurstReq: 1}).IsZero() {
		t.Errorf("Quota with one non-zero field should not report IsZero")
	}
}

func TestDefaultQuotaForTier(t *testing.T) {
	t.Parallel()
	cases := []struct {
		tier      FeatureTier
		wantBurst int
		wantPM    int
		wantPD    int
	}{
		{TierUpgrade, 2, 20, 200},
		{TierGenerative, 1, 5, 30},
		{TierMaintenance, 1, 1, 10},
		{TierMachineLearn, 1, 1, 10},
		{TierFoundation, 2, 20, 200},
		{FeatureTier("UNKNOWN"), 2, 20, 200}, // fallback to conversational defaults
	}
	for _, tc := range cases {
		t.Run(string(tc.tier), func(t *testing.T) {
			q := DefaultQuotaForTier(tc.tier)
			if q.BurstReq != tc.wantBurst {
				t.Errorf("burst: got %d, want %d", q.BurstReq, tc.wantBurst)
			}
			if q.PerMinute != tc.wantPM {
				t.Errorf("per-minute: got %d, want %d", q.PerMinute, tc.wantPM)
			}
			if q.PerDay != tc.wantPD {
				t.Errorf("per-day: got %d, want %d", q.PerDay, tc.wantPD)
			}
			if q.IsZero() {
				t.Errorf("default quota should never be zero")
			}
		})
	}
}

func TestAllowedDecisionDefaults(t *testing.T) {
	t.Parallel()
	d := AllowedDecision()
	if !d.Allowed {
		t.Error("AllowedDecision should set Allowed=true")
	}
	if !d.BaselineAvailable {
		t.Error("AllowedDecision should default BaselineAvailable=true")
	}
	if d.Reason != "" {
		t.Errorf("AllowedDecision should have empty Reason, got %q", d.Reason)
	}
}
