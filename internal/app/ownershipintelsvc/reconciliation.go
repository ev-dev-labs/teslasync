package ownershipintelsvc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

const (
	// matchWindowS is how far a billed timestamp may sit from a measured
	// session start before the pair can no longer be the same event.
	matchWindowS = 7200.0
	// exactMatchScore and probableMatchScore bound the confidence ladder.
	exactMatchScore    = 0.92
	probableMatchScore = 0.75
	minimumMatchScore  = 0.50
	// rateToleranceRatio is how far one line's unit rate may drift from the
	// invoice median before it is treated as a pricing error.
	rateToleranceRatio = 0.15
	// energyToleranceRatio absorbs normal metering loss between the wallbox
	// meter and the vehicle's own accumulator.
	energyToleranceRatio = 0.05
)

var varianceLabels = map[string]struct {
	label       string
	recoverable bool
}{
	"energy_overstated":   {"Billed energy exceeds measured energy", true},
	"energy_understated":  {"Billed energy is below measured energy", false},
	"rate_mismatch":       {"Unit rate deviates from the invoice median", true},
	"duplicate_line":      {"Duplicate charge for one measured session", true},
	"unmatched_line":      {"No measured session supports this charge", true},
	"idle_fee":            {"Idle or occupancy fee applied", false},
	"tax":                 {"Tax component", false},
	"line_total_mismatch": {"Line components do not sum to the line total", true},
	"ambiguous_match":     {"More than one session could explain this charge", false},
}

// ListInvoices returns stored provider invoices for a vehicle.
func (s *Service) ListInvoices(
	ctx context.Context,
	subject string,
	vehicleID int64,
	limit, offset int,
) (*domain.Page[domain.ChargingInvoice], error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	limit, offset = normalizePage(limit, offset)
	records, total, err := s.durable.ListInvoices(ctx, subject, vehicleID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list invoices: %w", err)
	}
	items := make([]domain.ChargingInvoice, 0, len(records))
	for _, record := range records {
		items = append(items, invoiceToDomain(record))
	}
	return &domain.Page[domain.ChargingInvoice]{Items: items, Total: total, Limit: limit, Offset: offset}, nil
}

