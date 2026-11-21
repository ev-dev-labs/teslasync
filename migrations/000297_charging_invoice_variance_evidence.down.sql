ALTER TABLE charging_invoice_lines
    DROP CONSTRAINT charging_invoice_lines_review_rate,
    DROP CONSTRAINT charging_invoice_lines_review_meter,
    DROP COLUMN review_other_fees_minor,
    DROP COLUMN review_rate_energy_wh,
    DROP COLUMN review_rate_amount_minor,
    DROP COLUMN review_rate_boundary,
    DROP COLUMN review_max_loss_wh,
    DROP COLUMN review_observed_energy_wh,
    DROP COLUMN review_observed_boundary,
    DROP COLUMN review_billed_boundary,
    DROP COLUMN billed_amount_coverage;

ALTER TABLE charging_invoices
    DROP CONSTRAINT charging_invoices_variance_consent,
    DROP COLUMN variance_complete_statement,
    DROP COLUMN variance_threshold_minor;
