package smartreadinesssvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

func TestSitePerformanceRequiresTwoRecentSlowSessionsAndStableHistory(t *testing.T) {
	now := time.Date(2026, 4, 7, 12, 0, 0, 0, time.UTC)
	for _, tt := range []struct {
		name string
		edit func([]domain.SitePerformanceSession) []domain.SitePerformanceSession
		want bool
	}{
		{name: "both recent sessions materially slower", want: true},
		{name: "recently recovered", edit: func(rows []domain.SitePerformanceSession) []domain.SitePerformanceSession {
			rows[0].StartedAt = rows[0].EndedAt.Add(-time.Hour)
			return rows
		}},
		{name: "sparse baseline", edit: func(rows []domain.SitePerformanceSession) []domain.SitePerformanceSession { return rows[:5] }},
		{name: "different state of charge at the end", edit: func(rows []domain.SitePerformanceSession) []domain.SitePerformanceSession {
			rows[1].EndSocPct = 90
			return rows
		}},
		{name: "different connector", edit: func(rows []domain.SitePerformanceSession) []domain.SitePerformanceSession {
			rows[4].Cable = "J1772"
			return rows
		}},
		{name: "inconsistent baseline", edit: func(rows []domain.SitePerformanceSession) []domain.SitePerformanceSession {
			rows[2].DeliveredWh, rows[3].DeliveredWh = 4_000, 4_500
			return rows
		}},
		{name: "unusable energy evidence", edit: func(rows []domain.SitePerformanceSession) []domain.SitePerformanceSession {
			rows[0].DeliveredWh = 0
			return rows
		}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			rows := make([]domain.SitePerformanceSession, 6)
			for i := range rows {
				end := now.AddDate(0, 0, -i-1)
				rows[i] = domain.SitePerformanceSession{
					ID: int64(6 - i), StartedAt: end.Add(-time.Hour), EndedAt: end,
					StartSocPct: 25, EndSocPct: 39, Charger: "AC", Cable: "NACS",
					DeliveredWh: 8_000,
				}
			}
			rows[0].StartedAt, rows[1].StartedAt = rows[0].EndedAt.Add(-2*time.Hour), rows[1].EndedAt.Add(-2*time.Hour)
			if tt.edit != nil {
				rows = tt.edit(rows)
			}
			comparison, ok := compareSitePerformance(rows, now)
			if ok != tt.want {
				t.Fatalf("comparison = %+v, ok = %v; want ok = %v", comparison, ok, tt.want)
			}
			if ok && (comparison.baselineW != 8_000 || comparison.recentW != 4_000 ||
				comparison.latestID != 6 || comparison.recentCount != 2 || comparison.baselineCount != 4) {
				t.Fatalf("wrong rate or provenance: %+v", comparison)
			}
		})
	}
}
