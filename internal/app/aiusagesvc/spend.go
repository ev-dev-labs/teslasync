package aiusagesvc

import (
	"math"
	"sort"
	"time"
)

// DailyRow is observed cost for a feature/provider/model on a UTC day.
type DailyRow struct {
	Day            time.Time
	FeatureID      string
	Provider       string
	Model          string
	Calls          int64
	CostMicroCents int64
}

type Driver struct {
	FeatureID               string `json:"feature_id"`
	Provider                string `json:"provider"`
	Model                   string `json:"model"`
	TodayMicroCents         int64  `json:"today_micro_cents"`
	PriorDailyAvgMicroCents int64  `json:"prior_daily_avg_micro_cents"`
}

type SpendInsight struct {
	Status                   string    `json:"status"`
	AsOf                     time.Time `json:"as_of"`
	TodayMicroCents          int64     `json:"today_micro_cents"`
	PriorDailyAvgMicroCents  int64     `json:"prior_daily_avg_micro_cents"`
	ProjectedTodayMicroCents *int64    `json:"projected_today_micro_cents"`
	PriorActiveDays          int       `json:"prior_active_days"`
	Drivers                  []Driver  `json:"drivers"`
}

type driverKey struct{ feature, provider, model string }

// Analyze compares today's audited cost to seven complete UTC days. Projection
// is withheld until at least three calls and an hour have elapsed; a sparse
// history is labeled explicitly instead of implying a trustworthy baseline.
func Analyze(rows []DailyRow, now time.Time) SpendInsight {
	now = now.UTC()
	today := now.Truncate(24 * time.Hour)
	start := today.AddDate(0, 0, -7)
	result := SpendInsight{Status: "insufficient_history", AsOf: now, Drivers: []Driver{}}
	prior := make(map[driverKey]int64)
	current := make(map[driverKey]*Driver)
	priorDays := make(map[time.Time]bool)
	var totalPrior, todayCalls int64
	for _, row := range rows {
		if row.CostMicroCents < 0 || row.Calls < 0 {
			continue
		}
		day := row.Day.UTC().Truncate(24 * time.Hour)
		key := driverKey{row.FeatureID, row.Provider, row.Model}
		switch {
		case day.Equal(today):
			result.TodayMicroCents += row.CostMicroCents
			todayCalls += row.Calls
			if current[key] == nil {
				current[key] = &Driver{FeatureID: key.feature, Provider: key.provider, Model: key.model}
			}
			current[key].TodayMicroCents += row.CostMicroCents
		case !day.Before(start) && day.Before(today):
			prior[key] += row.CostMicroCents
			totalPrior += row.CostMicroCents
			if row.Calls > 0 {
				priorDays[day] = true
			}
		}
	}
	result.PriorActiveDays = len(priorDays)
	result.PriorDailyAvgMicroCents = totalPrior / 7
	for key, driver := range current {
		driver.PriorDailyAvgMicroCents = prior[key] / 7
		result.Drivers = append(result.Drivers, *driver)
	}
	sort.Slice(result.Drivers, func(i, j int) bool {
		if result.Drivers[i].TodayMicroCents == result.Drivers[j].TodayMicroCents {
			return result.Drivers[i].FeatureID < result.Drivers[j].FeatureID
		}
		return result.Drivers[i].TodayMicroCents > result.Drivers[j].TodayMicroCents
	})

	if result.TodayMicroCents == 0 {
		result.Status = "no_spend_today"
		return result
	}
	if result.PriorActiveDays < 3 {
		return result
	}
	result.Status = "normal"
	elapsed := now.Sub(today)
	if elapsed < time.Hour || todayCalls < 3 {
		return result
	}
	projected := int64(math.Round(float64(result.TodayMicroCents) * float64(24*time.Hour) / float64(elapsed)))
	result.ProjectedTodayMicroCents = &projected
	// At least five cents must actually have been spent before surfacing an
	// anomaly; a tiny early-day sample extrapolated over 24h is too noisy.
	if result.TodayMicroCents >= 50_000 && result.PriorDailyAvgMicroCents == 0 {
		result.Status = "new_paid_spend"
	} else if result.TodayMicroCents >= 50_000 && projected >= 2*result.PriorDailyAvgMicroCents &&
		result.TodayMicroCents > result.PriorDailyAvgMicroCents/2 {
		result.Status = "unusual_pace"
	}
	return result
}
