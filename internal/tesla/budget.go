package tesla

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"
)

const (
	MicroUSDPerUSD int64 = 1_000_000

	vehicleDataCostMicroUSD  int64 = 2_000
	wakeUpCostMicroUSD       int64 = 20_000
	commandCostMicroUSD      int64 = 1_000
	vehicleSpecsCostMicroUSD int64 = 100_000
	otherRequestCostMicroUSD int64 = 1_000
)

type BudgetCategory string

const (
	BudgetCategoryVehicleData  BudgetCategory = "vehicle_data"
	BudgetCategoryWakeUp       BudgetCategory = "wake_up"
	BudgetCategoryCommand      BudgetCategory = "command"
	BudgetCategoryVehicleSpecs BudgetCategory = "vehicle_specs"
	BudgetCategoryOther        BudgetCategory = "other"
)

var ErrBudgetExceeded = errors.New("Tesla Fleet API daily budget exceeded")
var ErrBudgetUnavailable = errors.New("Tesla Fleet API budget evidence unavailable")
var ErrInvalidBudgetCharge = errors.New("invalid Tesla Fleet API budget charge")

type BudgetPolicy struct {
	DailyLimitMicroUSD     int64
	CommandReserveMicroUSD int64
}

func NewBudgetPolicy(dailyLimitUSD, commandReserveUSD float64) BudgetPolicy {
	daily := usdToMicroUSD(dailyLimitUSD)
	reserve := usdToMicroUSD(commandReserveUSD)
	if reserve > daily {
		reserve = daily
	}
	return BudgetPolicy{
		DailyLimitMicroUSD:     daily,
		CommandReserveMicroUSD: reserve,
	}
}

func (p BudgetPolicy) Enabled() bool {
	return p.DailyLimitMicroUSD > 0
}

func (p BudgetPolicy) BackgroundLimitMicroUSD() int64 {
	limit := p.DailyLimitMicroUSD - p.CommandReserveMicroUSD
	if limit < 0 {
		return 0
	}
	return limit
}

type BudgetCharge struct {
	Category              BudgetCategory
	EstimatedCostMicroUSD int64
	UsesCommandReserve    bool
}

func (c BudgetCharge) Validate() error {
	if c.EstimatedCostMicroUSD <= 0 {
		return fmt.Errorf("%w: estimated cost must be positive", ErrInvalidBudgetCharge)
	}
	switch c.Category {
	case BudgetCategoryVehicleData,
		BudgetCategoryWakeUp,
		BudgetCategoryCommand,
		BudgetCategoryVehicleSpecs,
		BudgetCategoryOther:
		return nil
	default:
		return fmt.Errorf("%w: unknown category %q", ErrInvalidBudgetCharge, c.Category)
	}
}

type BudgetSnapshot struct {
	PeriodStart            time.Time
	ResetAt                time.Time
	DailyLimitMicroUSD     int64
	CommandReserveMicroUSD int64
	TotalRequests          int64
	EstimatedCostMicroUSD  int64
	BackgroundRequests     int64
	BackgroundCostMicroUSD int64
	VehicleDataRequests    int64
	WakeUpRequests         int64
	CommandRequests        int64
	VehicleSpecsRequests   int64
	OtherRequests          int64
}

func (s BudgetSnapshot) EstimatedCostUSD() float64 {
	return microUSDToUSD(s.EstimatedCostMicroUSD)
}

func (s BudgetSnapshot) DailyLimitUSD() float64 {
	return microUSDToUSD(s.DailyLimitMicroUSD)
}

func (s BudgetSnapshot) BackgroundCostUSD() float64 {
	return microUSDToUSD(s.BackgroundCostMicroUSD)
}

func (s BudgetSnapshot) BackgroundLimitUSD() float64 {
	return microUSDToUSD(s.DailyLimitMicroUSD - s.CommandReserveMicroUSD)
}

// RemainingBackgroundMicroUSD is constrained by both the protected
// background allowance and the absolute daily cap. Commands may consume more
// than their reserve, so looking only at background spend can overstate what
// remains for polling.
func (s BudgetSnapshot) RemainingBackgroundMicroUSD() int64 {
	backgroundRemaining := s.DailyLimitMicroUSD -
		s.CommandReserveMicroUSD -
		s.BackgroundCostMicroUSD
	totalRemaining := s.DailyLimitMicroUSD - s.EstimatedCostMicroUSD
	remaining := min(backgroundRemaining, totalRemaining)
	if remaining < 0 {
		return 0
	}
	return remaining
}

type RequestBudget interface {
	Reserve(ctx context.Context, charge BudgetCharge) (BudgetSnapshot, error)
	Snapshot(ctx context.Context) (BudgetSnapshot, error)
}

type BudgetExceededError struct {
	Category BudgetCategory
	Snapshot BudgetSnapshot
}

func (e *BudgetExceededError) Error() string {
	return fmt.Sprintf(
		"%s: category=%s estimated_spend_usd=%.6f limit_usd=%.6f",
		ErrBudgetExceeded,
		e.Category,
		microUSDToUSD(e.Snapshot.EstimatedCostMicroUSD),
		microUSDToUSD(e.Snapshot.DailyLimitMicroUSD),
	)
}

func (e *BudgetExceededError) Unwrap() error {
	return ErrBudgetExceeded
}

