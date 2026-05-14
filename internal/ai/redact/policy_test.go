package redact

import (
	"testing"
)

func TestDefaultPolicy_DeniesEverything(t *testing.T) {
	t.Parallel()
	p := DefaultPolicy()
	if len(p.Allow) != 0 {
		t.Errorf("DefaultPolicy.Allow = %v, want empty", p.Allow)
	}
	if p.Mode != ModeRedactedTags {
		t.Errorf("DefaultPolicy.Mode = %v, want ModeRedactedTags", p.Mode)
	}
	if p.Bypass {
		t.Error("DefaultPolicy.Bypass must be false")
	}
}

func TestPolicy_AllowSet(t *testing.T) {
	t.Parallel()
	p := Policy{Allow: []PIIClass{ClassVIN, ClassEmail}}
	set := p.allowSet()
	if !set[ClassVIN] || !set[ClassEmail] {
		t.Errorf("allowSet missing entries: %v", set)
	}
	if set[ClassPhone] {
		t.Error("allowSet should not contain Phone")
	}
}

func TestPolicy_AllowsAll_True(t *testing.T) {
	t.Parallel()
	p := Policy{Allow: AllClasses()}
	if !p.AllowsAll() {
		t.Error("policy with every class should AllowsAll")
	}
}

func TestPolicy_AllowsAll_False(t *testing.T) {
	t.Parallel()
	subset := AllClasses()
	subset = subset[:len(subset)-1]
	p := Policy{Allow: subset}
	if p.AllowsAll() {
		t.Error("policy with one missing class must not AllowsAll")
	}
}

func TestNamedPolicies(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		policy Policy
		allows []PIIClass
	}{
		{"chatbot", PolicyChatbot(), nil},
		{"digest", PolicyDigest(), []PIIClass{ClassVehicleName}},
		{"alert-builder", PolicyAlertBuilder(), nil},
		{"automation-builder", PolicyAutomationBuilder(), nil},
		{"drive-coaching", PolicyDriveCoaching(), []PIIClass{ClassVehicleName}},
		{"speed-profile-insights", PolicySpeedProfileInsights(), []PIIClass{ClassVehicleName}},
		{"route-efficiency-suggestions", PolicyRouteEfficiencySuggestions(), []PIIClass{ClassVehicleName}},
		{"auto-trip-naming", PolicyAutoTripNaming(), []PIIClass{ClassVehicleName}},
		{"trip-planner-llm-agent", PolicyTripPlannerLLMAgent(), []PIIClass{ClassVehicleName}},
		{"smart-charge-schedule-suggestion", PolicySmartChargeScheduleSuggestion(), []PIIClass{ClassVehicleName}},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if c.policy.Mode != ModeRedactedTags {
				t.Errorf("%s mode = %v, want tags", c.name, c.policy.Mode)
			}
			if len(c.policy.Allow) != len(c.allows) {
				t.Fatalf("%s allow len = %d, want %d", c.name, len(c.policy.Allow), len(c.allows))
			}
			for i, a := range c.allows {
				if c.policy.Allow[i] != a {
					t.Errorf("%s allow[%d] = %v, want %v", c.name, i, c.policy.Allow[i], a)
				}
			}
		})
	}
}
