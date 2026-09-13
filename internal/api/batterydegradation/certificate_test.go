package batterydegradation

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func testHealth() *batteryHealthResponse {
	score := 82
	reason := "garage-kept"
	return &batteryHealthResponse{
		VehicleID:                 7,
		CurrentSoh:                91.5,
		EstimatedCapacityWh:       68625,
		OriginalCapacityWh:        75000,
		DegradationRatePctPerYear: 1.8,
		BatteryAgeMonths:          36,
		TotalCycles:               412,
		ChargeHabitsScore:         88,
		StressLevel:               "low",
		FastChargePct:             12.5,
		TempExposureScore:         &score,
		TempExposureReason:        &reason,
	}
}

func testSigner() *CertSigner {
	return NewCertSigner(DeriveCertKey("test-jwt-secret"))
}

func TestCertificateRoundTrip(t *testing.T) {
	now := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	cert := NewBatteryCertificate(testHealth(), now)

	if cert.Issuer != "teslasync" || cert.Version != 1 {
		t.Fatalf("unexpected header: %+v", cert)
	}
	if !cert.ExpiresAt.Equal(now.Add(30 * 24 * time.Hour)) {
		t.Fatalf("expires_at = %v, want +30d", cert.ExpiresAt)
	}
	if cert.EstimatedCapacityKWh != 68.625 {
		t.Fatalf("estimated_capacity_kwh = %v, want 68.625", cert.EstimatedCapacityKWh)
	}

	signer := testSigner()
	sig, err := signer.Sign(cert)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if !signer.Verify(cert, sig, now.Add(time.Hour)) {
		t.Fatal("valid certificate did not verify")
	}
}

func TestCertificateRejectsTampering(t *testing.T) {
	now := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	signer := testSigner()
	cert := NewBatteryCertificate(testHealth(), now)
	sig, err := signer.Sign(cert)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	tampered := *cert
	tampered.CurrentSOH = 99.9
	if signer.Verify(&tampered, sig, now) {
		t.Fatal("tampered certificate verified")
	}
	if signer.Verify(cert, sig+"00", now) {
		t.Fatal("corrupted signature verified")
	}
	if signer.Verify(cert, "not-hex!!", now) {
		t.Fatal("non-hex signature verified")
	}
}

func TestCertificateRejectsExpiryAndWrongKey(t *testing.T) {
	now := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	signer := testSigner()
	cert := NewBatteryCertificate(testHealth(), now)
	sig, err := signer.Sign(cert)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if signer.Verify(cert, sig, now.Add(31*24*time.Hour)) {
		t.Fatal("expired certificate verified")
	}
	other := NewCertSigner(DeriveCertKey("different-secret"))
	if other.Verify(cert, sig, now) {
		t.Fatal("certificate verified under a different key")
	}
	// Domain separation: the raw JWT secret is not the HMAC key.
	raw := NewCertSigner([]byte("test-jwt-secret"))
	if raw.Verify(cert, sig, now) {
		t.Fatal("certificate verified under the raw JWT secret")
	}
}

func newCertHandlerForTest() *CertificateHandler {
	h := NewCertificateHandler(
		func(_ context.Context, _ int64) (*batteryHealthResponse, batteryHealthTimings, error) {
			return testHealth(), batteryHealthTimings{}, nil
		},
		testSigner(),
	)
	h.now = func() time.Time { return time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC) }
	return h
}

func TestIssueReturnsSignedCertificate(t *testing.T) {
	h := newCertHandlerForTest()
	req := httptest.NewRequest(http.MethodGet, "/certificate?vehicle_id=7", nil)
	rec := httptest.NewRecorder()
	h.Issue(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var res certificateIssueResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if res.Certificate == nil || res.Signature == "" {
		t.Fatalf("missing certificate or signature: %+v", res)
	}
	if !testSigner().Verify(res.Certificate, res.Signature, time.Date(2026, 3, 2, 0, 0, 0, 0, time.UTC)) {
		t.Fatal("issued certificate does not verify")
	}
}

func TestIssueRejectsBadVehicle(t *testing.T) {
	h := newCertHandlerForTest()
	req := httptest.NewRequest(http.MethodGet, "/certificate", nil)
	rec := httptest.NewRecorder()
	h.Issue(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestVerifyEndpointAcceptsAndRejects(t *testing.T) {
	h := newCertHandlerForTest()
	now := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	cert := NewBatteryCertificate(testHealth(), now)
	sig, err := testSigner().Sign(cert)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	post := func(body interface{}) certificateVerifyResponse {
		t.Helper()
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/verify", bytes.NewReader(raw))
		rec := httptest.NewRecorder()
		h.Verify(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		var res certificateVerifyResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return res
	}

	if got := post(certificateVerifyRequest{Certificate: cert, Signature: sig}); !got.Valid {
		t.Fatal("valid certificate rejected")
	}
	tampered := *cert
	tampered.TotalCycles = 0
	if got := post(certificateVerifyRequest{Certificate: &tampered, Signature: sig}); got.Valid {
		t.Fatal("tampered certificate accepted")
	}
}
