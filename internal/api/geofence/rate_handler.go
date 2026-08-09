package geofence

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/apperror"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	geofencedb "github.com/ev-dev-labs/teslasync/internal/database/geofence"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	"github.com/ev-dev-labs/teslasync/internal/tracing"

	"github.com/rs/zerolog/log"
)

// =============================================================================
// rate_handler.go — charging-place discovery-review, archive, time-versioned
// rate CRUD, and preview/apply-repricing HTTP endpoints for the
// geofence-based charging-place pricing feature (migration
// 000228_geofence_charging_place_pricing). See internal/database/geofence's
// repo_discovery.go, repo_archive.go, repo_rates.go, repo_charging_summary.go
// for the business rules each endpoint delegates to.
//
// Every mutating handler here re-derives its response from the database
// after the write (rather than trusting the in-memory request) so the
// caller's optimistic cache update always reflects the authoritative row —
// same discipline as the existing Update handler in handler.go.
// =============================================================================

// geofenceRateRepo is the subset of *geofencedb.GeofenceRepo's methods used
// by this file's discovery-review, archive, rate-CRUD, and
// preview/apply-repricing endpoints.
//
// Declaring a narrow interface here — rather than referencing the
// concrete *geofencedb.GeofenceRepo type directly, as the pre-existing CRUD
// handlers in handler.go do — lets tests substitute a fake and get full
// route+validation+response-shape coverage without a live Postgres
// connection or a hand-duplicated "mirror" of each handler body (the
// approach handler_test.go's fakeGeofenceUpdateRepo had to fall back to
// for the one existing repo-touching CRUD handler). See rate_handler_test.go
// for the fake.
//
// Handler.rateRepo defaults to the same *geofencedb.GeofenceRepo instance
// used everywhere else (see NewHandler); WithRateStore overrides it in
// tests. Every method here is a 1:1 copy of a *geofencedb.GeofenceRepo
// method signature — keep this list in sync if repo signatures change.
type geofenceRateRepo interface {
	GetByID(ctx context.Context, id int64) (*systemmodel.Geofence, error)
	ListNeedsReview(ctx context.Context) ([]*systemmodel.Geofence, error)
	ListActiveRatesNow(ctx context.Context) ([]*systemmodel.GeofenceRate, error)
	Archive(ctx context.Context, id int64) error
	Unarchive(ctx context.Context, id int64) error
	MarkReviewed(ctx context.Context, id int64) error
	ListRates(ctx context.Context, geofenceID int64) ([]*systemmodel.GeofenceRate, error)
	CreateRate(ctx context.Context, gr *systemmodel.GeofenceRate) error
	DeleteRate(ctx context.Context, geofenceID, rateID int64) error
	PreviewApplyRate(ctx context.Context, scope systemmodel.GeofenceRateApplyScope) (*systemmodel.GeofenceRateImpactPreview, error)
	ApplyRate(ctx context.Context, scope systemmodel.GeofenceRateApplyScope) (*systemmodel.GeofenceRateApplyResult, error)
	ChargingSummaryByCurrency(ctx context.Context, geofenceID int64) ([]*systemmodel.GeofenceChargingSummary, error)
	ChargingActivity(ctx context.Context, geofenceID int64, limit, offset int) ([]*systemmodel.GeofenceChargingActivity, error)
}

// NeedsReview serves GET /geofences/needs-review — the "Needs Setup" queue
// of auto-discovered charging-place geofences awaiting a human to confirm
// name/type/location, oldest first.
func (h *Handler) NeedsReview(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "geofence.needs_review")
	defer span.End()

	list, err := h.rateRepo.ListNeedsReview(ctx)
	if err != nil {
		tracing.EndSpan(span, err)
		log.Error().Err(err).Msg("failed to list geofences needing review")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to list geofences needing review"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, list)
}

