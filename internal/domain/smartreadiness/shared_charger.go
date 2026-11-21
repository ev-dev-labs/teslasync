package smartreadiness

import (
	"math"
	"math/big"
	"time"
)

const sharedChargerSwapBuffer = 10 * time.Minute

// SharedChargerRequest describes one authorized vehicle's remaining charging
// need. AlreadyPlugged means it currently occupies the declared charger.
type SharedChargerRequest struct {
	VehicleID          int64
	AvailableAt        time.Time
	DepartureAt        time.Time
	EnergyNeededWh     float64
	ConservativePowerW float64
	AlreadyPlugged     bool
}

type SharedChargerSlot struct {
	VehicleID int64
	StartsAt  time.Time
	EndsAt    time.Time
}

// SharedChargerSchedule is an advisory plan in UTC. SwapAt is when the first
// slot ends and the manual handoff can begin.
type SharedChargerSchedule struct {
	First  SharedChargerSlot
	Second SharedChargerSlot
	SwapAt time.Time
}

// PlanSharedCharger returns a plan only for two overlapping charging windows
// when both vehicles can finish by departure. The caller must establish consent,
// charger scope, and the suitability of the energy and power estimates.
func PlanSharedCharger(now time.Time, a, b SharedChargerRequest) *SharedChargerSchedule {
	if now.IsZero() || a.VehicleID == b.VehicleID || (a.AlreadyPlugged && b.AlreadyPlugged) {
		return nil
	}

	now = now.UTC()
	first, firstOK := prepareSharedChargerJob(now, a)
	second, secondOK := prepareSharedChargerJob(now, b)
	if !firstOK || !secondOK {
		return nil
	}

	// Touching but non-overlapping declared windows do not require coordination.
	if !first.AvailableAt.Before(second.DepartureAt) || !second.AvailableAt.Before(first.DepartureAt) {
		return nil
	}

	if second.preferredBefore(first) {
		first, second = second, first
	}
	if schedule := planSharedChargerOrder(now, first, second); schedule != nil {
		return schedule
	}
	// With release times, waiting for the earlier deadline can waste time the
	// other vehicle could have used. Try the only remaining order.
	return planSharedChargerOrder(now, second, first)
}

type sharedChargerJob struct {
	SharedChargerRequest
	duration time.Duration
}

func prepareSharedChargerJob(now time.Time, request SharedChargerRequest) (sharedChargerJob, bool) {
	if request.VehicleID <= 0 || request.AvailableAt.IsZero() || request.DepartureAt.IsZero() {
		return sharedChargerJob{}, false
	}
	request.AvailableAt = request.AvailableAt.UTC()
	if request.AvailableAt.Before(now) {
		request.AvailableAt = now
	}
	request.DepartureAt = request.DepartureAt.UTC()
	duration := sharedChargerDuration(request.EnergyNeededWh, request.ConservativePowerW)
	if duration == 0 || duration > request.DepartureAt.Sub(request.AvailableAt) {
		return sharedChargerJob{}, false
	}
	return sharedChargerJob{SharedChargerRequest: request, duration: duration}, true
}

func sharedChargerDuration(energyWh, powerW float64) time.Duration {
	if energyWh <= 0 || powerW <= 0 || math.IsNaN(energyWh) || math.IsNaN(powerW) ||
		math.IsInf(energyWh, 0) || math.IsInf(powerW, 0) {
		return 0
	}

	// Round to whole minutes without floating-point rounding potentially
	// pulling a duration just above a minute boundary down to the boundary.
	minutes := new(big.Rat).SetFloat64(energyWh)
	minutes.Mul(minutes, big.NewRat(60, 1))
	minutes.Quo(minutes, new(big.Rat).SetFloat64(powerW))
	var whole, remainder big.Int
	whole.QuoRem(minutes.Num(), minutes.Denom(), &remainder)
	if remainder.Sign() > 0 {
		whole.Add(&whole, big.NewInt(1))
	}
	if !whole.IsInt64() || whole.Int64() > int64(math.MaxInt64/time.Minute) {
		return 0
	}
	return time.Duration(whole.Int64()) * time.Minute
}

func (job sharedChargerJob) preferredBefore(other sharedChargerJob) bool {
	if job.AlreadyPlugged != other.AlreadyPlugged {
		return job.AlreadyPlugged
	}
	if !job.DepartureAt.Equal(other.DepartureAt) {
		return job.DepartureAt.Before(other.DepartureAt)
	}
	return job.VehicleID < other.VehicleID
}

func (job sharedChargerJob) slot(notBefore time.Time) (SharedChargerSlot, bool) {
	startsAt := job.AvailableAt
	if startsAt.Before(notBefore) {
		startsAt = notBefore
	}
	if job.duration > job.DepartureAt.Sub(startsAt) {
		return SharedChargerSlot{}, false
	}
	return SharedChargerSlot{VehicleID: job.VehicleID, StartsAt: startsAt, EndsAt: startsAt.Add(job.duration)}, true
}

func planSharedChargerOrder(now time.Time, first, second sharedChargerJob) *SharedChargerSchedule {
	if second.AlreadyPlugged {
		// If preserving occupancy cannot work, allow time for the initial
		// manual changeover too. Only the handoff after the first slot is SwapAt.
		now = now.Add(sharedChargerSwapBuffer)
	}
	firstSlot, ok := first.slot(now)
	if !ok {
		return nil
	}
	swapAt := firstSlot.EndsAt
	secondSlot, ok := second.slot(swapAt.Add(sharedChargerSwapBuffer))
	if !ok {
		return nil
	}
	return &SharedChargerSchedule{First: firstSlot, Second: secondSlot, SwapAt: swapAt}
}
