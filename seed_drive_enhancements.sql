-- Seed data for drive session enhancements testing
-- Uses TESTVIN0000000001 vehicle (ID 1)

-- Insert a completed drive with all enhanced fields
INSERT INTO drives (
    vehicle_id, start_date, end_date, distance, duration_min,
    start_battery_level, end_battery_level,
    speed_max, speed_avg, speed_min,
    power_max, power_min,
    inside_temp_avg, outside_temp_avg,
    start_odometer, end_odometer,
    start_rated_range_km, end_rated_range_km,
    rated_range_avg, rated_range_max, rated_range_min,
    start_ideal_range_km, end_ideal_range_km,
    ideal_range_avg, ideal_range_max, ideal_range_min,
    start_est_range_km, end_est_range_km,
    est_range_avg, est_range_max, est_range_min,
    soc_start, soc_end, soc_avg, soc_max, soc_min,
    usable_soc_start, usable_soc_end, usable_soc_avg, usable_soc_max, usable_soc_min,
    elevation_start, elevation_end, elevation_gain, elevation_loss,
    driver_temp_avg, passenger_temp_avg, battery_heater_on,
    start_address, end_address,
    start_latitude, start_longitude, end_latitude, end_longitude
) VALUES (
    1, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '30 minutes', 45.2, 90,
    85, 62,
    120.5, 55.3, 0,
    175.0, -45.0,
    22.5, 18.3,
    50123.4, 50168.6,
    320.0, 280.5,
    298.3, 322.0, 278.0,
    335.0, 293.5,
    312.4, 337.0, 291.0,
    310.0, 272.5,
    289.7, 312.0, 270.0,
    85.0, 62.0, 73.5, 85.0, 62.0,
    84.5, 61.5, 73.0, 84.5, 61.5,
    120.0, 185.0, 350.0, 285.0,
    23.1, 22.8, false,
    '123 Main St, San Francisco', '456 Market St, San Jose',
    37.7749, -122.4194, 37.3382, -121.8863
) RETURNING id;

-- Insert drive telemetry readings for drive ID 1
-- These simulate readings captured every ~30 seconds during a drive
INSERT INTO drive_telemetry_readings (drive_id, timestamp, latitude, longitude, speed, power, odometer, battery_level, ideal_range_km, rated_range_km, est_range_km, elevation, heading, inside_temp, outside_temp) VALUES
(1, NOW() - INTERVAL '2 hours',        37.7749, -122.4194,   0.0,   0.0, 50123.4, 85, 335.0, 320.0, 310.0, 120, 180, 22.0, 18.0),
(1, NOW() - INTERVAL '1 hour 55 min',  37.7700, -122.4100,  35.5,  45.0, 50124.2, 84, 333.0, 318.5, 308.5, 125, 175, 22.2, 18.1),
(1, NOW() - INTERVAL '1 hour 45 min',  37.7550, -122.3900,  65.0,  85.0, 50128.5, 82, 328.0, 313.0, 303.0, 140, 170, 22.5, 18.2),
(1, NOW() - INTERVAL '1 hour 30 min',  37.7300, -122.3500, 110.0, 150.0, 50135.0, 78, 318.0, 302.0, 292.0, 165, 165, 22.8, 18.3),
(1, NOW() - INTERVAL '1 hour 15 min',  37.6900, -122.2800, 120.5, 175.0, 50142.0, 74, 308.0, 293.0, 283.0, 185, 160, 23.0, 18.4),
(1, NOW() - INTERVAL '1 hour',         37.6200, -122.2000,  95.0, 120.0, 50148.5, 72, 305.0, 290.0, 280.0, 170, 155, 23.2, 18.5),
(1, NOW() - INTERVAL '45 min',         37.5500, -122.1200,  80.0,  95.0, 50153.0, 69, 300.0, 286.0, 276.0, 160, 150, 23.1, 18.3),
(1, NOW() - INTERVAL '30 min',         37.3382, -121.8863,   0.0, -45.0, 50168.6, 62, 293.5, 280.5, 272.5, 185, 145, 22.8, 18.2);

-- Insert a completed charging session with all enhanced fields
INSERT INTO charging_sessions (
    vehicle_id, start_date, end_date,
    start_battery_level, end_battery_level,
    charge_energy_added, charge_miles_added_rated,
    charger_voltage, charger_actual_current, charger_power,
    charger_phases, charge_rate,
    fast_charger_brand, fast_charger_type, conn_charge_cable,
    charge_port_latch, charge_port_door_open,
    start_rated_range_km, end_rated_range_km,
    start_ideal_range_km, end_ideal_range_km,
    cost, cost_per_kwh,
    latitude, longitude, address
) VALUES (
    1, NOW() - INTERVAL '25 minutes', NOW(),
    62, 90,
    18.5, 55.2,
    240, 32, 7.7,
    1, 30,
    NULL, NULL, 'SAE',
    'Engaged', true,
    280.5, 355.0,
    293.5, 372.0,
    4.63, 0.25,
    37.3382, -121.8863, '456 Market St, San Jose'
) RETURNING id;

-- Insert charge telemetry readings for charging session ID 1
INSERT INTO charge_telemetry_readings (charging_session_id, timestamp, battery_level, voltage, current, power, rated_range_km, ideal_range_km, est_range_km, charger_phases, charge_rate, charge_energy_added, time_to_full_charge) VALUES
(1, NOW() - INTERVAL '25 minutes', 62, 240, 32, 7.7, 280.5, 293.5, 272.5, 1, 30, 0.0,  1.5),
(1, NOW() - INTERVAL '20 minutes', 66, 240, 32, 7.7, 292.0, 306.0, 284.0, 1, 30, 3.1,  1.2),
(1, NOW() - INTERVAL '15 minutes', 71, 240, 32, 7.7, 306.0, 320.5, 298.0, 1, 30, 6.8,  0.9),
(1, NOW() - INTERVAL '10 minutes', 78, 240, 32, 7.7, 325.0, 340.5, 316.0, 1, 30, 11.2, 0.5),
(1, NOW() - INTERVAL '5 minutes',  85, 240, 30, 7.2, 342.0, 358.0, 332.0, 1, 28, 15.5, 0.2),
(1, NOW(),                          90, 240, 28, 6.7, 355.0, 372.0, 345.0, 1, 26, 18.5, 0.0);
