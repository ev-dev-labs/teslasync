package queries

// Charging session SQL queries.
// NOTE: The domain model (charging.ChargingSession) has db tags matching the
// SQL column aliases. Positional Scan and RowToStructByName both work correctly.
const (
	GetChargingSessionByID = `
		SELECT id::text AS id,
		       vehicle_id::text AS vehicle_id,
		       COALESCE(charger_type, '') AS charger_type,
		       start_battery_pct,
		       COALESCE(end_battery_pct, 0) AS end_battery_pct,
		       energy_added_kwh,
		       COALESCE(charger_power_kw_max, 0) AS max_power_kw,
		       COALESCE((cost * 100)::int, 0) AS cost_cents,
		       'completed' AS fsm_state,
		       '' AS sub_fsm_state,
		       false AS charger_connected,
		       start_ts AS started_at,
		       COALESCE(end_ts, start_ts) AS completed_at,
		       start_ts AS created_at
		FROM charging_sessions
		WHERE id = $1::bigint`

	GetChargingSessionsByVehicleID = `
		SELECT id::text AS id,
		       vehicle_id::text AS vehicle_id,
		       COALESCE(charger_type, '') AS charger_type,
		       start_battery_pct,
		       COALESCE(end_battery_pct, 0) AS end_battery_pct,
		       energy_added_kwh,
		       COALESCE(charger_power_kw_max, 0) AS max_power_kw,
		       COALESCE((cost * 100)::int, 0) AS cost_cents,
		       'completed' AS fsm_state,
		       '' AS sub_fsm_state,
		       false AS charger_connected,
		       start_ts AS started_at,
		       COALESCE(end_ts, start_ts) AS completed_at,
		       start_ts AS created_at
		FROM charging_sessions
		WHERE vehicle_id = $1::bigint
		ORDER BY start_ts DESC`

	ListChargingSessionsByDateRange = `
		SELECT id::text AS id,
		       vehicle_id::text AS vehicle_id,
		       COALESCE(charger_type, '') AS charger_type,
		       start_battery_pct,
		       COALESCE(end_battery_pct, 0) AS end_battery_pct,
		       energy_added_kwh,
		       COALESCE(charger_power_kw_max, 0) AS max_power_kw,
		       COALESCE((cost * 100)::int, 0) AS cost_cents,
		       'completed' AS fsm_state,
		       '' AS sub_fsm_state,
		       false AS charger_connected,
		       start_ts AS started_at,
		       COALESCE(end_ts, start_ts) AS completed_at,
		       start_ts AS created_at
		FROM charging_sessions
		WHERE vehicle_id = $1::bigint AND start_ts >= $2 AND start_ts <= $3
		ORDER BY start_ts DESC`

	GetChargingSessionByIDForUpdate = `
		SELECT id::text AS id,
		       vehicle_id::text AS vehicle_id,
		       COALESCE(charger_type, '') AS charger_type,
		       start_battery_pct,
		       COALESCE(end_battery_pct, 0) AS end_battery_pct,
		       energy_added_kwh,
		       COALESCE(charger_power_kw_max, 0) AS max_power_kw,
		       COALESCE((cost * 100)::int, 0) AS cost_cents,
		       'completed' AS fsm_state,
		       '' AS sub_fsm_state,
		       false AS charger_connected,
		       start_ts AS started_at,
		       COALESCE(end_ts, start_ts) AS completed_at,
		       start_ts AS created_at
		FROM charging_sessions
		WHERE id = $1::bigint
		FOR UPDATE`

	UpsertChargingSession = `
		INSERT INTO charging_sessions (
			id, vehicle_id, charger_type, start_battery_pct, end_battery_pct,
			energy_added_kwh, charger_power_kw_max, cost,
			start_ts, end_ts
		) VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6, $7, $8::float8 / 100.0, $9, $10)
		ON CONFLICT (id) DO UPDATE SET
			charger_type = EXCLUDED.charger_type,
			start_battery_pct = EXCLUDED.start_battery_pct,
			end_battery_pct = EXCLUDED.end_battery_pct,
			energy_added_kwh = EXCLUDED.energy_added_kwh,
			charger_power_kw_max = EXCLUDED.charger_power_kw_max,
			cost = EXCLUDED.cost,
			end_ts = EXCLUDED.end_ts`
)
