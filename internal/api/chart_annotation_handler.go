package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	dashboardmodel "github.com/ev-dev-labs/teslasync/internal/models/dashboard"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	dbadmin "github.com/ev-dev-labs/teslasync/internal/database/admin"
)

// chartAnnotationRepo is the slice of *dbadmin.ChartAnnotationRepo the
// handler depends on. The interface lets the unit tests drop in an in-memory
// fake without standing up a real Postgres pool.
type chartAnnotationRepo interface {
	List(ctx context.Context, f dbadmin.ChartAnnotationFilter) ([]*dashboardmodel.ChartAnnotation, error)
	GetByID(ctx context.Context, id int64) (*dashboardmodel.ChartAnnotation, error)
	Create(ctx context.Context, a *dashboardmodel.ChartAnnotation) error
	Update(ctx context.Context, id int64, patch dbadmin.ChartAnnotationUpdate) error
	Delete(ctx context.Context, id int64) error
}

// ChartAnnotationHandler exposes CRUD over user-authored chart annotations
// (Phase 40 / Prompt 43). Annotations replace the localStorage-only store
// the frontend used previously, so they survive a device swap or a fresh
// browser profile.
type ChartAnnotationHandler struct {
	repo chartAnnotationRepo
}

func NewChartAnnotationHandler(db *database.DB) *ChartAnnotationHandler {
	return &ChartAnnotationHandler{repo: dbadmin.NewChartAnnotationRepo(db)}
}

// maxChartAnnotationBodyBytes caps each request body. Annotations are tiny
// (title ≤ 100, description rarely > 1 KB) so 16 KB is generous.
const maxChartAnnotationBodyBytes = 16 << 10

// chartAnnotationWriteRequest is the wire shape for POST and PATCH. Every
// field is a pointer so PATCH can distinguish "leave alone" from "set to
// the zero value". `ClearDescription` / `ClearColor` are explicit erasers.
type chartAnnotationWriteRequest struct {
	VehicleID        *int64    `json:"vehicle_id,omitempty"`
	OccurredAt       *string   `json:"occurred_at,omitempty"`
	Category         *string   `json:"category,omitempty"`
	Title            *string   `json:"title,omitempty"`
	Description      *string   `json:"description,omitempty"`
	Scope            *[]string `json:"scope,omitempty"`
	Color            *string   `json:"color,omitempty"`
	ClearDescription bool      `json:"clear_description,omitempty"`
	ClearColor       bool      `json:"clear_color,omitempty"`
}

// List returns annotations for the optionally-supplied vehicle / time-window
// / chart-bucket scope.
//
//	GET /api/v1/annotations
//	GET /api/v1/annotations?vehicle_id=42&from=2024-01-01&to=2024-12-31&scope=battery
func (h *ChartAnnotationHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	var vehicleID *int64
	if raw := strings.TrimSpace(q.Get("vehicle_id")); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v <= 0 {
			writeError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
			return
		}
		vehicleID = &v
	}

	var from, to *time.Time
	if raw := strings.TrimSpace(q.Get("from")); raw != "" {
		t, err := parseAnnotationTime(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid from timestamp (expected RFC3339 or YYYY-MM-DD)")
			return
		}
		from = &t
	}
	if raw := strings.TrimSpace(q.Get("to")); raw != "" {
		t, err := parseAnnotationTime(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid to timestamp (expected RFC3339 or YYYY-MM-DD)")
			return
		}
		to = &t
	}

	scope := strings.TrimSpace(q.Get("scope"))
	if scope != "" && !isValidScopeBucket(scope) {
		writeError(w, http.StatusBadRequest, "invalid scope bucket")
		return
	}

	rows, err := h.repo.List(r.Context(), dbadmin.ChartAnnotationFilter{
		VehicleID: vehicleID,
		From:      from,
		To:        to,
		Scope:     scope,
	})
	if err != nil {
		log.Error().Err(err).Msg("chart_annotations list failed")
		writeError(w, http.StatusInternalServerError, "failed to list annotations")
		return
	}
	if rows == nil {
		rows = []*dashboardmodel.ChartAnnotation{}
	}
	writeJSON(w, http.StatusOK, rows)
}

