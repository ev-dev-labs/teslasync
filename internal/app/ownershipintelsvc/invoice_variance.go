package ownershipintelsvc

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

const (
	maxReviewedAmount    = 1_000_000_000_000
	maxReviewedEnergyWh  = 1_000_000
	maxReviewPeriod      = 366 * 24 * time.Hour
	reviewMatchWindow    = 2 * time.Minute
	reviewConflictWindow = 5 * time.Minute
)

func boundedAmount(minor int64) bool {
	return minor >= 0 && minor <= maxReviewedAmount
}

func boundedChargeEnergy(wh float64) bool {
	return wh >= 0 && wh <= maxReviewedEnergyWh
}

func knownMeterBoundary(boundary domain.MeterBoundary) bool {
	return boundary == domain.MeterBoundaryStation || boundary == domain.MeterBoundaryBattery
}

func invoiceMeterRange(billed domain.MeterBoundary, meter *domain.InvoiceMeterEvidence) (low, high float64, ok bool) {
	if meter == nil || !knownMeterBoundary(billed) || !knownMeterBoundary(meter.ObservedBoundary) ||
		meter.ObservedEnergyWh <= 0 || !boundedChargeEnergy(meter.ObservedEnergyWh) {
		return 0, 0, false
	}
	low, high = meter.ObservedEnergyWh, meter.ObservedEnergyWh
	if billed == meter.ObservedBoundary {
		return low, high, true
	}
	if meter.MaxLossWh == nil || !validLoss(meter) {
		return 0, 0, false
	}
	if billed == domain.MeterBoundaryStation {
		high += *meter.MaxLossWh
	} else {
		low -= *meter.MaxLossWh
	}
	return low, high, true
}

func validLoss(meter *domain.InvoiceMeterEvidence) bool {
	return boundedChargeEnergy(*meter.MaxLossWh) && *meter.MaxLossWh <= 0.30*meter.ObservedEnergyWh
}

func validateVarianceImport(subject string, request domain.CreateInvoiceRequest, lines []domain.InvoiceLine) error {
	options := request.VarianceOptions
	if options != nil && (subject == domain.LegacyOpenSubject || strings.TrimSpace(subject) == "" ||
		options.MaterialAmountMinor <= 0 || !boundedAmount(options.MaterialAmountMinor) ||
		request.BilledTotalMinor == nil || !boundedAmount(*request.BilledTotalMinor) || request.PeriodEnd.Sub(request.PeriodStart) > maxReviewPeriod) {
		return fmt.Errorf("%w: a private variance review requires a signed-in subject, a bounded statement and a positive threshold", ErrInvalidInput)
	}
	for _, line := range lines {
		evidence := line.VarianceEvidence
		if options == nil && evidence == nil {
			continue
		}
		if options == nil || !boundedAmount(line.BilledEnergyMinor) || !boundedAmount(line.BilledIdleMinor) ||
			!boundedAmount(line.BilledTaxMinor) || !boundedAmount(line.BilledTotalMinor) ||
			!boundedChargeEnergy(line.BilledEnergyWh) || line.OccurredAt.Before(request.PeriodStart) ||
			!line.OccurredAt.Before(request.PeriodEnd) {
			return fmt.Errorf("%w: private variance evidence requires amounts and timestamps within the opted-in statement", ErrInvalidInput)
		}
		if evidence == nil {
			continue
		}
		if (evidence.BilledBoundary != "" && !knownMeterBoundary(evidence.BilledBoundary)) ||
			(evidence.OtherFeesMinor != nil && !boundedAmount(*evidence.OtherFeesMinor)) {
			return fmt.Errorf("%w: invalid billing boundary or other fees", ErrInvalidInput)
		}
		if meter := evidence.Meter; meter != nil && (!knownMeterBoundary(evidence.BilledBoundary) ||
			!knownMeterBoundary(meter.ObservedBoundary) || !(meter.ObservedEnergyWh > 0) ||
			!boundedChargeEnergy(meter.ObservedEnergyWh) ||
			(meter.MaxLossWh != nil && (evidence.BilledBoundary == meter.ObservedBoundary || !validLoss(meter)))) {
			return fmt.Errorf("%w: invalid meter evidence or loss bound", ErrInvalidInput)
		}
		if rate := evidence.Rate; rate != nil && (!knownMeterBoundary(rate.Boundary) ||
			!knownMeterBoundary(evidence.BilledBoundary) || rate.AmountMinor == nil || !boundedAmount(*rate.AmountMinor) ||
			rate.EnergyWh <= 0 || rate.EnergyWh > maxReviewedEnergyWh) {
			return fmt.Errorf("%w: invalid independent rate evidence", ErrInvalidInput)
		}
	}
	return nil
}

