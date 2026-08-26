package datarepair

import (
	"sort"
	"time"
)

// This file holds the PURE (no I/O, no context, no *Repo receiver)
// row-classification, pairing, and ordering logic behind
// Repo.ListSessionAnomalies (anomaly_scan.go). Every function here is a
// plain data transform, which is what makes it unit-testable without a live
// PostgreSQL — see anomaly_classify_test.go.

// ---------------------------------------------------------------------------
// Row shapes (one row per SQL query result)
// ---------------------------------------------------------------------------

// driveAnomalyRow is the projection scanned from the combined single-session
// drives anomaly query (anomaly_scan.go). Every rule that only needs one
// session's own stored data classifies from this shape.
type driveAnomalyRow struct {
	ID             int64
	VehicleID      int64
	StartedAt      time.Time
	EndedAt        *time.Time
	DurationS      *int64
	DistanceM      *float64
	StartOdometerM *float64
	EndOdometerM   *float64
	StartSocPct    *float64
	EndSocPct      *float64
	EnergyUsedWh   *float64
	RegenEnergyWh  *float64
}

// chargingAnomalyRow is the projection scanned from the combined
// single-session charging_sessions anomaly query.
type chargingAnomalyRow struct {
	ID                 int64
	VehicleID          int64
	StartedAt          time.Time
	EndedAt            *time.Time
	StartOdometerM     *float64
	EndOdometerM       *float64
	StartSocPct        *float64
	EndSocPct          *float64
	TotalEnergyAddedWh *float64
}

// overlapCandidate is the raw pairing shared by all three overlap detectors
// (drive-drive, charging-charging, drive-charging). Kind is the AnomalyKind
// assigned to the resulting Anomaly: for a SameKind pair it is the shared
// kind of both sessions; for a cross-kind pair it is always
// AnomalyKindDrive, per the RuleCrossKindOverlap contract.
type overlapCandidate struct {
	Kind             AnomalyKind
	VehicleID        int64
	SessionID        int64
	SessionStartedAt time.Time
	SessionEndedAt   time.Time
	RelatedSessionID int64
	RelatedStartedAt time.Time
	RelatedEndedAt   time.Time
	// SameKind distinguishes a drive-drive/charging-charging pair (eligible
	// for RuleDuplicateSessionWindow reclassification when the windows are
	// identical) from a drive-charging cross-kind pair (never a "duplicate"
	// in that sense — the two rows belong to different tables entirely).
	SameKind bool
}

// ---------------------------------------------------------------------------
// Single-session classifiers
// ---------------------------------------------------------------------------

// classifyDriveRow evaluates every single-session drive rule against one
// candidate row and returns zero or more Anomalies. A row can trip more than
// one rule at once (e.g. a negative distance AND an odometer rollback), so
// every check is independent rather than an if/else chain.
func classifyDriveRow(row driveAnomalyRow) []Anomaly {
	base := Anomaly{
		Kind:      AnomalyKindDrive,
		VehicleID: row.VehicleID,
		SessionID: row.ID,
		StartedAt: row.StartedAt,
		EndedAt:   row.EndedAt,
	}
	var out []Anomaly

	if row.EndedAt != nil && !row.EndedAt.After(row.StartedAt) {
		a := base
		a.Rule = RuleEndedBeforeStarted
		a.Severity = AnomalySeverityHigh
		a.Confidence = AnomalyConfidenceHigh
		out = append(out, a)
	}

	if row.EndedAt != nil && row.DurationS != nil {
		if stored, computed, tolerance, ok := durationMismatch(*row.DurationS, row.StartedAt, *row.EndedAt); ok {
			a := base
			a.Rule = RuleDurationMismatch
			a.Severity = AnomalySeverityMedium
			a.Confidence = AnomalyConfidenceHigh
			a.Facts = AnomalyFacts{StoredDurationS: &stored, ComputedDurationS: &computed, ToleranceS: &tolerance}
			out = append(out, a)
		}
	}

	if a, ok := odometerRollbackAnomaly(base, row.StartOdometerM, row.EndOdometerM); ok {
		out = append(out, a)
	}

	if row.StartSocPct != nil && row.EndSocPct != nil && *row.EndSocPct > *row.StartSocPct+socToleranceDrivePct {
		a := base
		a.Rule = RuleSocInconsistent
		a.Severity = AnomalySeverityMedium
		a.Confidence = AnomalyConfidenceMedium
		a.Facts = AnomalyFacts{StartSocPct: row.StartSocPct, EndSocPct: row.EndSocPct}
		out = append(out, a)
	}

	out = append(out, negativeAggregateAnomalies(base, []negativeField{
		{RuleNegativeDistanceM, "distance_m", row.DistanceM},
		{RuleNegativeEnergyUsedWh, "energy_used_wh", row.EnergyUsedWh},
		{RuleNegativeRegenEnergyWh, "regen_energy_wh", row.RegenEnergyWh},
	})...)
	if row.DurationS != nil && *row.DurationS < 0 {
		out = append(out, negativeAggregateAnomaly(base, RuleNegativeDurationS, "duration_s", float64(*row.DurationS)))
	}

	return out
}

