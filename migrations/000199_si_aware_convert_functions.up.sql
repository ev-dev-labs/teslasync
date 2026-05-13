-- Add SI-aware variants of the unit-conversion helper functions.
--
-- Background: Phase-42 (migration 000185) made signal_log store everything in
-- canonical SI base units:
--   * TpmsPressure*   -> Pa
--   * VehicleSpeed    -> m/s
--   * Odometer / *Range -> meters
--   * Temp fields     -> degrees C (unchanged)
--
-- The pre-Phase-42 convert_* functions (introduced in 000018, fixed in 000151)
-- were written when the DB stored user-friendly units (PSI, mph, mi). They
-- still assume that. As a result, dashboards that pass RAW signal_log values
-- (e.g. Tire Pressure shows 312500 instead of 45 PSI) silently display the
-- canonical SI value labeled with the user's preferred unit.
--
-- Rather than edit the existing functions (and break the many dashboards that
-- pre-convert in SQL with `distance_m / 1609.344` etc.), we add SI-aware
-- variants with the input unit suffixed in the name. Dashboards that pass raw
-- signal_log values can opt in by switching the function name. Dashboards
-- that already pre-convert keep working unchanged.
--
-- Conventions mirrored from convert_distance / convert_speed / convert_pressure:
--   * STABLE (read settings table)
--   * target text default NULL -> falls back to settings key
--   * target string matching: case-sensitive 'km' / 'bar' / 'kpa' etc.,
--     anything else returns the user-friendly default (mi / psi / mph).
--   * No STRICT modifier: NULL input passes through to the IF/RETURN logic
--     and yields NULL naturally via arithmetic.

-- Pressure: Pa (canonical SI in signal_log) -> PSI / kPa / bar
CREATE OR REPLACE FUNCTION convert_pressure_pa(val_pa double precision, target text DEFAULT NULL)
RETURNS double precision LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT value_text INTO target FROM settings WHERE key = 'unit_of_pressure';
  END IF;
  IF target = 'kpa' OR target = 'kPa' THEN RETURN val_pa / 1000.0; END IF;
  IF target = 'bar' THEN RETURN val_pa / 100000.0; END IF;
  RETURN val_pa / 6894.757293168; -- default: PSI
END;
$$;

-- Distance / Range: meters (canonical SI in signal_log) -> miles / km
CREATE OR REPLACE FUNCTION convert_distance_m(val_m double precision, target text DEFAULT NULL)
RETURNS double precision LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT value_text INTO target FROM settings WHERE key = 'unit_of_length';
  END IF;
  IF target = 'km' THEN RETURN val_m / 1000.0; END IF;
  RETURN val_m / 1609.344; -- default: miles
END;
$$;

-- Speed: m/s (canonical SI in signal_log) -> mph / km/h
-- Mirrors convert_speed in reading 'unit_of_length' (no separate speed key today).
CREATE OR REPLACE FUNCTION convert_speed_mps(val_mps double precision, target text DEFAULT NULL)
RETURNS double precision LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT value_text INTO target FROM settings WHERE key = 'unit_of_length';
  END IF;
  IF target = 'km' THEN RETURN val_mps * 3.6; END IF;
  RETURN val_mps * 2.2369362920544; -- default: mph
END;
$$;
