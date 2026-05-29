package chargeopt

import (
	"fmt"
	"math"
	"sort"
	"time"
)

type sessionRow struct {
	id           int64
	startDate    time.Time
	cost         float64
	kwh          float64
	power        float64
	endBattery   int
	startBattery int
	lat          float64
	lon          float64
	outsideTemp  float64
}

func analyzeSchedule(sessions []sessionRow) currentSchedule {
	hourCount := make(map[int]int)
	weekdayCount := 0
	weekendCount := 0
	var totalEndBattery float64
	endBatteryN := 0

	for _, s := range sessions {
		h := s.startDate.Hour()
		hourCount[h]++
		if s.startDate.Weekday() >= time.Monday && s.startDate.Weekday() <= time.Friday {
			weekdayCount++
		} else {
			weekendCount++
		}
		if s.endBattery > 0 {
			totalEndBattery += float64(s.endBattery)
			endBatteryN++
		}
	}

	bestHour := 0
	bestCount := 0
	for h, c := range hourCount {
		if c > bestCount {
			bestHour = h
			bestCount = c
		}
	}

	commonDay := "weekday"
	if weekendCount > weekdayCount {
		commonDay = "weekend"
	}

	var first, last time.Time
	if len(sessions) > 0 {
		last = sessions[0].startDate
		first = sessions[len(sessions)-1].startDate
	}
	weeks := last.Sub(first).Hours() / (24 * 7)
	if weeks < 1 {
		weeks = 1
	}
	avgPerWeek := float64(len(sessions)) / weeks

	avgChargeTo := 0.0
	if endBatteryN > 0 {
		avgChargeTo = totalEndBattery / float64(endBatteryN)
	}

	return currentSchedule{
		MostCommonStartHour: bestHour,
		MostCommonDay:       commonDay,
		AvgSessionsPerWeek:  round2(avgPerWeek),
		AvgChargeToPct:      round2(avgChargeTo),
	}
}

func detectHome(sessions []sessionRow) (homeCount int, homePct float64) {
	if len(sessions) == 0 {
		return 0, 0
	}

	// Treat coordinates within roughly 100 m as the same charging location.
	type locCluster struct {
		lat, lon float64
		count    int
	}
	var clusters []locCluster

	for _, s := range sessions {
		if s.lat == 0 && s.lon == 0 {
			continue
		}
		found := false
		for i := range clusters {
			if math.Abs(clusters[i].lat-s.lat) < 0.001 && math.Abs(clusters[i].lon-s.lon) < 0.001 {
				clusters[i].count++
				found = true
				break
			}
		}
		if !found {
			clusters = append(clusters, locCluster{lat: s.lat, lon: s.lon, count: 1})
		}
	}

	if len(clusters) == 0 {
		return 0, 0
	}

	sort.Slice(clusters, func(i, j int) bool { return clusters[i].count > clusters[j].count })
	homeCount = clusters[0].count
	homePct = float64(homeCount) / float64(len(sessions)) * 100
	return homeCount, homePct
}

