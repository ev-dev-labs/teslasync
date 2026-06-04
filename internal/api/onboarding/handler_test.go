package onboarding

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	authmodel "github.com/ev-dev-labs/teslasync/internal/models/auth"

	dbuser "github.com/ev-dev-labs/teslasync/internal/database/user"
)

// fakeTokenReader satisfies onboardingTokenReader for unit tests.
type fakeTokenReader struct {
	token *authmodel.Token
	err   error
}

func (f fakeTokenReader) Get(_ context.Context) (*authmodel.Token, error) {
	return f.token, f.err
}

// fakeOnboardingRepo satisfies onboardingStatusReader for unit tests.
type fakeOnboardingRepo struct {
	status *dbuser.OnboardingStatus
	err    error
}

func (f fakeOnboardingRepo) Get(_ context.Context) (*dbuser.OnboardingStatus, error) {
	return f.status, f.err
}

func decodeStatus(t *testing.T, body []byte) onboardingStatusResponse {
	t.Helper()
	var resp onboardingStatusResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode response: %v (body=%s)", err, string(body))
	}
	return resp
}

func TestHandler_Status_FreshInstall(t *testing.T) {
	h := &Handler{
		tokens: fakeTokenReader{token: nil},
		repo:   fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 0, DataFlowing: false}},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	resp := decodeStatus(t, rec.Body.Bytes())
	if resp.TeslaConnected {
		t.Errorf("TeslaConnected = true, want false on a fresh install")
	}
	if resp.VehicleCount != 0 {
		t.Errorf("VehicleCount = %d, want 0", resp.VehicleCount)
	}
	if resp.DataFlowing {
		t.Errorf("DataFlowing = true, want false")
	}
	if resp.IsComplete {
		t.Errorf("IsComplete = true, want false on a fresh install")
	}
}

func TestHandler_Status_TokenOnly(t *testing.T) {
	h := &Handler{
		tokens: fakeTokenReader{token: &authmodel.Token{AccessToken: "abc"}},
		repo:   fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 0, DataFlowing: false}},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	resp := decodeStatus(t, rec.Body.Bytes())
	if !resp.TeslaConnected {
		t.Errorf("TeslaConnected = false, want true when access token is present")
	}
	if resp.IsComplete {
		t.Errorf("IsComplete = true with no vehicles and no data, want false")
	}
}

func TestHandler_Status_TokenAndVehicleNoData(t *testing.T) {
	h := &Handler{
		tokens: fakeTokenReader{token: &authmodel.Token{AccessToken: "abc"}},
		repo:   fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 1, DataFlowing: false}},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	resp := decodeStatus(t, rec.Body.Bytes())
	if resp.IsComplete {
		t.Errorf("IsComplete = true while data_flowing=false, want false (all three anchors required)")
	}
	if resp.VehicleCount != 1 {
		t.Errorf("VehicleCount = %d, want 1", resp.VehicleCount)
	}
}

func TestHandler_Status_AllConditionsMet(t *testing.T) {
	h := &Handler{
		tokens: fakeTokenReader{token: &authmodel.Token{AccessToken: "abc"}},
		repo:   fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 2, DataFlowing: true}},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	resp := decodeStatus(t, rec.Body.Bytes())
	if !resp.IsComplete {
		t.Errorf("IsComplete = false with all anchors true, want true")
	}
	if !resp.TeslaConnected || !resp.DataFlowing || resp.VehicleCount != 2 {
		t.Errorf("unexpected response = %+v", resp)
	}
}

func TestHandler_Status_TokenWithEmptyAccessToken(t *testing.T) {
	// A row exists but AccessToken is blank — treat as not connected
	// rather than connected. This guards against partial-write
	// scenarios where the OAuth callback persisted a stub.
	h := &Handler{
		tokens: fakeTokenReader{token: &authmodel.Token{AccessToken: ""}},
		repo:   fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 1, DataFlowing: true}},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	resp := decodeStatus(t, rec.Body.Bytes())
	if resp.TeslaConnected {
		t.Errorf("TeslaConnected = true with empty AccessToken, want false")
	}
	if resp.IsComplete {
		t.Errorf("IsComplete = true with TeslaConnected=false, want false")
	}
}

func TestHandler_Status_TokenLookupErrorDoesNotBlockResponse(t *testing.T) {
	// A token lookup error should not 500 the endpoint — the gate
	// must keep functioning so the user can see an actionable page.
	h := &Handler{
		tokens: fakeTokenReader{err: errors.New("boom")},
		repo:   fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 0, DataFlowing: false}},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 even when token lookup fails", rec.Code)
	}
	resp := decodeStatus(t, rec.Body.Bytes())
	if resp.TeslaConnected {
		t.Errorf("TeslaConnected = true after token error, want false (degrade safely)")
	}
}

func TestHandler_Status_RepoError500(t *testing.T) {
	// A repo error IS a hard failure — the gate cannot make any claim
	// about vehicle/signal state, so we surface a 500 rather than
	// fabricating "not complete".
	h := &Handler{
		tokens: fakeTokenReader{token: &authmodel.Token{AccessToken: "abc"}},
		repo:   fakeOnboardingRepo{err: errors.New("db down")},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 on repo failure; body=%s", rec.Code, rec.Body.String())
	}
}