func ClassifyBudgetCharge(method, path string) BudgetCharge {
	cleanPath := path
	if query := strings.IndexByte(cleanPath, '?'); query >= 0 {
		cleanPath = cleanPath[:query]
	}

	switch {
	case strings.HasSuffix(cleanPath, "/vehicle_data"):
		return BudgetCharge{
			Category:              BudgetCategoryVehicleData,
			EstimatedCostMicroUSD: vehicleDataCostMicroUSD,
		}
	case strings.HasSuffix(cleanPath, "/wake_up"):
		return BudgetCharge{
			Category:              BudgetCategoryWakeUp,
			EstimatedCostMicroUSD: wakeUpCostMicroUSD,
			UsesCommandReserve:    true,
		}
	case strings.Contains(cleanPath, "/command/"):
		return BudgetCharge{
			Category:              BudgetCategoryCommand,
			EstimatedCostMicroUSD: commandCostMicroUSD,
			UsesCommandReserve:    true,
		}
	case strings.HasSuffix(cleanPath, "/specs") || cleanPath == vehicleSpecsRouteTemplate:
		return BudgetCharge{
			Category:              BudgetCategoryVehicleSpecs,
			EstimatedCostMicroUSD: vehicleSpecsCostMicroUSD,
		}
	default:
		return BudgetCharge{
			Category:              BudgetCategoryOther,
			EstimatedCostMicroUSD: otherRequestCostMicroUSD,
		}
	}
}

func EstimatedCostUSD(category BudgetCategory) float64 {
	return microUSDToUSD(EstimatedCostMicroUSD(category))
}

func EstimatedCostMicroUSD(category BudgetCategory) int64 {
	switch category {
	case BudgetCategoryVehicleData:
		return vehicleDataCostMicroUSD
	case BudgetCategoryWakeUp:
		return wakeUpCostMicroUSD
	case BudgetCategoryCommand:
		return commandCostMicroUSD
	case BudgetCategoryVehicleSpecs:
		return vehicleSpecsCostMicroUSD
	case BudgetCategoryOther:
		return otherRequestCostMicroUSD
	default:
		return 0
	}
}

func microUSDToUSD(value int64) float64 {
	return float64(value) / float64(MicroUSDPerUSD)
}

func usdToMicroUSD(value float64) int64 {
	if value <= 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return int64(math.Round(value * float64(MicroUSDPerUSD)))
}

type memoryRequestBudget struct {
	mu       sync.Mutex
	policy   BudgetPolicy
	now      func() time.Time
	snapshot BudgetSnapshot
}

func NewMemoryRequestBudget(policy BudgetPolicy) RequestBudget {
	return &memoryRequestBudget{
		policy: policy,
		now:    func() time.Time { return time.Now().UTC() },
	}
}

func (b *memoryRequestBudget) Reserve(_ context.Context, charge BudgetCharge) (BudgetSnapshot, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.rollPeriod()
	if err := charge.Validate(); err != nil {
		return b.snapshot, err
	}
	if !canReserve(b.snapshot, b.policy, charge) {
		return b.snapshot, &BudgetExceededError{Category: charge.Category, Snapshot: b.snapshot}
	}
	applyCharge(&b.snapshot, charge)
	return b.snapshot, nil
}

func (b *memoryRequestBudget) Snapshot(_ context.Context) (BudgetSnapshot, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.rollPeriod()
	return b.snapshot, nil
}

func (b *memoryRequestBudget) rollPeriod() {
	now := b.now().UTC()
	periodStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if b.snapshot.PeriodStart.Equal(periodStart) {
		return
	}
	b.snapshot = BudgetSnapshot{
		PeriodStart:            periodStart,
		ResetAt:                periodStart.Add(24 * time.Hour),
		DailyLimitMicroUSD:     b.policy.DailyLimitMicroUSD,
		CommandReserveMicroUSD: b.policy.CommandReserveMicroUSD,
	}
}

func canReserve(snapshot BudgetSnapshot, policy BudgetPolicy, charge BudgetCharge) bool {
	if !policy.Enabled() {
		return true
	}
	if snapshot.EstimatedCostMicroUSD+charge.EstimatedCostMicroUSD > policy.DailyLimitMicroUSD {
		return false
	}
	if !charge.UsesCommandReserve &&
		snapshot.BackgroundCostMicroUSD+charge.EstimatedCostMicroUSD > policy.BackgroundLimitMicroUSD() {
		return false
	}
	return true
}

func applyCharge(snapshot *BudgetSnapshot, charge BudgetCharge) {
	snapshot.TotalRequests++
	snapshot.EstimatedCostMicroUSD += charge.EstimatedCostMicroUSD
	if !charge.UsesCommandReserve {
		snapshot.BackgroundRequests++
		snapshot.BackgroundCostMicroUSD += charge.EstimatedCostMicroUSD
	}

	switch charge.Category {
	case BudgetCategoryVehicleData:
		snapshot.VehicleDataRequests++
	case BudgetCategoryWakeUp:
		snapshot.WakeUpRequests++
	case BudgetCategoryCommand:
		snapshot.CommandRequests++
	case BudgetCategoryVehicleSpecs:
		snapshot.VehicleSpecsRequests++
	default:
		snapshot.OtherRequests++
	}
}
