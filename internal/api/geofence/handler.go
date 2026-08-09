package geofence

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/apperror"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	geofencedb "github.com/ev-dev-labs/teslasync/internal/database/geofence"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/rs/zerolog/log"
)

// geofenceCreateRequest is the wire shape accepted by Create/Update.
//
// The web client posts circle geometry (`latitude`, `longitude`, `radius` in
// meters) plus alert/enabled flags. Legacy callers that already produce
// polygon WKT may post `polygon_wkt` directly. Whichever geometry is present
// wins; circle takes precedence when both are supplied.
//
// `*bool` for the alert flags lets Update distinguish "field omitted" from
// "field set to false" — required for the merge-style PUT the toggle row
// switches and the modal both rely on.
//
// Both camelCase (web-client `toGeofencePayload`) and snake_case (curl /
// import bundles) are accepted: Go's encoding/json is case-insensitive
// across `_` boundaries (`alertOnEntry` does NOT match `alert_on_entry`)
// so we declare an alias field for each flag and let
// coalesceGeofenceRequestSpellings merge them after decode. camelCase wins
// on conflict because that's the documented client contract.
type geofenceCreateRequest struct {
	Name       string                        `json:"name"`
	PolygonWKT string                        `json:"polygon_wkt"`
	Category   *systemmodel.GeofenceCategory `json:"category"`

	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
	Radius    *float64 `json:"radius"`

	// Canonical (web-client) spellings.
	Enabled      *bool `json:"enabled"`
	AlertOnEntry *bool `json:"alertOnEntry"`
	AlertOnExit  *bool `json:"alertOnExit"`

	// snake_case aliases — populated by curl/scripts/import bundles.
	// Coalesced into the canonical fields by
	// coalesceGeofenceRequestSpellings(). NOT read directly anywhere else.
	AlertOnEntrySnake *bool `json:"alert_on_entry"`
	AlertOnExitSnake  *bool `json:"alert_on_exit"`
}

// coalesceGeofenceRequestSpellings copies snake_case alias fields into the
// canonical camelCase fields when the canonical field is nil. camelCase
// wins on conflict — see geofenceCreateRequest doc.
func coalesceGeofenceRequestSpellings(req *geofenceCreateRequest) {
	if req.AlertOnEntry == nil && req.AlertOnEntrySnake != nil {
		req.AlertOnEntry = req.AlertOnEntrySnake
	}
	if req.AlertOnExit == nil && req.AlertOnExitSnake != nil {
		req.AlertOnExit = req.AlertOnExitSnake
	}
}

// decodeGeofenceWriteBody unmarshals the request and resolves whichever
// geometry the client supplied into a populated *systemmodel.Geofence.
//
// Returns the populated Geofence AND the raw decoded request so the caller
// (Update) can detect field presence on `*bool` toggles for merge semantics.
//
// Validation that depends on the resolved geometry (centroid bounds, radius
// limits) is delegated to validateGeofence() so Create and Update share one
// rule set.
func decodeGeofenceWriteBody(body io.Reader) (*systemmodel.Geofence, *geofenceCreateRequest, error) {
	var req geofenceCreateRequest
	if err := json.NewDecoder(body).Decode(&req); err != nil {
		return nil, nil, fmt.Errorf("decode geofence body: %w", err)
	}
	coalesceGeofenceRequestSpellings(&req)

	g := &systemmodel.Geofence{
		Name:       strings.TrimSpace(req.Name),
		PolygonWKT: strings.TrimSpace(req.PolygonWKT),
		Category:   req.Category,
	}
	if req.Enabled != nil {
		g.Enabled = *req.Enabled
	}
	if req.AlertOnEntry != nil {
		g.AlertOnEntry = *req.AlertOnEntry
	}
	if req.AlertOnExit != nil {
		g.AlertOnExit = *req.AlertOnExit
	}

	if req.Latitude != nil && req.Longitude != nil && req.Radius != nil {
		g.PolygonWKT = systemmodel.CircleToPolygonWKT(*req.Latitude, *req.Longitude, *req.Radius)
	}

	return g, &req, nil
}

