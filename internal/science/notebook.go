package science

import (
	"fmt"
	"time"
)

// NewEntry builds a notebook row with the required method fields. n and
// honesty are mandatory: zero-value callers get unknown=true rather than
// a claim without evidence.
func NewEntry(id, domain, hypothesis string, vehicleID int64, vin string, start, end time.Time, epoch string, n int, method string) NotebookEntry {
	return NotebookEntry{
		ID:            id,
		Domain:        domain,
		Hypothesis:    hypothesis,
		VehicleID:     vehicleID,
		VIN:           vin,
		Start:         start.UTC(),
		End:           end.UTC(),
		FirmwareEpoch: epoch,
		N:             n,
		Method:        method,
		CIMethod:      CINone,
		SignalsUsed:   []string{},
		Unknown:       n <= 0,
		Honesty:       NotebookHonesty,
	}
}

// EntryID derives a stable row id from domain + window.
func EntryID(domain string, vehicleID int64, start time.Time) string {
	return fmt.Sprintf("%s:%d:%s", domain, vehicleID, start.UTC().Format("20060102T150405"))
}
