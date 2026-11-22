package smartdelivery

import "time"

type ParkedClosureRef struct {
	Subject   string
	PlanID    int64
	VehicleID int64
	DeviceID  int64
	ParkID    int64
	OpenSince time.Time
	ExpiresAt time.Time
}
