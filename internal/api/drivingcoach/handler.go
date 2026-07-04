package drivingcoach

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

const nominalBatteryCapacityWh = 75000.0

// DrivingCoachHandler analyses driving patterns and produces coaching insights.
type DrivingCoachHandler struct {
	repo driveCoachingRepository
}

// driveCoachingRepository is the minimal data-access surface GetCoaching
// needs. It is declared consumer-side as a port so handler tests can supply
// an in-memory fake without a live database — mirroring the vampiredrain
// handler's approach (the codebase has no pgxmock harness).
type driveCoachingRepository interface {
	CoachingDrives(ctx context.Context, vehicleID int64, since time.Time) ([]driveAnalysis, error)
}

// NewDrivingCoachHandler wires the handler to the SI-canonical drives table.
func NewDrivingCoachHandler(db *database.DB) *DrivingCoachHandler {
	return &DrivingCoachHandler{repo: newDBDriveCoachingRepo(db)}
}

type coachResponse struct {
	OverallScore        int                   `json:"overall_score"`
	EfficiencyWhKm      float64               `json:"efficiency_wh_km"`
	BestEfficiencyWhKm  float64               `json:"best_efficiency_wh_km"`
	TotalDrivesAnalyzed int                   `json:"total_drives_analyzed"`
	StyleBreakdown      map[string]int        `json:"style_breakdown"`
	Patterns            coachPatterns         `json:"patterns"`
	WeeklyTrend         []coachWeeklyTrend    `json:"weekly_trend"`
	Recommendations     []coachRecommendation `json:"recommendations"`
	PerDriveScores      []driveScoreEntry     `json:"per_drive_scores"`
}

type coachPatterns struct {
	HardAccelPct float64 `json:"hard_accel_pct"`
	HardBrakePct float64 `json:"hard_brake_pct"`
	HighwayPct   float64 `json:"highway_pct"`
	ShortTripPct float64 `json:"short_trip_pct"`
	ColdStartPct float64 `json:"cold_start_pct"`
}

type coachWeeklyTrend struct {
	Week       string  `json:"week"`
	Score      int     `json:"score"`
	Efficiency float64 `json:"efficiency"`
	Drives     int     `json:"drives"`
}

type coachRecommendation struct {
	Category string `json:"category"`
	Impact   string `json:"impact"`
	Tip      string `json:"tip"`
}

type driveScoreEntry struct {
	DriveID    int64   `json:"drive_id"`
	Date       string  `json:"date"`
	Score      int     `json:"score"`
	Style      string  `json:"style"`
	Efficiency float64 `json:"efficiency"`
	Distance   float64 `json:"distance"`
}

type driveAnalysis struct {
	id            int64
	date          time.Time
	distance      float64
	speedMax      float64
	speedAvg      float64
	powerMax      float64
	powerMin      float64
	hasPowerRange bool // false when powerMin is unavailable (drives table lacks min power)
	socStart      float64
	socEnd        float64
	outsideTemp   float64
	efficiency    float64
	style         string
	score         int
}