func (s *Service) UpdateInvoiceReview(ctx context.Context, subject string, id int64, request domain.UpdateInvoiceReviewRequest) error {
	if !request.Confirmed {
		return ErrNotConfirmed
	}
	if len(request.Lines) > 500 {
		return fmt.Errorf("%w: an invoice review cannot exceed 500 lines", ErrInvalidInput)
	}
	values := make(map[int64]domain.InvoiceVarianceEvidence, len(request.Lines))
	for _, line := range request.Lines {
		if _, duplicate := values[line.LineID]; line.LineID <= 0 || duplicate {
			return fmt.Errorf("%w: each review line requires a unique positive statement line ID", ErrInvalidInput)
		}
		values[line.LineID] = line.Evidence
	}
	return s.changeInvoiceReview(ctx, subject, id, port.InvoiceReviewUpdate{
		Scope: request.InvoiceReviewScope, Options: &request.Options, Evidence: values,
		Verify: func(invoice port.InvoiceRecord) error {
			lines := invoiceToDomain(invoice).Lines
			matched := 0
			for index := range lines {
				line := &lines[index]
				line.VarianceEvidence = nil
				if value, ok := values[line.ID]; ok {
					line.VarianceEvidence = &value
					matched++
				}
			}
			if matched != len(values) {
				return fmt.Errorf("%w: invoice review contains a line outside the statement", ErrInvalidInput)
			}
			return validateVarianceImport(subject, domain.CreateInvoiceRequest{
				PeriodStart: invoice.PeriodStart, PeriodEnd: invoice.PeriodEnd, BilledTotalMinor: pointer(invoice.BilledTotalMinor),
				VarianceOptions: &request.Options,
			}, lines)
		},
	})
}

func (s *Service) ClearInvoiceReview(ctx context.Context, subject string, id int64, scope domain.InvoiceReviewScope) error {
	return s.changeInvoiceReview(ctx, subject, id, port.InvoiceReviewUpdate{Scope: scope})
}

func (s *Service) changeInvoiceReview(ctx context.Context, subject string, id int64, update port.InvoiceReviewUpdate) error {
	if id <= 0 || update.Scope.VehicleID <= 0 || update.Scope.ExpectedVersion <= 0 ||
		subject == domain.LegacyOpenSubject || strings.TrimSpace(subject) == "" {
		return fmt.Errorf("%w: a signed-in statement, vehicle and revision are required", ErrInvalidInput)
	}
	return s.durable.UpdateInvoiceReview(ctx, subject, id, update)
}

func assessInvoiceVariance(line domain.InvoiceLine, matched bool, threshold int64) domain.InvoiceVarianceAssessment {
	var out domain.InvoiceVarianceAssessment
	evidence := line.VarianceEvidence
	if evidence == nil || threshold <= 0 || !boundedAmount(threshold) ||
		!boundedAmount(line.BilledEnergyMinor) || !boundedAmount(line.BilledIdleMinor) || !boundedAmount(line.BilledTaxMinor) ||
		!boundedAmount(line.BilledTotalMinor) || !boundedChargeEnergy(line.BilledEnergyWh) {
		return out
	}
	if low, high, ok := invoiceMeterRange(evidence.BilledBoundary, evidence.Meter); matched && ok && line.BilledEnergyWh > 0 {
		out.ExpectedEnergyLowerWh, out.ExpectedEnergyUpperWh = &low, &high
		nearest := math.Max(low, math.Min(high, line.BilledEnergyWh))
		residual := line.BilledEnergyWh - nearest
		if math.Abs(residual) >= math.Max(500, 0.05*nearest) {
			out.UnexplainedEnergyWh = &residual
		}
	}
	if rate := evidence.Rate; matched && line.AmountCoverage&domain.InvoiceEnergyAmountKnown != 0 &&
		rate != nil && knownMeterBoundary(rate.Boundary) &&
		rate.Boundary == evidence.BilledBoundary && rate.AmountMinor != nil && boundedAmount(*rate.AmountMinor) && rate.EnergyWh > 0 &&
		rate.EnergyWh <= maxReviewedEnergyWh && line.BilledEnergyWh > 0 {
		expected := math.Round(float64(*rate.AmountMinor) * line.BilledEnergyWh / float64(rate.EnergyWh))
		if expected <= maxReviewedAmount {
			expectedMinor := int64(expected)
			out.ExpectedEnergyMinor = &expectedMinor
			if residual := line.BilledEnergyMinor - expectedMinor; absInt64(residual) >= threshold {
				out.UnexplainedRateMinor = &residual
			}
		}
	}
	if extraFees := evidence.OtherFeesMinor; line.AmountCoverage == domain.InvoiceAllAmountsKnown &&
		extraFees != nil && boundedAmount(*extraFees) {
		components := line.BilledEnergyMinor + line.BilledIdleMinor + line.BilledTaxMinor + *extraFees
		out.ComponentsTotalMinor = &components
		if residual := line.BilledTotalMinor - components; absInt64(residual) >= threshold {
			out.UnexplainedTotalMinor = &residual
		}
	}
	return out
}