// classifyChargingRow is the charging_sessions counterpart of
// classifyDriveRow. Charging sessions have no stored duration_s column
// (duration is always derived at read time from started_at/ended_at), so
// RuleDurationMismatch never applies here.
func classifyChargingRow(row chargingAnomalyRow) []Anomaly {
	base := Anomaly{
		Kind:      AnomalyKindCharging,
		VehicleID: row.VehicleID,
		SessionID: row.ID,
		StartedAt: row.StartedAt,
		EndedAt:   row.EndedAt,
	}
	var out []Anomaly

	if row.EndedAt != nil && !row.EndedAt.After(row.StartedAt) {
		a := base
		a.Rule = RuleEndedBeforeStarted
		a.Severity = AnomalySeverityHigh
		a.Confidence = AnomalyConfidenceHigh
		out = append(out, a)
	}

	if a, ok := odometerRollbackAnomaly(base, row.StartOdometerM, row.EndOdometerM); ok {
		out = append(out, a)
	}

	if row.StartSocPct != nil && row.EndSocPct != nil && *row.EndSocPct < *row.StartSocPct-socToleranceChargingPct {
		a := base
		a.Rule = RuleSocInconsistent
		a.Severity = AnomalySeverityMedium
		a.Confidence = AnomalyConfidenceMedium
		a.Facts = AnomalyFacts{StartSocPct: row.StartSocPct, EndSocPct: row.EndSocPct}
		out = append(out, a)
	}

	out = append(out, negativeAggregateAnomalies(base, []negativeField{
		{RuleNegativeEnergyAddedWh, "total_energy_added_wh", row.TotalEnergyAddedWh},
	})...)

	return out
}

// durationMismatch reports whether a drive's stored duration_s disagrees
// with wall-clock (ended - started) by more than durationMismatchToleranceS,
// returning the stored/computed/tolerance facts alongside the verdict.
func durationMismatch(storedS int64, started, ended time.Time) (stored, computed, tolerance int64, ok bool) {
	computed = int64(ended.Sub(started).Round(time.Second).Seconds())
	diff := storedS - computed
	if diff < 0 {
		diff = -diff
	}
	return storedS, computed, durationMismatchToleranceS, diff > durationMismatchToleranceS
}

// odometerRollbackAnomaly is shared by drives and charging_sessions: both
// tables carry start_odometer_m / end_odometer_m with identical semantics.
func odometerRollbackAnomaly(base Anomaly, startM, endM *float64) (Anomaly, bool) {
	if startM == nil || endM == nil || *endM >= *startM-odometerRollbackToleranceM {
		return Anomaly{}, false
	}
	a := base
	a.Rule = RuleOdometerRollback
	a.Severity = AnomalySeverityHigh
	a.Confidence = AnomalyConfidenceHigh
	a.Facts = AnomalyFacts{StartOdometerM: startM, EndOdometerM: endM}
	return a, true
}

// negativeField pairs a column name with its (possibly absent) value, for
// the shared negative-aggregate check below.
type negativeField struct {
	rule  string
	name  string
	value *float64
}

