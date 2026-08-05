package serviceintelligence

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/integrations/nhtsa"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const communicationsAdminBodyLimit = 2 * 1024

type communicationsImporter interface {
	Status(ctx context.Context) (CommunicationsCatalogState, error)
	Import(ctx context.Context, artifactURL string) (*CommunicationImportStatus, error)
}

type CommunicationsAdminHandler struct {
	imports communicationsImporter
}

func NewCommunicationsAdminHandler(imports *CommunicationsImportService) *CommunicationsAdminHandler {
	if imports == nil {
		panic("serviceintelligence.NewCommunicationsAdminHandler: import service must not be nil")
	}
	return &CommunicationsAdminHandler{imports: imports}
}

// MountAdmin must be called inside the parent's authenticated administrator
// route boundary. Bulk imports are additionally rate-limited because they
// download and parse a bounded official NHTSA archive.
func MountAdmin(r chi.Router, handler *CommunicationsAdminHandler) {
	r.Get("/admin/service-intelligence/communications/status", handler.Status)
	r.With(httprate.LimitByIP(10, time.Hour)).
		Post("/admin/service-intelligence/communications/import", handler.Import)
}

type communicationImportRequest struct {
	ArtifactURL string `json:"artifact_url"`
}

func (h *CommunicationsAdminHandler) Status(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(
		r.Context(),
		"service_intelligence.communications_import_status",
	)
	defer span.End()
	state, err := h.imports.Status(ctx)
	if err != nil {
		h.writeAdminError(w, ctx, span, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	httpx.WriteJSON(w, http.StatusOK, state)
}

func (h *CommunicationsAdminHandler) Import(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(
		r.Context(),
		"service_intelligence.communications_import",
	)
	defer span.End()

	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, communicationsAdminBodyLimit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var request communicationImportRequest
	if err := decoder.Decode(&request); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid import payload")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpx.WriteError(w, http.StatusBadRequest, "import payload must contain one JSON object")
		return
	}
	if strings.TrimSpace(request.ArtifactURL) == "" {
		httpx.WriteError(w, http.StatusBadRequest, "artifact_url is required")
		return
	}

	status, err := h.imports.Import(ctx, request.ArtifactURL)
	if err != nil {
		h.writeAdminError(w, ctx, span, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	httpx.WriteJSON(w, http.StatusOK, status)
}

func (h *CommunicationsAdminHandler) writeAdminError(
	w http.ResponseWriter,
	ctx context.Context,
	span trace.Span,
	err error,
) {
	span.RecordError(err)
	span.SetStatus(codes.Error, "manufacturer communications import failed")
	log.Error().
		Err(err).
		Str("trace_id", traceID(ctx)).
		Msg("service intelligence: manufacturer communications admin request failed")

	switch {
	case errors.Is(err, nhtsa.ErrInvalidRequest):
		httpx.WriteError(w, http.StatusBadRequest, "artifact_url must reference an allow-listed official NHTSA TSB artifact")
	case errors.Is(err, ErrCommunicationImportInProgress):
		httpx.WriteError(w, http.StatusConflict, "a manufacturer communications import is already running")
	default:
		var upstream *nhtsa.UpstreamError
		if errors.As(err, &upstream) {
			if upstream.Kind == nhtsa.ErrorKindTimeout {
				httpx.WriteErrorCode(w, http.StatusGatewayTimeout, "official NHTSA artifact download timed out", "NHTSA_TIMEOUT")
				return
			}
			httpx.WriteErrorCode(w, http.StatusBadGateway, "official NHTSA artifact was unavailable or invalid", "NHTSA_UPSTREAM_ERROR")
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, "manufacturer communications import failed")
	}
}
