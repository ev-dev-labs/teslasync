BEGIN;

DROP TABLE IF EXISTS vehicle_subscriptions;
DROP TABLE IF EXISTS consumable_events;
DROP TABLE IF EXISTS consumable_items;
DROP TABLE IF EXISTS compliance_filings;
DROP TABLE IF EXISTS jurisdiction_rates;
DROP TABLE IF EXISTS model_predictions;
DROP TABLE IF EXISTS retention_runs;
DROP TABLE IF EXISTS retention_policies;
DROP TABLE IF EXISTS warranty_claims;
DROP TABLE IF EXISTS vehicle_warranties;
DROP TABLE IF EXISTS drive_driver_assignments;
DROP TABLE IF EXISTS driver_profiles;
DROP TABLE IF EXISTS charging_invoice_disputes;
DROP TABLE IF EXISTS charging_invoice_lines;
DROP TABLE IF EXISTS charging_invoices;
DROP TABLE IF EXISTS utility_tariff_rates;
DROP TABLE IF EXISTS utility_tariffs;
DROP TABLE IF EXISTS insurance_policies;

COMMIT;
