// Layer: app
//
// Package auditviewersvc is the application service for Phase-45's
// admin audit-log viewer. It wraps internal/database.AuditLogQueryRepo
// + internal/audit.Recorder.VerifyChain and is consumed by
// internal/handler/v1/admin_audit_handler.go.
package auditviewersvc
