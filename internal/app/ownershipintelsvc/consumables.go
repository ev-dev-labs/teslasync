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

// consumableDefaults carry the rated life used when the user does not supply
// one. Values are conservative manufacturer guidance expressed in SI.
var consumableDefaults = map[domain.ConsumableCategory]struct {
	label      string
	lifeM      float64
	lifeS      int64
	stressCode string
}{
	domain.ConsumableTire:        {"Tire", 48_000_000, 0, "tire"},
	domain.ConsumableCabinFilter: {"Cabin filter", 0, 2 * 365 * 24 * 3600, "cabin"},
	domain.ConsumableHEPAFilter:  {"HEPA filter", 0, 3 * 365 * 24 * 3600, "cabin"},
	domain.ConsumableWiper:       {"Wiper blade", 0, 365 * 24 * 3600, "cabin"},
	domain.ConsumableBrakeFluid:  {"Brake fluid", 0, 2 * 365 * 24 * 3600, "brake"},
	domain.ConsumableCoolant:     {"Coolant", 0, 4 * 365 * 24 * 3600, "thermal"},
	domain.ConsumableBrakePad:    {"Brake pad", 160_000_000, 0, "brake"},
	domain.ConsumableSuspension:  {"Suspension component", 200_000_000, 0, "suspension"},
	domain.ConsumableKeyBattery:  {"Key fob battery", 0, 365 * 24 * 3600, "none"},
	domain.ConsumableOther:       {"Other consumable", 0, 0, "none"},
}

const (
	// dueSoonPct is the health level at which a part is surfaced as due soon.
	dueSoonPct = 20.0
	// stressWindowDays is the trailing evidence window for duty-cycle stress.
	stressWindowDays = 120
	// Baselines the observed duty cycle is compared against. They are fixed
	// and disclosed so a multiplier can always be explained.
	baselineAvgSpeedMps   = 13.9
	baselineRegenShare    = 0.14
	baselinePowerRatio    = 2.0
	baselineAmbientC      = 18.0
	baselineTripLengthM   = 18_000.0
	maxStressMultiplier   = 2.5
	minStressMultiplier   = 0.6
	monthsInProjection    = 12
	minDrivesForDutyCycle = 12
)

// ListConsumables returns every stored wear part for a vehicle.
func (s *Service) ListConsumables(ctx context.Context, subject string, vehicleID int64) ([]domain.ConsumableItem, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	records, err := s.durable.ListItems(ctx, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list consumable items: %w", err)
	}
	items := make([]domain.ConsumableItem, 0, len(records))
	for _, record := range records {
		items = append(items, consumableItemToDomain(record))
	}
	return items, nil
}

