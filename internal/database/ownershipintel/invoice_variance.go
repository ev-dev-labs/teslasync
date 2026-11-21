package ownershipintel

import (
	"context"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/database"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

func (r *DurableRepository) UpdateInvoiceReview(ctx context.Context, subject string, id int64, update port.InvoiceReviewUpdate) error {
	return r.withTx(ctx, func(tx database.DBTX) error {
		invoice, err := scanInvoice(tx.QueryRow(ctx, scopedInvoice+` FOR UPDATE`, subject, id))
		if err != nil {
			return mapWriteError("lock invoice review", err)
		}
		if invoice.VehicleID != update.Scope.VehicleID || (invoice.VarianceOptions == nil && !invoice.ReviewCleared) {
			return port.ErrNotFound
		}
		if invoice.Version != update.Scope.ExpectedVersion || (invoice.ReviewCleared && update.Options == nil) {
			return port.ErrInvoiceReviewChanged
		}
		if update.Options != nil {
			if err := r.attachInvoiceLines(ctx, tx, invoice); err != nil {
				return err
			}
			if err := update.Verify(*invoice); err != nil {
				return err
			}
		}
		return writeInvoiceReview(ctx, tx, invoice.ID, update)
	})
}

func writeInvoiceReview(ctx context.Context, tx database.DBTX, id int64, update port.InvoiceReviewUpdate) error {
	var threshold *int64
	var complete bool
	if update.Options != nil {
		threshold = &update.Options.MaterialAmountMinor
		complete = update.Options.CompleteStatement
	}
	if _, err := tx.Exec(ctx, `
		UPDATE charging_invoices
		SET variance_threshold_minor=$2, variance_complete_statement=$3, variance_review_cleared=$4,
		    version=version+1, updated_at=now()
		WHERE id=$1`, id, threshold, complete, update.Options == nil); err != nil {
		return mapWriteError("update invoice review", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE charging_invoice_lines SET review_billed_boundary=NULL, review_observed_boundary=NULL,
		    review_observed_energy_wh=NULL, review_max_loss_wh=NULL, review_rate_boundary=NULL,
		    review_rate_amount_minor=NULL, review_rate_energy_wh=NULL, review_other_fees_minor=NULL
		WHERE invoice_id=$1`, id); err != nil {
		return fmt.Errorf("clear previous invoice review evidence: %w", err)
	}
	for lineID, evidence := range update.Evidence {
		v := invoiceVarianceFromDomain(&evidence)
		if _, err := tx.Exec(ctx, `
			UPDATE charging_invoice_lines SET review_billed_boundary=$3, review_observed_boundary=$4,
			    review_observed_energy_wh=$5, review_max_loss_wh=$6, review_rate_boundary=$7,
			    review_rate_amount_minor=$8, review_rate_energy_wh=$9, review_other_fees_minor=$10
			WHERE invoice_id=$1 AND id=$2`, id, lineID, v.billed, v.observed, v.energy, v.loss,
			v.rateBoundary, v.rateAmount, v.rateEnergy, v.otherFees); err != nil {
			return fmt.Errorf("replace invoice line review evidence: %w", err)
		}
	}
	return nil
}

type invoiceVarianceFields struct {
	billed, observed, rateBoundary *domain.MeterBoundary
	energy, loss                   *float64
	rateAmount, rateEnergy         *int64
	otherFees                      *int64
}

func invoiceVarianceFromDomain(source *domain.InvoiceVarianceEvidence) invoiceVarianceFields {
	var out invoiceVarianceFields
	if source == nil {
		return out
	}
	if source.BilledBoundary != "" {
		out.billed = &source.BilledBoundary
	}
	if source.Meter != nil {
		out.observed, out.energy, out.loss = &source.Meter.ObservedBoundary, &source.Meter.ObservedEnergyWh, source.Meter.MaxLossWh
	}
	if source.Rate != nil {
		out.rateBoundary, out.rateAmount, out.rateEnergy = &source.Rate.Boundary, source.Rate.AmountMinor, &source.Rate.EnergyWh
	}
	out.otherFees = source.OtherFeesMinor
	return out
}

func (v invoiceVarianceFields) toDomain() *domain.InvoiceVarianceEvidence {
	if v.billed == nil && v.otherFees == nil {
		return nil
	}
	out := &domain.InvoiceVarianceEvidence{OtherFeesMinor: v.otherFees}
	if v.billed != nil {
		out.BilledBoundary = *v.billed
	}
	if v.observed != nil && v.energy != nil {
		out.Meter = &domain.InvoiceMeterEvidence{ObservedBoundary: *v.observed, ObservedEnergyWh: *v.energy, MaxLossWh: v.loss}
	}
	if v.rateBoundary != nil && v.rateAmount != nil && v.rateEnergy != nil {
		out.Rate = &domain.InvoiceRateEvidence{Boundary: *v.rateBoundary, AmountMinor: v.rateAmount, EnergyWh: *v.rateEnergy}
	}
	return out
}
