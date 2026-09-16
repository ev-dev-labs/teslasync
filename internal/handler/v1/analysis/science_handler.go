package analysis

import (
	"context"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/sciencesvc"
	"github.com/ev-dev-labs/teslasync/internal/science"
)

type ScienceHandler struct{ svc *sciencesvc.Service }

func NewScienceHandler(svc *sciencesvc.Service) *ScienceHandler { return &ScienceHandler{svc: svc} }
func (h *ScienceHandler) Electrochem(w http.ResponseWriter, r *http.Request) {
	h.report(w, r, "electrochem")
}
func (h *ScienceHandler) Thermal(w http.ResponseWriter, r *http.Request)  { h.report(w, r, "thermal") }
func (h *ScienceHandler) Weather(w http.ResponseWriter, r *http.Request)  { h.report(w, r, "weather") }
func (h *ScienceHandler) Tires(w http.ResponseWriter, r *http.Request)    { h.report(w, r, "tires") }
func (h *ScienceHandler) Notebook(w http.ResponseWriter, r *http.Request) { h.report(w, r, "notebook") }
func (h *ScienceHandler) report(w http.ResponseWriter, r *http.Request, kind string) {
	respondAnalysis(w, r, "api.science."+kind, func(ctx context.Context) (any, error) {
		id, from, to, err := analysisWindow(r, time.Now().UTC(), 7*24*time.Hour, 30*24*time.Hour)
		if err != nil {
			return nil, err
		}
		return h.svc.Report(ctx, kind, id, from, to)
	})
}
func (h *ScienceHandler) ChargeIR(w http.ResponseWriter, r *http.Request) {
	respondAnalysis(w, r, "api.science.charge_ir", func(ctx context.Context) (science.ChargeIRReport, error) {
		id, err := analysisID(r, "sessionID")
		if err != nil {
			return science.ChargeIRReport{}, err
		}
		return h.svc.ChargeIR(ctx, id)
	})
}