func analyzeCosts(sessions []sessionRow, homeCount int) ([]heatmapEntry, costAnalysis) {
	type hourBucket struct {
		totalCost float64
		totalKwh  float64
		sessions  int
	}

	grid := make(map[[2]int]*hourBucket) // [day, hour] → bucket
	hourAgg := make(map[int]*hourBucket) // hour → bucket (for peak detection)

	for _, s := range sessions {
		day := int(s.startDate.Weekday())
		hour := s.startDate.Hour()

		key := [2]int{day, hour}
		if grid[key] == nil {
			grid[key] = &hourBucket{}
		}
		grid[key].totalCost += s.cost
		grid[key].totalKwh += s.kwh
		grid[key].sessions++

		if hourAgg[hour] == nil {
			hourAgg[hour] = &hourBucket{}
		}
		hourAgg[hour].totalCost += s.cost
		hourAgg[hour].totalKwh += s.kwh
		hourAgg[hour].sessions++
	}

	heatmap := make([]heatmapEntry, 0, len(grid))
	for key, b := range grid {
		avgCPK := 0.0
		if b.totalKwh > 0 {
			avgCPK = b.totalCost / b.totalKwh
		}
		heatmap = append(heatmap, heatmapEntry{
			Day:           key[0],
			Hour:          key[1],
			Sessions:      b.sessions,
			AvgCostPerKWh: round3(avgCPK),
		})
	}
	sort.Slice(heatmap, func(i, j int) bool {
		if heatmap[i].Day != heatmap[j].Day {
			return heatmap[i].Day < heatmap[j].Day
		}
		return heatmap[i].Hour < heatmap[j].Hour
	})

	type hourCost struct {
		hour int
		cpk  float64
	}
	var hourCosts []hourCost
	for h, b := range hourAgg {
		cpk := 0.0
		if b.totalKwh > 0 {
			cpk = b.totalCost / b.totalKwh
		}
		hourCosts = append(hourCosts, hourCost{hour: h, cpk: cpk})
	}
	sort.Slice(hourCosts, func(i, j int) bool { return hourCosts[i].cpk < hourCosts[j].cpk })

	offpeakHours := make([]int, 0)
	peakHours := make([]int, 0)
	var offpeakCPK, peakCPK float64

	if len(hourCosts) > 0 {
		offCut := len(hourCosts) / 3
		if offCut < 1 {
			offCut = 1
		}
		peakCut := len(hourCosts) - offCut

		var offTotal, offN, peakTotal, peakN float64
		for i, hc := range hourCosts {
			if i < offCut {
				offpeakHours = append(offpeakHours, hc.hour)
				offTotal += hc.cpk
				offN++
			}
			if i >= peakCut {
				peakHours = append(peakHours, hc.hour)
				peakTotal += hc.cpk
				peakN++
			}
		}
		if offN > 0 {
			offpeakCPK = offTotal / offN
		}
		if peakN > 0 {
			peakCPK = peakTotal / peakN
		}
	}

	peakSet := make(map[int]bool)
	for _, h := range peakHours {
		peakSet[h] = true
	}
	peakSessions := 0
	for _, s := range sessions {
		if peakSet[s.startDate.Hour()] {
			peakSessions++
		}
	}
	peakPct := 0.0
	if len(sessions) > 0 {
		peakPct = float64(peakSessions) / float64(len(sessions)) * 100
	}

	var monthlyHomeKwh float64
	var first, last time.Time
	if len(sessions) > 0 {
		last = sessions[0].startDate
		first = sessions[len(sessions)-1].startDate
	}
	months := last.Sub(first).Hours() / (24 * 30.44)
	if months < 1 {
		months = 1
	}

	for _, s := range sessions {
		monthlyHomeKwh += s.kwh
	}
	monthlyHomeKwh /= months
	peakFraction := peakPct / 100
	potentialSavings := monthlyHomeKwh * peakFraction * math.Max(0, peakCPK-offpeakCPK)

	sort.Ints(peakHours)
	sort.Ints(offpeakHours)

	ca := costAnalysis{
		PeakHours:               peakHours,
		OffpeakHours:            offpeakHours,
		PeakCostPerKWh:          round3(peakCPK),
		OffpeakCostPerKWh:       round3(offpeakCPK),
		SessionsDuringPeakPct:   round2(peakPct),
		PotentialMonthlySavings: round2(potentialSavings),
	}
	return heatmap, ca
}

func computeBatteryHealthScore(sessions []sessionRow) int {
	if len(sessions) == 0 {
		return 100
	}
	score := 100.0

	var fullChargeCount, dcFastCount, extremeTempCount int
	var homeStyleCount int
	n := float64(len(sessions))

	for _, s := range sessions {
		if s.endBattery >= 95 {
			fullChargeCount++
		}
		if s.power > 50 {
			dcFastCount++
		}
		if s.outsideTemp < 0 || s.outsideTemp > 40 {
			extremeTempCount++
		}
		if s.power <= 22 || s.power == 0 {
			homeStyleCount++
		}
	}

	fullPct := float64(fullChargeCount) / n * 100
	if fullPct > 50 {
		score -= 25
	} else if fullPct > 25 {
		score -= 15
	} else if fullPct > 10 {
		score -= 5
	}

	dcPct := float64(dcFastCount) / n * 100
	if dcPct > 50 {
		score -= 20
	} else if dcPct > 25 {
		score -= 10
	}

	extremePct := float64(extremeTempCount) / n * 100
	if extremePct > 30 {
		score -= 15
	} else if extremePct > 15 {
		score -= 8
	}

	homePct := float64(homeStyleCount) / n * 100
	if homePct > 70 {
		score += 5
	}

	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	return int(math.Round(score))
}

