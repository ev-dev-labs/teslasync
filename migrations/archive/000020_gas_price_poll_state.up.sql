-- Gas price auto-poll state persistence
CREATE TABLE IF NOT EXISTS gas_price_poll_state (
    id             INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled        BOOLEAN NOT NULL DEFAULT false,
    poll_interval  VARCHAR(10) NOT NULL DEFAULT '7d',
    last_poll_time TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    last_price     DOUBLE PRECISION NOT NULL DEFAULT 0
);
