package queries

// Vehicle SQL queries — ALL vehicle persistence SQL lives here.
const (
	GetVehicleByID = `
		SELECT id, user_id, vin, display_name, model, year, color,
		       fsm_state, sub_fsm_state, odometer_miles, battery_level,
		       range_miles, is_charging, latitude, longitude,
		       created_at, updated_at
		FROM vehicles
		WHERE id = $1`

	GetVehicleByVIN = `
		SELECT id, user_id, vin, display_name, model, year, color,
		       fsm_state, sub_fsm_state, odometer_miles, battery_level,
		       range_miles, is_charging, latitude, longitude,
		       created_at, updated_at
		FROM vehicles
		WHERE vin = $1`

	GetVehiclesByUserID = `
		SELECT id, user_id, vin, display_name, model, year, color,
		       fsm_state, sub_fsm_state, odometer_miles, battery_level,
		       range_miles, is_charging, latitude, longitude,
		       created_at, updated_at
		FROM vehicles
		WHERE user_id = $1
		ORDER BY display_name`

	GetVehicleByIDForUpdate = `
		SELECT id, user_id, vin, display_name, model, year, color,
		       fsm_state, sub_fsm_state, odometer_miles, battery_level,
		       range_miles, is_charging, latitude, longitude,
		       created_at, updated_at
		FROM vehicles
		WHERE id = $1
		FOR UPDATE`

	UpsertVehicle = `
		INSERT INTO vehicles (
			id, user_id, vin, display_name, model, year, color,
			fsm_state, sub_fsm_state, odometer_miles, battery_level,
			range_miles, is_charging, latitude, longitude,
			created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
		ON CONFLICT (id) DO UPDATE SET
			display_name = EXCLUDED.display_name,
			model = EXCLUDED.model,
			year = EXCLUDED.year,
			color = EXCLUDED.color,
			fsm_state = EXCLUDED.fsm_state,
			sub_fsm_state = EXCLUDED.sub_fsm_state,
			odometer_miles = EXCLUDED.odometer_miles,
			battery_level = EXCLUDED.battery_level,
			range_miles = EXCLUDED.range_miles,
			is_charging = EXCLUDED.is_charging,
			latitude = EXCLUDED.latitude,
			longitude = EXCLUDED.longitude,
			updated_at = EXCLUDED.updated_at`

	DeleteVehicle = `DELETE FROM vehicles WHERE id = $1`
)
