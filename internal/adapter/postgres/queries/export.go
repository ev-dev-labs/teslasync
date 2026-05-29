package queries

const (
	GetExportJobByID = `
		SELECT id, user_id, format, vehicle_id, date_from, date_to,
		       fsm_state, file_path, file_size, failed_reason, created_at, completed_at
		FROM export_jobs
		WHERE id = $1`

	GetExportJobsByUserID = `
		SELECT id, user_id, format, vehicle_id, date_from, date_to,
		       fsm_state, file_path, file_size, failed_reason, created_at, completed_at
		FROM export_jobs
		WHERE user_id = $1
		ORDER BY created_at DESC`

	GetExportJobByIDForUpdate = `
		SELECT id, user_id, format, vehicle_id, date_from, date_to,
		       fsm_state, file_path, file_size, failed_reason, created_at, completed_at
		FROM export_jobs
		WHERE id = $1
		FOR UPDATE`

	UpsertExportJob = `
		INSERT INTO export_jobs (
			id, user_id, format, vehicle_id, date_from, date_to,
			fsm_state, file_path, file_size, failed_reason, created_at, completed_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (id) DO UPDATE SET
			fsm_state = EXCLUDED.fsm_state,
			file_path = EXCLUDED.file_path,
			file_size = EXCLUDED.file_size,
			failed_reason = EXCLUDED.failed_reason,
			completed_at = EXCLUDED.completed_at`
)
