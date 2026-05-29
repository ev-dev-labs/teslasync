package aiswupd

// Phase-50 / 0051 — M3 Software update changelog summarizer.
//
// Implements POST /api/v1/ai/software-updates/summarize as a read-only SSE summarizer.
// The route is guard-wrapped for ADR-015 off-mode behavior; the baseline software-updates endpoint remains reachable.
// Vehicle scope is bound in context before tool execution so prompt text cannot redirect the LLM to another vehicle.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	softwareupdatechangelogsummarizer "github.com/ev-dev-labs/teslasync/internal/ai/strategies/software-update-changelog-summarizer"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/summary"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
)

// softwareUpdateChangelogSummarizerMaxIterations bounds the read-only tool loop.
const softwareUpdateChangelogSummarizerMaxIterations = 8

// softwareUpdateChangelogSummarizerMaxBodyBytes caps the small JSON body cheaply.
const softwareUpdateChangelogSummarizerMaxBodyBytes = 16 * 1024

// softwareUpdateChangelogSummarizerDefaultLimit matches the tool default.
const softwareUpdateChangelogSummarizerDefaultLimit = 20

// softwareUpdateChangelogSummarizerMaxLimit rejects over-cap requests before dispatch.
const softwareUpdateChangelogSummarizerMaxLimit = 50

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// softwareUpdateChangelogSummarizerRequest is the JSON body.
// vehicle_id is required; limit is optional and bounded.
type softwareUpdateChangelogSummarizerRequest struct {
	// VehicleID identifies the vehicle the summary covers.
	// Required + positive.
	VehicleID int64 `json:"vehicle_id"`

	// Limit bounds the per-call recent_updates list. Optional;
	// defaults to softwareUpdateChangelogSummarizerDefaultLimit
	// when zero. Bounded to
	// [0, softwareUpdateChangelogSummarizerMaxLimit].
	Limit int `json:"limit,omitempty"`
}

// Handler serves software-update summaries and is safe for concurrent use.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	source     summary.VehicleSoftwareSource
	headerName string
	maxIters   int
}

// NewHandler constructs the summarizer and panics on missing boot wiring.
// source wraps the same SoftwareUpdateRepo read path used by the baseline endpoint.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	source summary.VehicleSoftwareSource,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aiswupd: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aiswupd: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aiswupd: NewHandler: nil strategy.Strategy")
	case source == nil:
		panic("aiswupd: NewHandler: nil summary.VehicleSoftwareSource")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		source:     source,
		headerName: headerName,
		maxIters:   softwareUpdateChangelogSummarizerMaxIterations,
	}
}

// parseSoftwareUpdateChangelogSummarizerRequest drains the body.
// vehicle_id must be > 0; limit (optional) is bounded to
// [0, softwareUpdateChangelogSummarizerMaxLimit]. Absence /
// invalid values surface as JSON 400 with a stable error key
// the SPA can localise. Returns (req, true) when the body is
// acceptable.
func parseSoftwareUpdateChangelogSummarizerRequest(w http.ResponseWriter, r *http.Request) (softwareUpdateChangelogSummarizerRequest, bool) {
	var req softwareUpdateChangelogSummarizerRequest
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "missing body")
		return req, false
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, softwareUpdateChangelogSummarizerMaxBodyBytes))
	if readErr != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("failed to read body: %v", readErr))
		return req, false
	}
	if len(bytes.TrimSpace(bodyBytes)) == 0 {
		writeError(w, http.StatusBadRequest, "empty body")
		return req, false
	}
	dec := json.NewDecoder(strings.NewReader(string(bodyBytes)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return req, false
	}
	if req.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id must be > 0")
		return req, false
	}
	if req.Limit < 0 {
		writeError(w, http.StatusBadRequest, "limit must be >= 0")
		return req, false
	}
	if req.Limit > softwareUpdateChangelogSummarizerMaxLimit {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("limit must be <= %d", softwareUpdateChangelogSummarizerMaxLimit))
		return req, false
	}
	return req, true
}

