// This compile-time assertion lives here to avoid a parent -> child import
// cycle from internal/database/settings_serializer.go to *AlertRuleRepo.

package alert

import "github.com/ev-dev-labs/teslasync/internal/database/settings"

var _ settings.SettingsSerializerAlertRepo = (*AlertRuleRepo)(nil)