func validateGeofence(g *systemmodel.Geofence) error {
	if g.Latitude() < -90 || g.Latitude() > 90 {
		return fmt.Errorf("latitude must be between -90 and 90")
	}
	if g.Longitude() < -180 || g.Longitude() > 180 {
		return fmt.Errorf("longitude must be between -180 and 180")
	}
	if g.Radius() > 100000 {
		return fmt.Errorf("radius must be 100km or less")
	}
	if len(g.Name) > 200 {
		return fmt.Errorf("name must be 200 characters or less")
	}
	return nil
}

// Handler handles geofence CRUD plus the /geofences/bulk endpoint.
//
// Construct with NewHandler. The constructor wires *geofencedb.GeofenceRepo
// as both the CRUD repo AND (by default) the bulk store; tests can
// override the bulk store via WithBulkStore.
//
// To enable audit-log writes on bulk_delete operations, pass a
// WithAuditFunc callback at construction. Without one, BulkUpdate still
// performs the delete but skips the audit row.
type Handler struct {
	db           *database.DB
	geofenceRepo *geofencedb.GeofenceRepo
	// bulk is the resolved bulk store. Defaults to geofenceRepo;
	// WithBulkStore overrides for tests. Never nil after NewHandler
	// unless both db and WithBulkStore(nil) were passed.
	bulk BulkStore
	// rateRepo is the resolved charging-place discovery-review, archive,
	// rate-CRUD, and preview/apply-repricing store used by
	// rate_handler.go. Defaults to geofenceRepo; WithRateStore overrides
	// for tests. See geofenceRateRepo in rate_handler.go for the exact
	// method subset and rationale (same "small interface + Option +
	// default-wire the concrete repo" idiom as BulkStore above, applied
	// to the endpoints added for the geofence charging-place pricing
	// feature so they get real route/validation/response-shape test
	// coverage instead of a hand-duplicated "mirror").
	rateRepo geofenceRateRepo
	// audit is the optional per-mutation audit callback. nil → no-op.
	// Bound to "geofence" entity_type at the call site so the subpackage
	// does not need to know about the parent's audit categorization.
	audit AuditFunc
}

// Option mutates a Handler during construction. See WithBulkStore +
// WithAuditFunc for the supported options.
type Option func(*Handler)

// AuditFunc is the audit-logging callback shape expected by Handler.
// It is invoked once per successful mutation that should be audited
// (currently only bulk_delete). entityID is nil for batch operations
// because the row count is encoded in `detail` instead.
type AuditFunc func(r *http.Request, action string, entityID *int64, detail string)

// WithBulkStore overrides the default bulk store (which is the same
// *geofencedb.GeofenceRepo used by the CRUD methods). Intended for
// tests; production code should construct via NewHandler(db) and let
// the constructor wire the repo.
func WithBulkStore(s BulkStore) Option { return func(h *Handler) { h.bulk = s } }

// WithRateStore overrides the default rate/discovery/repricing store
// (which is the same *geofencedb.GeofenceRepo used by the CRUD methods
// and bulk store). Intended for tests; production code should construct
// via NewHandler(db) and let the constructor wire the repo.
func WithRateStore(s geofenceRateRepo) Option { return func(h *Handler) { h.rateRepo = s } }

// WithAuditFunc installs the audit callback invoked after a successful
// bulk_delete. Without it, BulkUpdate skips the audit row but still
// performs the delete.
func WithAuditFunc(f AuditFunc) Option { return func(h *Handler) { h.audit = f } }

