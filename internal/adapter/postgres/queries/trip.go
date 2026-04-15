package queries

// Trip SQL queries.
const (
	GetTripByID = `
		SELECT id, vehicle_id, start_latitude, start_longitude, end_latitude, end_longitude,
		       start_address, end_address, distance_miles, energy_used_kwh,
		       efficiency_wh_per_mile, max_speed_mph, fsm_state, started_at, completed_at, created_at
		FROM trips
		WHERE id = $1`

	GetTripsByVehicleID = `
		SELECT id, vehicle_id, start_latitude, start_longitude, end_latitude, end_longitude,
		       start_address, end_address, distance_miles, energy_used_kwh,
		       efficiency_wh_per_mile, max_speed_mph, fsm_state, started_at, completed_at, created_at
		FROM trips
		WHERE vehicle_id = $1
		ORDER BY started_at DESC`

	ListTripsByDateRange = `
		SELECT id, vehicle_id, start_latitude, start_longitude, end_latitude, end_longitude,
		       start_address, end_address, distance_miles, energy_used_kwh,
		       efficiency_wh_per_mile, max_speed_mph, fsm_state, started_at, completed_at, created_at
		FROM trips
		WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
		ORDER BY started_at DESC`

	GetTripByIDForUpdate = `
		SELECT id, vehicle_id, start_latitude, start_longitude, end_latitude, end_longitude,
		       start_address, end_address, distance_miles, energy_used_kwh,
		       efficiency_wh_per_mile, max_speed_mph, fsm_state, started_at, completed_at, created_at
		FROM trips
		WHERE id = $1
		FOR UPDATE`

	UpsertTrip = `
		INSERT INTO trips (
			id, vehicle_id, start_latitude, start_longitude, end_latitude, end_longitude,
			start_address, end_address, distance_miles, energy_used_kwh,
			efficiency_wh_per_mile, max_speed_mph, fsm_state, started_at, completed_at, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		ON CONFLICT (id) DO UPDATE SET
			end_latitude = EXCLUDED.end_latitude,
			end_longitude = EXCLUDED.end_longitude,
			end_address = EXCLUDED.end_address,
			distance_miles = EXCLUDED.distance_miles,
			energy_used_kwh = EXCLUDED.energy_used_kwh,
			efficiency_wh_per_mile = EXCLUDED.efficiency_wh_per_mile,
			max_speed_mph = EXCLUDED.max_speed_mph,
			fsm_state = EXCLUDED.fsm_state,
			completed_at = EXCLUDED.completed_at`
)
