package vehicleaccess

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	tesladb "github.com/ev-dev-labs/teslasync/internal/database/tesla"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/tesla"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// teslaFetchTimeout bounds a single outbound Tesla Fleet API call made while
// serving a share-access request. Without it a hung Tesla edge could pin a
// request goroutine indefinitely; 30s matches the Tesla API timeout budget
// used elsewhere in the codebase (see internal/api/teslauserconfig).
const teslaFetchTimeout = 30 * time.Second

// driverClient is the subset of *tesla.Client this handler needs. Depending on
// the port rather than the concrete client keeps the handler unit-testable
// without a live Fleet API or OAuth token.
type driverClient interface {
	HasValidToken() bool
	GetVehicleDrivers(ctx context.Context, vin string) ([]byte, int, error)
	RemoveVehicleDriver(ctx context.Context, vin string, shareUserID int64) ([]byte, int, error)
	GetVehicleInvitations(ctx context.Context, vin string) ([]byte, int, error)
	CreateVehicleInvitation(ctx context.Context, vin string) ([]byte, int, error)
	RevokeVehicleInvitation(ctx context.Context, vin, invitationID string) ([]byte, int, error)
}

// driverStore is the subset of *tesladb.TeslaVehicleDriverRepo this handler
// needs — the persistence port for stored drivers and invitations.
type driverStore interface {
	GetDriversByVehicleID(ctx context.Context, vehicleID int64) ([]*teslamodel.TeslaVehicleDriver, error)
	ReplaceDriversForVehicle(ctx context.Context, vehicleID int64, drivers []*teslamodel.TeslaVehicleDriver) error
	GetInvitationsByVehicleID(ctx context.Context, vehicleID int64) ([]*teslamodel.TeslaVehicleInvitation, error)
	ReplaceInvitationsForVehicle(ctx context.Context, vehicleID int64, invitations []*teslamodel.TeslaVehicleInvitation) error
	InsertInvitation(ctx context.Context, inv *teslamodel.TeslaVehicleInvitation) error
}

// vehicleStore is the subset of *vehicledb.VehicleRepo this handler needs to
// resolve the {vehicleID} URL param to a VIN.
type vehicleStore interface {
	GetByID(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
}

// Compile-time guarantees that the production dependencies still satisfy the
// ports the handler is written against, so an upstream signature drift fails
// the build here rather than at wiring time in router.go.
var (
	_ driverClient = (*tesla.Client)(nil)
	_ driverStore  = (*tesladb.TeslaVehicleDriverRepo)(nil)
	_ vehicleStore = (*vehicledb.VehicleRepo)(nil)
)

// Handler serves vehicle driver and share invitation data.
type Handler struct {
	teslaClient driverClient
	repo        driverStore
	vehicleRepo vehicleStore
}

// NewHandler wires Tesla share-access dependencies.
func NewHandler(tc *tesla.Client, db *database.DB) *Handler {
	return &Handler{
		teslaClient: tc,
		repo:        tesladb.NewTeslaVehicleDriverRepo(db),
		vehicleRepo: vehicledb.NewVehicleRepo(db),
	}
}

// resolveVehicle looks up the vehicle for the {vehicleID} URL param. On any
// failure it writes the appropriate error response and returns ok=false so the
// caller can return immediately:
//
//   - malformed / missing {vehicleID}   → 400 Bad Request
//   - repository lookup error           → 500 Internal Server Error (logged;
//     the internal cause is never leaked to the client)
//   - no such vehicle                   → 404 Not Found
//
// Previously every failure — including a transient DB error — collapsed to a
// 400 that echoed the raw wrapped error string back to the caller, both
// mis-classifying server faults as client faults and disclosing internal
// detail. This restores the REST semantics documented in the Go backend guide.
func (h *Handler) resolveVehicle(w http.ResponseWriter, r *http.Request) (*vehiclemodel.Vehicle, bool) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return nil, false
	}
	vehicle, err := h.vehicleRepo.GetByID(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to fetch vehicle")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to fetch vehicle")
		return nil, false
	}
	if vehicle == nil {
		httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		return nil, false
	}
	return vehicle, true
}