// CreateInvoice ingests one provider statement with all of its lines.
func (s *Service) CreateInvoice(
	ctx context.Context,
	subject string,
	request domain.CreateInvoiceRequest,
) (*domain.ChargingInvoice, error) {
	if request.VehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	provider, ok := requireText(request.Provider, 160)
	if !ok {
		return nil, fmt.Errorf("%w: provider is required", ErrInvalidInput)
	}
	invoiceRef, ok := requireText(request.InvoiceRef, 160)
	if !ok {
		return nil, fmt.Errorf("%w: invoice_ref is required", ErrInvalidInput)
	}
	currency, ok := validCurrency(request.Currency)
	if !ok {
		return nil, fmt.Errorf("%w: currency must be an ISO-4217 alpha-3 code", ErrInvalidInput)
	}
	if request.PeriodStart.IsZero() || !request.PeriodEnd.After(request.PeriodStart) {
		return nil, fmt.Errorf("%w: period_end must be after period_start", ErrInvalidInput)
	}
	if !requireNonNeg(request.BilledTotalMinor) {
		return nil, fmt.Errorf("%w: billed_total_minor must not be negative", ErrInvalidInput)
	}
	if len(request.Lines) == 0 {
		return nil, fmt.Errorf("%w: at least one invoice line is required", ErrInvalidInput)
	}
	if len(request.Lines) > 500 {
		return nil, fmt.Errorf("%w: an invoice cannot exceed 500 lines", ErrInvalidInput)
	}
	lines := make([]port.InvoiceLineRecord, 0, len(request.Lines))
	for index, line := range request.Lines {
		if line.OccurredAt.IsZero() {
			return nil, fmt.Errorf("%w: line %d is missing occurred_at", ErrInvalidInput, index+1)
		}
		if !requireNonNegF(line.BilledEnergyWh) {
			return nil, fmt.Errorf("%w: line %d has invalid billed_energy_wh", ErrInvalidInput, index+1)
		}
		if !requireNonNeg(line.BilledEnergyMinor) || !requireNonNeg(line.BilledIdleMinor) ||
			!requireNonNeg(line.BilledTaxMinor) || !requireNonNeg(line.BilledTotalMinor) {
			return nil, fmt.Errorf("%w: line %d has a negative monetary amount", ErrInvalidInput, index+1)
		}
		lineRef, ok := cleanText(line.LineRef, 160)
		if !ok {
			return nil, fmt.Errorf("%w: line %d ref is too long", ErrInvalidInput, index+1)
		}
		location, ok := cleanText(line.Location, 240)
		if !ok {
			return nil, fmt.Errorf("%w: line %d location is too long", ErrInvalidInput, index+1)
		}
		lines = append(lines, port.InvoiceLineRecord{
			LineRef:           lineRef,
			OccurredAt:        line.OccurredAt.UTC(),
			Location:          location,
			BilledEnergyWh:    line.BilledEnergyWh,
			BilledEnergyMinor: line.BilledEnergyMinor,
			BilledIdleMinor:   line.BilledIdleMinor,
			BilledTaxMinor:    line.BilledTaxMinor,
			BilledTotalMinor:  line.BilledTotalMinor,
		})
	}
	record, err := s.durable.CreateInvoice(ctx, subject, port.InvoiceRecord{
		VehicleID:        request.VehicleID,
		Provider:         provider,
		InvoiceRef:       invoiceRef,
		Currency:         currency,
		PeriodStart:      request.PeriodStart.UTC(),
		PeriodEnd:        request.PeriodEnd.UTC(),
		BilledTotalMinor: request.BilledTotalMinor,
		Status:           string(domain.InvoiceOpen),
		Lines:            lines,
	})
	if err != nil {
		return nil, fmt.Errorf("create invoice: %w", err)
	}
	invoice := invoiceToDomain(*record)
	return &invoice, nil
}

// DeleteInvoice removes a stored invoice and cascades its lines.
func (s *Service) DeleteInvoice(ctx context.Context, subject string, id int64) error {
	if id <= 0 {
		return fmt.Errorf("%w: invoice id must be positive", ErrInvalidInput)
	}
	if err := s.durable.DeleteInvoice(ctx, subject, id); err != nil {
		return fmt.Errorf("delete invoice: %w", err)
	}
	return nil
}

