-- Compatibility VIEW for security_events after JSONB consolidation.
--
-- Migrations 000142–000144 moved 22 nullable columns into a `signals` JSONB
-- column on security_events and then dropped them. This view flattens
-- `signals` back to individual column names so that external consumers
-- (Grafana security dashboards, ad-hoc BI queries, `psql` exploration)
-- keep working without modification. Internal Go code reads the `signals`
-- column directly via hydrateFromSignals and does not depend on this view.
--
-- The native core columns (locked, sentry_mode, door_state,
-- driver_seat_occupied) are passed through unchanged; all remaining
-- security/access signals are extracted from `signals` with the same
-- SQL types they had before the migration.

CREATE OR REPLACE VIEW v_security_events AS
SELECT
    id,
    vehicle_id,
    -- Core columns (native)
    locked,
    sentry_mode,
    door_state,
    driver_seat_occupied,
    -- Signals extracted back to column names
    signals->>'fd_window'                                    AS fd_window,
    signals->>'fp_window'                                    AS fp_window,
    signals->>'rd_window'                                    AS rd_window,
    signals->>'rp_window'                                    AS rp_window,
    (signals->>'homelink_nearby')::boolean                   AS homelink_nearby,
    (signals->>'guest_mode')::boolean                        AS guest_mode,
    (signals->>'homelink_device_count')::int                 AS homelink_device_count,
    signals->>'guest_mode_mobile_access_state'               AS guest_mode_mobile_access_state,
    signals->>'center_display'                               AS center_display,
    signals->>'speed_limit_mode'                             AS speed_limit_mode,
    (signals->>'valet_mode_enabled')::boolean                AS valet_mode_enabled,
    (signals->>'service_mode')::boolean                      AS service_mode,
    (signals->>'current_limit_mph')::double precision        AS current_limit_mph,
    (signals->>'paired_phone_key_count')::int                AS paired_phone_key_count,
    (signals->>'lights_hazards_active')::boolean             AS lights_hazards_active,
    (signals->>'lights_high_beams')::boolean                 AS lights_high_beams,
    signals->>'lights_turn_signal'                           AS lights_turn_signal,
    signals->>'tonneau_position'                             AS tonneau_position,
    (signals->>'tonneau_open_percent')::double precision     AS tonneau_open_percent,
    signals->>'tonneau_tent_mode'                            AS tonneau_tent_mode,
    (signals->>'driver_seat_belt')::boolean                  AS driver_seat_belt,
    (signals->>'passenger_seat_belt')::boolean               AS passenger_seat_belt,
    signals,
    created_at
FROM security_events;

COMMENT ON VIEW v_security_events IS
    'Compatibility view flattening security_events.signals JSONB back to named '
    'columns. For use by Grafana and ad-hoc SQL; Go code reads the signals column '
    'directly. See migrations 000142-000144 for the column->JSONB migration.';