// CurrentRates serves GET /geofences/rates/current — the currently-active
// rate (if any) for every geofence in one round trip, powering the Charging
// Places list view's rate column without a per-row N+1 lookup.
func (h *Handler) CurrentRates(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "geofence.rates_current")
	defer span.End()

	list, err := h.rateRepo.ListActiveRatesNow(ctx)
	if err != nil {
		tracing.EndSpan(span, err)
		log.Error().Err(err).Msg("failed to list current geofence rates")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to list current geofence rates"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, list)
}

// loadGeofenceOr404 fetches a geofence by URL param id, writing a
// structured 400/404/500 response and returning ok=false when the caller
// must stop. Deliberately resolves archived places too (GetByID has no
// archived_at filter) so rate-history/charging-activity/summary endpoints
// keep working for a retired place per the historical-integrity rule.
func (h *Handler) loadGeofenceOr404(ctx context.Context, w http.ResponseWriter, r *http.Request, id int64) (*systemmodel.Geofence, bool) {
	g, err := h.rateRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to load geofence")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to load geofence"))
		return nil, false
	}
	if g == nil {
		apperror.Write(w, r, apperror.ErrGeofenceNotFound)
		return nil, false
	}
	return g, true
}

// respondWithGeofence re-fetches and returns the geofence at 200 after a
// successful state-changing action (Archive/Unarchive/MarkReviewed) so the
// caller's optimistic cache update has the authoritative row without a
// second client-issued round trip. Falls back to 204 (the mutation itself
// already succeeded) on the — unexpected — case that the re-fetch fails.
func (h *Handler) respondWithGeofence(ctx context.Context, w http.ResponseWriter, id int64) {
	g, err := h.rateRepo.GetByID(ctx, id)
	if err != nil || g == nil {
		log.Warn().Err(err).Int64("geofence_id", id).
			Msg("geofence mutation succeeded but response refresh failed")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, g)
}

// Archive serves POST /geofences/{geofenceID}/archive. Idempotent: archiving
// an already-archived place is a no-op success.
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "geofence.archive")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "geofenceID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}
	span.SetAttributes(tracing.GeofenceID(id))

	if err := h.rateRepo.Archive(ctx, id); err != nil {
		if errors.Is(err, geofencedb.ErrGeofenceNotFound) {
			apperror.Write(w, r, apperror.ErrGeofenceNotFound)
			return
		}
		tracing.EndSpan(span, err)
		log.Error().Err(err).Int64("id", id).Msg("failed to archive geofence")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to archive geofence"))
		return
	}
	h.respondWithGeofence(ctx, w, id)
}

// Unarchive serves POST /geofences/{geofenceID}/unarchive. Idempotent:
// unarchiving an already-active place is a no-op success.
func (h *Handler) Unarchive(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "geofence.unarchive")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "geofenceID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}
	span.SetAttributes(tracing.GeofenceID(id))

	if err := h.rateRepo.Unarchive(ctx, id); err != nil {
		if errors.Is(err, geofencedb.ErrGeofenceNotFound) {
			apperror.Write(w, r, apperror.ErrGeofenceNotFound)
			return
		}
		tracing.EndSpan(span, err)
		log.Error().Err(err).Int64("id", id).Msg("failed to unarchive geofence")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to unarchive geofence"))
		return
	}
	h.respondWithGeofence(ctx, w, id)
}

// MarkReviewed serves POST /geofences/{geofenceID}/reviewed — clears
// needs_review once a human has confirmed/edited an auto-discovered
// place's name, type, or location.
func (h *Handler) MarkReviewed(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "geofence.mark_reviewed")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "geofenceID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}
	span.SetAttributes(tracing.GeofenceID(id))

	if err := h.rateRepo.MarkReviewed(ctx, id); err != nil {
		if errors.Is(err, geofencedb.ErrGeofenceNotFound) {
			apperror.Write(w, r, apperror.ErrGeofenceNotFound)
			return
		}
		tracing.EndSpan(span, err)
		log.Error().Err(err).Int64("id", id).Msg("failed to mark geofence reviewed")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to mark geofence reviewed"))
		return
	}
	h.respondWithGeofence(ctx, w, id)
}

