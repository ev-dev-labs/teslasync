package system

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"time"
)

// =============================================================================
// Data-repair case-management models.
//
// These types model the durable lifecycle tables introduced by migration
// 000231_data_repair_cases. They complement the read-only diagnosis DTOs in
// data_repair.go by providing persistence-focused structs with full db/json
// tags and typed constants for status/kind.
//
// Layer: domain (DTO leaf — no inbound imports from adapter/handler/app layers).
// =============================================================================

// ---------------------------------------------------------------------------
// Typed constants
// ---------------------------------------------------------------------------

// RepairCaseKind identifies which session table a case targets.
type RepairCaseKind string

const (
	RepairCaseKindDrive    RepairCaseKind = "drive"
	RepairCaseKindCharging RepairCaseKind = "charging"
)

// ValidRepairCaseKinds is the exhaustive set for validation.
var ValidRepairCaseKinds = []RepairCaseKind{
	RepairCaseKindDrive,
	RepairCaseKindCharging,
}

// IsValid returns true if k is a recognized kind.
func (k RepairCaseKind) IsValid() bool {
	for _, v := range ValidRepairCaseKinds {
		if k == v {
			return true
		}
	}
	return false
}

// RepairCaseStatus is the case lifecycle state.
type RepairCaseStatus string

const (
	RepairCaseStatusOpen        RepairCaseStatus = "open"
	RepairCaseStatusInReview    RepairCaseStatus = "in_review"
	RepairCaseStatusApplied     RepairCaseStatus = "applied"
	RepairCaseStatusDismissed   RepairCaseStatus = "dismissed"
	RepairCaseStatusRestored    RepairCaseStatus = "restored"
	RepairCaseStatusQuarantined RepairCaseStatus = "quarantined"
	RepairCaseStatusResolved    RepairCaseStatus = "resolved"
)

// ValidRepairCaseStatuses is the exhaustive set for validation.
var ValidRepairCaseStatuses = []RepairCaseStatus{
	RepairCaseStatusOpen,
	RepairCaseStatusInReview,
	RepairCaseStatusApplied,
	RepairCaseStatusDismissed,
	RepairCaseStatusRestored,
	RepairCaseStatusQuarantined,
	RepairCaseStatusResolved,
}

// IsValid returns true if s is a recognized status.
func (s RepairCaseStatus) IsValid() bool {
	for _, v := range ValidRepairCaseStatuses {
		if s == v {
			return true
		}
	}
	return false
}

// IsTerminal returns true if the status represents a resolved/final state.
func (s RepairCaseStatus) IsTerminal() bool {
	switch s {
	case RepairCaseStatusApplied,
		RepairCaseStatusDismissed,
		RepairCaseStatusRestored,
		RepairCaseStatusQuarantined,
		RepairCaseStatusResolved:
		return true
	}
	return false
}

// RepairCaseConfidence grades evidence directness.
type RepairCaseConfidence string

const (
	RepairCaseConfidenceHigh   RepairCaseConfidence = "high"
	RepairCaseConfidenceMedium RepairCaseConfidence = "medium"
)

// IsValid returns true if c is a recognized confidence level.
func (c RepairCaseConfidence) IsValid() bool {
	return c == RepairCaseConfidenceHigh || c == RepairCaseConfidenceMedium
}

// ---------------------------------------------------------------------------
// RepairCase
// ---------------------------------------------------------------------------

