package batterydegradation

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// healthLoaderFunc loads the full battery health response backing a
// certificate. Handler.buildBatteryHealth satisfies it.
type healthLoaderFunc func(ctx context.Context, vehicleID int64) (*batteryHealthResponse, batteryHealthTimings, error)

// CertificateHandler issues server-signed battery certificates
// (authenticated) and verifies them (public, no auth). It reuses the
// battery-health loader so the attestation always matches what the owner
// sees in the app.
//
// Stateless beyond its constructor inputs; safe for concurrent use.
type CertificateHandler struct {
	load   healthLoaderFunc
	signer *CertSigner
	now    func() time.Time
}

// NewCertificateHandler wires the handler. Panics on nil inputs
// (fail-fast wiring contract, matching sibling handlers).
func NewCertificateHandler(load healthLoaderFunc, signer *CertSigner) *CertificateHandler {
	if load == nil || signer == nil {
		panic("batterydegradation: nil certificate dependency")
	}
	return &CertificateHandler{load: load, signer: signer, now: time.Now}
}

// NewCertificateHandlerFromBatteryHandler wires the handler from the
// battery-health Handler so the attestation reuses its loader (and cache
// behavior) without exporting loader internals.
func NewCertificateHandlerFromBatteryHandler(h *Handler, signer *CertSigner) *CertificateHandler {
	if h == nil {
		panic("batterydegradation: nil battery handler")
	}
	return NewCertificateHandler(h.healthLoader, signer)
}

type certificateIssueResponse struct {
	Certificate *BatteryCertificate `json:"certificate"`
	Signature   string              `json:"signature"`
}

// Issue serves GET /analytics/battery-health/certificate?vehicle_id=.
func (h *CertificateHandler) Issue(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return
	}

	health, _, err := h.load(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("battery certificate: health load failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load battery health")
		return
	}

	cert := NewBatteryCertificate(health, h.now())
	sig, err := h.signer.Sign(cert)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("battery certificate: sign failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to sign certificate")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, certificateIssueResponse{Certificate: cert, Signature: sig})
}

type certificateVerifyRequest struct {
	Certificate *BatteryCertificate `json:"certificate"`
	Signature   string              `json:"signature"`
}

type certificateVerifyResponse struct {
	Valid       bool                `json:"valid"`
	Certificate *BatteryCertificate `json:"certificate,omitempty"`
}

// Verify serves POST /api/v1/public/battery-certificate/verify. Public: no
// auth, rate-limited at the router. It never reveals why verification
// failed beyond the boolean — the certificate is caller-supplied.
func (h *CertificateHandler) Verify(w http.ResponseWriter, r *http.Request) {
	var req certificateVerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Certificate == nil || req.Signature == "" {
		httpx.WriteError(w, http.StatusBadRequest, "certificate and signature are required")
		return
	}

	if !h.signer.Verify(req.Certificate, req.Signature, h.now()) {
		httpx.WriteJSON(w, http.StatusOK, certificateVerifyResponse{Valid: false})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, certificateVerifyResponse{Valid: true, Certificate: req.Certificate})
}
