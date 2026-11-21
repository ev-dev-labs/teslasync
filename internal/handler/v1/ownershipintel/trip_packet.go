package ownershipintel

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	packetsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/trippacket"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/trippacket"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	personalhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/trippacket"
)

type tripPacketService interface {
	Read(context.Context, port.Scope, int64) (domain.Review, error)
	Save(context.Context, port.Scope, domain.Plan) error
	EditEntry(context.Context, port.Scope, domain.Version, domain.Entry) error
	Clear(context.Context, port.Scope, domain.Version) error
	Dismiss(context.Context, port.Scope, domain.Version, time.Time) error
	Export(context.Context, port.Scope, domain.Version, string) (*domain.Packet, error)
}

func (h *Handler) WithTripPackets(service tripPacketService) *Handler {
	h.tripPacket = service
	return h
}

type packetVersionRequest struct {
	ID       int64 `json:"plan_id"`
	Revision int64 `json:"expected_revision"`
}

func (r packetVersionRequest) version() domain.Version {
	return domain.Version{ID: r.ID, Revision: r.Revision}
}

func (h *Handler) TripPacket(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "ownershipintel.TripPacket")
	defer span.End()
	subject, ok := personalhandler.Subject(w, r, h.headerName, "private trip packet")
	if !ok {
		return
	}
	if subject == personal.OpenSubject || subject == "open-mode" {
		writeError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "trip packets require a verified sign-in")
		return
	}
	vehicleID, err := parseVehicleID(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	scope := port.Scope{Subject: subject, VehicleID: vehicleID}
	var outcome string
	switch r.Method {
	case http.MethodGet:
		var id int64
		if r.URL.Query().Has("drive_id") {
			id, err = strconv.ParseInt(r.URL.Query().Get("drive_id"), 10, 64)
			if err != nil || id <= 0 {
				err = packetsvc.ErrInvalid
				break
			}
		}
		var result domain.Review
		result, err = h.tripPacket.Read(ctx, scope, id)
		if err == nil {
			writeJSON(w, http.StatusOK, result)
		}
	case http.MethodPut:
		var input struct {
			packetVersionRequest
			TimeZone  string `json:"time_zone"`
			Paused    bool   `json:"paused"`
			Confirmed bool   `json:"confirmed"`
		}
		if decodeBody(w, r, &input) != nil || !input.Paused && !input.Confirmed {
			err = packetsvc.ErrInvalid
			break
		}
		err = h.tripPacket.Save(ctx, scope, domain.Plan{Version: input.version(), TimeZone: input.TimeZone, Paused: input.Paused})
		outcome = "confirmed"
		if input.Paused {
			outcome = "paused"
		}
	case http.MethodPatch:
		var input struct {
			packetVersionRequest
			Entry   *domain.Entry `json:"entry"`
			Dismiss *time.Time    `json:"dismiss_through"`
		}
		if decodeBody(w, r, &input) != nil || (input.Entry == nil) == (input.Dismiss == nil) {
			err = packetsvc.ErrInvalid
			break
		}
		if input.Entry != nil {
			err = h.tripPacket.EditEntry(ctx, scope, input.version(), *input.Entry)
			outcome = "entry_saved"
		} else {
			err = h.tripPacket.Dismiss(ctx, scope, input.version(), *input.Dismiss)
			outcome = "dismissed"
		}
	case http.MethodDelete:
		id, idErr := strconv.ParseInt(r.URL.Query().Get("plan_id"), 10, 64)
		revision, revisionErr := strconv.ParseInt(r.URL.Query().Get("expected_revision"), 10, 64)
		if idErr != nil || revisionErr != nil {
			err = packetsvc.ErrInvalid
			break
		}
		err = h.tripPacket.Clear(ctx, scope, domain.Version{ID: id, Revision: revision})
		outcome = "cleared"
	case http.MethodPost:
		var input struct {
			packetVersionRequest
			Digest    string `json:"digest"`
			Confirmed bool   `json:"confirmed"`
		}
		if decodeBody(w, r, &input) != nil || !input.Confirmed || len(input.Digest) != 64 || !input.version().Valid() {
			err = packetsvc.ErrInvalid
			break
		}
		var packet *domain.Packet
		packet, err = h.tripPacket.Export(ctx, scope, input.version(), input.Digest)
		if err == nil {
			metrics.RecordTripPacket("exported", 1)
			writeJSON(w, http.StatusOK, packet)
		}
	}
	switch {
	case errors.Is(err, port.ErrNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "private trip packet or selected drive not found")
	case errors.Is(err, port.ErrChanged):
		writeError(w, http.StatusConflict, "TRIP_PACKET_CHANGED", "refresh the private trip packet before acting")
	case errors.Is(err, packetsvc.ErrInvalid), errors.Is(err, port.ErrReceiptDay):
		validationError(w, span, err)
	case err != nil:
		h.handleError(w, span, "manage private trip packet", errors.New("private trip packet operation failed"))
	case outcome != "":
		metrics.RecordTripPacket(outcome, 1)
		w.WriteHeader(http.StatusNoContent)
	}
}
