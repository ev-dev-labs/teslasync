-- TeslaSync baseline schema — squashed replacement for migrations 000001-000141
-- Generated from pg_dump of production PostgreSQL 17 schema.
-- For fresh installs only. Existing installs (via pg_restore) already have schema_migrations populated.

-- Optional extensions: install if available on the host.
-- timescaledb is used in production (via pg_restore target); vector is used for ML features.
-- Fresh installs on plain Postgres (dev/CI) skip these gracefully.
DO $ext$ BEGIN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'timescaledb extension not available, skipping: %', SQLERRM;
END $ext$;

DO $ext$ BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'vector extension not available, skipping: %', SQLERRM;
END $ext$;

-- Defer function body validation so functions can reference tables/relations
-- that are created later in this script (matches pg_dump default behaviour).
SET check_function_bodies = false;

--
--


--
-- Name: convert_distance(double precision, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convert_distance(val double precision, target text DEFAULT NULL::text) RETURNS double precision
    LANGUAGE plpgsql IMMUTABLE
    AS $$
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


--
-- Name: convert_efficiency(double precision, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convert_efficiency(val double precision, target text DEFAULT NULL::text) RETURNS double precision
    LANGUAGE plpgsql IMMUTABLE
    AS $$
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


--
-- Name: convert_pressure(double precision, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convert_pressure(val double precision, target text DEFAULT NULL::text) RETURNS double precision
    LANGUAGE plpgsql IMMUTABLE
    AS $$
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


--
-- Name: convert_speed(double precision, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convert_speed(val double precision, target text DEFAULT NULL::text) RETURNS double precision
    LANGUAGE plpgsql IMMUTABLE
    AS $$
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


--
-- Name: convert_temp(double precision, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convert_temp(val double precision, target text DEFAULT NULL::text) RETURNS double precision
    LANGUAGE plpgsql IMMUTABLE
    AS $$
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


--
-- Name: create_monthly_partition(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_monthly_partition(parent_table text, partition_date date DEFAULT CURRENT_DATE) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    partition_name TEXT;
    start_date DATE;
    end_date DATE;
    default_name TEXT;
BEGIN
    start_date := date_trunc('month', partition_date);
    end_date := start_date + INTERVAL '1 month';
    partition_name := parent_table || '_' || to_char(start_date, 'YYYY_MM');
    default_name := parent_table || '_default';
    
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = partition_name) THEN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = default_name) THEN
            EXECUTE format('ALTER TABLE %I DETACH PARTITION %I', parent_table, default_name);
        END IF;
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
            partition_name, parent_table, start_date, end_date
        );
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = default_name) THEN
            EXECUTE format('ALTER TABLE %I ATTACH PARTITION %I DEFAULT', parent_table, default_name);
        END IF;
    END IF;
END;
$$;


--
-- Name: fn_anomaly_count_by_type(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_anomaly_count_by_type(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(category text, count bigint)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT a.type::text, COUNT(*)::bigint
  FROM alerts a
  WHERE a.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR a.created_at >= p_from)
    AND (p_to IS NULL OR a.created_at <= p_to)
  GROUP BY a.type
  ORDER BY COUNT(*) DESC;
END;
$$;


--
-- Name: fn_anomaly_recent(bigint, timestamp with time zone, timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_anomaly_recent(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50) RETURNS TABLE("time" timestamp with time zone, signal text, type text, severity text, z_score numeric, description text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT a.created_at, a.title::text, a.type::text, a.severity::text,
    NULL::numeric, a.message::text
  FROM alerts a
  WHERE a.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR a.created_at >= p_from)
    AND (p_to IS NULL OR a.created_at <= p_to)
  ORDER BY a.created_at DESC LIMIT p_limit;
END;
$$;


--
-- Name: fn_anomaly_severity_distribution(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_anomaly_severity_distribution(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(severity text, count bigint)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT a.severity::text, COUNT(*)::bigint
  FROM alerts a
  WHERE a.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR a.created_at >= p_from)
    AND (p_to IS NULL OR a.created_at <= p_to)
  GROUP BY a.severity
  ORDER BY CASE a.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 ELSE 4 END;
END;
$$;


--
-- Name: fn_anomaly_timeline(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_anomaly_timeline(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("time" timestamp with time zone, severity text, signal text, type text, z_score double precision)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT a.created_at, a.severity::text, a.title::text, a.type::text, NULL::double precision
  FROM alerts a
  WHERE a.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR a.created_at >= p_from)
    AND (p_to IS NULL OR a.created_at <= p_to)
  ORDER BY a.created_at;
END;
$$;


--
-- Name: fn_battery_capacity_over_time(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_battery_capacity_over_time(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("time" timestamp with time zone, estimated_capacity numeric, original_capacity numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT bs.created_at,
    bs.capacity_kwh::numeric,
    (bs.capacity_kwh / NULLIF(bs.health_score / 100.0, 0))::numeric
  FROM battery_snapshots bs
  WHERE bs.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR bs.created_at >= p_from)
    AND (p_to IS NULL OR bs.created_at <= p_to)
  ORDER BY bs.created_at;
END;
$$;


--
-- Name: fn_battery_cell_balance(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_battery_cell_balance(p_vehicle_id bigint) RETURNS TABLE(voltage_delta numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT ROUND((COALESCE(vls.brick_voltage_max, 0) - COALESCE(vls.brick_voltage_min, 0))::numeric, 4)
  FROM vehicle_live_state vls
  WHERE vls.vehicle_id = p_vehicle_id;
END;
$$;


--
-- Name: fn_battery_cell_readings(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_battery_cell_readings(p_vehicle_id bigint) RETURNS TABLE(cell_id integer, voltage numeric, temp numeric, v_deviation numeric, t_deviation numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  -- No battery_cells table; return empty result set
  RETURN QUERY
  SELECT NULL::integer, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric
  WHERE false;
END;
$$;


--
-- Name: fn_battery_cell_temp_heatmap(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_battery_cell_temp_heatmap(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("time" timestamp with time zone, cell_id integer, temp double precision)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  -- No battery_cells table; return empty result set
  RETURN QUERY
  SELECT NULL::timestamptz, NULL::integer, NULL::double precision
  WHERE false;
END;
$$;


--
-- Name: fn_battery_charge_cycles(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_battery_charge_cycles(p_vehicle_id bigint) RETURNS TABLE(cycles numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT ROUND((SUM(cs.charge_energy_added) / NULLIF(
    (SELECT bs.capacity_kwh FROM battery_snapshots bs
     WHERE bs.vehicle_id = p_vehicle_id ORDER BY bs.created_at DESC LIMIT 1), 0
  ))::numeric)
  FROM charging_sessions cs
  WHERE cs.vehicle_id = p_vehicle_id;
END;
$$;


--
-- Name: fn_battery_degradation_rate(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_battery_degradation_rate(p_vehicle_id bigint) RETURNS TABLE(degradation_pct_yr numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT ROUND((
    (MAX(bs.health_score) - MIN(bs.health_score)) /
    NULLIF(EXTRACT(EPOCH FROM MAX(bs.created_at) - MIN(bs.created_at)) / (365.25 * 86400), 0)
  )::numeric, 2)
  FROM battery_snapshots bs
  WHERE bs.vehicle_id = p_vehicle_id AND bs.health_score IS NOT NULL;
END;
$$;


--
-- Name: fn_battery_risk_factors(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_battery_risk_factors(p_vehicle_id bigint) RETURNS TABLE(metric text, value numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT 'Fast Charge %'::text,
    ROUND(100.0 * COUNT(*) FILTER (WHERE cs.charger_power > 50) / NULLIF(COUNT(*), 0))
  FROM charging_sessions cs WHERE cs.vehicle_id = p_vehicle_id
  UNION ALL
  SELECT 'High SoC Charges',
    ROUND(100.0 * COUNT(*) FILTER (WHERE cs.end_battery_level > 90) / NULLIF(COUNT(*), 0))
  FROM charging_sessions cs WHERE cs.vehicle_id = p_vehicle_id;
END;
$$;


--
-- Name: fn_battery_soh_trend(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_battery_soh_trend(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("time" timestamp with time zone, soh_pct double precision)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT bs.created_at, bs.health_score
  FROM battery_snapshots bs
  WHERE bs.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR bs.created_at >= p_from)
    AND (p_to IS NULL OR bs.created_at <= p_to)
  ORDER BY bs.created_at;
END;
$$;


--
-- Name: fn_charging_calendar_heatmap(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_charging_calendar_heatmap(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("time" timestamp with time zone, sessions bigint)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT DATE_TRUNC('day', cs.start_date), COUNT(*)::bigint
  FROM charging_sessions cs
  WHERE cs.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR cs.start_date >= p_from)
    AND (p_to IS NULL OR cs.start_date <= p_to)
  GROUP BY DATE_TRUNC('day', cs.start_date)
  ORDER BY 1;
END;
$$;


--
-- Name: fn_charging_hourly_distribution(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_charging_hourly_distribution(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(hour integer, sessions bigint)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT EXTRACT(HOUR FROM cs.start_date)::integer, COUNT(*)::bigint
  FROM charging_sessions cs
  WHERE cs.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR cs.start_date >= p_from)
    AND (p_to IS NULL OR cs.start_date <= p_to)
  GROUP BY EXTRACT(HOUR FROM cs.start_date)
  ORDER BY 1;
END;
$$;


--
-- Name: fn_charging_power_timeline(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_charging_power_timeline(p_session_id bigint) RETURNS TABLE("time" timestamp with time zone, power_kw double precision, soc double precision)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT ct.created_at, ct.power_kw, ct.battery_level::double precision
  FROM charge_telemetry_readings ct
  WHERE ct.session_id = p_session_id
  ORDER BY ct.created_at;
END;
$$;


--
-- Name: fn_charging_rate_vs_soc(bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_charging_rate_vs_soc(p_vehicle_id bigint, p_limit integer DEFAULT 5) RETURNS TABLE(soc double precision, power_kw double precision, session_id bigint)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT ct.battery_level::double precision, ct.power_kw, ct.session_id
  FROM charge_telemetry_readings ct
  WHERE ct.session_id IN (
    SELECT cs.id FROM charging_sessions cs
    WHERE cs.vehicle_id = p_vehicle_id
    ORDER BY cs.start_date DESC LIMIT p_limit
  )
  ORDER BY ct.battery_level;
END;
$$;


--
-- Name: fn_charging_temperature(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_charging_temperature(p_session_id bigint) RETURNS TABLE("time" timestamp with time zone, battery_temp double precision, outside_temp double precision)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT ct.created_at, ct.battery_temp, ct.outside_temp
  FROM charge_telemetry_readings ct
  WHERE ct.session_id = p_session_id
  ORDER BY ct.created_at;
END;
$$;


--
-- Name: fn_charging_weekday_distribution(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_charging_weekday_distribution(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(day text, day_num double precision, sessions bigint, energy_kwh numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    TO_CHAR(cs.start_date, 'Dy')::text,
    EXTRACT(ISODOW FROM cs.start_date)::double precision,
    COUNT(*)::bigint,
    ROUND(SUM(COALESCE(cs.charge_energy_added, 0))::numeric, 1)
  FROM charging_sessions cs
  WHERE cs.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR cs.start_date >= p_from)
    AND (p_to IS NULL OR cs.start_date <= p_to)
  GROUP BY TO_CHAR(cs.start_date, 'Dy'), EXTRACT(ISODOW FROM cs.start_date)
  ORDER BY EXTRACT(ISODOW FROM cs.start_date);
END;
$$;


--
-- Name: fn_compare_periods(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_compare_periods(p_vehicle_id bigint, p_from timestamp with time zone, p_to timestamp with time zone) RETURNS TABLE(period text, distance numeric, drives bigint, energy numeric)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_duration INTERVAL;
BEGIN
  v_duration := p_to - p_from;
  RETURN QUERY
  SELECT 'Current'::text,
    COALESCE(SUM(d.distance), 0)::numeric, COUNT(*)::bigint,
    COALESCE(SUM(COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)), 0)::numeric
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id AND d.start_date BETWEEN p_from AND p_to
  UNION ALL
  SELECT 'Prior'::text,
    COALESCE(SUM(d.distance), 0)::numeric, COUNT(*)::bigint,
    COALESCE(SUM(COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)), 0)::numeric
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id AND d.start_date BETWEEN (p_from - v_duration) AND p_from;
END;
$$;


--
-- Name: fn_drive_score_breakdown(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_drive_score_breakdown(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(category text, score numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT 'Efficiency'::text,
    ROUND(AVG(
      CASE WHEN d.distance > 0
        AND (COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) > 0
        THEN LEAST(100.0, 100.0 * d.distance / (d.start_rated_range_km - d.end_rated_range_km))
        ELSE NULL END
    )::numeric, 0)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  UNION ALL
  SELECT 'Smoothness'::text,
    ROUND(AVG(
      CASE WHEN d.speed_max > 0 AND d.speed_avg > 0
        THEN LEAST(100.0, 100.0 * d.speed_avg / d.speed_max)
        ELSE NULL END
    )::numeric, 0)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  UNION ALL
  SELECT 'Speed'::text,
    ROUND(AVG(
      CASE WHEN d.duration_min > 0 AND d.distance > 0
        THEN LEAST(100.0, (d.distance / d.duration_min * 60.0) / 1.2)
        ELSE NULL END
    )::numeric, 0)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to);
END;
$$;


--
-- Name: fn_drive_score_distribution(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_drive_score_distribution(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(score integer)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT LEAST(100, ROUND(100.0 * d.distance
    / (d.start_rated_range_km - d.end_rated_range_km))::integer)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.distance > 0
    AND (COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) > 0
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to);
END;
$$;


--
-- Name: fn_drive_score_trend(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_drive_score_trend(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("time" timestamp with time zone, score integer)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT d.start_date,
    LEAST(100, ROUND(100.0 * d.distance
      / (d.start_rated_range_km - d.end_rated_range_km))::integer)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.distance > 0
    AND (COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) > 0
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  ORDER BY d.start_date;
END;
$$;


--
-- Name: fn_drive_scores_recent(bigint, timestamp with time zone, timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_drive_scores_recent(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 30) RETURNS TABLE(date timestamp with time zone, distance numeric, avg_speed numeric, score integer, grade text, wh_per_km numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  WITH scored AS (
    SELECT
      d.start_date,
      d.distance,
      d.speed_avg,
      CASE WHEN d.distance > 0
        THEN ROUND(((COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) * 1000 / d.distance)::numeric, 0)
        ELSE NULL END AS computed_wh_per_km
    FROM drives d
    WHERE d.vehicle_id = p_vehicle_id
      AND d.distance > 1
      AND (p_from IS NULL OR d.start_date >= p_from)
      AND (p_to IS NULL OR d.start_date <= p_to)
  )
  SELECT
    s.start_date,
    ROUND(s.distance::numeric, 1),
    ROUND(s.speed_avg::numeric, 1),
    GREATEST(0, LEAST(100, (100 - GREATEST(0, (s.computed_wh_per_km - 120) * 0.3))))::integer,
    CASE
      WHEN GREATEST(0, LEAST(100, (100 - GREATEST(0, (s.computed_wh_per_km - 120) * 0.3)))) >= 90 THEN 'A'
      WHEN GREATEST(0, LEAST(100, (100 - GREATEST(0, (s.computed_wh_per_km - 120) * 0.3)))) >= 80 THEN 'B'
      WHEN GREATEST(0, LEAST(100, (100 - GREATEST(0, (s.computed_wh_per_km - 120) * 0.3)))) >= 70 THEN 'C'
      WHEN GREATEST(0, LEAST(100, (100 - GREATEST(0, (s.computed_wh_per_km - 120) * 0.3)))) >= 60 THEN 'D'
      ELSE 'F'
    END,
    s.computed_wh_per_km
  FROM scored s
  WHERE s.computed_wh_per_km IS NOT NULL
  ORDER BY s.start_date DESC
  LIMIT p_limit;
END;
$$;


--
-- Name: fn_driving_acceleration_distribution(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_driving_acceleration_distribution(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(acceleration_gs double precision)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT dt.acceleration_gs
  FROM drive_telemetry_readings dt
  JOIN drives d ON dt.drive_id = d.id
  WHERE d.vehicle_id = p_vehicle_id
    AND dt.acceleration_gs IS NOT NULL
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to);
END;
$$;


--
-- Name: fn_driving_braking_intensity(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_driving_braking_intensity(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("time" timestamp with time zone, hard_brakes bigint, moderate_brakes bigint, avg_decel numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.start_date,
    COUNT(*) FILTER (WHERE dt.acceleration_gs < -0.3)::bigint,
    COUNT(*) FILTER (WHERE dt.acceleration_gs < -0.2 AND dt.acceleration_gs >= -0.3)::bigint,
    ROUND(AVG(dt.acceleration_gs) FILTER (WHERE dt.acceleration_gs < 0)::numeric, 3)
  FROM drive_telemetry_readings dt
  JOIN drives d ON dt.drive_id = d.id
  WHERE d.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  GROUP BY d.id, d.start_date
  ORDER BY d.start_date;
END;
$$;


--
-- Name: fn_driving_daily_breakdown(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_driving_daily_breakdown(p_vehicle_id bigint) RETURNS TABLE("time" timestamp with time zone, distance numeric, energy_kwh numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE_TRUNC('day', d.start_date),
    ROUND(SUM(d.distance)::numeric, 1),
    ROUND(SUM(COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0))::numeric, 1)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.start_date >= DATE_TRUNC('week', NOW())
  GROUP BY DATE_TRUNC('day', d.start_date)
  ORDER BY 1;
END;
$$;


--
-- Name: fn_driving_speed_distribution(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_driving_speed_distribution(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(speed_range text, count bigint)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    (FLOOR(d.speed_avg / 10) * 10 || '-' || (FLOOR(d.speed_avg / 10) * 10 + 10))::text,
    COUNT(*)::bigint
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.speed_avg > 0
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  GROUP BY FLOOR(d.speed_avg / 10)
  ORDER BY FLOOR(d.speed_avg / 10);
END;
$$;


--
-- Name: fn_driving_speed_vs_efficiency(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_driving_speed_vs_efficiency(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(avg_speed numeric, wh_per_km numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    ROUND(d.speed_avg::numeric, 1),
    CASE WHEN d.distance > 0
      THEN ROUND(((COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) * 1000 / d.distance)::numeric, 0)
      ELSE NULL END
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.distance > 1 AND d.speed_avg > 0 AND (COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) > 0
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to);
END;
$$;


--
-- Name: fn_driving_stats(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_driving_stats(p_vehicle_id bigint, p_period text DEFAULT 'today'::text) RETURNS TABLE(distance numeric, drives bigint, energy_kwh numeric, drive_min numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    ROUND(COALESCE(SUM(d.distance), 0)::numeric, 1),
    COUNT(*)::bigint,
    ROUND(COALESCE(SUM(COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)), 0)::numeric, 1),
    ROUND(COALESCE(SUM(d.duration_min), 0)::numeric, 0)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND (p_period = 'all' OR d.start_date >= CASE p_period
      WHEN 'today' THEN DATE_TRUNC('day', NOW())
      WHEN 'week' THEN DATE_TRUNC('week', NOW())
      WHEN 'month' THEN DATE_TRUNC('month', NOW())
    END);
END;
$$;


--
-- Name: fn_driving_style_summary(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_driving_style_summary(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(style text, percent numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  WITH classified AS (
    SELECT
      CASE
        WHEN d.speed_avg < 40 AND COALESCE((COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) / NULLIF(d.distance, 0) * 1000, 0) < 150 THEN 'Gentle'
        WHEN d.speed_avg > 80 OR COALESCE((COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) / NULLIF(d.distance, 0) * 1000, 0) > 250 THEN 'Aggressive'
        ELSE 'Moderate'
      END AS style
    FROM drives d
    WHERE d.vehicle_id = p_vehicle_id
      AND d.distance > 1
      AND (p_from IS NULL OR d.start_date >= p_from)
      AND (p_to IS NULL OR d.start_date <= p_to)
  )
  SELECT c.style, ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM classified), 0), 1)
  FROM classified c
  GROUP BY c.style;
END;
$$;


--
-- Name: fn_driving_week_over_week(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_driving_week_over_week(p_vehicle_id bigint) RETURNS TABLE(period text, km numeric, drives bigint, kwh numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  WITH this_week AS (
    SELECT 'This Week'::text AS p,
      COALESCE(SUM(distance), 0)::numeric AS km, COUNT(*)::bigint AS drives,
      COALESCE(SUM(COALESCE(start_rated_range_km, 0) - COALESCE(end_rated_range_km, 0)), 0)::numeric AS kwh
    FROM drives WHERE vehicle_id = p_vehicle_id AND start_date >= DATE_TRUNC('week', NOW())
  ),
  last_week AS (
    SELECT 'Last Week'::text,
      COALESCE(SUM(distance), 0)::numeric, COUNT(*)::bigint,
      COALESCE(SUM(COALESCE(start_rated_range_km, 0) - COALESCE(end_rated_range_km, 0)), 0)::numeric
    FROM drives WHERE vehicle_id = p_vehicle_id
      AND start_date >= DATE_TRUNC('week', NOW()) - INTERVAL '7 days'
      AND start_date < DATE_TRUNC('week', NOW())
  )
  SELECT * FROM this_week UNION ALL SELECT * FROM last_week;
END;
$$;


--
-- Name: fn_regen_efficiency_trend(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_regen_efficiency_trend(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("time" timestamp with time zone, regen_pct numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.start_date,
    CASE WHEN (COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) > 0
      THEN ROUND((ABS(LEAST(COALESCE(d.power_min, 0), 0)) / (COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) * 100)::numeric, 1)
      ELSE NULL END
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.power_min IS NOT NULL
    AND (COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) > 0
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  ORDER BY d.start_date;
END;
$$;


--
-- Name: fn_route_efficiency(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_route_efficiency(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(route text, trips bigint, avg_wh_per_km numeric, avg_distance numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    (COALESCE(d.start_address, '?') || ' → ' || COALESCE(d.end_address, '?'))::text,
    COUNT(*)::bigint,
    ROUND(AVG(CASE WHEN d.distance > 0 THEN (COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) * 1000 / d.distance END)::numeric, 0),
    ROUND(AVG(d.distance)::numeric, 1)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.distance > 1
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  GROUP BY d.start_address, d.end_address
  HAVING COUNT(*) >= 2
  ORDER BY COUNT(*) DESC;
END;
$$;


--
-- Name: fn_sleep_efficiency(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sleep_efficiency(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("time" timestamp with time zone, duration_hours numeric, soc_loss numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT vd.start_date, ROUND(vd.duration_hours::numeric, 1),
    ROUND(vd.battery_lost::numeric, 1)
  FROM vampire_drain_events vd
  WHERE vd.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR vd.start_date >= p_from)
    AND (p_to IS NULL OR vd.start_date <= p_to)
  ORDER BY vd.start_date;
END;
$$;


--
-- Name: fn_speed_profile_histogram(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_speed_profile_histogram(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(speed_band text, reading_count bigint)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    (FLOOR(dt.speed / 10) * 10 || '-' || (FLOOR(dt.speed / 10) * 10 + 10))::text,
    COUNT(*)::bigint
  FROM drive_telemetry_readings dt
  JOIN drives d ON dt.drive_id = d.id
  WHERE d.vehicle_id = p_vehicle_id
    AND dt.speed > 0
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  GROUP BY FLOOR(dt.speed / 10)
  ORDER BY FLOOR(dt.speed / 10);
END;
$$;


--
-- Name: fn_true_cost_monthly(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_true_cost_monthly(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(month timestamp with time zone, ev_cost numeric, gas_cost numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  WITH charge_costs AS (
    SELECT DATE_TRUNC('month', cs.start_date) AS m,
      SUM(COALESCE(cs.cost, 0)) AS ev
    FROM charging_sessions cs
    WHERE cs.vehicle_id = p_vehicle_id
      AND (p_from IS NULL OR cs.start_date >= p_from)
      AND (p_to IS NULL OR cs.start_date <= p_to)
    GROUP BY DATE_TRUNC('month', cs.start_date)
  ),
  drive_dist AS (
    SELECT DATE_TRUNC('month', d.start_date) AS m,
      SUM(COALESCE(d.distance, 0)) AS dist
    FROM drives d
    WHERE d.vehicle_id = p_vehicle_id
      AND (p_from IS NULL OR d.start_date >= p_from)
      AND (p_to IS NULL OR d.start_date <= p_to)
    GROUP BY DATE_TRUNC('month', d.start_date)
  )
  SELECT COALESCE(c.m, dd.m),
    ROUND(COALESCE(c.ev, 0)::numeric, 2),
    ROUND((COALESCE(dd.dist, 0) * 0.12)::numeric, 2)
  FROM charge_costs c
  FULL OUTER JOIN drive_dist dd ON c.m = dd.m
  ORDER BY 1;
END;
$$;


--
-- Name: fn_true_cost_per_km(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_true_cost_per_km(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(month timestamp with time zone, ev_per_km numeric, gas_per_km numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  WITH monthly AS (
    SELECT DATE_TRUNC('month', d.start_date) AS m, SUM(d.distance) AS dist
    FROM drives d WHERE d.vehicle_id = p_vehicle_id
      AND (p_from IS NULL OR d.start_date >= p_from) AND (p_to IS NULL OR d.start_date <= p_to)
    GROUP BY DATE_TRUNC('month', d.start_date)
  ),
  costs AS (
    SELECT DATE_TRUNC('month', cs.start_date) AS m,
      SUM(COALESCE(cs.cost, 0)) AS ev
    FROM charging_sessions cs WHERE cs.vehicle_id = p_vehicle_id
      AND (p_from IS NULL OR cs.start_date >= p_from) AND (p_to IS NULL OR cs.start_date <= p_to)
    GROUP BY DATE_TRUNC('month', cs.start_date)
  )
  SELECT m.m, ROUND((COALESCE(c.ev, 0) / NULLIF(m.dist, 0))::numeric, 3),
    0.12::numeric
  FROM monthly m LEFT JOIN costs c ON m.m = c.m ORDER BY m.m;
END;
$$;


--
-- Name: fn_true_cost_totals(bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_true_cost_totals(p_vehicle_id bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(ev_total numeric, gas_total numeric, savings numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  WITH ev AS (
    SELECT COALESCE(SUM(COALESCE(cs.cost, 0)), 0) AS total
    FROM charging_sessions cs
    WHERE cs.vehicle_id = p_vehicle_id
      AND (p_from IS NULL OR cs.start_date >= p_from)
      AND (p_to IS NULL OR cs.start_date <= p_to)
  ),
  gas AS (
    SELECT COALESCE(SUM(COALESCE(d.distance, 0)) * 0.12, 0) AS total
    FROM drives d
    WHERE d.vehicle_id = p_vehicle_id
      AND (p_from IS NULL OR d.start_date >= p_from)
      AND (p_to IS NULL OR d.start_date <= p_to)
  )
  SELECT ROUND(ev.total::numeric, 2),
    ROUND(gas.total::numeric, 2),
    ROUND((gas.total - ev.total)::numeric, 2)
  FROM ev, gas;
END;
$$;


--
-- Name: fn_weekly_activity(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_weekly_activity(p_vehicle_id bigint) RETURNS TABLE(type text, start_time timestamp with time zone, from_loc text, to_loc text, distance numeric, duration_min numeric, energy_added numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT 'Drive'::text, d.start_date, COALESCE(d.start_address, '—')::text,
    COALESCE(d.end_address, '—')::text, ROUND(d.distance::numeric, 1),
    ROUND(d.duration_min::numeric, 0), NULL::numeric
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id AND d.start_date >= DATE_TRUNC('week', NOW())
  UNION ALL
  SELECT 'Charge', cs.start_date, COALESCE(cs.location_name, '—')::text, '—'::text, NULL,
    ROUND(EXTRACT(EPOCH FROM cs.end_date - cs.start_date) / 60, 0)::numeric,
    ROUND(cs.charge_energy_added::numeric, 1)
  FROM charging_sessions cs
  WHERE cs.vehicle_id = p_vehicle_id AND cs.start_date >= DATE_TRUNC('week', NOW())
  ORDER BY 2 DESC;
END;
$$;


--
-- Name: fn_weekly_summary(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_weekly_summary(p_vehicle_id bigint) RETURNS TABLE(distance numeric, drives bigint, energy_kwh numeric, drive_min numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    ROUND(COALESCE(SUM(d.distance), 0)::numeric, 1),
    COUNT(*)::bigint,
    ROUND(COALESCE(SUM(COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)), 0)::numeric, 1),
    ROUND(COALESCE(SUM(d.duration_min), 0)::numeric, 0)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.start_date >= DATE_TRUNC('week', NOW());
END;
$$;


--
-- Name: gas_price_at(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gas_price_at(ts timestamp with time zone DEFAULT now()) RETURNS TABLE(price_per_unit double precision, unit text, efficiency_mpg double precision)
    LANGUAGE sql STABLE
    AS $$
  SELECT h.price_per_unit, h.unit::TEXT, h.efficiency_mpg
  FROM gas_price_history h
  WHERE h.effective_from <= ts
    AND (h.effective_to IS NULL OR h.effective_to > ts)
  ORDER BY h.effective_from DESC
  LIMIT 1;
$$;


--
-- Name: unit_distance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unit_distance() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE unit_of_length WHEN 'mi' THEN 'mi' ELSE 'km' END FROM settings WHERE id = 1;
$$;


--
-- Name: unit_efficiency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unit_efficiency() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE unit_of_length WHEN 'mi' THEN 'Wh/mi' ELSE 'Wh/km' END FROM settings WHERE id = 1;
$$;


--
-- Name: unit_pressure(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unit_pressure() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE unit_of_length WHEN 'mi' THEN 'psi' ELSE 'bar' END FROM settings WHERE id = 1;
$$;


--
-- Name: unit_speed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unit_speed() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE unit_of_length WHEN 'mi' THEN 'mph' ELSE 'km/h' END FROM settings WHERE id = 1;
$$;


--
-- Name: unit_temp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unit_temp() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE unit_of_temp WHEN 'F' THEN '°F' ELSE '°C' END FROM settings WHERE id = 1;
$$;


--
-- Name: addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addresses (
    id bigint NOT NULL,
    display_name text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    name character varying(255),
    house_number character varying(50),
    road character varying(255),
    city character varying(255),
    county character varying(255),
    state character varying(255),
    country character varying(255),
    postcode character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: addresses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.addresses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: addresses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.addresses_id_seq OWNED BY public.addresses.id;


--
-- Name: alert_cooldown_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_cooldown_state (
    alert_rule_id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    state character varying(20) DEFAULT 'armed'::character varying NOT NULL,
    last_fired_at timestamp with time zone,
    fire_count_hour integer DEFAULT 0 NOT NULL,
    suppressed_count integer DEFAULT 0 NOT NULL
);


--
-- Name: alert_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_rules (
    id bigint NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(50) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    threshold double precision DEFAULT 0 NOT NULL,
    vehicle_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    conditions jsonb,
    expression text,
    cooldown_min integer DEFAULT 15 NOT NULL,
    for_duration_s integer,
    severity character varying(20) DEFAULT 'warning'::character varying NOT NULL,
    msg_template text,
    notify_channels integer[],
    last_fired_at timestamp with time zone,
    fire_count integer DEFAULT 0 NOT NULL,
    tags text[]
);


--
-- Name: alert_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alert_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alert_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alert_rules_id_seq OWNED BY public.alert_rules.id;


--
-- Name: alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerts (
    id bigint NOT NULL,
    vehicle_id bigint,
    type character varying(50) DEFAULT 'custom'::character varying NOT NULL,
    severity character varying(20) DEFAULT 'info'::character varying NOT NULL,
    title character varying(500) NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alerts_id_seq OWNED BY public.alerts.id;


--
-- Name: api_call_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_call_logs (
    id bigint NOT NULL,
    method character varying(10) NOT NULL,
    url text NOT NULL,
    status_code integer,
    request_body text,
    response_body text,
    duration_ms integer NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source character varying(20) DEFAULT 'tesla_api'::character varying NOT NULL
);


--
-- Name: api_call_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_call_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_call_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_call_logs_id_seq OWNED BY public.api_call_logs.id;


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id bigint NOT NULL,
    name character varying(255) NOT NULL,
    key_hash character varying(64) NOT NULL,
    key_prefix character varying(20),
    permissions character varying(50) DEFAULT 'read'::character varying NOT NULL,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: api_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_keys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_keys_id_seq OWNED BY public.api_keys.id;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    action text NOT NULL,
    resource text DEFAULT ''::text NOT NULL,
    details text DEFAULT ''::text NOT NULL,
    ip text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: automation_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_history (
    id bigint NOT NULL,
    automation_id bigint NOT NULL,
    automation_name text NOT NULL,
    vehicle_id bigint,
    triggered_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    duration_ms integer,
    trigger_type text NOT NULL,
    trigger_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    conditions_met boolean DEFAULT true NOT NULL,
    conditions_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    actions_executed jsonb DEFAULT '[]'::jsonb NOT NULL,
    actions_total integer DEFAULT 0 NOT NULL,
    actions_succeeded integer DEFAULT 0 NOT NULL,
    actions_failed integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    error text,
    fsm_state text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_history_id_seq OWNED BY public.automation_history.id;


--
-- Name: automation_variables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_variables (
    id bigint NOT NULL,
    key text NOT NULL,
    value text DEFAULT ''::text NOT NULL,
    vehicle_id bigint,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_variables_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_variables_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_variables_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_variables_id_seq OWNED BY public.automation_variables.id;


--
-- Name: automations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automations (
    id bigint NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    vehicle_id bigint,
    enabled boolean DEFAULT true NOT NULL,
    trigger_type text NOT NULL,
    trigger_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    conditions jsonb DEFAULT '[]'::jsonb NOT NULL,
    actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    cooldown_minutes integer DEFAULT 0 NOT NULL,
    max_executions_hour integer DEFAULT 0 NOT NULL,
    stop_on_failure boolean DEFAULT false NOT NULL,
    notify_on_run boolean DEFAULT false NOT NULL,
    notify_on_failure boolean DEFAULT true NOT NULL,
    seasonal_start integer,
    seasonal_end integer,
    priority integer DEFAULT 50 NOT NULL,
    last_triggered_at timestamp with time zone,
    last_success_at timestamp with time zone,
    last_failure_at timestamp with time zone,
    execution_count bigint DEFAULT 0 NOT NULL,
    failure_count bigint DEFAULT 0 NOT NULL,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    auto_disabled boolean DEFAULT false NOT NULL,
    auto_disabled_reason text,
    preset_id text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automations_id_seq OWNED BY public.automations.id;


--
-- Name: backup_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backup_configs (
    id bigint NOT NULL,
    name text DEFAULT 'Default Backup'::text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    backup_type text DEFAULT 'full'::text NOT NULL,
    frequency_days integer DEFAULT 1 NOT NULL,
    max_retention integer DEFAULT 30 NOT NULL,
    provider text DEFAULT 'local'::text NOT NULL,
    provider_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    include_tables text[],
    compress boolean DEFAULT true NOT NULL,
    encrypt boolean DEFAULT false NOT NULL,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: backup_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.backup_configs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: backup_configs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.backup_configs_id_seq OWNED BY public.backup_configs.id;


--
-- Name: backup_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backup_runs (
    id bigint NOT NULL,
    config_id bigint,
    run_type text DEFAULT 'backup'::text NOT NULL,
    backup_type text DEFAULT 'full'::text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    provider text DEFAULT 'local'::text NOT NULL,
    file_name text,
    file_path text,
    file_size bigint DEFAULT 0,
    record_count integer DEFAULT 0,
    table_count integer DEFAULT 0,
    checksum text,
    duration_ms bigint DEFAULT 0,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: backup_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.backup_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: backup_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.backup_runs_id_seq OWNED BY public.backup_runs.id;


--
-- Name: battery_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.battery_snapshots (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    health_score double precision DEFAULT 100 NOT NULL,
    capacity_kwh double precision DEFAULT 0 NOT NULL,
    degradation_pct double precision DEFAULT 0 NOT NULL,
    est_range_km double precision DEFAULT 0 NOT NULL,
    cycle_count integer DEFAULT 0 NOT NULL,
    avg_cell_temp_c double precision DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: battery_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.battery_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: battery_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.battery_snapshots_id_seq OWNED BY public.battery_snapshots.id;


--
-- Name: charge_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.charge_plans (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    target_soc integer NOT NULL,
    depart_by timestamp with time zone,
    scheduled_start timestamp with time zone NOT NULL,
    scheduled_end timestamp with time zone NOT NULL,
    rate_plan text NOT NULL,
    estimated_kwh numeric(8,2),
    estimated_cost numeric(8,2),
    charge_now_cost numeric(8,2),
    savings numeric(8,2),
    status text DEFAULT 'draft'::text NOT NULL,
    applied_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: charge_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.charge_plans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: charge_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.charge_plans_id_seq OWNED BY public.charge_plans.id;


--
-- Name: charge_telemetry_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.charge_telemetry_readings (
    id bigint NOT NULL,
    session_id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    battery_level integer,
    soc double precision,
    power_kw double precision,
    voltage double precision,
    current_amps double precision,
    phases integer,
    energy_added double precision,
    rated_range double precision,
    ideal_range double precision,
    est_range double precision,
    inside_temp double precision,
    outside_temp double precision,
    battery_temp double precision,
    latitude double precision,
    longitude double precision,
    charge_rate double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: charge_telemetry_readings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.charge_telemetry_readings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: charge_telemetry_readings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.charge_telemetry_readings_id_seq OWNED BY public.charge_telemetry_readings.id;


--
-- Name: charging_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.charging_sessions (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone,
    address_id bigint,
    charge_energy_added double precision DEFAULT 0 NOT NULL,
    charge_energy_used double precision,
    start_battery_level integer DEFAULT 0 NOT NULL,
    end_battery_level integer,
    start_range_km double precision,
    end_range_km double precision,
    charger_phases integer,
    charger_voltage integer,
    charger_actual_current integer,
    charger_power double precision,
    fast_charger_type character varying(100),
    fast_charger_brand character varying(100),
    conn_charge_cable character varying(100),
    cost double precision,
    duration_min double precision DEFAULT 0 NOT NULL,
    latitude double precision,
    longitude double precision,
    location_name text,
    inside_temp_avg double precision,
    outside_temp_avg double precision
);


--
-- Name: charging_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.charging_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: charging_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.charging_sessions_id_seq OWNED BY public.charging_sessions.id;


--
-- Name: charging_telemetry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.charging_telemetry (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    battery_level integer,
    soc double precision,
    charge_state character varying(50),
    detailed_charge_state character varying(50),
    charge_limit_soc integer,
    charge_amps double precision,
    charge_current_request double precision,
    charge_current_request_max double precision,
    charge_enable_request boolean,
    charger_voltage double precision,
    charger_phases integer,
    charge_rate_mph double precision,
    dc_charging_power double precision,
    dc_charging_energy_in double precision,
    ac_charging_power double precision,
    ac_charging_energy_in double precision,
    energy_remaining double precision,
    est_battery_range double precision,
    ideal_battery_range double precision,
    rated_range double precision,
    pack_voltage double precision,
    pack_current double precision,
    charge_port_door_open boolean,
    charge_port_latch character varying(50),
    charge_port_cold_weather_mode boolean,
    charging_cable_type character varying(50),
    fast_charger_present boolean,
    fast_charger_type character varying(50),
    time_to_full_charge double precision,
    estimated_hours_to_charge double precision,
    scheduled_charging_mode character varying(50),
    scheduled_charging_pending boolean,
    preconditioning_enabled boolean,
    brick_voltage_max double precision,
    brick_voltage_min double precision,
    num_brick_voltage_max integer,
    num_brick_voltage_min integer,
    module_temp_max double precision,
    module_temp_min double precision,
    num_module_temp_max integer,
    num_module_temp_min integer,
    battery_heater_on boolean,
    not_enough_power_to_heat boolean,
    bms_state character varying(50),
    bms_fullcharge_complete boolean,
    dcdc_enable boolean,
    isolation_resistance double precision,
    lifetime_energy_used double precision,
    supercharger_session_trip_planner boolean,
    powershare_status character varying(50),
    powershare_type character varying(50),
    powershare_stop_reason character varying(50),
    powershare_hours_left double precision,
    powershare_power_kw double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    scheduled_charging_start_time text,
    scheduled_departure_time text,
    expected_energy_pct_at_arrival double precision,
    charge_port character varying(50)
);


--
-- Name: charging_telemetry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.charging_telemetry_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: charging_telemetry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.charging_telemetry_id_seq OWNED BY public.charging_telemetry.id;


--
-- Name: chatbot_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chatbot_messages (
    id bigint NOT NULL,
    session_id text NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chatbot_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);


--
-- Name: chatbot_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chatbot_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chatbot_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chatbot_messages_id_seq OWNED BY public.chatbot_messages.id;


--
-- Name: climate_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.climate_snapshots (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    inside_temp double precision,
    outside_temp double precision,
    hvac_power double precision,
    hvac_fan_speed integer,
    hvac_left_temp_request double precision,
    hvac_right_temp_request double precision,
    cabin_overheat_mode character varying(50),
    defrost_mode character varying(50),
    battery_heater_on boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    hvac_ac_enabled boolean,
    hvac_auto_mode character varying(100),
    hvac_fan_status integer,
    hvac_steering_wheel_heat_auto boolean,
    hvac_steering_wheel_heat_level integer,
    climate_keeper_mode character varying(50),
    cabin_overheat_protection_temp_limit character varying(50),
    defrost_for_preconditioning boolean,
    seat_heater_left integer,
    seat_heater_right integer,
    seat_heater_rear_left integer,
    seat_heater_rear_center integer,
    seat_heater_rear_right integer,
    seat_vent_enabled boolean,
    climate_seat_cooling_front_left integer,
    climate_seat_cooling_front_right integer,
    auto_seat_climate_left boolean,
    auto_seat_climate_right boolean,
    rear_defrost_enabled boolean,
    rear_display_hvac_enabled boolean,
    wiper_heat_enabled boolean
);


--
-- Name: climate_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.climate_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: climate_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.climate_snapshots_id_seq OWNED BY public.climate_snapshots.id;


--
-- Name: command_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.command_executions (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    command_type character varying(50) NOT NULL,
    parameters jsonb,
    state character varying(20) DEFAULT 'queued'::character varying NOT NULL,
    requested_by character varying(100),
    wake_retry_count integer DEFAULT 0 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    max_retries integer DEFAULT 3 NOT NULL,
    last_error jsonb,
    tesla_response jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    wake_sent_at timestamp with time zone,
    wake_confirmed_at timestamp with time zone,
    command_sent_at timestamp with time zone,
    completed_at timestamp with time zone
);


--
-- Name: command_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.command_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: command_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.command_executions_id_seq OWNED BY public.command_executions.id;


--
-- Name: command_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.command_logs (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    command character varying(100) NOT NULL,
    params text DEFAULT ''::text NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    error text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: command_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.command_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: command_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.command_logs_id_seq OWNED BY public.command_logs.id;


--
-- Name: daily_mileage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_mileage (
    id bigint NOT NULL,
    vehicle_id bigint,
    date date NOT NULL,
    distance_km double precision DEFAULT 0,
    odometer_start double precision DEFAULT 0,
    odometer_end double precision DEFAULT 0,
    drive_count integer DEFAULT 0,
    energy_used_kwh double precision DEFAULT 0
);


--
-- Name: daily_mileage_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_mileage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_mileage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_mileage_id_seq OWNED BY public.daily_mileage.id;


--
-- Name: drive_telemetry_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drive_telemetry_readings (
    id bigint NOT NULL,
    drive_id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    latitude double precision,
    longitude double precision,
    elevation double precision,
    heading integer,
    odometer double precision,
    speed double precision,
    power double precision,
    battery_level integer,
    soc double precision,
    usable_soc double precision,
    rated_range double precision,
    ideal_range double precision,
    est_range double precision,
    inside_temp double precision,
    outside_temp double precision,
    driver_temp double precision,
    passenger_temp double precision,
    fan_status integer,
    is_climate_on boolean,
    tire_pressure_fl double precision,
    tire_pressure_fr double precision,
    tire_pressure_rl double precision,
    tire_pressure_rr double precision,
    battery_heater_on boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    acceleration_gs double precision
);


--
-- Name: drive_telemetry_readings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.drive_telemetry_readings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: drive_telemetry_readings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.drive_telemetry_readings_id_seq OWNED BY public.drive_telemetry_readings.id;


--
-- Name: drives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drives (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone,
    start_position_id bigint,
    end_position_id bigint,
    start_address_id bigint,
    end_address_id bigint,
    distance double precision DEFAULT 0 NOT NULL,
    duration_min double precision DEFAULT 0 NOT NULL,
    start_range_km double precision,
    end_range_km double precision,
    speed_max double precision,
    power_max double precision,
    power_min double precision,
    start_battery_level integer,
    end_battery_level integer,
    inside_temp_avg double precision,
    outside_temp_avg double precision,
    start_odometer double precision,
    end_odometer double precision,
    speed_avg double precision,
    speed_min double precision,
    start_rated_range_km double precision,
    end_rated_range_km double precision,
    rated_range_avg double precision,
    rated_range_max double precision,
    rated_range_min double precision,
    start_ideal_range_km double precision,
    end_ideal_range_km double precision,
    ideal_range_avg double precision,
    ideal_range_max double precision,
    ideal_range_min double precision,
    start_est_range_km double precision,
    end_est_range_km double precision,
    est_range_avg double precision,
    est_range_max double precision,
    est_range_min double precision,
    soc_start double precision,
    soc_end double precision,
    soc_avg double precision,
    soc_max double precision,
    soc_min double precision,
    usable_soc_start double precision,
    usable_soc_end double precision,
    usable_soc_avg double precision,
    usable_soc_max double precision,
    usable_soc_min double precision,
    elevation_start double precision,
    elevation_end double precision,
    elevation_gain double precision,
    elevation_loss double precision,
    driver_temp_avg double precision,
    passenger_temp_avg double precision,
    battery_heater_on boolean DEFAULT false,
    start_address text,
    end_address text,
    start_latitude double precision,
    start_longitude double precision,
    end_latitude double precision,
    end_longitude double precision
);


--
-- Name: drives_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.drives_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: drives_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.drives_id_seq OWNED BY public.drives.id;


--
-- Name: export_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.export_jobs (
    id text NOT NULL,
    type text NOT NULL,
    format text DEFAULT 'csv'::text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    vehicle_id bigint,
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    file_name text,
    file_data bytea,
    file_size bigint DEFAULT 0,
    record_count integer DEFAULT 0,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: fleet_telemetry_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fleet_telemetry_subscriptions (
    id bigint NOT NULL,
    vehicle_id bigint,
    vin character varying(17),
    signals text[] NOT NULL,
    interval_seconds integer DEFAULT 30 NOT NULL,
    hostname text NOT NULL,
    port integer DEFAULT 4443 NOT NULL,
    protocol text DEFAULT 'wss'::text NOT NULL,
    ca_pem text,
    subscribed_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    response_code integer,
    response_body text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    field_intervals jsonb
);


--
-- Name: COLUMN fleet_telemetry_subscriptions.field_intervals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fleet_telemetry_subscriptions.field_intervals IS 'Per-signal interval overrides as JSON object {signal_name: interval_seconds}';


--
-- Name: fleet_telemetry_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fleet_telemetry_subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fleet_telemetry_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fleet_telemetry_subscriptions_id_seq OWNED BY public.fleet_telemetry_subscriptions.id;


--
-- Name: fsm_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fsm_transitions (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    fsm_type character varying(30) NOT NULL,
    fsm_instance_id bigint,
    from_state character varying(30) NOT NULL,
    to_state character varying(30) NOT NULL,
    trigger character varying(50) NOT NULL,
    guard character varying(50),
    mode character varying(20) DEFAULT 'immediate'::character varying NOT NULL,
    context_snapshot jsonb,
    duration_in_state_ms bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fsm_transitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fsm_transitions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fsm_transitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fsm_transitions_id_seq OWNED BY public.fsm_transitions.id;


--
-- Name: gas_price_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gas_price_history (
    id bigint NOT NULL,
    price_per_unit double precision NOT NULL,
    unit character varying(10) DEFAULT 'gallon'::character varying NOT NULL,
    efficiency_mpg double precision DEFAULT 25 NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_to timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gas_price_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gas_price_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gas_price_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gas_price_history_id_seq OWNED BY public.gas_price_history.id;


--
-- Name: gas_price_poll_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gas_price_poll_state (
    id integer DEFAULT 1 NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    poll_interval character varying(10) DEFAULT '7d'::character varying NOT NULL,
    last_poll_time timestamp with time zone DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone NOT NULL,
    last_price double precision DEFAULT 0 NOT NULL,
    CONSTRAINT gas_price_poll_state_id_check CHECK ((id = 1))
);


--
-- Name: geofence_electricity_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geofence_electricity_rates (
    id bigint NOT NULL,
    geofence_id bigint NOT NULL,
    cost_per_kwh double precision NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_to timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: geofence_electricity_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.geofence_electricity_rates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: geofence_electricity_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.geofence_electricity_rates_id_seq OWNED BY public.geofence_electricity_rates.id;


--
-- Name: geofences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geofences (
    id bigint NOT NULL,
    name character varying(255) NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    radius double precision DEFAULT 50 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cost_per_kwh double precision
);


--
-- Name: geofences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.geofences_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: geofences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.geofences_id_seq OWNED BY public.geofences.id;


--
-- Name: guard_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guard_events (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    event_type text NOT NULL,
    latitude double precision,
    longitude double precision,
    speed double precision,
    details jsonb,
    notified_channels text[],
    acknowledged boolean DEFAULT false NOT NULL,
    acknowledged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT guard_events_event_type_check CHECK ((event_type = ANY (ARRAY['vehicle_moved'::text, 'unauthorized_unlock'::text, 'unauthorized_drive'::text, 'sentry_triggered'::text, 'manual_panic'::text, 'test_alert'::text])))
);


--
-- Name: guard_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.guard_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: guard_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.guard_events_id_seq OWNED BY public.guard_events.id;


--
-- Name: location_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_snapshots (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    destination_name character varying(255),
    destination_lat double precision,
    destination_lon double precision,
    origin_lat double precision,
    origin_lon double precision,
    miles_to_arrival double precision,
    minutes_to_arrival double precision,
    route_line text,
    route_traffic_delay_min double precision,
    located_at_home boolean,
    located_at_work boolean,
    located_at_favorite boolean,
    gps_state character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    route_last_updated timestamp with time zone,
    current_lat double precision,
    current_lon double precision
);


--
-- Name: location_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.location_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: location_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.location_snapshots_id_seq OWNED BY public.location_snapshots.id;


--
-- Name: media_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_snapshots (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    now_playing_title character varying(255),
    now_playing_artist character varying(255),
    now_playing_album character varying(255),
    now_playing_station character varying(255),
    now_playing_duration integer,
    now_playing_elapsed integer,
    playback_status character varying(50),
    playback_source character varying(50),
    audio_volume double precision,
    audio_volume_max double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    audio_volume_increment double precision
);


--
-- Name: media_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.media_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: media_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.media_snapshots_id_seq OWNED BY public.media_snapshots.id;


--
-- Name: motor_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.motor_snapshots (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    di_state character varying(50),
    di_torque double precision,
    di_axle_speed double precision,
    di_stator_temp double precision,
    pedal_position double precision,
    brake_pedal boolean,
    lateral_accel double precision,
    longitudinal_accel double precision,
    vehicle_speed double precision,
    gear character varying(30),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    di_torque_actual_f double precision,
    di_torque_actual_r double precision,
    di_torque_actual_rel double precision,
    di_torque_actual_rer double precision,
    di_axle_speed_f double precision,
    di_axle_speed_rel double precision,
    di_axle_speed_rer double precision,
    di_state_f character varying(50),
    di_state_rel character varying(50),
    di_state_rer character varying(50),
    di_stator_temp_f double precision,
    di_stator_temp_rel double precision,
    di_stator_temp_rer double precision,
    di_heatsink_t_f double precision,
    di_heatsink_t_r double precision,
    di_heatsink_t_rel double precision,
    di_heatsink_t_rer double precision,
    di_inverter_t_f double precision,
    di_inverter_t_r double precision,
    di_inverter_t_rel double precision,
    di_inverter_t_rer double precision,
    di_motor_current_f double precision,
    di_motor_current_r double precision,
    di_motor_current_rel double precision,
    di_motor_current_rer double precision,
    di_v_bat_f double precision,
    di_v_bat_r double precision,
    di_v_bat_rel double precision,
    di_v_bat_rer double precision,
    di_slave_torque_cmd double precision,
    hvil character varying(50),
    brake_pedal_pos double precision,
    cruise_set_speed double precision,
    drive_rail boolean,
    lifetime_energy_gained_regen double precision,
    lifetime_energy_used_drive double precision
);


--
-- Name: motor_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.motor_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: motor_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.motor_snapshots_id_seq OWNED BY public.motor_snapshots.id;


--
-- Name: mv_energy_daily; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_energy_daily AS
 SELECT COALESCE(c.vehicle_id, d.vehicle_id) AS vehicle_id,
    COALESCE(c.day, d.day) AS day,
    COALESCE(c.energy_kwh, (0)::double precision) AS energy_kwh,
    COALESCE(d.distance_km, (0)::double precision) AS distance_km,
    COALESCE(c.cost, (0)::double precision) AS cost,
        CASE
            WHEN (COALESCE(d.distance_km, (0)::double precision) > (0)::double precision) THEN ((COALESCE(c.energy_kwh, (0)::double precision) / d.distance_km) * (1000)::double precision)
            ELSE (0)::double precision
        END AS efficiency
   FROM (( SELECT charging_sessions.vehicle_id,
            date(charging_sessions.start_date) AS day,
            sum(charging_sessions.charge_energy_added) AS energy_kwh,
            sum(charging_sessions.cost) AS cost
           FROM public.charging_sessions
          GROUP BY charging_sessions.vehicle_id, (date(charging_sessions.start_date))) c
     FULL JOIN ( SELECT drives.vehicle_id,
            date(drives.start_date) AS day,
            sum(drives.distance) AS distance_km
           FROM public.drives
          GROUP BY drives.vehicle_id, (date(drives.start_date))) d ON (((c.vehicle_id = d.vehicle_id) AND (c.day = d.day))))
  WITH NO DATA;


--
-- Name: positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    speed double precision,
    power double precision,
    heading integer,
    elevation double precision,
    odometer double precision DEFAULT 0 NOT NULL,
    ideal_range double precision,
    rated_range double precision,
    battery_level integer DEFAULT 0 NOT NULL,
    inside_temp double precision,
    outside_temp double precision,
    fan_status integer,
    is_climate_on boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL
)
PARTITION BY RANGE (created_at);


--
-- Name: mv_position_hourly; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_position_hourly AS
 SELECT vehicle_id,
    date_trunc('hour'::text, created_at) AS hour,
    avg(speed) AS avg_speed,
    avg(power) AS avg_power,
    avg(battery_level) AS avg_battery,
    avg(latitude) AS avg_lat,
    avg(longitude) AS avg_lng,
    avg(inside_temp) AS avg_inside_temp,
    avg(outside_temp) AS avg_outside_temp,
    count(*) AS sample_count,
    min(created_at) AS first_at,
    max(created_at) AS last_at
   FROM public.positions
  GROUP BY vehicle_id, (date_trunc('hour'::text, created_at))
  WITH NO DATA;


--
-- Name: signal_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signal_history (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    signal character varying(100) NOT NULL,
    value_num double precision,
    value_str character varying(500),
    value_bool boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mv_signal_stats; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_signal_stats AS
 SELECT vehicle_id,
    signal,
    date_trunc('hour'::text, created_at) AS hour,
    min(value_num) AS min_val,
    max(value_num) AS max_val,
    avg(value_num) AS avg_val,
    count(*) AS cnt
   FROM public.signal_history
  WHERE (value_num IS NOT NULL)
  GROUP BY vehicle_id, signal, (date_trunc('hour'::text, created_at))
  WITH NO DATA;


--
-- Name: notification_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_channels (
    id bigint NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_channels_type_check CHECK ((type = ANY (ARRAY['discord'::text, 'email'::text, 'slack'::text, 'telegram'::text, 'webhook'::text, 'ntfy'::text, 'pushover'::text])))
);


--
-- Name: notification_channels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_channels_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_channels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_channels_id_seq OWNED BY public.notification_channels.id;


--
-- Name: notification_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_logs (
    id bigint NOT NULL,
    channel_id bigint NOT NULL,
    alert_id bigint,
    title text NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    scheduled_at timestamp with time zone,
    latency_ms integer,
    CONSTRAINT notification_logs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: notification_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_logs_id_seq OWNED BY public.notification_logs.id;


--
-- Name: notification_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_metrics (
    id bigint NOT NULL,
    channel_id bigint NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    total_sent integer DEFAULT 0 NOT NULL,
    total_failed integer DEFAULT 0 NOT NULL,
    avg_latency_ms integer DEFAULT 0 NOT NULL
);


--
-- Name: notification_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_metrics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_metrics_id_seq OWNED BY public.notification_metrics.id;


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    id bigint NOT NULL,
    channel_id bigint NOT NULL,
    event_type text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_preferences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_preferences_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_preferences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_preferences_id_seq OWNED BY public.notification_preferences.id;


--
-- Name: notification_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_schedules (
    id bigint NOT NULL,
    channel_id bigint NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    cron_expr text,
    scheduled_at timestamp with time zone,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_schedules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_schedules_id_seq OWNED BY public.notification_schedules.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    vehicle_id bigint,
    alert_rule_id bigint,
    type character varying(30) DEFAULT 'alert'::character varying NOT NULL,
    title character varying(255) NOT NULL,
    body text,
    severity character varying(20) DEFAULT 'info'::character varying NOT NULL,
    state character varying(20) DEFAULT 'created'::character varying NOT NULL,
    channels jsonb DEFAULT '[]'::jsonb NOT NULL,
    signals_snapshot jsonb,
    retry_count integer DEFAULT 0 NOT NULL,
    max_retries integer DEFAULT 3 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    next_retry_at timestamp with time zone
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: places_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.places_cache (
    id bigint NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    display_name text NOT NULL,
    source character varying(20) DEFAULT 'nominatim'::character varying NOT NULL,
    place_id text,
    business_name text,
    category text,
    city text,
    state text,
    country text,
    postcode text,
    hit_count integer DEFAULT 1 NOT NULL,
    last_used_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: places_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.places_cache_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: places_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.places_cache_id_seq OWNED BY public.places_cache.id;


--
-- Name: positions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.positions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: positions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.positions_id_seq OWNED BY public.positions.id;


--
-- Name: positions_2026_04; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions_2026_04 (
    id bigint DEFAULT nextval('public.positions_id_seq'::regclass) NOT NULL,
    vehicle_id bigint NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    speed double precision,
    power double precision,
    heading integer,
    elevation double precision,
    odometer double precision DEFAULT 0 NOT NULL,
    ideal_range double precision,
    rated_range double precision,
    battery_level integer DEFAULT 0 NOT NULL,
    inside_temp double precision,
    outside_temp double precision,
    fan_status integer,
    is_climate_on boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: positions_2026_05; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions_2026_05 (
    id bigint DEFAULT nextval('public.positions_id_seq'::regclass) NOT NULL,
    vehicle_id bigint NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    speed double precision,
    power double precision,
    heading integer,
    elevation double precision,
    odometer double precision DEFAULT 0 NOT NULL,
    ideal_range double precision,
    rated_range double precision,
    battery_level integer DEFAULT 0 NOT NULL,
    inside_temp double precision,
    outside_temp double precision,
    fan_status integer,
    is_climate_on boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: positions_default; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions_default (
    id bigint DEFAULT nextval('public.positions_id_seq'::regclass) NOT NULL,
    vehicle_id bigint NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    speed double precision,
    power double precision,
    heading integer,
    elevation double precision,
    odometer double precision DEFAULT 0 NOT NULL,
    ideal_range double precision,
    rated_range double precision,
    battery_level integer DEFAULT 0 NOT NULL,
    inside_temp double precision,
    outside_temp double precision,
    fan_status integer,
    is_climate_on boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: safety_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safety_snapshots (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    automatic_blind_spot_camera boolean,
    automatic_emergency_braking_off boolean,
    blind_spot_collision_warning boolean,
    cruise_follow_distance character varying(50),
    emergency_lane_departure_avoidance boolean,
    forward_collision_warning character varying(100),
    lane_departure_avoidance character varying(100),
    speed_limit_warning character varying(50),
    pin_to_drive_enabled boolean,
    miles_since_reset double precision,
    self_driving_miles_since_reset double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: safety_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.safety_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: safety_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.safety_snapshots_id_seq OWNED BY public.safety_snapshots.id;


--


--
-- Name: security_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_events (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    locked boolean,
    sentry_mode boolean,
    door_state text,
    fd_window character varying(50),
    fp_window character varying(50),
    rd_window character varying(50),
    rp_window character varying(50),
    homelink_nearby boolean,
    guest_mode boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    homelink_device_count integer,
    guest_mode_mobile_access_state character varying(50),
    driver_seat_occupied boolean,
    center_display character varying(50),
    speed_limit_mode character varying(50),
    valet_mode_enabled boolean,
    service_mode boolean,
    current_limit_mph double precision,
    paired_phone_key_count integer,
    lights_hazards_active boolean,
    lights_high_beams boolean,
    lights_turn_signal character varying(50),
    tonneau_position character varying(50),
    tonneau_open_percent double precision,
    tonneau_tent_mode text,
    driver_seat_belt boolean,
    passenger_seat_belt boolean
);


--
-- Name: security_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.security_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: security_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.security_events_id_seq OWNED BY public.security_events.id;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id integer DEFAULT 1 NOT NULL,
    unit_of_length character varying(5) DEFAULT 'km'::character varying NOT NULL,
    unit_of_temp character varying(5) DEFAULT 'C'::character varying NOT NULL,
    preferred_range character varying(10) DEFAULT 'rated'::character varying NOT NULL,
    language character varying(10) DEFAULT 'en'::character varying NOT NULL,
    base_cost_per_kwh double precision DEFAULT 0 NOT NULL,
    api_suspended boolean DEFAULT false NOT NULL,
    theme character varying(20) DEFAULT 'neon-cyan'::character varying NOT NULL,
    mode character varying(20) DEFAULT 'dark'::character varying NOT NULL,
    custom_primary character varying(10) DEFAULT '#00b4d8'::character varying NOT NULL,
    custom_accent character varying(10) DEFAULT '#e63946'::character varying NOT NULL,
    gas_price_per_unit double precision DEFAULT 0 NOT NULL,
    gas_unit character varying(10) DEFAULT 'gallon'::character varying NOT NULL,
    gas_efficiency_mpg double precision DEFAULT 25 NOT NULL,
    polling_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    decimal_precision integer DEFAULT 1 NOT NULL,
    quiet_hours_enabled boolean DEFAULT false NOT NULL,
    quiet_hours_start character varying(5) DEFAULT '22:00'::character varying NOT NULL,
    quiet_hours_end character varying(5) DEFAULT '07:00'::character varying NOT NULL,
    alert_digest_mode character varying(10) DEFAULT 'instant'::character varying NOT NULL,
    unit_of_pressure character varying(10) DEFAULT 'bar'::character varying NOT NULL,
    CONSTRAINT settings_id_check CHECK ((id = 1))
);


--
-- Name: share_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.share_tokens (
    id bigint NOT NULL,
    token text NOT NULL,
    drive_id bigint NOT NULL,
    created_by text,
    title text,
    description text,
    include_map boolean DEFAULT true,
    include_telemetry boolean DEFAULT false,
    include_speed boolean DEFAULT true,
    views integer DEFAULT 0,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: share_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.share_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: share_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.share_tokens_id_seq OWNED BY public.share_tokens.id;


--
-- Name: signal_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.signal_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: signal_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.signal_history_id_seq OWNED BY public.signal_history.id;


--
-- Name: software_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.software_updates (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    version character varying(100) NOT NULL,
    status character varying(50) DEFAULT 'available'::character varying NOT NULL,
    scheduled_at timestamp with time zone,
    installed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: software_updates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.software_updates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: software_updates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.software_updates_id_seq OWNED BY public.software_updates.id;


--
-- Name: tesla_charging_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesla_charging_history (
    id bigint NOT NULL,
    session_id bigint NOT NULL,
    vin text NOT NULL,
    site_location_name text DEFAULT ''::text NOT NULL,
    charge_start_datetime timestamp with time zone NOT NULL,
    charge_stop_datetime timestamp with time zone,
    country text,
    state text,
    county text,
    postal_code text,
    billing_type text,
    fee_type text,
    currency_code text,
    pricing_type text,
    rate_base double precision,
    usage_kwh double precision,
    total_due double precision,
    has_invoice boolean DEFAULT false NOT NULL,
    invoice_content_id text,
    raw_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tesla_charging_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesla_charging_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesla_charging_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesla_charging_history_id_seq OWNED BY public.tesla_charging_history.id;


--
-- Name: tesla_charging_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesla_charging_sessions (
    id bigint NOT NULL,
    session_id bigint NOT NULL,
    vin text NOT NULL,
    charger_id text,
    site_location_name text DEFAULT ''::text NOT NULL,
    charge_start_datetime timestamp with time zone NOT NULL,
    charge_stop_datetime timestamp with time zone,
    energy_added_kwh double precision,
    peak_power_kw double precision,
    max_charge_rate_kw double precision,
    charge_duration_s integer,
    charger_type text,
    currency_code text,
    total_cost double precision,
    per_kwh_rate double precision,
    idle_fee double precision,
    congestion_fee double precision,
    latitude double precision,
    longitude double precision,
    raw_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tesla_charging_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesla_charging_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesla_charging_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesla_charging_sessions_id_seq OWNED BY public.tesla_charging_sessions.id;


--
-- Name: tesla_energy_backup_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesla_energy_backup_events (
    id bigint NOT NULL,
    energy_site_id bigint NOT NULL,
    period text DEFAULT 'day'::text NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    duration_seconds integer DEFAULT 0 NOT NULL,
    raw_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tesla_energy_backup_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesla_energy_backup_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesla_energy_backup_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesla_energy_backup_events_id_seq OWNED BY public.tesla_energy_backup_events.id;


--
-- Name: tesla_energy_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesla_energy_history (
    id bigint NOT NULL,
    energy_site_id bigint NOT NULL,
    period text NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    solar_energy_wh double precision,
    battery_energy_in_wh double precision,
    battery_energy_out_wh double precision,
    grid_energy_in_wh double precision,
    grid_energy_out_wh double precision,
    consumer_energy_wh double precision,
    raw_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tesla_energy_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesla_energy_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesla_energy_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesla_energy_history_id_seq OWNED BY public.tesla_energy_history.id;


--
-- Name: tesla_energy_live_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesla_energy_live_status (
    id bigint NOT NULL,
    energy_site_id bigint NOT NULL,
    solar_power double precision,
    battery_power double precision,
    load_power double precision,
    grid_power double precision,
    grid_services_power double precision,
    energy_left double precision,
    total_pack_energy double precision,
    percentage_charged double precision,
    grid_status text,
    backup_capable boolean,
    storm_mode_active boolean,
    raw_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tesla_energy_live_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesla_energy_live_status_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesla_energy_live_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesla_energy_live_status_id_seq OWNED BY public.tesla_energy_live_status.id;


--
-- Name: tesla_energy_sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesla_energy_sites (
    id bigint NOT NULL,
    energy_site_id bigint NOT NULL,
    resource_type text DEFAULT ''::text NOT NULL,
    site_name text DEFAULT ''::text NOT NULL,
    gateway_id text,
    total_pack_energy double precision,
    percentage_charged double precision,
    battery_type text,
    backup_capable boolean DEFAULT false NOT NULL,
    storm_mode_enabled boolean DEFAULT false NOT NULL,
    has_solar boolean DEFAULT false NOT NULL,
    has_battery boolean DEFAULT false NOT NULL,
    has_grid boolean DEFAULT false NOT NULL,
    has_load_meter boolean DEFAULT false NOT NULL,
    tou_capable boolean DEFAULT false NOT NULL,
    storm_mode_capable boolean DEFAULT false NOT NULL,
    raw_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    site_info_json jsonb,
    site_info_fetched_at timestamp with time zone
);


--
-- Name: tesla_energy_sites_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesla_energy_sites_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesla_energy_sites_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesla_energy_sites_id_seq OWNED BY public.tesla_energy_sites.id;


--
-- Name: tesla_energy_wc_charging; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesla_energy_wc_charging (
    id bigint NOT NULL,
    energy_site_id bigint NOT NULL,
    din text,
    "timestamp" timestamp with time zone NOT NULL,
    energy_wh double precision,
    raw_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tesla_energy_wc_charging_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesla_energy_wc_charging_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesla_energy_wc_charging_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesla_energy_wc_charging_id_seq OWNED BY public.tesla_energy_wc_charging.id;


--
-- Name: tesla_fleet_telemetry_error_vins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesla_fleet_telemetry_error_vins (
    id bigint NOT NULL,
    vin text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone
);


--
-- Name: tesla_fleet_telemetry_error_vins_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesla_fleet_telemetry_error_vins_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesla_fleet_telemetry_error_vins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesla_fleet_telemetry_error_vins_id_seq OWNED BY public.tesla_fleet_telemetry_error_vins.id;


--
-- Name: tesla_fleet_telemetry_errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesla_fleet_telemetry_errors (
    id bigint NOT NULL,
    vin text NOT NULL,
    error_code text,
    error_message text,
    reported_at timestamp with time zone,
    raw_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    tesla_updated_at timestamp with time zone,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tesla_fleet_telemetry_errors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesla_fleet_telemetry_errors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesla_fleet_telemetry_errors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesla_fleet_telemetry_errors_id_seq OWNED BY public.tesla_fleet_telemetry_errors.id;


--
-- Name: tesla_public_key; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesla_public_key (
    id integer DEFAULT 1 NOT NULL,
    public_key_pem text NOT NULL,
    fingerprint character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT single_row CHECK ((id = 1))
);


--
-- Name: tesla_user_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesla_user_config (
    id bigint NOT NULL,
    config_type text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tesla_user_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesla_user_config_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesla_user_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesla_user_config_id_seq OWNED BY public.tesla_user_config.id;


--
-- Name: tesla_user_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesla_user_orders (
    id bigint NOT NULL,
    order_id text NOT NULL,
    model text DEFAULT ''::text NOT NULL,
    status text DEFAULT ''::text NOT NULL,
    delivery_date date,
    vin text,
    referral_code text,
    is_upgradable boolean DEFAULT false NOT NULL,
    raw_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tesla_user_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesla_user_orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesla_user_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesla_user_orders_id_seq OWNED BY public.tesla_user_orders.id;


--
-- Name: tesla_user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesla_user_profiles (
    id bigint NOT NULL,
    email text DEFAULT ''::text NOT NULL,
    full_name text DEFAULT ''::text NOT NULL,
    profile_image_url text,
    raw_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tesla_user_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesla_user_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesla_user_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesla_user_profiles_id_seq OWNED BY public.tesla_user_profiles.id;


--
-- Name: tesla_vehicle_drivers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesla_vehicle_drivers (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    vin text NOT NULL,
    share_user_id bigint,
    driver_email text,
    driver_name text,
    role text,
    raw_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tesla_vehicle_drivers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesla_vehicle_drivers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesla_vehicle_drivers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesla_vehicle_drivers_id_seq OWNED BY public.tesla_vehicle_drivers.id;


--
-- Name: tesla_vehicle_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesla_vehicle_invitations (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    vin text NOT NULL,
    invitation_id text NOT NULL,
    invite_url text,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone,
    created_by text,
    raw_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tesla_vehicle_invitations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesla_vehicle_invitations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesla_vehicle_invitations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesla_vehicle_invitations_id_seq OWNED BY public.tesla_vehicle_invitations.id;


--
-- Name: tire_pressure_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tire_pressure_snapshots (
    id bigint NOT NULL,
    vehicle_id bigint,
    front_left double precision,
    front_right double precision,
    rear_left double precision,
    rear_right double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tpms_hard_warnings text,
    tpms_soft_warnings text,
    last_seen_time_fl timestamp with time zone,
    last_seen_time_fr timestamp with time zone,
    last_seen_time_rl timestamp with time zone,
    last_seen_time_rr timestamp with time zone
);


--
-- Name: tire_pressure_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tire_pressure_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tire_pressure_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tire_pressure_snapshots_id_seq OWNED BY public.tire_pressure_snapshots.id;


--
-- Name: tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tokens (
    id integer DEFAULT 1 NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tokens_id_check CHECK ((id = 1))
);


--
-- Name: trip_drives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trip_drives (
    trip_id bigint NOT NULL,
    drive_id bigint NOT NULL
);


--
-- Name: trips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trips (
    id bigint NOT NULL,
    vehicle_id bigint,
    name character varying(255),
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone,
    total_distance_km double precision DEFAULT 0,
    total_energy_kwh double precision DEFAULT 0,
    total_cost double precision DEFAULT 0,
    drive_count integer DEFAULT 0,
    charge_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trips_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trips_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trips_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trips_id_seq OWNED BY public.trips.id;


--
-- Name: user_preference_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_preference_snapshots (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    setting_24hr_time boolean,
    setting_charge_unit character varying(50),
    setting_distance_unit character varying(50),
    setting_temperature_unit character varying(50),
    setting_tire_pressure_unit character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_preference_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_preference_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_preference_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_preference_snapshots_id_seq OWNED BY public.user_preference_snapshots.id;


--
-- Name: v_charging_sessions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_charging_sessions AS
 SELECT id,
    vehicle_id,
    start_date,
    end_date,
    address_id,
    charge_energy_added,
    charge_energy_used,
    NULLIF(start_battery_level, 0) AS start_battery_level,
    NULLIF(end_battery_level, 0) AS end_battery_level,
    NULLIF(start_range_km, (0)::double precision) AS start_range_km,
    NULLIF(end_range_km, (0)::double precision) AS end_range_km,
    charger_phases,
    charger_voltage,
    charger_actual_current,
    charger_power,
    fast_charger_type,
    fast_charger_brand,
    conn_charge_cable,
    cost,
    duration_min,
    latitude,
    longitude,
    location_name,
    inside_temp_avg,
    outside_temp_avg
   FROM public.charging_sessions;


--
-- Name: v_drives; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_drives AS
 SELECT id,
    vehicle_id,
    start_date,
    end_date,
    start_position_id,
    end_position_id,
    start_address_id,
    end_address_id,
    distance,
    duration_min,
    NULLIF(start_range_km, (0)::double precision) AS start_range_km,
    NULLIF(end_range_km, (0)::double precision) AS end_range_km,
    speed_max,
    power_max,
    power_min,
    NULLIF(start_battery_level, 0) AS start_battery_level,
    NULLIF(end_battery_level, 0) AS end_battery_level,
    inside_temp_avg,
    outside_temp_avg,
    NULLIF(start_odometer, (0)::double precision) AS start_odometer,
    NULLIF(end_odometer, (0)::double precision) AS end_odometer,
    speed_avg,
    speed_min,
    NULLIF(start_rated_range_km, (0)::double precision) AS start_rated_range_km,
    NULLIF(end_rated_range_km, (0)::double precision) AS end_rated_range_km,
    rated_range_avg,
    rated_range_max,
    rated_range_min,
    NULLIF(start_ideal_range_km, (0)::double precision) AS start_ideal_range_km,
    NULLIF(end_ideal_range_km, (0)::double precision) AS end_ideal_range_km,
    ideal_range_avg,
    ideal_range_max,
    ideal_range_min,
    NULLIF(start_est_range_km, (0)::double precision) AS start_est_range_km,
    NULLIF(end_est_range_km, (0)::double precision) AS end_est_range_km,
    est_range_avg,
    est_range_max,
    est_range_min,
    NULLIF(soc_start, (0)::double precision) AS soc_start,
    NULLIF(soc_end, (0)::double precision) AS soc_end,
    soc_avg,
    soc_max,
    soc_min,
    NULLIF(usable_soc_start, (0)::double precision) AS usable_soc_start,
    NULLIF(usable_soc_end, (0)::double precision) AS usable_soc_end,
    usable_soc_avg,
    usable_soc_max,
    usable_soc_min,
    NULLIF(elevation_start, (0)::double precision) AS elevation_start,
    NULLIF(elevation_end, (0)::double precision) AS elevation_end,
    elevation_gain,
    elevation_loss,
    driver_temp_avg,
    passenger_temp_avg,
    battery_heater_on,
    start_address,
    end_address,
    start_latitude,
    start_longitude,
    end_latitude,
    end_longitude
   FROM public.drives;


--
-- Name: vampire_drain_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vampire_drain_events (
    id bigint NOT NULL,
    vehicle_id bigint,
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone,
    start_battery integer NOT NULL,
    end_battery integer,
    battery_lost integer DEFAULT 0,
    range_lost_km double precision DEFAULT 0,
    duration_hours double precision DEFAULT 0,
    drain_rate_pct_per_hour double precision DEFAULT 0,
    outside_temp_avg double precision,
    sentry_mode boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vampire_drain_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vampire_drain_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vampire_drain_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vampire_drain_events_id_seq OWNED BY public.vampire_drain_events.id;


--
-- Name: vehicle_config_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_config_snapshots (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    car_type character varying(50),
    "trim" character varying(50),
    exterior_color character varying(50),
    roof_color character varying(50),
    wheel_type character varying(50),
    rear_seat_heaters character varying(100),
    sunroof_installed character varying(100),
    efficiency_package character varying(100),
    europe_vehicle boolean,
    right_hand_drive boolean,
    remote_start_enabled boolean,
    charge_port character varying(50),
    offroad_lightbar_present boolean,
    version character varying(50),
    vehicle_name character varying(100),
    software_update_version character varying(50),
    software_update_download_pct integer,
    software_update_install_pct integer,
    software_update_expected_duration integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    software_update_scheduled_start text
);


--
-- Name: vehicle_config_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vehicle_config_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vehicle_config_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vehicle_config_snapshots_id_seq OWNED BY public.vehicle_config_snapshots.id;


--
-- Name: vehicle_guard_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_guard_config (
    vehicle_id bigint NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    home_geofence_id bigint,
    sensitivity text DEFAULT 'medium'::text NOT NULL,
    auto_panic boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vehicle_guard_config_sensitivity_check CHECK ((sensitivity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))
);


--
-- Name: vehicle_live_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_live_state (
    vehicle_id bigint NOT NULL,
    latitude double precision,
    longitude double precision,
    heading integer,
    gps_state text,
    speed double precision,
    power double precision,
    odometer double precision,
    gear character varying(50),
    pedal_position double precision,
    brake_pedal boolean,
    battery_level integer,
    soc double precision,
    ideal_range double precision,
    rated_range double precision,
    est_range double precision,
    energy_remaining double precision,
    inside_temp double precision,
    outside_temp double precision,
    hvac_power boolean,
    fan_speed integer,
    is_climate_on boolean,
    charge_state character varying(50),
    detailed_charge_state character varying(50),
    charger_voltage double precision,
    charge_amps double precision,
    charge_rate double precision,
    charger_power double precision,
    charge_limit_soc integer,
    time_to_full_charge double precision,
    charging_cable_type character varying(50),
    locked boolean,
    sentry_mode boolean,
    door_state text,
    fd_window character varying(50),
    fp_window character varying(50),
    rd_window character varying(50),
    rp_window character varying(50),
    center_display character varying(50),
    tire_pressure_fl double precision,
    tire_pressure_fr double precision,
    tire_pressure_rl double precision,
    tire_pressure_rr double precision,
    vehicle_name character varying(100),
    car_type character varying(50),
    version character varying(50),
    wheel_type character varying(50),
    exterior_color character varying(50),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    guest_mode boolean,
    guest_mode_mobile_access character varying(100),
    homelink_nearby boolean,
    homelink_device_count integer,
    driver_seat_occupied boolean,
    speed_limit_mode boolean,
    valet_mode_enabled boolean,
    service_mode boolean,
    current_limit_mph double precision,
    paired_phone_key_count integer,
    lights_hazards_active boolean,
    lights_high_beams boolean,
    lights_turn_signal character varying(50),
    sw_update_version character varying(100),
    sw_update_download_pct integer,
    sw_update_install_pct integer,
    sw_update_expected_duration integer,
    sw_update_scheduled_start character varying(100),
    "trim" character varying(100),
    roof_color character varying(50),
    efficiency_package character varying(100),
    rear_seat_heaters character varying(50),
    sunroof_installed character varying(50),
    europe_vehicle boolean,
    right_hand_drive boolean,
    remote_start_enabled boolean,
    offroad_lightbar_present boolean,
    last_gear character varying(50),
    last_speed_time timestamp with time zone,
    ac_charging_energy_in double precision,
    auto_seat_climate_left boolean,
    auto_seat_climate_right boolean,
    automatic_blind_spot_camera boolean,
    automatic_emergency_braking_off boolean,
    bms_state character varying(200),
    battery_heater_on boolean,
    blind_spot_collision_warning_chime boolean,
    bms_fullchargecomplete boolean,
    brake_pedal_pos double precision,
    brick_voltage_max double precision,
    brick_voltage_min double precision,
    cabin_overheat_protection_mode character varying(200),
    cabin_overheat_protection_temperature_limit character varying(200),
    charge_current_request integer,
    charge_current_request_max integer,
    charge_enable_request boolean,
    charge_port character varying(200),
    charge_port_cold_weather_mode boolean,
    charge_port_door_open boolean,
    charge_port_latch character varying(200),
    charger_phases integer,
    climate_keeper_mode character varying(200),
    climate_seat_cooling_front_left integer,
    climate_seat_cooling_front_right integer,
    cruise_follow_distance character varying(200),
    cruise_set_speed double precision,
    dc_charging_energy_in double precision,
    dcdc_enable boolean,
    defrost_for_preconditioning boolean,
    defrost_mode character varying(50),
    destination_name character varying(200),
    di_axle_speed_f double precision,
    di_axle_speed_r double precision,
    di_axle_speed_rel double precision,
    di_axle_speed_rer double precision,
    di_heatsink_tf double precision,
    di_heatsink_tr double precision,
    di_heatsink_trel double precision,
    di_heatsink_trer double precision,
    di_inverter_tf double precision,
    di_inverter_tr double precision,
    di_inverter_trel double precision,
    di_inverter_trer double precision,
    di_motor_current_f double precision,
    di_motor_current_r double precision,
    di_motor_current_rel double precision,
    di_motor_current_rer double precision,
    di_slave_torque_cmd double precision,
    di_state_f character varying(200),
    di_state_r character varying(200),
    di_state_rel character varying(200),
    di_state_rer character varying(200),
    di_stator_temp_f double precision,
    di_stator_temp_r double precision,
    di_stator_temp_rel double precision,
    di_stator_temp_rer double precision,
    di_torque_actual_f double precision,
    di_torque_actual_r double precision,
    di_torque_actual_rel double precision,
    di_torque_actual_rer double precision,
    di_torquemotor double precision,
    di_v_bat_f double precision,
    di_v_bat_r double precision,
    di_v_bat_rel double precision,
    di_v_bat_rer double precision,
    drive_rail boolean,
    driver_seat_belt boolean,
    emergency_lane_departure_avoidance boolean,
    estimated_hours_to_charge_termination double precision,
    expected_energy_percent_at_trip_arrival double precision,
    fast_charger_present boolean,
    fast_charger_type character varying(200),
    forward_collision_warning character varying(200),
    hvac_ac_enabled boolean,
    hvac_auto_mode character varying(200),
    hvac_fan_speed integer,
    hvac_fan_status integer,
    hvac_left_temperature_request double precision,
    hvac_right_temperature_request double precision,
    hvac_steering_wheel_heat_auto boolean,
    hvac_steering_wheel_heat_level integer,
    hvil character varying(200),
    isolation_resistance double precision,
    lane_departure_avoidance character varying(200),
    lateral_acceleration double precision,
    lifetime_energy_gained_regen double precision,
    lifetime_energy_used double precision,
    lifetime_energy_used_drive double precision,
    located_at_favorite boolean,
    located_at_home boolean,
    located_at_work boolean,
    longitudinal_acceleration double precision,
    media_audio_volume double precision,
    media_audio_volume_increment double precision,
    media_audio_volume_max double precision,
    media_now_playing_album character varying(200),
    media_now_playing_artist character varying(200),
    media_now_playing_duration double precision,
    media_now_playing_elapsed double precision,
    media_now_playing_station character varying(200),
    media_now_playing_title character varying(200),
    media_playback_source character varying(200),
    media_playback_status character varying(200),
    miles_since_reset double precision,
    miles_to_arrival double precision,
    minutes_to_arrival double precision,
    module_temp_max double precision,
    module_temp_min double precision,
    not_enough_power_to_heat boolean,
    num_brick_voltage_max integer,
    num_brick_voltage_min integer,
    num_module_temp_max integer,
    num_module_temp_min integer,
    pack_current double precision,
    pack_voltage double precision,
    passenger_seat_belt boolean,
    pin_to_drive_enabled boolean,
    powershare_hours_left double precision,
    powershare_instantaneous_power_kw double precision,
    powershare_status character varying(200),
    powershare_stop_reason character varying(200),
    powershare_type character varying(200),
    preconditioning_enabled boolean,
    rear_defrost_enabled boolean,
    rear_display_hvac_enabled boolean,
    route_last_updated character varying(200),
    route_line text,
    route_traffic_minutes_delay double precision,
    scheduled_charging_mode character varying(200),
    scheduled_charging_pending boolean,
    scheduled_charging_start_time character varying(200),
    scheduled_departure_time character varying(200),
    seat_heater_left integer,
    seat_heater_rear_center integer,
    seat_heater_rear_left integer,
    seat_heater_rear_right integer,
    seat_heater_right integer,
    seat_vent_enabled boolean,
    self_driving_miles_since_reset double precision,
    setting24_hour_time character varying(200),
    setting_charge_unit character varying(200),
    setting_distance_unit character varying(200),
    setting_temperature_unit character varying(200),
    setting_tire_pressure_unit character varying(200),
    speed_limit_warning character varying(200),
    supercharger_session_trip_planner character varying(200),
    tonneau_open_percent double precision,
    tonneau_position character varying(200),
    tonneau_tent_mode character varying(200),
    tpms_hard_warnings character varying(200),
    tpms_last_seen_pressure_time_fl timestamp with time zone,
    tpms_last_seen_pressure_time_fr timestamp with time zone,
    tpms_last_seen_pressure_time_rl timestamp with time zone,
    tpms_last_seen_pressure_time_rr timestamp with time zone,
    tpms_soft_warnings character varying(200),
    wiper_heat_enabled boolean
);


--
-- Name: vehicle_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_states (
    id bigint NOT NULL,
    vehicle_id bigint,
    state character varying(20) NOT NULL,
    start_date timestamp with time zone DEFAULT now() NOT NULL,
    end_date timestamp with time zone,
    duration_min double precision DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vehicle_states_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vehicle_states_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vehicle_states_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vehicle_states_id_seq OWNED BY public.vehicle_states.id;


--
-- Name: vehicle_units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_units (
    vehicle_id bigint NOT NULL,
    distance_unit character varying(20) DEFAULT 'mi'::character varying NOT NULL,
    speed_unit character varying(20) DEFAULT 'mph'::character varying NOT NULL,
    temp_unit character varying(20) DEFAULT 'C'::character varying NOT NULL,
    pressure_unit character varying(20) DEFAULT 'psi'::character varying NOT NULL,
    car_distance_pref character varying(50),
    car_temp_pref character varying(50),
    car_pressure_pref character varying(50),
    car_charge_pref character varying(50),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicles (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    vin character varying(17) NOT NULL,
    display_name character varying(255) DEFAULT ''::character varying NOT NULL,
    model character varying(50) DEFAULT ''::character varying NOT NULL,
    trim_badging character varying(50) DEFAULT ''::character varying NOT NULL,
    exterior_color character varying(50) DEFAULT ''::character varying NOT NULL,
    wheel_type character varying(50) DEFAULT ''::character varying NOT NULL,
    state character varying(20) DEFAULT 'offline'::character varying NOT NULL,
    healthy boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_gear_capable boolean DEFAULT false NOT NULL
);


--
-- Name: vehicles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vehicles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vehicles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vehicles_id_seq OWNED BY public.vehicles.id;


--
-- Name: visited_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visited_locations (
    id bigint NOT NULL,
    vehicle_id bigint,
    address_id bigint,
    visit_count integer DEFAULT 1,
    total_duration_min double precision DEFAULT 0,
    last_visited timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: visited_locations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visited_locations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visited_locations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visited_locations_id_seq OWNED BY public.visited_locations.id;


--
-- Name: positions_2026_04; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions ATTACH PARTITION public.positions_2026_04 FOR VALUES FROM ('2026-04-01 00:00:00+00') TO ('2026-05-01 00:00:00+00');


--
-- Name: positions_2026_05; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions ATTACH PARTITION public.positions_2026_05 FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-06-01 00:00:00+00');


--
-- Name: positions_default; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions ATTACH PARTITION public.positions_default DEFAULT;


--
-- Name: addresses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses ALTER COLUMN id SET DEFAULT nextval('public.addresses_id_seq'::regclass);


--
-- Name: alert_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_rules ALTER COLUMN id SET DEFAULT nextval('public.alert_rules_id_seq'::regclass);


--
-- Name: alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts ALTER COLUMN id SET DEFAULT nextval('public.alerts_id_seq'::regclass);


--
-- Name: api_call_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_call_logs ALTER COLUMN id SET DEFAULT nextval('public.api_call_logs_id_seq'::regclass);


--
-- Name: api_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys ALTER COLUMN id SET DEFAULT nextval('public.api_keys_id_seq'::regclass);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: automation_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_history ALTER COLUMN id SET DEFAULT nextval('public.automation_history_id_seq'::regclass);


--
-- Name: automation_variables id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_variables ALTER COLUMN id SET DEFAULT nextval('public.automation_variables_id_seq'::regclass);


--
-- Name: automations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations ALTER COLUMN id SET DEFAULT nextval('public.automations_id_seq'::regclass);


--
-- Name: backup_configs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_configs ALTER COLUMN id SET DEFAULT nextval('public.backup_configs_id_seq'::regclass);


--
-- Name: backup_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_runs ALTER COLUMN id SET DEFAULT nextval('public.backup_runs_id_seq'::regclass);


--
-- Name: battery_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.battery_snapshots ALTER COLUMN id SET DEFAULT nextval('public.battery_snapshots_id_seq'::regclass);


--
-- Name: charge_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_plans ALTER COLUMN id SET DEFAULT nextval('public.charge_plans_id_seq'::regclass);


--
-- Name: charge_telemetry_readings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_telemetry_readings ALTER COLUMN id SET DEFAULT nextval('public.charge_telemetry_readings_id_seq'::regclass);


--
-- Name: charging_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charging_sessions ALTER COLUMN id SET DEFAULT nextval('public.charging_sessions_id_seq'::regclass);


--
-- Name: charging_telemetry id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charging_telemetry ALTER COLUMN id SET DEFAULT nextval('public.charging_telemetry_id_seq'::regclass);


--
-- Name: chatbot_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chatbot_messages ALTER COLUMN id SET DEFAULT nextval('public.chatbot_messages_id_seq'::regclass);


--
-- Name: climate_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.climate_snapshots ALTER COLUMN id SET DEFAULT nextval('public.climate_snapshots_id_seq'::regclass);


--
-- Name: command_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_executions ALTER COLUMN id SET DEFAULT nextval('public.command_executions_id_seq'::regclass);


--
-- Name: command_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_logs ALTER COLUMN id SET DEFAULT nextval('public.command_logs_id_seq'::regclass);


--
-- Name: daily_mileage id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_mileage ALTER COLUMN id SET DEFAULT nextval('public.daily_mileage_id_seq'::regclass);


--
-- Name: drive_telemetry_readings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drive_telemetry_readings ALTER COLUMN id SET DEFAULT nextval('public.drive_telemetry_readings_id_seq'::regclass);


--
-- Name: drives id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drives ALTER COLUMN id SET DEFAULT nextval('public.drives_id_seq'::regclass);


--
-- Name: fleet_telemetry_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_telemetry_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.fleet_telemetry_subscriptions_id_seq'::regclass);


--
-- Name: fsm_transitions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fsm_transitions ALTER COLUMN id SET DEFAULT nextval('public.fsm_transitions_id_seq'::regclass);


--
-- Name: gas_price_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gas_price_history ALTER COLUMN id SET DEFAULT nextval('public.gas_price_history_id_seq'::regclass);


--
-- Name: geofence_electricity_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofence_electricity_rates ALTER COLUMN id SET DEFAULT nextval('public.geofence_electricity_rates_id_seq'::regclass);


--
-- Name: geofences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofences ALTER COLUMN id SET DEFAULT nextval('public.geofences_id_seq'::regclass);


--
-- Name: guard_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guard_events ALTER COLUMN id SET DEFAULT nextval('public.guard_events_id_seq'::regclass);


--
-- Name: location_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_snapshots ALTER COLUMN id SET DEFAULT nextval('public.location_snapshots_id_seq'::regclass);


--
-- Name: media_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_snapshots ALTER COLUMN id SET DEFAULT nextval('public.media_snapshots_id_seq'::regclass);


--
-- Name: motor_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.motor_snapshots ALTER COLUMN id SET DEFAULT nextval('public.motor_snapshots_id_seq'::regclass);


--
-- Name: notification_channels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_channels ALTER COLUMN id SET DEFAULT nextval('public.notification_channels_id_seq'::regclass);


--
-- Name: notification_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_logs ALTER COLUMN id SET DEFAULT nextval('public.notification_logs_id_seq'::regclass);


--
-- Name: notification_metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_metrics ALTER COLUMN id SET DEFAULT nextval('public.notification_metrics_id_seq'::regclass);


--
-- Name: notification_preferences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences ALTER COLUMN id SET DEFAULT nextval('public.notification_preferences_id_seq'::regclass);


--
-- Name: notification_schedules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_schedules ALTER COLUMN id SET DEFAULT nextval('public.notification_schedules_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: places_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.places_cache ALTER COLUMN id SET DEFAULT nextval('public.places_cache_id_seq'::regclass);


--
-- Name: positions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions ALTER COLUMN id SET DEFAULT nextval('public.positions_id_seq'::regclass);


--
-- Name: safety_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_snapshots ALTER COLUMN id SET DEFAULT nextval('public.safety_snapshots_id_seq'::regclass);


--
-- Name: security_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events ALTER COLUMN id SET DEFAULT nextval('public.security_events_id_seq'::regclass);


--
-- Name: share_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_tokens ALTER COLUMN id SET DEFAULT nextval('public.share_tokens_id_seq'::regclass);


--
-- Name: signal_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_history ALTER COLUMN id SET DEFAULT nextval('public.signal_history_id_seq'::regclass);


--
-- Name: software_updates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.software_updates ALTER COLUMN id SET DEFAULT nextval('public.software_updates_id_seq'::regclass);


--
-- Name: tesla_charging_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_charging_history ALTER COLUMN id SET DEFAULT nextval('public.tesla_charging_history_id_seq'::regclass);


--
-- Name: tesla_charging_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_charging_sessions ALTER COLUMN id SET DEFAULT nextval('public.tesla_charging_sessions_id_seq'::regclass);


--
-- Name: tesla_energy_backup_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_energy_backup_events ALTER COLUMN id SET DEFAULT nextval('public.tesla_energy_backup_events_id_seq'::regclass);


--
-- Name: tesla_energy_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_energy_history ALTER COLUMN id SET DEFAULT nextval('public.tesla_energy_history_id_seq'::regclass);


--
-- Name: tesla_energy_live_status id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_energy_live_status ALTER COLUMN id SET DEFAULT nextval('public.tesla_energy_live_status_id_seq'::regclass);


--
-- Name: tesla_energy_sites id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_energy_sites ALTER COLUMN id SET DEFAULT nextval('public.tesla_energy_sites_id_seq'::regclass);


--
-- Name: tesla_energy_wc_charging id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_energy_wc_charging ALTER COLUMN id SET DEFAULT nextval('public.tesla_energy_wc_charging_id_seq'::regclass);


--
-- Name: tesla_fleet_telemetry_error_vins id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_fleet_telemetry_error_vins ALTER COLUMN id SET DEFAULT nextval('public.tesla_fleet_telemetry_error_vins_id_seq'::regclass);


--
-- Name: tesla_fleet_telemetry_errors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_fleet_telemetry_errors ALTER COLUMN id SET DEFAULT nextval('public.tesla_fleet_telemetry_errors_id_seq'::regclass);


--
-- Name: tesla_user_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_user_config ALTER COLUMN id SET DEFAULT nextval('public.tesla_user_config_id_seq'::regclass);


--
-- Name: tesla_user_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_user_orders ALTER COLUMN id SET DEFAULT nextval('public.tesla_user_orders_id_seq'::regclass);


--
-- Name: tesla_user_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_user_profiles ALTER COLUMN id SET DEFAULT nextval('public.tesla_user_profiles_id_seq'::regclass);


--
-- Name: tesla_vehicle_drivers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_vehicle_drivers ALTER COLUMN id SET DEFAULT nextval('public.tesla_vehicle_drivers_id_seq'::regclass);


--
-- Name: tesla_vehicle_invitations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_vehicle_invitations ALTER COLUMN id SET DEFAULT nextval('public.tesla_vehicle_invitations_id_seq'::regclass);


--
-- Name: tire_pressure_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tire_pressure_snapshots ALTER COLUMN id SET DEFAULT nextval('public.tire_pressure_snapshots_id_seq'::regclass);


--
-- Name: trips id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips ALTER COLUMN id SET DEFAULT nextval('public.trips_id_seq'::regclass);


--
-- Name: user_preference_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preference_snapshots ALTER COLUMN id SET DEFAULT nextval('public.user_preference_snapshots_id_seq'::regclass);


--
-- Name: vampire_drain_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vampire_drain_events ALTER COLUMN id SET DEFAULT nextval('public.vampire_drain_events_id_seq'::regclass);


--
-- Name: vehicle_config_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_config_snapshots ALTER COLUMN id SET DEFAULT nextval('public.vehicle_config_snapshots_id_seq'::regclass);


--
-- Name: vehicle_states id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_states ALTER COLUMN id SET DEFAULT nextval('public.vehicle_states_id_seq'::regclass);


--
-- Name: vehicles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles ALTER COLUMN id SET DEFAULT nextval('public.vehicles_id_seq'::regclass);


--
-- Name: visited_locations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visited_locations ALTER COLUMN id SET DEFAULT nextval('public.visited_locations_id_seq'::regclass);


--
-- Name: addresses addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_pkey PRIMARY KEY (id);


--
-- Name: alert_cooldown_state alert_cooldown_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_cooldown_state
    ADD CONSTRAINT alert_cooldown_state_pkey PRIMARY KEY (alert_rule_id, vehicle_id);


--
-- Name: alert_rules alert_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_rules
    ADD CONSTRAINT alert_rules_pkey PRIMARY KEY (id);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);


--
-- Name: api_call_logs api_call_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_call_logs
    ADD CONSTRAINT api_call_logs_pkey PRIMARY KEY (id);


--
-- Name: api_keys api_keys_key_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: automation_history automation_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_history
    ADD CONSTRAINT automation_history_pkey PRIMARY KEY (id);


--
-- Name: automation_variables automation_variables_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_variables
    ADD CONSTRAINT automation_variables_key_key UNIQUE (key);


--
-- Name: automation_variables automation_variables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_variables
    ADD CONSTRAINT automation_variables_pkey PRIMARY KEY (id);


--
-- Name: automations automations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_pkey PRIMARY KEY (id);


--
-- Name: backup_configs backup_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_configs
    ADD CONSTRAINT backup_configs_pkey PRIMARY KEY (id);


--
-- Name: backup_runs backup_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_runs
    ADD CONSTRAINT backup_runs_pkey PRIMARY KEY (id);


--
-- Name: battery_snapshots battery_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.battery_snapshots
    ADD CONSTRAINT battery_snapshots_pkey PRIMARY KEY (id);


--
-- Name: charge_plans charge_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_plans
    ADD CONSTRAINT charge_plans_pkey PRIMARY KEY (id);


--
-- Name: charge_telemetry_readings charge_telemetry_readings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_telemetry_readings
    ADD CONSTRAINT charge_telemetry_readings_pkey PRIMARY KEY (id);


--
-- Name: charging_sessions charging_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charging_sessions
    ADD CONSTRAINT charging_sessions_pkey PRIMARY KEY (id);


--
-- Name: charging_telemetry charging_telemetry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charging_telemetry
    ADD CONSTRAINT charging_telemetry_pkey PRIMARY KEY (id);


--
-- Name: chatbot_messages chatbot_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chatbot_messages
    ADD CONSTRAINT chatbot_messages_pkey PRIMARY KEY (id);


--
-- Name: climate_snapshots climate_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.climate_snapshots
    ADD CONSTRAINT climate_snapshots_pkey PRIMARY KEY (id);


--
-- Name: command_executions command_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_executions
    ADD CONSTRAINT command_executions_pkey PRIMARY KEY (id);


--
-- Name: command_logs command_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_logs
    ADD CONSTRAINT command_logs_pkey PRIMARY KEY (id);


--
-- Name: daily_mileage daily_mileage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_mileage
    ADD CONSTRAINT daily_mileage_pkey PRIMARY KEY (id);


--
-- Name: daily_mileage daily_mileage_vehicle_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_mileage
    ADD CONSTRAINT daily_mileage_vehicle_id_date_key UNIQUE (vehicle_id, date);


--
-- Name: drive_telemetry_readings drive_telemetry_readings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drive_telemetry_readings
    ADD CONSTRAINT drive_telemetry_readings_pkey PRIMARY KEY (id);


--
-- Name: drives drives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drives
    ADD CONSTRAINT drives_pkey PRIMARY KEY (id);


--
-- Name: export_jobs export_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_jobs
    ADD CONSTRAINT export_jobs_pkey PRIMARY KEY (id);


--
-- Name: fleet_telemetry_subscriptions fleet_telemetry_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_telemetry_subscriptions
    ADD CONSTRAINT fleet_telemetry_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: fsm_transitions fsm_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fsm_transitions
    ADD CONSTRAINT fsm_transitions_pkey PRIMARY KEY (id);


--
-- Name: gas_price_history gas_price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gas_price_history
    ADD CONSTRAINT gas_price_history_pkey PRIMARY KEY (id);


--
-- Name: gas_price_poll_state gas_price_poll_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gas_price_poll_state
    ADD CONSTRAINT gas_price_poll_state_pkey PRIMARY KEY (id);


--
-- Name: geofence_electricity_rates geofence_electricity_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofence_electricity_rates
    ADD CONSTRAINT geofence_electricity_rates_pkey PRIMARY KEY (id);


--
-- Name: geofences geofences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofences
    ADD CONSTRAINT geofences_pkey PRIMARY KEY (id);


--
-- Name: guard_events guard_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guard_events
    ADD CONSTRAINT guard_events_pkey PRIMARY KEY (id);


--
-- Name: location_snapshots location_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_snapshots
    ADD CONSTRAINT location_snapshots_pkey PRIMARY KEY (id);


--
-- Name: media_snapshots media_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_snapshots
    ADD CONSTRAINT media_snapshots_pkey PRIMARY KEY (id);


--
-- Name: motor_snapshots motor_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.motor_snapshots
    ADD CONSTRAINT motor_snapshots_pkey PRIMARY KEY (id);


--
-- Name: notification_channels notification_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_channels
    ADD CONSTRAINT notification_channels_pkey PRIMARY KEY (id);


--
-- Name: notification_logs notification_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_pkey PRIMARY KEY (id);


--
-- Name: notification_metrics notification_metrics_channel_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_metrics
    ADD CONSTRAINT notification_metrics_channel_id_date_key UNIQUE (channel_id, date);


--
-- Name: notification_metrics notification_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_metrics
    ADD CONSTRAINT notification_metrics_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_channel_id_event_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_channel_id_event_type_key UNIQUE (channel_id, event_type);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);


--
-- Name: notification_schedules notification_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_schedules
    ADD CONSTRAINT notification_schedules_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: places_cache places_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.places_cache
    ADD CONSTRAINT places_cache_pkey PRIMARY KEY (id);


--
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (id, created_at);


--
-- Name: positions_2026_04 positions_2026_04_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions_2026_04
    ADD CONSTRAINT positions_2026_04_pkey PRIMARY KEY (id, created_at);


--
-- Name: positions_2026_05 positions_2026_05_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions_2026_05
    ADD CONSTRAINT positions_2026_05_pkey PRIMARY KEY (id, created_at);


--
-- Name: positions_default positions_default_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions_default
    ADD CONSTRAINT positions_default_pkey PRIMARY KEY (id, created_at);


--
-- Name: safety_snapshots safety_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_snapshots
    ADD CONSTRAINT safety_snapshots_pkey PRIMARY KEY (id);


--


--
-- Name: security_events security_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: share_tokens share_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_tokens
    ADD CONSTRAINT share_tokens_pkey PRIMARY KEY (id);


--
-- Name: share_tokens share_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_tokens
    ADD CONSTRAINT share_tokens_token_key UNIQUE (token);


--
-- Name: signal_history signal_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_history
    ADD CONSTRAINT signal_history_pkey PRIMARY KEY (id);


--
-- Name: software_updates software_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.software_updates
    ADD CONSTRAINT software_updates_pkey PRIMARY KEY (id);


--
-- Name: tesla_charging_history tesla_charging_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_charging_history
    ADD CONSTRAINT tesla_charging_history_pkey PRIMARY KEY (id);


--
-- Name: tesla_charging_history tesla_charging_history_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_charging_history
    ADD CONSTRAINT tesla_charging_history_session_id_key UNIQUE (session_id);


--
-- Name: tesla_charging_sessions tesla_charging_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_charging_sessions
    ADD CONSTRAINT tesla_charging_sessions_pkey PRIMARY KEY (id);


--
-- Name: tesla_charging_sessions tesla_charging_sessions_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_charging_sessions
    ADD CONSTRAINT tesla_charging_sessions_session_id_key UNIQUE (session_id);


--
-- Name: tesla_energy_backup_events tesla_energy_backup_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_energy_backup_events
    ADD CONSTRAINT tesla_energy_backup_events_pkey PRIMARY KEY (id);


--
-- Name: tesla_energy_history tesla_energy_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_energy_history
    ADD CONSTRAINT tesla_energy_history_pkey PRIMARY KEY (id);


--
-- Name: tesla_energy_live_status tesla_energy_live_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_energy_live_status
    ADD CONSTRAINT tesla_energy_live_status_pkey PRIMARY KEY (id);


--
-- Name: tesla_energy_sites tesla_energy_sites_energy_site_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_energy_sites
    ADD CONSTRAINT tesla_energy_sites_energy_site_id_key UNIQUE (energy_site_id);


--
-- Name: tesla_energy_sites tesla_energy_sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_energy_sites
    ADD CONSTRAINT tesla_energy_sites_pkey PRIMARY KEY (id);


--
-- Name: tesla_energy_wc_charging tesla_energy_wc_charging_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_energy_wc_charging
    ADD CONSTRAINT tesla_energy_wc_charging_pkey PRIMARY KEY (id);


--
-- Name: tesla_fleet_telemetry_error_vins tesla_fleet_telemetry_error_vins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_fleet_telemetry_error_vins
    ADD CONSTRAINT tesla_fleet_telemetry_error_vins_pkey PRIMARY KEY (id);


--
-- Name: tesla_fleet_telemetry_error_vins tesla_fleet_telemetry_error_vins_vin_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_fleet_telemetry_error_vins
    ADD CONSTRAINT tesla_fleet_telemetry_error_vins_vin_key UNIQUE (vin);


--
-- Name: tesla_fleet_telemetry_errors tesla_fleet_telemetry_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_fleet_telemetry_errors
    ADD CONSTRAINT tesla_fleet_telemetry_errors_pkey PRIMARY KEY (id);


--
-- Name: tesla_fleet_telemetry_errors tesla_fleet_telemetry_errors_vin_error_code_reported_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_fleet_telemetry_errors
    ADD CONSTRAINT tesla_fleet_telemetry_errors_vin_error_code_reported_at_key UNIQUE (vin, error_code, reported_at);


--
-- Name: tesla_public_key tesla_public_key_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_public_key
    ADD CONSTRAINT tesla_public_key_pkey PRIMARY KEY (id);


--
-- Name: tesla_user_config tesla_user_config_config_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_user_config
    ADD CONSTRAINT tesla_user_config_config_type_key UNIQUE (config_type);


--
-- Name: tesla_user_config tesla_user_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_user_config
    ADD CONSTRAINT tesla_user_config_pkey PRIMARY KEY (id);


--
-- Name: tesla_user_orders tesla_user_orders_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_user_orders
    ADD CONSTRAINT tesla_user_orders_order_id_key UNIQUE (order_id);


--
-- Name: tesla_user_orders tesla_user_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_user_orders
    ADD CONSTRAINT tesla_user_orders_pkey PRIMARY KEY (id);


--
-- Name: tesla_user_profiles tesla_user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_user_profiles
    ADD CONSTRAINT tesla_user_profiles_pkey PRIMARY KEY (id);


--
-- Name: tesla_vehicle_drivers tesla_vehicle_drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_vehicle_drivers
    ADD CONSTRAINT tesla_vehicle_drivers_pkey PRIMARY KEY (id);


--
-- Name: tesla_vehicle_invitations tesla_vehicle_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_vehicle_invitations
    ADD CONSTRAINT tesla_vehicle_invitations_pkey PRIMARY KEY (id);


--
-- Name: tesla_vehicle_invitations tesla_vehicle_invitations_vehicle_id_invitation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_vehicle_invitations
    ADD CONSTRAINT tesla_vehicle_invitations_vehicle_id_invitation_id_key UNIQUE (vehicle_id, invitation_id);


--
-- Name: tire_pressure_snapshots tire_pressure_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tire_pressure_snapshots
    ADD CONSTRAINT tire_pressure_snapshots_pkey PRIMARY KEY (id);


--
-- Name: tokens tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_pkey PRIMARY KEY (id);


--
-- Name: trip_drives trip_drives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_drives
    ADD CONSTRAINT trip_drives_pkey PRIMARY KEY (trip_id, drive_id);


--
-- Name: trips trips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_pkey PRIMARY KEY (id);


--
-- Name: user_preference_snapshots user_preference_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preference_snapshots
    ADD CONSTRAINT user_preference_snapshots_pkey PRIMARY KEY (id);


--
-- Name: vampire_drain_events vampire_drain_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vampire_drain_events
    ADD CONSTRAINT vampire_drain_events_pkey PRIMARY KEY (id);


--
-- Name: vehicle_config_snapshots vehicle_config_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_config_snapshots
    ADD CONSTRAINT vehicle_config_snapshots_pkey PRIMARY KEY (id);


--
-- Name: vehicle_guard_config vehicle_guard_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_guard_config
    ADD CONSTRAINT vehicle_guard_config_pkey PRIMARY KEY (vehicle_id);


--
-- Name: vehicle_live_state vehicle_live_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_live_state
    ADD CONSTRAINT vehicle_live_state_pkey PRIMARY KEY (vehicle_id);


--
-- Name: vehicle_states vehicle_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_states
    ADD CONSTRAINT vehicle_states_pkey PRIMARY KEY (id);


--
-- Name: vehicle_units vehicle_units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_units
    ADD CONSTRAINT vehicle_units_pkey PRIMARY KEY (vehicle_id);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- Name: vehicles vehicles_vehicle_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_vehicle_id_key UNIQUE (vehicle_id);


--
-- Name: vehicles vehicles_vin_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_vin_key UNIQUE (vin);


--
-- Name: visited_locations visited_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visited_locations
    ADD CONSTRAINT visited_locations_pkey PRIMARY KEY (id);


--
-- Name: visited_locations visited_locations_vehicle_id_address_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visited_locations
    ADD CONSTRAINT visited_locations_vehicle_id_address_id_key UNIQUE (vehicle_id, address_id);


--
-- Name: idx_addresses_coords; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_addresses_coords ON public.addresses USING btree (latitude, longitude);


--
-- Name: idx_alert_rules_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alert_rules_enabled ON public.alert_rules USING btree (enabled) WHERE (enabled = true);


--
-- Name: idx_alerts_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_unread ON public.alerts USING btree (is_read, created_at DESC);


--
-- Name: idx_alerts_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_vehicle ON public.alerts USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_api_call_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_call_logs_created_at ON public.api_call_logs USING btree (created_at DESC);


--
-- Name: idx_api_call_logs_method; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_call_logs_method ON public.api_call_logs USING btree (method);


--
-- Name: idx_api_call_logs_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_call_logs_source ON public.api_call_logs USING btree (source);


--
-- Name: idx_api_call_logs_status_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_call_logs_status_code ON public.api_call_logs USING btree (status_code);


--
-- Name: idx_api_keys_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_keys_created_at ON public.api_keys USING btree (created_at DESC);


--
-- Name: idx_api_keys_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_keys_hash ON public.api_keys USING btree (key_hash);


--
-- Name: idx_audit_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_automation_history_automation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_history_automation ON public.automation_history USING btree (automation_id, triggered_at DESC);


--
-- Name: idx_automation_history_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_history_status ON public.automation_history USING btree (status);


--
-- Name: idx_automation_history_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_history_time ON public.automation_history USING btree (triggered_at DESC);


--
-- Name: idx_automations_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automations_enabled ON public.automations USING btree (enabled) WHERE (enabled = true);


--
-- Name: idx_automations_trigger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automations_trigger ON public.automations USING btree (trigger_type);


--
-- Name: idx_automations_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automations_vehicle ON public.automations USING btree (vehicle_id);


--
-- Name: idx_backup_configs_next_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backup_configs_next_run ON public.backup_configs USING btree (next_run_at) WHERE (enabled = true);


--
-- Name: idx_backup_runs_config_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backup_runs_config_id ON public.backup_runs USING btree (config_id);


--
-- Name: idx_backup_runs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backup_runs_created_at ON public.backup_runs USING btree (created_at DESC);


--
-- Name: idx_backup_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backup_runs_status ON public.backup_runs USING btree (status);


--
-- Name: idx_battery_snapshots_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_battery_snapshots_vehicle ON public.battery_snapshots USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_charge_plans_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_charge_plans_created ON public.charge_plans USING btree (created_at DESC);


--
-- Name: idx_charge_plans_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_charge_plans_status ON public.charge_plans USING btree (status);


--
-- Name: idx_charge_plans_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_charge_plans_vehicle ON public.charge_plans USING btree (vehicle_id);


--
-- Name: idx_charge_telemetry_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_charge_telemetry_session_id ON public.charge_telemetry_readings USING btree (session_id);


--
-- Name: idx_charge_telemetry_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_charge_telemetry_vehicle_time ON public.charge_telemetry_readings USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_charging_telemetry_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_charging_telemetry_vehicle_time ON public.charging_telemetry USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_charging_vehicle_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_charging_vehicle_start ON public.charging_sessions USING btree (vehicle_id, start_date DESC);


--
-- Name: idx_chatbot_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chatbot_session ON public.chatbot_messages USING btree (session_id, created_at);


--
-- Name: idx_climate_snapshots_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_climate_snapshots_vehicle_time ON public.climate_snapshots USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_cmd_exec_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cmd_exec_state ON public.command_executions USING btree (state) WHERE ((state)::text <> ALL ((ARRAY['succeeded'::character varying, 'gave_up'::character varying])::text[]));


--
-- Name: idx_cmd_exec_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cmd_exec_vehicle ON public.command_executions USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_command_logs_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_command_logs_vehicle ON public.command_logs USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_daily_mileage_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_mileage_vehicle ON public.daily_mileage USING btree (vehicle_id, date DESC);


--
-- Name: idx_drive_telemetry_drive_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drive_telemetry_drive_id ON public.drive_telemetry_readings USING btree (drive_id);


--
-- Name: idx_drive_telemetry_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drive_telemetry_vehicle_time ON public.drive_telemetry_readings USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_drives_vehicle_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drives_vehicle_start ON public.drives USING btree (vehicle_id, start_date DESC);


--
-- Name: idx_energy_backup_site; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_energy_backup_site ON public.tesla_energy_backup_events USING btree (energy_site_id, "timestamp" DESC);


--
-- Name: idx_energy_backup_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_energy_backup_unique ON public.tesla_energy_backup_events USING btree (energy_site_id, period, "timestamp");


--
-- Name: idx_energy_history_site; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_energy_history_site ON public.tesla_energy_history USING btree (energy_site_id, period, "timestamp" DESC);


--
-- Name: idx_energy_history_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_energy_history_unique ON public.tesla_energy_history USING btree (energy_site_id, period, "timestamp");


--
-- Name: idx_energy_live_status_site; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_energy_live_status_site ON public.tesla_energy_live_status USING btree (energy_site_id, "timestamp" DESC);


--
-- Name: idx_energy_wc_charging_site; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_energy_wc_charging_site ON public.tesla_energy_wc_charging USING btree (energy_site_id, "timestamp" DESC);


--
-- Name: idx_energy_wc_charging_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_energy_wc_charging_unique ON public.tesla_energy_wc_charging USING btree (energy_site_id, COALESCE(din, ''::text), "timestamp");


--
-- Name: idx_export_jobs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_export_jobs_created_at ON public.export_jobs USING btree (created_at DESC);


--
-- Name: idx_export_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_export_jobs_status ON public.export_jobs USING btree (status);


--
-- Name: idx_fleet_sub_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_sub_vehicle ON public.fleet_telemetry_subscriptions USING btree (vehicle_id);


--
-- Name: idx_fleet_sub_vin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_sub_vin ON public.fleet_telemetry_subscriptions USING btree (vin);


--
-- Name: idx_fleet_telemetry_error_vins_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_telemetry_error_vins_active ON public.tesla_fleet_telemetry_error_vins USING btree (active) WHERE (active = true);


--
-- Name: idx_fleet_telemetry_errors_fetched; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_telemetry_errors_fetched ON public.tesla_fleet_telemetry_errors USING btree (fetched_at DESC);


--
-- Name: idx_fleet_telemetry_errors_vin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_telemetry_errors_vin ON public.tesla_fleet_telemetry_errors USING btree (vin, fetched_at DESC);


--
-- Name: idx_fsm_trans_instance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fsm_trans_instance ON public.fsm_transitions USING btree (fsm_type, fsm_instance_id) WHERE (fsm_instance_id IS NOT NULL);


--
-- Name: idx_fsm_trans_trigger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fsm_trans_trigger ON public.fsm_transitions USING btree (trigger);


--
-- Name: idx_fsm_trans_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fsm_trans_type ON public.fsm_transitions USING btree (fsm_type, created_at DESC);


--
-- Name: idx_fsm_trans_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fsm_trans_vehicle_time ON public.fsm_transitions USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_gas_price_history_effective; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gas_price_history_effective ON public.gas_price_history USING btree (effective_from, effective_to);


--
-- Name: idx_geofence_rates_effective; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_geofence_rates_effective ON public.geofence_electricity_rates USING btree (geofence_id, effective_from, effective_to);


--
-- Name: idx_geofence_rates_geofence_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_geofence_rates_geofence_id ON public.geofence_electricity_rates USING btree (geofence_id);


--
-- Name: idx_geofences_coords; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_geofences_coords ON public.geofences USING btree (latitude, longitude);


--
-- Name: idx_guard_events_vehicle_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guard_events_vehicle_created ON public.guard_events USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_location_snapshots_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_location_snapshots_vehicle_time ON public.location_snapshots USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_media_snapshots_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_snapshots_vehicle_time ON public.media_snapshots USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_motor_snapshots_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_motor_snapshots_vehicle_time ON public.motor_snapshots USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_mv_energy_daily_vehicle_day; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_energy_daily_vehicle_day ON public.mv_energy_daily USING btree (vehicle_id, day);


--
-- Name: idx_mv_position_hourly_vehicle_hour; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_position_hourly_vehicle_hour ON public.mv_position_hourly USING btree (vehicle_id, hour);


--
-- Name: idx_mv_signal_stats_vehicle_signal_hour; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_signal_stats_vehicle_signal_hour ON public.mv_signal_stats USING btree (vehicle_id, signal, hour);


--
-- Name: idx_notification_logs_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_logs_channel ON public.notification_logs USING btree (channel_id);


--
-- Name: idx_notification_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_logs_created ON public.notification_logs USING btree (created_at DESC);


--
-- Name: idx_notification_logs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_logs_status ON public.notification_logs USING btree (status);


--
-- Name: idx_notification_metrics_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_metrics_date ON public.notification_metrics USING btree (date DESC);


--
-- Name: idx_notification_prefs_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_prefs_event ON public.notification_preferences USING btree (event_type);


--
-- Name: idx_notification_schedules_next; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_schedules_next ON public.notification_schedules USING btree (next_run_at) WHERE (enabled = true);


--
-- Name: idx_notifications_retry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_retry ON public.notifications USING btree (next_retry_at) WHERE ((state)::text = 'failed'::text);


--
-- Name: idx_notifications_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_state ON public.notifications USING btree (state) WHERE ((state)::text <> ALL ((ARRAY['delivered'::character varying, 'dead'::character varying])::text[]));


--
-- Name: idx_notifications_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_vehicle ON public.notifications USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_places_cache_coords; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_places_cache_coords ON public.places_cache USING btree (latitude, longitude);


--
-- Name: idx_places_cache_hits; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_places_cache_hits ON public.places_cache USING btree (hit_count DESC);


--
-- Name: idx_positions_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_positions_vehicle_time ON ONLY public.positions USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_safety_snapshots_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_safety_snapshots_vehicle_time ON public.safety_snapshots USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_security_events_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_events_vehicle_time ON public.security_events USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_share_tokens_drive; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_share_tokens_drive ON public.share_tokens USING btree (drive_id);


--
-- Name: idx_share_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_share_tokens_token ON public.share_tokens USING btree (token);


--
-- Name: idx_signal_history_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signal_history_created ON public.signal_history USING btree (created_at);


--
-- Name: idx_signal_history_vehicle_signal_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signal_history_vehicle_signal_time ON public.signal_history USING btree (vehicle_id, signal, created_at DESC);


--
-- Name: idx_software_updates_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_software_updates_vehicle ON public.software_updates USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_tesla_charging_history_vin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tesla_charging_history_vin ON public.tesla_charging_history USING btree (vin, charge_start_datetime DESC);


--
-- Name: idx_tesla_charging_sessions_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tesla_charging_sessions_session ON public.tesla_charging_sessions USING btree (session_id);


--
-- Name: idx_tesla_charging_sessions_vin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tesla_charging_sessions_vin ON public.tesla_charging_sessions USING btree (vin, charge_start_datetime DESC);


--
-- Name: idx_tesla_energy_sites_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tesla_energy_sites_site_id ON public.tesla_energy_sites USING btree (energy_site_id);


--
-- Name: idx_tesla_user_orders_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tesla_user_orders_order_id ON public.tesla_user_orders USING btree (order_id);


--
-- Name: idx_tire_pressure_snapshots_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tire_pressure_snapshots_vehicle_time ON public.tire_pressure_snapshots USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_trips_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trips_vehicle ON public.trips USING btree (vehicle_id, start_date DESC);


--
-- Name: idx_user_pref_snapshots_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_pref_snapshots_vehicle_time ON public.user_preference_snapshots USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_vampire_drain_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vampire_drain_vehicle ON public.vampire_drain_events USING btree (vehicle_id, start_date DESC);


--
-- Name: idx_vehicle_config_snapshots_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_config_snapshots_vehicle_time ON public.vehicle_config_snapshots USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_vehicle_drivers_vid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_drivers_vid ON public.tesla_vehicle_drivers USING btree (vehicle_id);


--
-- Name: idx_vehicle_invitations_vid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_invitations_vid ON public.tesla_vehicle_invitations USING btree (vehicle_id);


--
-- Name: idx_vehicle_states_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_states_vehicle ON public.vehicle_states USING btree (vehicle_id, start_date DESC);


--
-- Name: positions_2026_04_vehicle_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX positions_2026_04_vehicle_id_created_at_idx ON public.positions_2026_04 USING btree (vehicle_id, created_at DESC);


--
-- Name: positions_2026_05_vehicle_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX positions_2026_05_vehicle_id_created_at_idx ON public.positions_2026_05 USING btree (vehicle_id, created_at DESC);


--
-- Name: positions_default_vehicle_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX positions_default_vehicle_id_created_at_idx ON public.positions_default USING btree (vehicle_id, created_at DESC);


--
-- Name: positions_2026_04_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.positions_pkey ATTACH PARTITION public.positions_2026_04_pkey;


--
-- Name: positions_2026_04_vehicle_id_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_positions_vehicle_time ATTACH PARTITION public.positions_2026_04_vehicle_id_created_at_idx;


--
-- Name: positions_2026_05_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.positions_pkey ATTACH PARTITION public.positions_2026_05_pkey;


--
-- Name: positions_2026_05_vehicle_id_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_positions_vehicle_time ATTACH PARTITION public.positions_2026_05_vehicle_id_created_at_idx;


--
-- Name: positions_default_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.positions_pkey ATTACH PARTITION public.positions_default_pkey;


--
-- Name: positions_default_vehicle_id_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_positions_vehicle_time ATTACH PARTITION public.positions_default_vehicle_id_created_at_idx;


--
-- Name: alert_cooldown_state alert_cooldown_state_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_cooldown_state
    ADD CONSTRAINT alert_cooldown_state_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: alert_rules alert_rules_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_rules
    ADD CONSTRAINT alert_rules_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: alerts alerts_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: automation_history automation_history_automation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_history
    ADD CONSTRAINT automation_history_automation_id_fkey FOREIGN KEY (automation_id) REFERENCES public.automations(id) ON DELETE CASCADE;


--
-- Name: automations automations_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: backup_runs backup_runs_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_runs
    ADD CONSTRAINT backup_runs_config_id_fkey FOREIGN KEY (config_id) REFERENCES public.backup_configs(id) ON DELETE SET NULL;


--
-- Name: battery_snapshots battery_snapshots_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.battery_snapshots
    ADD CONSTRAINT battery_snapshots_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: charge_plans charge_plans_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_plans
    ADD CONSTRAINT charge_plans_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: charge_telemetry_readings charge_telemetry_readings_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_telemetry_readings
    ADD CONSTRAINT charge_telemetry_readings_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.charging_sessions(id) ON DELETE CASCADE;


--
-- Name: charge_telemetry_readings charge_telemetry_readings_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_telemetry_readings
    ADD CONSTRAINT charge_telemetry_readings_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: charging_sessions charging_sessions_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charging_sessions
    ADD CONSTRAINT charging_sessions_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: charging_telemetry charging_telemetry_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charging_telemetry
    ADD CONSTRAINT charging_telemetry_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: climate_snapshots climate_snapshots_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.climate_snapshots
    ADD CONSTRAINT climate_snapshots_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: command_executions command_executions_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_executions
    ADD CONSTRAINT command_executions_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: command_logs command_logs_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_logs
    ADD CONSTRAINT command_logs_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: daily_mileage daily_mileage_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_mileage
    ADD CONSTRAINT daily_mileage_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: drive_telemetry_readings drive_telemetry_readings_drive_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drive_telemetry_readings
    ADD CONSTRAINT drive_telemetry_readings_drive_id_fkey FOREIGN KEY (drive_id) REFERENCES public.drives(id) ON DELETE CASCADE;


--
-- Name: drive_telemetry_readings drive_telemetry_readings_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drive_telemetry_readings
    ADD CONSTRAINT drive_telemetry_readings_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: drives drives_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drives
    ADD CONSTRAINT drives_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: fleet_telemetry_subscriptions fleet_telemetry_subscriptions_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_telemetry_subscriptions
    ADD CONSTRAINT fleet_telemetry_subscriptions_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: fsm_transitions fsm_transitions_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fsm_transitions
    ADD CONSTRAINT fsm_transitions_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: geofence_electricity_rates geofence_electricity_rates_geofence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofence_electricity_rates
    ADD CONSTRAINT geofence_electricity_rates_geofence_id_fkey FOREIGN KEY (geofence_id) REFERENCES public.geofences(id) ON DELETE CASCADE;


--
-- Name: guard_events guard_events_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guard_events
    ADD CONSTRAINT guard_events_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: location_snapshots location_snapshots_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_snapshots
    ADD CONSTRAINT location_snapshots_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: media_snapshots media_snapshots_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_snapshots
    ADD CONSTRAINT media_snapshots_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: motor_snapshots motor_snapshots_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.motor_snapshots
    ADD CONSTRAINT motor_snapshots_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: notification_logs notification_logs_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_alert_id_fkey FOREIGN KEY (alert_id) REFERENCES public.alerts(id) ON DELETE SET NULL;


--
-- Name: notification_logs notification_logs_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.notification_channels(id) ON DELETE CASCADE;


--
-- Name: notification_metrics notification_metrics_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_metrics
    ADD CONSTRAINT notification_metrics_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.notification_channels(id) ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.notification_channels(id) ON DELETE CASCADE;


--
-- Name: notification_schedules notification_schedules_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_schedules
    ADD CONSTRAINT notification_schedules_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.notification_channels(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: positions positions_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.positions
    ADD CONSTRAINT positions_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: safety_snapshots safety_snapshots_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_snapshots
    ADD CONSTRAINT safety_snapshots_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: security_events security_events_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: share_tokens share_tokens_drive_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_tokens
    ADD CONSTRAINT share_tokens_drive_id_fkey FOREIGN KEY (drive_id) REFERENCES public.drives(id) ON DELETE CASCADE;


--
-- Name: signal_history signal_history_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_history
    ADD CONSTRAINT signal_history_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: software_updates software_updates_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.software_updates
    ADD CONSTRAINT software_updates_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: tesla_vehicle_drivers tesla_vehicle_drivers_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_vehicle_drivers
    ADD CONSTRAINT tesla_vehicle_drivers_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: tesla_vehicle_invitations tesla_vehicle_invitations_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesla_vehicle_invitations
    ADD CONSTRAINT tesla_vehicle_invitations_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: tire_pressure_snapshots tire_pressure_snapshots_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tire_pressure_snapshots
    ADD CONSTRAINT tire_pressure_snapshots_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: trip_drives trip_drives_drive_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_drives
    ADD CONSTRAINT trip_drives_drive_id_fkey FOREIGN KEY (drive_id) REFERENCES public.drives(id) ON DELETE CASCADE;


--
-- Name: trip_drives trip_drives_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_drives
    ADD CONSTRAINT trip_drives_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;


--
-- Name: trips trips_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: user_preference_snapshots user_preference_snapshots_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preference_snapshots
    ADD CONSTRAINT user_preference_snapshots_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vampire_drain_events vampire_drain_events_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vampire_drain_events
    ADD CONSTRAINT vampire_drain_events_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vehicle_config_snapshots vehicle_config_snapshots_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_config_snapshots
    ADD CONSTRAINT vehicle_config_snapshots_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vehicle_guard_config vehicle_guard_config_home_geofence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_guard_config
    ADD CONSTRAINT vehicle_guard_config_home_geofence_id_fkey FOREIGN KEY (home_geofence_id) REFERENCES public.geofences(id) ON DELETE SET NULL;


--
-- Name: vehicle_guard_config vehicle_guard_config_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_guard_config
    ADD CONSTRAINT vehicle_guard_config_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vehicle_live_state vehicle_live_state_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_live_state
    ADD CONSTRAINT vehicle_live_state_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: vehicle_states vehicle_states_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_states
    ADD CONSTRAINT vehicle_states_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vehicle_units vehicle_units_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_units
    ADD CONSTRAINT vehicle_units_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: visited_locations visited_locations_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visited_locations
    ADD CONSTRAINT visited_locations_address_id_fkey FOREIGN KEY (address_id) REFERENCES public.addresses(id);


--
-- Name: visited_locations visited_locations_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visited_locations
    ADD CONSTRAINT visited_locations_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
--



