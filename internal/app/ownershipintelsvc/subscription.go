package ownershipintelsvc

import (
	"context"
	"fmt"
	"math"
	"slices"
	"sort"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

const (
	// minActiveDaysForVerdict is how long a subscription must run before its
	// realised usage is treated as representative.
	minActiveDaysForVerdict = 30
	// daysPerMonth normalises every billing period onto a common monthly axis.
	daysPerMonth = 30.4375
	// keepROIPct and cancelROIPct bound the verdict ladder.
	keepROIPct   = 10.0
	cancelROIPct = -35.0
)

var usageMetricUnits = map[domain.UsageMetric]string{
	domain.UsageSuperchargingEnergy: "Wh",
	domain.UsageDrivingDistance:     "m",
	domain.UsageConnectivityTime:    "s",
	domain.UsageChargingSessions:    "sessions",
	domain.UsageDriveCount:          "drives",
	domain.UsageNone:                "",
}

// billingPeriodDays maps each billing period onto the number of days it covers.
// The keys mirror the vehicle_subscriptions_billing_period_check constraint.
var billingPeriodDays = map[domain.BillingPeriod]float64{
	domain.BillingMonthly: daysPerMonth,
	domain.BillingAnnual:  365.25,
	domain.BillingOnce:    0,
}

// billingPeriodsByKind encodes the vehicle_subscriptions_billing_kind pairing
// so an unsupported combination is rejected as a 400 instead of surfacing as a
// constraint violation from the database.
var billingPeriodsByKind = map[domain.SubscriptionKind][]domain.BillingPeriod{
	domain.SubscriptionRecurring: {domain.BillingMonthly, domain.BillingAnnual},
	domain.SubscriptionOneTime:   {domain.BillingOnce},
}

func joinPeriods(periods []domain.BillingPeriod) string {
	labels := make([]string, 0, len(periods))
	for _, period := range periods {
		labels = append(labels, string(period))
	}
	return strings.Join(labels, " or ")
}

// ListSubscriptions returns every stored paid feature for a vehicle.
func (s *Service) ListSubscriptions(ctx context.Context, subject string, vehicleID int64) ([]domain.Subscription, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	records, err := s.durable.ListSubscriptions(ctx, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list subscriptions: %w", err)
	}
	subscriptions := make([]domain.Subscription, 0, len(records))
	for _, record := range records {
		subscriptions = append(subscriptions, subscriptionToDomain(record))
	}
	return subscriptions, nil
}

// CreateSubscription registers a paid feature for ROI scoring.
func (s *Service) CreateSubscription(
	ctx context.Context,
	subject string,
	request domain.CreateSubscriptionRequest,
) (*domain.Subscription, error) {
	if request.VehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	name, ok := requireText(request.Name, 160)
	if !ok {
		return nil, fmt.Errorf("%w: name is required", ErrInvalidInput)
	}
	kind := request.Kind
	if kind == "" {
		kind = domain.SubscriptionRecurring
	}
	allowedPeriods, known := billingPeriodsByKind[kind]
	if !known {
		return nil, fmt.Errorf("%w: kind must be subscription or one_time", ErrInvalidInput)
	}
	if !slices.Contains(allowedPeriods, request.BillingPeriod) {
		return nil, fmt.Errorf(
			"%w: billing_period must be %s for a %s",
			ErrInvalidInput,
			joinPeriods(allowedPeriods),
			kind,
		)
	}
	if !requireNonNeg(request.PriceMinor) {
		return nil, fmt.Errorf("%w: price_minor must not be negative", ErrInvalidInput)
	}
	currency, ok := validCurrency(request.Currency)
	if !ok {
		return nil, fmt.Errorf("%w: currency must be an ISO-4217 alpha-3 code", ErrInvalidInput)
	}
	metric := request.UsageMetric
	if metric == "" {
		metric = domain.UsageNone
	}
	if _, known := usageMetricUnits[metric]; !known {
		return nil, fmt.Errorf("%w: usage_metric is not supported", ErrInvalidInput)
	}
	if metric != domain.UsageNone && !requireNonNegF(request.BenchmarkMinorPerUnit) {
		return nil, fmt.Errorf("%w: benchmark_minor_per_unit must not be negative", ErrInvalidInput)
	}
	if request.StartedAt.IsZero() {
		return nil, fmt.Errorf("%w: started_at is required", ErrInvalidInput)
	}
	if request.StartedAt.After(s.now().Add(time.Hour)) {
		return nil, fmt.Errorf("%w: started_at cannot be in the future", ErrInvalidInput)
	}
	if request.EndedAt != nil && !request.EndedAt.After(request.StartedAt) {
		return nil, fmt.Errorf("%w: ended_at must be after started_at", ErrInvalidInput)
	}
	record, err := s.durable.CreateSubscription(ctx, subject, port.SubscriptionRecord{
		VehicleID:             request.VehicleID,
		Name:                  name,
		Kind:                  string(kind),
		BillingPeriod:         string(request.BillingPeriod),
		PriceMinor:            request.PriceMinor,
		Currency:              currency,
		UsageMetric:           string(metric),
		BenchmarkMinorPerUnit: request.BenchmarkMinorPerUnit,
		StartedAt:             request.StartedAt.UTC(),
		EndedAt:               request.EndedAt,
	})
	if err != nil {
		return nil, fmt.Errorf("create subscription: %w", err)
	}
	subscription := subscriptionToDomain(*record)
	return &subscription, nil
}

// DeleteSubscription removes a stored paid feature.
func (s *Service) DeleteSubscription(ctx context.Context, subject string, id int64) error {
	if id <= 0 {
		return fmt.Errorf("%w: subscription id must be positive", ErrInvalidInput)
	}
	if err := s.durable.DeleteSubscription(ctx, subject, id); err != nil {
		return fmt.Errorf("delete subscription: %w", err)
	}
	return nil
}

// SubscriptionROI scores every paid feature against the telemetry that proves
// how much it was actually used.
func (s *Service) SubscriptionROI(
	ctx context.Context,
	subject string,
	vehicleID int64,
	windowDays int,
) (*domain.SubscriptionROIReport, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	window := s.window(windowDays)
	records, err := s.durable.ListSubscriptions(ctx, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list subscriptions: %w", err)
	}
	drives, err := s.source.ListDrives(ctx, vehicleID, window.From, window.To)
	if err != nil {
		return nil, fmt.Errorf("list drives: %w", err)
	}
	charges, err := s.source.ListCharges(ctx, vehicleID, window.From, window.To)
	if err != nil {
		return nil, fmt.Errorf("list charging sessions: %w", err)
	}

	report := &domain.SubscriptionROIReport{
		VehicleID: vehicleID,
		Window:    window,
		Items:     []domain.SubscriptionROI{},
		Evidence:  []domain.Evidence{},
	}
	usable := usableDrives(drives)
	now := s.now()
	valueSum, hasValue := int64(0), false

	for _, record := range records {
		item := scoreSubscription(record, usable, charges, window, now)
		report.TotalMonthlyMinor += item.MonthlyCostMinor
		report.TotalSpendMinor += item.SpendToDateMinor
		if item.RealisedValueMinor != nil {
			valueSum += *item.RealisedValueMinor
			hasValue = true
		}
		if item.Verdict == domain.VerdictCancel {
			report.CancelCandidateSave += item.MonthlyCostMinor
		}
		if report.Currency == "" {
			report.Currency = record.Currency
		}
		report.Items = append(report.Items, item)
	}
	sort.SliceStable(report.Items, func(i, j int) bool {
		left, right := report.Items[i], report.Items[j]
		if (left.ROIPct == nil) != (right.ROIPct == nil) {
			return right.ROIPct == nil
		}
		if left.ROIPct != nil && right.ROIPct != nil && *left.ROIPct != *right.ROIPct {
			return *left.ROIPct < *right.ROIPct
		}
		return left.MonthlyCostMinor > right.MonthlyCostMinor
	})
	if hasValue {
		report.TotalValueMinor = pointer(valueSum)
		if report.TotalSpendMinor > 0 {
			report.PortfolioROIPct = pointer(float64(valueSum-report.TotalSpendMinor) / float64(report.TotalSpendMinor) * 100)
		}
	}

	reasons := []string{}
	if len(records) == 0 {
		reasons = append(reasons, "no subscriptions have been registered yet")
	}
	if len(usable) == 0 && len(charges) == 0 {
		reasons = append(reasons, "no drives or charging sessions in the window, so realised usage cannot be measured")
	}
	measurable := 0
	for _, record := range records {
		if domain.UsageMetric(record.UsageMetric) != domain.UsageNone {
			measurable++
		}
	}
	if measurable < len(records) {
		reasons = append(reasons, fmt.Sprintf("%d subscriptions have no telemetry-backed usage metric and cannot be scored", len(records)-measurable))
	}
	coverage := 0.0
	if len(records) > 0 {
		coverage = float64(measurable) / float64(len(records)) * 100
	}
	report.Quality = quality(
		gradeQuality(len(usable)+len(charges), 10, 100),
		len(usable)+len(charges),
		domain.Float64Pointer(coverage),
		window,
		reasons...,
	)
	report.Evidence = append(report.Evidence,
		evidence("drives", domain.TimePointer(window.To), domain.IntPointer(len(usable)),
			"Driving distance and drive counts are read from completed drives inside the window."),
		evidence("charging_sessions", domain.TimePointer(window.To), domain.IntPointer(len(charges)),
			"Supercharging energy and session counts are read from measured charging sessions, not from provider statements."),
	)
	return report, nil
}

func scoreSubscription(
	record port.SubscriptionRecord,
	drives []port.DriveRecord,
	charges []port.ChargeRecord,
	window domain.Window,
	now time.Time,
) domain.SubscriptionROI {
	item := domain.SubscriptionROI{
		Subscription: subscriptionToDomain(record),
		Verdict:      domain.VerdictUnknown,
		UsageUnit:    usageMetricUnits[domain.UsageMetric(record.UsageMetric)],
	}

	end := now
	if record.EndedAt != nil && record.EndedAt.Before(end) {
		end = *record.EndedAt
	}
	activeDays := math.Max(end.Sub(record.StartedAt).Hours()/24, 0)
	item.ActiveDays = int(activeDays)

	periodDays := billingPeriodDays[domain.BillingPeriod(record.BillingPeriod)]
	switch {
	case periodDays <= 0:
		item.MonthlyCostMinor = 0
		item.SpendToDateMinor = record.PriceMinor
	default:
		item.MonthlyCostMinor = roundMinor(float64(record.PriceMinor) * daysPerMonth / periodDays)
		periods := math.Ceil(activeDays / periodDays)
		item.SpendToDateMinor = roundMinor(float64(record.PriceMinor) * math.Max(periods, 1))
	}

	metric := domain.UsageMetric(record.UsageMetric)
	if metric == domain.UsageNone {
		item.Verdict = domain.VerdictUnknown
		item.Narrative = fmt.Sprintf(
			"%s has no telemetry-backed usage metric, so TeslaSync reports its cost but will not guess at its value.",
			record.Name,
		)
		item.Quality = quality(domain.QualityInsufficient, 0, nil, window,
			"this subscription is not linked to a measurable usage series")
		return item
	}

	quantity := measureUsage(metric, drives, charges, record.StartedAt, record.EndedAt)
	item.UsageQuantity = pointer(quantity)
	windowDays := math.Max(window.To.Sub(window.From).Hours()/24, 1)
	observedDays := math.Min(windowDays, math.Max(activeDays, 1))
	item.UsagePerMonth = pointer(quantity / observedDays * daysPerMonth)

	if record.BenchmarkMinorPerUnit > 0 {
		monthly := *item.UsagePerMonth
		realisedMonthly := monthly * record.BenchmarkMinorPerUnit
		months := math.Max(activeDays/daysPerMonth, 0)
		item.RealisedValueMinor = pointer(roundMinor(realisedMonthly * math.Max(months, 1)))
		item.NetValueMinor = pointer(*item.RealisedValueMinor - item.SpendToDateMinor)
		if item.SpendToDateMinor > 0 {
			item.ROIPct = pointer(float64(*item.NetValueMinor) / float64(item.SpendToDateMinor) * 100)
		}
		if item.MonthlyCostMinor > 0 {
			item.BreakEvenUsagePerMon = pointer(float64(item.MonthlyCostMinor) / record.BenchmarkMinorPerUnit)
			if *item.BreakEvenUsagePerMon > 0 {
				item.UtilisationPct = pointer(clamp(monthly / *item.BreakEvenUsagePerMon * 100, 0, 999))
			}
		}
	}

	sampleCount := len(drives) + len(charges)
	item.Confidence = clamp(
		float64(item.ActiveDays)/float64(minActiveDaysForVerdict)*50+
			clamp(float64(sampleCount)/40*50, 0, 50),
		0, 100,
	)
	switch {
	case item.ActiveDays < minActiveDaysForVerdict:
		item.Verdict = domain.VerdictTooEarly
	case item.ROIPct == nil:
		item.Verdict = domain.VerdictUnknown
	case *item.ROIPct >= keepROIPct:
		item.Verdict = domain.VerdictKeep
	case *item.ROIPct <= cancelROIPct:
		item.Verdict = domain.VerdictCancel
	default:
		item.Verdict = domain.VerdictReview
	}
	item.Narrative = subscriptionNarrative(record, item)

	reasons := []string{}
	if item.ActiveDays < minActiveDaysForVerdict {
		reasons = append(reasons, fmt.Sprintf("only %d active days so far; %d are needed for a stable verdict",
			item.ActiveDays, minActiveDaysForVerdict))
	}
	if record.BenchmarkMinorPerUnit <= 0 {
		reasons = append(reasons, "no benchmark price per unit is configured, so realised value cannot be priced")
	}
	item.Quality = quality(
		gradeQuality(sampleCount, 10, 80),
		sampleCount,
		domain.Float64Pointer(clamp(float64(item.ActiveDays)/float64(minActiveDaysForVerdict)*100, 0, 100)),
		window,
		reasons...,
	)
	return item
}

// measureUsage reads the realised quantity from telemetry, bounded by the
// subscription's own active period so a plan started last week is not credited
// with a year of driving.
func measureUsage(
	metric domain.UsageMetric,
	drives []port.DriveRecord,
	charges []port.ChargeRecord,
	startedAt time.Time,
	endedAt *time.Time,
) float64 {
	within := func(at time.Time) bool {
		if at.Before(startedAt) {
			return false
		}
		if endedAt != nil && at.After(*endedAt) {
			return false
		}
		return true
	}
	total := 0.0
	switch metric {
	case domain.UsageDrivingDistance:
		for _, drive := range drives {
			if within(drive.StartedAt) {
				total += deref(drive.DistanceM)
			}
		}
	case domain.UsageDriveCount:
		for _, drive := range drives {
			if within(drive.StartedAt) {
				total++
			}
		}
	case domain.UsageConnectivityTime:
		for _, drive := range drives {
			if within(drive.StartedAt) {
				total += float64(derefI64(drive.DurationS))
			}
		}
	case domain.UsageSuperchargingEnergy:
		for _, charge := range charges {
			if !within(charge.StartedAt) || !isFastCharge(charge) {
				continue
			}
			total += math.Abs(deref(charge.EnergyAddedWh))
		}
	case domain.UsageChargingSessions:
		for _, charge := range charges {
			if within(charge.StartedAt) {
				total++
			}
		}
	}
	return total
}

// isFastCharge classifies a session as DC fast charging from measured power
// rather than trusting a possibly-absent charger_type label.
func isFastCharge(charge port.ChargeRecord) bool {
	if charge.ChargerType == "dc" || charge.ChargerType == "supercharger" {
		return true
	}
	return charge.PeakPowerW != nil && *charge.PeakPowerW >= 25000
}

func subscriptionNarrative(record port.SubscriptionRecord, item domain.SubscriptionROI) string {
	if item.UsageQuantity != nil && *item.UsageQuantity == 0 {
		return fmt.Sprintf(
			"%s has recorded no measurable usage since %s while costing %d minor units per month. That is the clearest cancellation candidate in the portfolio.",
			record.Name, record.StartedAt.Format("2006-01-02"), item.MonthlyCostMinor,
		)
	}
	base := fmt.Sprintf("%s has been active for %d days", record.Name, item.ActiveDays)
	if item.UsagePerMonth != nil {
		base += fmt.Sprintf(" with %.4g %s of realised usage per month", *item.UsagePerMonth, item.UsageUnit)
	}
	if item.BreakEvenUsagePerMon != nil {
		base += fmt.Sprintf(" against a break-even of %.4g %s per month", *item.BreakEvenUsagePerMon, item.UsageUnit)
	}
	if item.ROIPct != nil {
		base += fmt.Sprintf(", giving a realised return of %.0f%%", *item.ROIPct)
	}
	switch item.Verdict {
	case domain.VerdictKeep:
		base += ". Keep it — the measured usage more than covers the price."
	case domain.VerdictCancel:
		base += ". Cancelling would recover more than it costs at the current usage level."
	case domain.VerdictReview:
		base += ". It is close enough to break-even that it is worth reviewing next renewal."
	case domain.VerdictTooEarly:
		base += ". It is too early to judge; the usage record is still short."
	default:
		base += "."
	}
	return base
}

func subscriptionToDomain(record port.SubscriptionRecord) domain.Subscription {
	return domain.Subscription{
		ID:                    record.ID,
		VehicleID:             record.VehicleID,
		Name:                  record.Name,
		Kind:                  domain.SubscriptionKind(record.Kind),
		BillingPeriod:         domain.BillingPeriod(record.BillingPeriod),
		PriceMinor:            record.PriceMinor,
		Currency:              record.Currency,
		UsageMetric:           domain.UsageMetric(record.UsageMetric),
		BenchmarkMinorPerUnit: record.BenchmarkMinorPerUnit,
		StartedAt:             record.StartedAt,
		EndedAt:               record.EndedAt,
		Version:               record.Version,
		CreatedAt:             record.CreatedAt,
		UpdatedAt:             record.UpdatedAt,
	}
}