// ReconcileInvoice matches every billed line against measured telemetry and
// attributes each monetary discrepancy to a named cause.
func (s *Service) ReconcileInvoice(
	ctx context.Context,
	subject string,
	invoiceID int64,
) (*domain.ReconciliationReport, error) {
	if invoiceID <= 0 {
		return nil, fmt.Errorf("%w: invoice id must be positive", ErrInvalidInput)
	}
	record, err := s.durable.GetInvoice(ctx, subject, invoiceID)
	if err != nil {
		return nil, fmt.Errorf("get invoice: %w", err)
	}
	from := record.PeriodStart.Add(-2 * time.Hour)
	to := record.PeriodEnd.Add(2 * time.Hour)
	charges, err := s.source.ListCharges(ctx, record.VehicleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("list charging sessions: %w", err)
	}
	disputes, err := s.durable.ListDisputes(ctx, subject, invoiceID)
	if err != nil {
		return nil, fmt.Errorf("list disputes: %w", err)
	}

	report := &domain.ReconciliationReport{
		Invoice:         invoiceToDomain(*record),
		Lines:           []domain.ReconciledLine{},
		Uninvoiced:      []domain.UninvoicedSession{},
		VarianceBuckets: []domain.VarianceBucket{},
		Disputes:        disputesToDomain(disputes),
		Evidence:        []domain.Evidence{},
	}

	medianRate := medianUnitRate(record.Lines)
	consumed := map[int64]int{}
	lines := append([]port.InvoiceLineRecord(nil), record.Lines...)
	sort.SliceStable(lines, func(i, j int) bool { return lines[i].OccurredAt.Before(lines[j].OccurredAt) })

	varianceTotals := map[string]int64{}
	varianceCounts := map[string]int{}
	for _, line := range lines {
		reconciled := reconcileLine(line, charges, consumed, medianRate)
		if reconciled.SessionID != nil {
			consumed[*reconciled.SessionID]++
		}
		for _, reason := range reconciled.VarianceReasons {
			varianceCounts[reason]++
		}
		report.Lines = append(report.Lines, reconciled)
		report.BilledEnergyWh += line.BilledEnergyWh
		report.BilledTotalMinor += line.BilledTotalMinor
		if reconciled.MeasuredEnergyWh != nil {
			report.MeasuredEnergyWh += *reconciled.MeasuredEnergyWh
		}
		if reconciled.ExpectedCostMinor != nil {
			report.ExpectedTotalMinor += *reconciled.ExpectedCostMinor
		} else {
			report.ExpectedTotalMinor += line.BilledIdleMinor + line.BilledTaxMinor
		}
		switch reconciled.MatchState {
		case domain.MatchExact, domain.MatchProbable:
			report.MatchedLineCount++
		default:
			report.UnmatchedLineCount++
		}
		if reconciled.Recoverable && reconciled.VarianceMinor > 0 {
			report.RecoverableMinor += reconciled.VarianceMinor
		}
		attributeVariance(varianceTotals, line, reconciled)
	}

	for _, charge := range charges {
		if consumed[charge.ID] > 0 {
			continue
		}
		if charge.StartedAt.Before(record.PeriodStart) || charge.StartedAt.After(record.PeriodEnd) {
			continue
		}
		energy := deref(charge.EnergyAddedWh)
		if energy <= 0 {
			continue
		}
		report.Uninvoiced = append(report.Uninvoiced, domain.UninvoicedSession{
			SessionID: charge.ID,
			StartedAt: charge.StartedAt,
			EnergyWh:  energy,
			Location:  charge.StartPlace,
			Narrative: "Measured session inside the billing period has no matching invoice line.",
		})
	}

	report.NetVarianceMinor = report.BilledTotalMinor - report.ExpectedTotalMinor
	report.EnergyVarianceWh = report.BilledEnergyWh - report.MeasuredEnergyWh
	report.VarianceBuckets = buildVarianceBuckets(varianceTotals, varianceCounts)
	report.DisputePacketDigest = disputeDigest(*record, report)

	reasons := []string{}
	if len(charges) == 0 {
		reasons = append(reasons, "no measured charging sessions overlap this billing period")
	}
	if report.UnmatchedLineCount > 0 {
		reasons = append(reasons, fmt.Sprintf("%d billed lines could not be matched to telemetry", report.UnmatchedLineCount))
	}
	coverage := 0.0
	if len(lines) > 0 {
		coverage = float64(report.MatchedLineCount) / float64(len(lines)) * 100
	}
	report.Quality = quality(
		gradeQuality(report.MatchedLineCount, 1, maxInt(len(lines)*8/10, 1)),
		len(lines),
		domain.Float64Pointer(coverage),
		domain.Window{From: record.PeriodStart, To: record.PeriodEnd, Days: int(record.PeriodEnd.Sub(record.PeriodStart).Hours() / 24)},
		reasons...,
	)
	report.Evidence = append(report.Evidence, evidence(
		"charging_sessions",
		domain.TimePointer(record.PeriodEnd),
		domain.IntPointer(len(charges)),
		fmt.Sprintf(
			"%d measured sessions were compared with %d billed lines using a %.0f second match window and a %.0f%% metering tolerance.",
			len(charges), len(lines), matchWindowS, energyToleranceRatio*100,
		),
	))
	return report, nil
}

