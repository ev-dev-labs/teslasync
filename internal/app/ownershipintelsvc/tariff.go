package ownershipintelsvc

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

// sliceMinutes is the resolution at which a charging session's energy is
// spread across time-of-use bands. Fifteen minutes matches the settlement
// interval used by most electricity markets.
const sliceMinutes = 15

// ListTariffs returns the authored rate-plan catalogue.
func (s *Service) ListTariffs(
	ctx context.Context,
	subject string,
	limit, offset int,
) (*domain.Page[domain.Tariff], error) {
	limit, offset = normalizePage(limit, offset)
	records, total, err := s.durable.ListTariffs(ctx, subject, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list tariffs: %w", err)
	}
	items := make([]domain.Tariff, 0, len(records))
	for _, record := range records {
		items = append(items, tariffToDomain(record))
	}
	return &domain.Page[domain.Tariff]{Items: items, Total: total, Limit: limit, Offset: offset}, nil
}

// CreateTariff authors a rate plan together with all of its price bands.
func (s *Service) CreateTariff(
	ctx context.Context,
	subject string,
	request domain.CreateTariffRequest,
) (*domain.Tariff, error) {
	name, ok := requireText(request.Name, 160)
	if !ok {
		return nil, fmt.Errorf("%w: name is required", ErrInvalidInput)
	}
	provider, ok := cleanText(request.Provider, 160)
	if !ok {
		return nil, fmt.Errorf("%w: provider is too long", ErrInvalidInput)
	}
	currency, ok := validCurrency(request.Currency)
	if !ok {
		return nil, fmt.Errorf("%w: currency must be an ISO-4217 alpha-3 code", ErrInvalidInput)
	}
	if !isValidStructure(request.Structure) {
		return nil, fmt.Errorf("%w: structure is not supported", ErrInvalidInput)
	}
	if !requireNonNegF(request.StandingChargeMinorPerDay) ||
		!requireNonNegF(request.DemandChargeMinorPerW) ||
		!requireNonNegF(request.ExportPriceMinorPerWh) {
		return nil, fmt.Errorf("%w: charges must not be negative", ErrInvalidInput)
	}
	if len(request.Rates) == 0 {
		return nil, fmt.Errorf("%w: at least one price band is required", ErrInvalidInput)
	}
	if len(request.Rates) > 48 {
		return nil, fmt.Errorf("%w: a tariff cannot exceed 48 price bands", ErrInvalidInput)
	}
	rates := make([]port.TariffRateRecord, 0, len(request.Rates))
	for index, rate := range request.Rates {
		if rate.DayMask < 1 || rate.DayMask > 127 {
			return nil, fmt.Errorf("%w: band %d has an invalid day_mask", ErrInvalidInput, index+1)
		}
		if rate.StartMinute < 0 || rate.StartMinute > 1439 || rate.EndMinute <= rate.StartMinute || rate.EndMinute > 1440 {
			return nil, fmt.Errorf("%w: band %d has an invalid time window", ErrInvalidInput, index+1)
		}
		if !requireNonNegF(rate.PriceMinorPerWh) {
			return nil, fmt.Errorf("%w: band %d has an invalid price", ErrInvalidInput, index+1)
		}
		if rate.TierUpperWh != nil && *rate.TierUpperWh <= 0 {
			return nil, fmt.Errorf("%w: band %d has an invalid tier ceiling", ErrInvalidInput, index+1)
		}
		if rate.SeasonStartMonth < 1 || rate.SeasonStartMonth > 12 ||
			rate.SeasonEndMonth < 1 || rate.SeasonEndMonth > 12 {
			return nil, fmt.Errorf("%w: band %d has an invalid season", ErrInvalidInput, index+1)
		}
		label, ok := cleanText(rate.Label, 80)
		if !ok {
			return nil, fmt.Errorf("%w: band %d label is too long", ErrInvalidInput, index+1)
		}
		rates = append(rates, port.TariffRateRecord{
			Label:            label,
			DayMask:          rate.DayMask,
			StartMinute:      rate.StartMinute,
			EndMinute:        rate.EndMinute,
			PriceMinorPerWh:  rate.PriceMinorPerWh,
			TierUpperWh:      rate.TierUpperWh,
			SeasonStartMonth: rate.SeasonStartMonth,
			SeasonEndMonth:   rate.SeasonEndMonth,
		})
	}
	record, err := s.durable.CreateTariff(ctx, subject, port.TariffRecord{
		Name:                      name,
		Provider:                  provider,
		Currency:                  currency,
		Structure:                 string(request.Structure),
		StandingChargeMinorPerDay: request.StandingChargeMinorPerDay,
		DemandChargeMinorPerW:     request.DemandChargeMinorPerW,
		ExportPriceMinorPerWh:     request.ExportPriceMinorPerWh,
		IsCurrent:                 request.IsCurrent,
		Rates:                     rates,
	})
	if err != nil {
		return nil, fmt.Errorf("create tariff: %w", err)
	}
	tariff := tariffToDomain(*record)
	return &tariff, nil
}

