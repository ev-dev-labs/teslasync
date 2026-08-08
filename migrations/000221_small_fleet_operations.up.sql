-- Feature 8: normalized small-fleet operations.
-- All physical measurements use TeslaSync's canonical SI floor:
-- odometer_m (metres), max_power_w (watts), and durations derived in seconds.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS fleet_drivers (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    display_name    text        NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
    reference_code  text        NOT NULL UNIQUE CHECK (char_length(btrim(reference_code)) BETWEEN 1 AND 64),
    status          text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'inactive')),
    version         integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fleet_cost_centers (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text        NOT NULL UNIQUE CHECK (char_length(btrim(code)) BETWEEN 1 AND 32),
    name        text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    active      boolean     NOT NULL DEFAULT true,
    version     integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fleet_vehicle_driver_assignments (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id  bigint      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    driver_id   bigint      NOT NULL REFERENCES fleet_drivers(id) ON DELETE RESTRICT,
    starts_at   timestamptz NOT NULL,
    ends_at     timestamptz,
    notes       text        CHECK (notes IS NULL OR char_length(notes) <= 500),
    version     integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fleet_assignment_period_valid CHECK (ends_at IS NULL OR ends_at > starts_at),
    CONSTRAINT fleet_assignment_vehicle_no_overlap EXCLUDE USING gist (
        vehicle_id WITH =,
        tstzrange(starts_at, COALESCE(ends_at, 'infinity'::timestamptz), '[)') WITH &&
    ),
    CONSTRAINT fleet_assignment_driver_no_overlap EXCLUDE USING gist (
        driver_id WITH =,
        tstzrange(starts_at, COALESCE(ends_at, 'infinity'::timestamptz), '[)') WITH &&
    )
);

CREATE TABLE IF NOT EXISTS fleet_reservations (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id      bigint      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    driver_id       bigint      REFERENCES fleet_drivers(id) ON DELETE RESTRICT,
    cost_center_id  bigint      REFERENCES fleet_cost_centers(id) ON DELETE RESTRICT,
    title           text        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
    purpose         text        CHECK (purpose IS NULL OR char_length(purpose) <= 500),
    starts_at       timestamptz NOT NULL,
    ends_at         timestamptz NOT NULL,
    status          text        NOT NULL DEFAULT 'requested'
                                    CHECK (status IN ('requested', 'confirmed', 'cancelled', 'completed')),
    version         integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fleet_reservation_period_valid CHECK (ends_at > starts_at),
    CONSTRAINT fleet_reservation_vehicle_no_overlap EXCLUDE USING gist (
        vehicle_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status IN ('requested', 'confirmed')),
    CONSTRAINT fleet_reservation_driver_no_overlap EXCLUDE USING gist (
        driver_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (driver_id IS NOT NULL AND status IN ('requested', 'confirmed'))
);

CREATE TABLE IF NOT EXISTS fleet_charging_policies (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id      bigint      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    target_soc_pct  smallint    NOT NULL CHECK (target_soc_pct BETWEEN 1 AND 100),
    max_power_w     double precision CHECK (max_power_w IS NULL OR max_power_w > 0),
    priority        smallint    NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000),
    effective_from  timestamptz NOT NULL,
    effective_to    timestamptz,
    enabled         boolean     NOT NULL DEFAULT true,
    version         integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fleet_charging_policy_period_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),
    CONSTRAINT fleet_charging_policy_priority_no_overlap EXCLUDE USING gist (
        vehicle_id WITH =,
        priority WITH =,
        tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
    ) WHERE (enabled)
);

CREATE TABLE IF NOT EXISTS fleet_charging_policy_windows (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    charging_policy_id  bigint      NOT NULL REFERENCES fleet_charging_policies(id) ON DELETE CASCADE,
    day_of_week         smallint    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_local_time    time        NOT NULL,
    end_local_time      time        NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fleet_charging_window_period_valid CHECK (end_local_time <> start_local_time),
    CONSTRAINT fleet_charging_window_unique
        UNIQUE (charging_policy_id, day_of_week, start_local_time, end_local_time)
);