func identifyInvoiceSession(
	line port.InvoiceLineRecord, charges []port.ChargeRecord, through, now time.Time,
) (*port.ChargeRecord, bool) {
	site := strings.TrimSpace(line.Location)
	if site == "" || len(charges) >= 20_000 || line.OccurredAt.After(now) {
		return nil, false
	}
	var match *port.ChargeRecord
	closeStarts := 0
	for index := range charges {
		charge := &charges[index]
		gap := charge.StartedAt.Sub(line.OccurredAt).Abs()
		if gap > reviewConflictWindow {
			continue
		}
		closeStarts++
		if gap <= reviewMatchWindow && strings.EqualFold(site, strings.TrimSpace(charge.StartPlace)) &&
			charge.EndedAt != nil && charge.EndedAt.After(charge.StartedAt) &&
			!charge.EndedAt.After(through) && !charge.EndedAt.After(now) {
			match = charge
		}
	}
	if closeStarts != 1 {
		return nil, closeStarts > 1
	}
	return match, false
}

func reviewInvoiceVariance(
	invoice port.InvoiceRecord, lines []port.InvoiceLineRecord, charges []port.ChargeRecord, hasDispute bool, now time.Time,
) (*domain.InvoiceVarianceReview, []domain.ReconciledLine) {
	options := invoice.VarianceOptions
	review := &domain.InvoiceVarianceReview{State: "insufficient", Findings: []domain.InvoiceVarianceFinding{}}
	rows := make([]domain.ReconciledLine, 0, len(lines))
	matches := make(map[int64]int, len(lines))
	for _, line := range lines {
		row := domain.ReconciledLine{Line: invoiceLineToDomain(line), MatchState: domain.MatchUnmatched, VarianceReasons: []string{}}
		if charge, ambiguous := identifyInvoiceSession(line, charges, invoice.PeriodEnd, now); charge != nil {
			row.SessionID = &charge.ID
			row.SessionStartedAt = &charge.StartedAt
			row.TimeDeltaS = pointer(int64(charge.StartedAt.Sub(line.OccurredAt).Seconds()))
			row.MatchState = domain.MatchProbable
			matches[charge.ID]++
		} else if ambiguous {
			row.MatchState, row.Ambiguous = domain.MatchAmbiguous, true
		}
		rows = append(rows, row)
	}
	handled := hasDispute || invoice.Status == string(domain.InvoiceSettled) || invoice.Status == string(domain.InvoiceDisputed)
	var lineSum int64
	totalsKnown := options.CompleteStatement && !invoice.PeriodEnd.After(now) && boundedAmount(invoice.BilledTotalMinor)
	for index := range rows {
		row := &rows[index]
		matched := row.SessionID != nil && matches[*row.SessionID] == 1
		if row.SessionID != nil && !matched {
			row.MatchState, row.Ambiguous = domain.MatchAmbiguous, true
			row.SessionID, row.SessionStartedAt, row.TimeDeltaS = nil, nil, nil
		}
		if matched {
			review.MatchedLines++
		}
		if boundedAmount(row.Line.BilledTotalMinor) {
			lineSum += row.Line.BilledTotalMinor
		} else {
			totalsKnown = false
		}
		if handled || row.Line.OccurredAt.After(now) {
			continue
		}
		assessment := assessInvoiceVariance(row.Line, matched, options.MaterialAmountMinor)
		if assessment.ExpectedEnergyLowerWh != nil || assessment.ExpectedEnergyMinor != nil || assessment.ComponentsTotalMinor != nil {
			review.ComparableLines++
		}
		if assessment.UnexplainedEnergyWh != nil || assessment.UnexplainedRateMinor != nil || assessment.UnexplainedTotalMinor != nil {
			review.Findings = append(review.Findings, domain.InvoiceVarianceFinding{
				LineID: row.Line.ID, SessionID: row.SessionID, SessionStartedAt: row.SessionStartedAt,
				Assessment: assessment,
			})
		}
	}
	if totalsKnown && !handled && len(rows) > 0 {
		if delta := invoice.BilledTotalMinor - lineSum; absInt64(delta) >= options.MaterialAmountMinor {
			review.UnexplainedStatementMinor = &delta
		}
	}
	switch {
	case handled:
		review.State = "handled"
	case len(review.Findings) > 0 || review.UnexplainedStatementMinor != nil:
		review.State = "review"
	case review.ComparableLines > 0 || (totalsKnown && len(rows) > 0):
		review.State = "no_material_difference"
	}
	return review, rows
}
