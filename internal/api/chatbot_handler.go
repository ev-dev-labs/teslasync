package api

import (
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/service"
)

// ChatbotHandler handles AI chatbot queries against fleet data.
type ChatbotHandler struct {
	chat       *database.ChatRepo
	db         *database.DB
	vehicleSvc *service.VehicleService
}

func NewChatbotHandler(db *database.DB, vehicleSvc *service.VehicleService) *ChatbotHandler {
	return &ChatbotHandler{
		chat:       database.NewChatRepo(db),
		db:         db,
		vehicleSvc: vehicleSvc,
	}
}
