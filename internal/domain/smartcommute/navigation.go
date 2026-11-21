package smartcommute

type NavigationOutcome string

const (
	NavigationAccepted       NavigationOutcome = "accepted"
	NavigationRejected       NavigationOutcome = "rejected"
	NavigationUnknown        NavigationOutcome = "delivery_unknown"
	NavigationExpired        NavigationOutcome = "expired"
	NavigationNotSent        NavigationOutcome = "not_sent"
	NavigationWakeRequired   NavigationOutcome = "wake_required"
	NavigationWakePermission NavigationOutcome = "wake_permission_required"
)

type NavigationRequest struct {
	VehicleID     int64  `json:"vehicle_id"`
	OccurrenceID  string `json:"occurrence_id"`
	Address       string `json:"address"`
	Confirmed     bool   `json:"confirmed"`
	WakeConfirmed bool   `json:"wake_confirmed"`
}

type NavigationResult struct {
	Outcome NavigationOutcome `json:"outcome"`
}
