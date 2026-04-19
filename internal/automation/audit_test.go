package automation

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
)

// mockAuditWriter captures calls to WriteAudit for assertion.
type mockAuditWriter struct {
	mu      sync.Mutex
	entries []capturedEntry
}

type capturedEntry struct {
	Action   string
	Resource string
	Details  string
	IP       string
}

func (m *mockAuditWriter) WriteAudit(_ context.Context, action, resource, details, ip string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.entries = append(m.entries, capturedEntry{
		Action:   action,
		Resource: resource,
		Details:  details,
		IP:       ip,
	})
}

func (m *mockAuditWriter) last() capturedEntry {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.entries[len(m.entries)-1]
}

func (m *mockAuditWriter) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.entries)
}

func TestAuditor_LogCreated(t *testing.T) {
	w := &mockAuditWriter{}
	a := NewAuditor(w)

	a.LogCreated(context.Background(), 42, "Night Lock", "cron", true, "10.0.0.1")

	if w.count() != 1 {
		t.Fatalf("expected 1 entry, got %d", w.count())
	}
	e := w.last()
	if e.Action != "automation.created" {
		t.Errorf("action = %q, want %q", e.Action, "automation.created")
	}
	if e.Resource != "automation" {
		t.Errorf("resource = %q, want %q", e.Resource, "automation")
	}
	if e.IP != "10.0.0.1" {
		t.Errorf("ip = %q, want %q", e.IP, "10.0.0.1")
	}

	var d auditCreatedDetails
	if err := json.Unmarshal([]byte(e.Details), &d); err != nil {
		t.Fatalf("unmarshal details: %v", err)
	}
	if d.AutomationID != 42 {
		t.Errorf("automation_id = %d, want 42", d.AutomationID)
	}
	if d.Name != "Night Lock" {
		t.Errorf("name = %q, want %q", d.Name, "Night Lock")
	}
	if d.TriggerType != "cron" {
		t.Errorf("trigger_type = %q, want %q", d.TriggerType, "cron")
	}
	if !d.Enabled {
		t.Error("enabled = false, want true")
	}
}

func TestAuditor_LogUpdated(t *testing.T) {
	w := &mockAuditWriter{}
	a := NewAuditor(w)

	a.LogUpdated(context.Background(), 7, "Charge Timer", "battery", "10.0.0.2")

	e := w.last()
	if e.Action != "automation.updated" {
		t.Errorf("action = %q, want %q", e.Action, "automation.updated")
	}

	var d auditUpdatedDetails
	if err := json.Unmarshal([]byte(e.Details), &d); err != nil {
		t.Fatalf("unmarshal details: %v", err)
	}
	if d.AutomationID != 7 {
		t.Errorf("automation_id = %d, want 7", d.AutomationID)
	}
	if d.TriggerType != "battery" {
		t.Errorf("trigger_type = %q, want %q", d.TriggerType, "battery")
	}
}

func TestAuditor_LogEnabled(t *testing.T) {
	w := &mockAuditWriter{}
	a := NewAuditor(w)

	a.LogEnabled(context.Background(), 1, "Test Auto", "10.0.0.3")

	e := w.last()
	if e.Action != "automation.enabled" {
		t.Errorf("action = %q, want %q", e.Action, "automation.enabled")
	}

	var d auditToggledDetails
	if err := json.Unmarshal([]byte(e.Details), &d); err != nil {
		t.Fatalf("unmarshal details: %v", err)
	}
	if !d.Enabled {
		t.Error("enabled = false, want true")
	}
}

func TestAuditor_LogDisabled(t *testing.T) {
	w := &mockAuditWriter{}
	a := NewAuditor(w)

	a.LogDisabled(context.Background(), 1, "Test Auto", "10.0.0.3")

	e := w.last()
	if e.Action != "automation.disabled" {
		t.Errorf("action = %q, want %q", e.Action, "automation.disabled")
	}

	var d auditToggledDetails
	if err := json.Unmarshal([]byte(e.Details), &d); err != nil {
		t.Fatalf("unmarshal details: %v", err)
	}
	if d.Enabled {
		t.Error("enabled = true, want false")
	}
}

func TestAuditor_LogDeleted(t *testing.T) {
	w := &mockAuditWriter{}
	a := NewAuditor(w)

	a.LogDeleted(context.Background(), 99, "Old Rule", "10.0.0.4")

	e := w.last()
	if e.Action != "automation.deleted" {
		t.Errorf("action = %q, want %q", e.Action, "automation.deleted")
	}
}

func TestAuditor_LogReEnabled(t *testing.T) {
	w := &mockAuditWriter{}
	a := NewAuditor(w)

	a.LogReEnabled(context.Background(), 5, "Re-Enabled Rule", "10.0.0.5")

	e := w.last()
	if e.Action != "automation.re_enabled" {
		t.Errorf("action = %q, want %q", e.Action, "automation.re_enabled")
	}
}

func TestAuditor_LogTestRun(t *testing.T) {
	w := &mockAuditWriter{}
	a := NewAuditor(w)

	a.LogTestRun(context.Background(), 10, "Test Dry", true, 3, "10.0.0.6")

	e := w.last()
	if e.Action != "automation.test_run" {
		t.Errorf("action = %q, want %q", e.Action, "automation.test_run")
	}

	var d auditTestRunDetails
	if err := json.Unmarshal([]byte(e.Details), &d); err != nil {
		t.Fatalf("unmarshal details: %v", err)
	}
	if !d.ConditionsMet {
		t.Error("conditions_met = false, want true")
	}
	if d.ActionsCount != 3 {
		t.Errorf("actions_count = %d, want 3", d.ActionsCount)
	}
}

