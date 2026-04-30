package api

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/rs/zerolog/log"
)

// History returns chat messages for a session.
func (h *ChatbotHandler) History(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		writeError(w, http.StatusBadRequest, "session_id is required")
		return
	}
	msgs, err := h.chat.GetHistory(r.Context(), sessionID, 100)
	if err != nil {
		log.Error().Err(err).Msg("failed to get chat history")
		writeError(w, http.StatusInternalServerError, "failed to get history")
		return
	}
	if msgs == nil {
		msgs = []*models.ChatMessage{}
	}
	writeJSON(w, http.StatusOK, msgs)
}

// Sessions lists recent chat sessions.
func (h *ChatbotHandler) Sessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := h.chat.GetSessions(r.Context(), 50)
	if err != nil {
		log.Error().Err(err).Msg("failed to get chat sessions")
		writeError(w, http.StatusInternalServerError, "failed to get sessions")
		return
	}
	if sessions == nil {
		sessions = []string{}
	}
	writeJSON(w, http.StatusOK, sessions)
}
