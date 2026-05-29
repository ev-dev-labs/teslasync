package api

import "time"

// stateCallRecord captures one State() invocation's vehicleID + at for parent
// package handler tests that shared the helper before the drives carve.
type stateCallRecord struct {
	vehicleID int64
	at        time.Time
}