// CreateConsumable registers a wear part.
func (s *Service) CreateConsumable(
	ctx context.Context,
	subject string,
	request domain.CreateConsumableItemRequest,
) (*domain.ConsumableItem, error) {
	if request.VehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	defaults, known := consumableDefaults[request.Category]
	if !known {
		return nil, fmt.Errorf("%w: category is not a recognised wear-part family", ErrInvalidInput)
	}
	label := request.Label
	if label == "" {
		label = defaults.label
	}
	label, ok := requireText(label, 160)
	if !ok {
		return nil, fmt.Errorf("%w: label is required", ErrInvalidInput)
	}
	position, ok := cleanText(request.Position, 60)
	if !ok {
		return nil, fmt.Errorf("%w: position is too long", ErrInvalidInput)
	}
	notes, ok := cleanText(request.Notes, 2000)
	if !ok {
		return nil, fmt.Errorf("%w: notes are too long", ErrInvalidInput)
	}
	if request.InstalledAt.IsZero() {
		return nil, fmt.Errorf("%w: installed_at is required", ErrInvalidInput)
	}
	if request.InstalledAt.After(s.now().Add(time.Hour)) {
		return nil, fmt.Errorf("%w: installed_at cannot be in the future", ErrInvalidInput)
	}
	if !requireNonNegF(request.InstalledOdometerM) {
		return nil, fmt.Errorf("%w: installed_odometer_m must not be negative", ErrInvalidInput)
	}
	ratedLifeM := request.RatedLifeM
	if ratedLifeM == nil && defaults.lifeM > 0 {
		ratedLifeM = pointer(defaults.lifeM)
	}
	if ratedLifeM != nil && (*ratedLifeM <= 0 || *ratedLifeM > 2_000_000_000) {
		return nil, fmt.Errorf("%w: rated_life_m is out of range", ErrInvalidInput)
	}
	ratedLifeS := request.RatedLifeS
	if ratedLifeS == nil && defaults.lifeS > 0 {
		ratedLifeS = pointer(defaults.lifeS)
	}
	if ratedLifeS != nil && (*ratedLifeS <= 0 || *ratedLifeS > 30*365*24*3600) {
		return nil, fmt.Errorf("%w: rated_life_s is out of range", ErrInvalidInput)
	}
	if ratedLifeM == nil && ratedLifeS == nil {
		return nil, fmt.Errorf("%w: supply rated_life_m or rated_life_s for this category", ErrInvalidInput)
	}
	currency, ok := validCurrency(request.Currency)
	if !ok {
		return nil, fmt.Errorf("%w: currency must be an ISO-4217 alpha-3 code", ErrInvalidInput)
	}
	if !requireNonNeg(request.CostMinor) {
		return nil, fmt.Errorf("%w: cost_minor must not be negative", ErrInvalidInput)
	}
	record, err := s.durable.CreateItem(ctx, subject, port.ConsumableItemRecord{
		VehicleID:          request.VehicleID,
		Category:           string(request.Category),
		Label:              label,
		Position:           position,
		InstalledAt:        request.InstalledAt.UTC(),
		InstalledOdometerM: request.InstalledOdometerM,
		RatedLifeM:         ratedLifeM,
		RatedLifeS:         ratedLifeS,
		CostMinor:          request.CostMinor,
		Currency:           currency,
		Notes:              notes,
	})
	if err != nil {
		return nil, fmt.Errorf("create consumable item: %w", err)
	}
	item := consumableItemToDomain(*record)
	return &item, nil
}

// DeleteConsumable removes a wear part and its events.
func (s *Service) DeleteConsumable(ctx context.Context, subject string, id int64) error {
	if id <= 0 {
		return fmt.Errorf("%w: consumable item id must be positive", ErrInvalidInput)
	}
	if err := s.durable.DeleteItem(ctx, subject, id); err != nil {
		return fmt.Errorf("delete consumable item: %w", err)
	}
	return nil
}

// CreateConsumableEvent logs a maintenance touchpoint.
func (s *Service) CreateConsumableEvent(
	ctx context.Context,
	subject string,
	request domain.CreateConsumableEventRequest,
) (*domain.ConsumableEvent, error) {
	if request.ItemID <= 0 {
		return nil, fmt.Errorf("%w: item_id must be positive", ErrInvalidInput)
	}
	if !isValidConsumableEventKind(request.Kind) {
		return nil, fmt.Errorf("%w: kind must be inspect, rotate, service, replace, or note", ErrInvalidInput)
	}
	note, ok := cleanText(request.Note, 2000)
	if !ok {
		return nil, fmt.Errorf("%w: note is too long", ErrInvalidInput)
	}
	occurredAt := request.OccurredAt
	if occurredAt.IsZero() {
		occurredAt = s.now()
	}
	if occurredAt.After(s.now().Add(time.Hour)) {
		return nil, fmt.Errorf("%w: occurred_at cannot be in the future", ErrInvalidInput)
	}
	if request.OdometerM != nil && *request.OdometerM < 0 {
		return nil, fmt.Errorf("%w: odometer_m must not be negative", ErrInvalidInput)
	}
	if !requireNonNeg(request.CostMinor) {
		return nil, fmt.Errorf("%w: cost_minor must not be negative", ErrInvalidInput)
	}
	record, err := s.durable.CreateEvent(ctx, subject, port.ConsumableEventRecord{
		ItemID:     request.ItemID,
		Kind:       string(request.Kind),
		OccurredAt: occurredAt.UTC(),
		OdometerM:  request.OdometerM,
		CostMinor:  request.CostMinor,
		Note:       note,
	})
	if err != nil {
		return nil, fmt.Errorf("create consumable event: %w", err)
	}
	event := consumableEventToDomain(*record)
	return &event, nil
}