// GetCoaching handles GET /analytics/driving-coach?vehicle_id=X&days=30
func (h *DrivingCoachHandler) GetCoaching(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	days := 30
	if d, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && d > 0 && d <= 365 {
		days = d
	}

	ctx := r.Context()
	since := time.Now().AddDate(0, 0, -days)

	drives, err := h.repo.CoachingDrives(ctx, vehicleID, since)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Int("days", days).Msg("driving-coach: query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get driving data")
		return
	}

	if len(drives) == 0 {
		httpx.WriteJSON(w, http.StatusOK, coachResponse{
			StyleBreakdown:  map[string]int{"efficient": 0, "moderate": 0, "aggressive": 0},
			Patterns:        coachPatterns{},
			WeeklyTrend:     []coachWeeklyTrend{},
			Recommendations: []coachRecommendation{},
			PerDriveScores:  []driveScoreEntry{},
		})
		return
	}

	bestEfficiency := math.MaxFloat64
	for i := range drives {
		d := &drives[i]
		if d.distance > 0 && d.socStart > d.socEnd {
			d.efficiency = (d.socStart - d.socEnd) / 100 * nominalBatteryCapacityWh / d.distance
			if d.efficiency > 0 && d.efficiency < bestEfficiency {
				bestEfficiency = d.efficiency
			}
		}
		d.style = classifyDrivingStyle(d.powerMax, d.powerMin, d.speedMax, d.speedAvg, d.hasPowerRange)
	}
	if bestEfficiency == math.MaxFloat64 {
		bestEfficiency = 0
	}

	for i := range drives {
		d := &drives[i]
		if d.efficiency > 0 && bestEfficiency > 0 {
			d.score = int(math.Min(100, (bestEfficiency/d.efficiency)*100))
		}
	}

	avgEfficiency := 0.0
	weightSum := 0.0
	for i, d := range drives {
		if d.efficiency <= 0 {
			continue
		}
		w := math.Pow(0.95, float64(i)) // i=0 is newest → highest weight
		avgEfficiency += d.efficiency * w
		weightSum += w
	}
	if weightSum > 0 {
		avgEfficiency /= weightSum
	}

	styleCounts := map[string]int{"efficient": 0, "moderate": 0, "aggressive": 0}
	for _, d := range drives {
		styleCounts[d.style]++
	}

	n := float64(len(drives))
	var hardAccel, hardBrake, highway, shortTrip, coldStart int
	for _, d := range drives {
		if d.powerMax > 100 {
			hardAccel++
		}
		if d.hasPowerRange && d.powerMin < -60 {
			hardBrake++
		}
		if d.speedAvg > 80 {
			highway++
		}
		if d.distance < 5 {
			shortTrip++
		}
		if d.outsideTemp < 5 {
			coldStart++
		}
	}
	pct := func(count int) float64 { return math.Round(float64(count)/n*1000) / 10 }
	patterns := coachPatterns{
		HardAccelPct: pct(hardAccel),
		HardBrakePct: pct(hardBrake),
		HighwayPct:   pct(highway),
		ShortTripPct: pct(shortTrip),
		ColdStartPct: pct(coldStart),
	}

	overallScore := 0
	scoreW := 0.0
	scoreSum := 0.0
	for i, d := range drives {
		if d.score <= 0 {
			continue
		}
		w := math.Pow(0.95, float64(i))
		scoreSum += float64(d.score) * w
		scoreW += w
	}
	if scoreW > 0 {
		overallScore = int(math.Round(scoreSum / scoreW))
	}

	type weekAcc struct {
		totalScore      int
		totalEfficiency float64
		drives          int
	}
	weekMap := make(map[string]*weekAcc)
	for _, d := range drives {
		yr, wk := d.date.ISOWeek()
		key := fmt.Sprintf("%d-W%02d", yr, wk)
		if wa, ok := weekMap[key]; ok {
			wa.totalScore += d.score
			wa.totalEfficiency += d.efficiency
			wa.drives++
		} else {
			weekMap[key] = &weekAcc{totalScore: d.score, totalEfficiency: d.efficiency, drives: 1}
		}
	}
	weeklyTrends := make([]coachWeeklyTrend, 0, len(weekMap))
	for key, wa := range weekMap {
		avgScore := 0
		avgEff := 0.0
		if wa.drives > 0 {
			avgScore = wa.totalScore / wa.drives
			avgEff = wa.totalEfficiency / float64(wa.drives)
		}
		weeklyTrends = append(weeklyTrends, coachWeeklyTrend{
			Week:       key,
			Score:      avgScore,
			Efficiency: math.Round(avgEff*10) / 10,
			Drives:     wa.drives,
		})
	}
	sort.Slice(weeklyTrends, func(i, j int) bool {
		return weeklyTrends[i].Week < weeklyTrends[j].Week
	})

	recommendations := buildDrivingRecommendations(patterns, avgEfficiency)

	limit := 50
	if len(drives) < limit {
		limit = len(drives)
	}
	perDrive := make([]driveScoreEntry, 0, limit)
	for _, d := range drives[:limit] {
		perDrive = append(perDrive, driveScoreEntry{
			DriveID:    d.id,
			Date:       d.date.Format("2006-01-02"),
			Score:      d.score,
			Style:      d.style,
			Efficiency: math.Round(d.efficiency*10) / 10,
			Distance:   math.Round(d.distance*10) / 10,
		})
	}

	httpx.WriteJSON(w, http.StatusOK, coachResponse{
		OverallScore:        overallScore,
		EfficiencyWhKm:      math.Round(avgEfficiency*10) / 10,
		BestEfficiencyWhKm:  math.Round(bestEfficiency*10) / 10,
		TotalDrivesAnalyzed: len(drives),
		StyleBreakdown:      styleCounts,
		Patterns:            patterns,
		WeeklyTrend:         weeklyTrends,
		Recommendations:     recommendations,
		PerDriveScores:      perDrive,
	})
}

