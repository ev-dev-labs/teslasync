-- DT-01: durable, attestable origin and timestamp provenance for signal_log.
--
-- All data columns are nullable for rolling compatibility. New writers use
-- an explicit origin (including "unknown"); legacy rows remain NULL. The
-- trigger clears trusted provenance if an older writer replaces the typed
-- payload without toggling the separate provenance attestation token.

ALTER TABLE signal_log
    ADD COLUMN IF NOT EXISTS ingest_origin TEXT,
    ADD COLUMN IF NOT EXISTS source_emitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS provenance_write_token BOOLEAN;

ALTER TABLE signal_log
    DROP CONSTRAINT IF EXISTS signal_log_ingest_origin_check,
    ADD CONSTRAINT signal_log_ingest_origin_check
        CHECK (ingest_origin IS NULL OR ingest_origin IN (
            'unknown',
            'fleet_telemetry_mqtt',
            'fleet_telemetry_http'
        )) NOT VALID;

COMMENT ON COLUMN signal_log.ingest_origin IS
    'Closed transport-origin vocabulary. NULL is legacy; unknown is an explicitly unstamped new writer.';
COMMENT ON COLUMN signal_log.source_emitted_at IS
    'Producer/source timestamp evidence only. NULL means EmittedAt was receipt fallback or source time is unavailable.';
COMMENT ON COLUMN signal_log.received_at IS
    'Timestamp at the MQTT subscriber or HTTP webhook receipt boundary; NULL when that boundary is unavailable.';
COMMENT ON COLUMN signal_log.provenance_write_token IS
    'Internal rolling-deployment attestation toggled by provenance-aware writers; never an analytics field.';

-- signal_log intentionally keeps one canonical row per
-- (vehicle_id, ts, field). Agreement analysis needs both transport
-- observations when HTTP and MQTT share that key, so it uses a separate
-- evidence feed rather than weakening canonical exactly-once semantics.
CREATE TABLE signal_transport_evidence (
    vehicle_id            BIGINT      NOT NULL,
    source_emitted_at     TIMESTAMPTZ NOT NULL,
    field                 TEXT        NOT NULL,
    ingest_origin         TEXT        NOT NULL
        CHECK (ingest_origin IN (
            'fleet_telemetry_mqtt',
            'fleet_telemetry_http'
        )),
    received_at           TIMESTAMPTZ NOT NULL,
    value_kind            SMALLINT    NOT NULL,
    str_value             TEXT,
    bool_value            BOOLEAN,
    int_value             BIGINT,
    float_value           DOUBLE PRECISION,
    time_value            TIMESTAMPTZ,
    normalization_version INTEGER     NOT NULL
        CHECK (normalization_version >= 1),
    PRIMARY KEY (vehicle_id, source_emitted_at, field, ingest_origin)
);

SELECT create_hypertable(
    'signal_transport_evidence',
    'source_emitted_at',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

COMMENT ON TABLE signal_transport_evidence IS
    'Independent source-timestamped HTTP/MQTT observations for bounded '
    'cross-transport agreement analysis. Retention follows signal_log.';
COMMENT ON COLUMN signal_transport_evidence.source_emitted_at IS
    'Producer timestamp used for pairing; never synthesized from receipt time.';

-- Extend the previous normalization guard rather than adding an overlapping
-- trigger. The two independent tokens let each trusted claim be invalidated
-- when a pre-000234 writer changes the typed payload on a conflict.
CREATE OR REPLACE FUNCTION guard_signal_log_normalization_provenance()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.normalization_write_token IS NOT DISTINCT FROM OLD.normalization_write_token
       AND ROW(
           NEW.value_kind,
           NEW.str_value,
           NEW.bool_value,
           NEW.int_value,
           NEW.float_value,
           NEW.time_value
       ) IS DISTINCT FROM ROW(
           OLD.value_kind,
           OLD.str_value,
           OLD.bool_value,
           OLD.int_value,
           OLD.float_value,
           OLD.time_value
       ) THEN
        NEW.normalization_version := NULL;
    END IF;

    IF NEW.provenance_write_token IS NOT DISTINCT FROM OLD.provenance_write_token
       AND ROW(
           NEW.value_kind,
           NEW.str_value,
           NEW.bool_value,
           NEW.int_value,
           NEW.float_value,
           NEW.time_value
       ) IS DISTINCT FROM ROW(
           OLD.value_kind,
           OLD.str_value,
           OLD.bool_value,
           OLD.int_value,
           OLD.float_value,
           OLD.time_value
       ) THEN
        NEW.ingest_origin := 'unknown';
        NEW.source_emitted_at := NULL;
        NEW.received_at := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION persist_signal_transport_evidence()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.ingest_origin IN (
           'fleet_telemetry_mqtt',
           'fleet_telemetry_http'
       )
       AND NEW.source_emitted_at IS NOT NULL
       AND NEW.received_at IS NOT NULL
       AND NEW.normalization_version >= 1 THEN
        INSERT INTO signal_transport_evidence (
            vehicle_id,
            source_emitted_at,
            field,
            ingest_origin,
            received_at,
            value_kind,
            str_value,
            bool_value,
            int_value,
            float_value,
            time_value,
            normalization_version
        ) VALUES (
            NEW.vehicle_id,
            NEW.source_emitted_at,
            NEW.field,
            NEW.ingest_origin,
            NEW.received_at,
            NEW.value_kind,
            NEW.str_value,
            NEW.bool_value,
            NEW.int_value,
            NEW.float_value,
            NEW.time_value,
            NEW.normalization_version
        )
        -- The evidence row is one indivisible normalization result. Higher
        -- normalization versions win. At the same version the earliest
        -- transport receipt wins, and an exact receipt-time tie is a no-op
        -- (the canonical replay/idempotency case). Unknown versions never
        -- enter this table because of the predicate above.
        ON CONFLICT (vehicle_id, source_emitted_at, field, ingest_origin)
        DO UPDATE SET
            received_at = EXCLUDED.received_at,
            value_kind = EXCLUDED.value_kind,
            str_value = EXCLUDED.str_value,
            bool_value = EXCLUDED.bool_value,
            int_value = EXCLUDED.int_value,
            float_value = EXCLUDED.float_value,
            time_value = EXCLUDED.time_value,
            normalization_version = EXCLUDED.normalization_version
        WHERE
            EXCLUDED.normalization_version >
                signal_transport_evidence.normalization_version
            OR (
                EXCLUDED.normalization_version =
                    signal_transport_evidence.normalization_version
                AND EXCLUDED.received_at <
                    signal_transport_evidence.received_at
            );
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER signal_log_transport_evidence_capture
AFTER INSERT OR UPDATE ON signal_log
FOR EACH ROW
EXECUTE FUNCTION persist_signal_transport_evidence();