// Create inserts a new annotation.
//
//	POST /api/v1/annotations
//	body: { "vehicle_id": 42, "occurred_at": "2024-06-15T00:00:00Z",
//	        "category": "maintenance", "title": "Tire rotation",
//	        "description": "Front to back", "scope": ["tire"] }
func (h *ChartAnnotationHandler) Create(w http.ResponseWriter, r *http.Request) {
	body, readErr := readChartAnnotationBody(r)
	if readErr != nil {
		writeError(w, readErr.status, readErr.msg)
		return
	}

	var req chartAnnotationWriteRequest
	if jsonErr := json.Unmarshal(body, &req); jsonErr != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	if req.OccurredAt == nil || strings.TrimSpace(*req.OccurredAt) == "" {
		writeError(w, http.StatusBadRequest, "occurred_at is required")
		return
	}
	occurredAt, err := parseAnnotationTime(*req.OccurredAt)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid occurred_at timestamp")
		return
	}

	if req.Category == nil {
		writeError(w, http.StatusBadRequest, "category is required")
		return
	}
	cat := dashboardmodel.AnnotationCategory(*req.Category)
	if !cat.Valid() {
		writeError(w, http.StatusBadRequest, "invalid category")
		return
	}

	if req.Title == nil {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	title := strings.TrimSpace(*req.Title)
	if title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	if len([]rune(title)) > 100 {
		writeError(w, http.StatusBadRequest, "title must be 100 characters or fewer")
		return
	}

	if req.VehicleID != nil && *req.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id must be a positive integer when provided")
		return
	}

	scope := []string{}
	if req.Scope != nil {
		for _, s := range *req.Scope {
			s = strings.TrimSpace(s)
			if s == "" {
				continue
			}
			if !isValidScopeBucket(s) {
				writeError(w, http.StatusBadRequest, "invalid scope bucket: "+s)
				return
			}
			scope = append(scope, s)
		}
	}

	row := &dashboardmodel.ChartAnnotation{
		VehicleID:  req.VehicleID,
		OccurredAt: occurredAt,
		Category:   cat,
		Title:      title,
		Scope:      scope,
	}
	if req.Description != nil {
		desc := strings.TrimSpace(*req.Description)
		if desc != "" {
			if len(desc) > 2000 {
				writeError(w, http.StatusBadRequest, "description must be 2000 characters or fewer")
				return
			}
			row.Description = &desc
		}
	}
	if req.Color != nil {
		c := strings.TrimSpace(*req.Color)
		if c != "" {
			if !isValidHexColor(c) {
				writeError(w, http.StatusBadRequest, "color must be a hex string like #RRGGBB")
				return
			}
			row.Color = &c
		}
	}

	if err := h.repo.Create(r.Context(), row); err != nil {
		log.Error().Err(err).Msg("chart_annotations create failed")
		writeError(w, http.StatusInternalServerError, "failed to create annotation")
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

// Update mutates an existing annotation. Pass any subset of fields.
//
//	PATCH /api/v1/annotations/{id}
func (h *ChartAnnotationHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid annotation id")
		return
	}

	body, readErr := readChartAnnotationBody(r)
	if readErr != nil {
		writeError(w, readErr.status, readErr.msg)
		return
	}

	var req chartAnnotationWriteRequest
	if jsonErr := json.Unmarshal(body, &req); jsonErr != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	patch := dbadmin.ChartAnnotationUpdate{
		ClearDescription: req.ClearDescription,
		ClearColor:       req.ClearColor,
	}

	if req.OccurredAt != nil {
		occurredAt, parseErr := parseAnnotationTime(*req.OccurredAt)
		if parseErr != nil {
			writeError(w, http.StatusBadRequest, "invalid occurred_at timestamp")
			return
		}
		patch.OccurredAt = &occurredAt
	}
	if req.Category != nil {
		cat := dashboardmodel.AnnotationCategory(*req.Category)
		if !cat.Valid() {
			writeError(w, http.StatusBadRequest, "invalid category")
			return
		}
		patch.Category = &cat
	}
	if req.Title != nil {
		title := strings.TrimSpace(*req.Title)
		if title == "" {
			writeError(w, http.StatusBadRequest, "title must not be empty")
			return
		}
		if len([]rune(title)) > 100 {
			writeError(w, http.StatusBadRequest, "title must be 100 characters or fewer")
			return
		}
		patch.Title = &title
	}
	if req.Description != nil && !req.ClearDescription {
		desc := strings.TrimSpace(*req.Description)
		if desc != "" && len(desc) > 2000 {
			writeError(w, http.StatusBadRequest, "description must be 2000 characters or fewer")
			return
		}
		patch.Description = &desc
	}
	if req.Scope != nil {
		scope := make([]string, 0, len(*req.Scope))
		for _, s := range *req.Scope {
			s = strings.TrimSpace(s)
			if s == "" {
				continue
			}
			if !isValidScopeBucket(s) {
				writeError(w, http.StatusBadRequest, "invalid scope bucket: "+s)
				return
			}
			scope = append(scope, s)
		}
		patch.Scope = &scope
	}
	if req.Color != nil && !req.ClearColor {
		c := strings.TrimSpace(*req.Color)
		if c != "" && !isValidHexColor(c) {
			writeError(w, http.StatusBadRequest, "color must be a hex string like #RRGGBB")
			return
		}
		patch.Color = &c
	}

	if err := h.repo.Update(r.Context(), id, patch); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "annotation not found")
			return
		}
		log.Error().Err(err).Int64("id", id).Msg("chart_annotations update failed")
		writeError(w, http.StatusInternalServerError, "failed to update annotation")
		return
	}

	updated, err := h.repo.GetByID(r.Context(), id)
	if err != nil || updated == nil {
		writeError(w, http.StatusInternalServerError, "failed to reload annotation")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// Delete removes an annotation by id.
//
//	DELETE /api/v1/annotations/{id}
func (h *ChartAnnotationHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid annotation id")
		return
	}

	if delErr := h.repo.Delete(r.Context(), id); delErr != nil {
		if errors.Is(delErr, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "annotation not found")
			return
		}
		log.Error().Err(delErr).Int64("id", id).Msg("chart_annotations delete failed")
		writeError(w, http.StatusInternalServerError, "failed to delete annotation")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── helpers ─────────────────────────────────────────────────────────────────

type chartAnnotationBodyError struct {
	status int
	msg    string
}

func readChartAnnotationBody(r *http.Request) ([]byte, *chartAnnotationBodyError) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxChartAnnotationBodyBytes+1))
	if err != nil {
		return nil, &chartAnnotationBodyError{http.StatusBadRequest, "failed to read request body"}
	}
	if len(body) > maxChartAnnotationBodyBytes {
		return nil, &chartAnnotationBodyError{http.StatusRequestEntityTooLarge, "annotation payload exceeds 16 KB limit"}
	}
	return body, nil
}

