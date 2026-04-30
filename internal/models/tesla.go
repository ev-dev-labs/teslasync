package models

import "time"

// TeslaToken mirrors the post-migration tesla_tokens schema.
//
// ADR-005: no raw_json column. AccessToken and RefreshToken are stored as
// ciphertext; encryption/decryption is performed by internal/crypto/.
type TeslaToken struct {
	ID              int64      `db:"id" json:"id"`
	AccountEmail    string     `db:"account_email" json:"account_email"`
	AccessToken     string     `db:"access_token" json:"-"`
	RefreshToken    string     `db:"refresh_token" json:"-"`
	TokenType       string     `db:"token_type" json:"token_type"`
	Scopes          *string    `db:"scopes" json:"scopes,omitempty"`
	ExpiresAt       time.Time  `db:"expires_at" json:"expires_at"`
	ObtainedAt      time.Time  `db:"obtained_at" json:"obtained_at"`
	LastRefreshedAt *time.Time `db:"last_refreshed_at" json:"last_refreshed_at,omitempty"`
	CreatedAt       time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt       time.Time  `db:"updated_at" json:"updated_at"`
}

// IsActive reports whether the token has not yet expired.
func (t *TeslaToken) IsActive() bool {
	if t == nil {
		return false
	}
	return time.Now().Before(t.ExpiresAt)
}

// APICallLog mirrors the post-migration api_call_logs schema (hypertable).
//
// Request/response bodies are stored as nullable TEXT, truncated to 10 KB
// on the Go side to prevent storage bloat.
type APICallLog struct {
	ID           int64     `db:"id" json:"id"`
	Ts           time.Time `db:"ts" json:"ts"`
	VehicleID    *int64    `db:"vehicle_id" json:"vehicle_id,omitempty"`
	Service      string    `db:"service" json:"service"`
	HTTPMethod   string    `db:"http_method" json:"http_method"`
	Endpoint     string    `db:"endpoint" json:"endpoint"`
	StatusCode   int16     `db:"status_code" json:"status_code"`
	DurationMs   int32     `db:"duration_ms" json:"duration_ms"`
	ErrorMessage *string   `db:"error_message" json:"error_message,omitempty"`
	RateLimited  bool      `db:"rate_limited" json:"rate_limited"`
	RequestBody  *string   `db:"request_body" json:"request_body,omitempty"`
	ResponseBody *string   `db:"response_body" json:"response_body,omitempty"`
}
