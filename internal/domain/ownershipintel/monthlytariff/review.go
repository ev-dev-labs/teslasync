package monthlytariff

import (
	"math"
	"time"
)

type Settings struct {
	ID                 int64     `json:"id"`
	SiteID             int64     `json:"site_id"`
	SiteRevision       time.Time `json:"site_revision"`
	CurrentTariffID    int64     `json:"current_tariff_id"`
	CurrentVersion     int       `json:"current_version"`
	AlternativeID      int64     `json:"alternative_tariff_id"`
	AlternativeVersion int       `json:"alternative_version"`
	TimeZone           string    `json:"time_zone"`
	MinimumMinor       int64     `json:"minimum_savings_minor"`
	SwitchFeeMinor     int64     `json:"switch_fee_minor"`
	Paused             bool      `json:"paused"`
}

func (s Settings) Valid() bool {
	return s.ID >= 0 && (s.ID != 0 || !s.Paused) && s.SiteID > 0 && !s.SiteRevision.IsZero() &&
		s.CurrentTariffID > 0 && s.AlternativeID > 0 && s.AlternativeID != s.CurrentTariffID &&
		s.CurrentVersion > 0 && s.CurrentVersion <= math.MaxInt32 &&
		s.AlternativeVersion > 0 && s.AlternativeVersion <= math.MaxInt32 &&
		s.MinimumMinor > 0 && s.MinimumMinor <= maxFeeMinor && s.SwitchFeeMinor >= 0 && s.SwitchFeeMinor <= maxFeeMinor
}

type Digest struct {
	From       time.Time  `json:"from"`
	Through    time.Time  `json:"through"`
	CheckedAt  time.Time  `json:"checked_at"`
	ExpiresAt  time.Time  `json:"expires_at"`
	Comparison Comparison `json:"comparison"`
}

type Review struct {
	Settings        *Settings  `json:"settings,omitempty"`
	LastCheckedAt   *time.Time `json:"last_checked_at,omitempty"`
	Currency        string     `json:"currency,omitempty"`
	SiteName        string     `json:"site_name,omitempty"`
	CurrentName     string     `json:"current_name,omitempty"`
	AlternativeName string     `json:"alternative_name,omitempty"`
	NeedsReview     bool       `json:"needs_review"`
	Digest          *Digest    `json:"digest,omitempty"`
}