// RepairCase models a row in data_repair_cases. It tracks a single diagnosed
// session boundary anomaly through its lifecycle.
type RepairCase struct {
	ID               int64                `db:"id"          json:"id"`
	Fingerprint      string               `db:"fingerprint" json:"fingerprint"`
	Kind             RepairCaseKind       `db:"kind"        json:"kind"`
	SessionID        int64                `db:"session_id"  json:"session_id"`
	RelatedSessionID *int64               `db:"related_session_id" json:"related_session_id"`
	VehicleID        int64                `db:"vehicle_id"  json:"vehicle_id"`
	Rule             string               `db:"rule"        json:"rule"`
	Confidence       RepairCaseConfidence `db:"confidence"  json:"confidence"`
	Status           RepairCaseStatus     `db:"status"      json:"status"`

	SuggestedEndedAt *time.Time `db:"suggested_ended_at" json:"suggested_ended_at"`

	// Evidence snapshot preserved at discovery.
	EvidenceStartedAt          time.Time  `db:"evidence_started_at"              json:"evidence_started_at"`
	EvidenceStoredEndedAt      *time.Time `db:"evidence_stored_ended_at"         json:"evidence_stored_ended_at"`
	EvidenceContradictionTs    time.Time  `db:"evidence_contradiction_ts"        json:"evidence_contradiction_ts"`
	EvidenceContradictionSrc   string     `db:"evidence_contradiction_src"       json:"evidence_contradiction_src"`
	EvidenceContradictionField string     `db:"evidence_contradiction_field"     json:"evidence_contradiction_field"`
	EvidenceContradictionValue string     `db:"evidence_contradiction_value"     json:"evidence_contradiction_value"`
	EvidenceLastInSessionTs    *time.Time `db:"evidence_last_in_session_ts"      json:"evidence_last_in_session_ts"`
	EvidenceLastInSessionSrc   *string    `db:"evidence_last_in_session_src"     json:"evidence_last_in_session_src"`
	EvidenceLastInSessionField *string    `db:"evidence_last_in_session_field"   json:"evidence_last_in_session_field"`
	EvidenceLastInSessionValue *string    `db:"evidence_last_in_session_value"   json:"evidence_last_in_session_value"`
	EvidenceGapS               int64      `db:"evidence_gap_s"                   json:"evidence_gap_s"`

	AssignedTo     *string `db:"assigned_to"     json:"assigned_to"`
	ResolutionNote *string `db:"resolution_note" json:"resolution_note"`

	Applicable    bool    `db:"applicable"      json:"applicable"`
	BlockedReason *string `db:"blocked_reason"  json:"blocked_reason"`

	FirstSeenAt   time.Time  `db:"first_seen_at"    json:"first_seen_at"`
	LastSeenAt    time.Time  `db:"last_seen_at"     json:"last_seen_at"`
	AppliedAt     *time.Time `db:"applied_at"       json:"applied_at"`
	DismissedAt   *time.Time `db:"dismissed_at"     json:"dismissed_at"`
	RestoredAt    *time.Time `db:"restored_at"      json:"restored_at"`
	QuarantinedAt *time.Time `db:"quarantined_at"   json:"quarantined_at"`
	ResolvedAt    *time.Time `db:"resolved_at"      json:"resolved_at"`
	CreatedAt     time.Time  `db:"created_at"       json:"created_at"`
	UpdatedAt     time.Time  `db:"updated_at"       json:"updated_at"`
}

// ---------------------------------------------------------------------------
// RepairCaseComment
// ---------------------------------------------------------------------------