// ServeHTTP implements [http.Handler]. The body is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either
// writes a structured frame onto the SSE stream (when the
// writer has been opened) or a plain JSON 4xx/5xx (before it
// has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the request body.
	req, ok := parseSoftwareUpdateChangelogSummarizerRequest(w, r)
	if !ok {
		return
	}

	// Resolve the per-request limit (default applied when
	// omitted), so the in-scope ScopedSoftwareUpdateChangelogWindow
	// the handler installs is always concrete and the tool can
	// clamp the LLM's per-call request to it.
	limit := req.Limit
	if limit == 0 {
		limit = softwareUpdateChangelogSummarizerDefaultLimit
	}

	// 2) Resolve provider via the registry. Per-request
	// resolution honours mid-flight settings changes (model
	// swap, mode flip) without restart. A resolve failure must
	// NOT open the SSE stream — emit JSON 502 so the frontend
	// falls back gracefully.
	if _, err := h.registry.For(r.Context(), softwareupdatechangelogsummarizer.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai software-update-changelog-summarizer: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// Add audit metadata and bind the per-request vehicle scope before tools can run.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, softwareupdatechangelogsummarizer.FeatureID)
	ctx = summary.WithScopedSoftwareUpdateChangelogWindow(ctx, summary.ScopedSoftwareUpdateChangelogWindow{
		VehicleID: req.VehicleID,
		Limit:     limit,
	})

	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(softwareupdatechangelogsummarizer.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai software-update-changelog-summarizer: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	prov, err := h.registry.For(ctx, softwareupdatechangelogsummarizer.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai software-update-changelog-summarizer: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// Deny-all confirmation is defense in depth for this read-only strategy.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Build a deterministic prompt scoped to vehicle_id; this surface is not conversational.
	userMsg := buildSoftwareUpdateChangelogSummarizerUserMessage(req.VehicleID, limit)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", req.VehicleID).
			Int("limit", limit).
			Msg("ai software-update-changelog-summarizer: dispatcher returned error")
	}
}

// buildSoftwareUpdateChangelogSummarizerUserMessage synthesises
// the vehicle_id-scoped user message the LLM sees. The format
// is deterministic so canned goldens and provider prompt-hash
// caches stay stable across boots.
func buildSoftwareUpdateChangelogSummarizerUserMessage(vehicleID int64, limit int) string {
	return fmt.Sprintf(
		"Summarize the recent firmware updates for vehicle_id=%d. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_vehicle_software with vehicle_id=%d (and limit=%d to bound the recent_updates list) "+
			"to fetch the deterministic envelope (vehicle_id, current_version, total_updates, install_cadence_days, recent_updates[*]). "+
			"(2) OPTIONALLY call retrieve_update_notes with the latest version string as the query, restricted to allowed source_types "+
			"(software_update, docs) — answer gracefully when zero chunks are returned and DISCLOSE the gap plainly. "+
			"Produce a 3-6 sentence summary grounded strictly in the envelope. "+
			"Name the latest installed version, the previous one or two installed versions when present, and the install cadence "+
			"(install_cadence_days) when at least two installs are listed. "+
			"Add an OPTIONAL release-note callout when retrieve_update_notes returned a chunk for the latest version. "+
			"Remember: you NEVER invent a version number, NEVER invent a feature/fix, and NEVER speculate about Tesla's roadmap. "+
			"If retrieve_update_notes returned ZERO chunks for the latest version, say so PLAINLY ('the release-note text is not in the cached corpus'). "+
			"If query_vehicle_software reports total_updates=0, say so PLAINLY rather than inventing an install story. "+
			"Refuse politely if asked to summarize a different vehicle than the in-scope one.",
		vehicleID, vehicleID, limit,
	)
}

var _ http.Handler = (*Handler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/software_update_summary.go. Kept in the
// same file as the handler so the wiring intent is local to
// the slice; mirrors the predictive-maintenance slice's
// AIPredictiveMaintenanceContextSource pattern.
// ---------------------------------------------------------------------

// VehicleSoftwareSource wraps the baseline SoftwareUpdateRepo read and computes cadence in Go.
type VehicleSoftwareSource struct {
	repo *systemdb.SoftwareUpdateRepo
}

// NewVehicleSoftwareSource panics on nil repo so wiring bugs fail at boot.
func NewVehicleSoftwareSource(repo *systemdb.SoftwareUpdateRepo) *VehicleSoftwareSource {
	if repo == nil {
		panic("aiswupd: NewVehicleSoftwareSource: nil *systemdb.SoftwareUpdateRepo")
	}
	return &VehicleSoftwareSource{repo: repo}
}

// VehicleSoftware returns a non-mutating envelope for the in-scope vehicle.
// Empty slices and nil cadence preserve the distinction between no history and zero-day cadence.
func (a *VehicleSoftwareSource) VehicleSoftware(ctx context.Context, vehicleID int64, limit int) (*summary.VehicleSoftwareEnvelope, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("aiswupd software-update-changelog-summarizer: vehicle_id must be > 0")
	}
	if limit <= 0 {
		limit = softwareUpdateChangelogSummarizerDefaultLimit
	}

	rows, err := a.repo.GetByVehicle(ctx, vehicleID, limit, time.Time{}, time.Time{})
	if err != nil {
		return nil, fmt.Errorf("aiswupd software-update-changelog-summarizer: GetByVehicle: %w", err)
	}

	entries := make([]summary.SoftwareUpdateEntry, 0, len(rows))
	currentVersion := ""
	var installedTimes []time.Time
	for _, u := range rows {
		entry := softwareUpdateModelToEntry(u)
		entries = append(entries, entry)
		// Rows are newest-first; the first installed row is the current version.
		if currentVersion == "" && entry.Status == "installed" && entry.Version != "" {
			currentVersion = entry.Version
		}
		if u.InstalledAt != nil && !u.InstalledAt.IsZero() {
			installedTimes = append(installedTimes, *u.InstalledAt)
		}
	}

	cadence := computeInstallCadenceDays(installedTimes)

	return &summary.VehicleSoftwareEnvelope{
		VehicleID:          vehicleID,
		CurrentVersion:     currentVersion,
		TotalUpdates:       len(entries),
		InstallCadenceDays: cadence,
		RecentUpdates:      entries,
	}, nil
}

// softwareUpdateModelToEntry converts DB rows to tool entries with RFC3339 timestamps.
func softwareUpdateModelToEntry(u *vehiclemodel.SoftwareUpdate) summary.SoftwareUpdateEntry {
	entry := summary.SoftwareUpdateEntry{
		ID:        u.ID,
		Version:   u.Version,
		Status:    u.Status,
		CreatedAt: u.CreatedAt.UTC().Format(time.RFC3339),
	}
	if u.InstalledAt != nil && !u.InstalledAt.IsZero() {
		entry.InstalledAt = u.InstalledAt.UTC().Format(time.RFC3339)
	}
	if u.ScheduledAt != nil && !u.ScheduledAt.IsZero() {
		entry.ScheduledAt = u.ScheduledAt.UTC().Format(time.RFC3339)
	}
	return entry
}

// computeInstallCadenceDays returns the mean gap between installed_at timestamps.
// Nil means too little data, distinct from a legitimate zero-day cadence.
func computeInstallCadenceDays(installedTimes []time.Time) *float64 {
	if len(installedTimes) < 2 {
		return nil
	}
	// Sort ascending so consecutive gaps are positive.
	times := make([]time.Time, len(installedTimes))
	copy(times, installedTimes)
	for i := 1; i < len(times); i++ {
		for j := i; j > 0 && times[j].Before(times[j-1]); j-- {
			times[j], times[j-1] = times[j-1], times[j]
		}
	}
	totalDays := 0.0
	for i := 1; i < len(times); i++ {
		gap := times[i].Sub(times[i-1])
		if gap < 0 {
			gap = -gap
		}
		totalDays += gap.Hours() / 24.0
	}
	mean := totalDays / float64(len(times)-1)
	if math.IsNaN(mean) || math.IsInf(mean, 0) {
		return nil
	}
	return &mean
}

// Compile-time assertion: VehicleSoftwareSource satisfies
// summary.VehicleSoftwareSource.
var _ summary.VehicleSoftwareSource = (*VehicleSoftwareSource)(nil)
