// Package subscriptionrenewal evaluates recorded renewal terms against local evidence.
package subscriptionrenewal

import (
	"math"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
)

const (
	ObservationDays = 30
	MaxObservations = 2_048
)

type Terms struct {
	RenewalDay string `json:"renewal_day"`
	TimeZone   string `json:"time_zone"`
	LeadDays   int    `json:"lead_days"`
}

type Window struct {
	OpensAt time.Time
	Expires time.Time
	From    time.Time
	Through time.Time
}

func (w Window) ObservationFrom(s domain.Subscription) time.Time {
	if !s.StartedAt.Before(w.Through) {
		return w.Through
	}
	if s.StartedAt.After(w.From) {
		return s.StartedAt
	}
	return w.From
}

func (t Terms) Window() (Window, bool) {
	if t.TimeZone == "" || t.TimeZone == "Local" || len(t.TimeZone) > 80 || t.LeadDays < 1 || t.LeadDays > 30 {
		return Window{}, false
	}
	loc, err := time.LoadLocation(t.TimeZone)
	if err != nil {
		return Window{}, false
	}
	renewal, err := time.ParseInLocation(time.DateOnly, t.RenewalDay, loc)
	if err != nil || renewal.Year() < 2000 || renewal.Format(time.DateOnly) != t.RenewalDay {
		return Window{}, false
	}
	through := renewal.AddDate(0, 0, -t.LeadDays)
	opensAt := time.Date(through.Year(), through.Month(), through.Day(), 9, 0, 0, 0, loc)
	return Window{OpensAt: opensAt, Expires: renewal, From: through.AddDate(0, 0, -ObservationDays), Through: through}, true
}

type Outcome string

const (
	Ready           Outcome = "ready"
	NotDue          Outcome = "not_due"
	Expired         Outcome = "expired"
	IneligibleTerms Outcome = "ineligible_terms"
)

func (w Window) Eligible(s domain.Subscription, now time.Time) Outcome {
	switch {
	case w.OpensAt.IsZero() || s.Kind != domain.SubscriptionRecurring ||
		s.BillingPeriod != domain.BillingMonthly && s.BillingPeriod != domain.BillingAnnual ||
		s.ID <= 0 || s.Version <= 0 || s.PriceMinor < 0 || !validCurrency(s.Currency) ||
		s.StartedAt.IsZero() || !s.StartedAt.Before(w.Expires) ||
		s.EndedAt != nil && !s.EndedAt.After(w.Expires):
		return IneligibleTerms
	case !now.Before(w.Expires):
		return Expired
	case now.Before(w.OpensAt) || now.Before(s.StartedAt):
		return NotDue
	default:
		return Ready
	}
}

func validCurrency(currency string) bool {
	if len(currency) != 3 {
		return false
	}
	for _, c := range currency {
		if c < 'A' || c > 'Z' {
			return false
		}
	}
	return true
}

type Observation struct {
	ID        int64
	StartedAt time.Time
	EndedAt   time.Time
	DistanceM *float64
}

type Coverage string

const (
	Observed    Coverage = "observed_only"
	NoEvidence  Coverage = "no_evidence"
	Unsupported Coverage = "not_measured"
	Uncertain   Coverage = "uncertain_coverage"
)

type Evidence struct {
	From         time.Time          `json:"from"`
	Through      time.Time          `json:"through"`
	Metric       domain.UsageMetric `json:"metric"`
	Quantity     *float64           `json:"quantity"`
	ObservedDays int                `json:"observed_days"`
	Excluded     int                `json:"excluded"`
	Coverage     Coverage           `json:"coverage"`
}

type Review struct {
	RenewalDay string               `json:"renewal_day"`
	ExpiresAt  time.Time            `json:"expires_at"`
	Name       string               `json:"name"`
	PriceMinor int64                `json:"price_minor"`
	Currency   string               `json:"currency"`
	Billing    domain.BillingPeriod `json:"billing_period"`
	Evidence   Evidence             `json:"evidence"`
}

func HasObservations(metric domain.UsageMetric) bool {
	return metric == domain.UsageDrivingDistance || metric == domain.UsageDriveCount || metric == domain.UsageChargingSessions
}

func (w Window) Evaluate(s domain.Subscription, now time.Time, rows []Observation) (*Review, Outcome) {
	outcome := w.Eligible(s, now)
	if outcome != Ready {
		return nil, outcome
	}
	review := &Review{
		RenewalDay: w.Expires.Format(time.DateOnly), ExpiresAt: w.Expires, Name: s.Name,
		PriceMinor: s.PriceMinor, Currency: s.Currency, Billing: s.BillingPeriod,
		Evidence: Evidence{From: w.ObservationFrom(s), Through: w.Through, Metric: s.UsageMetric, Coverage: Unsupported},
	}
	if !HasObservations(s.UsageMetric) {
		return review, Ready
	}
	e := &review.Evidence
	e.Coverage = NoEvidence
	if !e.From.Before(e.Through) {
		return review, Ready
	}
	if len(rows) > MaxObservations {
		e.Coverage = Uncertain
		return review, Ready
	}
	seen := make(map[int64]struct{}, len(rows))
	days := make(map[string]struct{})
	var total float64
	for _, row := range rows {
		if _, exists := seen[row.ID]; exists || row.ID <= 0 || row.StartedAt.Before(e.From) ||
			!row.StartedAt.Before(e.Through) || !row.EndedAt.After(row.StartedAt) || row.EndedAt.After(e.Through) {
			e.Coverage, e.Excluded = Uncertain, 0
			return review, Ready
		}
		seen[row.ID] = struct{}{}
		quantity := 1.0
		if s.UsageMetric == domain.UsageDrivingDistance {
			if row.DistanceM == nil || math.IsNaN(*row.DistanceM) || *row.DistanceM < 0 || *row.DistanceM > 10_000_000 {
				e.Excluded++
				continue
			}
			quantity = *row.DistanceM
		}
		total += quantity
		days[row.StartedAt.In(e.Through.Location()).Format(time.DateOnly)] = struct{}{}
	}
	if len(days) > 0 {
		e.Coverage, e.Quantity, e.ObservedDays = Observed, &total, len(days)
	}
	return review, Ready
}
