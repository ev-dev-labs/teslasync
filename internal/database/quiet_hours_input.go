package database

// QuietHoursInput is the patch / create payload accepted by the API
// handler. Setting any pointer leaves the column unchanged for
// PATCH; for Insert the validation defaults are applied.
//
// Lives in the parent database package because it is part of the
// SettingsSerializerQuietHoursRepo interface contract that the
// settings serializer (still in the parent package) consumes. The
// concrete repo implementation lives in
// internal/database/quiethours and accepts *this* type as input —
// see quiethours.QuietHoursRepo for the persistence layer.
type QuietHoursInput struct {
	Enabled          *bool
	StartLocal       *string
	EndLocal         *string
	Timezone         *string
	Weekdays         *int
	BypassSeverities *[]string
}
