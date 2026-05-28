package api

import "github.com/ev-dev-labs/teslasync/internal/api/apperror"

// Phase R2.0e (2026-05-28) — the AppError catalog has moved to
// internal/api/apperror. This file is now a back-compat bridge so
// existing call sites (`api.ErrFoo`, `api.AppError`, `api.ErrCatAuth`,
// `api.ErrorCatalog()`) keep compiling while subpackaged handlers
// import the canonical names directly from internal/api/apperror.
//
// # Aliasing semantics — read this before adding entries
//
//   - `type AppError = apperror.AppError` is a TRUE type alias. Method
//     sets, identity, and assignability are all identical to the
//     canonical type.
//   - `const ErrCat... = apperror.ErrCat...` is a TRUE const alias.
//   - `var ErrXxx = apperror.ErrXxx` is NOT a true alias. Both names
//     initially point at the same *AppError, and the *AppError values
//     themselves are treated as immutable across the codebase
//     (WithMessage returns a copy; nobody mutates fields through these
//     pointers). DO NOT reassign one without reassigning both — the
//     enforced discipline is "treat catalog vars as read-only after
//     init". A var-set test in apperror_bridge_test.go pins the two
//     names to the same pointer value so any divergence trips fast.
//   - `func ErrorCatalog() []*AppError { … }` is a wrapper function
//     (NOT a var bridge). Wrapping a function-typed var would let any
//     importer replace the catalog at runtime — explicit wrapper keeps
//     the parent surface tamper-proof.
//
// New code SHOULD import internal/api/apperror directly. New error
// entries MUST be added to internal/api/apperror and a matching alias
// row added here only if any non-subpackaged parent code still names
// it (the long-tail of parent handlers being drained through R2a–R2e).

type AppError = apperror.AppError

// --- Codes ---

const (
	ErrCodeAuthModeOpen = apperror.ErrCodeAuthModeOpen
)

// --- Categories ---

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
	// Auth
	ErrInvalidCredentials = apperror.ErrInvalidCredentials
	ErrTokenExpired       = apperror.ErrTokenExpired
	ErrTokenInvalid       = apperror.ErrTokenInvalid
	ErrTokenMissing       = apperror.ErrTokenMissing
	ErrAPIKeyInvalid      = apperror.ErrAPIKeyInvalid
	ErrAPIKeyExpired      = apperror.ErrAPIKeyExpired
	ErrAPIKeyRevoked      = apperror.ErrAPIKeyRevoked
	ErrInsufficientPerms  = apperror.ErrInsufficientPerms

	// Vehicle
	ErrVehicleNotFound = apperror.ErrVehicleNotFound
	ErrVehicleOffline  = apperror.ErrVehicleOffline
	ErrVehicleAsleep   = apperror.ErrVehicleAsleep
	ErrVehicleBusy     = apperror.ErrVehicleBusy

	// Drives / Charging / Trips
	ErrDriveNotFound   = apperror.ErrDriveNotFound
	ErrChargeNotFound  = apperror.ErrChargeNotFound
	ErrTripNotFound    = apperror.ErrTripNotFound
	ErrSessionActive   = apperror.ErrSessionActive
	ErrSessionNotFound = apperror.ErrSessionNotFound

	// Tesla API
	ErrTeslaAPIUnavailable   = apperror.ErrTeslaAPIUnavailable
	ErrTeslaAPISuspended     = apperror.ErrTeslaAPISuspended
	ErrTeslaAPIRateLimit     = apperror.ErrTeslaAPIRateLimit
	ErrTeslaAPITimeout       = apperror.ErrTeslaAPITimeout
	ErrTeslaAPIAuth          = apperror.ErrTeslaAPIAuth
	ErrTeslaNotConnected     = apperror.ErrTeslaNotConnected
	ErrTeslaEndpointDisabled = apperror.ErrTeslaEndpointDisabled

	// Database
	ErrDBConnection  = apperror.ErrDBConnection
	ErrDBQuery       = apperror.ErrDBQuery
	ErrDBTransaction = apperror.ErrDBTransaction
	ErrDBNotFound    = apperror.ErrDBNotFound
	ErrDBDuplicate   = apperror.ErrDBDuplicate

	// Validation
	ErrInvalidInput    = apperror.ErrInvalidInput
	ErrInvalidJSON     = apperror.ErrInvalidJSON
	ErrMissingField    = apperror.ErrMissingField
	ErrInvalidRange    = apperror.ErrInvalidRange
	ErrInvalidID       = apperror.ErrInvalidID
	ErrPayloadTooLarge = apperror.ErrPayloadTooLarge

	// Geofence
	ErrGeofenceNotFound      = apperror.ErrGeofenceNotFound
	ErrGeofenceInvalidCoords = apperror.ErrGeofenceInvalidCoords
	ErrGeofenceInvalidRadius = apperror.ErrGeofenceInvalidRadius

	// Commands
	ErrCommandNotSupported = apperror.ErrCommandNotSupported
	ErrCommandFailed       = apperror.ErrCommandFailed
	ErrCommandTimeout      = apperror.ErrCommandTimeout

	// Backup
	ErrBackupConfigNotFound = apperror.ErrBackupConfigNotFound
	ErrBackupRunNotFound    = apperror.ErrBackupRunNotFound
	ErrBackupFailed         = apperror.ErrBackupFailed
	ErrBackupStorageError   = apperror.ErrBackupStorageError
	ErrRestoreFailed        = apperror.ErrRestoreFailed

	// Notifications
	ErrChannelNotFound = apperror.ErrChannelNotFound
	ErrChannelTestFail = apperror.ErrChannelTestFail

	// Telemetry
	ErrTelemetryIngestFail = apperror.ErrTelemetryIngestFail
	ErrMQTTUnavailable     = apperror.ErrMQTTUnavailable

	// Export
	ErrExportFailed     = apperror.ErrExportFailed
	ErrExportNotFound   = apperror.ErrExportNotFound
	ErrExportInvalidFmt = apperror.ErrExportInvalidFmt

	// Rate limit
	ErrRateLimited = apperror.ErrRateLimited

	// Internal
	ErrInternal           = apperror.ErrInternal
	ErrServiceUnavailable = apperror.ErrServiceUnavailable
	ErrNotImplemented     = apperror.ErrNotImplemented
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
