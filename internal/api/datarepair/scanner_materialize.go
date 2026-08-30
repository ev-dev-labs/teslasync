package datarepair

import (
	"fmt"
	"strconv"
	"time"

	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

const structuralAnomalyBlockedReason = "structural_anomaly_requires_manual_correction"

func suggestionCase(s systemmodel.SessionRepairSuggestion) systemmodel.RepairCase {
	kind := systemmodel.RepairCaseKind(s.Kind)
	suggestedEndedAt := s.SuggestedEndedAt.UTC()
	repairCase := systemmodel.RepairCase{
		Fingerprint:                systemmodel.RepairCaseFingerprint(kind, s.SessionID, string(s.Rule)),
		Kind:                       kind,
		SessionID:                  s.SessionID,
		VehicleID:                  s.VehicleID,
		Rule:                       string(s.Rule),
		Confidence:                 systemmodel.RepairCaseConfidence(s.Confidence),
		Status:                     systemmodel.RepairCaseStatusOpen,
		SuggestedEndedAt:           &suggestedEndedAt,
		EvidenceStartedAt:          s.StartedAt.UTC(),
		EvidenceStoredEndedAt:      utcPtr(s.StoredEndedAt),
		EvidenceContradictionTs:    s.ContradictingEvidence.Ts.UTC(),
		EvidenceContradictionSrc:   string(s.ContradictingEvidence.Source),
		EvidenceContradictionField: s.ContradictingEvidence.Field,
		EvidenceContradictionValue: s.ContradictingEvidence.Value,
		EvidenceGapS:               s.EvidenceGapS,
		Applicable:                 s.Applicable,
	}
	if s.LastInSessionEvidence != nil {
		lastTs := s.LastInSessionEvidence.Ts.UTC()
		lastSource := string(s.LastInSessionEvidence.Source)
		lastField := s.LastInSessionEvidence.Field
		lastValue := s.LastInSessionEvidence.Value
		repairCase.EvidenceLastInSessionTs = &lastTs
		repairCase.EvidenceLastInSessionSrc = &lastSource
		repairCase.EvidenceLastInSessionField = &lastField
		repairCase.EvidenceLastInSessionValue = &lastValue
	}
	if !s.Applicable {
		reason := s.BlockedReason
		if reason == "" {
			reason = "repair_not_applicable"
		}
		repairCase.BlockedReason = &reason
	}
	return repairCase
}

func anomalyCase(a datarepairdb.Anomaly) systemmodel.RepairCase {
	kind := systemmodel.RepairCaseKind(a.Kind)
	evidenceTs, source, field, value := anomalyEvidence(a)
	blockedReason := structuralAnomalyBlockedReason

	return systemmodel.RepairCase{
		Fingerprint:                systemmodel.RepairCaseFingerprintWithRelated(kind, a.SessionID, a.Rule, a.RelatedSessionID),
		Kind:                       kind,
		SessionID:                  a.SessionID,
		RelatedSessionID:           a.RelatedSessionID,
		VehicleID:                  a.VehicleID,
		Rule:                       a.Rule,
		Confidence:                 systemmodel.RepairCaseConfidence(a.Confidence),
		Status:                     systemmodel.RepairCaseStatusOpen,
		EvidenceStartedAt:          a.StartedAt.UTC(),
		EvidenceStoredEndedAt:      utcPtr(a.EndedAt),
		EvidenceContradictionTs:    evidenceTs.UTC(),
		EvidenceContradictionSrc:   source,
		EvidenceContradictionField: field,
		EvidenceContradictionValue: value,
		EvidenceGapS:               0,
		Applicable:                 false,
		BlockedReason:              &blockedReason,
	}
}

func anomalyEvidence(a datarepairdb.Anomaly) (time.Time, string, string, string) {
	ts := a.StartedAt
	if a.EndedAt != nil {
		ts = *a.EndedAt
	}
	source := "drives"
	if a.Kind == datarepairdb.AnomalyKindCharging {
		source = "charging_sessions"
	}

	switch a.Rule {
	case datarepairdb.RuleEndedBeforeStarted:
		return ts, source, "ended_at", formatTimePtr(a.EndedAt)
	case datarepairdb.RuleDurationMismatch:
		return ts, source, "duration_s", fmt.Sprintf(
			"stored=%s computed=%s tolerance_s=%s",
			formatInt64Ptr(a.Facts.StoredDurationS),
			formatInt64Ptr(a.Facts.ComputedDurationS),
			formatInt64Ptr(a.Facts.ToleranceS),
		)
	case datarepairdb.RuleSameKindOverlapDrive,
		datarepairdb.RuleSameKindOverlapCharging,
		datarepairdb.RuleCrossKindOverlap,
		datarepairdb.RuleDuplicateSessionWindow:
		return ts, source, "session_window", fmt.Sprintf(
			"related_session_id=%s overlap_s=%s",
			formatInt64Ptr(a.RelatedSessionID),
			formatInt64Ptr(a.Facts.OverlapSeconds),
		)
	case datarepairdb.RuleOdometerRollback:
		return ts, source, "end_odometer_m", fmt.Sprintf(
			"start_m=%s end_m=%s",
			formatFloat64Ptr(a.Facts.StartOdometerM),
			formatFloat64Ptr(a.Facts.EndOdometerM),
		)
	case datarepairdb.RuleSocInconsistent:
		return ts, source, "end_soc_pct", fmt.Sprintf(
			"start_pct=%s end_pct=%s",
			formatFloat64Ptr(a.Facts.StartSocPct),
			formatFloat64Ptr(a.Facts.EndSocPct),
		)
	default:
		field := a.Facts.NegativeField
		if field == "" {
			field = "session"
		}
		return ts, source, field, formatFloat64Ptr(a.Facts.NegativeValue)
	}
}

func formatInt64Ptr(value *int64) string {
	if value == nil {
		return "unknown"
	}
	return strconv.FormatInt(*value, 10)
}

func formatFloat64Ptr(value *float64) string {
	if value == nil {
		return "unknown"
	}
	return strconv.FormatFloat(*value, 'g', -1, 64)
}

func formatTimePtr(value *time.Time) string {
	if value == nil {
		return "unknown"
	}
	return value.UTC().Format(time.RFC3339Nano)
}
