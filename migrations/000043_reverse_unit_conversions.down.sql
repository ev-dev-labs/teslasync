-- Reverse: re-apply unit conversions (multiply by 1.60934 to restore km/km·h)
UPDATE positions SET odometer = odometer * 1.60934, speed = speed * 1.60934, ideal_range = ideal_range * 1.60934, rated_range = rated_range * 1.60934 WHERE odometer > 0 OR speed > 0;
UPDATE drives SET distance = distance * 1.60934, speed_max = speed_max * 1.60934 WHERE distance > 0;
UPDATE daily_mileage SET odometer_start = odometer_start * 1.60934, odometer_end = odometer_end * 1.60934, distance_km = distance_km * 1.60934 WHERE odometer_start > 0;
UPDATE vehicle_live_state SET speed = speed * 1.60934, odometer = odometer * 1.60934 WHERE speed IS NOT NULL;
