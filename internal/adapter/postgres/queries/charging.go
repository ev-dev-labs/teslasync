package queries

// Charging session SQL queries.
// NOTE: The domain model (charging.ChargingSession) uses camelCase db tags that
// differ from the actual table column names. We use SQL aliases to bridge the gap.
const (
	GetChargingSessionByID = `
		SELECT id::text AS id,
		       vehicle_id::text AS vehicle_id,
		       COALESCE(fast_charger_type, '') AS charger_type,
		       start_battery_level,
		       COALESCE(end_battery_level, 0) AS end_battery_level,
		       charge_energy_added AS energy_added_kwh,
		       COALESCE(charger_power, 0) AS max_power_kw,
		       COALESCE((cost * 100)::int, 0) AS cost_cents,
		       'completed' AS fsm_state,
		       '' AS sub_fsm_state,
		       false AS charger_connected,
		       start_date AS started_at,
		       COALESCE(end_date, start_date) AS completed_at,
		       start_date AS created_at
		FROM charging_sessions
		WHERE id = $1::bigint`

	GetChargingSessionsByVehicleID = `
		SELECT id::text AS id,
		       vehicle_id::text AS vehicle_id,
		       COALESCE(fast_charger_type, '') AS charger_type,
		       start_battery_level,
		       COALESCE(end_battery_level, 0) AS end_battery_level,
		       charge_energy_added AS energy_added_kwh,
		       COALESCE(charger_power, 0) AS max_power_kw,
		       COALESCE((cost * 100)::int, 0) AS cost_cents,
		       'completed' AS fsm_state,
		       '' AS sub_fsm_state,
		       false AS charger_connected,
		       start_date AS started_at,
		       COALESCE(end_date, start_date) AS completed_at,
		       start_date AS created_at
		FROM charging_sessions
		WHERE vehicle_id = $1::bigint
		ORDER BY start_date DESC`

	ListChargingSessionsByDateRange = `
		SELECT id::text AS id,
		       vehicle_id::text AS vehicle_id,
		       COALESCE(fast_charger_type, '') AS charger_type,
		       start_battery_level,
		       COALESCE(end_battery_level, 0) AS end_battery_level,
		       charge_energy_added AS energy_added_kwh,
		       COALESCE(charger_power, 0) AS max_power_kw,
		       COALESCE((cost * 100)::int, 0) AS cost_cents,
		       'completed' AS fsm_state,
		       '' AS sub_fsm_state,
		       false AS charger_connected,
		       start_date AS started_at,
		       COALESCE(end_date, start_date) AS completed_at,
		       start_date AS created_at
		FROM charging_sessions
		WHERE vehicle_id = $1::bigint AND start_date >= $2 AND start_date <= $3
		ORDER BY start_date DESC`

	GetChargingSessionByIDForUpdate = `
		SELECT id::text AS id,
		       vehicle_id::text AS vehicle_id,
		       COALESCE(fast_charger_type, '') AS charger_type,
		       start_battery_level,
		       COALESCE(end_battery_level, 0) AS end_battery_level,
		       charge_energy_added AS energy_added_kwh,
		       COALESCE(charger_power, 0) AS max_power_kw,
		       COALESCE((cost * 100)::int, 0) AS cost_cents,
		       'completed' AS fsm_state,
		       '' AS sub_fsm_state,
		       false AS charger_connected,
		       start_date AS started_at,
		       COALESCE(end_date, start_date) AS completed_at,
		       start_date AS created_at
		FROM charging_sessions
		WHERE id = $1::bigint
		FOR UPDATE`

	UpsertChargingSession = `
		INSERT INTO charging_sessions (
			id, vehicle_id, fast_charger_type, start_battery_level, end_battery_level,
			charge_energy_added, charger_power, cost,
			start_date, end_date
		) VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6, $7, $8::float8 / 100.0, $9, $10)
		ON CONFLICT (id) DO UPDATE SET
			fast_charger_type = EXCLUDED.fast_charger_type,
			start_battery_level = EXCLUDED.start_battery_level,
			end_battery_level = EXCLUDED.end_battery_level,
			charge_energy_added = EXCLUDED.charge_energy_added,
			charger_power = EXCLUDED.charger_power,
			cost = EXCLUDED.cost,
			end_date = EXCLUDED.end_date`
)
