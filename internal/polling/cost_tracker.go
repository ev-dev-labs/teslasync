package polling

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/metrics"
)

// CostTracker tracks API call savings in real time. It compares actual polls
// made against what would have been made without the engine (at the base
// interval), and estimates dollar cost savings.
type CostTracker struct {
	mu sync.RWMutex

	// What actually happened
	pollsMade int64

	// What was saved, broken down by reason
	savedByFleetTelemetry atomic.Int64
	savedByIdle           atomic.Int64
	savedByPrediction     atomic.Int64
	savedBySleep          atomic.Int64
	savedByBudget         atomic.Int64

	// What would have happened without the engine
	pollsWithoutEngine atomic.Int64

	// Cost config
	costPerRequest float64
	monthlyCredit  float64

	// Monthly reset
	monthStart time.Time
}

// NewCostTracker creates a tracker with the given cost parameters.
func NewCostTracker(costPerRequest, monthlyCredit float64) *CostTracker {
	now := time.Now().UTC()
	return &CostTracker{
		costPerRequest: costPerRequest,
		monthlyCredit:  monthlyCredit,
		monthStart:     time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC),
	}
}

// RecordPoll records that a poll was actually made.
func (c *CostTracker) RecordPoll() {
	c.mu.Lock()
	c.pollsMade++
	c.mu.Unlock()
}

// RecordSkip records a poll that was skipped, with the reason.
func (c *CostTracker) RecordSkip(reason string) {
	switch reason {
	case "fleet_telemetry":
		c.savedByFleetTelemetry.Add(1)
	case "idle":
		c.savedByIdle.Add(1)
	case "prediction":
		c.savedByPrediction.Add(1)
	case "sleep":
		c.savedBySleep.Add(1)
	case "budget":
		c.savedByBudget.Add(1)
	}
	metrics.PollsSaved.WithLabelValues(reason).Inc()
}

// RecordBaselineTick records an eligible poll that would have been made at the
// base interval. Infrastructure backoffs are excluded because they are not
// optimization savings.
func (c *CostTracker) RecordBaselineTick() {
	c.pollsWithoutEngine.Add(1)
}

// CostSnapshot is the serialisable output for the dashboard.
type CostSnapshot struct {
	PollsMade         int64            `json:"polls_made"`
	PollsSaved        int64            `json:"polls_saved"`
	SavingsBreakdown  map[string]int64 `json:"savings_breakdown"`
	SavingsPercent    float64          `json:"savings_percent"`
	EstimatedCost     float64          `json:"estimated_cost"`
	EstimatedWithout  float64          `json:"estimated_cost_without_engine"`
	EstimatedSavings  float64          `json:"estimated_savings"`
	MonthlyCredit     float64          `json:"monthly_credit"`
	RemainingCredit   float64          `json:"remaining_credit"`
	ProjectedMonthEnd float64          `json:"projected_month_end"`
}

// Snapshot returns a point-in-time view of cost savings.
func (c *CostTracker) Snapshot() CostSnapshot {
	c.mu.RLock()
	made := c.pollsMade
	c.mu.RUnlock()

	byFT := c.savedByFleetTelemetry.Load()
	byIdle := c.savedByIdle.Load()
	byPred := c.savedByPrediction.Load()
	bySleep := c.savedBySleep.Load()
	byBudget := c.savedByBudget.Load()
	saved := byFT + byIdle + byPred + bySleep + byBudget
	baseline := c.pollsWithoutEngine.Load()

	total := made + saved
	var savingsPct float64
	if total > 0 {
		savingsPct = float64(saved) / float64(total) * 100
	}

	estCost := float64(made) * c.costPerRequest
	estWithout := float64(baseline) * c.costPerRequest
	estSavings := estWithout - estCost
	if estSavings < 0 {
		estSavings = 0
	}

	remaining := c.monthlyCredit - estCost
	if remaining < 0 {
		remaining = 0
	}

	// Project to end of month
	now := time.Now().UTC()
	elapsed := now.Sub(c.monthStart)
	daysInMonth := float64(daysIn(now.Year(), now.Month()))
	var projected float64
	if elapsed.Hours() > 0 {
		dailyRate := estCost / (elapsed.Hours() / 24)
		projected = dailyRate * daysInMonth
	}

	return CostSnapshot{
		PollsMade:  made,
		PollsSaved: saved,
		SavingsBreakdown: map[string]int64{
			"fleet_telemetry": byFT,
			"idle_detection":  byIdle,
			"prediction":      byPred,
			"sleep_detection": bySleep,
			"budget":          byBudget,
		},
		SavingsPercent:    savingsPct,
		EstimatedCost:     estCost,
		EstimatedWithout:  estWithout,
		EstimatedSavings:  estSavings,
		MonthlyCredit:     c.monthlyCredit,
		RemainingCredit:   remaining,
		ProjectedMonthEnd: projected,
	}
}

func daysIn(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}
