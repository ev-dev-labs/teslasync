-- Fix convert_* SQL functions to use key-value settings table.
-- The settings table was migrated from flat columns (id=1, unit_of_length, ...)
-- to a key-value schema (key TEXT PK, value_text, ...) in 000142_baseline_typed.
-- All 5 functions still referenced the old schema, breaking Grafana dashboards.
-- Also changes IMMUTABLE → STABLE (these read from a table).
-- Also fixes convert_pressure to use 'unit_of_pressure' key (was using 'unit_of_length').

-- Distance: miles (DB) → km if user wants km
CREATE OR REPLACE FUNCTION convert_distance(val double precision, target text DEFAULT NULL)
RETURNS double precision LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT value_text INTO target FROM settings WHERE key = 'unit_of_length';
  END IF;
  IF target = 'km' THEN RETURN val * 1.60934; END IF;
  RETURN val; -- already miles
END;
$$;

-- Speed: mph (DB) → km/h if user wants km
CREATE OR REPLACE FUNCTION convert_speed(val double precision, target text DEFAULT NULL)
RETURNS double precision LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT value_text INTO target FROM settings WHERE key = 'unit_of_length';
  END IF;
  IF target = 'km' THEN RETURN val * 1.60934; END IF;
  RETURN val; -- already mph
END;
$$;

-- Temperature: °C (DB) → °F if user wants Fahrenheit
CREATE OR REPLACE FUNCTION convert_temp(val double precision, target text DEFAULT NULL)
RETURNS double precision LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT value_text INTO target FROM settings WHERE key = 'unit_of_temp';
  END IF;
  IF target = 'F' THEN RETURN val * 9.0 / 5.0 + 32.0; END IF;
  RETURN val; -- already °C
END;
$$;

-- Pressure: PSI (DB) → bar if user wants metric
CREATE OR REPLACE FUNCTION convert_pressure(val double precision, target text DEFAULT NULL)
RETURNS double precision LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT value_text INTO target FROM settings WHERE key = 'unit_of_pressure';
  END IF;
  IF target = 'bar' THEN RETURN val * 0.06895; END IF;
  RETURN val; -- already PSI
END;
$$;

-- Efficiency: Wh/mi (DB) → Wh/km if user wants km
CREATE OR REPLACE FUNCTION convert_efficiency(val double precision, target text DEFAULT NULL)
RETURNS double precision LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT value_text INTO target FROM settings WHERE key = 'unit_of_length';
  END IF;
  IF target = 'km' THEN RETURN val / 1.60934; END IF;
  RETURN val; -- already Wh/mi
END;
$$;