CREATE TABLE IF NOT EXISTS fleet_maintenance_work_orders (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id              bigint      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    cost_center_id          bigint      REFERENCES fleet_cost_centers(id) ON DELETE RESTRICT,
    title                   text        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
    description             text        CHECK (description IS NULL OR char_length(description) <= 2000),
    status                  text        NOT NULL DEFAULT 'open'
                                        CHECK (status IN ('open', 'scheduled', 'in_progress', 'completed', 'cancelled')),
    severity                text        NOT NULL DEFAULT 'medium'
                                        CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    due_odometer_m          double precision CHECK (due_odometer_m IS NULL OR due_odometer_m >= 0),
    due_at                  timestamptz,
    scheduled_start_at      timestamptz,
    scheduled_end_at        timestamptz,
    cost_minor              bigint      CHECK (cost_minor IS NULL OR cost_minor >= 0),
    currency                text        CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
    version                 integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fleet_work_order_downtime_valid CHECK (
        scheduled_end_at IS NULL OR
        (scheduled_start_at IS NOT NULL AND scheduled_end_at > scheduled_start_at)
    ),
    CONSTRAINT fleet_work_order_cost_currency_consistent CHECK (
        (cost_minor IS NULL AND currency IS NULL) OR
        (cost_minor IS NOT NULL AND currency IS NOT NULL)
    )
);

DROP TRIGGER IF EXISTS fleet_drivers_set_updated_at ON fleet_drivers;
CREATE TRIGGER fleet_drivers_set_updated_at
    BEFORE UPDATE ON fleet_drivers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS fleet_cost_centers_set_updated_at ON fleet_cost_centers;
CREATE TRIGGER fleet_cost_centers_set_updated_at
    BEFORE UPDATE ON fleet_cost_centers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS fleet_assignments_set_updated_at ON fleet_vehicle_driver_assignments;
CREATE TRIGGER fleet_assignments_set_updated_at
    BEFORE UPDATE ON fleet_vehicle_driver_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS fleet_reservations_set_updated_at ON fleet_reservations;
CREATE TRIGGER fleet_reservations_set_updated_at
    BEFORE UPDATE ON fleet_reservations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS fleet_charging_policies_set_updated_at ON fleet_charging_policies;
CREATE TRIGGER fleet_charging_policies_set_updated_at
    BEFORE UPDATE ON fleet_charging_policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS fleet_charging_windows_set_updated_at ON fleet_charging_policy_windows;
CREATE TRIGGER fleet_charging_windows_set_updated_at
    BEFORE UPDATE ON fleet_charging_policy_windows FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS fleet_work_orders_set_updated_at ON fleet_maintenance_work_orders;
CREATE TRIGGER fleet_work_orders_set_updated_at
    BEFORE UPDATE ON fleet_maintenance_work_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS fleet_drivers_status_name_idx
    ON fleet_drivers (status, display_name, id);
CREATE INDEX IF NOT EXISTS fleet_cost_centers_active_name_idx
    ON fleet_cost_centers (active, name, id);
CREATE INDEX IF NOT EXISTS fleet_assignments_vehicle_period_idx
    ON fleet_vehicle_driver_assignments (vehicle_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS fleet_assignments_driver_period_idx
    ON fleet_vehicle_driver_assignments (driver_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS fleet_reservations_vehicle_period_idx
    ON fleet_reservations (vehicle_id, starts_at, ends_at)
    WHERE status IN ('requested', 'confirmed');
CREATE INDEX IF NOT EXISTS fleet_reservations_driver_period_idx
    ON fleet_reservations (driver_id, starts_at, ends_at)
    WHERE driver_id IS NOT NULL AND status IN ('requested', 'confirmed');
CREATE INDEX IF NOT EXISTS fleet_reservations_cost_center_idx
    ON fleet_reservations (cost_center_id, starts_at DESC)
    WHERE cost_center_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fleet_charging_policies_vehicle_effective_idx
    ON fleet_charging_policies (vehicle_id, enabled, effective_from, effective_to, priority);
CREATE INDEX IF NOT EXISTS fleet_charging_windows_policy_day_idx
    ON fleet_charging_policy_windows (charging_policy_id, day_of_week, start_local_time);
CREATE INDEX IF NOT EXISTS fleet_work_orders_vehicle_status_due_idx
    ON fleet_maintenance_work_orders (vehicle_id, status, due_at);
CREATE INDEX IF NOT EXISTS fleet_work_orders_cost_center_idx
    ON fleet_maintenance_work_orders (cost_center_id, status)
    WHERE cost_center_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fleet_work_orders_downtime_idx
    ON fleet_maintenance_work_orders (scheduled_start_at, scheduled_end_at)
    WHERE status IN ('scheduled', 'in_progress') AND scheduled_start_at IS NOT NULL;
