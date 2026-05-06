// Phase-46 / Prompt 54 — Vehicle photo handler.
//
// Endpoints back the SPA's <VehiclePhotoUpload> + <VehicleHeroCard>:
//
//	POST   /api/v1/vehicles/{vehicleID}/photo
//	    multipart/form-data, file field "photo" (≤ MaxUploadBytes)
//	    Decodes JPEG/PNG (no WebP — see internal/imaging package
//	    doc), validates dimensions, resizes to 3 sizes (thumb /
//	    medium / full), re-encodes as JPEG (which strips EXIF),
//	    atomic-writes under cfg.VehiclePhotoDir, then upserts the
//	    index row. 200 on success with the metadata.
//
//	GET    /api/v1/vehicles/{vehicleID}/photo
//	    Metadata only — { has_photo, uploaded_at?, sizes? }. The SPA
//	    uses uploaded_at as a ?v= cache-buster on the <img src>.
//
//	GET    /api/v1/vehicles/{vehicleID}/photo/{size}
//	    Streams the file bytes for one of {thumb, medium, full}.
//	    404 when no row, 400 on bad size param.
//
//	DELETE /api/v1/vehicles/{vehicleID}/photo
//	    Idempotent — removes the DB row first then unlinks the
//	    on-disk bytes (so a partially-failed unlink leaves an
//	    orphan file but never an orphan DB row pointing at missing
//	    bytes).
//
// Concurrency:
//
//	Per-vehicle uploads serialise on a per-vehicle mutex so a
//	concurrent double-upload can't mix variants (thumb from A,
//	medium from B). Cross-vehicle uploads run unblocked.
//
// Body limit:
//
//	The handler enforces MaxUploadBytes via http.MaxBytesReader,
//	but the global 1 MB middleware in router.go would short-circuit
//	first — router.go is therefore patched to bypass the cap on the
//	POST /vehicles/{id}/photo path. See the bypassPaths block in
//	router.go.
package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/imaging"
)

// MaxUploadBytes caps the inbound multipart body. 8 MB is plenty
// for a phone photo at original resolution; the multipart envelope
// adds a few hundred bytes of overhead which fits well inside the
// 12 MB router-bypass ceiling.
const MaxUploadBytes int64 = 8 * 1024 * 1024

// PhotoSize identifiers map to the three rendered files. Values are
// also the URL-segment values for GET /photo/{size}.
const (
	PhotoSizeThumb  = "thumb"
	PhotoSizeMedium = "medium"
	PhotoSizeFull   = "full"
)

// PhotoMaxDimByName drives the resize ladder. Mirrors the prompt's
// "thumb 256 / medium 1024 / full 2048" specification.
var PhotoMaxDimByName = map[string]int{
	PhotoSizeThumb:  256,
	PhotoSizeMedium: 1024,
	PhotoSizeFull:   2048,
}

// PhotoSizesOrdered is the canonical ordering rendered by the SPA;
// also the order the handler writes files in (so a partial failure
// during the second size still leaves a usable thumb on disk).
var PhotoSizesOrdered = []string{PhotoSizeThumb, PhotoSizeMedium, PhotoSizeFull}

// AllowedPhotoMimeTypes lists the multipart Content-Type values the
// handler will accept on the upload form. The actual decode happens
// via image.DecodeConfig which sniffs magic bytes — so this list is
// a fast-fail on the part header, not the only validation.
//
// NOTE: WebP is intentionally absent — see internal/imaging package
// doc. The pure-stdlib decode path doesn't include a WebP decoder.
var AllowedPhotoMimeTypes = map[string]struct{}{
	"image/jpeg": {},
	"image/jpg":  {}, // some clients still send the unofficial subtype
	"image/png":  {},
}

// VehiclePhotoUploadFormField is the multipart part name the SPA
// uses for the photo. Centralised so the handler test references
// the same constant the frontend hardcodes.
const VehiclePhotoUploadFormField = "photo"

// PhotoErrorCode values are returned in the JSON `code` field so
// the SPA can pop targeted toasts.
const (
	PhotoCodeMissingFile      = "MISSING_FILE"
	PhotoCodeUnsupportedMime  = "UNSUPPORTED_MIME"
	PhotoCodeUnsupportedImage = "UNSUPPORTED_IMAGE"
	PhotoCodeInvalidImage     = "INVALID_IMAGE"
	PhotoCodeImageTooLarge    = "IMAGE_TOO_LARGE"
	PhotoCodeBodyTooLarge     = "BODY_TOO_LARGE"
	PhotoCodeBadSize          = "BAD_SIZE"
	PhotoCodeNotFound         = "PHOTO_NOT_FOUND"
)

