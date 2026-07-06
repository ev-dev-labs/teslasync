package notification

import "encoding/json"

// NotificationLogGroup is a server-grouped bucket of notification_logs
// rows that share the same group_key (sha256(alert_id || severity)).
//
// Returned by the inbox listing endpoint when ?grouped=true. The
// frontend renders one row per group; expanding a group fetches its
// members via the flat listing endpoint with ?group_key=<hex>.
//
// GroupKey is nil for ungrouped singleton rows (e.g. test sends,
// ad-hoc notifications, or legacy rows captured before group_key was
// populated). In that case Count is 1 and Latest is the row itself.
//
// VehicleIDs is the distinct set of alert_rules.vehicle_id values
// across every member of the group. The slice may be empty when the
// underlying rules apply to all vehicles (alert_rules.vehicle_id is
// NULL) — never nil so the JSON payload is always a JSON array, never
// `null`, which simplifies the frontend's safeArray contract.
//
// Count and UnreadCount apply to the FILTERED set, not the global
// population: severity / vehicle / read filters narrow the rows that
// flow into the bucket. The frontend chip "(+N similar)" therefore
// reads "N more deliveries that match your current filters".
type NotificationLogGroup struct {
	GroupKey    *string          `json:"group_key,omitempty"`
	Latest      *NotificationLog `json:"latest"`
	Count       int              `json:"count"`
	UnreadCount int              `json:"unread_count"`
	VehicleIDs  []int64          `json:"vehicle_ids"`
}

// MarshalJSON enforces the VehicleIDs wire contract documented on the
// struct: the field is ALWAYS encoded as a JSON array, never `null`. The
// zero value (or any directly-constructed group) carries a nil VehicleIDs
// slice, which the stdlib would otherwise emit as `null` and break the
// frontend's safeArray assumption. Normalising here makes the invariant
// hold at the type boundary regardless of which producer built the value —
// complementing, not replacing, the repository's defensive fill.
//
// The `type alias` indirection strips the method set so json.Marshal falls
// back to default field encoding instead of recursing into this method.
func (g NotificationLogGroup) MarshalJSON() ([]byte, error) {
	type alias NotificationLogGroup
	a := alias(g)
	if a.VehicleIDs == nil {
		a.VehicleIDs = []int64{}
	}
	return json.Marshal(a)
}