// ListDrivers returns stored drivers for a vehicle.
// GET /api/v1/vehicles/{vehicleID}/drivers
func (h *Handler) ListDrivers(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	drivers, err := h.repo.GetDriversByVehicleID(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to list vehicle drivers")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list drivers")
		return
	}
	if drivers == nil {
		drivers = []*teslamodel.TeslaVehicleDriver{}
	}
	httpx.WriteJSON(w, http.StatusOK, drivers)
}

// RefreshDrivers fetches drivers from Tesla API and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/drivers/refresh
func (h *Handler) RefreshDrivers(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	vehicle, ok := h.resolveVehicle(w, r)
	if !ok {
		return
	}

	log.Info().Int64("vehicle_id", vehicle.ID).Msg("refreshing vehicle drivers from Tesla")

	ctx, cancel := context.WithTimeout(r.Context(), teslaFetchTimeout)
	defer cancel()

	body, status, err := h.teslaClient.GetVehicleDrivers(ctx, vehicle.VIN)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("tesla vehicle drivers API error")
		httpx.WriteError(w, http.StatusBadGateway, "failed to fetch drivers from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla vehicle drivers non-2xx")
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	drivers, err := parseDriversResponse(body, vehicle.ID, vehicle.VIN)
	if err != nil {
		log.Error().Err(err).Msg("failed to parse drivers response")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	if err := h.repo.ReplaceDriversForVehicle(r.Context(), vehicle.ID, drivers); err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("failed to save vehicle drivers")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save drivers")
		return
	}

	stored, err := h.repo.GetDriversByVehicleID(r.Context(), vehicle.ID)
	if err != nil {
		log.Error().Err(err).Msg("failed to list drivers after refresh")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list drivers")
		return
	}
	if stored == nil {
		stored = []*teslamodel.TeslaVehicleDriver{}
	}

	log.Info().Int("count", len(stored)).Int64("vehicle_id", vehicle.ID).Msg("vehicle drivers refresh complete")
	httpx.WriteJSON(w, http.StatusOK, stored)
}

