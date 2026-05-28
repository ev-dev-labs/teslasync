// Phase-46 / Prompt 43 — Per-vehicle settings handler.
//
// Three endpoints back the SPA's <VehicleSettingsTab>:
//
//	GET    /api/v1/vehicles/{vehicleID}/settings
//	    → { settings: [{key,value,source}, ...] }   resolver output
//	PUT    /api/v1/vehicles/{vehicleID}/settings/{key}
//	    body: { value: <json> }
//	    upserts the override row; 204 No Content on success.
//	DELETE /api/v1/vehicles/{vehicleID}/settings/{key}
//	    deletes the override row (idempotent — 204 even when absent).
//
// The handler validates the (vehicleID, key) tuple before touching
// the repo:
//
//   - vehicleID exists in the vehicles table (404 if not)
//   - key is in the Phase-1 whitelist (400 INVALID_KEY if not)
//   - body decodes against the per-key kind (400 INVALID_VALUE)
//
// All three endpoints are scoped to /api/v1/vehicles/{vehicleID}/...,
// so the chi URLParam("vehicleID") path is the same as every other
// handler in this group; the prompt does NOT add subject-level
// authorisation (that's prompt-57's job — see ARCHITECTURE.md ADR-013).
package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
)

// MaxVehicleSettingsBodyBytes caps the PUT body size so a malicious
// or buggy client can't pin the API process by streaming an
// unbounded JSON document. 4 KiB is generous: the largest single
// value (charge_cost_tariff_id) tops out at 64 runes.
const MaxVehicleSettingsBodyBytes int64 = 4 * 1024

// VehicleSettingsErrorCode is the structured `code` field returned
// in the JSON error envelope. Centralised so the SPA's typed-fetch
// layer can match on stable strings instead of HTTP status alone.
const (
	VehicleSettingsCodeInvalidKey   = "INVALID_KEY"
	VehicleSettingsCodeInvalidValue = "INVALID_VALUE"
	VehicleSettingsCodeNotFound     = "VEHICLE_NOT_FOUND"
	VehicleSettingsCodeBadBody      = "INVALID_BODY"
)

// VehicleSettingsOverrideStore is the storage seam the handler uses
// to mutate the override layer. Production wires
// *settingsdb.VehicleSettingsRepo; tests substitute an in-memory fake.
type VehicleSettingsOverrideStore interface {
	Upsert(ctx context.Context, vehicleID int64, key string, value any) error
	Delete(ctx context.Context, vehicleID int64, key string) error
}

// VehicleSettingsResolverInterface is the read seam the handler uses
// to populate the GET response. Production wires
// *settingsdb.VehicleSettingsResolver; tests substitute a stub.
type VehicleSettingsResolverInterface interface {
	Resolve(ctx context.Context, vehicleID int64) ([]settingsdb.EffectiveSetting, error)
}

// VehicleExistenceChecker is the seam the handler uses to verify the
// vehicleID resolves before the repo write. Production wires the
// vehiclesvc / *VehicleRepo; tests substitute a stub.
type VehicleExistenceChecker interface {
	Exists(ctx context.Context, vehicleID int64) (bool, error)
}

// VehicleSettingsHandler bundles the three per-vehicle settings
// endpoints and their dependencies.
type VehicleSettingsHandler struct {
	store    VehicleSettingsOverrideStore
	resolver VehicleSettingsResolverInterface
	vehicles VehicleExistenceChecker
}

// NewVehicleSettingsHandler wires the handler. All three deps are
// required — passing nil for any of them would surface as a nil
// pointer panic on the first request, which is preferable to a
// silent partial-feature flag.
func NewVehicleSettingsHandler(
	store VehicleSettingsOverrideStore,
	resolver VehicleSettingsResolverInterface,
	vehicles VehicleExistenceChecker,
) *VehicleSettingsHandler {
	return &VehicleSettingsHandler{
		store:    store,
		resolver: resolver,
		vehicles: vehicles,
	}
}

