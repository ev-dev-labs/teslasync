CREATE TABLE charge_plans (
    id              BIGSERIAL PRIMARY KEY,
    vehicle_id      BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    target_soc      INT NOT NULL,
    depart_by       TIMESTAMPTZ,
    scheduled_start TIMESTAMPTZ NOT NULL,
    scheduled_end   TIMESTAMPTZ NOT NULL,
    rate_plan       TEXT NOT NULL,
    estimated_kwh   NUMERIC(8,2),
    estimated_cost  NUMERIC(8,2),
    charge_now_cost NUMERIC(8,2),
    savings         NUMERIC(8,2),
    status          TEXT NOT NULL DEFAULT 'draft',
    applied_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_charge_plans_vehicle ON charge_plans(vehicle_id);
CREATE INDEX idx_charge_plans_status ON charge_plans(status);
CREATE INDEX idx_charge_plans_created ON charge_plans(created_at DESC);