func buildOptimizerRecommendations(sched currentSchedule, ca costAnalysis, healthScore int, sessions []sessionRow) []optimizerRec {
	recs := make([]optimizerRec, 0, 5)

	if ca.SessionsDuringPeakPct > 20 && ca.PotentialMonthlySavings > 5 {
		prio := "medium"
		if ca.PotentialMonthlySavings > 15 {
			prio = "high"
		}
		recs = append(recs, optimizerRec{
			Type:     "schedule",
			Priority: prio,
			Title:    "Shift home charging to off-peak hours",
			Detail: fmt.Sprintf(
				"%.0f%% of sessions start during peak rates. Scheduling after 11 PM could save ~$%.0f/month.",
				ca.SessionsDuringPeakPct, ca.PotentialMonthlySavings,
			),
			EstimatedSavings: ca.PotentialMonthlySavings,
		})
	}

	if sched.AvgChargeToPct > 90 {
		recs = append(recs, optimizerRec{
			Type:     "limit",
			Priority: "medium",
			Title:    "Lower daily charge limit to 80%",
			Detail: fmt.Sprintf(
				"Your average charge target is %.0f%%. Reducing to 80%% for daily driving extends battery life with minimal range impact.",
				sched.AvgChargeToPct,
			),
		})
	}

	morningCount := 0
	for _, s := range sessions {
		h := s.startDate.Hour()
		if h >= 6 && h <= 9 {
			morningCount++
		}
	}
	if len(sessions) > 0 && float64(morningCount)/float64(len(sessions))*100 < 20 {
		recs = append(recs, optimizerRec{
			Type:     "precondition",
			Priority: "low",
			Title:    "Enable scheduled departure",
			Detail:   "Scheduled departure pre-conditions the battery while plugged in, saving 3-5% range — especially in cold weather.",
		})
	}

	dcCount := 0
	for _, s := range sessions {
		if s.power > 50 {
			dcCount++
		}
	}
	if len(sessions) > 0 {
		dcPct := float64(dcCount) / float64(len(sessions)) * 100
		if dcPct > 40 {
			recs = append(recs, optimizerRec{
				Type:     "battery",
				Priority: "high",
				Title:    "Reduce DC fast charging frequency",
				Detail:   fmt.Sprintf("%.0f%% of sessions use DC fast charging. Frequent fast charging accelerates battery degradation.", dcPct),
			})
		}
	}

	if sched.HomeChargingPct < 50 && sched.HomeChargingPct > 0 {
		recs = append(recs, optimizerRec{
			Type:     "cost",
			Priority: "medium",
			Title:    "Increase home charging ratio",
			Detail:   fmt.Sprintf("Only %.0f%% of sessions are at home. Home charging is typically 50-70%% cheaper than public charging.", sched.HomeChargingPct),
		})
	}

	if len(recs) == 0 {
		recs = append(recs, optimizerRec{
			Type:     "general",
			Priority: "low",
			Title:    "Your charging habits are excellent!",
			Detail:   "No optimization recommendations at this time. Keep up the great habits.",
		})
	}

	prioOrder := map[string]int{"high": 0, "medium": 1, "low": 2}
	sort.Slice(recs, func(i, j int) bool {
		return prioOrder[recs[i].Priority] < prioOrder[recs[j].Priority]
	})

	return recs
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }
func round3(v float64) float64 { return math.Round(v*1000) / 1000 }
