package alerts

import (
	"testing"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
)

func TestEventRuleValidationAndKindNormalization(t *testing.T) {
	component, outage, enter := "mqtt", "outage", "enter"
	placeID := int64(12)
	base := func() *alertmodel.AlertRule {
		return &alertmodel.AlertRule{Name: "event", AllVehicles: true, Severity: "warn", CooldownMin: 1, TriggerMode: "repeat"}
	}
	t.Run("system", func(t *testing.T) {
		r := base()
		r.Kind = alertmodel.AlertRuleKindSystemComponent
		r.ComponentName = &component
		r.Transition = &outage
		if err := validateAlertRule(r); err != nil {
			t.Fatal(err)
		}
		r.Transition = nil
		if err := validateAlertRule(r); err == nil {
			t.Fatal("system rule without transition accepted")
		}
		r.Transition = &outage
		r.AllVehicles = false
		if err := validateAlertRule(r); err == nil {
			t.Fatal("vehicle-scoped system rule accepted")
		}
		r.AllVehicles = true
		bad := "unknown"
		r.ComponentName = &bad
		if err := validateAlertRule(r); err == nil {
			t.Fatal("unknown component accepted")
		}
	})
	t.Run("place", func(t *testing.T) {
		r := base()
		r.Kind = alertmodel.AlertRuleKindPlace
		r.PlaceID = &placeID
		r.Transition = &enter
		if err := validateAlertRule(r); err != nil {
			t.Fatal(err)
		}
		r.Transition = nil
		if err := validateAlertRule(r); err == nil {
			t.Fatal("place rule without transition accepted")
		}
		r.Transition = &enter
		r.SignalName = "VehicleSpeed"
		if err := validateAlertRule(r); err == nil {
			t.Fatal("signal operand accepted for place")
		}
		r.SignalName = ""
		invalid := "outage"
		r.Transition = &invalid
		if err := validateAlertRule(r); err == nil {
			t.Fatal("wrong direction accepted")
		}
	})
	t.Run("switch to signal clears event fields", func(t *testing.T) {
		r := base()
		r.Kind = alertmodel.AlertRuleKindSignal
		r.PlaceID = &placeID
		r.Transition = &enter
		normalizeAlertRuleByKind(r)
		if r.PlaceID != nil || r.Transition != nil {
			t.Fatal("stale event fields retained")
		}
	})
}
