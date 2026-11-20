package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"math"
	"slices"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

var ErrSitePerformanceUnavailable = errors.New("charging site performance analysis is unavailable")

func WithSitePerformance(repository port.SitePerformanceRepository) Option {
	return func(s *Service) { s.sitePerformance = repository }
}

func (s *Service) SetSitePerformance(ctx context.Context, subject string, vehicleID int64, placeID *int64) error {
	if err := validateScope(subject, vehicleID); err != nil {
		return err
	}
	if placeID != nil && *placeID <= 0 {
		return ErrInvalidInput
	}
	if s.sitePerformance == nil {
		return ErrSitePerformanceUnavailable
	}
	return s.sitePerformance.SaveSitePerformanceScope(ctx, subject, vehicleID, placeID, s.now().UTC())
}

func (s *Service) SitePerformanceSettings(ctx context.Context, subject string, vehicleID int64) (domain.SitePerformanceSettings, error) {
	if err := validateScope(subject, vehicleID); err != nil {
		return domain.SitePerformanceSettings{}, err
	}
	scopes, reviews, err := s.sitePerformanceFor(ctx, subject, &vehicleID, s.now().UTC(), 1)
	var settings domain.SitePerformanceSettings
	if err == nil && len(scopes) > 0 {
		settings.Scope = &scopes[0]
		if len(reviews) > 0 {
			settings.Review = &reviews[0]
		}
	}
	return settings, err
}

func (s *Service) ListSitePerformanceReviews(
	ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int,
) ([]domain.SitePerformanceReview, error) {
	_, reviews, err := s.sitePerformanceFor(ctx, subject, vehicleID, now, min(limit, 6))
	return reviews, err
}

func (s *Service) sitePerformanceFor(
	ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int,
) ([]domain.SitePerformanceScope, []domain.SitePerformanceReview, error) {
	if s.sitePerformance == nil || subject == "" || limit <= 0 {
		return nil, nil, nil
	}
	scopes, err := s.sitePerformance.ListSitePerformanceScopes(ctx, subject, vehicleID, limit)
	if err != nil || len(scopes) == 0 {
		return scopes, nil, err
	}
	reviews := make([]domain.SitePerformanceReview, 0, len(scopes))
	for _, scope := range scopes {
		rows, err := s.sitePerformance.ListSitePerformanceSessions(ctx, subject, scope, now)
		if err != nil {
			return nil, nil, fmt.Errorf("load opted-in charger evidence: %w", err)
		}
		if data, ok := compareSitePerformance(rows, now); ok {
			reviews = append(reviews, domain.SitePerformanceReview{
				PlaceID: scope.PlaceID, PlaceName: scope.PlaceName, VehicleID: scope.VehicleID, VehicleName: scope.VehicleName,
				LatestID: data.latestID, BaselineFromAt: data.earliestBaseline, ObservedAt: data.observedAt,
				ExpiresAt:   rows[1].EndedAt.Add(sitePerformanceRecentMaxAge),
				RecentCount: data.recentCount, BaselineCount: data.baselineCount, RecentW: data.recentW, BaselineW: data.baselineW,
			})
		}
	}
	current, err := s.sitePerformance.ListSitePerformanceScopes(ctx, subject, vehicleID, limit)
	if err != nil {
		return nil, nil, err
	}
	scopes = slices.DeleteFunc(scopes, func(before domain.SitePerformanceScope) bool {
		return !slices.ContainsFunc(current, func(after domain.SitePerformanceScope) bool {
			return before.VehicleID == after.VehicleID && before.PlaceID == after.PlaceID &&
				before.PlaceUpdatedAt.Equal(after.PlaceUpdatedAt) && before.EnabledAt.Equal(after.EnabledAt)
		})
	})
	verifiedAt := s.now().UTC()
	reviews = slices.DeleteFunc(reviews, func(row domain.SitePerformanceReview) bool {
		return !verifiedAt.Before(row.ExpiresAt) || !slices.ContainsFunc(scopes, func(scope domain.SitePerformanceScope) bool {
			return row.VehicleID == scope.VehicleID && row.PlaceID == scope.PlaceID
		})
	})
	return scopes, reviews, nil
}

