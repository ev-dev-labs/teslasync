package api

// Phase R2.0c (2026-05-28): TestPagination relocated to
// internal/api/apiparams/params_test.go (TestPagination_DefaultsAndBounds)
// alongside the canonical exported apiparams.Pagination helper.

// Phase R2d.67 (2026-05-28): TestAllowedCommandsWhitelist relocated to
// internal/api/command/handler_test.go alongside the command whitelist.

// Phase R2a (2026-05-28): TestAllowedBackupTables relocated to
// internal/api/backup/handler_test.go::TestAllowedTables_RequiredAndForbiddenEntries
// alongside the canonical apibackup.AllowedTables symbol.

// Phase R2.0a (2026-05-28): TestHTTPStatusCode,
// TestTeslaTokenExpired_PropagatesCode, and
// TestTeslaTokenExpiredCodeConstant were relocated to
// internal/api/httpx/json_test.go + tesla_test.go alongside the
// canonical exported helpers they exercise.
