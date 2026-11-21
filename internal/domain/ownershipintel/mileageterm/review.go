package mileageterm

import "time"

type Settings struct {
	ID         int64   `json:"id"`
	TimeZone   string  `json:"time_zone"`
	FirstDay   string  `json:"first_day"`
	EndDay     string  `json:"end_day"`
	OpeningM   float64 `json:"opening_odometer_m"`
	AllowanceM float64 `json:"allowance_m"`
	MinimumM   float64 `json:"minimum_overage_m"`
	Paused     bool    `json:"paused"`
}

func (s Settings) Term() (Term, bool) {
	if s.ID < 0 || s.Paused && s.ID == 0 || s.TimeZone == "" || s.TimeZone == "Local" || len(s.TimeZone) > 80 {
		return Term{}, false
	}
	loc, err := time.LoadLocation(s.TimeZone)
	if err != nil {
		return Term{}, false
	}
	first, firstErr := time.ParseInLocation(time.DateOnly, s.FirstDay, loc)
	end, endErr := time.ParseInLocation(time.DateOnly, s.EndDay, loc)
	term := Term{Start: first, End: end, OpeningM: s.OpeningM, AllowanceM: s.AllowanceM, MinimumM: s.MinimumM}
	return term, firstErr == nil && endErr == nil &&
		first.Format(time.DateOnly) == s.FirstDay && end.Format(time.DateOnly) == s.EndDay &&
		first.Hour() == 0 && end.Hour() == 0 && term.Valid()
}

type Digest struct {
	Through    time.Time  `json:"through"`
	CheckedAt  time.Time  `json:"checked_at"`
	ExpiresAt  time.Time  `json:"expires_at"`
	Projection Projection `json:"projection"`
}

type Review struct {
	Settings      *Settings  `json:"settings"`
	Digest        *Digest    `json:"digest"`
	LastCheckedAt *time.Time `json:"last_checked_at"`
	NextCheckAt   *time.Time `json:"next_check_at"`
}
