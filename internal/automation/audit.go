// Package automation provides core automation types and cross-cutting concerns.
package automation

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// AuditEntry represents a single automation lifecycle event recorded in
// the audit trail. It maps directly to the audit_logs table columns.
type AuditEntry struct {
	AutomationID   int64     `json:"automation_id"`
	AutomationName string    `json:"automation_name"`
	Action         string    `json:"action"`
	Details        string    `json:"details"`
	CreatedAt      time.Time `json:"created_at"`
}

// AuditWriter persists audit entries. Implementations must be safe for
// concurrent use and should not block on failures — logging is best-effort.
type AuditWriter interface {
	WriteAudit(ctx context.Context, action, resource, details, ip string)
}

// ── Typed detail payloads (whitelisted fields only — no secrets) ────────

type auditCreatedDetails struct {
	AutomationID int64  `json:"automation_id"`
	Name         string `json:"name"`
	TriggerType  string `json:"trigger_type"`
	Enabled      bool   `json:"enabled"`
}

type auditUpdatedDetails struct {
	AutomationID int64  `json:"automation_id"`
	Name         string `json:"name"`
	TriggerType  string `json:"trigger_type"`
}

type auditToggledDetails struct {
	AutomationID int64  `json:"automation_id"`
	Name         string `json:"name"`
	Enabled      bool   `json:"enabled"`
}

type auditDeletedDetails struct {
	AutomationID int64  `json:"automation_id"`
	Name         string `json:"name"`
}

type auditReEnabledDetails struct {
	AutomationID int64  `json:"automation_id"`
	Name         string `json:"name"`
}

type auditTestRunDetails struct {
	AutomationID  int64  `json:"automation_id"`
	Name          string `json:"name"`
	ConditionsMet bool   `json:"conditions_met"`
	ActionsCount  int    `json:"actions_count"`
}

type auditUndoDetails struct {
	AutomationID      int64  `json:"automation_id"`
	Name              string `json:"name"`
	OriginalHistoryID int64  `json:"original_history_id"`
	Reversed          int    `json:"reversed"`
	Status            string `json:"status"`
}

type auditImportedDetails struct {
	Count int      `json:"count"`
	Names []string `json:"names"`
}

type auditExportedDetails struct {
	Count int      `json:"count"`
	Names []string `json:"names"`
}

type auditExecutedDetails struct {
	AutomationID int64  `json:"automation_id"`
	Name         string `json:"name"`
	Success      bool   `json:"success"`
	TriggerType  string `json:"trigger_type"`
	DurationMs   int64  `json:"duration_ms,omitempty"`
}

type auditAutoDisabledDetails struct {
	AutomationID int64  `json:"automation_id"`
	Name         string `json:"name"`
	Reason       string `json:"reason"`
}

// ── Auditor ────────────────────────────────────────────────────────────

// Auditor records automation lifecycle events to the audit_logs table
// and emits structured log entries. It is safe for concurrent use.
//
// All methods are fire-and-forget: failures are logged but never returned
// to the caller, so auditing cannot break the primary operation.
type Auditor struct {
	writer AuditWriter
	logger zerolog.Logger
}

// NewAuditor creates an Auditor backed by the given writer.
// Pass nil to get a no-op auditor that only logs to zerolog.
func NewAuditor(w AuditWriter) *Auditor {
	return &Auditor{
		writer: w,
		logger: log.With().Str("component", "automation_audit").Logger(),
	}
}

const auditResource = "automation"

// LogCreated records that an automation was created.
func (a *Auditor) LogCreated(ctx context.Context, automationID int64, name, triggerType string, enabled bool, ip string) {
	details := mustJSON(auditCreatedDetails{
		AutomationID: automationID,
		Name:         name,
		TriggerType:  triggerType,
		Enabled:      enabled,
	})
	a.write(ctx, "automation.created", details, ip)
	a.logger.Info().
		Int64("automation_id", automationID).
		Str("name", name).
		Str("trigger_type", triggerType).
		Bool("enabled", enabled).
		Msg("audit: automation created")
}

// LogUpdated records that an automation configuration was updated.
func (a *Auditor) LogUpdated(ctx context.Context, automationID int64, name, triggerType, ip string) {
	details := mustJSON(auditUpdatedDetails{
		AutomationID: automationID,
		Name:         name,
		TriggerType:  triggerType,
	})
	a.write(ctx, "automation.updated", details, ip)
	a.logger.Info().
		Int64("automation_id", automationID).
		Str("name", name).
		Msg("audit: automation updated")
}

// LogEnabled records that an automation was enabled via toggle.
func (a *Auditor) LogEnabled(ctx context.Context, automationID int64, name, ip string) {
	details := mustJSON(auditToggledDetails{
		AutomationID: automationID,
		Name:         name,
		Enabled:      true,
	})
	a.write(ctx, "automation.enabled", details, ip)
	a.logger.Info().
		Int64("automation_id", automationID).
		Str("name", name).
		Msg("audit: automation enabled")
}