// parseAnnotationTime accepts both full RFC3339 timestamps and date-only
// strings (YYYY-MM-DD). Date-only inputs are pinned to UTC midnight so the
// chart's vertical line lands on the day boundary in any viewer's timezone.
func parseAnnotationTime(raw string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse("2006-01-02", raw); err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, errors.New("invalid timestamp")
}

// validScopeBuckets enumerates the chart "buckets" the frontend uses to
// scope annotations to a chart family. Keep this in sync with the
// `AnnotationScope` union in web/src/types/annotations.ts.
var validScopeBuckets = map[string]struct{}{
	"battery":    {},
	"efficiency": {},
	"cost":       {},
	"tire":       {},
	"energy":     {},
	"drivetrain": {},
	"mileage":    {},
	"charging":   {},
}

func isValidScopeBucket(s string) bool {
	_, ok := validScopeBuckets[s]
	return ok
}

// isValidHexColor accepts the conventional `#RGB`, `#RRGGBB`, and
// `#RRGGBBAA` shapes that come out of the colour picker.
func isValidHexColor(s string) bool {
	if len(s) < 4 || s[0] != '#' {
		return false
	}
	hex := s[1:]
	switch len(hex) {
	case 3, 6, 8:
	default:
		return false
	}
	for _, r := range hex {
		switch {
		case r >= '0' && r <= '9',
			r >= 'a' && r <= 'f',
			r >= 'A' && r <= 'F':
		default:
			return false
		}
	}
	return true
}
