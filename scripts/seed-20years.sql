-- TeslaSync 20-Year Seed Data
-- Vehicle: Model Y Long Range, owned since 2006 (simulated historical Tesla)

-- Vehicle
INSERT INTO vehicles (vehicle_id, vin, display_name, model, trim_badging, exterior_color, wheel_type, state, healthy, created_at, updated_at)
VALUES (1492931520, '5YJ3E1EA1PF123456', 'Falcon', 'Model Y', 'Long Range AWD', 'Pearl White', '19in Gemini', 'online', true, '2006-01-15'::timestamptz, NOW());

-- Addresses
INSERT INTO addresses (display_name, road, city, state, country, latitude, longitude) VALUES
('Home', '1234 Oak Street', 'San Jose', 'CA', 'US', 37.3382, -121.8863),
('Office', '1 Hacker Way', 'Menlo Park', 'CA', 'US', 37.4849, -122.1483),
('Supercharger MV', 'N Shoreline Blvd', 'Mountain View', 'CA', 'US', 37.3861, -122.0839),
('Gym', '500 El Camino Real', 'Santa Clara', 'CA', 'US', 37.3541, -121.9552),
('Costco', '1709 Automation Pkwy', 'San Jose', 'CA', 'US', 37.3697, -121.9230),
('Airport SFO', 'S Airport Blvd', 'San Francisco', 'CA', 'US', 37.6213, -122.3790),
('Lake Tahoe', 'US-50', 'South Lake Tahoe', 'CA', 'US', 38.9399, -119.9772),
('Monterey', 'Cannery Row', 'Monterey', 'CA', 'US', 36.6177, -121.9010),
('Napa Valley', 'CA-29', 'Napa', 'CA', 'US', 38.2975, -122.2869),
('Big Sur', 'CA-1', 'Big Sur', 'CA', 'US', 36.2704, -121.8081);

-- Settings
INSERT INTO settings (id, unit_of_length, unit_of_temp, preferred_range, language, base_cost_per_kwh, gas_price_per_unit)
VALUES (1, 'mi', 'F', 'rated', 'en', 0.12, 4.50)
ON CONFLICT (id) DO NOTHING;

-- Generate 20 years of data using DO block
DO $$
DECLARE
  vid BIGINT;
  d INT;
  total_days INT := 7300; -- ~20 years
  drive_id BIGINT;
  charge_id BIGINT;
  day_date TIMESTAMPTZ;
  season_factor FLOAT;
  temp_base FLOAT;
  month_num INT;
  odometer FLOAT := 0;
  daily_dist FLOAT;
  soc FLOAT;