// ConsumablesReport projects the remaining life of every wear part after
// adjusting the rated life for the vehicle's measured duty cycle.
func (s *Service) ConsumablesReport(
	ctx context.Context,
	subject string,
	vehicleID int64,
) (*domain.ConsumablesReport, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	now := s.now()
	snapshot, err := s.source.VehicleSnapshot(ctx, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("vehicle snapshot: %w", err)
	}
	items, err := s.durable.ListItems(ctx, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list consumable items: %w", err)
	}
	events, err := s.durable.ListEvents(ctx, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list consumable events: %w", err)
	}
	stressWindow := s.window(stressWindowDays)
	drives, err := s.source.ListDrives(ctx, vehicleID, stressWindow.From, stressWindow.To)
	if err != nil {
		return nil, fmt.Errorf("list drives: %w", err)
	}

	report := &domain.ConsumablesReport{
		VehicleID: vehicleID,
		AsOf:      now,
		Items:     []domain.ConsumableLifecycle{},
		Evidence:  []domain.Evidence{},
	}
	if snapshot != nil {
		report.OdometerM = snapshot.OdometerM
	}

	usable := usableDrives(drives)
	dutyCycle := observeDutyCycle(usable)
	pace := observedPace(drives)
	eventsByItem := map[int64][]domain.ConsumableEvent{}
	for _, event := range events {
		eventsByItem[event.ItemID] = append(eventsByItem[event.ItemID], consumableEventToDomain(event))
		report.LifetimeSpendMinor += event.CostMinor
	}

	stressSum := 0.0
	for _, record := range items {
		lifecycle := projectConsumable(record, snapshot, dutyCycle, pace, eventsByItem[record.ID], now, len(usable))
		report.LifetimeSpendMinor += record.CostMinor
		stressSum += lifecycle.StressMultiplier
		if report.Currency == "" {
			report.Currency = record.Currency
		}
		switch lifecycle.Status {
		case "overdue":
			report.OverdueCount++
			report.TwelveMonthCostMin += record.CostMinor
		case "due_soon":
			report.DueSoonCount++
			report.TwelveMonthCostMin += record.CostMinor
		default:
			if lifecycle.ProjectedReplaceAt != nil && lifecycle.ProjectedReplaceAt.Before(now.AddDate(0, monthsInProjection, 0)) {
				report.TwelveMonthCostMin += record.CostMinor
			}
		}
		if lifecycle.ProjectedReplaceAt != nil &&
			(report.NextReplaceAt == nil || lifecycle.ProjectedReplaceAt.Before(*report.NextReplaceAt)) {
			report.NextReplaceAt = lifecycle.ProjectedReplaceAt
		}
		report.Items = append(report.Items, lifecycle)
	}
	sort.SliceStable(report.Items, func(i, j int) bool {
		return report.Items[i].HealthPct < report.Items[j].HealthPct
	})
	if len(items) > 0 {
		report.FleetStressAverage = stressSum / float64(len(items))
	}
	if snapshot != nil && snapshot.OdometerM != nil && *snapshot.OdometerM > 0 && report.LifetimeSpendMinor > 0 {
		report.BlendedCostPerMMin = pointer(float64(report.LifetimeSpendMinor) / *snapshot.OdometerM)
	}

	reasons := []string{}
	if len(items) == 0 {
		reasons = append(reasons, "no wear parts have been registered yet")
	}
	if len(usable) < minDrivesForDutyCycle {
		reasons = append(reasons, fmt.Sprintf("only %d recent drives are available; duty-cycle stress falls back to a neutral multiplier", len(usable)))
	}
	if snapshot == nil || snapshot.OdometerM == nil {
		reasons = append(reasons, "odometer is unknown, so distance-based life consumption cannot be measured")
	}
	report.Quality = quality(
		gradeQuality(len(usable), minDrivesForDutyCycle, 80),
		len(usable),
		domain.Float64Pointer(clamp(float64(len(usable))/80*100, 0, 100)),
		stressWindow,
		reasons...,
	)
	report.Evidence = append(report.Evidence,
		evidence("drives", domain.TimePointer(stressWindow.To), domain.IntPointer(len(usable)),
			fmt.Sprintf("Duty-cycle stress multipliers were observed across the trailing %d days of drives and compared with fixed, disclosed baselines.", stressWindowDays)),
		evidence("consumable_events", domain.TimePointer(now), domain.IntPointer(len(events)),
			"Logged inspections, rotations, and replacements adjust the effective installation reference for each part."),
	)
	return report, nil
}

