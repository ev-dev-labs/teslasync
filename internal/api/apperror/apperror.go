package apperror

import "net/http"

// Machine-readable error codes that are exposed in JSON error bodies and
// consumed by the frontend to drive recovery flows.
//
// AUTH_MODE_OPEN is the canonical signal returned by every endpoint
// that has no sensible behaviour without an upstream
// identity provider configured. The SPA's auth-coupled hooks
// (useAuthMode, useTOTP, useSessions, useImpersonation, useRbacMatrix,
// …) match this exact string to decide whether to render the inline
// "feature requires authentication" placeholder. Mirrored as
// internal/auth.AuthModeOpenCode for handlers that live outside the
// api package.
//
// ErrCodeTeslaTokenExpired lives in internal/api/httpx alongside
// WriteTeslaTokenExpired (the only
// helper that uses it). See httpx.ErrCodeTeslaTokenExpired.
const (
	ErrCodeAuthModeOpen = "AUTH_MODE_OPEN"
)

// Error categories for grouping and filtering.
const (
	ErrCatAuth       = "authentication"
	ErrCatVehicle    = "vehicle"
	ErrCatDatabase   = "database"
	ErrCatTeslaAPI   = "tesla_api"
	ErrCatValidation = "validation"
	ErrCatBackup     = "backup"
	ErrCatConfig     = "configuration"
	ErrCatRateLimit  = "rate_limit"
	ErrCatInternal   = "internal"
	ErrCatTelemetry  = "telemetry"
	ErrCatExport     = "export"
	ErrCatGeofence   = "geofence"
	ErrCatCommand    = "command"
	ErrCatNotify     = "notification"
)

// AppError is a structured application error with a machine-readable code,
// HTTP status, human-readable message, and category for aggregation.
type AppError struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	Status   int    `json:"-"`
	Category string `json:"category"`
}

func (e *AppError) Error() string { return e.Message }

// WithMessage returns a copy of the error with a custom message. The
// original Err* catalog entry is left untouched so callers can safely
// chain `apperror.ErrDBQuery.WithMessage("failed to list backup configs")`
// without leaking the per-call message into the shared catalog.
func (e *AppError) WithMessage(msg string) *AppError {
	return &AppError{Code: e.Code, Message: msg, Status: e.Status, Category: e.Category}
}

// --- Authentication ---

var (
	ErrInvalidCredentials = &AppError{"AUTH_INVALID_CREDENTIALS", "invalid username or password", http.StatusUnauthorized, ErrCatAuth}
	ErrTokenExpired       = &AppError{"AUTH_TOKEN_EXPIRED", "authentication token has expired", http.StatusUnauthorized, ErrCatAuth}
	ErrTokenInvalid       = &AppError{"AUTH_TOKEN_INVALID", "authentication token is invalid", http.StatusUnauthorized, ErrCatAuth}
	ErrTokenMissing       = &AppError{"AUTH_TOKEN_MISSING", "authentication token is required", http.StatusUnauthorized, ErrCatAuth}
	ErrAPIKeyInvalid      = &AppError{"AUTH_API_KEY_INVALID", "API key is invalid", http.StatusUnauthorized, ErrCatAuth}
	ErrAPIKeyExpired      = &AppError{"AUTH_API_KEY_EXPIRED", "API key has expired", http.StatusUnauthorized, ErrCatAuth}
	ErrAPIKeyRevoked      = &AppError{"AUTH_API_KEY_REVOKED", "API key has been revoked", http.StatusUnauthorized, ErrCatAuth}
	ErrInsufficientPerms  = &AppError{"AUTH_INSUFFICIENT_PERMISSIONS", "insufficient permissions for this action", http.StatusForbidden, ErrCatAuth}
)

// --- Vehicle ---