func reconcileLine(
	line port.InvoiceLineRecord,
	charges []port.ChargeRecord,
	consumed map[int64]int,
	medianRate float64,
) domain.ReconciledLine {
	reconciled := domain.ReconciledLine{
		Line:            invoiceLineToDomain(line),
		MatchState:      domain.MatchUnmatched,
		VarianceReasons: []string{},
	}
	bestScore, secondScore := 0.0, 0.0
	var best *port.ChargeRecord
	for index := range charges {
		charge := charges[index]
		energy := deref(charge.EnergyAddedWh)
		if energy <= 0 {
			continue
		}
		gap := math.Abs(charge.StartedAt.Sub(line.OccurredAt).Seconds())
		if gap > matchWindowS {
			continue
		}
		timeScore := math.Max(0, 1-gap/matchWindowS)
		energyScore := 1.0
		if line.BilledEnergyWh > 0 {
			energyScore = math.Max(0, 1-math.Abs(energy-line.BilledEnergyWh)/line.BilledEnergyWh)
		}
		score := timeScore*0.5 + energyScore*0.5
		if score > bestScore {
			secondScore = bestScore
			bestScore = score
			best = &charges[index]
		} else if score > secondScore {
			secondScore = score
		}
	}
	if best == nil || bestScore < minimumMatchScore {
		reconciled.VarianceMinor = line.BilledTotalMinor
		reconciled.VarianceReasons = append(reconciled.VarianceReasons, "unmatched_line")
		reconciled.Recoverable = true
		return reconciled
	}

	measured := deref(best.EnergyAddedWh)
	reconciled.SessionID = pointer(best.ID)
	reconciled.SessionStartedAt = domain.TimePointer(best.StartedAt)
	reconciled.MeasuredEnergyWh = pointer(measured)
	reconciled.MatchConfidence = clamp(bestScore*100, 0, 100)
	gapS := int64(best.StartedAt.Sub(line.OccurredAt).Seconds())
	reconciled.TimeDeltaS = pointer(gapS)
	delta := line.BilledEnergyWh - measured
	reconciled.EnergyDeltaWh = pointer(delta)
	if measured > 0 {
		reconciled.EnergyDeltaPct = pointer(delta / measured * 100)
	}

	switch {
	case consumed[best.ID] > 0:
		reconciled.MatchState = domain.MatchDuplicate
		reconciled.VarianceReasons = append(reconciled.VarianceReasons, "duplicate_line")
		reconciled.Recoverable = true
		reconciled.VarianceMinor = line.BilledTotalMinor
		return reconciled
	case bestScore >= exactMatchScore:
		reconciled.MatchState = domain.MatchExact
	case bestScore >= probableMatchScore:
		reconciled.MatchState = domain.MatchProbable
	default:
		reconciled.MatchState = domain.MatchAmbiguous
		reconciled.VarianceReasons = append(reconciled.VarianceReasons, "ambiguous_match")
	}
	if bestScore-secondScore < 0.05 && secondScore >= minimumMatchScore {
		reconciled.Ambiguous = true
		if reconciled.MatchState == domain.MatchExact {
			reconciled.MatchState = domain.MatchProbable
		}
		reconciled.VarianceReasons = appendUnique(reconciled.VarianceReasons, "ambiguous_match")
	}

	unitRate := 0.0
	if line.BilledEnergyWh > 0 {
		unitRate = float64(line.BilledEnergyMinor) / line.BilledEnergyWh
	}
	expectedEnergyMinor := roundMinor(measured * unitRate)
	expected := expectedEnergyMinor + line.BilledIdleMinor + line.BilledTaxMinor
	reconciled.ExpectedCostMinor = pointer(expected)
	reconciled.VarianceMinor = line.BilledTotalMinor - expected

	tolerance := measured * energyToleranceRatio
	if delta > tolerance {
		reconciled.VarianceReasons = append(reconciled.VarianceReasons, "energy_overstated")
		reconciled.Recoverable = true
	} else if delta < -tolerance {
		reconciled.VarianceReasons = append(reconciled.VarianceReasons, "energy_understated")
	}
	if medianRate > 0 && unitRate > 0 && math.Abs(unitRate-medianRate)/medianRate > rateToleranceRatio {
		reconciled.VarianceReasons = append(reconciled.VarianceReasons, "rate_mismatch")
		if unitRate > medianRate {
			reconciled.Recoverable = true
		}
	}
	if line.BilledIdleMinor > 0 {
		reconciled.VarianceReasons = append(reconciled.VarianceReasons, "idle_fee")
	}
	if line.BilledTaxMinor > 0 {
		reconciled.VarianceReasons = append(reconciled.VarianceReasons, "tax")
	}
	componentSum := line.BilledEnergyMinor + line.BilledIdleMinor + line.BilledTaxMinor
	if componentSum != line.BilledTotalMinor {
		reconciled.VarianceReasons = append(reconciled.VarianceReasons, "line_total_mismatch")
		reconciled.Recoverable = true
	}
	return reconciled
}