type dutyCycle struct {
	avgSpeedMps   float64
	regenShare    float64
	powerRatio    float64
	ambientC      float64
	tripLengthM   float64
	sampleCount   int
	hasAmbient    bool
	hasPowerRatio bool
}

func observeDutyCycle(drives []port.DriveRecord) dutyCycle {
	cycle := dutyCycle{
		avgSpeedMps: baselineAvgSpeedMps,
		regenShare:  baselineRegenShare,
		powerRatio:  baselinePowerRatio,
		ambientC:    baselineAmbientC,
		tripLengthM: baselineTripLengthM,
	}
	if len(drives) < minDrivesForDutyCycle {
		return cycle
	}
	speeds, ratios, ambients, lengths := []float64{}, []float64{}, []float64{}, []float64{}
	energy, regen := 0.0, 0.0
	for _, drive := range drives {
		if drive.AvgSpeedMps != nil && *drive.AvgSpeedMps > 0 {
			speeds = append(speeds, *drive.AvgSpeedMps)
		}
		if drive.PeakPowerW != nil && drive.AvgPowerW != nil && *drive.AvgPowerW > 0 {
			ratios = append(ratios, *drive.PeakPowerW/(*drive.AvgPowerW))
		}
		if drive.AmbientTempC != nil {
			ambients = append(ambients, *drive.AmbientTempC)
		}
		if distance := deref(drive.DistanceM); distance > 0 {
			lengths = append(lengths, distance)
		}
		energy += math.Abs(deref(drive.EnergyUsedWh))
		regen += math.Abs(deref(drive.RegenEnergyWh))
	}
	cycle.sampleCount = len(drives)
	if value := mean(speeds); value != nil {
		cycle.avgSpeedMps = *value
	}
	if value := mean(ratios); value != nil {
		cycle.powerRatio = *value
		cycle.hasPowerRatio = true
	}
	if value := mean(ambients); value != nil {
		cycle.ambientC = *value
		cycle.hasAmbient = true
	}
	if value := mean(lengths); value != nil {
		cycle.tripLengthM = *value
	}
	if energy > 0 {
		cycle.regenShare = regen / energy
	}
	return cycle
}

