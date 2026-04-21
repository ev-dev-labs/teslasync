-- Remove positions with (0,0) coordinates — telemetry noise, not real locations.
DELETE FROM positions WHERE latitude = 0 AND longitude = 0;