// LogDisabled records that an automation was disabled via toggle.
func (a *Auditor) LogDisabled(ctx context.Context, automationID int64, name, ip string) {
	details := mustJSON(auditToggledDetails{
		AutomationID: automationID,
		Name:         name,
		Enabled:      false,
	})
	a.write(ctx, "automation.disabled", details, ip)
	a.logger.Info().
		Int64("automation_id", automationID).
		Str("name", name).
		Msg("audit: automation disabled")
}

// LogDeleted records that an automation was deleted.
func (a *Auditor) LogDeleted(ctx context.Context, automationID int64, name, ip string) {
	details := mustJSON(auditDeletedDetails{
		AutomationID: automationID,
		Name:         name,
	})
	a.write(ctx, "automation.deleted", details, ip)
	a.logger.Info().
		Int64("automation_id", automationID).
		Str("name", name).
		Msg("audit: automation deleted")
}

// LogReEnabled records that an auto-disabled automation was manually re-enabled.
func (a *Auditor) LogReEnabled(ctx context.Context, automationID int64, name, ip string) {
	details := mustJSON(auditReEnabledDetails{
		AutomationID: automationID,
		Name:         name,
	})
	a.write(ctx, "automation.re_enabled", details, ip)
	a.logger.Info().
		Int64("automation_id", automationID).
		Str("name", name).
		Msg("audit: automation re-enabled")
}

// LogTestRun records that a dry-run test was performed on an automation.
func (a *Auditor) LogTestRun(ctx context.Context, automationID int64, name string, conditionsMet bool, actionsCount int, ip string) {
	details := mustJSON(auditTestRunDetails{
		AutomationID:  automationID,
		Name:          name,
		ConditionsMet: conditionsMet,
		ActionsCount:  actionsCount,
	})
	a.write(ctx, "automation.test_run", details, ip)
	a.logger.Info().
		Int64("automation_id", automationID).
		Str("name", name).
		Bool("conditions_met", conditionsMet).
		Int("actions_count", actionsCount).
		Msg("audit: automation test-run")
}

// LogUndo records that an automation execution was reversed.
func (a *Auditor) LogUndo(ctx context.Context, automationID int64, name string, originalHistoryID int64, reversed int, status, ip string) {
	details := mustJSON(auditUndoDetails{
		AutomationID:      automationID,
		Name:              name,
		OriginalHistoryID: originalHistoryID,
		Reversed:          reversed,
		Status:            status,
	})
	a.write(ctx, "automation.undo", details, ip)
	a.logger.Info().
		Int64("automation_id", automationID).
		Str("name", name).
		Int64("original_history_id", originalHistoryID).
		Str("status", status).
		Msg("audit: automation undo")
}

// LogImported records a batch import summary.
func (a *Auditor) LogImported(ctx context.Context, count int, names []string, ip string) {
	details := mustJSON(auditImportedDetails{
		Count: count,
		Names: names,
	})
	a.write(ctx, "automation.imported", details, ip)
	a.logger.Info().
		Int("count", count).
		Msg("audit: automations imported")
}

// LogExported records a batch export summary.
func (a *Auditor) LogExported(ctx context.Context, count int, names []string, ip string) {
	details := mustJSON(auditExportedDetails{
		Count: count,
		Names: names,
	})
	a.write(ctx, "automation.exported", details, ip)
	a.logger.Info().
		Int("count", count).
		Msg("audit: automations exported")
}

// LogExecuted records that an automation completed execution.
// Use from the execution pipeline for live runs.
func (a *Auditor) LogExecuted(ctx context.Context, automationID int64, name, triggerType string, success bool, durationMs int64) {
	details := mustJSON(auditExecutedDetails{
		AutomationID: automationID,
		Name:         name,
		Success:      success,
		TriggerType:  triggerType,
		DurationMs:   durationMs,
	})
	action := "automation.executed"
	if !success {
		action = "automation.failed"
	}
	a.write(ctx, action, details, "")
	a.logger.Info().
		Int64("automation_id", automationID).
		Str("name", name).
		Bool("success", success).
		Str("trigger_type", triggerType).
		Int64("duration_ms", durationMs).
		Msg(fmt.Sprintf("audit: automation %s", action))
}

// LogAutoDisabled records that an automation was automatically disabled.
// Use from the safety/trigger pipeline — no IP for system-initiated events.
func (a *Auditor) LogAutoDisabled(ctx context.Context, automationID int64, name, reason string) {
	details := mustJSON(auditAutoDisabledDetails{
		AutomationID: automationID,
		Name:         name,
		Reason:       reason,
	})
	a.write(ctx, "automation.auto_disabled", details, "")
	a.logger.Warn().
		Int64("automation_id", automationID).
		Str("name", name).
		Str("reason", reason).
		Msg("audit: automation auto-disabled")
}

// ── Internal helpers ───────────────────────────────────────────────────

func (a *Auditor) write(ctx context.Context, action, details, ip string) {
	if a.writer != nil {
		a.writer.WriteAudit(ctx, action, auditResource, details, ip)
	}
}

func mustJSON(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf(`{"error":"marshal failed: %s"}`, err.Error())
	}
	return string(b)
}
