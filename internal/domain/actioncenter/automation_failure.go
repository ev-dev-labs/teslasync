package actioncenter

import "time"

const AutomationFailureWindow = 24 * time.Hour

type AutomationFailureGroup struct {
	AutomationID int64
	Name         string
	HistoryID    int64
	VehicleID    *int64
	FailureCount int64
	FirstEndedAt time.Time
	LastEndedAt  time.Time
}

type AutomationFailureEvidence struct {
	Name         string `json:"name"`
	FailureCount int64  `json:"failure_count"`
}
