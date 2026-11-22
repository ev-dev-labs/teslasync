ALTER TABLE smart_charging_plans
    ADD COLUMN scheduled_power_ceiling_w double precision,
    ADD CONSTRAINT smart_charging_schedule_power_ceiling_valid CHECK (
        scheduled_power_ceiling_w IS NULL OR
        (scheduled_start_at IS NOT NULL AND scheduled_power_ceiling_w BETWEEN 1 AND 500000)
    ) NOT VALID;
ALTER TABLE smart_charging_plans VALIDATE CONSTRAINT smart_charging_schedule_power_ceiling_valid;
