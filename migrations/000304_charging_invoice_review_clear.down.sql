ALTER TABLE charging_invoices
    DROP CONSTRAINT charging_invoices_variance_cleared,
    DROP COLUMN variance_review_cleared;
