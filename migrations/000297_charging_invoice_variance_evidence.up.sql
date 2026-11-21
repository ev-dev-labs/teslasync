ALTER TABLE charging_invoices
    ADD COLUMN variance_threshold_minor bigint CHECK (variance_threshold_minor BETWEEN 1 AND 1000000000000),
    ADD COLUMN variance_complete_statement boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT charging_invoices_variance_consent
        CHECK (variance_threshold_minor IS NOT NULL OR NOT variance_complete_statement);

ALTER TABLE charging_invoice_lines
    ADD COLUMN billed_amount_coverage smallint NOT NULL DEFAULT 0 CHECK (billed_amount_coverage BETWEEN 0 AND 7),
    ADD COLUMN review_billed_boundary text CHECK (review_billed_boundary IN ('station', 'battery')),
    ADD COLUMN review_observed_boundary text CHECK (review_observed_boundary IN ('station', 'battery')),
    ADD COLUMN review_observed_energy_wh double precision CHECK (review_observed_energy_wh > 0 AND review_observed_energy_wh <= 1000000),
    ADD COLUMN review_max_loss_wh double precision CHECK (review_max_loss_wh BETWEEN 0 AND 1000000),
    ADD COLUMN review_rate_boundary text CHECK (review_rate_boundary IN ('station', 'battery')),
    ADD COLUMN review_rate_amount_minor bigint CHECK (review_rate_amount_minor BETWEEN 0 AND 1000000000000),
    ADD COLUMN review_rate_energy_wh bigint CHECK (review_rate_energy_wh BETWEEN 1 AND 1000000),
    ADD COLUMN review_other_fees_minor bigint CHECK (review_other_fees_minor BETWEEN 0 AND 1000000000000),
    ADD CONSTRAINT charging_invoice_lines_review_meter
        CHECK ((review_observed_boundary IS NULL) = (review_observed_energy_wh IS NULL)
            AND (review_observed_boundary IS NULL OR review_billed_boundary IS NOT NULL)
            AND (review_max_loss_wh IS NULL OR (review_observed_boundary IS NOT NULL
                AND review_observed_boundary <> review_billed_boundary
                AND review_max_loss_wh <= 0.30 * review_observed_energy_wh))),
    ADD CONSTRAINT charging_invoice_lines_review_rate
        CHECK ((review_rate_boundary IS NULL) = (review_rate_amount_minor IS NULL)
            AND (review_rate_boundary IS NULL) = (review_rate_energy_wh IS NULL)
            AND (review_rate_boundary IS NULL OR review_billed_boundary IS NOT NULL));