// vehicleSettingsListResponse is the GET payload. Settings always
// covers the full Phase-1 whitelist in canonical iteration order so
// the SPA can render rows without checking presence.
type vehicleSettingsListResponse struct {
	Settings []settingsdb.EffectiveSetting `json:"settings"`
}

// vehicleSettingPutBody is the PUT payload. The value field is
// json.RawMessage so the handler can dispatch on the per-key kind
// without forcing a wide union type.
type vehicleSettingPutBody struct {
	Value json.RawMessage `json:"value"`
}

// List handles GET /vehicles/{vehicleID}/settings.
//
// Returns 400 on a malformed vehicleID, 404 when the vehicle does
// not resolve, and 200 with the resolver's full whitelist otherwise.
func (h *VehicleSettingsHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle id")
		return
	}
	if err := h.requireVehicleExists(r.Context(), w, vehicleID); err != nil {
		return
	}
	out, err := h.resolver.Resolve(r.Context(), vehicleID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to resolve vehicle settings")
		return
	}
	writeJSON(w, http.StatusOK, vehicleSettingsListResponse{Settings: out})
}

// Put handles PUT /vehicles/{vehicleID}/settings/{key}.
//
// Decodes the body's `value` field against the key's kind, validates
// it via the repo, and upserts the override row. 204 No Content on
// success so the SPA can rely on a uniform "no body" response shape.
func (h *VehicleSettingsHandler) Put(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle id")
		return
	}
	key := chi.URLParam(r, "key")
	if !settingsdb.IsValidVehicleSettingKey(key) {
		writeErrorCode(w, http.StatusBadRequest, "unsupported setting key", VehicleSettingsCodeInvalidKey)
		return
	}
	if err := h.requireVehicleExists(r.Context(), w, vehicleID); err != nil {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, MaxVehicleSettingsBodyBytes)
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var body vehicleSettingPutBody
	if err := dec.Decode(&body); err != nil {
		writeErrorCode(w, http.StatusBadRequest, "invalid request body", VehicleSettingsCodeBadBody)
		return
	}
	if dec.More() {
		writeErrorCode(w, http.StatusBadRequest, "trailing junk after json", VehicleSettingsCodeBadBody)
		return
	}
	if len(body.Value) == 0 || string(body.Value) == "null" {
		writeErrorCode(w, http.StatusBadRequest, "value is required", VehicleSettingsCodeInvalidValue)
		return
	}

	value, err := decodeValueForKey(key, body.Value)
	if err != nil {
		writeErrorCode(w, http.StatusBadRequest, "invalid value", VehicleSettingsCodeInvalidValue)
		return
	}

	if err := h.store.Upsert(r.Context(), vehicleID, key, value); err != nil {
		switch {
		case errors.Is(err, settingsdb.ErrVehicleSettingInvalidKey):
			writeErrorCode(w, http.StatusBadRequest, "unsupported setting key", VehicleSettingsCodeInvalidKey)
		case errors.Is(err, settingsdb.ErrVehicleSettingInvalidValue):
			writeErrorCode(w, http.StatusBadRequest, "invalid value", VehicleSettingsCodeInvalidValue)
		default:
			writeError(w, http.StatusInternalServerError, "failed to save setting")
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Delete handles DELETE /vehicles/{vehicleID}/settings/{key}.
//
// Idempotent: 204 even when no override row existed. The SPA's
// "Reset to user default" button hits this without needing to
// pre-fetch the row's existence.
func (h *VehicleSettingsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle id")
		return
	}
	key := chi.URLParam(r, "key")
	if !settingsdb.IsValidVehicleSettingKey(key) {
		writeErrorCode(w, http.StatusBadRequest, "unsupported setting key", VehicleSettingsCodeInvalidKey)
		return
	}
	if err := h.requireVehicleExists(r.Context(), w, vehicleID); err != nil {
		return
	}

	if err := h.store.Delete(r.Context(), vehicleID, key); err != nil {
		if errors.Is(err, settingsdb.ErrVehicleSettingNotFound) {
			// Idempotent — caller wanted the override gone, and
			// it already is. The resolver will fall through to
			// the user-level layer on the next read.
			w.WriteHeader(http.StatusNoContent)
			return
		}
		switch {
		case errors.Is(err, settingsdb.ErrVehicleSettingInvalidKey):
			writeErrorCode(w, http.StatusBadRequest, "unsupported setting key", VehicleSettingsCodeInvalidKey)
		default:
			writeError(w, http.StatusInternalServerError, "failed to delete setting")
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// requireVehicleExists writes a 404 (or a propagated 500 on a real
// error) and returns a non-nil error when the vehicle id does not
// resolve. The non-nil error is the caller's signal to STOP — the
// HTTP response has already been written.
func (h *VehicleSettingsHandler) requireVehicleExists(ctx context.Context, w http.ResponseWriter, vehicleID int64) error {
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

// decodeValueForKey decodes the raw JSON value into the Go type the
// repo's per-key validator expects. Returns an error when the JSON
// doesn't match the kind so the handler can blanket-map to 400
// INVALID_VALUE.
//
// The dispatch table here MUST stay in lockstep with vehicleSettingDefs
// in the database package — see VehicleSettingDefs() for the canonical
// list. The handler test asserts the symmetry.
func decodeValueForKey(key string, raw json.RawMessage) (any, error) {
	defs := settingsdb.VehicleSettingDefs()
	var def settingsdb.VehicleSettingDef
	for _, d := range defs {
		if d.Key == key {
			def = d
			break
		}
	}
	if def.Key == "" {
		return nil, settingsdb.ErrVehicleSettingInvalidKey
	}
	switch def.Kind {
	case settingsdb.VehicleSettingKindText:
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return nil, settingsdb.ErrVehicleSettingInvalidValue
		}
		return s, nil
	case settingsdb.VehicleSettingKindNumber:
		var f float64
		if err := json.Unmarshal(raw, &f); err != nil {
			return nil, settingsdb.ErrVehicleSettingInvalidValue
		}
		return f, nil
	case settingsdb.VehicleSettingKindBoolean:
		var b bool
		if err := json.Unmarshal(raw, &b); err != nil {
			return nil, settingsdb.ErrVehicleSettingInvalidValue
		}
		return b, nil
	case settingsdb.VehicleSettingKindTimestamp:
		// Accept RFC3339 strings only — anything else (epoch
		// number, "now") would be ambiguous across timezones.
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return nil, settingsdb.ErrVehicleSettingInvalidValue
		}
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return nil, settingsdb.ErrVehicleSettingInvalidValue
		}
		return t, nil
	default:
		return nil, settingsdb.ErrVehicleSettingInvalidValue
	}
}

// vehicleExistenceCheckerAdapter adapts the production *VehicleRepo
// to the VehicleExistenceChecker seam. Cheap probe — uses GetByID
// and discards the result.
type vehicleExistenceCheckerAdapter struct {
	repo *vehicledb.VehicleRepo
}

// NewVehicleExistenceChecker returns a VehicleExistenceChecker
// backed by the supplied *vehicledb.VehicleRepo. Returns nil when
// repo is nil so the caller can wire a safe default in test
// harnesses; production passes a non-nil repo.
func NewVehicleExistenceChecker(repo *vehicledb.VehicleRepo) VehicleExistenceChecker {
	if repo == nil {
		return nil
	}
	return &vehicleExistenceCheckerAdapter{repo: repo}
}

// Exists returns true when GetByID finds the vehicle, false when it
// returns nil (the repo's "not found" signal). Errors propagate so
// the handler can 500 the request.
func (a *vehicleExistenceCheckerAdapter) Exists(ctx context.Context, vehicleID int64) (bool, error) {
	v, err := a.repo.GetByID(ctx, vehicleID)
	if err != nil {
		return false, err
	}
	return v != nil, nil
}

// MarshalVehicleSettingPayload is a sugar helper used by handler
// tests + future external callers that want to construct the GET
// payload manually. Returns the canonical JSON shape so contract
// tests don't drift.
func MarshalVehicleSettingPayload(settings []settingsdb.EffectiveSetting) ([]byte, error) {
	return json.Marshal(vehicleSettingsListResponse{Settings: settings})
}
