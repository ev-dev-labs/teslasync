package system

import "testing"

// Tests for data_repair_case.go model types and helpers.

func TestRepairCaseFingerprint_Format(t *testing.T) {
	t.Parallel()

	fp := RepairCaseFingerprint(RepairCaseKindDrive, 100, "drive_open_park_observed")

	// Must be 64 hex chars (SHA-256).
	if len(fp) != 64 {
		t.Fatalf("fingerprint length = %d, want 64", len(fp))
	}

	// All chars must be lowercase hex.
	for i, c := range fp {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			t.Fatalf("fingerprint[%d] = %c, not a lowercase hex char", i, c)
		}
	}
}

func TestRepairCaseFingerprint_Stability(t *testing.T) {
	t.Parallel()

	fp := RepairCaseFingerprint(RepairCaseKindDrive, 1, "test_rule")
	fp2 := RepairCaseFingerprint(RepairCaseKindDrive, 1, "test_rule")
	if fp != fp2 {
		t.Errorf("fingerprint not stable across calls: %q != %q", fp, fp2)
	}
}

func TestRepairCaseFingerprint_Uniqueness(t *testing.T) {
	t.Parallel()

	base := RepairCaseFingerprint(RepairCaseKindDrive, 1, "rule_a")
	diffKind := RepairCaseFingerprint(RepairCaseKindCharging, 1, "rule_a")
	diffID := RepairCaseFingerprint(RepairCaseKindDrive, 2, "rule_a")
	diffRule := RepairCaseFingerprint(RepairCaseKindDrive, 1, "rule_b")

	if base == diffKind {
		t.Error("different kind → same fingerprint")
	}
	if base == diffID {
		t.Error("different session_id → same fingerprint")
	}
	if base == diffRule {
		t.Error("different rule → same fingerprint")
	}

	relatedA := int64(7)
	relatedB := int64(8)
	pairA := RepairCaseFingerprintWithRelated(RepairCaseKindDrive, 1, "overlap", &relatedA)
	pairB := RepairCaseFingerprintWithRelated(RepairCaseKindDrive, 1, "overlap", &relatedB)
	if pairA == pairB || pairA == RepairCaseFingerprint(RepairCaseKindDrive, 1, "overlap") {
		t.Error("related session must participate in pair-anomaly fingerprints")
	}
}

func TestRepairCaseKind_ValidSet(t *testing.T) {
	t.Parallel()

	for _, k := range ValidRepairCaseKinds {
		if !k.IsValid() {
			t.Errorf("ValidRepairCaseKinds member %q fails IsValid()", k)
		}
	}
	if RepairCaseKind("bogus").IsValid() {
		t.Error("bogus kind should be invalid")
	}
	if RepairCaseKind("").IsValid() {
		t.Error("empty kind should be invalid")
	}
}

func TestRepairCaseStatus_ValidSet(t *testing.T) {
	t.Parallel()

	for _, s := range ValidRepairCaseStatuses {
		if !s.IsValid() {
			t.Errorf("ValidRepairCaseStatuses member %q fails IsValid()", s)
		}
	}
	if RepairCaseStatus("bogus").IsValid() {
		t.Error("bogus status should be invalid")
	}
}

func TestRepairCaseStatus_TerminalSet(t *testing.T) {
	t.Parallel()

	terminal := map[RepairCaseStatus]bool{
		RepairCaseStatusApplied:     true,
		RepairCaseStatusDismissed:   true,
		RepairCaseStatusRestored:    true,
		RepairCaseStatusQuarantined: true,
		RepairCaseStatusResolved:    true,
	}
	nonTerminal := map[RepairCaseStatus]bool{
		RepairCaseStatusOpen:     true,
		RepairCaseStatusInReview: true,
	}
	for s := range terminal {
		if !s.IsTerminal() {
			t.Errorf("%q should be terminal", s)
		}
	}
	for s := range nonTerminal {
		if s.IsTerminal() {
			t.Errorf("%q should NOT be terminal", s)
		}
	}
	// Verify counts match: 5 terminal + 2 non-terminal = 7 total.
	if len(terminal)+len(nonTerminal) != len(ValidRepairCaseStatuses) {
		t.Errorf("terminal(%d) + non-terminal(%d) != ValidRepairCaseStatuses(%d)",
			len(terminal), len(nonTerminal), len(ValidRepairCaseStatuses))
	}
}

func TestRepairCaseConfidence_ValidSet(t *testing.T) {
	t.Parallel()

	if !RepairCaseConfidenceHigh.IsValid() {
		t.Error("high should be valid")
	}
	if !RepairCaseConfidenceMedium.IsValid() {
		t.Error("medium should be valid")
	}
	if RepairCaseConfidence("low").IsValid() {
		t.Error("low should be invalid")
	}
	if RepairCaseConfidence("").IsValid() {
		t.Error("empty should be invalid")
	}
}

func TestRepairCaseListFilter_ClampLimit(t *testing.T) {
	t.Parallel()

	f := RepairCaseListFilter{Limit: 0}
	f.ClampLimit(50, 200)
	if f.Limit != 50 {
		t.Errorf("0 → %d, want 50", f.Limit)
	}

	f.Limit = 300
	f.ClampLimit(50, 200)
	if f.Limit != 200 {
		t.Errorf("300 → %d, want 200", f.Limit)
	}

	f.Limit = 100
	f.ClampLimit(50, 200)
	if f.Limit != 100 {
		t.Errorf("100 → %d, want 100", f.Limit)
	}
}

func TestRepairQuarantineListFilter_ClampLimit(t *testing.T) {
	t.Parallel()

	f := RepairQuarantineListFilter{Limit: -1}
	f.ClampLimit(25, 100)
	if f.Limit != 25 {
		t.Errorf("-1 → %d, want 25", f.Limit)
	}

	f.Limit = 999
	f.ClampLimit(25, 100)
	if f.Limit != 100 {
		t.Errorf("999 → %d, want 100", f.Limit)
	}
}

func TestRepairCaseStats_FieldCount(t *testing.T) {
	t.Parallel()

	// RepairCaseStats must have a total, counts for all 7 statuses + 2 kinds,
	// and 2 timestamps.
	s := RepairCaseStats{}
	_ = s.Total
	_ = s.OpenCount
	_ = s.InReviewCount
	_ = s.AppliedCount
	_ = s.DismissedCount
	_ = s.RestoredCount
	_ = s.QuarantinedCount
	_ = s.ResolvedCount
	_ = s.DriveCount
	_ = s.ChargingCount
	_ = s.OldestOpenAt
	_ = s.LastScanAt
}

func TestRepairScanEnums_ValidSet(t *testing.T) {
	t.Parallel()

	for _, trigger := range []RepairScanTrigger{
		RepairScanTriggerManual,
		RepairScanTriggerScheduled,
	} {
		if !trigger.IsValid() {
			t.Errorf("trigger %q should be valid", trigger)
		}
	}
	if RepairScanTrigger("unknown").IsValid() {
		t.Error("unknown trigger should be invalid")
	}

	for _, status := range []RepairScanStatus{
		RepairScanStatusRunning,
		RepairScanStatusCompleted,
		RepairScanStatusFailed,
		RepairScanStatusSkipped,
	} {
		if !status.IsValid() {
			t.Errorf("status %q should be valid", status)
		}
	}
	if RepairScanStatus("unknown").IsValid() {
		t.Error("unknown status should be invalid")
	}
}