func attributeVariance(totals map[string]int64, line port.InvoiceLineRecord, reconciled domain.ReconciledLine) {
	for _, reason := range reconciled.VarianceReasons {
		switch reason {
		case "idle_fee":
			totals[reason] += line.BilledIdleMinor
		case "tax":
			totals[reason] += line.BilledTaxMinor
		case "line_total_mismatch":
			totals[reason] += absInt64(line.BilledTotalMinor - (line.BilledEnergyMinor + line.BilledIdleMinor + line.BilledTaxMinor))
		case "unmatched_line", "duplicate_line":
			totals[reason] += line.BilledTotalMinor
		default:
			totals[reason] += absInt64(reconciled.VarianceMinor)
		}
	}
}

func buildVarianceBuckets(totals map[string]int64, counts map[string]int) []domain.VarianceBucket {
	grand := int64(0)
	for _, amount := range totals {
		grand += absInt64(amount)
	}
	buckets := make([]domain.VarianceBucket, 0, len(totals))
	for reason, amount := range totals {
		meta, known := varianceLabels[reason]
		label := reason
		recoverable := false
		if known {
			label = meta.label
			recoverable = meta.recoverable
		}
		share := 0.0
		if grand > 0 {
			share = float64(absInt64(amount)) / float64(grand) * 100
		}
		buckets = append(buckets, domain.VarianceBucket{
			Reason:      reason,
			Label:       label,
			LineCount:   counts[reason],
			AmountMinor: amount,
			SharePct:    share,
			Recoverable: recoverable,
		})
	}
	sort.SliceStable(buckets, func(i, j int) bool {
		if absInt64(buckets[i].AmountMinor) == absInt64(buckets[j].AmountMinor) {
			return buckets[i].Reason < buckets[j].Reason
		}
		return absInt64(buckets[i].AmountMinor) > absInt64(buckets[j].AmountMinor)
	})
	return buckets
}

// CreateDispute records a challenge against a reconciled invoice.
func (s *Service) CreateDispute(
	ctx context.Context,
	subject string,
	invoiceID int64,
	request domain.CreateDisputeRequest,
) (*domain.InvoiceDispute, error) {
	if invoiceID <= 0 {
		return nil, fmt.Errorf("%w: invoice id must be positive", ErrInvalidInput)
	}
	if !request.Confirmed {
		return nil, ErrNotConfirmed
	}
	if !requirePositive(request.ClaimedMinor) {
		return nil, fmt.Errorf("%w: claimed_minor must be positive", ErrInvalidInput)
	}
	note, ok := cleanText(request.Note, 2000)
	if !ok {
		return nil, fmt.Errorf("%w: note is too long", ErrInvalidInput)
	}
	if len(request.Reasons) > 12 {
		return nil, fmt.Errorf("%w: at most 12 reasons can be cited", ErrInvalidInput)
	}
	reasons := make([]string, 0, len(request.Reasons))
	for _, reason := range request.Reasons {
		reason = strings.TrimSpace(reason)
		if reason == "" {
			continue
		}
		if _, known := varianceLabels[reason]; !known {
			return nil, fmt.Errorf("%w: %q is not a recognised variance reason", ErrInvalidInput, reason)
		}
		reasons = append(reasons, reason)
	}
	record, err := s.durable.CreateDispute(ctx, subject, port.DisputeRecord{
		InvoiceID:    invoiceID,
		ClaimedMinor: request.ClaimedMinor,
		Status:       "submitted",
		Reasons:      reasons,
		Note:         note,
		OpenedAt:     s.now(),
	})
	if err != nil {
		return nil, fmt.Errorf("create dispute: %w", err)
	}
	dispute := disputeToDomain(*record)
	return &dispute, nil
}

