// Package monthlytariff compares recorded charging under an unchanged schedule.
package monthlytariff

import (
	"math"
	"sort"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
)

const (
	MaxSessions  = 512
	maxRateBands = 64
	maxFeeMinor  = 1_000_000_000
)

type MeteredSession struct {
	Start, End        time.Time
	BilledWh          float64
	BilledEnergyMinor int64
}

type Month struct {
	From, Through time.Time
	Observed      int
	Metered       []MeteredSession
}

type CostRange struct {
	LowerMinor int64 `json:"lower_minor"`
	UpperMinor int64 `json:"upper_minor"`
}

type Comparison struct {
	Days              int       `json:"days"`
	Sessions          int       `json:"sessions"`
	EnergyWh          float64   `json:"energy_wh"`
	Current           CostRange `json:"current"`
	Alternative       CostRange `json:"alternative"`
	CurrentFixedMinor int64     `json:"current_fixed_minor"`
	AltFixedMinor     int64     `json:"alternative_fixed_minor"`
	SwitchFeeMinor    int64     `json:"switch_fee_minor"`
	NetSavings        CostRange `json:"net_savings"`
}

type Outcome string

const (
	MaterialSavings      Outcome = "material_savings"
	InsufficientEvidence Outcome = "insufficient_evidence"
	UnsupportedTariff    Outcome = "unsupported_tariff"
	TermsDoNotMatch      Outcome = "terms_do_not_match"
	BelowMinimum         Outcome = "below_minimum"
)

type bounds struct{ low, high float64 }

func emptyBounds() bounds { return bounds{low: math.Inf(1), high: math.Inf(-1)} }

func (b *bounds) observe(value float64) {
	b.low, b.high = math.Min(b.low, value), math.Max(b.high, value)
}

func (b *bounds) add(other bounds, scale float64) {
	b.low += other.low * scale
	b.high += other.high * scale
}

func (b bounds) minor() CostRange {
	return CostRange{LowerMinor: int64(math.Floor(b.low)), UpperMinor: int64(math.Ceil(b.high))}
}

func Replay(month Month, current, alternative domain.Tariff, switchFee, minimum int64) (*Comparison, Outcome) {
	local := month.From
	start := time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, local.Location())
	if local.Year() < 2000 || !local.Equal(start) || !month.Through.Equal(start.AddDate(0, 1, 0)) ||
		month.Observed != len(month.Metered) || month.Observed < 4 || month.Observed > MaxSessions {
		return nil, InsufficientEvidence
	}
	if current.ID <= 0 || !current.IsCurrent || alternative.ID <= 0 || current.ID == alternative.ID ||
		alternative.IsCurrent || current.Currency != alternative.Currency || !validPlan(current) || !validPlan(alternative) ||
		switchFee < 0 || switchFee > maxFeeMinor || minimum <= 0 || minimum > maxFeeMinor {
		return nil, UnsupportedTariff
	}
	days := start.AddDate(0, 1, -1).Day()
	comp := Comparison{Days: days, Sessions: month.Observed, SwitchFeeMinor: switchFee}
	sessions := append([]MeteredSession(nil), month.Metered...)
	sort.Slice(sessions, func(i, j int) bool { return sessions[i].Start.Before(sessions[j].Start) })
	last := month.From
	for _, s := range sessions {
		if s.Start.Before(last) || !s.Start.Before(s.End) || s.End.After(month.Through) ||
			s.End.Sub(s.Start) > 24*time.Hour || !(s.BilledWh >= 100 && s.BilledWh <= 1_000_000) {
			return nil, InsufficientEvidence
		}
		last = s.End
	}

	currFixed, altFixed := float64(days)*current.StandingChargeMinorPerDay, float64(days)*alternative.StandingChargeMinorPerDay
	comp.CurrentFixedMinor, comp.AltFixedMinor = int64(math.Round(currFixed)), int64(math.Round(altFixed))
	// The receipt establishes total Wh, not its distribution across rate bands.
	// Bound costs and savings at the observed times instead of shifting or spreading load.
	curr, alt := bounds{currFixed, currFixed}, bounds{altFixed, altFixed}
	fixedDelta := currFixed - altFixed - float64(switchFee)
	savings := bounds{fixedDelta, fixedDelta}
	for _, s := range sessions {
		before, after, delta := emptyBounds(), emptyBounds(), emptyBounds()
		for at := s.Start.In(local.Location()); at.Before(s.End); at = nextMinute(at) {
			a, aOK := unambiguousPrice(current.Rates, at)
			b, bOK := unambiguousPrice(alternative.Rates, at)
			if !aOK || !bOK {
				return nil, UnsupportedTariff
			}
			before.observe(a)
			after.observe(b)
			delta.observe(a - b)
		}
		if s.BilledEnergyMinor < int64(math.Floor(before.low*s.BilledWh)) ||
			s.BilledEnergyMinor > int64(math.Ceil(before.high*s.BilledWh)) {
			return nil, TermsDoNotMatch
		}
		curr.add(before, s.BilledWh)
		alt.add(after, s.BilledWh)
		savings.add(delta, s.BilledWh)
		comp.EnergyWh += s.BilledWh
	}
	comp.Current, comp.Alternative, comp.NetSavings = curr.minor(), alt.minor(), savings.minor()
	if comp.NetSavings.LowerMinor < minimum {
		return nil, BelowMinimum
	}
	return &comp, MaterialSavings
}

func validPlan(t domain.Tariff) bool {
	if (t.Structure != domain.TariffFlat && t.Structure != domain.TariffTOU) ||
		len(t.Currency) != 3 || !(t.StandingChargeMinorPerDay >= 0 && t.StandingChargeMinorPerDay <= maxFeeMinor) ||
		t.DemandChargeMinorPerW != 0 || t.ExportPriceMinorPerWh != 0 || len(t.Rates) == 0 || len(t.Rates) > maxRateBands {
		return false
	}
	for _, rate := range t.Rates {
		if rate.TierUpperWh != nil || rate.DayMask < 1 || rate.DayMask > 127 ||
			rate.StartMinute < 0 || rate.EndMinute > 1440 || rate.StartMinute >= rate.EndMinute ||
			rate.SeasonStartMonth < 1 || rate.SeasonStartMonth > 12 || rate.SeasonEndMonth < 1 || rate.SeasonEndMonth > 12 ||
			!(rate.PriceMinorPerWh >= 0 && rate.PriceMinorPerWh <= 100) {
			return false
		}
	}
	return true
}

func nextMinute(at time.Time) time.Time {
	return at.Add(time.Minute - time.Duration(at.Second())*time.Second - time.Duration(at.Nanosecond()))
}

func unambiguousPrice(rates []domain.TariffRate, at time.Time) (float64, bool) {
	minute, month := at.Hour()*60+at.Minute(), int(at.Month())
	day := 1 << at.Weekday()
	price, found := 0.0, false
	for _, rate := range rates {
		if rate.DayMask&day == 0 || minute < rate.StartMinute || minute >= rate.EndMinute {
			continue
		}
		start, end := rate.SeasonStartMonth, rate.SeasonEndMonth
		if (start <= end && (month < start || month > end)) || (start > end && month < start && month > end) {
			continue
		}
		if found {
			return 0, false
		}
		price, found = rate.PriceMinorPerWh, true
	}
	return price, found
}
