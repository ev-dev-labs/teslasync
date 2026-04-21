-- Migration 18: Unit conversion SQL functions
-- Provides consistent unit conversion for Grafana dashboards and any direct SQL queries.
-- All base data is stored in metric (km, °C, bar, Wh/km). These functions convert
-- to the user's preferred units by reading from the settings table or accepting
-- a target unit parameter.

-- Distance: km → mi
CREATE OR REPLACE FUNCTION convert_distance(val DOUBLE PRECISION, target TEXT DEFAULT NULL)
RETURNS DOUBLE PRECISION LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT unit_of_length INTO target FROM settings WHERE id = 1;
  END IF;
  IF target = 'mi' THEN
    RETURN val * 0.621371;
  END IF;
  RETURN val;
END;
$$;

-- Speed: km/h → mph
CREATE OR REPLACE FUNCTION convert_speed(val DOUBLE PRECISION, target TEXT DEFAULT NULL)
RETURNS DOUBLE PRECISION LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT unit_of_length INTO target FROM settings WHERE id = 1;
  END IF;
  IF target = 'mi' THEN
    RETURN val * 0.621371;
  END IF;
  RETURN val;
END;
$$;

-- Temperature: °C → °F
CREATE OR REPLACE FUNCTION convert_temp(val DOUBLE PRECISION, target TEXT DEFAULT NULL)
RETURNS DOUBLE PRECISION LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT unit_of_temp INTO target FROM settings WHERE id = 1;
  END IF;
  IF target = 'F' THEN
    RETURN val * 9.0 / 5.0 + 32.0;
  END IF;
  RETURN val;
END;
$$;

-- Efficiency: Wh/km → Wh/mi
CREATE OR REPLACE FUNCTION convert_efficiency(val DOUBLE PRECISION, target TEXT DEFAULT NULL)
RETURNS DOUBLE PRECISION LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT unit_of_length INTO target FROM settings WHERE id = 1;
  END IF;
  IF target = 'mi' THEN
    RETURN val * 1.60934;
  END IF;
  RETURN val;
END;
$$;

-- Pressure: bar → psi
CREATE OR REPLACE FUNCTION convert_pressure(val DOUBLE PRECISION, target TEXT DEFAULT NULL)
RETURNS DOUBLE PRECISION LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT unit_of_length INTO target FROM settings WHERE id = 1;
  END IF;
  IF target = 'mi' THEN
    RETURN val * 14.5038;
  END IF;
  RETURN val;
END;
$$;

-- Helper: returns the user's preferred distance unit label
CREATE OR REPLACE FUNCTION unit_distance()
RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT CASE unit_of_length WHEN 'mi' THEN 'mi' ELSE 'km' END FROM settings WHERE id = 1;
$$;

-- Helper: returns the user's preferred speed unit label
CREATE OR REPLACE FUNCTION unit_speed()
RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT CASE unit_of_length WHEN 'mi' THEN 'mph' ELSE 'km/h' END FROM settings WHERE id = 1;
$$;

-- Helper: returns the user's preferred temperature unit label
CREATE OR REPLACE FUNCTION unit_temp()
RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT CASE unit_of_temp WHEN 'F' THEN '°F' ELSE '°C' END FROM settings WHERE id = 1;
$$;

-- Helper: returns the user's preferred efficiency unit label
CREATE OR REPLACE FUNCTION unit_efficiency()
RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT CASE unit_of_length WHEN 'mi' THEN 'Wh/mi' ELSE 'Wh/km' END FROM settings WHERE id = 1;
$$;

-- Helper: returns the user's preferred pressure unit label
CREATE OR REPLACE FUNCTION unit_pressure()
RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT CASE unit_of_length WHEN 'mi' THEN 'psi' ELSE 'bar' END FROM settings WHERE id = 1;
$$;
