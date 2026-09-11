CREATE TABLE tco_ledger_entries (
    id          BIGSERIAL PRIMARY KEY,
    vehicle_id  BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    category    TEXT NOT NULL,
    amount      NUMERIC(12,2) NOT NULL,
    currency    TEXT NOT NULL DEFAULT 'USD',
    incurred_on DATE NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tco_ledger_vehicle ON tco_ledger_entries(vehicle_id);
CREATE INDEX idx_tco_ledger_incurred ON tco_ledger_entries(vehicle_id, incurred_on DESC);