BEGIN
  SELECT id INTO vid FROM vehicles WHERE vin = '5YJ3E1EA1PF123456';

  FOR d IN 0..total_days LOOP
    day_date := '2006-01-15'::timestamptz + (d || ' days')::interval;
    month_num := EXTRACT(MONTH FROM day_date);

    -- Seasonal temperature (San Jose climate)
    temp_base := CASE
      WHEN month_num IN (12, 1, 2) THEN 8 + random() * 6      -- Winter: 8-14°C
      WHEN month_num IN (3, 4, 5) THEN 14 + random() * 8       -- Spring: 14-22°C
      WHEN month_num IN (6, 7, 8) THEN 22 + random() * 10      -- Summer: 22-32°C
      ELSE 15 + random() * 8                                     -- Fall: 15-23°C
    END;

    -- Skip ~15% of days (no driving)
    IF random() < 0.15 THEN
      CONTINUE;
    END IF;

    -- Morning commute drive (Home → Office)
    daily_dist := 25 + random() * 15;
    soc := 80 + random() * 15;

    INSERT INTO drives (vehicle_id, start_date, end_date, distance, duration_min,
      speed_max, speed_avg, start_range_km, end_range_km,
      start_battery_level, end_battery_level, outside_temp_avg,
      start_address, end_address, start_odometer, end_odometer)
    VALUES (vid,
      day_date + interval '7 hours' + (random() * 60 || ' minutes')::interval,
      day_date + interval '7 hours 35 minutes' + (random() * 60 || ' minutes')::interval,
      daily_dist, 25 + random() * 15,
      80 + random() * 50, 35 + random() * 25,
      soc * 3.6, (soc - daily_dist * 0.2) * 3.6,
      soc::int, (soc - daily_dist * 0.2)::int, temp_base,
      'Home', 'Office', odometer, odometer + daily_dist)
    RETURNING id INTO drive_id;

    odometer := odometer + daily_dist;

    -- Evening commute (Office → Home, ~80% of days)
    IF random() < 0.80 THEN
      INSERT INTO drives (vehicle_id, start_date, end_date, distance, duration_min,
        speed_max, speed_avg, start_range_km, end_range_km,
        start_battery_level, end_battery_level, outside_temp_avg,
        start_address, end_address, start_odometer, end_odometer, power_min)
      VALUES (vid,
        day_date + interval '17 hours' + (random() * 90 || ' minutes')::interval,
        day_date + interval '17 hours 40 minutes' + (random() * 90 || ' minutes')::interval,
        daily_dist + random() * 5, 28 + random() * 15,
        75 + random() * 55, 30 + random() * 25,
        (soc - 20) * 3.6, (soc - 20 - daily_dist * 0.2) * 3.6,
        (soc - 20)::int, (soc - 20 - daily_dist * 0.2)::int, temp_base + 3,
        'Office', 'Home', odometer, odometer + daily_dist + random() * 5,
        -(15 + random() * 40));

      odometer := odometer + daily_dist + random() * 5;
    END IF;

    -- Weekend extra drives (~30% chance, varied destinations)
    IF EXTRACT(DOW FROM day_date) IN (0, 6) AND random() < 0.5 THEN
      DECLARE
        dest_names TEXT[] := ARRAY['Gym', 'Costco', 'Supercharger MV', 'Airport SFO', 'Monterey', 'Napa Valley'];
        dest TEXT;
        extra_dist FLOAT;
      BEGIN
        dest := dest_names[1 + floor(random() * array_length(dest_names, 1))::int];
        extra_dist := CASE dest
          WHEN 'Gym' THEN 8 + random() * 5
          WHEN 'Costco' THEN 12 + random() * 5
          WHEN 'Airport SFO' THEN 55 + random() * 10
          WHEN 'Monterey' THEN 110 + random() * 20
          WHEN 'Napa Valley' THEN 90 + random() * 15
          ELSE 20 + random() * 10
        END;

        INSERT INTO drives (vehicle_id, start_date, end_date, distance, duration_min,
          speed_max, speed_avg, start_range_km, end_range_km,
          start_battery_level, end_battery_level, outside_temp_avg,
          start_address, end_address, start_odometer, end_odometer, power_min)
        VALUES (vid,
          day_date + interval '10 hours' + (random() * 120 || ' minutes')::interval,
          day_date + interval '10 hours' + ((extra_dist / 0.8 + random() * 15) || ' minutes')::interval,
          extra_dist, extra_dist / 0.8 + random() * 10,
          90 + random() * 40, 40 + random() * 30,
          (soc - 10) * 3.6, (soc - 10 - extra_dist * 0.18) * 3.6,
          (soc - 10)::int, GREATEST(5, (soc - 10 - extra_dist * 0.18))::int, temp_base + 2,
          'Home', dest, odometer, odometer + extra_dist,
          -(10 + random() * 50));

        odometer := odometer + extra_dist;
      END;
    END IF;

    -- Charging session (~60% of days, mostly overnight)
    IF random() < 0.60 THEN
      DECLARE
        charge_energy FLOAT := 15 + random() * 35;
        charge_start_soc INT := 20 + (random() * 30)::int;
        charge_end_soc INT;
        charger_pwr FLOAT;
        charge_dur FLOAT;
        is_supercharger BOOLEAN := random() < 0.15;
      BEGIN
        IF is_supercharger THEN
          charger_pwr := 100 + random() * 150;
          charge_dur := charge_energy / charger_pwr * 60;
          charge_end_soc := LEAST(90, charge_start_soc + (charge_energy / 0.75 * 100)::int);

          INSERT INTO charging_sessions (vehicle_id, start_date, end_date,
            charge_energy_added, start_battery_level, end_battery_level,
            start_range_km, end_range_km, charger_power,
            fast_charger_type, cost, duration_min, address_id,
            latitude, longitude, location_name, outside_temp_avg)
          VALUES (vid,
            day_date + interval '14 hours' + (random() * 120 || ' minutes')::interval,
            day_date + interval '14 hours' + ((charge_dur + random() * 10) || ' minutes')::interval,
            charge_energy, charge_start_soc, charge_end_soc,
            charge_start_soc * 3.6, charge_end_soc * 3.6, charger_pwr,
            'Tesla', charge_energy * 0.35, charge_dur, 3,
            37.3861, -122.0839, 'Supercharger MV', temp_base);
        ELSE
          charger_pwr := 7 + random() * 5;
          charge_dur := charge_energy / charger_pwr * 60;
          charge_end_soc := LEAST(95, charge_start_soc + (charge_energy / 0.75 * 100)::int);

          INSERT INTO charging_sessions (vehicle_id, start_date, end_date,
            charge_energy_added, start_battery_level, end_battery_level,
            start_range_km, end_range_km, charger_power,
            cost, duration_min, address_id,
            latitude, longitude, location_name, outside_temp_avg)
          VALUES (vid,
            day_date + interval '22 hours' + (random() * 60 || ' minutes')::interval,
            day_date + interval '22 hours' + ((charge_dur + random() * 30) || ' minutes')::interval,
            charge_energy, charge_start_soc, charge_end_soc,
            charge_start_soc * 3.6, charge_end_soc * 3.6, charger_pwr,
            charge_energy * 0.12, charge_dur, 1,
            37.3382, -121.8863, 'Home', temp_base - 2);
        END IF;
      END;
    END IF;

    -- Daily mileage (every day)
    INSERT INTO daily_mileage (vehicle_id, date, distance_km, odometer_start, odometer_end, drive_count)
    VALUES (vid, day_date::date, daily_dist * 2, odometer - daily_dist * 2, odometer, 2 + (random() * 2)::int)
    ON CONFLICT DO NOTHING;

    -- Battery snapshots (every 7 days)
    IF d % 7 = 0 THEN
      DECLARE
        years_owned FLOAT := d / 365.0;
        degradation FLOAT := LEAST(25, years_owned * 1.2 + random() * 0.5);
        health FLOAT := 100 - degradation;
        capacity FLOAT := 75 * (health / 100.0);
      BEGIN
        INSERT INTO battery_snapshots (vehicle_id, health_score, capacity_kwh, degradation_pct,
          est_range_km, cycle_count, avg_cell_temp_c, created_at)
        VALUES (vid, health, capacity, degradation,
          capacity * 4.2, (years_owned * 200 + random() * 50)::int, temp_base + 5 + random() * 3, day_date);
      END;
    END IF;

    -- Tire pressure (every 3 days)
    IF d % 3 = 0 THEN
      INSERT INTO tire_pressure_snapshots (vehicle_id, front_left, front_right, rear_left, rear_right, created_at)
      VALUES (vid,
        2.8 + random() * 0.3 + (temp_base - 15) * 0.005,
        2.8 + random() * 0.3 + (temp_base - 15) * 0.005,
        2.7 + random() * 0.3 + (temp_base - 15) * 0.005,
        2.7 + random() * 0.3 + (temp_base - 15) * 0.005,
        day_date + interval '12 hours');
    END IF;

    -- Climate snapshots (every 2 days)
    IF d % 2 = 0 THEN
      INSERT INTO climate_snapshots (vehicle_id, inside_temp, outside_temp, hvac_power, created_at)
      VALUES (vid,
        21 + random() * 3,
        temp_base + random() * 2,
        CASE WHEN temp_base < 10 OR temp_base > 28 THEN 2000 + random() * 2000 ELSE 500 + random() * 1000 END,
        day_date + interval '8 hours');
    END IF;

    -- Vampire drain events (every 5 days)
    IF d % 5 = 0 THEN
      DECLARE
        sentry BOOLEAN := random() < 0.6;
        drain_hrs FLOAT := 6 + random() * 14;
        drain_rate FLOAT := CASE WHEN sentry THEN 0.8 + random() * 0.6 ELSE 0.2 + random() * 0.3 END;
      BEGIN
        INSERT INTO vampire_drain_events (vehicle_id, start_date, end_date,
          start_battery, end_battery, battery_lost, range_lost_km,
          duration_hours, drain_rate_pct_per_hour, outside_temp_avg, sentry_mode, created_at)
        VALUES (vid, day_date, day_date + (drain_hrs || ' hours')::interval,
          70 + (random() * 20)::int, 70 + (random() * 20)::int - (drain_rate * drain_hrs)::int,
          (drain_rate * drain_hrs)::int, drain_rate * drain_hrs * 3.6,
          drain_hrs, drain_rate, temp_base, sentry, day_date);
      END;
    END IF;

    -- Vehicle states (2-3 per day)
    INSERT INTO vehicle_states (vehicle_id, state, start_date, end_date, duration_min)
    VALUES
      (vid, 'driving', day_date + interval '7 hours', day_date + interval '7 hours 35 minutes', 35),
      (vid, 'online', day_date + interval '7 hours 35 minutes', day_date + interval '8 hours', 25),
      (vid, 'asleep', day_date + interval '8 hours', day_date + interval '17 hours', 540)
    ON CONFLICT DO NOTHING;

  END LOOP;

  RAISE NOTICE 'Seed complete: % total odometer km', odometer;
END;
$$;
