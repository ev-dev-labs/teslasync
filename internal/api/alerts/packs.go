package alerts

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/alertpacks"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
)

type packRepository interface {
	ListPackInstallations(context.Context, int, int) ([]alertpacks.Installation, error)
	InstallPack(context.Context, alertpacks.Pack, string, []alertpacks.Template) (*alertpacks.Installation, error)
	RemovePack(context.Context, int64, []int64) error
}

func (h *AlertHandler) ListPacks(w http.ResponseWriter, r *http.Request) {
	_, span := otel.Tracer("api").Start(r.Context(), "api.alerts.packs.catalog")
	defer span.End()
	writeJSON(w, http.StatusOK, append(alertpacks.Catalog(), alertpacks.CustomCatalog()))
}

func (h *AlertHandler) ListPackInstallations(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.alerts.packs.list")
	defer span.End()
	limit, offset := pagination(r)
	items, err := h.packRepo.ListPackInstallations(ctx, limit, offset)
	if err != nil {
		packError(w, span, err)
		return
	}
	if items == nil {
		items = []alertpacks.Installation{}
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *AlertHandler) InstallPack(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.alerts.packs.install")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	pack, found := alertpacks.Find(chi.URLParam(r, "packID"))
	if !found {
		writeError(w, http.StatusNotFound, "alert pack not found")
		return
	}
	var req alertpacks.InstallRequest
	if _, err := decodeStrictAlertRequest(r, &req, nil); err != nil {
		span.RecordError(err)
		writeError(w, http.StatusBadRequest, "invalid pack installation request: "+err.Error())
		return
	}
	templates, scope, err := alertpacks.Prepare(pack, req)
	if err != nil {
		span.RecordError(err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	channelSets := make([][]int64, 0, len(templates))
	for _, t := range templates {
		if err := validateAlertRule(&t.Rule); err != nil {
			span.RecordError(err)
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		channelSets = append(channelSets, t.Rule.ChannelIDs)
	}
	if !h.checkRuleChannelSets(w, r.WithContext(ctx), channelSets...) {
		return
	}
	if pack.ID == "custom" {
		pack, err = alertpacks.NameCustom(pack, req.Name, templates)
		if err != nil {
			span.RecordError(err)
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	result, err := h.packRepo.InstallPack(ctx, pack, scope, templates)
	if err != nil {
		packError(w, span, err)
		return
	}
	log.Info().Str("trace_id", span.SpanContext().TraceID().String()).Str("pack_id", pack.ID).Int64("installation_id", result.ID).Msg("alert pack installed")
	writeJSON(w, http.StatusCreated, result)
}

func (h *AlertHandler) RemovePack(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.alerts.packs.remove")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	id, err := urlParamInt64(r, "installationID")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid installation ID")
		return
	}
	var req struct {
		DeleteRuleIDs []int64 `json:"delete_rule_ids"`
	}
	if _, err := decodeStrictAlertRequest(r, &req, nil); err != nil {
		span.RecordError(err)
		writeError(w, http.StatusBadRequest, "invalid removal request: "+err.Error())
		return
	}
	if len(req.DeleteRuleIDs) > 100 {
		writeError(w, http.StatusBadRequest, "too many rules")
		return
	}
	for _, ruleID := range req.DeleteRuleIDs {
		if ruleID <= 0 {
			writeError(w, http.StatusBadRequest, "rule IDs must be positive")
			return
		}
	}
	if err := h.packRepo.RemovePack(ctx, id, req.DeleteRuleIDs); err != nil {
		packError(w, span, err)
		return
	}
	log.Info().Str("trace_id", span.SpanContext().TraceID().String()).Int64("installation_id", id).Msg("alert pack removed")
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}

func packError(w http.ResponseWriter, span trace.Span, err error) {
	span.RecordError(err)
	switch {
	case errors.Is(err, alertpacks.ErrInstalled), errors.Is(err, alertpacks.ErrSelection):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, alertpacks.ErrNotFound):
		writeError(w, http.StatusNotFound, "pack installation not found")
	default:
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			writeError(w, http.StatusBadRequest, "a selected vehicle no longer exists; refresh and try again")
			return
		}
		log.Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("alert pack operation failed")
		writeError(w, http.StatusInternalServerError, "alert pack operation failed")
	}
}