// RepairCaseComment models a row in data_repair_case_comments.
type RepairCaseComment struct {
	ID        int64     `db:"id"         json:"id"`
	CaseID    int64     `db:"case_id"    json:"case_id"`
	Actor     string    `db:"actor"      json:"actor"`
	Body      string    `db:"body"       json:"body"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}

// ---------------------------------------------------------------------------
// RepairQuarantine
// ---------------------------------------------------------------------------

// RepairQuarantine models a row in data_repair_quarantine.
type RepairQuarantine struct {
	ID            int64           `db:"id"             json:"id"`
	CaseID        int64           `db:"case_id"        json:"case_id"`
	Kind          RepairCaseKind  `db:"kind"           json:"kind"`
	SessionID     int64           `db:"session_id"     json:"session_id"`
	VehicleID     int64           `db:"vehicle_id"     json:"vehicle_id"`
	OriginalRow   json.RawMessage `db:"original_row"   json:"-"`
	SchemaVersion int             `db:"schema_version" json:"schema_version"`
	Checksum      string          `db:"checksum"       json:"checksum"`
	Reason        string          `db:"reason"         json:"reason"`
	QuarantinedBy string          `db:"quarantined_by" json:"quarantined_by"`
	QuarantinedAt time.Time       `db:"quarantined_at" json:"quarantined_at"`
	RestoredBy    *string         `db:"restored_by"    json:"restored_by"`
	RestoredAt    *time.Time      `db:"restored_at"    json:"restored_at"`
}

// IsRestored returns true if this quarantine record has been undone.
func (q *RepairQuarantine) IsRestored() bool {
	return q.RestoredAt != nil
}

// ---------------------------------------------------------------------------
// RepairCaseFingerprint — deterministic dedupe key
// ---------------------------------------------------------------------------

// RepairCaseFingerprint computes the deterministic dedupe fingerprint for a
// single-session case. It delegates to RepairCaseFingerprintWithRelated with
// no related session.
func RepairCaseFingerprint(kind RepairCaseKind, sessionID int64, rule string) string {
	return RepairCaseFingerprintWithRelated(kind, sessionID, rule, nil)
}

// RepairCaseFingerprintWithRelated keeps pair anomalies distinct when one
// primary session overlaps multiple related sessions.
func RepairCaseFingerprintWithRelated(
	kind RepairCaseKind,
	sessionID int64,
	rule string,
	relatedSessionID *int64,
) string {
	related := int64(0)
	if relatedSessionID != nil {
		related = *relatedSessionID
	}
	input := fmt.Sprintf("%s:%d:%s:%d", kind, sessionID, rule, related)
	hash := sha256.Sum256([]byte(input))
	return fmt.Sprintf("%x", hash[:])
}

// ---------------------------------------------------------------------------
// RepairCaseListFilter — query parameters for listing cases
// ---------------------------------------------------------------------------

// RepairCaseListFilter holds optional filters for the case list query.
type RepairCaseListFilter struct {
	VehicleID  *int64                `json:"-"`
	Status     *RepairCaseStatus     `json:"-"`
	Kind       *RepairCaseKind       `json:"-"`
	Confidence *RepairCaseConfidence `json:"-"`
	AssignedTo *string               `json:"-"`
	// Cursor-based (keyset) pagination: pass the last_seen_at and id of the
	// last row from the previous page.
	CursorLastSeenAt *time.Time `json:"-"`
	CursorID         *int64     `json:"-"`
	Limit            int        `json:"-"`
}

// ClampLimit normalises the limit to [1, maxLimit], defaulting to defaultLimit.
func (f *RepairCaseListFilter) ClampLimit(defaultLimit, maxLimit int) {
	if f.Limit <= 0 {
		f.Limit = defaultLimit
	}
	if f.Limit > maxLimit {
		f.Limit = maxLimit
	}
}

// ---------------------------------------------------------------------------
// RepairQuarantineListFilter — query parameters for quarantine list
// ---------------------------------------------------------------------------

// RepairQuarantineListFilter holds optional filters for the quarantine list.
type RepairQuarantineListFilter struct {
	Kind      *RepairCaseKind `json:"-"`
	VehicleID *int64          `json:"-"`
	// Restored: nil = all, ptr to true = only restored, ptr to false = only active.
	Restored *bool `json:"-"`
	// Cursor-based (keyset) pagination: pass the quarantined_at and id of the
	// last row from the previous page.
	CursorQuarantinedAt *time.Time `json:"-"`
	CursorID            *int64     `json:"-"`
	Limit               int        `json:"-"`
}

// ClampLimit normalises the limit to [1, maxLimit], defaulting to defaultLimit.
func (f *RepairQuarantineListFilter) ClampLimit(defaultLimit, maxLimit int) {
	if f.Limit <= 0 {
		f.Limit = defaultLimit
	}
	if f.Limit > maxLimit {
		f.Limit = maxLimit
	}
}

// ---------------------------------------------------------------------------
// RepairCaseStats — aggregate dashboard counts
// ---------------------------------------------------------------------------

// RepairCaseStats is a summary of case counts by status and kind. It powers
// dashboard badges and overview panels without requiring the UI to scan the
// full case list.
type RepairCaseStats struct {
	Total int `json:"total"`

	// Counts by status.
	OpenCount        int `json:"open"`
	InReviewCount    int `json:"in_review"`
	AppliedCount     int `json:"applied"`
	DismissedCount   int `json:"dismissed"`
	RestoredCount    int `json:"restored"`
	QuarantinedCount int `json:"quarantined"`
	ResolvedCount    int `json:"resolved"`

	// Counts by kind (across all statuses).
	DriveCount    int `json:"drive"`
	ChargingCount int `json:"charging"`

	// OldestOpenAt is the first_seen_at of the oldest open case, or nil if
	// no open cases exist.
	OldestOpenAt *time.Time `json:"oldest_open_at"`
	// LastScanAt is the completion time of the most recent successful scan,
	// including scans that found no anomalies.
	LastScanAt *time.Time `json:"last_scan_at"`
}

// RepairScanTrigger identifies who initiated a bounded integrity scan.
type RepairScanTrigger string

const (
	RepairScanTriggerManual    RepairScanTrigger = "manual"
	RepairScanTriggerScheduled RepairScanTrigger = "scheduled"
)

// RepairScanStatus is the durable outcome of one integrity scan.
type RepairScanStatus string

const (
	RepairScanStatusRunning   RepairScanStatus = "running"
	RepairScanStatusCompleted RepairScanStatus = "completed"
	RepairScanStatusFailed    RepairScanStatus = "failed"
	RepairScanStatusSkipped   RepairScanStatus = "skipped"
)

// RepairScanRun records a scan even when it discovers no cases.
type RepairScanRun struct {
	ID            int64             `db:"id"             json:"id"`
	Trigger       RepairScanTrigger `db:"trigger"        json:"trigger"`
	Status        RepairScanStatus  `db:"status"         json:"status"`
	VehicleID     *int64            `db:"vehicle_id"     json:"vehicle_id"`
	InitiatedBy   string            `db:"initiated_by"   json:"initiated_by"`
	Discovered    int               `db:"discovered"     json:"discovered"`
	Refreshed     int               `db:"refreshed"      json:"refreshed"`
	Truncated     bool              `db:"truncated"      json:"truncated"`
	FailureReason *string           `db:"failure_reason" json:"failure_reason"`
	StartedAt     time.Time         `db:"started_at"     json:"started_at"`
	CompletedAt   *time.Time        `db:"completed_at"   json:"completed_at"`
}

// IsValid reports whether t is a supported scan trigger.
func (t RepairScanTrigger) IsValid() bool {
	return t == RepairScanTriggerManual || t == RepairScanTriggerScheduled
}

// IsValid reports whether s is a supported scan lifecycle value.
func (s RepairScanStatus) IsValid() bool {
	switch s {
	case RepairScanStatusRunning,
		RepairScanStatusCompleted,
		RepairScanStatusFailed,
		RepairScanStatusSkipped:
		return true
	}
	return false
}
