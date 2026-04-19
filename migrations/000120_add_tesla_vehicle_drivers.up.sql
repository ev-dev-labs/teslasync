-- Vehicle drivers (who has access to each vehicle)
CREATE TABLE IF NOT EXISTS tesla_vehicle_drivers (
    id              BIGSERIAL PRIMARY KEY,
    vehicle_id      BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    vin             TEXT NOT NULL,
    share_user_id   BIGINT,
    driver_email    TEXT,
    driver_name     TEXT,
    role            TEXT,
    raw_json        JSONB NOT NULL DEFAULT '{}',
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_drivers_vid ON tesla_vehicle_drivers (vehicle_id);

-- Share invitations (pending invites to share vehicle access)
CREATE TABLE IF NOT EXISTS tesla_vehicle_invitations (
    id                  BIGSERIAL PRIMARY KEY,
    vehicle_id          BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    vin                 TEXT NOT NULL,
    invitation_id       TEXT NOT NULL,
    invite_url          TEXT,
    status              TEXT NOT NULL DEFAULT 'pending',
    expires_at          TIMESTAMPTZ,
    created_by          TEXT,
    raw_json            JSONB NOT NULL DEFAULT '{}',
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (vehicle_id, invitation_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_invitations_vid ON tesla_vehicle_invitations (vehicle_id);
