-- Seed test vehicle for signal replay testing
-- This creates a vehicle matching the prod vehicle_id=1 signals

INSERT INTO vehicles (id, vehicle_id, vin, display_name, model, trim_badging, exterior_color, wheel_type, state, healthy, created_at, updated_at)
VALUES (1, 1000000001, 'TEST00000000VIN01', 'Test Model Y', 'Model Y', 'Long Range', 'MidnightSilver', 'Gemini19', 'online', true, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  display_name = 'Test Model Y',
  state = 'online',
  updated_at = NOW();

-- Ensure vehicle_live_state row exists
INSERT INTO vehicle_live_state (vehicle_id, updated_at)
VALUES (1, NOW())
ON CONFLICT (vehicle_id) DO NOTHING;

-- Verify
SELECT id, vehicle_id, vin, display_name, state FROM vehicles WHERE id = 1;
