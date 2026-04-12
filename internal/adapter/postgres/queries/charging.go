package queries

// Charging session SQL queries.
const (
	GetChargingSessionByID = `
		SELECT id, vehicle_id, charger_type, start_battery_level, end_battery_level,
		       energy_added_kwh, max_power_kw, cost_cents, fsm_state, sub_fsm_state,
		       charger_connected, started_at, completed_at, created_at
		FROM charging_sessions
		WHERE id = $1`

	GetChargingSessionsByVehicleID = `
		SELECT id, vehicle_id, charger_type, start_battery_level, end_battery_level,
		       energy_added_kwh, max_power_kw, cost_cents, fsm_state, sub_fsm_state,
		       charger_connected, started_at, completed_at, created_at
		FROM charging_sessions
		WHERE vehicle_id = $1
		ORDER BY started_at DESC`

	ListChargingSessionsByDateRange = `
		SELECT id, vehicle_id, charger_type, start_battery_level, end_battery_level,
		       energy_added_kwh, max_power_kw, cost_cents, fsm_state, sub_fsm_state,
		       charger_connected, started_at, completed_at, created_at
		FROM charging_sessions
		WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
		ORDER BY started_at DESC`

	GetChargingSessionByIDForUpdate = `
		SELECT id, vehicle_id, charger_type, start_battery_level, end_battery_level,
		       energy_added_kwh, max_power_kw, cost_cents, fsm_state, sub_fsm_state,
		       charger_connected, started_at, completed_at, created_at
		FROM charging_sessions
		WHERE id = $1
		FOR UPDATE`

	UpsertChargingSession = `
		INSERT INTO charging_sessions (
			id, vehicle_id, charger_type, start_battery_level, end_battery_level,
			energy_added_kwh, max_power_kw, cost_cents, fsm_state, sub_fsm_state,
			charger_connected, started_at, completed_at, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		ON CONFLICT (id) DO UPDATE SET
			charger_type = EXCLUDED.charger_type,
			start_battery_level = EXCLUDED.start_battery_level,
			end_battery_level = EXCLUDED.end_battery_level,
			energy_added_kwh = EXCLUDED.energy_added_kwh,
			max_power_kw = EXCLUDED.max_power_kw,
			cost_cents = EXCLUDED.cost_cents,
			fsm_state = EXCLUDED.fsm_state,
			sub_fsm_state = EXCLUDED.sub_fsm_state,
			charger_connected = EXCLUDED.charger_connected,
			completed_at = EXCLUDED.completed_at`
)