// VehiclePhotoStore is the storage seam the handler uses to
// persist + look up photo index rows. Production wires
// *database.VehiclePhotoRepo; tests substitute an in-memory fake.
type VehiclePhotoStore interface {
	Get(ctx context.Context, vehicleID int64) (*database.VehiclePhotoRow, error)
	Upsert(ctx context.Context, vehicleID int64, thumb, medium, full string) (*database.VehiclePhotoRow, error)
	Delete(ctx context.Context, vehicleID int64) (*database.VehiclePhotoRow, error)
}

// VehiclePhotoHandler bundles the four photo endpoints.
type VehiclePhotoHandler struct {
	store    VehiclePhotoStore
	vehicles VehicleExistenceChecker
	rootDir  string

	// uploadLocks serialises uploads / deletes per vehicle so a
	// concurrent double-upload can't mix variants. The map grows
	// monotonically by vehicle id — bounded by the vehicle count
	// in practice.
	mu          sync.Mutex
	uploadLocks map[int64]*sync.Mutex

	// nowFn is the time source used for the on-disk filename
	// version segment. Overridable from tests so the path is
	// deterministic.
	nowFn func() time.Time
}

// NewVehiclePhotoHandler wires the handler. rootDir MUST be an
// absolute directory that the API process owns; the constructor
// MkdirAll's the path so an empty install bootstraps cleanly. A nil
// store, nil vehicle checker, or empty rootDir would surface as a
// nil-pointer panic on the first request — preferable to a silent
// half-disabled feature flag.
func NewVehiclePhotoHandler(
	store VehiclePhotoStore,
	vehicles VehicleExistenceChecker,
	rootDir string,
) *VehiclePhotoHandler {
	return &VehiclePhotoHandler{
		store:       store,
		vehicles:    vehicles,
		rootDir:     rootDir,
		uploadLocks: make(map[int64]*sync.Mutex),
		nowFn:       time.Now,
	}
}

// lockForVehicle returns the singleton per-vehicle mutex used to
// serialise concurrent uploads / deletes. Internal map access is
// guarded by h.mu so the get-or-create pattern stays race-free.
func (h *VehiclePhotoHandler) lockForVehicle(vehicleID int64) *sync.Mutex {
	h.mu.Lock()
	defer h.mu.Unlock()
	if mu, ok := h.uploadLocks[vehicleID]; ok {
		return mu
	}
	mu := &sync.Mutex{}
	h.uploadLocks[vehicleID] = mu
	return mu
}

// vehiclePhotoMetaResponse is the GET-without-size payload. Sizes is
// omitted when has_photo is false so the SPA can shortcut on the
// envelope alone.
type vehiclePhotoMetaResponse struct {
	HasPhoto   bool                       `json:"has_photo"`
	UploadedAt *time.Time                 `json:"uploaded_at,omitempty"`
	Sizes      *vehiclePhotoSizesResponse `json:"sizes,omitempty"`
}

type vehiclePhotoSizesResponse struct {
	Thumb  string `json:"thumb"`
	Medium string `json:"medium"`
	Full   string `json:"full"`
}

// GetMeta handles GET /vehicles/{vehicleID}/photo.
//
// Returns the thin metadata envelope used by the SPA to decide
// whether to render the hero photo or fall back to the stock model
// silhouette. NEVER returns 404 — an absent photo is reported as
// has_photo:false so the SPA's TanStack Query cache is happy.
func (h *VehiclePhotoHandler) GetMeta(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle id")
		return
	}
	if err := h.requireVehicleExists(r.Context(), w, vehicleID); err != nil {
		return
	}
	row, err := h.store.Get(r.Context(), vehicleID)
	if err != nil {
		if errors.Is(err, database.ErrVehiclePhotoNotFound) {
			writeJSON(w, http.StatusOK, vehiclePhotoMetaResponse{HasPhoto: false})
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to read photo metadata")
		return
	}
	uploaded := row.UploadedAt
	writeJSON(w, http.StatusOK, vehiclePhotoMetaResponse{
		HasPhoto:   true,
		UploadedAt: &uploaded,
		Sizes: &vehiclePhotoSizesResponse{
			Thumb:  PhotoSizeThumb,
			Medium: PhotoSizeMedium,
			Full:   PhotoSizeFull,
		},
	})
}

