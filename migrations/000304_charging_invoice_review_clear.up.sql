ALTER TABLE charging_invoices
    ADD COLUMN variance_review_cleared boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT charging_invoices_variance_cleared
        CHECK (NOT variance_review_cleared OR variance_threshold_minor IS NULL);
