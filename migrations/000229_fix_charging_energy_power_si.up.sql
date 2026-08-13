-- Repair Tesla Fleet Telemetry charging values that were persisted with
-- their fixed wire units (kWh/kW) in SI-canonical Wh/W columns.
--
-- The normalize pipeline now scales AC/DCChargingEnergyIn and
-- AC/DCChargingPower by 1000 before routing. This migration performs the
-- equivalent one-time correction for rows written before that fix, restores
-- missing power history in signal_log, rebuilds session peak/average power,
-- and recalculates only rate-derived costs. Manual, Tesla-actual, and unknown
-- provenance costs remain untouched.

-- Attribute old hot-table rows before aggregating them into session metrics.
UPDATE charging_telemetry AS telemetry
   SET session_id = session.id
  FROM charging_sessions AS session
 WHERE telemetry.session_id IS NULL
   AND session.ended_at IS NOT NULL
   AND telemetry.vehicle_id = session.vehicle_id
   AND telemetry.ts >= session.started_at
   AND telemetry.ts <= session.ended_at;

-- Hot telemetry columns were named Wh/W but held Tesla's kWh/kW values.
UPDATE charging_telemetry
   SET ac_charging_energy_in_wh =
           CASE WHEN ac_charging_energy_in_wh IS NULL
                THEN NULL ELSE ac_charging_energy_in_wh * 1000.0 END,
       dc_charging_energy_in_wh =
           CASE WHEN dc_charging_energy_in_wh IS NULL
                THEN NULL ELSE dc_charging_energy_in_wh * 1000.0 END,
       ac_charging_power_w =
           CASE WHEN ac_charging_power_w IS NULL
                THEN NULL ELSE ac_charging_power_w * 1000.0 END,
       dc_charging_power_w =
           CASE WHEN dc_charging_power_w IS NULL
                THEN NULL ELSE dc_charging_power_w * 1000.0 END
 WHERE ac_charging_energy_in_wh IS NOT NULL
    OR dc_charging_energy_in_wh IS NOT NULL
    OR ac_charging_power_w IS NOT NULL
    OR dc_charging_power_w IS NOT NULL;

-- Energy was already dual-written to signal_log; power may exist there on a
-- database that briefly ran an intermediate route. Correct either case.
UPDATE signal_log
   SET float_value = float_value * 1000.0
 WHERE field IN (
           'ACChargingEnergyIn',
           'DCChargingEnergyIn',
           'ACChargingPower',
           'DCChargingPower'
       )
   AND float_value IS NOT NULL;

-- Power was not historically dual-written. Backfill it from the corrected
-- hot table so charge charts and completion aggregates have a durable source.
INSERT INTO signal_log (
    vehicle_id,
    ts,
    field,
    value_kind,
    float_value
)
SELECT vehicle_id, ts, 'ACChargingPower', 5, ac_charging_power_w
  FROM charging_telemetry
 WHERE ac_charging_power_w IS NOT NULL
ON CONFLICT (vehicle_id, ts, field) DO NOTHING;

INSERT INTO signal_log (
    vehicle_id,
    ts,
    field,
    value_kind,
    float_value
)
SELECT vehicle_id, ts, 'DCChargingPower', 5, dc_charging_power_w
  FROM charging_telemetry
 WHERE dc_charging_power_w IS NOT NULL
ON CONFLICT (vehicle_id, ts, field) DO NOTHING;

-- Direct Fleet Telemetry totals were stored as kWh. Battery-delta fallback
-- estimates start at 750 Wh, so the <500 guard distinguishes the malformed
-- direct totals while the telemetry existence check excludes imports and the
-- API-polling path, which already wrote Wh correctly.
UPDATE charging_sessions AS session
   SET total_energy_added_wh = session.total_energy_added_wh * 1000.0
 WHERE session.total_energy_added_wh > 0
   AND session.total_energy_added_wh < 500.0
   AND EXISTS (
       SELECT 1
         FROM charging_telemetry AS telemetry
        WHERE telemetry.session_id = session.id
   );

-- Rebuild peak/average power from corrected W telemetry. DC takes precedence
-- when a session contains DC samples, matching SignalLogReader semantics.
WITH power_rollup AS (
    SELECT
        session_id,
        CASE
            WHEN COUNT(dc_charging_power_w)
                 FILTER (WHERE dc_charging_power_w > 0) > 0
                THEN MAX(dc_charging_power_w)
                     FILTER (WHERE dc_charging_power_w > 0)
            ELSE MAX(ac_charging_power_w)
                 FILTER (WHERE ac_charging_power_w > 0)
        END AS peak_power_w,
        CASE
            WHEN COUNT(dc_charging_power_w)
                 FILTER (WHERE dc_charging_power_w > 0) > 0
                THEN AVG(dc_charging_power_w)
                     FILTER (WHERE dc_charging_power_w > 0)
            ELSE AVG(ac_charging_power_w)
                 FILTER (WHERE ac_charging_power_w > 0)
        END AS avg_power_w
      FROM charging_telemetry
     WHERE session_id IS NOT NULL
     GROUP BY session_id
)
UPDATE charging_sessions AS session
   SET peak_power_w = rollup.peak_power_w,
       avg_power_w = rollup.avg_power_w
  FROM power_rollup AS rollup
 WHERE session.id = rollup.session_id
   AND rollup.peak_power_w IS NOT NULL;

-- Tariff/default estimates are deterministic derivatives of energy and may be
-- safely recomputed. Protected actual/manual/unknown costs are never changed.
UPDATE charging_sessions AS session
   SET cost_decimal = ROUND(
           session.total_energy_added_wh::numeric * rate.rate_per_wh,
           6
       ),
       cost_currency = rate.currency
  FROM geofence_rates AS rate
 WHERE session.rate_id = rate.id
   AND session.cost_source IN ('geofence_tariff', 'default_estimate')
   AND session.total_energy_added_wh IS NOT NULL;

-- These regular materialized views cache charging_sessions values.
REFRESH MATERIALIZED VIEW cagg_charging_summary;
REFRESH MATERIALIZED VIEW mv_energy_daily;
