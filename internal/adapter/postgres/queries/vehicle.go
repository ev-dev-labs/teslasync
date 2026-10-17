package queries

// Vehicle SQL queries — ALL vehicle persistence SQL lives here.
const (
	GetVehicleByID = `
		SELECT id, tesla_id, vin, display_name, model, option_codes, color,
		       trim_level, enrolled_at, archived_at, created_at, updated_at, timezone
		FROM vehicles
		WHERE id = $1`

	GetVehicleByVIN = `
		SELECT id, tesla_id, vin, display_name, model, option_codes, color,
		       trim_level, enrolled_at, archived_at, created_at, updated_at, timezone
		FROM vehicles
		WHERE vin = $1`

	GetAllVehicles = `
		SELECT id, tesla_id, vin, display_name, model, option_codes, color,
		       trim_level, enrolled_at, archived_at, created_at, updated_at, timezone
		FROM vehicles
		ORDER BY display_name, id`

	GetVehicleByIDForUpdate = `
		SELECT id, tesla_id, vin, display_name, model, option_codes, color,
		       trim_level, enrolled_at, archived_at, created_at, updated_at, timezone
		FROM vehicles
		WHERE id = $1
		FOR UPDATE`

	UpsertVehicle = `
		INSERT INTO vehicles (
			tesla_id, vin, display_name, model, option_codes, color, trim_level, timezone
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (tesla_id) DO UPDATE SET
			display_name = EXCLUDED.display_name,
			model = EXCLUDED.model,
			option_codes = EXCLUDED.option_codes,
			color = EXCLUDED.color,
			trim_level = EXCLUDED.trim_level,
			timezone = EXCLUDED.timezone
		WHERE vehicles.vin = EXCLUDED.vin
		RETURNING id, enrolled_at, created_at, updated_at`

	UpdateVehicle = `
		UPDATE vehicles SET
			vin = $3, display_name = $4, model = $5, option_codes = $6,
			color = $7, trim_level = $8, archived_at = $9, timezone = $10
		WHERE id = $1 AND tesla_id = $2
		RETURNING id, enrolled_at, created_at, updated_at`

	DeleteVehicle = `DELETE FROM vehicles WHERE id = $1`
)