// DeleteTariff removes a rate plan and cascades its bands.
func (s *Service) DeleteTariff(ctx context.Context, subject string, id int64) error {
	if id <= 0 {
		return fmt.Errorf("%w: tariff id must be positive", ErrInvalidInput)
	}
	if err := s.durable.DeleteTariff(ctx, subject, id); err != nil {
		return fmt.Errorf("delete tariff: %w", err)
	}
	return nil
}

// SimulateTariffs replays measured charging load against every selected plan.
func (s *Service) SimulateTariffs(
	ctx context.Context,
	subject string,
	request domain.TariffSimulationRequest,
) (*domain.TariffSimulationResponse, error) {
	if request.VehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	if !request.Confirmed {
		return nil, ErrNotConfirmed
	}
	if request.ShiftablePct < 0 || request.ShiftablePct > 100 {
		return nil, fmt.Errorf("%w: shiftable_pct must be between 0 and 100", ErrInvalidInput)
	}
	if request.SwitchFeeMinor < 0 {
		return nil, fmt.Errorf("%w: switch_fee_minor must not be negative", ErrInvalidInput)
	}
	if len(request.TariffIDs) == 0 {
		return nil, fmt.Errorf("%w: at least one tariff_id is required", ErrInvalidInput)
	}
	if len(request.TariffIDs) > 12 {
		return nil, fmt.Errorf("%w: at most 12 tariffs can be compared at once", ErrInvalidInput)
	}
	window := s.window(request.WindowDays)
	tariffs, err := s.durable.GetTariffs(ctx, subject, request.TariffIDs)
	if err != nil {
		return nil, fmt.Errorf("load tariffs: %w", err)
	}
	if len(tariffs) == 0 {
		return nil, fmt.Errorf("%w: none of the requested tariffs exist", ErrInvalidInput)
	}
	charges, err := s.source.ListCharges(ctx, request.VehicleID, window.From, window.To)
	if err != nil {
		return nil, fmt.Errorf("list charging sessions: %w", err)
	}

	slices, peakPowerW, sessionCount, observedEnergy := buildLoadSlices(charges)
	response := &domain.TariffSimulationResponse{
		VehicleID:        request.VehicleID,
		Window:           window,
		SessionCount:     sessionCount,
		ObservedEnergyWh: observedEnergy,
		ShiftablePct:     request.ShiftablePct,
		Results:          []domain.TariffSimulationResult{},
		Evidence:         []domain.Evidence{},
	}
	if len(slices) == 0 {
		response.Quality = quality(
			domain.QualityInsufficient, 0, nil, window,
			"no charging sessions with measured energy were found in the selected window",
		)
		return response, nil
	}

	observedDays := math.Max(window.To.Sub(window.From).Hours()/24, 1)
	annualFactor := 365.0 / observedDays

	results := make([]domain.TariffSimulationResult, 0, len(tariffs))
	for _, record := range tariffs {
		results = append(results, evaluateTariff(record, slices, peakPowerW, observedDays, annualFactor, request.ShiftablePct))
	}
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].AnnualCostMinor == results[j].AnnualCostMinor {
			return results[i].Name < results[j].Name
		}
		return results[i].AnnualCostMinor < results[j].AnnualCostMinor
	})

	var currentCost *int64
	for _, result := range results {
		if result.IsCurrent {
			cost := result.AnnualCostMinor
			currentCost = &cost
			id := result.TariffID
			response.CurrentTariffID = &id
			break
		}
	}
	for index := range results {
		results[index].Rank = index + 1
		if currentCost != nil {
			delta := results[index].AnnualCostMinor - *currentCost
			results[index].DeltaVsCurrentMinor = &delta
			if delta < 0 && request.SwitchFeeMinor > 0 {
				dailySaving := float64(-delta) / 365.0
				if dailySaving > 0 {
					days := int(math.Ceil(float64(request.SwitchFeeMinor) / dailySaving))
					results[index].BreakEvenDays = &days
				}
			} else if delta < 0 {
				days := 0
				results[index].BreakEvenDays = &days
			}
		}
	}
	response.Results = results
	if len(results) > 0 {
		best := results[0].TariffID
		response.BestTariffID = &best
		if currentCost != nil {
			saving := *currentCost - results[0].AnnualCostMinor
			response.MaxSavingMinor = &saving
		}
	}

	reasons := []string{}
	if response.CurrentTariffID == nil {
		reasons = append(reasons, "no tariff is flagged as current, so switching deltas are unavailable")
	}
	if sessionCount < 10 {
		reasons = append(reasons, "fewer than 10 charging sessions; annualised cost carries wide uncertainty")
	}
	response.Quality = quality(
		gradeQuality(sessionCount, 5, 20),
		sessionCount,
		domain.Float64Pointer(clamp(float64(sessionCount)/20*100, 0, 100)),
		window,
		reasons...,
	)
	response.Evidence = append(response.Evidence, evidence(
		"charging_sessions",
		domain.TimePointer(window.To),
		domain.IntPointer(sessionCount),
		fmt.Sprintf(
			"%.0f Wh of measured charging load across %d sessions was spread over %d-minute settlement slices and priced under %d plans.",
			observedEnergy, sessionCount, sliceMinutes, len(results),
		),
	))
	return response, nil
}

