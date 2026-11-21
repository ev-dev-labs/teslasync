package smartreadiness

import "time"

const MaxSharedTripVehicles = 16

type SharedTrip struct {
	ID          int64
	Revision    int64
	DepartureAt time.Time
}

type SharedTripDraft struct {
	SharedTrip
	Nominations []SharedTripNomination
}

// SharedTripNomination is an operator-issued grant for one exact subject and
// vehicle. It does not consent to participation on the subject's behalf.
type SharedTripNomination struct {
	VehicleID int64
	Subject   string
}

type SharedTripEntryKey struct {
	TripID       int64
	Revision     int64
	VehicleID    int64
	EntryVersion int64
}

// SharedTripInvitation is safe to show to the nominated subject only.
type SharedTripInvitation struct {
	SharedTripEntryKey
	DepartureAt      time.Time
	ConsentExpiresAt *time.Time
}

// SharedTripConfirmationInput requires explicit assertions, including false
// clearances; omission must not become a zero estimate or an accepted invite.
type SharedTripConfirmationInput struct {
	TripUseLowPct    *float64
	TripUseHighPct   *float64
	ReservePct       *float64
	ScheduleClear    *bool
	MaintenanceClear *bool
}

// SharedTripConfirmation contains only trip-scoped assertions, never itinerary
// or service records. The service, not the client, sets the evidence times.
type SharedTripConfirmation struct {
	TripUseLowPct    float64
	TripUseHighPct   float64
	ReservePct       float64
	ScheduleClear    bool
	MaintenanceClear bool
	ConfirmedAt      time.Time
	ExpiresAt        time.Time
}

type SharedTripConfirmedVehicle struct {
	VehicleID    int64
	EntryVersion int64
	SharedTripConfirmation
}

// SharedTripComparison only represents currently eligible options. Re-read
// after expiry or a consent change; this is not a reservation or guarantee.
type SharedTripComparison struct {
	SharedTrip
	ExpiresAt time.Time
	Options   []SharedTripVehicleOption
}
