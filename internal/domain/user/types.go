package user

import "time"

type User struct {
	ID                         string    `json:"id" db:"id"`
	Email                      string    `json:"email" db:"email"`
	DisplayName                string    `json:"displayName" db:"display_name"`
	AvatarURL                  string    `json:"avatarUrl,omitempty" db:"avatar_url"`
	TeslaTokenEncrypted        string    `json:"-" db:"tesla_token_encrypted"`
	TeslaRefreshTokenEncrypted string    `json:"-" db:"tesla_refresh_token_encrypted"`
	TokenExpiresAt             time.Time `json:"-" db:"token_expires_at"`
	CreatedAt                  time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt                  time.Time `json:"updatedAt" db:"updated_at"`
}