type loadSlice struct {
	At       time.Time
	EnergyWh float64
}

func buildLoadSlices(charges []port.ChargeRecord) ([]loadSlice, float64, int, float64) {
	slices := make([]loadSlice, 0, len(charges)*8)
	peakPowerW := 0.0
	sessionCount := 0
	totalEnergy := 0.0
	for _, charge := range charges {
		energy := deref(charge.EnergyAddedWh)
		if energy <= 0 {
			continue
		}
		sessionCount++
		totalEnergy += energy
		if charge.PeakPowerW != nil && *charge.PeakPowerW > peakPowerW {
			peakPowerW = *charge.PeakPowerW
		}
		end := charge.StartedAt.Add(time.Hour)
		if charge.EndedAt != nil && charge.EndedAt.After(charge.StartedAt) {
			end = *charge.EndedAt
		}
		totalMinutes := end.Sub(charge.StartedAt).Minutes()
		if totalMinutes <= 0 {
			totalMinutes = float64(sliceMinutes)
		}
		steps := int(math.Ceil(totalMinutes / sliceMinutes))
		if steps <= 0 {
			steps = 1
		}
		if steps > 480 {
			steps = 480
		}
		perSlice := energy / float64(steps)
		for step := 0; step < steps; step++ {
			slices = append(slices, loadSlice{
				At:       charge.StartedAt.Add(time.Duration(step*sliceMinutes) * time.Minute).UTC(),
				EnergyWh: perSlice,
			})
		}
	}
	sort.SliceStable(slices, func(i, j int) bool { return slices[i].At.Before(slices[j].At) })
	return slices, peakPowerW, sessionCount, totalEnergy
}