// ListRates serves GET /geofences/{geofenceID}/rates — every rate version,
// newest effective_from first, the shape the rate-history UI panel renders
// directly.
func (h *Handler) ListRates(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "geofence.rates_list")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "geofenceID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}
	span.SetAttributes(tracing.GeofenceID(id))

	if _, ok := h.loadGeofenceOr404(ctx, w, r, id); !ok {
		return
	}
	rates, err := h.rateRepo.ListRates(ctx, id)
	if err != nil {
		tracing.EndSpan(span, err)
		log.Error().Err(err).Int64("geofence_id", id).Msg("failed to list geofence rates")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to list geofence rates"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, rates)
}

// geofenceRateCreateRequest is the wire shape accepted by CreateRate.
// RatePerWh/EffectiveFrom are pointers so omission (nil) can be
// distinguished from an explicit zero value.
type geofenceRateCreateRequest struct {
	RatePerWh     *float64   `json:"rate_per_wh"`
	Currency      string     `json:"currency"`
	EffectiveFrom *time.Time `json:"effective_from"`
	EffectiveTo   *time.Time `json:"effective_to,omitempty"`
}

// validateRateRequestFields duplicates the repository-level rate-integrity
// checks (non-negative finite rate, uppercase ISO-4217 currency, ordered
// interval) at the handler boundary so a malformed request gets a precise
// 400 GEOFENCE_RATE_INVALID instead of a generic 500 from deep inside
// CreateRate — mirrors the existing validateGeofence/decodeGeofenceWriteBody
// split in handler.go.
func validateRateRequestFields(ratePerWh float64, currency string, effectiveFrom time.Time, effectiveTo *time.Time) error {
	if math.IsNaN(ratePerWh) || math.IsInf(ratePerWh, 0) ||
		ratePerWh < 0 || ratePerWh >= 1_000_000 {
		return fmt.Errorf("rate_per_wh must be finite and between 0 (inclusive) and 1000000 (exclusive)")
	}
	if len(currency) != 3 {
		return fmt.Errorf("currency must be a 3-letter ISO 4217 code")
	}
	for _, c := range currency {
		if c < 'A' || c > 'Z' {
			return fmt.Errorf("currency must be an uppercase ISO 4217 code (got %q)", currency)
		}
	}
	if effectiveFrom.IsZero() {
		return fmt.Errorf("effective_from is required")
	}
	if effectiveTo != nil && !effectiveTo.After(effectiveFrom) {
		return fmt.Errorf("effective_to must be after effective_from")
	}
	return nil
}

// CreateRate serves POST /geofences/{geofenceID}/rates. Handles both
// "first-time setup" (no prior rate) and "add a new version" (a later
// effective_from that closes the prior unbounded interval) — see
// GeofenceRepo.CreateRate for the exact auto-close/no-overlap semantics.
// There is deliberately no separate "replace" endpoint: a correction is
// just another CreateRate call with an effective_from at or after the
// point the correction should take hold.
func (h *Handler) CreateRate(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "geofence.rates_create")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "geofenceID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}
	span.SetAttributes(tracing.GeofenceID(id))

	var req geofenceRateCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apperror.Write(w, r, apperror.ErrInvalidJSON)
		return
	}
	if req.RatePerWh == nil || req.EffectiveFrom == nil {
		apperror.Write(w, r, apperror.ErrMissingField.WithMessage("rate_per_wh and effective_from are required"))
		return
	}
	currency := strings.ToUpper(strings.TrimSpace(req.Currency))
	if err := validateRateRequestFields(*req.RatePerWh, currency, *req.EffectiveFrom, req.EffectiveTo); err != nil {
		apperror.Write(w, r, apperror.ErrGeofenceRateInvalid.WithMessage(err.Error()))
		return
	}

	if _, ok := h.loadGeofenceOr404(ctx, w, r, id); !ok {
		return
	}

	gr := &systemmodel.GeofenceRate{
		GeofenceID:    id,
		RatePerWh:     *req.RatePerWh,
		Currency:      currency,
		EffectiveFrom: req.EffectiveFrom.UTC(),
	}
	if req.EffectiveTo != nil {
		t := req.EffectiveTo.UTC()
		gr.EffectiveTo = &t
	}

	if err := h.rateRepo.CreateRate(ctx, gr); err != nil {
		if errors.Is(err, geofencedb.ErrRateConflict) {
			apperror.Write(w, r, apperror.ErrGeofenceRateConflict)
			return
		}
		tracing.EndSpan(span, err)
		log.Error().Err(err).Int64("geofence_id", id).Msg("failed to create geofence rate")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to create geofence rate"))
		return
	}
	log.Info().Int64("geofence_id", id).Int64("rate_id", gr.ID).Str("currency", gr.Currency).
		Time("effective_from", gr.EffectiveFrom).Msg("geofence rate created")
	httpx.WriteJSON(w, http.StatusCreated, gr)
}

