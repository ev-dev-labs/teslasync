package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/go-chi/chi/v5"
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

// Sessions lists recent chat sessions with rich per-session metadata
// (title, message count, timestamps, first-message preview). Replaces the
// pre-Phase-40 behavior of returning a bare []string of session ids — the
// frontend sidebar (Phase 40 / Prompt 56) needs the title and timestamps
// to render and order entries.
func (h *ChatbotHandler) Sessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := h.chat.ListSessions(r.Context(), 50)
	if err != nil {
		log.Error().Err(err).Msg("failed to get chat sessions")
		writeError(w, http.StatusInternalServerError, "failed to get sessions")
		return
	}
	if sessions == nil {
		sessions = []*models.ChatSessionInfo{}
	}
	writeJSON(w, http.StatusOK, sessions)
}

// RenameSession sets (or clears) the human-readable title for a session.
// PATCH /chatbot/sessions/{id} with body {"title": "My new name"}.
// An empty / whitespace-only title clears the override and the frontend
// falls back to the first user message in the session.
func (h *ChatbotHandler) RenameSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "id")
	if strings.TrimSpace(sessionID) == "" {
		writeError(w, http.StatusBadRequest, "session id is required")
		return
	}
	var body struct {
		Title string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.chat.RenameSession(r.Context(), sessionID, body.Title); err != nil {
		log.Error().Err(err).Str("session_id", sessionID).Msg("failed to rename chat session")
		writeError(w, http.StatusInternalServerError, "failed to rename session")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": sessionID, "title": strings.TrimSpace(body.Title)})
}

// DeleteSession removes a chat session entirely, including all messages
// and any sidecar metadata (title). DELETE /chatbot/sessions/{id}.
func (h *ChatbotHandler) DeleteSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "id")
	if strings.TrimSpace(sessionID) == "" {
		writeError(w, http.StatusBadRequest, "session id is required")
		return
	}
	if err := h.chat.DeleteSession(r.Context(), sessionID); err != nil {
		log.Error().Err(err).Str("session_id", sessionID).Msg("failed to delete chat session")
		writeError(w, http.StatusInternalServerError, "failed to delete session")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
