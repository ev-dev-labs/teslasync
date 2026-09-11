-- OCPP-J 1.6 CSMS persistence: charge points, connector status,
-- charging sessions, and meter samples recorded by cmd/ocpp-server.
-- Read back by the main API so mixed-fleet operators see non-Tesla
-- charger activity next to Tesla charging sessions.

CREATE TABLE IF NOT EXISTS ocpp_charge_points (
    charge_point_id text PRIMARY KEY
                    CHECK (char_length(charge_point_id) BETWEEN 1 AND 128),
    vendor          text NOT NULL DEFAULT ''
                    CHECK (char_length(vendor) <= 128),
    model           text NOT NULL DEFAULT ''
                    CHECK (char_length(model) <= 128),
    serial_number   text NOT NULL DEFAULT ''
                    CHECK (char_length(serial_number) <= 128),
    firmware_version text NOT NULL DEFAULT ''
                    CHECK (char_length(firmware_version) <= 128),
    last_boot_at    timestamptz,
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ocpp_connector_status (
    charge_point_id text    NOT NULL REFERENCES ocpp_charge_points (charge_point_id) ON DELETE CASCADE,
    connector_id    integer NOT NULL CHECK (connector_id >= 0),
    status          text    NOT NULL DEFAULT ''
                    CHECK (char_length(status) <= 32),
    error_code      text    NOT NULL DEFAULT ''
                    CHECK (char_length(error_code) <= 64),
    info            text    NOT NULL DEFAULT ''
                    CHECK (char_length(info) <= 500),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (charge_point_id, connector_id)
);

-- Transaction IDs are allocated by the CSMS dispatcher from one
-- process-global atomic counter, so they are globally unique and a
-- plain UNIQUE holds (StopSession/MeterValues address them bare).
CREATE TABLE IF NOT EXISTS ocpp_sessions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_id  integer NOT NULL UNIQUE CHECK (transaction_id > 0),
    charge_point_id text    NOT NULL REFERENCES ocpp_charge_points (charge_point_id) ON DELETE CASCADE,
    connector_id    integer NOT NULL CHECK (connector_id >= 0),
    id_tag          text    NOT NULL DEFAULT ''
                    CHECK (char_length(id_tag) <= 64),
    started_at      timestamptz NOT NULL DEFAULT now(),
    start_meter_wh  integer NOT NULL DEFAULT 0 CHECK (start_meter_wh >= 0),
    ended_at        timestamptz,
    end_meter_wh    integer CHECK (end_meter_wh IS NULL OR end_meter_wh >= 0),
    stop_reason     text    NOT NULL DEFAULT ''
                    CHECK (char_length(stop_reason) <= 64),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ocpp_sessions_end_consistency CHECK (
        (ended_at IS NULL AND end_meter_wh IS NULL) OR
        (ended_at IS NOT NULL AND end_meter_wh IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_ocpp_sessions_charge_point
    ON ocpp_sessions (charge_point_id, started_at DESC);

CREATE TABLE IF NOT EXISTS ocpp_meter_values (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id     bigint NOT NULL REFERENCES ocpp_sessions (id) ON DELETE CASCADE,
    connector_id   integer NOT NULL CHECK (connector_id >= 0),
    sampled_at     timestamptz NOT NULL DEFAULT now(),
    measurand      text NOT NULL DEFAULT ''
                   CHECK (char_length(measurand) <= 64),
    value          double precision NOT NULL,
    unit           text NOT NULL DEFAULT ''
                   CHECK (char_length(unit) <= 16),
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocpp_meter_values_session
    ON ocpp_meter_values (session_id, sampled_at);
