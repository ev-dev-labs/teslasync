package datarepair

import "time"

// ---------------------------------------------------------------------------
// Anomaly DTOs
// ---------------------------------------------------------------------------
//
// This file defines the typed, read-only output of Repo.ListSessionAnomalies
// (anomaly_scan.go): a bounded set of conservatively-detected session
// integrity problems in `drives` / `charging_sessions`.
//
// These are detector-output records, NOT the durable case-management models
// in internal/models/system (RepairCase, RepairCaseKind, RepairCaseConfidence,
// migration 000231_data_repair_cases) or their repository
// (internal/database/datarepair/case_repo.go). Those are owned separately and
// intentionally not imported here, so this detector has zero coupling to the
// case lifecycle: a future scanner reads an []Anomaly from this package and
// is the one place responsible for turning it into a data_repair_cases row
// (typically via systemmodel.RepairCaseFingerprint(kind, session_id, rule),
// which is exactly the (Kind, SessionID, Rule) triple every Anomaly carries).
//
// Nothing here computes or suggests a repair boundary. Applicable is always
// false: the existing evidence-based diagnosis in repo.go (ListOpenDrives /
// ListOverrunDrives / ListOpenChargingSessions / ListOverrunChargingSessions)
// remains the only source of a suggested_ended_at value. This detector only
// flags that a session's own stored data is internally inconsistent (or
// inconsistent with a sibling session), which is a materially different,
// narrower question than "when did this session actually end".

// AnomalyKind identifies which session table an anomaly's primary SessionID
// belongs to. Deliberately independent of systemmodel.RepairCaseKind (same
// two string values, "drive"/"charging", by convention only) so a later
// scanner can convert with a trivial string cast instead of this package
// importing the case-management models.
type AnomalyKind string

const (
	AnomalyKindDrive    AnomalyKind = "drive"
	AnomalyKindCharging AnomalyKind = "charging"
)

// AnomalySeverity grades how materially wrong the underlying data is if the
// anomaly is real (independent of how sure the detector is — see
// AnomalyConfidence). High severity anomalies corrupt aggregates that
// downstream analytics/exports trust (negative energy, odometer rollback,
// duplicate ingestion); medium severity anomalies are inconsistencies that
// are surprising but less likely to cascade (a same-kind overlap of a few
// seconds, a SoC drift just past tolerance).
type AnomalySeverity string

const (
	AnomalySeverityHigh   AnomalySeverity = "high"
	AnomalySeverityMedium AnomalySeverity = "medium"
)

// AnomalyConfidence grades how directly the stored data itself proves the
// anomaly, as opposed to how severe it is. Structural contradictions are
// high confidence. Directional SoC checks are medium confidence because
// regeneration, conditioning, and measurement recalibration can occasionally
// produce the same stored relationship. Intentionally mirrors the two-value
// domain of systemmodel.RepairCaseConfidence ("high"/"medium") for a trivial
// mapping, without importing it.
type AnomalyConfidence string

const (
	AnomalyConfidenceHigh   AnomalyConfidence = "high"
	AnomalyConfidenceMedium AnomalyConfidence = "medium"
)

// Rule tokens. Stable, lower_snake_case strings — part of the fingerprint
// input contract (see doc comment above) and never renamed once shipped,
// since renaming would let a previously-seen anomaly re-surface as a "new"
// case after an upgrade.
const (
	// RuleEndedBeforeStarted: a closed session's ended_at is at or before its
	// started_at. Physically impossible for a non-instantaneous session.
	RuleEndedBeforeStarted = "ended_before_started"

	// RuleDurationMismatch: drives.duration_s disagrees with
	// (ended_at - started_at) by more than durationMismatchToleranceS.
	// Charging sessions have no stored duration column (it is always
	// derived at read time), so this rule only ever produces AnomalyKindDrive.
	RuleDurationMismatch = "duration_mismatch"

	// RuleSameKindOverlapDrive / RuleSameKindOverlapCharging: two CLOSED
	// sessions of the same kind and vehicle have overlapping
	// [started_at, ended_at) windows, and the windows are not identical
	// (an identical window is reclassified as RuleDuplicateSessionWindow).
	RuleSameKindOverlapDrive    = "same_kind_overlap_drive"
	RuleSameKindOverlapCharging = "same_kind_overlap_charging"

	// RuleCrossKindOverlap: a CLOSED drive and a CLOSED charging session for
	// the same vehicle have overlapping windows. A vehicle cannot physically
	// drive and charge at once, so this is always reported with
	// Kind == AnomalyKindDrive (the drive is the primary/SessionID) and
	// RelatedSessionID set to the charging session.
	RuleCrossKindOverlap = "cross_kind_overlap_drive_charging"

	// RuleDuplicateSessionWindow: two CLOSED sessions of the same kind and
	// vehicle share the exact same [started_at, ended_at) window — the
	// signature of double ingestion/replay rather than two genuinely
	// separate (if overlapping) sessions.
	RuleDuplicateSessionWindow = "duplicate_session_window"

	// RuleOdometerRollback: both start/end odometer are present and the end
	// reading is materially below the start reading.
	RuleOdometerRollback = "odometer_rollback"

	// RuleSocInconsistent: charging end SoC materially below start SoC, or
	// drive end SoC materially above start SoC.
	RuleSocInconsistent = "soc_inconsistent"

	// Negative aggregate rules are field-specific because the durable case
	// fingerprint is (kind, session_id, rule). A shared token would collapse
	// two independently corrupt fields on the same session into one case.
	RuleNegativeDistanceM     = "negative_aggregate_distance_m"
	RuleNegativeDurationS     = "negative_aggregate_duration_s"
	RuleNegativeEnergyUsedWh  = "negative_aggregate_energy_used_wh"
	RuleNegativeRegenEnergyWh = "negative_aggregate_regen_energy_wh"
	RuleNegativeEnergyAddedWh = "negative_aggregate_total_energy_added_wh"
)