// stressFactorsFor returns the multipliers that apply to one wear-part family.
// A multiplier above 1 shortens the rated life; below 1 extends it.
func stressFactorsFor(category domain.ConsumableCategory, cycle dutyCycle) []domain.DutyCycleStress {
	factors := []domain.DutyCycleStress{}
	family := consumableDefaults[category].stressCode

	switch family {
	case "tire":
		factors = append(factors, domain.DutyCycleStress{
			Code:        "aggression",
			Label:       "Power aggression",
			Multiplier:  clamp(1+(cycle.powerRatio-baselinePowerRatio)*0.18, 0.7, 1.9),
			ObservedVal: cycle.powerRatio,
			BaselineVal: baselinePowerRatio,
			SIUnit:      "ratio",
			Narrative:   "A high peak-to-average power ratio means frequent hard acceleration, which shears tread far faster than steady cruising.",
		})
		factors = append(factors, domain.DutyCycleStress{
			Code:        "speed",
			Label:       "Sustained speed",
			Multiplier:  clamp(1+(cycle.avgSpeedMps-baselineAvgSpeedMps)*0.012, 0.85, 1.35),
			ObservedVal: cycle.avgSpeedMps,
			BaselineVal: baselineAvgSpeedMps,
			SIUnit:      "m/s",
			Narrative:   "Higher sustained speed raises tread temperature and accelerates wear.",
		})
		factors = append(factors, domain.DutyCycleStress{
			Code:        "regen",
			Label:       "Regenerative share",
			Multiplier:  clamp(1+(cycle.regenShare-baselineRegenShare)*0.9, 0.9, 1.25),
			ObservedVal: cycle.regenShare,
			BaselineVal: baselineRegenShare,
			SIUnit:      "fraction",
			Narrative:   "Heavy regenerative braking loads the driven axle and wears those tires faster even as it saves the friction brakes.",
		})
	case "brake":
		factors = append(factors, domain.DutyCycleStress{
			Code:        "regen_relief",
			Label:       "Regenerative braking relief",
			Multiplier:  clamp(1-(cycle.regenShare-baselineRegenShare)*2.2, 0.45, 1.4),
			ObservedVal: cycle.regenShare,
			BaselineVal: baselineRegenShare,
			SIUnit:      "fraction",
			Narrative:   "Every joule recovered by regeneration is a joule the friction brakes never had to dissipate, which is why EV pads last so long.",
		})
		factors = append(factors, domain.DutyCycleStress{
			Code:        "corrosion",
			Label:       "Cold and damp exposure",
			Multiplier:  clamp(1+(baselineAmbientC-cycle.ambientC)*0.012, 0.9, 1.4),
			ObservedVal: cycle.ambientC,
			BaselineVal: baselineAmbientC,
			SIUnit:      "degC",
			Narrative:   "Cold, damp operation with little friction braking promotes rotor corrosion, which is the dominant EV brake failure mode.",
		})
	case "cabin":
		factors = append(factors, domain.DutyCycleStress{
			Code:        "duration",
			Label:       "Cabin runtime",
			Multiplier:  clamp(1+(cycle.tripLengthM-baselineTripLengthM)/baselineTripLengthM*0.25, 0.8, 1.5),
			ObservedVal: cycle.tripLengthM,
			BaselineVal: baselineTripLengthM,
			SIUnit:      "m",
			Narrative:   "Longer trips mean more air volume pulled through the filter media.",
		})
	case "thermal":
		factors = append(factors, domain.DutyCycleStress{
			Code:        "thermal_load",
			Label:       "Thermal load",
			Multiplier:  clamp(1+(cycle.powerRatio-baselinePowerRatio)*0.1+math.Abs(cycle.ambientC-baselineAmbientC)*0.008, 0.85, 1.5),
			ObservedVal: cycle.powerRatio,
			BaselineVal: baselinePowerRatio,
			SIUnit:      "ratio",
			Narrative:   "High power excursions and extreme ambient temperatures both cycle the coolant loop harder.",
		})
	case "suspension":
		factors = append(factors, domain.DutyCycleStress{
			Code:        "trip_profile",
			Label:       "Trip profile",
			Multiplier:  clamp(1+(baselineTripLengthM-cycle.tripLengthM)/baselineTripLengthM*0.3, 0.8, 1.6),
			ObservedVal: cycle.tripLengthM,
			BaselineVal: baselineTripLengthM,
			SIUnit:      "m",
			Narrative:   "Many short trips imply more low-speed manoeuvring and kerb impacts per metre travelled than long highway runs.",
		})
	}
	return factors
}

