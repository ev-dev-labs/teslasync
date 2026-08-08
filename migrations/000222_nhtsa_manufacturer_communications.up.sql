-- Official NHTSA manufacturer-communications/TSB normalized index.
-- Raw bulk artifacts are validated and normalized in memory; only the
-- fields required for vehicle applicability are retained.

CREATE TABLE IF NOT EXISTS nhtsa_communication_imports (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    artifact_url          text        NOT NULL
                                      CHECK (char_length(artifact_url) BETWEEN 1 AND 500),
    source_etag           text        CHECK (source_etag IS NULL OR char_length(source_etag) <= 255),
    source_last_modified  text        CHECK (source_last_modified IS NULL OR char_length(source_last_modified) <= 255),
    artifact_sha256       text        CHECK (artifact_sha256 IS NULL OR artifact_sha256 ~ '^[0-9a-f]{64}$'),
    status                text        NOT NULL
                                      CHECK (status IN ('running', 'succeeded', 'failed')),
    total_rows            integer     NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
    imported_rows         integer     NOT NULL DEFAULT 0 CHECK (imported_rows >= 0),
    rejected_rows         integer     NOT NULL DEFAULT 0 CHECK (rejected_rows >= 0),
    not_modified          boolean     NOT NULL DEFAULT false,
    error_detail          text        CHECK (error_detail IS NULL OR char_length(error_detail) <= 500),
    started_at            timestamptz NOT NULL DEFAULT now(),
    completed_at          timestamptz,
    CONSTRAINT nhtsa_communication_import_completion CHECK (
        (status = 'running' AND completed_at IS NULL) OR
        (status IN ('succeeded', 'failed') AND completed_at IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS nhtsa_manufacturer_communications (
    nhtsa_id              text        NOT NULL
                                      CHECK (nhtsa_id ~ '^[0-9]{6,20}$'),
    communication_number  text        NOT NULL
                                      CHECK (char_length(btrim(communication_number)) BETWEEN 1 AND 160),
    communication_type    text        NOT NULL DEFAULT ''
                                      CHECK (char_length(communication_type) <= 160),
    manufacturer          text        NOT NULL
                                      CHECK (char_length(btrim(manufacturer)) BETWEEN 1 AND 120),
    model                 text        NOT NULL
                                      CHECK (char_length(btrim(model)) BETWEEN 1 AND 120),
    model_year            integer     NOT NULL CHECK (model_year BETWEEN 1886 AND 2200),
    component             text        NOT NULL DEFAULT ''
                                      CHECK (char_length(component) <= 500),
    summary               text        NOT NULL
                                      CHECK (char_length(btrim(summary)) BETWEEN 1 AND 20000),
    published_at          date,
    source_document_url   text        NOT NULL
                                      CHECK (char_length(source_document_url) BETWEEN 1 AND 500),
    import_id             bigint      NOT NULL
                                      REFERENCES nhtsa_communication_imports(id) ON DELETE CASCADE,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (nhtsa_id, manufacturer, model, model_year)
);

DROP TRIGGER IF EXISTS nhtsa_manufacturer_communications_set_updated_at
    ON nhtsa_manufacturer_communications;
CREATE TRIGGER nhtsa_manufacturer_communications_set_updated_at
    BEFORE UPDATE ON nhtsa_manufacturer_communications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS nhtsa_communications_vehicle_match_idx
    ON nhtsa_manufacturer_communications (
        upper(manufacturer),
        upper(model),
        model_year,
        published_at DESC,
        nhtsa_id
    );

CREATE INDEX IF NOT EXISTS nhtsa_communications_import_idx
    ON nhtsa_manufacturer_communications (import_id);

CREATE INDEX IF NOT EXISTS nhtsa_communication_imports_latest_success_idx
    ON nhtsa_communication_imports (completed_at DESC, id DESC)
    WHERE status = 'succeeded';

CREATE INDEX IF NOT EXISTS nhtsa_communication_imports_artifact_idx
    ON nhtsa_communication_imports (artifact_url, completed_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS nhtsa_communication_imports_one_running_idx
    ON nhtsa_communication_imports ((status))
    WHERE status = 'running';