func medianUnitRate(lines []port.InvoiceLineRecord) float64 {
	rates := make([]float64, 0, len(lines))
	for _, line := range lines {
		if line.BilledEnergyWh > 0 && line.BilledEnergyMinor > 0 {
			rates = append(rates, float64(line.BilledEnergyMinor)/line.BilledEnergyWh)
		}
	}
	return deref(median(rates))
}

func disputeDigest(record port.InvoiceRecord, report *domain.ReconciliationReport) string {
	hasher := sha256.New()
	fmt.Fprintf(hasher, "v1|%s|%s|%s|", record.Provider, record.InvoiceRef, record.Currency)
	fmt.Fprintf(hasher, "%d|%d|%d|", report.BilledTotalMinor, report.ExpectedTotalMinor, report.RecoverableMinor)
	for _, line := range report.Lines {
		fmt.Fprintf(hasher, "%s:%s:%d;", line.Line.LineRef, line.MatchState, line.VarianceMinor)
	}
	return hex.EncodeToString(hasher.Sum(nil))
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func absInt64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}

func invoiceToDomain(record port.InvoiceRecord) domain.ChargingInvoice {
	lines := make([]domain.InvoiceLine, 0, len(record.Lines))
	for _, line := range record.Lines {
		lines = append(lines, invoiceLineToDomain(line))
	}
	return domain.ChargingInvoice{
		ID:               record.ID,
		VehicleID:        record.VehicleID,
		Provider:         record.Provider,
		InvoiceRef:       record.InvoiceRef,
		Currency:         record.Currency,
		PeriodStart:      record.PeriodStart,
		PeriodEnd:        record.PeriodEnd,
		BilledTotalMinor: record.BilledTotalMinor,
		Status:           domain.InvoiceStatus(record.Status),
		LineCount:        len(record.Lines),
		Version:          record.Version,
		Lines:            lines,
		CreatedAt:        record.CreatedAt,
		UpdatedAt:        record.UpdatedAt,
	}
}

func invoiceLineToDomain(record port.InvoiceLineRecord) domain.InvoiceLine {
	return domain.InvoiceLine{
		ID:                record.ID,
		LineRef:           record.LineRef,
		OccurredAt:        record.OccurredAt,
		Location:          record.Location,
		BilledEnergyWh:    record.BilledEnergyWh,
		BilledEnergyMinor: record.BilledEnergyMinor,
		BilledIdleMinor:   record.BilledIdleMinor,
		BilledTaxMinor:    record.BilledTaxMinor,
		BilledTotalMinor:  record.BilledTotalMinor,
	}
}

func disputeToDomain(record port.DisputeRecord) domain.InvoiceDispute {
	return domain.InvoiceDispute{
		ID:             record.ID,
		InvoiceID:      record.InvoiceID,
		ClaimedMinor:   record.ClaimedMinor,
		RecoveredMinor: record.RecoveredMinor,
		Status:         record.Status,
		Reasons:        nonNilStrings(record.Reasons),
		Note:           record.Note,
		OpenedAt:       record.OpenedAt,
		ResolvedAt:     record.ResolvedAt,
	}
}

func disputesToDomain(records []port.DisputeRecord) []domain.InvoiceDispute {
	items := make([]domain.InvoiceDispute, 0, len(records))
	for _, record := range records {
		items = append(items, disputeToDomain(record))
	}
	return items
}
