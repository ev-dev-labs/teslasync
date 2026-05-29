package api

import "github.com/ev-dev-labs/teslasync/internal/api/apperror"

// The AppError catalog now lives in internal/api/apperror. This bridge
// keeps legacy api.Err*/api.AppError callers
// compiling while subpackaged handlers import the canonical package directly.
// Treat var bridges as read-only: tests pin them to the canonical pointers.

type AppError = apperror.AppError

const (
	ErrCodeAuthModeOpen = apperror.ErrCodeAuthModeOpen
)

const (
	ErrCatAuth       = apperror.ErrCatAuth
	ErrCatVehicle    = apperror.ErrCatVehicle
	ErrCatDatabase   = apperror.ErrCatDatabase
	ErrCatTeslaAPI   = apperror.ErrCatTeslaAPI
	ErrCatValidation = apperror.ErrCatValidation
	ErrCatBackup     = apperror.ErrCatBackup
	ErrCatConfig     = apperror.ErrCatConfig
	ErrCatRateLimit  = apperror.ErrCatRateLimit
	ErrCatInternal   = apperror.ErrCatInternal
	ErrCatTelemetry  = apperror.ErrCatTelemetry
	ErrCatExport     = apperror.ErrCatExport
	ErrCatGeofence   = apperror.ErrCatGeofence
	ErrCatCommand    = apperror.ErrCatCommand
	ErrCatNotify     = apperror.ErrCatNotify
)

// --- Catalog vars (read-only bridges to apperror; see file docstring) ---

var (
	ErrInvalidCredentials    = apperror.ErrInvalidCredentials
	ErrTokenExpired          = apperror.ErrTokenExpired
	ErrTokenInvalid          = apperror.ErrTokenInvalid
	ErrTokenMissing          = apperror.ErrTokenMissing
	ErrAPIKeyInvalid         = apperror.ErrAPIKeyInvalid
	ErrAPIKeyExpired         = apperror.ErrAPIKeyExpired
	ErrAPIKeyRevoked         = apperror.ErrAPIKeyRevoked
	ErrInsufficientPerms     = apperror.ErrInsufficientPerms
	ErrVehicleNotFound       = apperror.ErrVehicleNotFound
	ErrVehicleOffline        = apperror.ErrVehicleOffline
	ErrVehicleAsleep         = apperror.ErrVehicleAsleep
	ErrVehicleBusy           = apperror.ErrVehicleBusy
	ErrDriveNotFound         = apperror.ErrDriveNotFound
	ErrChargeNotFound        = apperror.ErrChargeNotFound
	ErrTripNotFound          = apperror.ErrTripNotFound
	ErrSessionActive         = apperror.ErrSessionActive
	ErrSessionNotFound       = apperror.ErrSessionNotFound
	ErrTeslaAPIUnavailable   = apperror.ErrTeslaAPIUnavailable
	ErrTeslaAPISuspended     = apperror.ErrTeslaAPISuspended
	ErrTeslaAPIRateLimit     = apperror.ErrTeslaAPIRateLimit
	ErrTeslaAPITimeout       = apperror.ErrTeslaAPITimeout
	ErrTeslaAPIAuth          = apperror.ErrTeslaAPIAuth
	ErrTeslaNotConnected     = apperror.ErrTeslaNotConnected
	ErrTeslaEndpointDisabled = apperror.ErrTeslaEndpointDisabled
	ErrDBConnection          = apperror.ErrDBConnection
	ErrDBQuery               = apperror.ErrDBQuery
	ErrDBTransaction         = apperror.ErrDBTransaction
	ErrDBNotFound            = apperror.ErrDBNotFound
	ErrDBDuplicate           = apperror.ErrDBDuplicate
	ErrInvalidInput          = apperror.ErrInvalidInput
	ErrInvalidJSON           = apperror.ErrInvalidJSON
	ErrMissingField          = apperror.ErrMissingField
	ErrInvalidRange          = apperror.ErrInvalidRange
	ErrInvalidID             = apperror.ErrInvalidID
	ErrPayloadTooLarge       = apperror.ErrPayloadTooLarge
	ErrGeofenceNotFound      = apperror.ErrGeofenceNotFound
	ErrGeofenceInvalidCoords = apperror.ErrGeofenceInvalidCoords
	ErrGeofenceInvalidRadius = apperror.ErrGeofenceInvalidRadius
	ErrCommandNotSupported   = apperror.ErrCommandNotSupported
	ErrCommandFailed         = apperror.ErrCommandFailed
	ErrCommandTimeout        = apperror.ErrCommandTimeout
	ErrBackupConfigNotFound  = apperror.ErrBackupConfigNotFound
	ErrBackupRunNotFound     = apperror.ErrBackupRunNotFound
	ErrBackupFailed          = apperror.ErrBackupFailed
	ErrBackupStorageError    = apperror.ErrBackupStorageError
	ErrRestoreFailed         = apperror.ErrRestoreFailed
	ErrChannelNotFound       = apperror.ErrChannelNotFound
	ErrChannelTestFail       = apperror.ErrChannelTestFail
	ErrTelemetryIngestFail   = apperror.ErrTelemetryIngestFail
	ErrMQTTUnavailable       = apperror.ErrMQTTUnavailable
	ErrExportFailed          = apperror.ErrExportFailed
	ErrExportNotFound        = apperror.ErrExportNotFound
	ErrExportInvalidFmt      = apperror.ErrExportInvalidFmt
	ErrRateLimited           = apperror.ErrRateLimited
	ErrInternal              = apperror.ErrInternal
	ErrServiceUnavailable    = apperror.ErrServiceUnavailable
	ErrNotImplemented        = apperror.ErrNotImplemented
)

// ErrorCatalog returns the full list of defined application errors for
// documentation. Wrapper around apperror.ErrorCatalog so callers can
// still use api.ErrorCatalog() during the R2 migration window.
//
// Note: this is an explicit wrapper function, NOT a var bridge. A
// `var ErrorCatalog = apperror.ErrorCatalog` would convert the
// exported function into a mutable variable any importer could
// replace at runtime.
func ErrorCatalog() []*AppError {
	return apperror.ErrorCatalog()
}