func classifyDrivingStyle(powerMax, powerMin, speedMax, speedAvg float64, hasPowerRange bool) string {
	if powerMax > 150 || speedMax > 130 {
		return "aggressive"
	}
	speedSpread := speedMax - speedAvg
	if hasPowerRange {
		regenRatio := 0.0
		if powerMax > 0 {
			regenRatio = math.Abs(powerMin) / powerMax
		}
		if powerMax < 80 && speedSpread < 30 && regenRatio > 0.3 {
			return "efficient"
		}
	} else {
		if powerMax < 80 && speedSpread < 30 {
			return "efficient"
		}
	}
	return "moderate"
}

func buildDrivingRecommendations(p coachPatterns, avgEff float64) []coachRecommendation {
	recs := make([]coachRecommendation, 0, 4)

	if p.HardAccelPct > 40 {
		recs = append(recs, coachRecommendation{
			Category: "acceleration", Impact: "high",
			Tip: fmt.Sprintf("Gentler acceleration can improve range by 10-15%% — currently %.0f%% of drives have hard acceleration", p.HardAccelPct),
		})
	} else if p.HardAccelPct > 20 {
		recs = append(recs, coachRecommendation{
			Category: "acceleration", Impact: "medium",
			Tip: fmt.Sprintf("Reduce hard acceleration events — currently %.0f%% of drives", p.HardAccelPct),
		})
	}

	if p.HighwayPct > 70 {
		recs = append(recs, coachRecommendation{
			Category: "speed", Impact: "high",
			Tip: "Highway driving at 110 vs 130 km/h saves ~20% energy — consider slowing down on long trips",
		})
	}

	if p.ShortTripPct > 50 {
		recs = append(recs, coachRecommendation{
			Category: "trips", Impact: "medium",
			Tip: fmt.Sprintf("Combining short trips reduces battery conditioning overhead — %.0f%% of trips are under 5 km", p.ShortTripPct),
		})
	} else if p.ShortTripPct > 30 {
		recs = append(recs, coachRecommendation{
			Category: "trips", Impact: "low",
			Tip: "Some short trips could be combined to reduce energy overhead",
		})
	}

	if p.ColdStartPct > 30 {
		recs = append(recs, coachRecommendation{
			Category: "climate", Impact: "medium",
			Tip: fmt.Sprintf("Pre-condition while plugged in to save ~5%% range in cold weather — %.0f%% of drives start cold", p.ColdStartPct),
		})
	}

	if avgEff > 180 {
		recs = append(recs, coachRecommendation{
			Category: "efficiency", Impact: "medium",
			Tip: fmt.Sprintf("Your average efficiency (%.0f Wh/km) is above typical — check tire pressure and reduce HVAC use", avgEff),
		})
	}

	if p.HardBrakePct > 30 {
		recs = append(recs, coachRecommendation{
			Category: "braking", Impact: "medium",
			Tip: "Increase following distance and anticipate stops to maximize regenerative braking",
		})
	}

	if len(recs) == 0 {
		recs = append(recs, coachRecommendation{
			Category: "general", Impact: "low",
			Tip: "Your driving patterns are excellent — keep up the efficient driving!",
		})
	}

	return recs
}
