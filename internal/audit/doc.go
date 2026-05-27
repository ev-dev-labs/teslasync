// Layer: platform
//
// Package audit provides the hash-chained audit recorder used by
// Phase-45 to unify previously fragmented audit trails (system_audit,
// command_audit_log, manual session entries) into a single
// audit_logs table with tamper-evident SHA256 chaining.
package audit