// GetFile handles GET /vehicles/{vehicleID}/photo/{size}.
//
// Streams the JPEG bytes for one of the three rendered sizes. The
// size segment is validated against PhotoMaxDimByName so a
// path-traversal attempt on the size param can't escape into
// arbitrary file reads.
func (h *VehiclePhotoHandler) GetFile(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle id")
		return
	}
	size := chi.URLParam(r, "size")
	if _, ok := PhotoMaxDimByName[size]; !ok {
		writeErrorCode(w, http.StatusBadRequest, "unsupported size", PhotoCodeBadSize)
		return
	}
	row, err := h.store.Get(r.Context(), vehicleID)
	if err != nil {
		if errors.Is(err, database.ErrVehiclePhotoNotFound) {
			writeErrorCode(w, http.StatusNotFound, "photo not found", PhotoCodeNotFound)
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to read photo")
		return
	}
	rel := relPathFromRow(row, size)
	abs, err := h.resolveSafePath(rel)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Str("size", size).Msg("photo path escapes root")
		writeError(w, http.StatusInternalServerError, "failed to resolve photo path")
		return
	}
	f, err := os.Open(abs)
	if err != nil {
		// File missing while the DB row still exists is a sane
		// failure mode — treat it as "not found" so the SPA can
		// re-prompt the user to upload.
		if errors.Is(err, os.ErrNotExist) {
			writeErrorCode(w, http.StatusNotFound, "photo file missing", PhotoCodeNotFound)
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to open photo file")
		return
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stat photo file")
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, filepath.Base(abs), stat.ModTime(), f)
}

