-- Reverse historical unit conversions.
-- Odometer was NEVER converted (stored raw in miles) — DO NOT touch odometer columns.
-- Speed was converted mph→km/h — reverse to mph.
-- Ranges were converted miles→km — reverse to miles.
-- IMPORTANT: Take a full backup before running this migration.

-- Positions: speed (km/h→mph), ranges (km→miles). Odometer already miles.
UPDATE positions SET
    speed = speed / 1.60934,
    ideal_range = ideal_range / 1.60934,
    rated_range = rated_range / 1.60934
WHERE (speed > 0 OR ideal_range > 0 OR rated_range > 0);

-- Drives: speed (km/h→mph), ranges (km→miles). Distance/odometer already miles.
UPDATE drives SET
    start_range_km = start_range_km / 1.60934,
    end_range_km = end_range_km / 1.60934,
    speed_max = speed_max / 1.60934,
    speed_avg = speed_avg / 1.60934,
    speed_min = speed_min / 1.60934,
    start_rated_range_km = start_rated_range_km / 1.60934,
    end_rated_range_km = end_rated_range_km / 1.60934,
    rated_range_avg = rated_range_avg / 1.60934,
    rated_range_max = rated_range_max / 1.60934,
    rated_range_min = rated_range_min / 1.60934,
    start_ideal_range_km = start_ideal_range_km / 1.60934,
    end_ideal_range_km = end_ideal_range_km / 1.60934,
    ideal_range_avg = ideal_range_avg / 1.60934,
    ideal_range_max = ideal_range_max / 1.60934,
    ideal_range_min = ideal_range_min / 1.60934,
    start_est_range_km = start_est_range_km / 1.60934,
    end_est_range_km = end_est_range_km / 1.60934,
    est_range_avg = est_range_avg / 1.60934,
    est_range_max = est_range_max / 1.60934,
    est_range_min = est_range_min / 1.60934
WHERE distance > 0 OR start_range_km IS NOT NULL;

-- Charging sessions: ranges (km→miles). Already stored raw otherwise.
UPDATE charging_sessions SET
    start_range_km = start_range_km / 1.60934,
    end_range_km = end_range_km / 1.60934
WHERE start_range_km IS NOT NULL OR end_range_km IS NOT NULL;

-- Daily mileage: odometer and distance already in miles — DO NOT touch.

-- Motor snapshots: speed (km/h→mph)
UPDATE motor_snapshots SET
    vehicle_speed = vehicle_speed / 1.60934,
    cruise_set_speed = cruise_set_speed / 1.60934
WHERE vehicle_speed IS NOT NULL;

-- Charging telemetry: ranges (km→miles), charge rate (km/h→mph)
UPDATE charging_telemetry SET
    est_battery_range = est_battery_range / 1.60934,
    ideal_battery_range = ideal_battery_range / 1.60934,
    rated_range = rated_range / 1.60934,
    charge_rate_mph = charge_rate_mph / 1.60934
WHERE est_battery_range IS NOT NULL;

-- Drive telemetry readings: speed (km/h→mph), ranges (km→miles). Odometer already miles.
UPDATE drive_telemetry_readings SET
    speed = speed / 1.60934,
    rated_range = rated_range / 1.60934,
    ideal_range = ideal_range / 1.60934,
    est_range = est_range / 1.60934
WHERE speed IS NOT NULL;

-- Charge telemetry readings: ranges (km→miles), charge rate (km/h→mph)
UPDATE charge_telemetry_readings SET
    rated_range = rated_range / 1.60934,
    ideal_range = ideal_range / 1.60934,
    est_range = est_range / 1.60934,
    charge_rate = charge_rate / 1.60934
WHERE rated_range IS NOT NULL;

-- Location snapshots: miles_to_arrival was converted to km — reverse.
UPDATE location_snapshots SET
    miles_to_arrival = miles_to_arrival / 1.60934
WHERE miles_to_arrival IS NOT NULL;

-- Safety snapshots: miles fields were converted to km — reverse.
UPDATE safety_snapshots SET
    miles_since_reset = miles_since_reset / 1.60934,
    self_driving_miles_since_reset = self_driving_miles_since_reset / 1.60934
WHERE miles_since_reset IS NOT NULL;

-- Vehicle live state: speed (km/h→mph), ranges (km→miles). Odometer already miles.
UPDATE vehicle_live_state SET
    speed = speed / 1.60934,
    ideal_range = ideal_range / 1.60934,
    rated_range = rated_range / 1.60934,
    est_range = est_range / 1.60934,
    cruise_set_speed = cruise_set_speed / 1.60934,
    current_limit_mph = current_limit_mph / 1.60934
WHERE speed IS NOT NULL;
