package database

import "github.com/ev-dev-labs/teslasync/internal/models"

// modelsAlertRuleStub is a tiny shim used by alert_repo_test.go to
// build minimal AlertRule fixtures focused on the multi-select fields.
// Pulled out so the test file stays focused on assertions, not setup.
// Phase-49 / Slice 0005.
type modelsAlertRuleStub struct {
	AllVehicles bool
	VehicleIDs  []int64
}

func (s *modelsAlertRuleStub) toModel() *models.AlertRule {
	return &models.AlertRule{
		Name:        "fixture",
		Enabled:     true,
		SignalName:  "battery_level",
		Op:          "<",
		Severity:    "warn",
		CooldownMin: 15,
		TriggerMode: "repeat",
		Kind:        models.AlertRuleKindSignal,
		AllVehicles: s.AllVehicles,
		VehicleIDs:  s.VehicleIDs,
	}
}
