package fleetstatesvc

// Server-derived Fleet Posture summary.
//
// The SPA used to walk every item and re-derive the posture totals in the
// browser. That is not merely duplicated work: the browser's trust rules and
// the server's could drift, and the panel would then confidently disagree with
// the very list it was summarising. Deriving the totals here — from the SAME
// items, the SAME request-level `now` and the SAME precedence — makes that
// class of bug unrepresentable, and lets the panel paint on first frame.
//
// Precedence (identical to the per-item metadata a client would apply):
//
//	1. verified is_charging AND is_charging == true → charging
//	2. verified speed AND speed > 0                 → driving
//	3. verified state                               → that FSM state
//	4. otherwise                                    → no claim (attention)
//
// "verified" means the item's live stream is FRESH at the request-level `now`
// AND the deciding field is in verified_fields, i.e. its winning value came
// from a real, timestamped, non-synthetic observation. A stale, unknown,
// missing or failed item can never produce an operational claim — most
// importantly it can never produce `offline`.

import (
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/service"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// Fields whose verified status decides an operational claim. Kept as
// constants so the summary and the wire contract cannot drift.
const (
	fieldIsCharging = "is_charging"
	fieldSpeed      = "speed"
	fieldState      = "state"
)

// EvidenceOutcome is the bounded per-vehicle trust classification used by
// Fleet Posture and HTTP-boundary observability.
type EvidenceOutcome string

const (
	EvidenceVerified   EvidenceOutcome = "verified"
	EvidenceUnverified EvidenceOutcome = "unverified"
	EvidenceStale      EvidenceOutcome = "stale"
	EvidenceUnknown    EvidenceOutcome = "unknown"
	EvidenceMissing    EvidenceOutcome = "missing"
	EvidenceFailed     EvidenceOutcome = "failed"
)

// summarise rolls a resolved page up into the Fleet Posture summary.
//
// `now` is the request-level instant — the same one every item was classified
// against — so the summary and the items cannot disagree about freshness.
func summarise(items []VehicleStateItem, now time.Time) Summary {
	summary := Summary{Counted: len(items)}

	for i := range items {
		item := &items[i]

		if observed := item.ObservedAt; observed != nil {
			at := observed.UTC()
			summary.ObservedCount++
			if summary.OldestObservedAt == nil || at.Before(*summary.OldestObservedAt) {
				oldest := at
				summary.OldestObservedAt = &oldest
			}
			if summary.NewestObservedAt == nil || at.After(*summary.NewestObservedAt) {
				newest := at
				summary.NewestObservedAt = &newest
			}
		}

		evidence := EvidenceOutcomeFor(item, now)
		switch evidence {
		case EvidenceMissing:
			summary.Attention.Missing++
			continue
		case EvidenceFailed:
			summary.Attention.Failed++
			continue
		case EvidenceUnverified:
			summary.Attention.Unverified++
			continue
		case EvidenceStale:
			summary.Attention.Stale++
			continue
		case EvidenceUnknown:
			summary.Attention.Unknown++
			continue
		}

		status, trusted := trustedStatus(item, now)
		if !trusted {
			// EvidenceOutcomeFor and trustedStatus share the same trust
			// predicate. Keep the invariant defensive if either evolves.
			summary.Attention.Unverified++
			continue
		}

		summary.VerifiedCount++
		switch status {
		case enums.StateCharging:
			summary.Operational.Charging++
		case enums.StateDriving:
			summary.Operational.Driving++
		case enums.StateParked:
			summary.Operational.Parked++
		case enums.StateAsleep:
			summary.Operational.Asleep++
		case enums.StateOnline:
			summary.Operational.Online++
		case enums.StateOffline:
			summary.Operational.Offline++
		default:
			// A trusted state outside the FSM vocabulary. Counted so the
			// taxonomy invariant holds rather than silently dropped.
			summary.Operational.Other++
		}
	}

	summary.AttentionCount = summary.Counted - summary.VerifiedCount
	return summary
}

// EvidenceOutcomeFor classifies one item without exposing vehicle identity as
// a metric label. It is exported so the HTTP boundary can publish per-vehicle
// transition metrics from the exact same trust rules as the server summary.
func EvidenceOutcomeFor(item *VehicleStateItem, now time.Time) EvidenceOutcome {
	if item == nil {
		return EvidenceFailed
	}
	switch item.Outcome {
	case OutcomeMissing:
		return EvidenceMissing
	case OutcomeResolved:
		// Continue below.
	default:
		return EvidenceFailed
	}
	if item.State == nil {
		return EvidenceMissing
	}
	if _, trusted := trustedStatus(item, now); trusted {
		return EvidenceVerified
	}
	if isFreshObservation(item, now) {
		return EvidenceUnverified
	}
	if item.ObservedAt != nil {
		return EvidenceStale
	}
	return EvidenceUnknown
}

// trustedStatus applies the operational precedence to ONE resolved item and
// reports whether a claim is defensible at all.
//
// Freshness is re-checked against the REQUEST-LEVEL `now` — the same instant
// the item itself was classified against — rather than trusted from the
// item's label alone. The two can only agree, and requiring both makes it
// impossible for a summary to promote an item the payload calls stale.
func trustedStatus(item *VehicleStateItem, now time.Time) (string, bool) {
	if !isFreshObservation(item, now) {
		// Old or unknown evidence backs no operational claim.
		return "", false
	}
	verified := verifiedSet(item.VerifiedFields)

	if verified[fieldIsCharging] && item.State.IsCharging {
		return enums.StateCharging, true
	}
	if verified[fieldSpeed] && item.State.Speed > 0 {
		return enums.StateDriving, true
	}
	if !verified[fieldState] {
		return "", false
	}
	state := strings.ToLower(strings.TrimSpace(item.State.State))
	if state == "" {
		return "", false
	}
	return state, true
}

// isFreshObservation reports whether an item carries a REAL observation that
// is still inside the cross-pod freshness window at `now`. It requires the
// backend's own freshness verdict AND an observation instant that still holds
// at the request-level instant.
func isFreshObservation(item *VehicleStateItem, now time.Time) bool {
	if item == nil || item.State == nil {
		return false
	}
	if item.Freshness != string(service.FreshnessFresh) {
		return false
	}
	if item.ObservedAt == nil {
		return false
	}
	return signal.IsLiveSignalFresh(&signal.Value{Timestamp: *item.ObservedAt}, now)
}

func verifiedSet(fields []string) map[string]bool {
	if len(fields) == 0 {
		return nil
	}
	set := make(map[string]bool, len(fields))
	for _, field := range fields {
		set[field] = true
	}
	return set
}