var (
	ErrVehicleNotFound = &AppError{"VEHICLE_NOT_FOUND", "vehicle not found", http.StatusNotFound, ErrCatVehicle}
	ErrVehicleOffline  = &AppError{"VEHICLE_OFFLINE", "vehicle is offline", http.StatusConflict, ErrCatVehicle}
	ErrVehicleAsleep   = &AppError{"VEHICLE_ASLEEP", "vehicle is asleep", http.StatusConflict, ErrCatVehicle}
	ErrVehicleBusy     = &AppError{"VEHICLE_BUSY", "vehicle is busy processing another request", http.StatusConflict, ErrCatVehicle}
)

// --- Drives / Charging / Trips ---

var (
	ErrDriveNotFound   = &AppError{"DRIVE_NOT_FOUND", "drive session not found", http.StatusNotFound, ErrCatVehicle}
	ErrChargeNotFound  = &AppError{"CHARGE_NOT_FOUND", "charging session not found", http.StatusNotFound, ErrCatVehicle}
	ErrTripNotFound    = &AppError{"TRIP_NOT_FOUND", "trip not found", http.StatusNotFound, ErrCatVehicle}
	ErrSessionActive   = &AppError{"SESSION_STILL_ACTIVE", "session is still active", http.StatusConflict, ErrCatVehicle}
	ErrSessionNotFound = &AppError{"SESSION_NOT_FOUND", "session not found", http.StatusNotFound, ErrCatVehicle}
)

// --- Tesla API ---

var (
	ErrTeslaAPIUnavailable   = &AppError{"TESLA_API_UNAVAILABLE", "Tesla API is unavailable", http.StatusBadGateway, ErrCatTeslaAPI}
	ErrTeslaAPISuspended     = &AppError{"TESLA_API_SUSPENDED", "Tesla API calls are suspended", http.StatusConflict, ErrCatTeslaAPI}
	ErrTeslaAPIRateLimit     = &AppError{"TESLA_API_RATE_LIMITED", "Tesla API rate limit exceeded", http.StatusTooManyRequests, ErrCatTeslaAPI}
	ErrTeslaAPITimeout       = &AppError{"TESLA_API_TIMEOUT", "Tesla API request timed out", http.StatusGatewayTimeout, ErrCatTeslaAPI}
	ErrTeslaAPIAuth          = &AppError{"TESLA_API_AUTH_FAILED", "Tesla API authentication failed", http.StatusUnauthorized, ErrCatTeslaAPI}
	ErrTeslaNotConnected     = &AppError{"TESLA_NOT_CONNECTED", "Tesla account not connected", http.StatusPreconditionFailed, ErrCatTeslaAPI}
	ErrTeslaEndpointDisabled = &AppError{"TESLA_ENDPOINT_DISABLED", "This Tesla API endpoint is disabled in polling config", http.StatusConflict, ErrCatTeslaAPI}
)

// --- Database ---

var (
	ErrDBConnection  = &AppError{"DB_CONNECTION_FAILED", "database connection failed", http.StatusServiceUnavailable, ErrCatDatabase}
	ErrDBQuery       = &AppError{"DB_QUERY_FAILED", "database query failed", http.StatusInternalServerError, ErrCatDatabase}
	ErrDBTransaction = &AppError{"DB_TRANSACTION_FAILED", "database transaction failed", http.StatusInternalServerError, ErrCatDatabase}
	ErrDBNotFound    = &AppError{"DB_RECORD_NOT_FOUND", "record not found", http.StatusNotFound, ErrCatDatabase}
	ErrDBDuplicate   = &AppError{"DB_DUPLICATE_RECORD", "record already exists", http.StatusConflict, ErrCatDatabase}
)

// --- Validation ---

var (
	ErrInvalidInput    = &AppError{"VALIDATION_INVALID_INPUT", "invalid input", http.StatusBadRequest, ErrCatValidation}
	ErrInvalidJSON     = &AppError{"VALIDATION_INVALID_JSON", "invalid JSON in request body", http.StatusBadRequest, ErrCatValidation}
	ErrMissingField    = &AppError{"VALIDATION_MISSING_FIELD", "required field is missing", http.StatusBadRequest, ErrCatValidation}
	ErrInvalidRange    = &AppError{"VALIDATION_INVALID_RANGE", "value is out of allowed range", http.StatusBadRequest, ErrCatValidation}
	ErrInvalidID       = &AppError{"VALIDATION_INVALID_ID", "invalid resource ID", http.StatusBadRequest, ErrCatValidation}
	ErrPayloadTooLarge = &AppError{"VALIDATION_PAYLOAD_TOO_LARGE", "request payload exceeds maximum size", http.StatusRequestEntityTooLarge, ErrCatValidation}
)

