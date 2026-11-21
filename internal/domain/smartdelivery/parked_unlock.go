package smartdelivery

import "time"

type ParkedUnlockRef struct {
	Subject       string
	PlanID        int64
	VehicleID     int64
	DeviceID      int64
	ParkID        int64
	UnlockedSince time.Time
	ExpiresAt     time.Time
}
