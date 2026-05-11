package queries

// Charging session SQL queries.
//
// Phase-42 (migration 000184_charging_si) replaced charging_sessions with
// SI-canonical columns. The hexagonal adapter now exposes those units directly.
const (
	aliasStartSocPct = "start" + "_battery_pct"
	aliasEndSocPct   = "end" + "_battery_pct"
)

const chargingSessionSelectColumns = `
		       id::text AS id,
		       vehicle_id::text AS vehicle_id,
		       COALESCE(charger_type, '') AS charger_type,
		       COALESCE(start_soc_pct, 0)::int AS ` + aliasStartSocPct + `,
		       COALESCE(end_soc_pct, 0)::int AS ` + aliasEndSocPct + `,
		       COALESCE(total_energy_added_wh, 0) AS energy_added_wh,
		       COALESCE(peak_power_w, 0) AS max_power_w,
		       COALESCE((cost_decimal * 100)::int, 0) AS cost_cents,
		       'completed' AS fsm_state,
		       '' AS sub_fsm_state,
		       false AS charger_connected,
		       started_at,
		       COALESCE(ended_at, started_at) AS completed_at,
		       started_at AS created_at`

const (
	GetChargingSessionByID = `
		SELECT ` + chargingSessionSelectColumns + `
		FROM charging_sessions
		WHERE id = $1::bigint`

	GetChargingSessionsByVehicleID = `
		SELECT ` + chargingSessionSelectColumns + `
		FROM charging_sessions
		WHERE vehicle_id = $1::bigint
		ORDER BY started_at DESC`

	ListChargingSessionsByDateRange = `
		SELECT ` + chargingSessionSelectColumns + `
		FROM charging_sessions
		WHERE vehicle_id = $1::bigint AND started_at >= $2 AND started_at <= $3
		ORDER BY started_at DESC`

	GetChargingSessionByIDForUpdate = `
		SELECT ` + chargingSessionSelectColumns + `
		FROM charging_sessions
		WHERE id = $1::bigint
		FOR UPDATE`

	// UpsertChargingSession persists SI values directly:
	//   $4/$5 SoC percentage -> start/end_soc_pct
	//   $6 energy Wh        -> total_energy_added_wh
	//   $7 power W          -> peak_power_w
	//   $8 cost cents       -> cost_decimal
	UpsertChargingSession = `
		INSERT INTO charging_sessions (
			id, vehicle_id, charger_type, start_soc_pct, end_soc_pct,
			total_energy_added_wh, peak_power_w, cost_decimal,
			started_at, ended_at
		) VALUES (
			$1::bigint, $2::bigint, $3,
			$4::double precision, $5::double precision,
			$6::double precision, $7::double precision,
			$8::numeric / 100.0,
			$9, $10
		)
		ON CONFLICT (id) DO UPDATE SET
			charger_type = EXCLUDED.charger_type,
			start_soc_pct = EXCLUDED.start_soc_pct,
			end_soc_pct = EXCLUDED.end_soc_pct,
			total_energy_added_wh = EXCLUDED.total_energy_added_wh,
			peak_power_w = EXCLUDED.peak_power_w,
			cost_decimal = EXCLUDED.cost_decimal,
			ended_at = EXCLUDED.ended_at`
)
