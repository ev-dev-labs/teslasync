package smartdelivery

import "time"

type ParkReserveRef struct {
	Subject   string
	PlanID    int64
	VehicleID int64
	DeviceID  int64
	ReturnAt  time.Time
	ExpiresAt time.Time
}
