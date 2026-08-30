package system

import "time"

// Session-repair DTOs.
//
// These types describe the read-only diagnosis contract behind
// GET /api/v1/data-repair/suggestions and the explicit, user-driven apply
// that follows it (POST /api/v1/data-repair/{drive|charging}/{id}/close with
// an `ended_at` body).
//
// The diagnosis is POST-HOC: it reads durable evidence that has already been
// written by the ingest pipeline (signal_log, drive_telemetry,
// charging_telemetry, drives, charging_sessions) and never participates in
// ingest. It NEVER mutates anything — a suggestion only becomes a write when
// the operator explicitly applies it.
//
// Durable-evidence sources, per internal/tesla/router/routing.yaml:
//
//   - `Gear` routes to drive_telemetry.gear (NOT signal_log), so Park/Drive
//     evidence is read from drive_telemetry.
//   - `VehicleSpeed` routes to drive_telemetry.speed_mps.
//   - `DetailedChargeState` / `ChargeState` route to signal_log.str_value.
//   - `ACChargingPower` / `DCChargingPower` route to charging_telemetry with
//     `also_signal_log: true`.
//
// A caller MUST NOT infer that a value came from signal_log; every
// SessionRepairEvidence carries its own Source token.

// SessionRepairKind identifies which session table a suggestion targets. The
// values mirror the URL segment of the canonical apply routes
// /api/v1/data-repair/{drive|charging}/{id}.
type SessionRepairKind string

const (
	// SessionRepairKindDrive targets a row in `drives`.
	SessionRepairKindDrive SessionRepairKind = "drive"
	// SessionRepairKindCharging targets a row in `charging_sessions`.
	SessionRepairKindCharging SessionRepairKind = "charging"
)

// SessionRepairRule is the machine token for the detection rule that produced
// a suggestion. The frontend maps it to a localized explanation; it MUST stay
// stable because it is also written into the audit trail.
type SessionRepairRule string

const (
	// SessionRepairRuleDriveOpenChargingStarted: a drive is still open and a
	// charging session (or a durable charging state) began after the last
	// in-drive evidence. Driving and charging are mutually exclusive, so the
	// intermediate Park signal was missed.
	SessionRepairRuleDriveOpenChargingStarted SessionRepairRule = "drive_open_charging_started"

	// SessionRepairRuleDriveOpenParkObserved: a drive is still open even though
	// drive_telemetry recorded Gear=P/N afterwards. The completion write was
	// missed (pod restart, dropped batch), not the signal.
	SessionRepairRuleDriveOpenParkObserved SessionRepairRule = "drive_open_park_observed"

	// SessionRepairRuleDriveEndAfterContradiction: a drive is closed, but its
	// stored ended_at is materially later than the first durable evidence that
	// the drive had already finished. Typically produced by a crash-recovery
	// pass that closed the row at "last signal of any kind".
	SessionRepairRuleDriveEndAfterContradiction SessionRepairRule = "drive_end_after_contradiction"

	// SessionRepairRuleChargingOpenChargeEnded: a charging session is still open
	// although a later durable DetailedChargeState/ChargeState observation
	// establishes charging stopped (Complete / Stopped / Disconnected / NoPower).
	SessionRepairRuleChargingOpenChargeEnded SessionRepairRule = "charging_open_charge_ended"

	// SessionRepairRuleChargingOpenDriveStarted: a charging session is still
	// open although the vehicle later shifted into D/R or a drive row was
	// created — a mutually exclusive state.
	SessionRepairRuleChargingOpenDriveStarted SessionRepairRule = "charging_open_drive_started"

	// SessionRepairRuleChargingEndAfterContradiction: a charging session is
	// closed, but its stored ended_at is materially later than the first
	// durable evidence that charging had already ended.
	SessionRepairRuleChargingEndAfterContradiction SessionRepairRule = "charging_end_after_contradiction"
)

// SessionRepairConfidence grades how directly the evidence establishes the
// proposed boundary. Only high/medium are emitted — anything weaker is not
// surfaced at all, because a low-confidence suggestion on a destructive-ish
// action is worse than no suggestion.
type SessionRepairConfidence string

const (
	// SessionRepairConfidenceHigh: the contradicting observation is itself the
	// boundary instant (Gear=P, a charge-state transition), or is mutually
	// exclusive with the open session in a way the FSM treats as definitive.
	SessionRepairConfidenceHigh SessionRepairConfidence = "high"
	// SessionRepairConfidenceMedium: the boundary is inferred from the last
	// in-session evidence before a later contradicting observation, or the row
	// is already closed and would be rewritten.
	SessionRepairConfidenceMedium SessionRepairConfidence = "medium"
)