// RemoveDriver revokes a driver's access via Tesla API and refreshes from Tesla.
// DELETE /api/v1/vehicles/{vehicleID}/drivers
func (h *Handler) RemoveDriver(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	vehicle, ok := h.resolveVehicle(w, r)
	if !ok {
		return
	}

	var req struct {
		ShareUserID int64 `json:"share_user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.ShareUserID == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "share_user_id is required")
		return
	}

	log.Info().Int64("vehicle_id", vehicle.ID).Int64("share_user_id", req.ShareUserID).Msg("removing vehicle driver via Tesla")

	ctx, cancel := context.WithTimeout(r.Context(), teslaFetchTimeout)
	defer cancel()

	_, status, err := h.teslaClient.RemoveVehicleDriver(ctx, vehicle.VIN, req.ShareUserID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("tesla remove driver API error")
		httpx.WriteError(w, http.StatusBadGateway, "failed to remove driver via Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Int64("vehicle_id", vehicle.ID).Msg("tesla remove driver non-2xx")
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	h.RefreshDrivers(w, r)
}

// ListInvitations returns stored invitations for a vehicle.
// GET /api/v1/vehicles/{vehicleID}/invitations
func (h *Handler) ListInvitations(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	invitations, err := h.repo.GetInvitationsByVehicleID(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to list vehicle invitations")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list invitations")
		return
	}
	if invitations == nil {
		invitations = []*teslamodel.TeslaVehicleInvitation{}
	}
	httpx.WriteJSON(w, http.StatusOK, invitations)
}

// RefreshInvitations fetches invitations from Tesla API and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/invitations/refresh
func (h *Handler) RefreshInvitations(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	vehicle, ok := h.resolveVehicle(w, r)
	if !ok {
		return
	}

	log.Info().Int64("vehicle_id", vehicle.ID).Msg("refreshing vehicle invitations from Tesla")

	ctx, cancel := context.WithTimeout(r.Context(), teslaFetchTimeout)
	defer cancel()

	body, status, err := h.teslaClient.GetVehicleInvitations(ctx, vehicle.VIN)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("tesla vehicle invitations API error")
		httpx.WriteError(w, http.StatusBadGateway, "failed to fetch invitations from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla vehicle invitations non-2xx")
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	invitations, err := parseInvitationsResponse(body, vehicle.ID, vehicle.VIN)
	if err != nil {
		log.Error().Err(err).Msg("failed to parse invitations response")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	if err := h.repo.ReplaceInvitationsForVehicle(r.Context(), vehicle.ID, invitations); err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("failed to save vehicle invitations")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save invitations")
		return
	}

	stored, err := h.repo.GetInvitationsByVehicleID(r.Context(), vehicle.ID)
	if err != nil {
		log.Error().Err(err).Msg("failed to list invitations after refresh")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list invitations")
		return
	}
	if stored == nil {
		stored = []*teslamodel.TeslaVehicleInvitation{}
	}

	log.Info().Int("count", len(stored)).Int64("vehicle_id", vehicle.ID).Msg("vehicle invitations refresh complete")
	httpx.WriteJSON(w, http.StatusOK, stored)
}

// CreateInvitation creates a share invite via Tesla API and refreshes from Tesla.
// POST /api/v1/vehicles/{vehicleID}/invitations
func (h *Handler) CreateInvitation(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	vehicle, ok := h.resolveVehicle(w, r)
	if !ok {
		return
	}

	log.Info().Int64("vehicle_id", vehicle.ID).Msg("creating vehicle invitation via Tesla")

	ctx, cancel := context.WithTimeout(r.Context(), teslaFetchTimeout)
	defer cancel()

	body, status, err := h.teslaClient.CreateVehicleInvitation(ctx, vehicle.VIN)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("tesla create invitation API error")
		httpx.WriteError(w, http.StatusBadGateway, "failed to create invitation via Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla create invitation non-2xx")
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	inv, err := parseCreateInvitationResponse(body, vehicle.ID, vehicle.VIN)
	if err != nil {
		log.Error().Err(err).Msg("failed to parse create invitation response")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	if err := h.repo.InsertInvitation(r.Context(), inv); err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("failed to save invitation")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save invitation")
		return
	}

	log.Info().Str("invitation_id", inv.InvitationID).Int64("vehicle_id", vehicle.ID).Msg("vehicle invitation created")
	httpx.WriteJSON(w, http.StatusCreated, inv)
}

// RevokeInvitation revokes a pending invite via Tesla API and refreshes from Tesla.
// POST /api/v1/vehicles/{vehicleID}/invitations/{invitationID}/revoke
func (h *Handler) RevokeInvitation(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	vehicle, ok := h.resolveVehicle(w, r)
	if !ok {
		return
	}

	invitationID := chi.URLParam(r, "invitationID")
	if invitationID == "" {
		httpx.WriteError(w, http.StatusBadRequest, "invitation ID is required")
		return
	}

	log.Info().Int64("vehicle_id", vehicle.ID).Str("invitation_id", invitationID).Msg("revoking vehicle invitation via Tesla")

	ctx, cancel := context.WithTimeout(r.Context(), teslaFetchTimeout)
	defer cancel()

	_, status, err := h.teslaClient.RevokeVehicleInvitation(ctx, vehicle.VIN, invitationID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("tesla revoke invitation API error")
		httpx.WriteError(w, http.StatusBadGateway, "failed to revoke invitation via Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Int64("vehicle_id", vehicle.ID).Msg("tesla revoke invitation non-2xx")
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	h.RefreshInvitations(w, r)
}

func parseDriversResponse(body []byte, vehicleID int64, vin string) ([]*teslamodel.TeslaVehicleDriver, error) {
	var envelope struct {
		Response []json.RawMessage `json:"response"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("unmarshal drivers envelope: %w", err)
	}

	var drivers []*teslamodel.TeslaVehicleDriver
	for _, raw := range envelope.Response {
		var d struct {
			ShareUserID *int64  `json:"share_user_id"`
			Email       *string `json:"driver_email"`
			Name        *string `json:"driver_first_name"`
			PublicKey   string  `json:"public_key"`
			Role        *string `json:"role"`
		}
		if err := json.Unmarshal(raw, &d); err != nil {
			log.Warn().Err(err).Msg("skipping unparseable driver entry")
			continue
		}
		drivers = append(drivers, &teslamodel.TeslaVehicleDriver{
			VehicleID:   vehicleID,
			VIN:         vin,
			ShareUserID: d.ShareUserID,
			DriverEmail: d.Email,
			DriverName:  d.Name,
			Role:        d.Role,
		})
	}

	return drivers, nil
}

