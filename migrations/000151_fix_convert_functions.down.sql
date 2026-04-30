-- Revert convert_* functions to old flat-column settings access (pre-key-value).
-- Restores the versions from migration 000046.

-- Distance: miles (DB) → km if user wants km
CREATE OR REPLACE FUNCTION convert_distance(val double precision, target text DEFAULT NULL)
RETURNS double precision LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT unit_of_length INTO target FROM settings WHERE id = 1;
  END IF;
  IF target = 'km' THEN RETURN val * 1.60934; END IF;
  RETURN val; -- already miles
END;
$$;

-- Speed: mph (DB) → km/h if user wants km
CREATE OR REPLACE FUNCTION convert_speed(val double precision, target text DEFAULT NULL)
RETURNS double precision LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT unit_of_length INTO target FROM settings WHERE id = 1;
  END IF;
  IF target = 'km' THEN RETURN val * 1.60934; END IF;
  RETURN val; -- already mph
END;
$$;

-- Temperature: °C (DB) → °F if user wants Fahrenheit
CREATE OR REPLACE FUNCTION convert_temp(val double precision, target text DEFAULT NULL)
RETURNS double precision LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT unit_of_temp INTO target FROM settings WHERE id = 1;
  END IF;
  IF target = 'F' THEN RETURN val * 9.0 / 5.0 + 32.0; END IF;
  RETURN val;
END;
$$;

-- Pressure: PSI (DB) → bar if user wants metric (note: original bug preserved — used unit_of_length)
CREATE OR REPLACE FUNCTION convert_pressure(val double precision, target text DEFAULT NULL)
RETURNS double precision LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT unit_of_length INTO target FROM settings WHERE id = 1;
  END IF;
  IF target = 'km' THEN RETURN val * 0.06895; END IF;
  RETURN val; -- already PSI
END;
$$;

-- Efficiency: Wh/mi (DB) → Wh/km if user wants km
CREATE OR REPLACE FUNCTION convert_efficiency(val double precision, target text DEFAULT NULL)
RETURNS double precision LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF target IS NULL THEN
    SELECT unit_of_length INTO target FROM settings WHERE id = 1;
  END IF;
  IF target = 'km' THEN RETURN val / 1.60934; END IF;
  RETURN val; -- already Wh/mi
END;
$$;
