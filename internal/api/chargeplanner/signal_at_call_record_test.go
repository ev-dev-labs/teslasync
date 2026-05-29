package chargeplanner

import "time"

// signalAtCallRecord captures one StateReader.SignalAt invocation's vehicleID,
// signal name, and time anchor for package api handler tests that assert
// forward-folded signal lookups without depending on call order.
type signalAtCallRecord struct {
	vehicleID int64
	name      string
	at        time.Time
}
