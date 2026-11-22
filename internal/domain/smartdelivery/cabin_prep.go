package smartdelivery

import "time"

type CabinPrepRef struct {
	Subject     string
	PlanID      int64
	VehicleID   int64
	DeviceID    int64
	DepartureAt time.Time
	ExpiresAt   time.Time
}