func parseInvitationsResponse(body []byte, vehicleID int64, vin string) ([]*teslamodel.TeslaVehicleInvitation, error) {
	var envelope struct {
		Response []json.RawMessage `json:"response"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("unmarshal invitations envelope: %w", err)
	}

	var invitations []*teslamodel.TeslaVehicleInvitation
	for _, raw := range envelope.Response {
		var inv struct {
			ID        string  `json:"id"`
			InviteURL *string `json:"invite_url"`
			Status    string  `json:"status"`
			ExpiresAt *string `json:"expires_at"`
			CreatedBy *string `json:"owner_email"`
		}
		if err := json.Unmarshal(raw, &inv); err != nil {
			log.Warn().Err(err).Msg("skipping unparseable invitation entry")
			continue
		}

		invitation := &teslamodel.TeslaVehicleInvitation{
			VehicleID:    vehicleID,
			VIN:          vin,
			InvitationID: inv.ID,
			InviteURL:    inv.InviteURL,
			Status:       inv.Status,
			CreatedBy:    inv.CreatedBy,
		}
		if inv.ExpiresAt != nil {
			if t, err := time.Parse(time.RFC3339, *inv.ExpiresAt); err == nil {
				invitation.ExpiresAt = &t
			}
		}
		if invitation.Status == "" {
			invitation.Status = "pending"
		}
		invitations = append(invitations, invitation)
	}

	return invitations, nil
}

func parseCreateInvitationResponse(body []byte, vehicleID int64, vin string) (*teslamodel.TeslaVehicleInvitation, error) {
	var envelope struct {
		Response json.RawMessage `json:"response"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("unmarshal create invitation envelope: %w", err)
	}

	var inv struct {
		ID        string  `json:"id"`
		InviteURL *string `json:"invite_url"`
		Status    string  `json:"status"`
		ExpiresAt *string `json:"expires_at"`
		CreatedBy *string `json:"owner_email"`
	}
	if err := json.Unmarshal(envelope.Response, &inv); err != nil {
		return nil, fmt.Errorf("unmarshal invitation: %w", err)
	}

	invitation := &teslamodel.TeslaVehicleInvitation{
		VehicleID:    vehicleID,
		VIN:          vin,
		InvitationID: inv.ID,
		InviteURL:    inv.InviteURL,
		Status:       inv.Status,
		CreatedBy:    inv.CreatedBy,
	}
	if inv.ExpiresAt != nil {
		if t, err := time.Parse(time.RFC3339, *inv.ExpiresAt); err == nil {
			invitation.ExpiresAt = &t
		}
	}
	if invitation.Status == "" {
		invitation.Status = "pending"
	}

	return invitation, nil
}

// truncateBody returns the first 500 bytes of a response body for
// logging. Duplicated from internal/api/tesla_energy_history_handler.go
// until that handler is also carved and the parent copy can be deleted.
func truncateBody(b []byte) string {
	if len(b) > 500 {
		return string(b[:500])
	}
	return string(b)
}