func TestAuditor_LogUndo(t *testing.T) {
	w := &mockAuditWriter{}
	a := NewAuditor(w)

	a.LogUndo(context.Background(), 10, "Undo Rule", 100, 2, "success", "10.0.0.7")

	e := w.last()
	if e.Action != "automation.undo" {
		t.Errorf("action = %q, want %q", e.Action, "automation.undo")
	}

	var d auditUndoDetails
	if err := json.Unmarshal([]byte(e.Details), &d); err != nil {
		t.Fatalf("unmarshal details: %v", err)
	}
	if d.OriginalHistoryID != 100 {
		t.Errorf("original_history_id = %d, want 100", d.OriginalHistoryID)
	}
	if d.Reversed != 2 {
		t.Errorf("reversed = %d, want 2", d.Reversed)
	}
}

func TestAuditor_LogImported(t *testing.T) {
	w := &mockAuditWriter{}
	a := NewAuditor(w)

	a.LogImported(context.Background(), 3, []string{"A", "B", "C"}, "10.0.0.8")

	e := w.last()
	if e.Action != "automation.imported" {
		t.Errorf("action = %q, want %q", e.Action, "automation.imported")
	}

	var d auditImportedDetails
	if err := json.Unmarshal([]byte(e.Details), &d); err != nil {
		t.Fatalf("unmarshal details: %v", err)
	}
	if d.Count != 3 {
		t.Errorf("count = %d, want 3", d.Count)
	}
	if len(d.Names) != 3 {
		t.Errorf("names length = %d, want 3", len(d.Names))
	}
}

func TestAuditor_LogExported(t *testing.T) {
	w := &mockAuditWriter{}
	a := NewAuditor(w)

	a.LogExported(context.Background(), 2, []string{"X", "Y"}, "10.0.0.9")

	e := w.last()
	if e.Action != "automation.exported" {
		t.Errorf("action = %q, want %q", e.Action, "automation.exported")
	}

	var d auditExportedDetails
	if err := json.Unmarshal([]byte(e.Details), &d); err != nil {
		t.Fatalf("unmarshal details: %v", err)
	}
	if d.Count != 2 {
		t.Errorf("count = %d, want 2", d.Count)
	}
}

func TestAuditor_LogExecuted_Success(t *testing.T) {
	w := &mockAuditWriter{}
	a := NewAuditor(w)

	a.LogExecuted(context.Background(), 15, "Lock Car", "cron", true, 120)

	e := w.last()
	if e.Action != "automation.executed" {
		t.Errorf("action = %q, want %q", e.Action, "automation.executed")
	}
	if e.IP != "" {
		t.Errorf("ip = %q, want empty (system event)", e.IP)
	}
}

func TestAuditor_LogExecuted_Failure(t *testing.T) {
	w := &mockAuditWriter{}
	a := NewAuditor(w)

	a.LogExecuted(context.Background(), 15, "Lock Car", "cron", false, 50)

	e := w.last()
	if e.Action != "automation.failed" {
		t.Errorf("action = %q, want %q", e.Action, "automation.failed")
	}
}

func TestAuditor_LogAutoDisabled(t *testing.T) {
	w := &mockAuditWriter{}
	a := NewAuditor(w)

	a.LogAutoDisabled(context.Background(), 20, "Bad Rule", "5 consecutive failures")

	e := w.last()
	if e.Action != "automation.auto_disabled" {
		t.Errorf("action = %q, want %q", e.Action, "automation.auto_disabled")
	}
	if e.IP != "" {
		t.Errorf("ip = %q, want empty (system event)", e.IP)
	}

	var d auditAutoDisabledDetails
	if err := json.Unmarshal([]byte(e.Details), &d); err != nil {
		t.Fatalf("unmarshal details: %v", err)
	}
	if d.Reason != "5 consecutive failures" {
		t.Errorf("reason = %q, want %q", d.Reason, "5 consecutive failures")
	}
}

func TestAuditor_NilWriter_NoPanic(t *testing.T) {
	a := NewAuditor(nil)

	// All methods should work without panicking when writer is nil.
	ctx := context.Background()
	a.LogCreated(ctx, 1, "x", "cron", true, "")
	a.LogUpdated(ctx, 1, "x", "cron", "")
	a.LogEnabled(ctx, 1, "x", "")
	a.LogDisabled(ctx, 1, "x", "")
	a.LogDeleted(ctx, 1, "x", "")
	a.LogReEnabled(ctx, 1, "x", "")
	a.LogTestRun(ctx, 1, "x", true, 0, "")
	a.LogUndo(ctx, 1, "x", 0, 0, "success", "")
	a.LogImported(ctx, 0, nil, "")
	a.LogExported(ctx, 0, nil, "")
	a.LogExecuted(ctx, 1, "x", "cron", true, 0)
	a.LogAutoDisabled(ctx, 1, "x", "reason")
}

func TestAuditor_ResourceIsAlwaysAutomation(t *testing.T) {
	w := &mockAuditWriter{}
	a := NewAuditor(w)

	ctx := context.Background()
	a.LogCreated(ctx, 1, "x", "cron", true, "")
	a.LogDeleted(ctx, 2, "y", "")
	a.LogAutoDisabled(ctx, 3, "z", "reason")

	for i, e := range w.entries {
		if e.Resource != "automation" {
			t.Errorf("entry[%d] resource = %q, want %q", i, e.Resource, "automation")
		}
	}
}
