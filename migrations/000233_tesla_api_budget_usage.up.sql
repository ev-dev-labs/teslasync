CREATE TABLE tesla_api_budget_usage (
    budget_date date PRIMARY KEY,
    total_requests bigint NOT NULL DEFAULT 0 CHECK (total_requests >= 0),
    estimated_cost_microusd bigint NOT NULL DEFAULT 0 CHECK (estimated_cost_microusd >= 0),
    background_requests bigint NOT NULL DEFAULT 0 CHECK (background_requests >= 0),
    background_cost_microusd bigint NOT NULL DEFAULT 0 CHECK (background_cost_microusd >= 0),
    vehicle_data_requests bigint NOT NULL DEFAULT 0 CHECK (vehicle_data_requests >= 0),
    wake_up_requests bigint NOT NULL DEFAULT 0 CHECK (wake_up_requests >= 0),
    command_requests bigint NOT NULL DEFAULT 0 CHECK (command_requests >= 0),
    vehicle_specs_requests bigint NOT NULL DEFAULT 0 CHECK (vehicle_specs_requests >= 0),
    other_requests bigint NOT NULL DEFAULT 0 CHECK (other_requests >= 0),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CHECK (background_requests <= total_requests),
    CHECK (background_cost_microusd <= estimated_cost_microusd)
);

COMMENT ON TABLE tesla_api_budget_usage IS
    'Atomic UTC-daily Fleet API cost reservations shared by every TeslaSync process and replica.';
