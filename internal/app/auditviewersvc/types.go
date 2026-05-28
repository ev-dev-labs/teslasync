package auditviewersvc

import auditdb "github.com/ev-dev-labs/teslasync/internal/database/audit"

// Phase-45 / Phase-47/10 — handler-facing type aliases.
//
// Re-exports keep internal/handler/v1 from importing internal/database
// directly (TestHandlerV1Thinness). Aliases are transparent so service
// internals can continue to use database.* identifiers unchanged.

// Query is the request filter the handler builds from query-string
// parameters and passes to Service.Query.
type Query = auditdb.AuditLogQuery

// Row is the audit row shape returned by Query.
type Row = auditdb.AuditLogRow