// --- Geofence ---

var (
	ErrGeofenceNotFound      = &AppError{"GEOFENCE_NOT_FOUND", "geofence not found", http.StatusNotFound, ErrCatGeofence}
	ErrGeofenceInvalidCoords = &AppError{"GEOFENCE_INVALID_COORDINATES", "invalid geofence coordinates", http.StatusBadRequest, ErrCatGeofence}
	ErrGeofenceInvalidRadius = &AppError{"GEOFENCE_INVALID_RADIUS", "geofence radius must be positive", http.StatusBadRequest, ErrCatGeofence}

	// Charging-place pricing (migration 000228_geofence_charging_place_pricing).
	ErrGeofenceRateNotFound  = &AppError{"GEOFENCE_RATE_NOT_FOUND", "geofence rate not found", http.StatusNotFound, ErrCatGeofence}
	ErrGeofenceRateConflict  = &AppError{"GEOFENCE_RATE_CONFLICT", "rate interval overlaps an existing rate for this geofence", http.StatusConflict, ErrCatGeofence}
	ErrGeofenceRateInvalid   = &AppError{"GEOFENCE_RATE_INVALID", "invalid geofence rate", http.StatusBadRequest, ErrCatGeofence}
	ErrGeofenceRateInUse     = &AppError{"GEOFENCE_RATE_IN_USE", "rate is already referenced by charging history", http.StatusConflict, ErrCatGeofence}
	ErrGeofenceRateImmutable = &AppError{"GEOFENCE_RATE_IMMUTABLE", "effective rates are immutable; add a new dated rate instead", http.StatusConflict, ErrCatGeofence}
	ErrGeofenceArchived      = &AppError{"GEOFENCE_ARCHIVED", "geofence is archived", http.StatusConflict, ErrCatGeofence}
	ErrGeofenceHasHistory    = &AppError{"GEOFENCE_HAS_HISTORY", "geofence has associated charging/drive history; archive instead of deleting", http.StatusConflict, ErrCatGeofence}
)

// --- Commands ---

var (
	ErrCommandNotSupported = &AppError{"COMMAND_NOT_SUPPORTED", "command not supported", http.StatusBadRequest, ErrCatCommand}
	ErrCommandFailed       = &AppError{"COMMAND_FAILED", "vehicle command failed", http.StatusBadGateway, ErrCatCommand}
	ErrCommandTimeout      = &AppError{"COMMAND_TIMEOUT", "vehicle command timed out", http.StatusGatewayTimeout, ErrCatCommand}
)

// --- Backup ---

var (
	ErrBackupConfigNotFound = &AppError{"BACKUP_CONFIG_NOT_FOUND", "backup configuration not found", http.StatusNotFound, ErrCatBackup}
	ErrBackupRunNotFound    = &AppError{"BACKUP_RUN_NOT_FOUND", "backup run not found", http.StatusNotFound, ErrCatBackup}
	ErrBackupFailed         = &AppError{"BACKUP_FAILED", "backup operation failed", http.StatusInternalServerError, ErrCatBackup}
	ErrBackupStorageError   = &AppError{"BACKUP_STORAGE_ERROR", "backup storage error", http.StatusInternalServerError, ErrCatBackup}
	ErrRestoreFailed        = &AppError{"RESTORE_FAILED", "restore operation failed", http.StatusInternalServerError, ErrCatBackup}
)

// --- Notifications ---

