package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	tesladb "github.com/ev-dev-labs/teslasync/internal/database/tesla"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// VehicleAccessHandler serves vehicle driver and share invitation data.
type VehicleAccessHandler struct {
	teslaClient *tesla.Client
	repo        *tesladb.TeslaVehicleDriverRepo
	vehicleRepo *vehicledb.VehicleRepo
}

// NewVehicleAccessHandler creates a new handler.
func NewVehicleAccessHandler(tc *tesla.Client, db *database.DB) *VehicleAccessHandler {
	return &VehicleAccessHandler{
		teslaClient: tc,
		repo:        tesladb.NewTeslaVehicleDriverRepo(db),
		vehicleRepo: vehicledb.NewVehicleRepo(db),
	}
}

// resolveVehicle looks up the vehicle record from the vehicleID URL param.
func (h *VehicleAccessHandler) resolveVehicle(r *http.Request) (*vehiclemodel.Vehicle, error) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		return nil, fmt.Errorf("invalid vehicle ID: %w", err)
	}
	vehicle, err := h.vehicleRepo.GetByID(r.Context(), vehicleID)
	if err != nil {
		return nil, fmt.Errorf("fetch vehicle: %w", err)
	}
	if vehicle == nil {
		return nil, fmt.Errorf("vehicle not found")
	}
	return vehicle, nil
}

// ---------- Drivers ----------

// ListDrivers returns stored drivers for a vehicle.
// GET /api/v1/vehicles/{vehicleID}/drivers
func (h *VehicleAccessHandler) ListDrivers(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	drivers, err := h.repo.GetDriversByVehicleID(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to list vehicle drivers")
		writeError(w, http.StatusInternalServerError, "failed to list drivers")
		return
	}
	if drivers == nil {
		drivers = []*teslamodel.TeslaVehicleDriver{}
	}
	writeJSON(w, http.StatusOK, drivers)
}