func projectConsumable(
	record port.ConsumableItemRecord,
	snapshot *port.VehicleSnapshot,
	cycle dutyCycle,
	pace *float64,
	events []domain.ConsumableEvent,
	now time.Time,
	driveCount int,
) domain.ConsumableLifecycle {
	lifecycle := domain.ConsumableLifecycle{
		Item:               consumableItemToDomain(record),
		Events:             events,
		StressMultiplier:   1,
		StressFactors:      []domain.DutyCycleStress{},
		ReplacementCostMin: record.CostMinor,
		BindingLimit:       "time",
	}
	if lifecycle.Events == nil {
		lifecycle.Events = []domain.ConsumableEvent{}
	}
	sort.SliceStable(lifecycle.Events, func(i, j int) bool {
		return lifecycle.Events[i].OccurredAt.After(lifecycle.Events[j].OccurredAt)
	})

	// A logged replacement resets the reference point for the part.
	installedAt := record.InstalledAt
	installedOdometer := record.InstalledOdometerM
	for _, event := range lifecycle.Events {
		if event.Kind != "replacement" {
			continue
		}
		if event.OccurredAt.After(installedAt) {
			installedAt = event.OccurredAt
			if event.OdometerM != nil {
				installedOdometer = *event.OdometerM
			}
		}
		break
	}

	lifecycle.DurationUsedS = int64(math.Max(now.Sub(installedAt).Seconds(), 0))
	if snapshot != nil && snapshot.OdometerM != nil {
		lifecycle.DistanceUsedM = math.Max(*snapshot.OdometerM-installedOdometer, 0)
	}

	category := domain.ConsumableCategory(record.Category)
	if driveCount >= minDrivesForDutyCycle {
		lifecycle.StressFactors = stressFactorsFor(category, cycle)
	}
	multiplier := 1.0
	for _, factor := range lifecycle.StressFactors {
		multiplier *= factor.Multiplier
	}
	lifecycle.StressMultiplier = clamp(multiplier, minStressMultiplier, maxStressMultiplier)

	distanceHealth, timeHealth := math.Inf(1), math.Inf(1)
	if record.RatedLifeM != nil && *record.RatedLifeM > 0 {
		adjusted := *record.RatedLifeM / lifecycle.StressMultiplier
		lifecycle.AdjustedLifeM = pointer(adjusted)
		lifecycle.DistanceLifeUsedPct = pointer(clamp(lifecycle.DistanceUsedM/adjusted*100, 0, 999))
		lifecycle.RemainingM = pointer(math.Max(adjusted-lifecycle.DistanceUsedM, 0))
		distanceHealth = clamp(100-*lifecycle.DistanceLifeUsedPct, 0, 100)
		if record.CostMinor > 0 {
			lifecycle.CostPerMMinor = pointer(float64(record.CostMinor) / adjusted)
		}
	}
	if record.RatedLifeS != nil && *record.RatedLifeS > 0 {
		used := float64(lifecycle.DurationUsedS) / float64(*record.RatedLifeS) * 100
		lifecycle.TimeLifeUsedPct = pointer(clamp(used, 0, 999))
		remaining := *record.RatedLifeS - lifecycle.DurationUsedS
		if remaining < 0 {
			remaining = 0
		}
		lifecycle.RemainingS = pointer(remaining)
		timeHealth = clamp(100-used, 0, 100)
	}

	switch {
	case math.IsInf(distanceHealth, 1) && math.IsInf(timeHealth, 1):
		lifecycle.HealthPct = 100
	case distanceHealth <= timeHealth:
		lifecycle.HealthPct = distanceHealth
		lifecycle.BindingLimit = "distance"
	default:
		lifecycle.HealthPct = timeHealth
		lifecycle.BindingLimit = "time"
	}
	if math.IsInf(lifecycle.HealthPct, 1) {
		lifecycle.HealthPct = 100
	}

	var timeReplace, distanceReplace *time.Time
	if lifecycle.RemainingS != nil {
		at := now.Add(time.Duration(*lifecycle.RemainingS) * time.Second)
		timeReplace = &at
	}
	if lifecycle.RemainingM != nil && pace != nil && *pace > 0 {
		at := now.Add(time.Duration(*lifecycle.RemainingM / *pace) * time.Second)
		distanceReplace = &at
	}
	switch {
	case timeReplace != nil && distanceReplace != nil:
		if distanceReplace.Before(*timeReplace) {
			lifecycle.ProjectedReplaceAt = distanceReplace
			lifecycle.BindingLimit = "distance"
		} else {
			lifecycle.ProjectedReplaceAt = timeReplace
			lifecycle.BindingLimit = "time"
		}
	case timeReplace != nil:
		lifecycle.ProjectedReplaceAt = timeReplace
	case distanceReplace != nil:
		lifecycle.ProjectedReplaceAt = distanceReplace
	}

	switch {
	case record.RetiredAt != nil:
		lifecycle.Status = "retired"
	case lifecycle.HealthPct <= 0:
		lifecycle.Status = "overdue"
	case lifecycle.HealthPct <= dueSoonPct:
		lifecycle.Status = "due_soon"
	default:
		lifecycle.Status = "healthy"
	}
	lifecycle.Narrative = consumableNarrative(record, lifecycle)
	return lifecycle
}

