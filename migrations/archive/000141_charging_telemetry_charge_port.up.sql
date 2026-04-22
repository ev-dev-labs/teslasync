-- Add charge_port enum column to charging_telemetry so the ChargePort
-- signal (Open/Closed) is visible through the ChargingTelemetry API response.
-- Previously stored only in vehicle_live_state.charge_port with no reader.
ALTER TABLE charging_telemetry ADD COLUMN IF NOT EXISTS charge_port VARCHAR(50);
