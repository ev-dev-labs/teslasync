ALTER TABLE smart_charging_plans
    ADD COLUMN IF NOT EXISTS compare_site_rates boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN smart_charging_plans.compare_site_rates IS
    'Explicit consent to use the selected charging place''s verified effective price windows and currency for this plan.';
