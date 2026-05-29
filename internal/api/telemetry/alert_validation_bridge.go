package telemetry

import (
	apialerts "github.com/ev-dev-labs/teslasync/internal/api/alerts"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
)

func validateAlertRule(rule *alertmodel.AlertRule) error {
	return apialerts.ValidateAlertRule(rule)
}
