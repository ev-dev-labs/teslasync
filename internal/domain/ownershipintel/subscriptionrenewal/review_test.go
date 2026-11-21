package subscriptionrenewal

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
)

func termsFixture(t *testing.T) (Window, domain.Subscription) {
	t.Helper()
	window, ok := (Terms{RenewalDay: "2026-03-16", TimeZone: "America/New_York", LeadDays: 7}).Window()
	if !ok {
		t.Fatal("invalid fixture time zone or date")
	}
	return window, domain.Subscription{
		ID: 81, Version: 2, Name: "Synthetic subscription", PriceMinor: 1337, Currency: "USD",
		Kind: domain.SubscriptionRecurring, BillingPeriod: domain.BillingMonthly, UsageMetric: domain.UsageDrivingDistance,
		StartedAt: window.From.AddDate(0, 0, -1),
	}
}

func TestReviewUsesRecordedRenewalAndOnlyObservedUsage(t *testing.T) {
	window, subscription := termsFixture(t)
	if got := window.OpensAt.UTC().Format(time.RFC3339); got != "2026-03-09T13:00:00Z" {
		t.Fatalf("local review starts at %s", got)
	}
	if got := window.Through.Sub(window.From); got != 719*time.Hour {
		t.Fatalf("expected 30 local days across DST, got %v", got)
	}
	a, b := 15_000.0, 25_500.0
	first := window.From.Add(time.Hour)
	next := first.AddDate(0, 0, 12)
	rows := []Observation{
		{ID: 1, StartedAt: first, EndedAt: first.Add(30 * time.Minute), DistanceM: &a},
		{ID: 2, StartedAt: next, EndedAt: next.Add(30 * time.Minute), DistanceM: &b},
		{ID: 3, StartedAt: next.Add(time.Hour), EndedAt: next.Add(2 * time.Hour)},
	}
	review, result := window.Evaluate(subscription, window.OpensAt, rows)
	if result != Ready || review == nil || review.RenewalDay != "2026-03-16" || review.PriceMinor != 1337 ||
		review.Currency != "USD" || review.Evidence.Coverage != Observed || review.Evidence.ObservedDays != 2 ||
		review.Evidence.Excluded != 1 || review.Evidence.Quantity == nil || *review.Evidence.Quantity != 40_500 {
		t.Fatalf("review did not reflect the recorded terms and measured distance: %+v %s", review, result)
	}
}

func TestReviewStaysQuietBeforeReleaseAfterRenewalAndForInactivePlans(t *testing.T) {
	window, subscription := termsFixture(t)
	done := window.Expires
	for _, check := range []struct {
		name string
		now  time.Time
		edit func(*domain.Subscription)
		want Outcome
	}{
		{"not due", window.OpensAt.Add(-time.Nanosecond), func(_ *domain.Subscription) {}, NotDue},
		{"renewal day", done, func(_ *domain.Subscription) {}, Expired},
		{"ended at renewal", window.OpensAt, func(s *domain.Subscription) { s.EndedAt = &done }, IneligibleTerms},
		{"one-time purchase", window.OpensAt, func(s *domain.Subscription) { s.Kind = domain.SubscriptionOneTime }, IneligibleTerms},
		{"no recorded baseline", window.OpensAt, func(s *domain.Subscription) { s.StartedAt = time.Time{} }, IneligibleTerms},
	} {
		t.Run(check.name, func(t *testing.T) {
			s := subscription
			check.edit(&s)
			if review, got := window.Evaluate(s, check.now, nil); review != nil || got != check.want {
				t.Fatalf("got %+v %s, want no card and %s", review, got, check.want)
			}
		})
	}
}

func TestReviewDoesNotTurnMissingOrAmbiguousUsageIntoZero(t *testing.T) {
	window, subscription := termsFixture(t)
	first := window.From
	row := Observation{ID: 1, StartedAt: first, EndedAt: first.Add(time.Hour)}
	for _, tc := range []struct {
		name string
		rows []Observation
		want Coverage
	}{
		{"missing distance", []Observation{row}, NoEvidence},
		{"duplicate source row", []Observation{row, row}, Uncertain},
		{"truncated history", make([]Observation, MaxObservations+1), Uncertain},
	} {
		t.Run(tc.name, func(t *testing.T) {
			review, result := window.Evaluate(subscription, window.OpensAt, tc.rows)
			if result != Ready || review == nil || review.Evidence.Coverage != tc.want || review.Evidence.Quantity != nil {
				t.Fatalf("unqualified evidence became usage: %+v %s", review, result)
			}
		})
	}
}