// DeleteRate serves DELETE /geofences/{geofenceID}/rates/{rateID}. Only an
// unused future schedule can be cancelled; effective history is immutable.
func (h *Handler) DeleteRate(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "geofence.rates_delete")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "geofenceID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}
	rateID, err := apiparams.URLParamInt64(r, "rateID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid rate ID"))
		return
	}
	span.SetAttributes(tracing.GeofenceID(id), tracing.RateID(rateID))

	if err := h.rateRepo.DeleteRate(ctx, id, rateID); err != nil {
		switch {
		case errors.Is(err, geofencedb.ErrRateNotFound):
			apperror.Write(w, r, apperror.ErrGeofenceRateNotFound)
			return
		case errors.Is(err, geofencedb.ErrRateInUse):
			apperror.Write(w, r, apperror.ErrGeofenceRateInUse)
			return
		case errors.Is(err, geofencedb.ErrRateImmutable):
			apperror.Write(w, r, apperror.ErrGeofenceRateImmutable)
			return
		}
		tracing.EndSpan(span, err)
		log.Error().Err(err).Int64("geofence_id", id).Int64("rate_id", rateID).Msg("failed to delete geofence rate")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to delete geofence rate"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// parseApplyScope resolves a preview/apply request's optional `from`/`to`
// RFC3339 query params into a systemmodel.GeofenceRateApplyScope. Both are
// optional; when absent the scope defaults to the rate's own effective
// interval (resolved downstream by the repository). Errors on unparseable
// timestamps or an inverted/empty [from, to) window.
func parseApplyScope(r *http.Request, geofenceID, rateID int64) (systemmodel.GeofenceRateApplyScope, error) {
	scope := systemmodel.GeofenceRateApplyScope{GeofenceID: geofenceID, RateID: rateID}
	if v := strings.TrimSpace(r.URL.Query().Get("from")); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return scope, fmt.Errorf("invalid from: %w", err)
		}
		t = t.UTC()
		scope.From = &t
	}
	if v := strings.TrimSpace(r.URL.Query().Get("to")); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return scope, fmt.Errorf("invalid to: %w", err)
		}
		t = t.UTC()
		scope.To = &t
	}
	if scope.From != nil && scope.To != nil && !scope.To.After(*scope.From) {
		return scope, fmt.Errorf("to must be after from")
	}
	return scope, nil
}

// writeApplyScopeRepoError maps the shared PreviewApplyRate/ApplyRate error
// cases to structured responses. Returns true when it wrote a response
// (caller must stop); false means the error is an unexpected internal
// failure the caller should still handle (log + 500).
func writeApplyScopeRepoError(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case errors.Is(err, geofencedb.ErrGeofenceNotFound):
		apperror.Write(w, r, apperror.ErrGeofenceNotFound)
		return true
	case errors.Is(err, geofencedb.ErrRateNotFound):
		apperror.Write(w, r, apperror.ErrGeofenceRateNotFound)
		return true
	default:
		return false
	}
}

