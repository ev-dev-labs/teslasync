package datarepair

import (
	"context"
	"fmt"
	"time"

	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

// Evidence-based session-boundary diagnosis.
//
// This file is READ-ONLY. It never writes; it turns durable evidence into
// PROPOSALS that a human must explicitly apply. The apply path lives in
// close.go and re-runs this same analysis before it is allowed to mutate.
//
// The whole design rests on one idea: a session boundary is broken when the
// stored session state CONTRADICTS later durable evidence. "This has been open
// a long time" is explicitly NOT evidence — a car really can sit in Drive at a
// trailhead for a day, and closing it on age alone would fabricate data. Every
// rule here therefore needs a specific later observation that is mutually
// exclusive with the session still running.

const (
	// defaultLookbackDays bounds how far back the candidate scan reaches.
	defaultLookbackDays = 30
	// maxLookbackDays caps an operator-supplied lookback so one request cannot
	// walk the entire history of a hypertable.
	maxLookbackDays = 365

	// defaultCandidateLimit / maxCandidateLimit bound how many sessions of each
	// kind are analysed per request. Each candidate costs a handful of
	// indexed LIMIT-1 evidence lookups, so the limit is what keeps this
	// on-demand diagnostic from turning into a table scan.
	defaultCandidateLimit = 20
	maxCandidateLimit     = 100

	// liveActivityWindow guards against closing a session that is still live.
	// If the vehicle produced in-session evidence (driving telemetry / charging
	// power) inside this window of now, no suggestion is emitted for an open
	// session of that kind at all.
	liveActivityWindow = 15 * time.Minute

	// contradictionSettleWindow requires the contradicting observation itself to
	// be old enough that a late-arriving batch cannot still reorder the
	// picture. Fleet Telemetry batches and the tracker's own flush interval are
	// seconds-to-minutes scale; ten minutes is comfortably past that.
	contradictionSettleWindow = 10 * time.Minute

	// overrunTolerance is how far past the first contradicting observation a
	// CLOSED session's stored ended_at must sit before the row is treated as
	// broken. It absorbs the normal few-second lag between the boundary signal
	// and the completion write.
	overrunTolerance = 5 * time.Minute

	// chargeStateScanLimit caps the charge-state change feed read per candidate.
	// DetailedChargeState is emitted on transition only, so a real window holds
	// a handful of rows; the cap exists for pathological data.
	chargeStateScanLimit = 200
)

// chargeStateFields are the canonical durable charge-state fields, in
// routing.yaml order of preference. Both route to signal_log.
var chargeStateFields = []string{"DetailedChargeState", "ChargeState"}

// drivingGears / parkedGears mirror Tesla shift semantics: D/R means the
// drive is in progress, P ends it. Neutral is rolling, not Park.
var (
	drivingGears = []string{enums.GearDrive, enums.GearReverse}
	parkedGears  = []string{enums.GearPark}
)

// blockedReasonOverlapsNextSession is the machine token surfaced when applying
// the proposed boundary would still leave the session overlapping the next
// session of the same kind. The apply endpoint rejects the same condition, so
// the flag and the endpoint always agree.
const blockedReasonOverlapsNextSession = "overlaps_next_session"

// diagnosisSource is the narrow read-only port the analyzer depends on.
// *datarepairdb.Repo satisfies it; handler tests inject an in-memory fake.
type diagnosisSource interface {
	ListOpenDrives(ctx context.Context, since time.Time, vehicleID *int64, limit int) ([]datarepairdb.SessionCandidate, error)
	ListOverrunDrives(ctx context.Context, since time.Time, vehicleID *int64, tolerance time.Duration, limit int) ([]datarepairdb.SessionCandidate, error)
	ListOpenChargingSessions(ctx context.Context, since time.Time, vehicleID *int64, limit int) ([]datarepairdb.SessionCandidate, error)
	ListOverrunChargingSessions(ctx context.Context, since time.Time, vehicleID *int64, tolerance time.Duration, limit int) ([]datarepairdb.SessionCandidate, error)

	GetDriveCandidate(ctx context.Context, id int64) (*datarepairdb.SessionCandidate, error)
	GetChargingCandidate(ctx context.Context, id int64) (*datarepairdb.SessionCandidate, error)

	ChargeStateObservations(ctx context.Context, vehicleID int64, fields []string, after, until time.Time, limit int) ([]datarepairdb.Observation, error)
	FirstGearObservation(ctx context.Context, vehicleID int64, gears []string, after, until time.Time) (*datarepairdb.Observation, error)
	LastDrivingObservation(ctx context.Context, vehicleID int64, drivingGears []string, from, to time.Time) (*datarepairdb.Observation, error)
	LastChargingPowerObservation(ctx context.Context, vehicleID int64, from, to time.Time) (*datarepairdb.Observation, error)
	FirstChargingSessionAfter(ctx context.Context, vehicleID int64, after time.Time, excludeID int64) (*datarepairdb.Observation, error)
	FirstDriveAfter(ctx context.Context, vehicleID int64, after time.Time, excludeID int64) (*datarepairdb.Observation, error)
}

// Compile-time assertion that the production repo satisfies the port.
var _ diagnosisSource = (*datarepairdb.Repo)(nil)

// diagnosisOptions carries the validated request scope.
type diagnosisOptions struct {
	vehicleID    *int64
	lookbackDays int
	limit        int
}

// toEvidence converts a repo observation into its transport DTO.
func toEvidence(o *datarepairdb.Observation) *systemmodel.SessionRepairEvidence {
	if o == nil {
		return nil
	}
	return &systemmodel.SessionRepairEvidence{
		Ts:     o.Ts.UTC(),
		Source: o.Source,
		Field:  o.Field,
		Value:  o.Value,
	}
}

// earlier returns whichever observation happened first; nil inputs lose.
func earlier(a, b *datarepairdb.Observation) *datarepairdb.Observation {
	switch {
	case a == nil:
		return b
	case b == nil:
		return a
	case b.Ts.Before(a.Ts):
		return b
	default:
		return a
	}
}

// later returns whichever observation happened last; nil inputs lose.
func later(a, b *datarepairdb.Observation) *datarepairdb.Observation {
	switch {
	case a == nil:
		return b
	case b == nil:
		return a
	case b.Ts.After(a.Ts):
		return b
	default:
		return a
	}
}

// evidenceWindowEnd keeps evidence for an older session from leaking across
// the start of a newer session of the same kind. The end is exclusive because
// an observation stamped exactly at the newer start belongs to the newer
// session.
func evidenceWindowEnd(now time.Time, nextSameKind *datarepairdb.Observation) time.Time {
	if nextSameKind == nil || !nextSameKind.Ts.Before(now) {
		return now
	}
	return nextSameKind.Ts.Add(-time.Nanosecond)
}

func observationWithinWindow(observation *datarepairdb.Observation, until time.Time) *datarepairdb.Observation {
	if observation != nil && observation.Ts.After(until) {
		return nil
	}
	return observation
}

// wholeSeconds renders a duration as whole SI seconds, never negative.
func wholeSeconds(d time.Duration) int64 {
	if d <= 0 {
		return 0
	}
	return int64(d.Seconds() + 0.5)
}

// buildReport runs the full diagnosis for both session kinds.
func (h *DataRepairHandler) buildReport(ctx context.Context, opts diagnosisOptions) (*systemmodel.SessionRepairReport, error) {
	src := h.diagnosis
	if src == nil {
		return nil, fmt.Errorf("data-repair diagnosis: source not configured")
	}

	now := h.now()
	since := now.AddDate(0, 0, -opts.lookbackDays)

	report := &systemmodel.SessionRepairReport{
		GeneratedAt:         now,
		LookbackDays:        opts.lookbackDays,
		DriveSuggestions:    make([]systemmodel.SessionRepairSuggestion, 0),
		ChargingSuggestions: make([]systemmodel.SessionRepairSuggestion, 0),
	}

	openDrives, err := src.ListOpenDrives(ctx, since, opts.vehicleID, opts.limit)
	if err != nil {
		return nil, fmt.Errorf("list open drives: %w", err)
	}
	overrunDrives, err := src.ListOverrunDrives(ctx, since, opts.vehicleID, overrunTolerance, opts.limit)
	if err != nil {
		return nil, fmt.Errorf("list overrun drives: %w", err)
	}
	openCharges, err := src.ListOpenChargingSessions(ctx, since, opts.vehicleID, opts.limit)
	if err != nil {
		return nil, fmt.Errorf("list open charging sessions: %w", err)
	}
	overrunCharges, err := src.ListOverrunChargingSessions(ctx, since, opts.vehicleID, overrunTolerance, opts.limit)
	if err != nil {
		return nil, fmt.Errorf("list overrun charging sessions: %w", err)
	}

	report.ScannedDrives = len(openDrives) + len(overrunDrives)
	report.ScannedChargingSessions = len(openCharges) + len(overrunCharges)
	report.Truncated = len(openDrives) >= opts.limit || len(overrunDrives) >= opts.limit ||
		len(openCharges) >= opts.limit || len(overrunCharges) >= opts.limit

	for _, cand := range append(append([]datarepairdb.SessionCandidate{}, openDrives...), overrunDrives...) {
		sug, err := h.diagnoseDrive(ctx, cand, now)
		if err != nil {
			return nil, fmt.Errorf("diagnose drive %d: %w", cand.ID, err)
		}
		if sug != nil {
			report.DriveSuggestions = append(report.DriveSuggestions, *sug)
		}
	}
	for _, cand := range append(append([]datarepairdb.SessionCandidate{}, openCharges...), overrunCharges...) {
		sug, err := h.diagnoseCharging(ctx, cand, now)
		if err != nil {
			return nil, fmt.Errorf("diagnose charging session %d: %w", cand.ID, err)
		}
		if sug != nil {
			report.ChargingSuggestions = append(report.ChargingSuggestions, *sug)
		}
	}

	return report, nil
}

// diagnoseDrive evaluates one drive against durable evidence and returns a
// suggestion, or (nil, nil) when the drive is consistent with the evidence.
func (h *DataRepairHandler) diagnoseDrive(ctx context.Context, cand datarepairdb.SessionCandidate, now time.Time) (*systemmodel.SessionRepairSuggestion, error) {
	src := h.diagnosis
	if src == nil {
		return nil, fmt.Errorf("data-repair diagnosis: source not configured")
	}
	start := cand.StartedAt.UTC()
	if !now.After(start) {
		// A drive stamped in the future is a clock problem, not a boundary
		// problem; refuse to reason about it rather than invent an end.
		return nil, nil
	}

	nextDrive, err := src.FirstDriveAfter(ctx, cand.VehicleID, start, cand.ID)
	if err != nil {
		return nil, err
	}
	evidenceUntil := evidenceWindowEnd(now, nextDrive)
	if !evidenceUntil.After(start) {
		return nil, nil
	}

	// --- contradiction 1: a charging session began -------------------------
	chargeSession, err := src.FirstChargingSessionAfter(ctx, cand.VehicleID, start, 0)
	if err != nil {
		return nil, err
	}
	chargeSession = observationWithinWindow(chargeSession, evidenceUntil)

	// --- contradiction 2: a durable charging state was observed ------------
	states, err := src.ChargeStateObservations(ctx, cand.VehicleID, chargeStateFields, start, evidenceUntil, chargeStateScanLimit)
	if err != nil {
		return nil, err
	}
	var chargingState *datarepairdb.Observation
	for i := range states {
		if enums.IsCharging(states[i].Value) {
			chargingState = &states[i]
			break
		}
	}
	chargingContradiction := earlier(chargeSession, chargingState)

	// --- contradiction 3: the car was observed in Park ----------------------
	// Ignore transient Park observations that were followed by newer
	// driving evidence; drive-session merging intentionally keeps those rows
	// inside one continuous drive.
	lastDrivingOverall, err := src.LastDrivingObservation(ctx, cand.VehicleID, drivingGears, start, evidenceUntil)
	if err != nil {
		return nil, err
	}
	parkSearchAfter := start
	if lastDrivingOverall != nil {
		parkSearchAfter = lastDrivingOverall.Ts.Add(-time.Nanosecond)
	}
	park, err := src.FirstGearObservation(ctx, cand.VehicleID, parkedGears, parkSearchAfter, evidenceUntil)
	if err != nil {
		return nil, err
	}

	contradiction := earlier(chargingContradiction, park)
	if contradiction == nil {
		return nil, nil
	}
	if contradiction.Ts.After(now.Add(-contradictionSettleWindow)) {
		// Too fresh — a late batch could still change the picture.
		return nil, nil
	}

	isParkContradiction := park != nil && contradiction.Ts.Equal(park.Ts) && contradiction.Field == park.Field

	// --- last in-drive evidence -------------------------------------------
	lastIn, err := src.LastDrivingObservation(ctx, cand.VehicleID, drivingGears, start, contradiction.Ts)
	if err != nil {
		return nil, err
	}

	// A Gear=P observation IS the boundary instant the FSM would have used.
	// A charging contradiction is only an upper bound: without verified
	// in-session evidence there is no defensible timestamp to apply.
	suggested := contradiction.Ts
	if !isParkContradiction {
		if lastIn == nil || !lastIn.Ts.After(start) {
			return nil, nil
		}
		suggested = lastIn.Ts
	}
	suggested = suggested.UTC()
	if !suggested.After(start) {
		return nil, nil
	}

	rule := systemmodel.SessionRepairRuleDriveOpenChargingStarted
	confidence := systemmodel.SessionRepairConfidenceMedium
	if isParkContradiction {
		rule = systemmodel.SessionRepairRuleDriveOpenParkObserved
		confidence = systemmodel.SessionRepairConfidenceHigh
	}

	if cand.EndedAt == nil {
		if nextDrive == nil {
			// Open drive: refuse to touch a vehicle that is driving right now.
			live, err := src.LastDrivingObservation(ctx, cand.VehicleID, drivingGears, now.Add(-liveActivityWindow), now)
			if err != nil {
				return nil, err
			}
			if live != nil {
				return nil, nil
			}
		}
	} else {
		stored := cand.EndedAt.UTC()
		if !stored.After(contradiction.Ts.Add(overrunTolerance)) || !stored.After(suggested) {
			// Already ends at (or before) the evidence — nothing to repair.
			return nil, nil
		}
		rule = systemmodel.SessionRepairRuleDriveEndAfterContradiction
		confidence = systemmodel.SessionRepairConfidenceMedium
	}

	sug := &systemmodel.SessionRepairSuggestion{
		Kind:                  systemmodel.SessionRepairKindDrive,
		SessionID:             cand.ID,
		VehicleID:             cand.VehicleID,
		Rule:                  rule,
		Confidence:            confidence,
		StartedAt:             start,
		StoredEndedAt:         utcPtr(cand.EndedAt),
		StoredDurationS:       cand.DurationS,
		LastInSessionEvidence: toEvidence(lastIn),
		ContradictingEvidence: *toEvidence(contradiction),
		SuggestedEndedAt:      suggested,
		SuggestedDurationS:    wholeSeconds(suggested.Sub(start)),
		EvidenceGapS:          evidenceGap(lastIn, contradiction, start),
		Applicable:            true,
	}

	// Same-kind overlap guard: applying must not leave this drive running past
	// the start of the NEXT drive.
	if nextDrive != nil && nextDrive.Ts.Before(suggested) {
		sug.Applicable = false
		sug.BlockedReason = blockedReasonOverlapsNextSession
	}

	return sug, nil
}

// diagnoseCharging evaluates one charging session against durable evidence.
func (h *DataRepairHandler) diagnoseCharging(ctx context.Context, cand datarepairdb.SessionCandidate, now time.Time) (*systemmodel.SessionRepairSuggestion, error) {
	src := h.diagnosis
	if src == nil {
		return nil, fmt.Errorf("data-repair diagnosis: source not configured")
	}
	start := cand.StartedAt.UTC()
	if !now.After(start) {
		return nil, nil
	}

	nextCharge, err := src.FirstChargingSessionAfter(ctx, cand.VehicleID, start, cand.ID)
	if err != nil {
		return nil, err
	}
	evidenceUntil := evidenceWindowEnd(now, nextCharge)
	if !evidenceUntil.After(start) {
		return nil, nil
	}

	// --- contradiction 1: charging demonstrably stopped --------------------
	states, err := src.ChargeStateObservations(ctx, cand.VehicleID, chargeStateFields, start, evidenceUntil, chargeStateScanLimit)
	if err != nil {
		return nil, err
	}
	var (
		chargeEnded      *datarepairdb.Observation
		lastChargingSeen *datarepairdb.Observation
	)
	for i := range states {
		if enums.IsCharging(states[i].Value) {
			if chargeEnded == nil {
				lastChargingSeen = &states[i]
			}
			continue
		}
		if chargeEnded == nil && enums.IsChargeEnded(states[i].Value) {
			chargeEnded = &states[i]
		}
	}

	// --- contradiction 2: a mutually exclusive driving state began ---------
	nextDrive, err := src.FirstDriveAfter(ctx, cand.VehicleID, start, 0)
	if err != nil {
		return nil, err
	}
	nextDrive = observationWithinWindow(nextDrive, evidenceUntil)
	driveGear, err := src.FirstGearObservation(ctx, cand.VehicleID, drivingGears, start, evidenceUntil)
	if err != nil {
		return nil, err
	}
	driveContradiction := earlier(nextDrive, driveGear)

	contradiction := earlier(chargeEnded, driveContradiction)
	if contradiction == nil {
		return nil, nil
	}
	if contradiction.Ts.After(now.Add(-contradictionSettleWindow)) {
		return nil, nil
	}

	isChargeEndContradiction := chargeEnded != nil && contradiction.Ts.Equal(chargeEnded.Ts) &&
		contradiction.Field == chargeEnded.Field

	// --- last in-session evidence ------------------------------------------
	power, err := src.LastChargingPowerObservation(ctx, cand.VehicleID, start, contradiction.Ts)
	if err != nil {
		return nil, err
	}
	if lastChargingSeen != nil && lastChargingSeen.Ts.After(contradiction.Ts) {
		lastChargingSeen = nil
	}
	lastIn := later(power, lastChargingSeen)

	// A charge-state transition IS the durable boundary. A driving
	// contradiction is only an upper bound: without verified in-session
	// evidence there is no defensible timestamp to apply.
	suggested := contradiction.Ts
	if !isChargeEndContradiction {
		if lastIn == nil || !lastIn.Ts.After(start) {
			return nil, nil
		}
		suggested = lastIn.Ts
	}
	suggested = suggested.UTC()
	if !suggested.After(start) {
		return nil, nil
	}

	rule := systemmodel.SessionRepairRuleChargingOpenDriveStarted
	confidence := systemmodel.SessionRepairConfidenceMedium
	if isChargeEndContradiction {
		rule = systemmodel.SessionRepairRuleChargingOpenChargeEnded
		confidence = systemmodel.SessionRepairConfidenceHigh
	}

	if cand.EndedAt == nil {
		if nextCharge == nil {
			live, err := src.LastChargingPowerObservation(ctx, cand.VehicleID, now.Add(-liveActivityWindow), now)
			if err != nil {
				return nil, err
			}
			if live != nil {
				return nil, nil
			}
		}
	} else {
		stored := cand.EndedAt.UTC()
		if !stored.After(contradiction.Ts.Add(overrunTolerance)) || !stored.After(suggested) {
			return nil, nil
		}
		rule = systemmodel.SessionRepairRuleChargingEndAfterContradiction
		confidence = systemmodel.SessionRepairConfidenceMedium
	}

	sug := &systemmodel.SessionRepairSuggestion{
		Kind:                  systemmodel.SessionRepairKindCharging,
		SessionID:             cand.ID,
		VehicleID:             cand.VehicleID,
		Rule:                  rule,
		Confidence:            confidence,
		StartedAt:             start,
		StoredEndedAt:         utcPtr(cand.EndedAt),
		StoredDurationS:       cand.DurationS,
		LastInSessionEvidence: toEvidence(lastIn),
		ContradictingEvidence: *toEvidence(contradiction),
		SuggestedEndedAt:      suggested,
		SuggestedDurationS:    wholeSeconds(suggested.Sub(start)),
		EvidenceGapS:          evidenceGap(lastIn, contradiction, start),
		Applicable:            true,
	}

	if nextCharge != nil && nextCharge.Ts.Before(suggested) {
		sug.Applicable = false
		sug.BlockedReason = blockedReasonOverlapsNextSession
	}

	return sug, nil
}

// evidenceGap measures the unobserved interval that the missed signals fell
// into: from the last in-session observation (or the session start when there
// is none) to the contradiction.
func evidenceGap(lastIn, contradiction *datarepairdb.Observation, start time.Time) int64 {
	if contradiction == nil {
		return 0
	}
	from := start
	if lastIn != nil && lastIn.Ts.After(from) {
		from = lastIn.Ts
	}
	return wholeSeconds(contradiction.Ts.Sub(from))
}

// utcPtr normalises an optional timestamp to UTC without aliasing the caller's
// pointer, so a later mutation of the source row cannot rewrite the DTO.
func utcPtr(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	v := t.UTC()
	return &v
}

// diagnoseSession re-runs the analysis for a single session. Used by the apply
// path so a mutation can never outrun the evidence that justified it.
// Returns (nil, nil) when the session no longer has a supported repair.
func (h *DataRepairHandler) diagnoseSession(ctx context.Context, kind systemmodel.SessionRepairKind, id int64) (*systemmodel.SessionRepairSuggestion, error) {
	src := h.diagnosis
	if src == nil {
		return nil, fmt.Errorf("data-repair diagnosis: source not configured")
	}
	now := h.now()

	switch kind {
	case systemmodel.SessionRepairKindDrive:
		cand, err := src.GetDriveCandidate(ctx, id)
		if err != nil {
			return nil, err
		}
		if cand == nil {
			return nil, nil
		}
		return h.diagnoseDrive(ctx, *cand, now)
	case systemmodel.SessionRepairKindCharging:
		cand, err := src.GetChargingCandidate(ctx, id)
		if err != nil {
			return nil, err
		}
		if cand == nil {
			return nil, nil
		}
		return h.diagnoseCharging(ctx, *cand, now)
	default:
		return nil, fmt.Errorf("data-repair diagnosis: unknown session kind %q", kind)
	}
}
