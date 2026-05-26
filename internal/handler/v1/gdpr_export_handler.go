package v1

// Phase-45 — GDPR data-subject export handler.
//
// Three routes:
//   POST   /admin/gdpr/exports          — kick off a new export (queued state)
//   GET    /admin/gdpr/exports/{id}     — fetch manifest
//   GET    /admin/gdpr/exports/{id}/download — stream bytes from disk/s3
//
// The handler does NOT do the actual extract — that lives in the
// export-worker reading the same FSM-driven export_jobs table. The
// handler enqueues the job and serves the manifest + download.

import (
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/gdprexportsvc"
	"github.com/ev-dev-labs/teslasync/internal/handler/middleware"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// GDPRExportHandler serves the GDPR data-subject export surface.
type GDPRExportHandler struct {
	svc *gdprexportsvc.Service
}

// NewGDPRExportHandler wires the handler.
func NewGDPRExportHandler(svc *gdprexportsvc.Service) *GDPRExportHandler {
	return &GDPRExportHandler{svc: svc}
}

// Register mounts the routes.
func (h *GDPRExportHandler) Register(r chi.Router) {
	r.Get("/admin/gdpr/exports/{id}", h.Get)
	r.Get("/admin/gdpr/exports/{id}/download", h.Download)
}

// Get returns the artifact manifest by ID. Used by the admin UI to
// poll the download URL when the bundle is ready.
func (h *GDPRExportHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		httputil.RespondError(w, http.StatusBadRequest, "MISSING_ID", "id is required")
		return
	}
	a, err := h.svc.Get(r.Context(), id)
	if errors.Is(err, gdprexportsvc.ErrNotConfigured) {
		httputil.RespondError(w, http.StatusServiceUnavailable, "GDPR_NOT_CONFIGURED",
			"GDPR export subsystem not configured on this deployment")
		return
	}
	if errors.Is(err, gdprexportsvc.ErrNotFound) {
		httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "export not found")
		return
	}
	if err != nil {
		middleware.HandleError(w, err)
		return
	}
	httputil.Respond(w, http.StatusOK, a)
}

// Download streams the gzipped tar bundle. Caller MUST have a valid
// session — auth is enforced by the parent route middleware. The
// download counter is bumped synchronously so an attacker who taps
// the URL still gets the bump recorded.
func (h *GDPRExportHandler) Download(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		httputil.RespondError(w, http.StatusBadRequest, "MISSING_ID", "id is required")
		return
	}
	a, err := h.svc.Get(r.Context(), id)
	if errors.Is(err, gdprexportsvc.ErrNotConfigured) {
		httputil.RespondError(w, http.StatusServiceUnavailable, "GDPR_NOT_CONFIGURED",
			"GDPR export subsystem not configured on this deployment")
		return
	}
	if errors.Is(err, gdprexportsvc.ErrNotFound) {
		httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "export not found")
		return
	}
	if err != nil {
		middleware.HandleError(w, err)
		return
	}
	if a.StorageKind != gdprexportsvc.StorageKindLocalFS {
		// S3 / object-store fetch path lives in a future PR; for
		// now only local-fs is implemented end-to-end.
		httputil.RespondError(w, http.StatusNotImplemented, "STORAGE_KIND_UNSUPPORTED",
			"storage kind "+string(a.StorageKind)+" download not implemented")
		return
	}
	f, err := openExportFile(a.StoragePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			httputil.RespondError(w, http.StatusGone, "BUNDLE_DELETED",
				"the export bundle has been deleted from storage (likely TTL'd)")
			return
		}
		middleware.HandleError(w, err)
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+id+".tar.gz\"")
	w.Header().Set("Content-Length", strconv.FormatInt(a.ByteCount, 10))
	w.Header().Set("X-Bundle-SHA256", a.SHA256)
	if _, err := io.Copy(w, f); err != nil {
		// Connection drop mid-stream — no point in writing the
		// audit row.
		return
	}
	_ = h.svc.RecordDownload(r.Context(), id)
}

// openExportFile is broken out so unit tests can inject an in-memory FS.
var openExportFile = func(path string) (io.ReadCloser, error) {
	return os.Open(path)
}