const (
	sitePerformanceRecentMaxAge  = 14 * 24 * time.Hour
	sitePerformanceHistoryMaxAge = 90 * 24 * time.Hour
	sitePerformanceBaselineCount = 4
)

type sitePerformanceComparison struct {
	latestID         int64
	earliestBaseline time.Time
	observedAt       time.Time
	recentCount      int
	baselineCount    int
	recentW          float64
	baselineW        float64
}

// compareSitePerformance expects one vehicle at one reviewed location, ordered
// newest first. It compares elapsed-session rates, not instantaneous power.
func compareSitePerformance(sessions []domain.SitePerformanceSession, now time.Time) (sitePerformanceComparison, bool) {
	if len(sessions) < sitePerformanceBaselineCount+2 {
		return sitePerformanceComparison{}, false
	}
	latest, previous := sessions[0], sessions[1]
	currentW, priorW := elapsedSessionPowerW(latest, now), elapsedSessionPowerW(previous, now)
	if previous.EndedAt.Before(now.Add(-sitePerformanceRecentMaxAge)) || latest.StartedAt.Before(previous.EndedAt) ||
		currentW == 0 || priorW == 0 || !comparableSiteSession(latest, previous) {
		return sitePerformanceComparison{}, false
	}
	var baseline []float64
	var earliest time.Time
	lastStartedAt := previous.StartedAt
	for _, row := range sessions[2:] {
		if row.EndedAt.Before(now.Add(-sitePerformanceHistoryMaxAge)) {
			break
		}
		if row.EndedAt.After(lastStartedAt) || !comparableSiteSession(latest, row) || !comparableSiteSession(previous, row) {
			continue
		}
		if rate := elapsedSessionPowerW(row, now); rate > 0 {
			baseline = append(baseline, rate)
			earliest, lastStartedAt = row.EndedAt, row.StartedAt
		}
	}
	if len(baseline) < sitePerformanceBaselineCount {
		return sitePerformanceComparison{}, false
	}
	slices.Sort(baseline)
	middle := len(baseline) / 2
	baselineW := baseline[middle]
	if len(baseline)%2 == 0 {
		baselineW = (baseline[middle-1] + baselineW) / 2
	}
	// If the ordinary sessions disagree, a median alone is not a credible baseline.
	lower, upper := baseline[len(baseline)/4], baseline[(3*len(baseline)-1)/4]
	if upper-lower > 0.20*baselineW || max(currentW, priorW) > 0.75*baselineW ||
		baselineW-max(currentW, priorW) < 500 {
		return sitePerformanceComparison{}, false
	}
	return sitePerformanceComparison{
		latestID: latest.ID, earliestBaseline: earliest, observedAt: latest.EndedAt,
		recentCount: 2, baselineCount: len(baseline), recentW: (currentW + priorW) / 2, baselineW: baselineW,
	}, true
}

func comparableSiteSession(a, b domain.SitePerformanceSession) bool {
	return a.ID != b.ID && a.Charger == b.Charger && a.Cable == b.Cable &&
		math.Abs(a.StartSocPct-b.StartSocPct) <= 5 && math.Abs(a.EndSocPct-b.EndSocPct) <= 5
}

func elapsedSessionPowerW(row domain.SitePerformanceSession, now time.Time) float64 {
	elapsed := row.EndedAt.Sub(row.StartedAt)
	if row.ID <= 0 || row.Charger == "" || row.Cable == "" || row.StartedAt.IsZero() ||
		row.EndedAt.After(now) || elapsed < 10*time.Minute || elapsed > 24*time.Hour ||
		!(row.StartSocPct >= 0 && row.EndSocPct <= 100 && row.EndSocPct-row.StartSocPct >= 10) ||
		!(row.DeliveredWh >= 1_000 && row.DeliveredWh <= 200_000) {
		return 0
	}
	rate := row.DeliveredWh / elapsed.Hours()
	if rate > 350_000 {
		return 0
	}
	return rate
}