func consumableNarrative(record port.ConsumableItemRecord, lifecycle domain.ConsumableLifecycle) string {
	stress := "matches"
	switch {
	case lifecycle.StressMultiplier > 1.15:
		stress = fmt.Sprintf("is %.0f%% harsher than", (lifecycle.StressMultiplier-1)*100)
	case lifecycle.StressMultiplier < 0.85:
		stress = fmt.Sprintf("is %.0f%% gentler than", (1-lifecycle.StressMultiplier)*100)
	}
	base := fmt.Sprintf("%s is at %.0f%% remaining life on the %s limit. The measured duty cycle %s the rated baseline.",
		record.Label, lifecycle.HealthPct, lifecycle.BindingLimit, stress)
	if lifecycle.ProjectedReplaceAt != nil {
		base += fmt.Sprintf(" Replacement is projected for %s.", lifecycle.ProjectedReplaceAt.Format("2006-01-02"))
	}
	return base
}

func isValidConsumableEventKind(kind domain.ConsumableEventKind) bool {
	switch kind {
	case domain.ConsumableInspect, domain.ConsumableRotate, domain.ConsumableService,
		domain.ConsumableReplace, domain.ConsumableNote:
		return true
	default:
		return false
	}
}

func consumableItemToDomain(record port.ConsumableItemRecord) domain.ConsumableItem {
	return domain.ConsumableItem{
		ID:                 record.ID,
		VehicleID:          record.VehicleID,
		Category:           domain.ConsumableCategory(record.Category),
		Label:              record.Label,
		Position:           record.Position,
		InstalledAt:        record.InstalledAt,
		InstalledOdometerM: record.InstalledOdometerM,
		RatedLifeM:         record.RatedLifeM,
		RatedLifeS:         record.RatedLifeS,
		CostMinor:          record.CostMinor,
		Currency:           record.Currency,
		RetiredAt:          record.RetiredAt,
		Notes:              record.Notes,
		Version:            record.Version,
		CreatedAt:          record.CreatedAt,
		UpdatedAt:          record.UpdatedAt,
	}
}

func consumableEventToDomain(record port.ConsumableEventRecord) domain.ConsumableEvent {
	return domain.ConsumableEvent{
		ID:         record.ID,
		ItemID:     record.ItemID,
		Kind:       domain.ConsumableEventKind(record.Kind),
		OccurredAt: record.OccurredAt,
		OdometerM:  record.OdometerM,
		CostMinor:  record.CostMinor,
		Note:       record.Note,
		CreatedAt:  record.CreatedAt,
	}
}
