package api

import (
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ChatbotHandler handles AI chatbot queries against fleet data.
type ChatbotHandler struct {
	chat *database.ChatRepo
	db   *database.DB
}

func NewChatbotHandler(db *database.DB) *ChatbotHandler {
	return &ChatbotHandler{
		chat: database.NewChatRepo(db),
		db:   db,
	}
}
