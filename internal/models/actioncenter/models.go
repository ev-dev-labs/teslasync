// Package actioncenter contains Action Center persistence records.
package actioncenter

import "time"

type StateRecord struct {
	Subject          string     `db:"subject"               json:"-"`
	RecommendationID string     `db:"recommendation_id"     json:"recommendation_id"`
	Fingerprint      string     `db:"fingerprint"           json:"fingerprint"`
	State            string     `db:"state"                 json:"state"`
	SnoozedUntil     *time.Time `db:"snoozed_until"         json:"snoozed_until"`
	Version          int        `db:"version"               json:"version"`
	CreatedAt        time.Time  `db:"created_at"            json:"created_at"`
	UpdatedAt        time.Time  `db:"updated_at"            json:"updated_at"`
}

type ActionAuditRecord struct {
	ID               int64     `db:"id"                json:"id"`
	Subject          string    `db:"subject"           json:"-"`
	RecommendationID string    `db:"recommendation_id" json:"recommendation_id"`
	Fingerprint      string    `db:"fingerprint"       json:"fingerprint"`
	Action           string    `db:"action"            json:"action"`
	FromState        string    `db:"from_state"        json:"from_state"`
	ToState          string    `db:"to_state"          json:"to_state"`
	Outcome          string    `db:"outcome"           json:"outcome"`
	StateVersion     int       `db:"state_version"     json:"state_version"`
	OccurredAt       time.Time `db:"occurred_at"       json:"occurred_at"`
}
