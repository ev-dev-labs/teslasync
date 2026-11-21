package smartreadinesssvc

import (
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	minClosureGrace = 5 * time.Minute
	maxClosureGrace = 20 * time.Minute
	closureParkAge  = 30 * time.Minute
)

var closurePositions = [...]struct {
	field    string
	position domain.ParkedClosurePosition
}{
	{"DoorStateDriverFront", domain.ClosureDriverFront},
	{"DoorStatePassengerFront", domain.ClosurePassengerFront},
	{"DoorStateDriverRear", domain.ClosureDriverRear},
	{"DoorStatePassengerRear", domain.ClosurePassengerRear},
	{"DoorStateFrontTrunk", domain.ClosureFrontTrunk},
	{"DoorStateRearTrunk", domain.ClosureRearTrunk},
}

var closureActivityFields = [...]string{"ServiceMode", "DriverSeatOccupied"}

type closureSample struct {
	at    time.Time
	state [len(closurePositions)]bool
}

func parkedClosureRisk(
	values map[string]*signal.Value, rows []signal.TimelineRow, parkAt, after, now time.Time, grace time.Duration,
) (*domain.ParkedClosureRisk, domain.ParkedClosureReason) {
	firstAllowed := maxClosureTime(parkAt, after)
	if parkAt.IsZero() || parkAt.After(now) || now.Sub(parkAt) >= closureParkAge ||
		firstAllowed.After(now) || grace < minClosureGrace || grace > maxClosureGrace {
		return nil, domain.ClosureUnknown
	}
	live, legalUntil, reason := currentClosureSample(values, now)
	if reason != "" {
		return nil, reason
	}
	if live.at.Before(firstAllowed) {
		return nil, domain.ClosureUnknown
	}
	var since, gearAt time.Time
	var last closureSample
	var active [len(closureActivityFields)]bool
	var inactiveAt [len(closureActivityFields)]time.Time
	for _, row := range rows {
		if row.Timestamp.Before(firstAllowed) || row.Timestamp.After(now) {
			continue
		}
		validReceipt := row.ReceivedAt != nil && !row.ReceivedAt.After(now) &&
			absDuration(row.ReceivedAt.Sub(row.Timestamp)) <= signal.LiveSignalFreshnessThreshold
		coverageBroken := false
		if row.ObservedAt["Gear"].Equal(row.Timestamp) {
			if !validReceipt || row.Fields["Gear"] != enums.GearPark {
				return nil, domain.ClosureUnknown
			}
			coverageBroken = !recentClosureEvidence(gearAt, row.Timestamp)
			gearAt = row.Timestamp
		}
		for i, name := range closureActivityFields {
			if row.ObservedAt[name].Equal(row.Timestamp) {
				inUse := !validReceipt || row.Fields[name] != false
				coverageBroken = coverageBroken || active[i] != inUse ||
					(!inUse && !recentClosureEvidence(inactiveAt[i], row.Timestamp))
				active[i] = inUse
				if inUse {
					inactiveAt[i] = time.Time{}
				} else {
					inactiveAt[i] = row.Timestamp
				}
			}
		}
		sample, count := closureTimelineSample(row)
		coherent := validReceipt && count == len(closurePositions) && recentClosureEvidence(gearAt, row.Timestamp)
		for _, at := range inactiveAt {
			coherent = coherent && recentClosureEvidence(at, row.Timestamp)
		}
		if coverageBroken || (count != 0 && !coherent) {
			since, last = time.Time{}, closureSample{}
			firstAllowed = maxClosureTime(firstAllowed, row.Timestamp)
		}
		if !coherent {
			continue
		}
		if sample.at.After(live.at) || (!last.at.IsZero() && sample.at.Before(last.at)) {
			return nil, domain.ClosureUnknown
		}
		since, last = observeClosureSample(since, last, sample)
	}
	if active[0] || active[1] || live.at.Before(firstAllowed) {
		return nil, domain.ClosureActive
	}
	legalUntil = minTime(legalUntil, parkAt.Add(closureParkAge))
	if since.IsZero() || last.at.Sub(since) < grace || !recentClosureEvidence(last.at, live.at) ||
		live.state != last.state || !legalUntil.After(now) {
		return nil, domain.ClosureGrace
	}
	for i, open := range live.state {
		if open {
			return &domain.ParkedClosureRisk{
				Position: closurePositions[i].position, ParkedAt: parkAt, OpenSince: since,
				LastObserved: live.at, ActionUntil: legalUntil,
			}, domain.ClosureAtRisk
		}
	}
	return nil, domain.ClosureClosed
}

func recentClosureEvidence(at, now time.Time) bool {
	return !at.IsZero() && !at.After(now) && now.Sub(at) < signal.LiveSignalFreshnessThreshold
}

func currentClosureSample(values map[string]*signal.Value, now time.Time) (closureSample, time.Time, domain.ParkedClosureReason) {
	var sample closureSample
	gear := values["Gear"]
	if !freshObservation(gear, now) || gear.Raw != enums.GearPark {
		return sample, time.Time{}, domain.ClosureUnknown
	}
	oldest := gear.Timestamp
	for _, name := range closureActivityFields {
		value := values[name]
		if !freshObservation(value, now) {
			return sample, time.Time{}, domain.ClosureUnknown
		}
		active, ok := value.Raw.(bool)
		if !ok {
			return sample, time.Time{}, domain.ClosureUnknown
		}
		if active {
			return sample, time.Time{}, domain.ClosureActive
		}
		oldest = minTime(oldest, value.Timestamp)
	}
	openCount := 0
	for i, closure := range closurePositions {
		value := values[closure.field]
		if !freshObservation(value, now) || (i > 0 && !value.Timestamp.Equal(sample.at)) {
			return closureSample{}, time.Time{}, domain.ClosureUnknown
		}
		open, ok := value.Raw.(bool)
		if !ok {
			return closureSample{}, time.Time{}, domain.ClosureUnknown
		}
		sample.state[i], sample.at = open, value.Timestamp
		if open {
			openCount++
		}
	}
	if openCount == 0 {
		return sample, time.Time{}, domain.ClosureClosed
	}
	return sample, minTime(oldest, sample.at).Add(signal.LiveSignalFreshnessThreshold), ""
}

func closureTimelineSample(row signal.TimelineRow) (closureSample, int) {
	sample := closureSample{at: row.Timestamp}
	count := 0
	for i, closure := range closurePositions {
		if !row.ObservedAt[closure.field].Equal(row.Timestamp) {
			continue
		}
		open, ok := row.Fields[closure.field].(bool)
		if !ok {
			return sample, -1
		}
		sample.state[i] = open
		count++
	}
	return sample, count
}

func observeClosureSample(since time.Time, prior, next closureSample) (time.Time, closureSample) {
	// Any closure change may be loading. A gap cannot prove that a closure stayed open.
	if prior.at.IsZero() || next.at.Sub(prior.at) >= signal.LiveSignalFreshnessThreshold || prior.state != next.state {
		since = next.at
	}
	return since, next
}

func maxClosureTime(a, b time.Time) time.Time {
	if b.After(a) {
		return b
	}
	return a
}
