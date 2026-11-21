package costtrend

import "time"

type Settings struct {
	ID                  int64  `json:"id"`
	TimeZone            string `json:"time_zone"`
	Currency            string `json:"currency"`
	MaterialChangeMinor int64  `json:"material_change_minor"`
	Paused              bool   `json:"paused"`
}

type Digest struct {
	PriorFrom   time.Time   `json:"prior_from"`
	CurrentFrom time.Time   `json:"current_from"`
	Through     time.Time   `json:"through"`
	CheckedAt   time.Time   `json:"checked_at"`
	ExpiresAt   time.Time   `json:"expires_at"`
	Attribution Attribution `json:"attribution"`
}

type Review struct {
	Settings      *Settings  `json:"settings,omitempty"`
	LastCheckedAt *time.Time `json:"last_checked_at,omitempty"`
	Digest        *Digest    `json:"digest,omitempty"`
}