func evaluateTariff(
	record port.TariffRecord,
	slices []loadSlice,
	peakPowerW float64,
	observedDays, annualFactor, shiftablePct float64,
) domain.TariffSimulationResult {
	result := domain.TariffSimulationResult{
		TariffID:  record.ID,
		Name:      record.Name,
		Provider:  record.Provider,
		Structure: domain.TariffStructure(record.Structure),
		Currency:  record.Currency,
		IsCurrent: record.IsCurrent,
		Bands:     []domain.TariffBandUsage{},
		Warnings:  []string{},
	}
	if len(record.Rates) == 0 {
		result.Warnings = append(result.Warnings, "tariff has no price bands; cost cannot be modelled")
		return result
	}

	bandEnergy := map[int64]float64{}
	bandCost := map[int64]float64{}
	bandPrice := map[int64]float64{}
	bandLabel := map[int64]string{}
	monthlyCumulative := map[string]float64{}
	energyCost := 0.0
	totalEnergy := 0.0
	unmatchedEnergy := 0.0
	fallbackPrice := averagePrice(record.Rates)

	for _, slice := range slices {
		totalEnergy += slice.EnergyWh
		monthKey := slice.At.Format("2006-01")
		cumulative := monthlyCumulative[monthKey]
		rate, matched := selectRate(record, slice.At, cumulative)
		price := fallbackPrice
		var rateID int64 = -1
		label := "unmatched"
		if matched {
			price = rate.PriceMinorPerWh
			rateID = rate.ID
			label = rate.Label
			if label == "" {
				label = defaultBandLabel(rate)
			}
		} else {
			unmatchedEnergy += slice.EnergyWh
		}
		cost := slice.EnergyWh * price
		energyCost += cost
		bandEnergy[rateID] += slice.EnergyWh
		bandCost[rateID] += cost
		bandPrice[rateID] = price
		bandLabel[rateID] = label
		monthlyCumulative[monthKey] = cumulative + slice.EnergyWh
	}

	standingCost := record.StandingChargeMinorPerDay * observedDays
	demandCost := 0.0
	if record.DemandChargeMinorPerW > 0 && peakPowerW > 0 {
		months := math.Max(observedDays/30.44, 1)
		demandCost = record.DemandChargeMinorPerW * peakPowerW * months
		result.PeakDemandW = domain.Float64Pointer(peakPowerW)
	}

	result.ObservedEnergyWh = totalEnergy
	result.AnnualisedEnergyWh = totalEnergy * annualFactor
	result.EnergyCostMinor = roundMinor(energyCost * annualFactor)
	result.StandingCostMinor = roundMinor(standingCost * annualFactor)
	result.DemandCostMinor = roundMinor(demandCost * annualFactor)
	result.AnnualCostMinor = result.EnergyCostMinor + result.StandingCostMinor + result.DemandCostMinor
	if totalEnergy > 0 {
		result.EffectivePriceMinorPerWh = energyCost / totalEnergy
	}

	cheapest := cheapestPrice(record.Rates)
	if shiftablePct > 0 && totalEnergy > 0 {
		saving := 0.0
		for rateID, energy := range bandEnergy {
			price := bandPrice[rateID]
			if price <= cheapest {
				continue
			}
			saving += energy * shiftablePct / 100 * (price - cheapest)
		}
		result.LoadShiftSavingMinor = roundMinor(saving * annualFactor)
	}

	ids := make([]int64, 0, len(bandEnergy))
	for id := range bandEnergy {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return bandCost[ids[i]] > bandCost[ids[j]] })
	for _, id := range ids {
		share := 0.0
		if totalEnergy > 0 {
			share = bandEnergy[id] / totalEnergy * 100
		}
		result.Bands = append(result.Bands, domain.TariffBandUsage{
			Label:           bandLabel[id],
			EnergyWh:        bandEnergy[id],
			SharePct:        share,
			PriceMinorPerWh: bandPrice[id],
			CostMinor:       roundMinor(bandCost[id] * annualFactor),
		})
	}
	if unmatchedEnergy > 0 {
		share := unmatchedEnergy / math.Max(totalEnergy, 1) * 100
		result.Warnings = append(result.Warnings, fmt.Sprintf(
			"%.1f%% of load fell outside every configured band and was priced at the plan average",
			share,
		))
	}
	return result
}