// Upload handles POST /vehicles/{vehicleID}/photo.
//
// Multipart upload of one image part named "photo". On success
// returns 200 with the same envelope as GetMeta — the SPA uses
// uploaded_at as the ?v= cache-buster on the hero <img>.
func (h *VehiclePhotoHandler) Upload(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle id")
		return
	}
	if err := h.requireVehicleExists(r.Context(), w, vehicleID); err != nil {
		return
	}

	// Cap the body BEFORE parsing. router.go bypasses the global
	// 1 MB middleware for this path; the cap below is the actual
	// upload ceiling.
	r.Body = http.MaxBytesReader(w, r.Body, MaxUploadBytes)
	if err := r.ParseMultipartForm(MaxUploadBytes); err != nil {
		if isMaxBytesError(err) {
			writeErrorCode(w, http.StatusRequestEntityTooLarge, "upload exceeds 8 MB limit", PhotoCodeBodyTooLarge)
			return
		}
		writeErrorCode(w, http.StatusBadRequest, "invalid multipart payload", PhotoCodeInvalidImage)
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	file, header, err := r.FormFile(VehiclePhotoUploadFormField)
	if err != nil {
		writeErrorCode(w, http.StatusBadRequest, "missing photo file", PhotoCodeMissingFile)
		return
	}
	defer file.Close()

	// Fast-fail on the declared mime — image.DecodeConfig still
	// validates the actual bytes, but rejecting an unsupported
	// type before allocating the body buffer saves work.
	declared := strings.ToLower(strings.TrimSpace(header.Header.Get("Content-Type")))
	if declared != "" {
		if _, ok := AllowedPhotoMimeTypes[declared]; !ok {
			writeErrorCode(w, http.StatusUnsupportedMediaType, "unsupported mime type", PhotoCodeUnsupportedMime)
			return
		}
	}

	// Read the body into memory so we can DecodeConfig (header
	// only), then Decode (full pass) without re-streaming. The
	// body limit guarantees this allocation is bounded.
	raw, err := io.ReadAll(file)
	if err != nil {
		if isMaxBytesError(err) {
			writeErrorCode(w, http.StatusRequestEntityTooLarge, "upload exceeds 8 MB limit", PhotoCodeBodyTooLarge)
			return
		}
		writeError(w, http.StatusBadRequest, "failed to read upload")
		return
	}

	dec, err := imaging.Decode(bytes.NewReader(raw))
	if err != nil {
		switch {
		case errors.Is(err, imaging.ErrUnsupportedFormat):
			writeErrorCode(w, http.StatusUnsupportedMediaType, "unsupported image format", PhotoCodeUnsupportedImage)
		case errors.Is(err, imaging.ErrTooLarge):
			writeErrorCode(w, http.StatusRequestEntityTooLarge, "image dimensions exceed limit", PhotoCodeImageTooLarge)
		case errors.Is(err, imaging.ErrInvalidImage):
			writeErrorCode(w, http.StatusBadRequest, "invalid image data", PhotoCodeInvalidImage)
		default:
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("photo decode failed")
			writeError(w, http.StatusInternalServerError, "failed to decode image")
		}
		return
	}

	// Serialise per-vehicle from this point: we're about to write
	// three files + a DB row, and a concurrent second upload could
	// otherwise interleave its files into the first row.
	mu := h.lockForVehicle(vehicleID)
	mu.Lock()
	defer mu.Unlock()

	// Snapshot the existing row (if any) so we can unlink its
	// files after the new upsert succeeds — guarantees the DB
	// always points at files that exist on disk.
	prior, _ := h.store.Get(r.Context(), vehicleID)

	// Compose the photo: flatten any alpha onto white so JPEG
	// re-encode doesn't render transparency as black.
	flat := imaging.FlattenAlpha(dec.Image, imaging.WhiteBackground())

	// Build a per-upload version directory so a re-upload doesn't
	// fight a slow GET that's still streaming the previous file.
	uploadID := strconv.FormatInt(h.nowFn().UTC().UnixNano(), 10)
	relDir := filepath.ToSlash(filepath.Join(strconv.FormatInt(vehicleID, 10), uploadID))
	absDir, err := h.resolveSafePath(relDir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to resolve upload dir")
		return
	}
	if err := os.MkdirAll(absDir, 0o755); err != nil {
		log.Error().Err(err).Str("dir", absDir).Msg("photo mkdir failed")
		writeError(w, http.StatusInternalServerError, "failed to create upload dir")
		return
	}

	// staged tracks the relative paths of each successfully
	// written file so we can roll them back on a downstream
	// error (DB upsert failure, encode failure on a later size).
	var staged []string
	for _, size := range PhotoSizesOrdered {
		resized := imaging.Resize(flat, PhotoMaxDimByName[size])
		relPath := filepath.ToSlash(filepath.Join(relDir, size+".jpg"))
		absPath, err := h.resolveSafePath(relPath)
		if err != nil {
			h.cleanupStaged(staged)
			writeError(w, http.StatusInternalServerError, "failed to resolve write path")
			return
		}
		if err := writeAtomicJPEG(absPath, resized); err != nil {
			log.Error().Err(err).Str("path", absPath).Msg("photo encode failed")
			h.cleanupStaged(staged)
			writeError(w, http.StatusInternalServerError, "failed to write photo")
			return
		}
		staged = append(staged, relPath)
	}

	row, err := h.store.Upsert(
		r.Context(),
		vehicleID,
		filepath.ToSlash(filepath.Join(relDir, PhotoSizeThumb+".jpg")),
		filepath.ToSlash(filepath.Join(relDir, PhotoSizeMedium+".jpg")),
		filepath.ToSlash(filepath.Join(relDir, PhotoSizeFull+".jpg")),
	)
	if err != nil {
		h.cleanupStaged(staged)
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("photo upsert failed")
		writeError(w, http.StatusInternalServerError, "failed to record photo")
		return
	}

	// Best-effort: unlink the prior version's files now that the
	// DB row no longer references them. Failures here orphan
	// bytes but never break the live row.
	if prior != nil {
		h.cleanupStaged([]string{prior.ThumbPath, prior.MediumPath, prior.FullPath})
		h.removeEmptyParent(prior.ThumbPath)
	}

	uploaded := row.UploadedAt
	writeJSON(w, http.StatusOK, vehiclePhotoMetaResponse{
		HasPhoto:   true,
		UploadedAt: &uploaded,
		Sizes: &vehiclePhotoSizesResponse{
			Thumb:  PhotoSizeThumb,
			Medium: PhotoSizeMedium,
			Full:   PhotoSizeFull,
		},
	})
}

// Delete handles DELETE /vehicles/{vehicleID}/photo. Idempotent —
// 204 even when no row existed. Removes the DB row first so the
// "row points at files on disk" invariant holds even when the
// subsequent unlink fails.
func (h *VehiclePhotoHandler) Delete(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle id")
		return
	}
	if err := h.requireVehicleExists(r.Context(), w, vehicleID); err != nil {
		return
	}

	mu := h.lockForVehicle(vehicleID)
	mu.Lock()
	defer mu.Unlock()

	row, err := h.store.Delete(r.Context(), vehicleID)
	if err != nil {
		if errors.Is(err, database.ErrVehiclePhotoNotFound) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete photo")
		return
	}
	h.cleanupStaged([]string{row.ThumbPath, row.MediumPath, row.FullPath})
	h.removeEmptyParent(row.ThumbPath)
	w.WriteHeader(http.StatusNoContent)
}

