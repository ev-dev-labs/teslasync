package smartreadiness

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

func (r *Repository) ListSiteRateWindows(
	ctx context.Context, placeIDs []int64, from, to time.Time,
) ([]domain.SiteRateWindow, error) {
	if len(placeIDs) == 0 {
		return []domain.SiteRateWindow{}, nil
	}
	rows, err := r.db.Pool.Query(ctx, `
		SELECT geofence_id, rate_per_wh::text, currency, effective_from, effective_to
		FROM (
		  SELECT geofence_id, rate_per_wh, currency, effective_from, effective_to,
		         row_number() OVER (PARTITION BY geofence_id ORDER BY effective_from) AS position
		  FROM geofence_rates
		  WHERE geofence_id = ANY($1) AND effective_from < $3
		    AND (effective_to IS NULL OR effective_to > $2)
		) rates
		WHERE position <= 101
		ORDER BY geofence_id, effective_from`, placeIDs, from, to)
	if err != nil {
		return nil, fmt.Errorf("list charging place price windows: %w", err)
	}
	defer rows.Close()
	windows := make([]domain.SiteRateWindow, 0)
	for rows.Next() {
		var window domain.SiteRateWindow
		if err := rows.Scan(&window.PlaceID, &window.RatePerWh, &window.Currency,
			&window.EffectiveFrom, &window.EffectiveTo); err != nil {
			return nil, fmt.Errorf("scan charging place price window: %w", err)
		}
		windows = append(windows, window)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate charging place price windows: %w", err)
	}
	return windows, nil
}
