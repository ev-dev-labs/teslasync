CREATE TABLE IF NOT EXISTS tesla_user_orders (
    id              BIGSERIAL PRIMARY KEY,
    order_id        TEXT NOT NULL UNIQUE,
    model           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT '',
    delivery_date   DATE,
    vin             TEXT,
    referral_code   TEXT,
    is_upgradable   BOOLEAN NOT NULL DEFAULT false,
    raw_json        JSONB NOT NULL DEFAULT '{}',
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tesla_user_orders_order_id ON tesla_user_orders (order_id);