// cleanupStaged unlinks the supplied disk-relative paths. Paths are
// resolved through resolveSafePath so a malicious DB write can't
// turn a stray cleanup into an arbitrary file delete. ENOENT is
// silently ignored (the file the row pointed at is already gone —
// the desired state); other errors are logged but never surfaced
// to the caller.
func (h *VehiclePhotoHandler) cleanupStaged(rels []string) {
	for _, rel := range rels {
		if rel == "" {
			continue
		}
		abs, err := h.resolveSafePath(rel)
		if err != nil {
			log.Warn().Err(err).Str("rel", rel).Msg("photo cleanup skipped: unsafe path")
			continue
		}
		if err := os.Remove(abs); err != nil && !errors.Is(err, os.ErrNotExist) {
			log.Warn().Err(err).Str("path", abs).Msg("photo cleanup unlink failed")
		}
	}
}

// removeEmptyParent attempts to rmdir the immediate parent of rel
// when it's empty. Used to clean up the per-upload version dir
// after we've removed the prior set's files. Failures are logged at
// debug level — a non-empty dir is the expected case when the row
// has only been partially cleaned (e.g. ENOENT on an inner file).
func (h *VehiclePhotoHandler) removeEmptyParent(rel string) {
	if rel == "" {
		return
	}
	parent := filepath.Dir(rel)
	if parent == "." || parent == "" || parent == "/" {
		return
	}
	abs, err := h.resolveSafePath(parent)
	if err != nil {
		return
	}
	if err := os.Remove(abs); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Debug().Err(err).Str("dir", abs).Msg("photo parent dir not empty")
	}
}

// resolveSafePath joins rel onto the configured root and returns
// the absolute path, but only after verifying the result stays
// inside the root. A bad DB row containing "../etc/passwd" would
// otherwise turn a GET / DELETE into arbitrary file IO.
func (h *VehiclePhotoHandler) resolveSafePath(rel string) (string, error) {
	if h.rootDir == "" {
		return "", errors.New("photo root not configured")
	}
	clean := filepath.Clean("/" + filepath.ToSlash(rel))
	abs := filepath.Join(h.rootDir, clean)
	rootAbs, err := filepath.Abs(h.rootDir)
	if err != nil {
		return "", fmt.Errorf("photo root abs: %w", err)
	}
	resolvedAbs, err := filepath.Abs(abs)
	if err != nil {
		return "", fmt.Errorf("photo abs: %w", err)
	}
	rel2, err := filepath.Rel(rootAbs, resolvedAbs)
	if err != nil {
		return "", err
	}
	if rel2 == ".." || strings.HasPrefix(rel2, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("photo path escapes root: %s", rel)
	}
	return resolvedAbs, nil
}

// requireVehicleExists writes a 404 (or a propagated 500 on a real
// error) and returns a non-nil error when the vehicle id does not
// resolve. The non-nil error is the caller's signal to STOP — the
// HTTP response has already been written.
func (h *VehiclePhotoHandler) requireVehicleExists(ctx context.Context, w http.ResponseWriter, vehicleID int64) error {
	exists, err := h.vehicles.Exists(ctx, vehicleID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check vehicle")
		return err
	}
	if !exists {
		writeErrorCode(w, http.StatusNotFound, "vehicle not found", VehicleSettingsCodeNotFound)
		return errors.New("vehicle not found")
	}
	return nil
}

// relPathFromRow returns the disk-relative path for the requested
// size. Caller has already validated `size` against the supported
// set; the default branch is unreachable but keeps the compiler
// happy.
func relPathFromRow(row *database.VehiclePhotoRow, size string) string {
	switch size {
	case PhotoSizeThumb:
		return row.ThumbPath
	case PhotoSizeMedium:
		return row.MediumPath
	case PhotoSizeFull:
		return row.FullPath
	default:
		return ""
	}
}

// writeAtomicJPEG writes img to a temporary file in the same
// directory as path, fsyncs, and renames into place. Atomic-rename
// guarantees a concurrent reader sees either the old file or the
// new file — never a half-written one.
func writeAtomicJPEG(path string, img image.Image) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "photo-*.tmp")
	if err != nil {
		return fmt.Errorf("photo: create tmp: %w", err)
	}
	tmpName := tmp.Name()
	cleanup := func() {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
	}
	if err := imaging.EncodeJPEG(tmp, img); err != nil {
		cleanup()
		return err
	}
	if err := tmp.Sync(); err != nil {
		cleanup()
		return fmt.Errorf("photo: fsync tmp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("photo: close tmp: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("photo: rename: %w", err)
	}
	return nil
}
