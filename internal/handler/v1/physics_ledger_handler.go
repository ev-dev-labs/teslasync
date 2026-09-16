package v1

import (
	"context"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/physicssvc"
	"github.com/ev-dev-labs/teslasync/internal/physics"
)

type PhysicsLedgerHandler struct{ svc *physicssvc.Service }

func NewPhysicsLedgerHandler(svc *physicssvc.Service) *PhysicsLedgerHandler {
	return &PhysicsLedgerHandler{svc: svc}
}
func (h *PhysicsLedgerHandler) Ledger(w http.ResponseWriter, r *http.Request) {
	h.window(w, r, "range")
}
func (h *PhysicsLedgerHandler) ParkLedger(w http.ResponseWriter, r *http.Request) {
	h.window(w, r, "park")
}
func (h *PhysicsLedgerHandler) window(w http.ResponseWriter, r *http.Request, kind string) {
	respondAnalysis(w, r, "api.physics."+kind, func(ctx context.Context) (*physics.Ledger, error) {
		id, from, to, err := analysisWindow(r, time.Now().UTC(), 24*time.Hour, 366*24*time.Hour)
		if err != nil {
			return nil, err
		}
		return h.svc.Window(ctx, id, kind, from, to)
	})
}
func (h *PhysicsLedgerHandler) DriveLedger(w http.ResponseWriter, r *http.Request) {
	respondAnalysis(w, r, "api.physics.drive", func(ctx context.Context) (*physics.Ledger, error) {
		id, err := analysisID(r, "driveID")
		if err != nil {
			return nil, err
		}
		return h.svc.Drive(ctx, id)
	})
}
func (h *PhysicsLedgerHandler) ChargeLedger(w http.ResponseWriter, r *http.Request) {
	respondAnalysis(w, r, "api.physics.charge", func(ctx context.Context) (*physics.Ledger, error) {
		id, err := analysisID(r, "sessionID")
		if err != nil {
			return nil, err
		}
		return h.svc.Charge(ctx, id)
	})
}
