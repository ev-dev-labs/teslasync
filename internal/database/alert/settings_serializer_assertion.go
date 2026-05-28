// Phase R4.9: relocated compile-time assertion. The original lived in
// internal/database/settings_serializer.go, which can no longer reference
// *AlertRuleRepo after the alert carve without creating a parent -> child
// import cycle. The assertion stays meaningful here because this file
// imports the parent for the interface type.

package alert

import "github.com/ev-dev-labs/teslasync/internal/database"

var _ database.SettingsSerializerAlertRepo = (*AlertRuleRepo)(nil)
