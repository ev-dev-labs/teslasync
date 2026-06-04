// Per-vehicle ingest X-Ray HTTP handler.
//
// GET /api/v1/system/ingest-xray/{vehicleID} exposes recent signal_log flow for
// operators. It uses two bounded indexed scans: per-field counts answer what is
// arriving, while bucket counts show whether ingestion is still flowing.

package ingestxray

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
)

// Handler bundles the per-vehicle X-Ray endpoint.
type Handler struct {
	repo ingestXRayRepo
}

// ingestXRayRepo is the narrow read surface used by the handler so
// tests can inject fakes without touching the database. The concrete
// *dbobs.IngestXRayRepo satisfies this interface.
type ingestXRayRepo interface {
	FieldStats(ctx context.Context, vehicleID int64, since time.Time, limit int) ([]dbobs.IngestXRayFieldStat, error)
	SampleCountByBucket(ctx context.Context, vehicleID int64, since time.Time, bucketWidth time.Duration) ([]dbobs.IngestXRayBucket, error)
	LastSeen(ctx context.Context, vehicleID int64) (time.Time, error)
}

// NewHandler constructs a handler bound to repo. repo may be
// nil — the endpoint degrades to 503 in that branch.
func NewHandler(repo *dbobs.IngestXRayRepo) *Handler {
	if repo == nil {
		return &Handler{repo: nil}
	}
	return &Handler{repo: repo}
}

// newHandlerForTest constructs a handler with a fake repo
// implementing ingestXRayRepo. Exported for the handler tests only.
func newHandlerForTest(repo ingestXRayRepo) *Handler {
	return &Handler{repo: repo}
}

// IngestXRayResponse is the JSON shape returned by Get.
type IngestXRayResponse struct {
	VehicleID        int64                       `json:"vehicle_id"`
	Now              string                      `json:"now"`
	WindowStart      string                      `json:"window_start"`
	Window           string                      `json:"window"`
	Bucket           string                      `json:"bucket"`
	LastSeenAt       *string                     `json:"last_seen_at,omitempty"`
	FreshnessSeconds *int64                      `json:"freshness_seconds,omitempty"`
	TotalSamples     int64                       `json:"total_samples"`
	Fields           []dbobs.IngestXRayFieldStat `json:"fields"`
	Buckets          []dbobs.IngestXRayBucket    `json:"buckets"`
}

// Allowed window/bucket durations. Anything outside the set falls back
// to the default to keep the index-scan budget bounded and the per-
// minute bucket math sensible.
var (
	ingestXRayAllowedWindows = map[string]time.Duration{
		"5m":  5 * time.Minute,
		"15m": 15 * time.Minute,
		"1h":  1 * time.Hour,
		"6h":  6 * time.Hour,
		"24h": 24 * time.Hour,
	}
	ingestXRayAllowedBuckets = map[string]time.Duration{
		"30s": 30 * time.Second,
		"1m":  1 * time.Minute,
		"5m":  5 * time.Minute,
		"15m": 15 * time.Minute,
		"1h":  1 * time.Hour,
	}
)

// Get serves the GET endpoint.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.repo == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "ingest x-ray repo not configured")
		return
	}
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicleID must be a positive integer")
		return
	}

	windowStr := strings.TrimSpace(r.URL.Query().Get("window"))
	if windowStr == "" {
		windowStr = "1h"
	}
	windowDur, ok := ingestXRayAllowedWindows[windowStr]
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "window must be one of 5m,15m,1h,6h,24h")
		return
	}

	bucketStr := strings.TrimSpace(r.URL.Query().Get("bucket"))
	if bucketStr == "" {
		bucketStr = "1m"
	}
	bucketDur, ok := ingestXRayAllowedBuckets[bucketStr]
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "bucket must be one of 30s,1m,5m,15m,1h")
		return
	}

	// Sanity: bucket must be smaller than window or the chart has at
	// most one bucket. Operator can override by widening window.
	if bucketDur >= windowDur {
		httpx.WriteError(w, http.StatusBadRequest, "bucket must be smaller than window")
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	now := time.Now().UTC()
	windowStart := now.Add(-windowDur)

	fields, err := h.repo.FieldStats(r.Context(), vehicleID, windowStart, limit)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	buckets, err := h.repo.SampleCountByBucket(r.Context(), vehicleID, windowStart, bucketDur)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	lastSeen, err := h.repo.LastSeen(r.Context(), vehicleID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	var total int64
	for _, fs := range fields {
		total += fs.SampleCount
	}

	resp := IngestXRayResponse{
		VehicleID:    vehicleID,
		Now:          now.Format(time.RFC3339Nano),
		WindowStart:  windowStart.Format(time.RFC3339Nano),
		Window:       windowStr,
		Bucket:       bucketStr,
		TotalSamples: total,
		Fields:       fields,
		Buckets:      buckets,
	}
	if !lastSeen.IsZero() {
		ts := lastSeen.UTC().Format(time.RFC3339Nano)
		resp.LastSeenAt = &ts
		fresh := int64(now.Sub(lastSeen).Seconds())
		if fresh < 0 {
			fresh = 0
		}
		resp.FreshnessSeconds = &fresh
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}
