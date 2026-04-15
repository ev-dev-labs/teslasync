package queries

// User SQL queries.
const (
	GetUserByID = `
		SELECT id, email, display_name, avatar_url,
		       tesla_token_encrypted, tesla_refresh_token_encrypted,
		       token_expires_at, created_at, updated_at
		FROM users
		WHERE id = $1`

	GetUserByEmail = `
		SELECT id, email, display_name, avatar_url,
		       tesla_token_encrypted, tesla_refresh_token_encrypted,
		       token_expires_at, created_at, updated_at
		FROM users
		WHERE email = $1`

	UpsertUser = `
		INSERT INTO users (
			id, email, display_name, avatar_url,
			tesla_token_encrypted, tesla_refresh_token_encrypted,
			token_expires_at, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (id) DO UPDATE SET
			email = EXCLUDED.email,
			display_name = EXCLUDED.display_name,
			avatar_url = EXCLUDED.avatar_url,
			tesla_token_encrypted = EXCLUDED.tesla_token_encrypted,
			tesla_refresh_token_encrypted = EXCLUDED.tesla_refresh_token_encrypted,
			token_expires_at = EXCLUDED.token_expires_at,
			updated_at = EXCLUDED.updated_at`

	DeleteUser = `DELETE FROM users WHERE id = $1`
)
