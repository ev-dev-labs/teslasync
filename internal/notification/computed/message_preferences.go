package computed

import (
	"github.com/ev-dev-labs/teslasync/internal/alertmsg"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
)

// MessagePreferences bridges the registry's existing measurement contract to
// the leaf renderer without making the renderer depend on repositories.
func MessagePreferences(p alertmsg.Preferences, rule *alertmodel.AlertRule) alertmsg.Preferences {
	if rule != nil && rule.MetricID != nil {
		p.MetricUnit = ComputedMetrics[*rule.MetricID].Unit
	}
	return p
}