var (
	ErrChannelNotFound = &AppError{"NOTIFICATION_CHANNEL_NOT_FOUND", "notification channel not found", http.StatusNotFound, ErrCatNotify}
	ErrChannelTestFail = &AppError{"NOTIFICATION_TEST_FAILED", "notification test failed", http.StatusBadGateway, ErrCatNotify}
)

// --- Telemetry ---

var (
	ErrTelemetryIngestFail = &AppError{"TELEMETRY_INGEST_FAILED", "telemetry ingestion failed", http.StatusInternalServerError, ErrCatTelemetry}
	ErrMQTTUnavailable     = &AppError{"MQTT_UNAVAILABLE", "MQTT broker is unavailable", http.StatusServiceUnavailable, ErrCatTelemetry}
)

// --- Export ---

var (
	ErrExportFailed     = &AppError{"EXPORT_FAILED", "data export failed", http.StatusInternalServerError, ErrCatExport}
	ErrExportNotFound   = &AppError{"EXPORT_NOT_FOUND", "export job not found", http.StatusNotFound, ErrCatExport}
	ErrExportInvalidFmt = &AppError{"EXPORT_INVALID_FORMAT", "unsupported export format", http.StatusBadRequest, ErrCatExport}
)

// --- Rate Limiting ---

var (
	ErrRateLimited = &AppError{"RATE_LIMITED", "too many requests — please slow down", http.StatusTooManyRequests, ErrCatRateLimit}
)

// --- Internal ---

var (
	ErrInternal           = &AppError{"INTERNAL_ERROR", "internal server error", http.StatusInternalServerError, ErrCatInternal}
	ErrServiceUnavailable = &AppError{"SERVICE_UNAVAILABLE", "service temporarily unavailable", http.StatusServiceUnavailable, ErrCatInternal}
	ErrNotImplemented     = &AppError{"NOT_IMPLEMENTED", "feature not yet implemented", http.StatusNotImplemented, ErrCatInternal}
)

// ErrorCatalog returns the full list of defined application errors for documentation.
func ErrorCatalog() []*AppError {
	return []*AppError{
		ErrInvalidCredentials, ErrTokenExpired, ErrTokenInvalid, ErrTokenMissing,
		ErrAPIKeyInvalid, ErrAPIKeyExpired, ErrAPIKeyRevoked, ErrInsufficientPerms,
		ErrVehicleNotFound, ErrVehicleOffline, ErrVehicleAsleep, ErrVehicleBusy,
		ErrDriveNotFound, ErrChargeNotFound, ErrTripNotFound, ErrSessionActive, ErrSessionNotFound,
		ErrTeslaAPIUnavailable, ErrTeslaAPISuspended, ErrTeslaAPIRateLimit,
		ErrTeslaAPITimeout, ErrTeslaAPIAuth, ErrTeslaNotConnected, ErrTeslaEndpointDisabled,
		ErrDBConnection, ErrDBQuery, ErrDBTransaction, ErrDBNotFound, ErrDBDuplicate,
		ErrInvalidInput, ErrInvalidJSON, ErrMissingField, ErrInvalidRange,
		ErrInvalidID, ErrPayloadTooLarge,
		ErrGeofenceNotFound, ErrGeofenceInvalidCoords, ErrGeofenceInvalidRadius,
		ErrGeofenceRateNotFound, ErrGeofenceRateConflict, ErrGeofenceRateInvalid,
		ErrGeofenceRateInUse, ErrGeofenceRateImmutable, ErrGeofenceArchived, ErrGeofenceHasHistory,
		ErrCommandNotSupported, ErrCommandFailed, ErrCommandTimeout,
		ErrBackupConfigNotFound, ErrBackupRunNotFound, ErrBackupFailed,
		ErrBackupStorageError, ErrRestoreFailed,
		ErrChannelNotFound, ErrChannelTestFail,
		ErrTelemetryIngestFail, ErrMQTTUnavailable,
		ErrExportFailed, ErrExportNotFound, ErrExportInvalidFmt,
		ErrRateLimited,
		ErrInternal, ErrServiceUnavailable, ErrNotImplemented,
	}
}