// NewHandler constructs a Handler wired to a *geofencedb.GeofenceRepo
// (when db is non-nil). Tests may pass db=nil + WithBulkStore(fake) to
// exercise the bulk endpoint without standing up Postgres.
func NewHandler(db *database.DB, opts ...Option) *Handler {
	h := &Handler{db: db}
	if db != nil {
		h.geofenceRepo = geofencedb.NewGeofenceRepo(db)
		h.bulk = h.geofenceRepo
		h.rateRepo = h.geofenceRepo
	}
	for _, opt := range opts {
		opt(h)
	}
	return h
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	var (
		geofences []*systemmodel.Geofence
		err       error
	)
	if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("include_archived")), "true") {
		geofences, err = h.geofenceRepo.GetAllIncludingArchived(r.Context())
	} else {
		geofences, err = h.geofenceRepo.GetAll(r.Context())
	}
	if err != nil {
		log.Error().Err(err).Msg("failed to list geofences")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to list geofences"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, geofences)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	g, _, err := decodeGeofenceWriteBody(r.Body)
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidJSON)
		return
	}
	if g.Name == "" || g.Radius() <= 0 {
		apperror.Write(w, r, apperror.ErrMissingField.WithMessage("name and positive radius required"))
		return
	}
	if err := validateGeofence(g); err != nil {
		apperror.Write(w, r, apperror.ErrGeofenceInvalidCoords.WithMessage(err.Error()))
		return
	}

	if err := h.geofenceRepo.Create(r.Context(), g); err != nil {
		log.Error().Err(err).Msg("failed to create geofence")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to create geofence"))
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, g)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "geofenceID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}

	g, err := h.geofenceRepo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get geofence")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to get geofence"))
		return
	}
	if g == nil {
		apperror.Write(w, r, apperror.ErrGeofenceNotFound)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, g)
}

// Update applies a merge-style PUT: load the row, then overlay the fields
// the client supplied. This lets the toggle row send `{enabled: true}` and
// the rename input send `{name: "..."}` without each callsite having to
// re-send the polygon, category, and alert flags.
//
// Field-presence detection:
//   - String fields (Name, PolygonWKT) — empty string means "not supplied".
//     The web modal always sends a non-empty Name + a synthesized polygon
//     so this is safe in practice.
//   - Category (*GeofenceCategory pointer) — nil means "not supplied".
//     Trade-off: the client cannot null Category via PUT (rare op).
//   - Enabled / AlertOnEntry / AlertOnExit (*bool) — nil from the raw
//     request means "not supplied"; a non-nil pointer (true OR false)
//     overlays the existing row. This is the whole point of the bug fix.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "geofenceID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}

	patch, raw, err := decodeGeofenceWriteBody(r.Body)
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidJSON)
		return
	}

	existing, err := h.geofenceRepo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to load geofence for update")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to load geofence"))
		return
	}
	if existing == nil {
		apperror.Write(w, r, apperror.ErrGeofenceNotFound)
		return
	}

	merged := *existing
	if patch.Name != "" {
		merged.Name = patch.Name
	}
	if patch.PolygonWKT != "" {
		merged.PolygonWKT = patch.PolygonWKT
	}
	if patch.Category != nil {
		merged.Category = patch.Category
	}
	if raw.Enabled != nil {
		merged.Enabled = *raw.Enabled
	}
	if raw.AlertOnEntry != nil {
		merged.AlertOnEntry = *raw.AlertOnEntry
	}
	if raw.AlertOnExit != nil {
		merged.AlertOnExit = *raw.AlertOnExit
	}
	merged.ID = id

	if merged.Name == "" || merged.Radius() <= 0 {
		apperror.Write(w, r, apperror.ErrMissingField.WithMessage("name and positive radius required"))
		return
	}
	if err := validateGeofence(&merged); err != nil {
		apperror.Write(w, r, apperror.ErrGeofenceInvalidCoords.WithMessage(err.Error()))
		return
	}

	if err := h.geofenceRepo.Update(r.Context(), &merged); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to update geofence")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to update geofence"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, &merged)
}

// Delete hard-deletes a geofence with no charging/drive history. A place
// that has ever been referenced by a charging session, rate, or drive
// endpoint (geofence_id / rate_id / start_geofence_id / end_geofence_id —
// none of which carry a DB-level FK, by design, to keep the telemetry hot
// path unblocked) is NEVER hard-deleted: the historical-integrity rule
// requires those places to go through POST /{geofenceID}/archive instead,
// so already-priced sessions keep resolving their place by id forever. A
// place with no history at all keeps working exactly as before this
// feature.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "geofenceID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}

	hasHistory, err := h.geofenceRepo.HasChargingHistory(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to check geofence charging history")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to check geofence history"))
		return
	}
	if hasHistory {
		apperror.Write(w, r, apperror.ErrGeofenceHasHistory)
		return
	}

	if err := h.geofenceRepo.Delete(r.Context(), id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to delete geofence")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to delete geofence"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
