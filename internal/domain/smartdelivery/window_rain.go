package smartdelivery

import "time"

type WindowRainRef struct {
	Subject   string
	PlanID    int64
	VehicleID int64
	DeviceID  int64
	ExpiresAt time.Time
}
