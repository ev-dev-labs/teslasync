package journey

import (
	"context"
	"fmt"
)

// peakSampleLimit bounds the peak-kW pull per site for the health read.
const peakSampleLimit = 500

// SitePeaks returns recent peak-kW samples for a site, newest first.
// Empty (not an error) when the site has no metered sessions.
func (s *Store) SitePeaks(ctx context.Context, site string) ([]float64, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT peak_power_kw FROM tesla_charging_sessions
		WHERE site_location_name = $1 AND peak_power_kw > 0
		ORDER BY charge_start_datetime DESC
		LIMIT $2`, site, peakSampleLimit)
	if err != nil {
		return nil, fmt.Errorf("journey: site peaks: %w", err)
	}
	defer rows.Close()
	out := []float64{}
	for rows.Next() {
		var kw float64
		if err := rows.Scan(&kw); err != nil {
			return nil, fmt.Errorf("journey: scan peak: %w", err)
		}
		out = append(out, kw)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("journey: site peaks: %w", err)
	}
	return out, nil
}

// SitePrice returns the realized price per kWh for a site from invoice
// history, plus the metered-entry sample count. ok=false when unpriced.
// Multi-currency fleets compare realized ratios per site; sites almost
// always bill one currency, and the ranking is relative regardless.
func (s *Store) SitePrice(ctx context.Context, site string) (perKWh float64, samples int, ok bool, err error) {
	var wh, spend *float64
	var n int
	err = s.db.Pool.QueryRow(ctx, `
		SELECT SUM(usage_wh), SUM(total_due), COUNT(*)
		FROM tesla_charging_history
		WHERE site_location_name = $1 AND usage_wh > 0 AND total_due > 0`, site,
	).Scan(&wh, &spend, &n)
	if err != nil {
		return 0, 0, false, fmt.Errorf("journey: site price: %w", err)
	}
	if wh == nil || spend == nil || *wh <= 0 || n == 0 {
		return 0, 0, false, nil
	}
	return *spend / (*wh / 1000), n, true, nil
}
