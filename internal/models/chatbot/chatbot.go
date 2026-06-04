package chatbot

import "time"

// ChatMessage represents a single chatbot message.
type ChatMessage struct {
	ID        int64     `json:"id" db:"id"`
	SessionID string    `json:"session_id" db:"session_id"`
	Role      string    `json:"role" db:"role"` // user, assistant
	Content   string    `json:"content" db:"content"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// ChatSessionInfo is the per-session metadata returned by the Sessions
// listing endpoint. The frontend sidebar uses Title (renameable, may fall
// back to FirstMessage when no explicit title is set), MessageCount, and
// LastMessageAt to render and order the list. Backed by chatbot_sessions
// joined against chatbot_messages.
type ChatSessionInfo struct {
	ID            string     `json:"id" db:"session_id"`
	Title         *string    `json:"title" db:"title"`
	FirstMessage  *string    `json:"first_message" db:"first_message"`
	MessageCount  int        `json:"message_count" db:"message_count"`
	LastMessageAt *time.Time `json:"last_message_at" db:"last_message_at"`
	CreatedAt     *time.Time `json:"created_at" db:"created_at"`
}