// PreviewApplyRate serves GET /geofences/{geofenceID}/rates/{rateID}/preview
// — read-only, writes nothing. Reports how many sessions are matched (in
// scope by place + time), eligible (would actually be repriced), and
// protected (in scope but carry a manual/Tesla-actual cost or an existing
// cost with unknown provenance), plus the estimated total cost at this rate.
func (h *Handler) PreviewApplyRate(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "geofence.rate_preview_apply")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "geofenceID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}
	rateID, err := apiparams.URLParamInt64(r, "rateID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid rate ID"))
		return
	}
	span.SetAttributes(tracing.GeofenceID(id), tracing.RateID(rateID))

	scope, err := parseApplyScope(r, id, rateID)
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidInput.WithMessage(err.Error()))
		return
	}

	preview, err := h.rateRepo.PreviewApplyRate(ctx, scope)
	if err != nil {
		if writeApplyScopeRepoError(w, r, err) {
			return
		}
		tracing.EndSpan(span, err)
		log.Error().Err(err).Int64("geofence_id", id).Int64("rate_id", rateID).Msg("failed to preview geofence rate apply")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to preview rate apply"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, preview)
}

// ApplyRate serves POST /geofences/{geofenceID}/rates/{rateID}/apply — the
// write-performing, explicit backfill/reprice action. Bounded to this
// geofence + rate's interval (optionally narrowed further by `from`/`to`),
// idempotent, and never overwrites a manual/Tesla-actual cost or an existing
// cost with unknown provenance. Matched legacy sessions are still attributed
// to the place so they appear in its activity and summaries — see
// GeofenceRepo.ApplyRate.
func (h *Handler) ApplyRate(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "geofence.rate_apply")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "geofenceID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}
	rateID, err := apiparams.URLParamInt64(r, "rateID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid rate ID"))
		return
	}
	span.SetAttributes(tracing.GeofenceID(id), tracing.RateID(rateID))

	scope, err := parseApplyScope(r, id, rateID)
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidInput.WithMessage(err.Error()))
		return
	}

	result, err := h.rateRepo.ApplyRate(ctx, scope)
	if err != nil {
		if writeApplyScopeRepoError(w, r, err) {
			return
		}
		tracing.EndSpan(span, err)
		log.Error().Err(err).Int64("geofence_id", id).Int64("rate_id", rateID).Msg("failed to apply geofence rate")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to apply rate"))
		return
	}
	log.Info().Int64("geofence_id", id).Int64("rate_id", rateID).
		Int64("priced", result.PricedSessions).Int64("skipped", result.SkippedSessions).
		Msg("geofence rate applied/backfilled")
	httpx.WriteJSON(w, http.StatusOK, result)
}

// ChargingSummary serves GET /geofences/{geofenceID}/charging-summary —
// priced-session totals grouped by currency (never summed across
// currencies).
func (h *Handler) ChargingSummary(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "geofence.charging_summary")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "geofenceID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}
	span.SetAttributes(tracing.GeofenceID(id))

	if _, ok := h.loadGeofenceOr404(ctx, w, r, id); !ok {
		return
	}
	summary, err := h.rateRepo.ChargingSummaryByCurrency(ctx, id)
	if err != nil {
		tracing.EndSpan(span, err)
		log.Error().Err(err).Int64("geofence_id", id).Msg("failed to load geofence charging summary")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to load charging summary"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, summary)
}

// ChargingActivity serves GET /geofences/{geofenceID}/charging-activity —
// paginated session-level feed (any pricing state) backing the
// rate-history / affected-sessions UI panels.
func (h *Handler) ChargingActivity(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "geofence.charging_activity")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "geofenceID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}
	span.SetAttributes(tracing.GeofenceID(id))

	if _, ok := h.loadGeofenceOr404(ctx, w, r, id); !ok {
		return
	}
	limit, offset := apiparams.Pagination(r)
	activity, err := h.rateRepo.ChargingActivity(ctx, id, limit, offset)
	if err != nil {
		tracing.EndSpan(span, err)
		log.Error().Err(err).Int64("geofence_id", id).Msg("failed to load geofence charging activity")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to load charging activity"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, activity)
}
