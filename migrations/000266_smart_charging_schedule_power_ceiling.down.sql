DELETE FROM smart_push_deliveries d USING smart_charging_plans p
WHERE d.plan_id = p.id AND d.decision_kind = 'schedule_conflict'
  AND p.scheduled_power_ceiling_w IS NOT NULL AND p.scheduled_start_at < p.departure_at;

DELETE FROM smart_charging_decisions d USING smart_charging_plans p
WHERE d.plan_id = p.id AND d.kind = 'schedule_conflict'
  AND p.scheduled_power_ceiling_w IS NOT NULL AND p.scheduled_start_at < p.departure_at;

ALTER TABLE smart_charging_plans
    DROP CONSTRAINT smart_charging_schedule_power_ceiling_valid,
    DROP COLUMN scheduled_power_ceiling_w;
