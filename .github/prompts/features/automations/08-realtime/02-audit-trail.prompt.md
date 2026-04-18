---
description: "Automation realtime: audit trail — log all automation CRUD and execution events"
---

# Realtime: Audit Trail

## Overview
Log all automation lifecycle events to the existing `system_audit` or a dedicated `automation_audit` table: created, updated, enabled, disabled, deleted, executed, failed, auto-disabled, re-enabled, imported, exported.

## Implementation
Create `internal/automation/audit.go`. After every automation CRUD operation or execution, insert an audit record:
```go
type AuditEntry struct {
    AutomationID   int64
    AutomationName string
    Action         string   // "created", "updated", "enabled", "disabled", "executed", "failed", "auto_disabled"
    Details        string   // JSON with relevant context
    CreatedAt      time.Time
}
```

Integrate with the existing system audit endpoint so it appears in the System > Audit page. Use zerolog for structured logging of all audit events.
