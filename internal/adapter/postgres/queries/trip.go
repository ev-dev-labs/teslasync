package queries

const tripSelectFrom = `
		SELECT t.id::text AS id,
		       t.vehicle_id::text AS vehicle_id,
		       COALESCE(first_drive.start_lat, 0) AS start_latitude,
		       COALESCE(first_drive.start_lng, 0) AS start_longitude,
		       COALESCE(last_drive.end_lat, 0) AS end_latitude,
		       COALESCE(last_drive.end_lng, 0) AS end_longitude,
		       COALESCE(first_drive.start_place, '') AS start_address,
		       COALESCE(last_drive.end_place, '') AS end_address,
		       COALESCE(agg.distance_m, 0) AS distance_m,
		       COALESCE(agg.energy_used_wh, 0) AS energy_used_wh,
		       CASE WHEN COALESCE(agg.distance_m, 0) > 0
		            THEN COALESCE(agg.energy_used_wh, 0) / agg.distance_m
		            ELSE 0 END AS efficiency_wh_per_m,
		       COALESCE(agg.max_speed_mps, 0) AS max_speed_mps,
		       CASE WHEN t.ended_at IS NULL THEN 'started' ELSE 'completed' END AS fsm_state,
		       t.started_at,
		       COALESCE(t.ended_at, t.started_at) AS completed_at,
		       t.started_at AS created_at
		FROM trips t
		LEFT JOIN LATERAL (
			SELECT SUM(COALESCE(d.distance_m, 0)) AS distance_m,
			       SUM(COALESCE(d.energy_used_wh, 0)) AS energy_used_wh,
			       MAX(d.max_speed_mps) AS max_speed_mps
			FROM trip_drives td
			JOIN drives d ON d.id = td.drive_id
			WHERE td.trip_id = t.id
		) agg ON true
		LEFT JOIN LATERAL (
			SELECT d.start_lat, d.start_lng, d.start_place
			FROM trip_drives td
			JOIN drives d ON d.id = td.drive_id
			WHERE td.trip_id = t.id
			ORDER BY td.position ASC
			LIMIT 1
		) first_drive ON true
		LEFT JOIN LATERAL (
			SELECT d.end_lat, d.end_lng, d.end_place
			FROM trip_drives td
			JOIN drives d ON d.id = td.drive_id
			WHERE td.trip_id = t.id
			ORDER BY td.position DESC
			LIMIT 1
		) last_drive ON true`

// Trip SQL queries.
const (
	GetTripByID = tripSelectFrom + `
		WHERE t.id = $1::bigint`

	GetTripsByVehicleID = tripSelectFrom + `
		WHERE t.vehicle_id = $1::bigint
		ORDER BY t.started_at DESC`

	ListTripsByDateRange = tripSelectFrom + `
		WHERE t.vehicle_id = $1::bigint AND t.started_at >= $2 AND t.started_at <= $3
		ORDER BY t.started_at DESC`

	GetTripByIDForUpdate = tripSelectFrom + `
		WHERE t.id = $1::bigint
		FOR UPDATE OF t`

	// UpsertTrip persists only the four columns the trips table owns:
	//   $1 id, $2 vehicle_id, $3 started_at, $4 completed_at.
	// Distance, energy, speed and geo fields are derived at read time from the
	// joined drives (see tripSelectFrom), so they are never written here.
	// ended_at is NULL for an in-progress trip whose completed_at still equals
	// its started_at sentinel.
	UpsertTrip = `
		INSERT INTO trips (
			id, vehicle_id, started_at, ended_at
		) VALUES ($1::bigint, $2::bigint, $3, NULLIF($4, $3))
		ON CONFLICT (id) DO UPDATE SET
			vehicle_id = EXCLUDED.vehicle_id,
			started_at = EXCLUDED.started_at,
			ended_at = EXCLUDED.ended_at`
)
