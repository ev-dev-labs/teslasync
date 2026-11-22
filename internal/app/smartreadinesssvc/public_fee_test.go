package smartreadinesssvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestPublicFeeRequiresApplicableTermsAndStillConnectedAfterCompletion(t *testing.T) {
	now := time.Date(2026, 4, 7, 18, 30, 0, 0, time.UTC)
	for _, tt := range []struct {
		name   string
		change func(*domain.PublicFeeTerms, *domain.PublicChargeCompletion, map[string]*signal.Value)
	}{
		{name: "verified reviewed session"},
		{name: "operator terms depend on current occupancy", change: func(p *domain.PublicFeeTerms, _ *domain.PublicChargeCompletion, _ map[string]*signal.Value) {
			p.ConfirmedUnconditional = false
		}},
		{name: "expired operator terms", change: func(p *domain.PublicFeeTerms, _ *domain.PublicChargeCompletion, _ map[string]*signal.Value) {
			p.ValidUntil = now
		}},
		{name: "source contains a private fragment", change: func(p *domain.PublicFeeTerms, _ *domain.PublicChargeCompletion, _ map[string]*signal.Value) {
			p.SourceURL += "#account"
		}},
		{name: "operator terms do not cover another site", change: func(_ *domain.PublicFeeTerms, c *domain.PublicChargeCompletion, _ map[string]*signal.Value) {
			c.PlaceID++
		}},
		{name: "operator terms do not cover another vehicle", change: func(_ *domain.PublicFeeTerms, c *domain.PublicChargeCompletion, _ map[string]*signal.Value) {
			c.VehicleID++
		}},
		{name: "no charging transition observed", change: func(_ *domain.PublicFeeTerms, c *domain.PublicChargeCompletion, _ map[string]*signal.Value) {
			c.ChargingAt = time.Time{}
		}},
		{name: "vehicle disconnected after completion", change: func(_ *domain.PublicFeeTerms, _ *domain.PublicChargeCompletion, v map[string]*signal.Value) {
			v["ChargePortLatch"].Raw = "Disengaged"
		}},
		{name: "latch has not been observed after completion", change: func(_ *domain.PublicFeeTerms, c *domain.PublicChargeCompletion, v map[string]*signal.Value) {
			v["ChargePortLatch"].Timestamp = c.CompletedAt.Add(-time.Second)
		}},
		{name: "vehicle resumed charging", change: func(_ *domain.PublicFeeTerms, _ *domain.PublicChargeCompletion, v map[string]*signal.Value) {
			v["DetailedChargeState"].Raw = "Charging"
		}},
		{name: "vehicle is no longer at the charge point", change: func(_ *domain.PublicFeeTerms, _ *domain.PublicChargeCompletion, v map[string]*signal.Value) {
			v["LocationLongitude"].Raw = -122.5
		}},
		{name: "no time to avoid the fee", change: func(p *domain.PublicFeeTerms, c *domain.PublicChargeCompletion, _ map[string]*signal.Value) {
			p.GraceS = 150
			c.ChargingAt = now.Add(-90 * time.Second)
			c.CompletedAt = now.Add(-30 * time.Second)
		}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			terms := domain.PublicFeeTerms{
				ConfirmedUnconditional: true, VehicleID: 42, PlaceID: 17, Subject: "synthetic-fee-owner",
				Currency: "USD", FeePerMinuteMinor: 40, GraceS: 600, SourceURL: "https://example.test/charging/terms",
				PlaceUpdatedAt: now.Add(-48 * time.Hour), ConfirmedAt: now.Add(-time.Hour), ValidUntil: now.Add(24 * time.Hour),
			}
			completion := domain.PublicChargeCompletion{
				SessionID: 12, VehicleID: 42, PlaceID: 17, ChargingAt: now.Add(-90 * time.Second), CompletedAt: now.Add(-time.Minute),
			}
			live := map[string]*signal.Value{
				"DetailedChargeState": {Raw: "Complete", Timestamp: now},
				"ChargePortLatch":     {Raw: "Engaged", Timestamp: now},
				"Gear":                {Raw: "P", Timestamp: now},
				"LocationLatitude":    {Raw: 47.1, Timestamp: now},
				"LocationLongitude":   {Raw: -122.1, Timestamp: now},
			}
			if tt.change != nil {
				tt.change(&terms, &completion, live)
			}
			result := EvaluatePublicFee(terms, completion, live, now, func(lat, lon float64) bool {
				return lat == 47.1 && lon == -122.1
			})
			if tt.change != nil {
				if result != nil {
					t.Fatalf("unqualified state produced a fee notice: %+v", *result)
				}
				return
			}
			if result == nil || result.Terms != terms || result.SessionID != completion.SessionID ||
				!result.CompletionObservedAt.Equal(completion.CompletedAt) ||
				!result.EarliestFeeStartsAt.Equal(now.Add(8*time.Minute+30*time.Second)) ||
				!result.ExpiresAt.Equal(now.Add(signal.LiveSignalFreshnessThreshold)) {
				t.Fatalf("expected a timely notice with the reviewed terms, got %+v", result)
			}
		})
	}
}
