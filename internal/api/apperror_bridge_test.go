package api

import (
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/api/apperror"
)

// TestAppErrorBridge_VarsPinnedToCanonical pins every parent-level
// catalog var to the canonical *AppError in internal/api/apperror so
// any future divergence (e.g. someone re-assigning a parent var without
// updating its apperror twin) trips on the next test run.
//
// See errors.go file docstring for the "treat catalog vars as read-only"
// discipline this test enforces.
func TestAppErrorBridge_VarsPinnedToCanonical(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		parent *AppError
		canon  *AppError
	}{
		// Spot-check across categories — full equivalence is implied by
		// the file-level alias initialisation. Picking one entry per
		// category is enough to catch a "reassigned one side, forgot the
		// other" regression without locking the test to every Err* name.
		{"ErrInvalidCredentials", ErrInvalidCredentials, apperror.ErrInvalidCredentials},
		{"ErrVehicleNotFound", ErrVehicleNotFound, apperror.ErrVehicleNotFound},
		{"ErrDriveNotFound", ErrDriveNotFound, apperror.ErrDriveNotFound},
		{"ErrTeslaAPIUnavailable", ErrTeslaAPIUnavailable, apperror.ErrTeslaAPIUnavailable},
		{"ErrDBQuery", ErrDBQuery, apperror.ErrDBQuery},
		{"ErrInvalidInput", ErrInvalidInput, apperror.ErrInvalidInput},
		{"ErrGeofenceNotFound", ErrGeofenceNotFound, apperror.ErrGeofenceNotFound},
		{"ErrCommandFailed", ErrCommandFailed, apperror.ErrCommandFailed},
		{"ErrBackupConfigNotFound", ErrBackupConfigNotFound, apperror.ErrBackupConfigNotFound},
		{"ErrChannelNotFound", ErrChannelNotFound, apperror.ErrChannelNotFound},
		{"ErrMQTTUnavailable", ErrMQTTUnavailable, apperror.ErrMQTTUnavailable},
		{"ErrExportFailed", ErrExportFailed, apperror.ErrExportFailed},
		{"ErrRateLimited", ErrRateLimited, apperror.ErrRateLimited},
		{"ErrInternal", ErrInternal, apperror.ErrInternal},
	}
	for _, tc := range cases {
		if tc.parent != tc.canon {
			t.Errorf("%s: parent var diverged from canonical apperror.* (different pointer)", tc.name)
		}
	}
}

// TestAppErrorBridge_CategoriesAndCode pins the parent string consts to
// their apperror twins. Const aliases are a real Go language feature
// (unlike var "aliases") so this is just belt-and-braces — but catches
// the "edited one side, forgot the other" maintenance failure too.
func TestAppErrorBridge_CategoriesAndCode(t *testing.T) {
	t.Parallel()

	if ErrCodeAuthModeOpen != apperror.ErrCodeAuthModeOpen {
		t.Errorf("ErrCodeAuthModeOpen: parent=%q canonical=%q", ErrCodeAuthModeOpen, apperror.ErrCodeAuthModeOpen)
	}

	cats := map[string]struct {
		parent, canon string
	}{
		"Auth":       {ErrCatAuth, apperror.ErrCatAuth},
		"Vehicle":    {ErrCatVehicle, apperror.ErrCatVehicle},
		"Database":   {ErrCatDatabase, apperror.ErrCatDatabase},
		"TeslaAPI":   {ErrCatTeslaAPI, apperror.ErrCatTeslaAPI},
		"Validation": {ErrCatValidation, apperror.ErrCatValidation},
		"Backup":     {ErrCatBackup, apperror.ErrCatBackup},
		"Config":     {ErrCatConfig, apperror.ErrCatConfig},
		"RateLimit":  {ErrCatRateLimit, apperror.ErrCatRateLimit},
		"Internal":   {ErrCatInternal, apperror.ErrCatInternal},
		"Telemetry":  {ErrCatTelemetry, apperror.ErrCatTelemetry},
		"Export":     {ErrCatExport, apperror.ErrCatExport},
		"Geofence":   {ErrCatGeofence, apperror.ErrCatGeofence},
		"Command":    {ErrCatCommand, apperror.ErrCatCommand},
		"Notify":     {ErrCatNotify, apperror.ErrCatNotify},
	}
	for name, c := range cats {
		if c.parent != c.canon {
			t.Errorf("ErrCat%s: parent=%q canonical=%q", name, c.parent, c.canon)
		}
	}
}

// TestAppErrorBridge_CatalogLengths pins the parent ErrorCatalog()
// wrapper to the canonical apperror.ErrorCatalog() — i.e. asserts the
// parent wrapper is a true zero-translation pass-through, not a
// filtered/reordered subset.
func TestAppErrorBridge_CatalogLengths(t *testing.T) {
	t.Parallel()

	parent := ErrorCatalog()
	canon := apperror.ErrorCatalog()

	if len(parent) != len(canon) {
		t.Fatalf("catalog length: parent=%d canonical=%d", len(parent), len(canon))
	}
	for i := range parent {
		if parent[i] != canon[i] {
			t.Errorf("catalog[%d]: parent=%+v canonical=%+v", i, parent[i], canon[i])
		}
	}
}
