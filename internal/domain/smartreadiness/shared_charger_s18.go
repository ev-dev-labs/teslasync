package smartreadiness

import "time"

type SharedChargerRef struct {
	ID       int64
	Revision int64
}

type SharedChargerParticipant struct {
	VehicleID int64
	Subject   string
}

type SharedChargerAuthorization struct {
	PlaceID           int64
	PlaceUpdatedAt    time.Time
	Participants      [2]SharedChargerParticipant
	ReminderVehicleID int64 // Zero means neither participant was offered a reminder.
	ExpiresAt         time.Time
}

type SharedChargerInvitation struct {
	Ref             SharedChargerRef
	VehicleID       int64
	PlaceID         int64
	PlaceUpdatedAt  time.Time
	ExpiresAt       time.Time
	ReminderOffered bool
	Confirmed       bool
}

type SharedChargerConfirmation struct {
	Request        SharedChargerRequest
	ConfirmedAt    time.Time
	AcceptReminder bool
}

// SharedChargerConfirmedPlan is internal evidence, not the participant-facing card.
type SharedChargerConfirmedPlan struct {
	Ref               SharedChargerRef
	PlaceID           int64
	ExpiresAt         time.Time
	ReminderVehicleID int64
	Confirmations     [2]SharedChargerConfirmation
}

type SharedChargerCard struct {
	Ref         SharedChargerRef
	PlaceID     int64
	Schedule    SharedChargerSchedule
	EvaluatedAt time.Time
	ExpiresAt   time.Time
}

type SharedChargerReminder struct {
	Ref       SharedChargerRef
	VehicleID int64
	SwapAt    time.Time
	ExpiresAt time.Time
}

// CardAt anchors the advisory slots to the last confirmation so reloading the
// card does not move the swap or imply an updated observation.
func (p SharedChargerConfirmedPlan) CardAt(now time.Time) *SharedChargerCard {
	a, b := p.Confirmations[0], p.Confirmations[1]
	if a.ConfirmedAt.IsZero() || b.ConfirmedAt.IsZero() || !now.Before(p.ExpiresAt) {
		return nil
	}
	evaluatedAt := a.ConfirmedAt
	if b.ConfirmedAt.After(evaluatedAt) {
		evaluatedAt = b.ConfirmedAt
	}
	if evaluatedAt.After(now) {
		return nil
	}
	schedule := PlanSharedCharger(evaluatedAt, a.Request, b.Request)
	if schedule == nil || !now.Before(schedule.Second.StartsAt) {
		return nil
	}
	expiresAt := p.ExpiresAt
	if schedule.Second.StartsAt.Before(expiresAt) {
		expiresAt = schedule.Second.StartsAt
	}
	return &SharedChargerCard{
		Ref: p.Ref, PlaceID: p.PlaceID, Schedule: *schedule,
		EvaluatedAt: evaluatedAt.UTC(), ExpiresAt: expiresAt.UTC(),
	}
}

func (p SharedChargerConfirmedPlan) ReminderFor(card *SharedChargerCard) *SharedChargerReminder {
	if card == nil || card.Ref != p.Ref || p.ReminderVehicleID <= 0 {
		return nil
	}
	for _, c := range p.Confirmations {
		if c.Request.VehicleID == p.ReminderVehicleID && c.AcceptReminder {
			// A reminder after the manual handoff window is not actionable,
			// even if the second vehicle is not due to start until later.
			expiresAt := card.Schedule.SwapAt.Add(sharedChargerSwapBuffer)
			if card.ExpiresAt.Before(expiresAt) {
				expiresAt = card.ExpiresAt
			}
			if card.Schedule.SwapAt.Before(expiresAt) {
				return &SharedChargerReminder{
					Ref: p.Ref, VehicleID: p.ReminderVehicleID, SwapAt: card.Schedule.SwapAt, ExpiresAt: expiresAt,
				}
			}
		}
	}
	return nil
}
