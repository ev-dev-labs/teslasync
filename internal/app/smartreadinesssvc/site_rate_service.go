package smartreadinesssvc

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

func (s *Service) loadStableSiteRates(
	ctx context.Context, plans []domain.Plan, estimates []domain.LatestStart, capacityWh float64,
) (map[int64][]domain.SiteRateWindow, error) {
	if !finiteBetween(capacityWh, 1, 500000) {
		return nil, nil
	}
	now := s.now().UTC()
	placeIDs := make([]int64, 0)
	seen := make(map[int64]bool)
	var latestDeparture time.Time
	for i, plan := range plans {
		estimate := estimates[i]
		if !plan.CompareSiteRates || plan.ChargingPlaceID == nil ||
			estimate.Status != domain.LatestStartEstimate || estimate.EarliestSafeStartAt == nil ||
			estimate.ExpiresAt == nil || !now.Before(*estimate.ExpiresAt) ||
			estimate.EarliestSafeStartAt.Before(now.Add(minimumRateDelay)) {
			continue
		}
		placeID := *plan.ChargingPlaceID
		if !seen[placeID] {
			placeIDs = append(placeIDs, placeID)
			seen[placeID] = true
		}
		if plan.DepartureAt.After(latestDeparture) {
			latestDeparture = plan.DepartureAt
		}
	}
	if len(placeIDs) == 0 {
		return nil, nil
	}
	windows, err := s.repository.ListSiteRateWindows(ctx, placeIDs, now, latestDeparture)
	if err != nil {
		return nil, fmt.Errorf("read charging place price windows: %w", err)
	}
	byPlace := groupSiteRates(windows)
	found := false
	for i, plan := range plans {
		if !plan.CompareSiteRates || plan.ChargingPlaceID == nil {
			continue
		}
		if estimateSiteRateComparison(plan, estimates[i], capacityWh, byPlace[*plan.ChargingPlaceID], now) != nil {
			found = true
			break
		}
	}
	if !found {
		return nil, nil
	}
	current, err := s.repository.ListSiteRateWindows(ctx, placeIDs, now, latestDeparture)
	if err != nil {
		return nil, fmt.Errorf("recheck charging place price windows: %w", err)
	}
	currentByPlace := groupSiteRates(current)
	for placeID, rates := range byPlace {
		if !sameSiteRates(rates, currentByPlace[placeID]) {
			delete(byPlace, placeID)
		}
	}
	return byPlace, nil
}

func groupSiteRates(windows []domain.SiteRateWindow) map[int64][]domain.SiteRateWindow {
	byPlace := make(map[int64][]domain.SiteRateWindow)
	for _, window := range windows {
		byPlace[window.PlaceID] = append(byPlace[window.PlaceID], window)
	}
	return byPlace
}

func sameSiteRates(first, second []domain.SiteRateWindow) bool {
	if len(first) != len(second) {
		return false
	}
	for i, left := range first {
		right := second[i]
		if left.PlaceID != right.PlaceID || left.RatePerWh != right.RatePerWh ||
			left.Currency != right.Currency || !left.EffectiveFrom.Equal(right.EffectiveFrom) ||
			(left.EffectiveTo == nil) != (right.EffectiveTo == nil) {
			return false
		}
		if left.EffectiveTo != nil && !left.EffectiveTo.Equal(*right.EffectiveTo) {
			return false
		}
	}
	return true
}
