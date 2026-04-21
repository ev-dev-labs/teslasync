-- Update unit conversion functions for raw-unit storage.
-- DB now stores Tesla's native units: miles, mph, °C, PSI.
-- Functions convert FROM raw units TO user's preferred display unit.

-- Distance: miles (DB) → km if user wants km
CREATE OR REPLACE FUNCTION convert_distance(val DOUBLE PRECISION, target TEXT DEFAULT NULL)
RETURNS DOUBLE PRECISION LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT unit_of_length INTO target FROM settings WHERE id = 1;
  END IF;
  IF target = 'km' THEN
    RETURN val * 1.60934;
  END IF;
  RETURN val; -- already miles
END;
$$;

-- Speed: mph (DB) → km/h if user wants km
CREATE OR REPLACE FUNCTION convert_speed(val DOUBLE PRECISION, target TEXT DEFAULT NULL)
RETURNS DOUBLE PRECISION LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT unit_of_length INTO target FROM settings WHERE id = 1;
  END IF;
  IF target = 'km' THEN
    RETURN val * 1.60934;
  END IF;
  RETURN val; -- already mph
END;
$$;

-- Temperature: °C (DB) → °F if user wants Fahrenheit (unchanged — DB was always °C)
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

-- Efficiency: Wh/mi (DB) → Wh/km if user wants km
CREATE OR REPLACE FUNCTION convert_efficiency(val DOUBLE PRECISION, target TEXT DEFAULT NULL)
RETURNS DOUBLE PRECISION LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT unit_of_length INTO target FROM settings WHERE id = 1;
  END IF;
  IF target = 'km' THEN
    RETURN val / 1.60934;
  END IF;
  RETURN val; -- already Wh/mi
END;
$$;

-- Pressure: PSI (DB) → bar if user wants metric
CREATE OR REPLACE FUNCTION convert_pressure(val DOUBLE PRECISION, target TEXT DEFAULT NULL)
RETURNS DOUBLE PRECISION LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT unit_of_length INTO target FROM settings WHERE id = 1;
  END IF;
  IF target = 'km' THEN
    RETURN val * 0.06895; -- PSI → bar
  END IF;
  RETURN val; -- already PSI
END;
$$;