func defaultBandLabel(rate port.TariffRateRecord) string {
	return fmt.Sprintf("%02d:%02d-%02d:%02d",
		rate.StartMinute/60, rate.StartMinute%60,
		(rate.EndMinute/60)%24, rate.EndMinute%60,
	)
}

// selectRate finds the price band that governs one settlement slice. Tiered
// plans resolve by cumulative monthly energy; everything else resolves by
// weekday, minute of day, and season.
func selectRate(record port.TariffRecord, at time.Time, cumulativeWh float64) (port.TariffRateRecord, bool) {
	if record.Structure == string(domain.TariffTiered) {
		tiers := append([]port.TariffRateRecord(nil), record.Rates...)
		sort.SliceStable(tiers, func(i, j int) bool {
			left := math.Inf(1)
			right := math.Inf(1)
			if tiers[i].TierUpperWh != nil {
				left = *tiers[i].TierUpperWh
			}
			if tiers[j].TierUpperWh != nil {
				right = *tiers[j].TierUpperWh
			}
			return left < right
		})
		for _, tier := range tiers {
			if tier.TierUpperWh == nil || cumulativeWh < *tier.TierUpperWh {
				return tier, true
			}
		}
		if len(tiers) > 0 {
			return tiers[len(tiers)-1], true
		}
		return port.TariffRateRecord{}, false
	}
	minute := at.Hour()*60 + at.Minute()
	weekday := int(at.Weekday())
	month := int(at.Month())
	for _, rate := range record.Rates {
		if rate.DayMask&(1<<weekday) == 0 {
			continue
		}
		if minute < rate.StartMinute || minute >= rate.EndMinute {
			continue
		}
		if !inSeason(month, rate.SeasonStartMonth, rate.SeasonEndMonth) {
			continue
		}
		return rate, true
	}
	return port.TariffRateRecord{}, false
}

func inSeason(month, start, end int) bool {
	if start <= end {
		return month >= start && month <= end
	}
	return month >= start || month <= end
}

func averagePrice(rates []port.TariffRateRecord) float64 {
	if len(rates) == 0 {
		return 0
	}
	total := 0.0
	for _, rate := range rates {
		total += rate.PriceMinorPerWh
	}
	return total / float64(len(rates))
}

func cheapestPrice(rates []port.TariffRateRecord) float64 {
	cheapest := math.Inf(1)
	for _, rate := range rates {
		if rate.PriceMinorPerWh < cheapest {
			cheapest = rate.PriceMinorPerWh
		}
	}
	if math.IsInf(cheapest, 1) {
		return 0
	}
	return cheapest
}

func isValidStructure(structure domain.TariffStructure) bool {
	switch structure {
	case domain.TariffFlat, domain.TariffTOU, domain.TariffTiered,
		domain.TariffRealTime, domain.TariffDemand:
		return true
	default:
		return false
	}
}

func tariffToDomain(record port.TariffRecord) domain.Tariff {
	rates := make([]domain.TariffRate, 0, len(record.Rates))
	for _, rate := range record.Rates {
		rates = append(rates, domain.TariffRate{
			ID:               rate.ID,
			Label:            rate.Label,
			DayMask:          rate.DayMask,
			StartMinute:      rate.StartMinute,
			EndMinute:        rate.EndMinute,
			PriceMinorPerWh:  rate.PriceMinorPerWh,
			TierUpperWh:      rate.TierUpperWh,
			SeasonStartMonth: rate.SeasonStartMonth,
			SeasonEndMonth:   rate.SeasonEndMonth,
		})
	}
	return domain.Tariff{
		ID:                        record.ID,
		Name:                      record.Name,
		Provider:                  record.Provider,
		Currency:                  record.Currency,
		Structure:                 domain.TariffStructure(record.Structure),
		StandingChargeMinorPerDay: record.StandingChargeMinorPerDay,
		DemandChargeMinorPerW:     record.DemandChargeMinorPerW,
		ExportPriceMinorPerWh:     record.ExportPriceMinorPerWh,
		IsCurrent:                 record.IsCurrent,
		Version:                   record.Version,
		Rates:                     rates,
		CreatedAt:                 record.CreatedAt,
		UpdatedAt:                 record.UpdatedAt,
	}
}
