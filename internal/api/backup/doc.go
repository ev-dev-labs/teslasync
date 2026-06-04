// Package backup contains HTTP handlers for backup and restore endpoints.
//
// Layer: handler
//
// It owns the carved Phase R2 backup API surface: admin export/stats under
// /api/v1/system/* and backup config/run/download/verify/preview-restore under
// /api/v1/backup/*. The platform backup engine lives in internal/backup and is
// imported as corebackup to avoid the package-name collision.
package backup