// SessionRepairEvidenceSource is the durable table an observation was read
// from. Kept as a token (not free text) so the UI can label it without string
// matching.
type SessionRepairEvidenceSource string

const (
	SessionRepairSourceSignalLog         SessionRepairEvidenceSource = "signal_log"
	SessionRepairSourceDriveTelemetry    SessionRepairEvidenceSource = "drive_telemetry"
	SessionRepairSourceChargingTelemetry SessionRepairEvidenceSource = "charging_telemetry"
	SessionRepairSourceDrives            SessionRepairEvidenceSource = "drives"
	SessionRepairSourceChargingSessions  SessionRepairEvidenceSource = "charging_sessions"
)

// SessionRepairEvidence is one durable observation used to justify (or to
// bound) a suggestion. Value is the human-inspectable rendering of whatever
// typed column the row carried — never a unit-bearing number that a reader
// could mistake for SI (numbers are rendered with their unit inline).
type SessionRepairEvidence struct {
	Ts     time.Time                   `json:"ts"`
	Source SessionRepairEvidenceSource `json:"source"`
	Field  string                      `json:"field"`
	Value  string                      `json:"value"`
}

// SessionRepairSuggestion is one proposed, NOT-yet-applied boundary repair.
//
// The whole struct is a proposal. `Applicable` reports whether the apply
// endpoint would currently accept it; when false, `BlockedReason` carries a
// machine token explaining why (the UI localizes it and disables Apply).
type SessionRepairSuggestion struct {
	Kind      SessionRepairKind `json:"kind"`
	SessionID int64             `json:"session_id"`
	VehicleID int64             `json:"vehicle_id"`

	Rule       SessionRepairRule       `json:"rule"`
	Confidence SessionRepairConfidence `json:"confidence"`

	// StartedAt / StoredEndedAt are the session's CURRENT persisted boundary.
	// StoredEndedAt is nil while the session is still open.
	StartedAt     time.Time  `json:"started_at"`
	StoredEndedAt *time.Time `json:"stored_ended_at"`
	// StoredDurationS is the persisted drives.duration_s (nil for charging,
	// whose duration is derived at read time).
	StoredDurationS *int64 `json:"stored_duration_s"`

	// LastInSessionEvidence is the newest durable observation that is still
	// consistent with the session being in progress. Nil when the session
	// produced no such observation before the contradiction.
	LastInSessionEvidence *SessionRepairEvidence `json:"last_in_session_evidence"`

	// ContradictingEvidence is the earliest durable observation after the
	// session start that is mutually exclusive with the session still running.
	// It is the hard upper bound for any proposed end timestamp.
	ContradictingEvidence SessionRepairEvidence `json:"contradicting_evidence"`

	// SuggestedEndedAt is the proposed boundary. Invariant:
	// StartedAt < SuggestedEndedAt <= ContradictingEvidence.Ts.
	SuggestedEndedAt time.Time `json:"suggested_ended_at"`
	// SuggestedDurationS is SuggestedEndedAt - StartedAt in whole SI seconds.
	SuggestedDurationS int64 `json:"suggested_duration_s"`
	// EvidenceGapS is the unobserved interval, in whole SI seconds, between the
	// last in-session evidence and the contradiction. A large gap is the
	// signature of missed intermediate signals.
	EvidenceGapS int64 `json:"evidence_gap_s"`

	Applicable    bool   `json:"applicable"`
	BlockedReason string `json:"blocked_reason,omitempty"`
}

// SessionRepairReport is the response body of GET /data-repair/suggestions.
// Drive and charging suggestions are returned in separate lists because the
// UI reviews and applies them through different routes; both lists are always
// non-nil so the frontend never has to null-guard before iterating.
type SessionRepairReport struct {
	GeneratedAt             time.Time                 `json:"generated_at"`
	LookbackDays            int                       `json:"lookback_days"`
	ScannedDrives           int                       `json:"scanned_drives"`
	ScannedChargingSessions int                       `json:"scanned_charging_sessions"`
	DriveSuggestions        []SessionRepairSuggestion `json:"drive_suggestions"`
	ChargingSuggestions     []SessionRepairSuggestion `json:"charging_suggestions"`
	// Truncated reports that the candidate scan hit its limit, so more
	// suggestions may exist beyond this page. Surfaced honestly rather than
	// pretending the worklist is complete.
	Truncated bool `json:"truncated"`
}
