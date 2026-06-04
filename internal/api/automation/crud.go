package automation

import (
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/automation/condition"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// newAutomationResponse builds a response for an Automation (base row only).
func newAutomationResponse(a *models.Automation) automationResponse {
	return automationResponse{Automation: a}
}

// ── List ────────────────────────────────────────────────────────────────

// List returns all automations. Supports ?enabled=true to filter.
func (h *AutomationHandler) List(w http.ResponseWriter, r *http.Request) {
	enabledOnly := strings.EqualFold(r.URL.Query().Get("enabled"), "true")
	fullList, err := h.repo.ListFull(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list automations")
		writeError(w, http.StatusInternalServerError, "failed to list automations")
		return
	}

	results := make([]automationResponse, 0, len(fullList))
	for i := range fullList {
		a := &fullList[i].Automation
		if enabledOnly && !a.Enabled {
			continue
		}
		results = append(results, newAutomationResponse(a))
	}
	writeJSON(w, http.StatusOK, results)
}

// ── Get ─────────────────────────────────────────────────────────────────

// Get returns a single automation by ID with computed fields.
func (h *AutomationHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	a, err := h.getByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if a == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	writeJSON(w, http.StatusOK, newAutomationResponse(a))
}

// ── Create ──────────────────────────────────────────────────────────────

// Create creates a new automation with typed step validation and conflict detection.
func (h *AutomationHandler) Create(w http.ResponseWriter, r *http.Request) {
	req, err := decodeAutomationInputDTO(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	desc := strings.TrimSpace(req.Description)
	var descPtr *string
	if desc != "" {
		descPtr = &desc
	}

	a := &models.Automation{
		Name:        strings.TrimSpace(req.Name),
		Description: descPtr,
		VehicleID:   req.VehicleID,
		Enabled:     enabled,
	}
	steps, err := automationStepWrites(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if err := h.repo.CreateWithSteps(r.Context(), a, steps); err != nil {
		log.Error().Err(err).Str("name", a.Name).Msg("failed to create automation")
		writeError(w, http.StatusInternalServerError, "failed to create automation")
		return
	}

	// Run conflict detection.
	resp := newAutomationResponse(a)
	resp.Conflicts = h.detectConflicts(r, a)

	log.Info().
		Int64("automation_id", a.ID).
		Str("automation", a.Name).
		Int("conflicts", len(resp.Conflicts)).
		Msg("automation created")

	if h.auditor != nil {
		h.auditor.LogCreated(r.Context(), a.ID, a.Name, firstTriggerKind(req), a.Enabled, r.RemoteAddr)
	}

	h.notifyReload(r.Context(), "created", a.ID)

	writeJSON(w, http.StatusCreated, resp)
}

// ── Update ──────────────────────────────────────────────────────────────

// Update replaces an automation's configuration. This is full-replacement PUT.
func (h *AutomationHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	existing, err := h.getByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation for update")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	req, err := decodeAutomationInputDTO(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	enabled := existing.Enabled
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	existing.Name = strings.TrimSpace(req.Name)
	desc := strings.TrimSpace(req.Description)
	if desc != "" {
		existing.Description = &desc
	}
	existing.VehicleID = req.VehicleID
	existing.Enabled = enabled
	steps, err := automationStepWrites(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if err := h.repo.UpdateWithSteps(r.Context(), existing, steps); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to update automation")
		writeError(w, http.StatusInternalServerError, "failed to update automation")
		return
	}

	resp := newAutomationResponse(existing)
	resp.Conflicts = h.detectConflicts(r, existing)

	log.Info().
		Int64("automation_id", existing.ID).
		Str("automation", existing.Name).
		Int("conflicts", len(resp.Conflicts)).
		Msg("automation updated")

	if h.auditor != nil {
		h.auditor.LogUpdated(r.Context(), existing.ID, existing.Name, firstTriggerKind(req), r.RemoteAddr)
	}

	h.notifyReload(r.Context(), "updated", existing.ID)

	writeJSON(w, http.StatusOK, resp)
}

// ── Delete ──────────────────────────────────────────────────────────────

// Delete removes an automation by ID.
func (h *AutomationHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	// Verify existence before deleting.
	existing, err := h.getByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation for delete")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	if err := h.repo.Delete(r.Context(), id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to delete automation")
		writeError(w, http.StatusInternalServerError, "failed to delete automation")
		return
	}

	log.Info().
		Int64("automation_id", id).
		Str("automation", existing.Name).
		Msg("automation deleted")

	if h.auditor != nil {
		h.auditor.LogDeleted(r.Context(), id, existing.Name, r.RemoteAddr)
	}

	h.notifyReload(r.Context(), "deleted", id)

	w.WriteHeader(http.StatusNoContent)
}

// detectConflicts fetches all automations and runs conflict detection
// against the candidate. Returns an empty slice (not nil) if none found.
func (h *AutomationHandler) detectConflicts(r *http.Request, candidate *models.Automation) []condition.Conflict {
	all, err := h.repo.ListFull(r.Context())
	if err != nil {
		log.Warn().Err(err).Msg("conflict detection: failed to fetch automations")
		return []condition.Conflict{}
	}
	candidateFull := &models.AutomationFull{Automation: *candidate}
	others := make([]*models.AutomationFull, len(all))
	for i := range all {
		others[i] = &all[i]
	}
	conflicts := condition.DetectConflicts(r.Context(), candidateFull, others)
	if conflicts == nil {
		return []condition.Conflict{}
	}
	return conflicts
}