// negativeAggregateAnomalies emits one Anomaly per field that is present and
// strictly negative. Every field passed in must be physically nonnegative by
// definition (distance, duration, energy used/added/regenerated).
func negativeAggregateAnomalies(base Anomaly, fields []negativeField) []Anomaly {
	var out []Anomaly
	for _, f := range fields {
		if f.value != nil && *f.value < 0 {
			out = append(out, negativeAggregateAnomaly(base, f.rule, f.name, *f.value))
		}
	}
	return out
}

func negativeAggregateAnomaly(base Anomaly, rule, field string, value float64) Anomaly {
	a := base
	a.Rule = rule
	a.Severity = AnomalySeverityHigh
	a.Confidence = AnomalyConfidenceHigh
	v := value
	a.Facts = AnomalyFacts{NegativeField: field, NegativeValue: &v}
	return a
}

// ---------------------------------------------------------------------------
// Overlap / duplicate-window classifier
// ---------------------------------------------------------------------------

// classifyOverlap converts one raw pairing into its Anomaly. Identical
// windows on a same-kind pair are reclassified from a generic overlap to the
// more specific, higher-severity RuleDuplicateSessionWindow.
func classifyOverlap(c overlapCandidate) Anomaly {
	rule := RuleCrossKindOverlap
	severity := AnomalySeverityMedium
	if c.SameKind {
		if c.Kind == AnomalyKindDrive {
			rule = RuleSameKindOverlapDrive
		} else {
			rule = RuleSameKindOverlapCharging
		}
		if c.SessionStartedAt.Equal(c.RelatedStartedAt) && c.SessionEndedAt.Equal(c.RelatedEndedAt) {
			rule = RuleDuplicateSessionWindow
			severity = AnomalySeverityHigh
		}
	}

	overlapS := overlapSeconds(c.SessionStartedAt, c.SessionEndedAt, c.RelatedStartedAt, c.RelatedEndedAt)
	related := c.RelatedSessionID
	endedAt := c.SessionEndedAt

	return Anomaly{
		Kind:             c.Kind,
		Rule:             rule,
		Severity:         severity,
		Confidence:       AnomalyConfidenceHigh,
		VehicleID:        c.VehicleID,
		SessionID:        c.SessionID,
		RelatedSessionID: &related,
		StartedAt:        c.SessionStartedAt,
		EndedAt:          &endedAt,
		Facts:            AnomalyFacts{OverlapSeconds: &overlapS},
	}
}

// overlapSeconds computes the width, in whole seconds, of the intersection
// of two closed [start, end) windows that are already known to overlap.
func overlapSeconds(aStart, aEnd, bStart, bEnd time.Time) int64 {
	lo := aStart
	if bStart.After(lo) {
		lo = bStart
	}
	hi := aEnd
	if bEnd.Before(hi) {
		hi = bEnd
	}
	return int64(hi.Sub(lo).Round(time.Second).Seconds())
}

// ---------------------------------------------------------------------------
// Deterministic ordering and truncation
// ---------------------------------------------------------------------------

// sortAnomalies orders anomalies deterministically: chronologically by
// StartedAt, then by every remaining identifying field, so that two scans
// over the same underlying data always return the same order (a prerequisite
// for stable, reproducible truncation).
func sortAnomalies(anomalies []Anomaly) {
	sort.SliceStable(anomalies, func(i, j int) bool {
		a, b := anomalies[i], anomalies[j]
		if !a.StartedAt.Equal(b.StartedAt) {
			return a.StartedAt.Before(b.StartedAt)
		}
		if a.VehicleID != b.VehicleID {
			return a.VehicleID < b.VehicleID
		}
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		if a.SessionID != b.SessionID {
			return a.SessionID < b.SessionID
		}
		if a.Rule != b.Rule {
			return a.Rule < b.Rule
		}
		return relatedIDOrZero(a) < relatedIDOrZero(b)
	})
}

func relatedIDOrZero(a Anomaly) int64 {
	if a.RelatedSessionID == nil {
		return 0
	}
	return *a.RelatedSessionID
}

// truncateAnomalies caps an already-sorted slice at limit, reporting whether
// any anomalies were dropped.
func truncateAnomalies(anomalies []Anomaly, limit int) ([]Anomaly, bool) {
	if len(anomalies) <= limit {
		return anomalies, false
	}
	return anomalies[:limit], true
}