// RefreshDrivers fetches drivers from Tesla API and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/drivers/refresh
func (h *VehicleAccessHandler) RefreshDrivers(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	vehicle, err := h.resolveVehicle(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	log.Info().Int64("vehicle_id", vehicle.ID).Msg("refreshing vehicle drivers from Tesla")

	body, status, err := h.teslaClient.GetVehicleDrivers(r.Context(), vehicle.VIN)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("tesla vehicle drivers API error")
		writeError(w, http.StatusBadGateway, "failed to fetch drivers from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla vehicle drivers non-2xx")
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	drivers, err := parseDriversResponse(body, vehicle.ID, vehicle.VIN)
	if err != nil {
		log.Error().Err(err).Msg("failed to parse drivers response")
		writeError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	if err := h.repo.ReplaceDriversForVehicle(r.Context(), vehicle.ID, drivers); err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("failed to save vehicle drivers")
		writeError(w, http.StatusInternalServerError, "failed to save drivers")
		return
	}

	stored, err := h.repo.GetDriversByVehicleID(r.Context(), vehicle.ID)
	if err != nil {
		log.Error().Err(err).Msg("failed to list drivers after refresh")
		writeError(w, http.StatusInternalServerError, "failed to list drivers")
		return
	}
	if stored == nil {
		stored = []*teslamodel.TeslaVehicleDriver{}
	}

	log.Info().Int("count", len(stored)).Int64("vehicle_id", vehicle.ID).Msg("vehicle drivers refresh complete")
	writeJSON(w, http.StatusOK, stored)
}

// RemoveDriver revokes a driver's access via Tesla API and refreshes from Tesla.
// DELETE /api/v1/vehicles/{vehicleID}/drivers
func (h *VehicleAccessHandler) RemoveDriver(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	vehicle, err := h.resolveVehicle(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var req struct {
		ShareUserID int64 `json:"share_user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.ShareUserID == 0 {
		writeError(w, http.StatusBadRequest, "share_user_id is required")
		return
	}

	log.Info().Int64("vehicle_id", vehicle.ID).Int64("share_user_id", req.ShareUserID).Msg("removing vehicle driver via Tesla")

	_, status, err := h.teslaClient.RemoveVehicleDriver(r.Context(), vehicle.VIN, req.ShareUserID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("tesla remove driver API error")
		writeError(w, http.StatusBadGateway, "failed to remove driver via Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Int64("vehicle_id", vehicle.ID).Msg("tesla remove driver non-2xx")
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	// Refresh drivers list from Tesla to reflect the change
	h.RefreshDrivers(w, r)
}

// ---------- Invitations ----------

// ListInvitations returns stored invitations for a vehicle.
// GET /api/v1/vehicles/{vehicleID}/invitations
func (h *VehicleAccessHandler) ListInvitations(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	invitations, err := h.repo.GetInvitationsByVehicleID(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to list vehicle invitations")
		writeError(w, http.StatusInternalServerError, "failed to list invitations")
		return
	}
	if invitations == nil {
		invitations = []*teslamodel.TeslaVehicleInvitation{}
	}
	writeJSON(w, http.StatusOK, invitations)
}

// RefreshInvitations fetches invitations from Tesla API and saves to DB.
// POST /api/v1/vehicles/{vehicleID}/invitations/refresh
func (h *VehicleAccessHandler) RefreshInvitations(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	vehicle, err := h.resolveVehicle(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	log.Info().Int64("vehicle_id", vehicle.ID).Msg("refreshing vehicle invitations from Tesla")

	body, status, err := h.teslaClient.GetVehicleInvitations(r.Context(), vehicle.VIN)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("tesla vehicle invitations API error")
		writeError(w, http.StatusBadGateway, "failed to fetch invitations from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla vehicle invitations non-2xx")
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	invitations, err := parseInvitationsResponse(body, vehicle.ID, vehicle.VIN)
	if err != nil {
		log.Error().Err(err).Msg("failed to parse invitations response")
		writeError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	if err := h.repo.ReplaceInvitationsForVehicle(r.Context(), vehicle.ID, invitations); err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("failed to save vehicle invitations")
		writeError(w, http.StatusInternalServerError, "failed to save invitations")
		return
	}

	stored, err := h.repo.GetInvitationsByVehicleID(r.Context(), vehicle.ID)
	if err != nil {
		log.Error().Err(err).Msg("failed to list invitations after refresh")
		writeError(w, http.StatusInternalServerError, "failed to list invitations")
		return
	}
	if stored == nil {
		stored = []*teslamodel.TeslaVehicleInvitation{}
	}

	log.Info().Int("count", len(stored)).Int64("vehicle_id", vehicle.ID).Msg("vehicle invitations refresh complete")
	writeJSON(w, http.StatusOK, stored)
}

// CreateInvitation creates a share invite via Tesla API and refreshes from Tesla.
// POST /api/v1/vehicles/{vehicleID}/invitations
func (h *VehicleAccessHandler) CreateInvitation(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	vehicle, err := h.resolveVehicle(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	log.Info().Int64("vehicle_id", vehicle.ID).Msg("creating vehicle invitation via Tesla")

	body, status, err := h.teslaClient.CreateVehicleInvitation(r.Context(), vehicle.VIN)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("tesla create invitation API error")
		writeError(w, http.StatusBadGateway, "failed to create invitation via Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Str("body", truncateBody(body)).Msg("tesla create invitation non-2xx")
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	// Parse and store the single invitation from the create response
	inv, err := parseCreateInvitationResponse(body, vehicle.ID, vehicle.VIN)
	if err != nil {
		log.Error().Err(err).Msg("failed to parse create invitation response")
		writeError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	if err := h.repo.InsertInvitation(r.Context(), inv); err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("failed to save invitation")
		writeError(w, http.StatusInternalServerError, "failed to save invitation")
		return
	}

	log.Info().Str("invitation_id", inv.InvitationID).Int64("vehicle_id", vehicle.ID).Msg("vehicle invitation created")
	writeJSON(w, http.StatusCreated, inv)
}

// RevokeInvitation revokes a pending invite via Tesla API and refreshes from Tesla.
// POST /api/v1/vehicles/{vehicleID}/invitations/{invitationID}/revoke
func (h *VehicleAccessHandler) RevokeInvitation(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	vehicle, err := h.resolveVehicle(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	invitationID := chi.URLParam(r, "invitationID")
	if invitationID == "" {
		writeError(w, http.StatusBadRequest, "invitation ID is required")
		return
	}

	log.Info().Int64("vehicle_id", vehicle.ID).Str("invitation_id", invitationID).Msg("revoking vehicle invitation via Tesla")

	_, status, err := h.teslaClient.RevokeVehicleInvitation(r.Context(), vehicle.VIN, invitationID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("tesla revoke invitation API error")
		writeError(w, http.StatusBadGateway, "failed to revoke invitation via Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Int64("vehicle_id", vehicle.ID).Msg("tesla revoke invitation non-2xx")
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
		return
	}

	// Refresh invitations from Tesla to reflect the change
	h.RefreshInvitations(w, r)
}

// ---------- Response parsers ----------

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