// Tolerances. Every threshold below is documented here, in one place, so a
// future tuning pass has a single source of truth instead of magic numbers
// scattered across queries and classifiers.
const (
	// durationMismatchToleranceS allows for sub-minute clock/rounding drift
	// between the close-out writer's stored duration_s and a straight
	// wall-clock (ended_at - started_at) computation before flagging.
	durationMismatchToleranceS int64 = 60

	// odometerRollbackToleranceM absorbs float rounding noise in the stored
	// meters columns; only a rollback strictly greater than this is flagged.
	odometerRollbackToleranceM float64 = 1.0

	// overlapToleranceS ignores tiny non-identical overlaps that can be
	// introduced by timestamp precision or close/open write ordering. Exact
	// duplicate windows remain reportable regardless of their duration.
	overlapToleranceS int64 = 5

	// socToleranceDrivePct is how far a drive's end_soc_pct may exceed its
	// start_soc_pct before a conservative, medium-confidence finding is
	// emitted. Regeneration and SoC recalibration make smaller gains valid.
	socToleranceDrivePct float64 = 5.0

	// socToleranceChargingPct is how far a charging session's end_soc_pct
	// may fall below its start_soc_pct before a conservative,
	// medium-confidence finding is emitted. Conditioning and auxiliary loads
	// can make smaller losses valid.
	socToleranceChargingPct float64 = 5.0
)

// maxAnomalyLimit is the hard ceiling on anomalies returned by
// ListSessionAnomalies in a single call, regardless of what the caller
// requests. It bounds both the per-rule SQL LIMIT and the final cross-rule
// truncation, so a pathological lookback window (or a caller passing an
// unbounded limit) can never turn this into an unbounded scan.
const maxAnomalyLimit = 500

// defaultAnomalyLimit is used when the caller supplies a non-positive limit.
const defaultAnomalyLimit = 100

// AnomalyFacts carries rule-specific, typed evidence. Only the fields
// relevant to the Anomaly's Rule are populated; every other field is left at
// its zero value. Deliberately a flat struct of optional typed fields rather
// than a map/JSONB blob (ADR-001 / data-modeling.instructions.md: no JSONB
// for shapes known at design time).
type AnomalyFacts struct {
	// RuleDurationMismatch
	StoredDurationS   *int64
	ComputedDurationS *int64
	ToleranceS        *int64

	// RuleSameKindOverlapDrive / RuleSameKindOverlapCharging /
	// RuleCrossKindOverlap / RuleDuplicateSessionWindow
	OverlapSeconds *int64

	// RuleOdometerRollback
	StartOdometerM *float64
	EndOdometerM   *float64

	// RuleSocInconsistent
	StartSocPct *float64
	EndSocPct   *float64

	// RuleNegative*
	NegativeField string
	NegativeValue *float64
}

// Anomaly is a single, conservatively-detected inconsistency in one drive or
// charging session (or a pair of sessions, for the overlap/duplicate rules),
// ready for a later scanner to materialize as a data_repair_cases row.
type Anomaly struct {
	Kind       AnomalyKind
	Rule       string
	Severity   AnomalySeverity
	Confidence AnomalyConfidence

	VehicleID int64
	// SessionID is the primary session this anomaly is filed against. For
	// cross-session rules (overlap, duplicate window) it is the
	// deterministically canonical side of the pair — see the Rule* constant
	// doc comments for which side that is per rule.
	SessionID int64
	// RelatedSessionID is set only for cross-session rules. It is always the
	// OTHER session in the pair, never SessionID's own value.
	RelatedSessionID *int64

	StartedAt time.Time
	EndedAt   *time.Time

	Facts AnomalyFacts

	// Applicable is always false: this detector never synthesizes a repair
	// boundary or marks anything safe to auto-apply. It exists as a field
	// (rather than being omitted) so a future rule that CAN defend an exact
	// repair has somewhere to report it without a breaking type change.
	Applicable bool
}

// AnomalyScanResult bundles the bounded set of detected anomalies with a
// truncation signal, so a caller can distinguish "fewer than limit because
// there aren't more in this window" from "there are more; narrow the
// lookback or vehicle filter and call again".
type AnomalyScanResult struct {
	Anomalies []Anomaly
	// Truncated is true when the raw (pre-truncation) detection count across
	// all rules exceeded the effective limit.
	Truncated bool
}

// clampAnomalyLimit enforces the hard maximum documented on maxAnomalyLimit
// and substitutes defaultAnomalyLimit for a non-positive caller value.
func clampAnomalyLimit(limit int) int {
	if limit <= 0 {
		return defaultAnomalyLimit
	}
	if limit > maxAnomalyLimit {
		return maxAnomalyLimit
	}
	return limit
}
