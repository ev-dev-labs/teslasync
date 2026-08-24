package onboarding

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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

// fakeOnboardingStateReader satisfies onboardingStateReader for unit
// tests.
type fakeOnboardingStateReader struct {
	state dbuser.OnboardingState
	err   error
}

func (f fakeOnboardingStateReader) Get(_ context.Context) (dbuser.OnboardingState, error) {
	return f.state, f.err
}

// fakeOnboardingStateWriter satisfies onboardingStateWriter for unit
// tests. calls counts invocations so tests can assert the ratchet
// short-circuits once a durable completion is already on record.
type fakeOnboardingStateWriter struct {
	err   error
	calls int
}

func (f *fakeOnboardingStateWriter) MarkComplete(_ context.Context) (dbuser.OnboardingState, error) {
	f.calls++
	if f.err != nil {
		return dbuser.OnboardingState{}, f.err
	}
	now := time.Now()
	return dbuser.OnboardingState{Completed: true, CompletedAt: &now}, nil
}

// freshState builds the not-yet-completed durable state + a writer
// that succeeds, matching a brand new installation's durable row
// (backfilled to Completed:false by migration 000230, or seeded fresh).
func freshState() (fakeOnboardingStateReader, *fakeOnboardingStateWriter) {
	return fakeOnboardingStateReader{}, &fakeOnboardingStateWriter{}
}

// completedState builds an already-durably-completed state whose
// writer must NEVER be invoked by the handler (the ratchet should
// short-circuit before reaching it).
func completedState(completedAt time.Time) (fakeOnboardingStateReader, *fakeOnboardingStateWriter) {
	return fakeOnboardingStateReader{
		state: dbuser.OnboardingState{Completed: true, CompletedAt: &completedAt},
	}, &fakeOnboardingStateWriter{}
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
	state, writer := freshState()
	h := &Handler{
		tokens:      fakeTokenReader{token: nil},
		repo:        fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 0, DataFlowing: false}},
		state:       state,
		stateWriter: writer,
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
	if resp.SetupComplete {
		t.Errorf("SetupComplete = true, want false on a fresh install")
	}
	if !resp.SetupRequired {
		t.Errorf("SetupRequired = false, want true on a fresh install")
	}
	if resp.TelemetryHealth != "unknown" {
		t.Errorf("TelemetryHealth = %q, want %q with zero vehicles", resp.TelemetryHealth, "unknown")
	}
	if writer.calls != 0 {
		t.Errorf("MarkComplete called %d times, want 0 (liveComplete is false)", writer.calls)
	}
}

func TestHandler_Status_TokenOnly(t *testing.T) {
	state, writer := freshState()
	h := &Handler{
		tokens:      fakeTokenReader{token: &authmodel.Token{AccessToken: "abc"}},
		repo:        fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 0, DataFlowing: false}},
		state:       state,
		stateWriter: writer,
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
	if resp.SetupComplete {
		t.Errorf("SetupComplete = true with no vehicles and no data, want false")
	}
}

func TestHandler_Status_TokenAndVehicleNoData(t *testing.T) {
	state, writer := freshState()
	h := &Handler{
		tokens:      fakeTokenReader{token: &authmodel.Token{AccessToken: "abc"}},
		repo:        fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 1, DataFlowing: false}},
		state:       state,
		stateWriter: writer,
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	resp := decodeStatus(t, rec.Body.Bytes())
	if resp.IsComplete {
		t.Errorf("IsComplete = true while data_flowing=false, want false (all three anchors required)")
	}
	if resp.SetupComplete {
		t.Errorf("SetupComplete = true while data_flowing=false, want false (all three anchors required the first time)")
	}
	if resp.VehicleCount != 1 {
		t.Errorf("VehicleCount = %d, want 1", resp.VehicleCount)
	}
	if writer.calls != 0 {
		t.Errorf("MarkComplete called %d times, want 0 (liveComplete is false)", writer.calls)
	}
}

func TestHandler_Status_AllConditionsMet(t *testing.T) {
	state, writer := freshState()
	h := &Handler{
		tokens:      fakeTokenReader{token: &authmodel.Token{AccessToken: "abc"}},
		repo:        fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 2, DataFlowing: true}},
		state:       state,
		stateWriter: writer,
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	resp := decodeStatus(t, rec.Body.Bytes())
	if !resp.IsComplete {
		t.Errorf("IsComplete = false with all anchors true, want true")
	}
	if !resp.SetupComplete {
		t.Errorf("SetupComplete = false with all anchors true, want true")
	}
	if resp.SetupRequired {
		t.Errorf("SetupRequired = true with all anchors true, want false")
	}
	if !resp.TeslaConnected || !resp.DataFlowing || resp.VehicleCount != 2 {
		t.Errorf("unexpected response = %+v", resp)
	}
	if writer.calls != 1 {
		t.Errorf("MarkComplete called %d times, want 1 (first observed completion persists once)", writer.calls)
	}
}

func TestHandler_Status_TokenWithEmptyAccessToken(t *testing.T) {
	// A row exists but AccessToken is blank — treat as not connected
	// rather than connected. This guards against partial-write
	// scenarios where the OAuth callback persisted a stub.
	state, writer := freshState()
	h := &Handler{
		tokens:      fakeTokenReader{token: &authmodel.Token{AccessToken: ""}},
		repo:        fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 1, DataFlowing: true}},
		state:       state,
		stateWriter: writer,
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
	state, writer := freshState()
	h := &Handler{
		tokens:      fakeTokenReader{err: errors.New("boom")},
		repo:        fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 0, DataFlowing: false}},
		state:       state,
		stateWriter: writer,
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
	state, writer := freshState()
	h := &Handler{
		tokens:      fakeTokenReader{token: &authmodel.Token{AccessToken: "abc"}},
		repo:        fakeOnboardingRepo{err: errors.New("db down")},
		state:       state,
		stateWriter: writer,
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 on repo failure; body=%s", rec.Code, rec.Body.String())
	}
}

// --- Durable setup-required contract: the new behavior this feature adds ---

func TestHandler_Status_DurableCompletion_SurvivesTelemetryOutage(t *testing.T) {
	// Once the durable marker is set, a subsequent poll where telemetry
	// has gone stale (data_flowing=false) must NOT flip setup back to
	// required — this is the core regression the feature fixes.
	completedAt := time.Now().Add(-48 * time.Hour)
	state, writer := completedState(completedAt)
	h := &Handler{
		tokens:      fakeTokenReader{token: &authmodel.Token{AccessToken: "abc"}},
		repo:        fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 1, DataFlowing: false}},
		state:       state,
		stateWriter: writer,
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	resp := decodeStatus(t, rec.Body.Bytes())
	if !resp.SetupComplete || resp.SetupRequired {
		t.Errorf("durable completion did not survive telemetry outage: setup_complete=%v setup_required=%v",
			resp.SetupComplete, resp.SetupRequired)
	}
	if !resp.IsComplete {
		t.Errorf("IsComplete = false, want true (alias of durable SetupComplete)")
	}
	if writer.calls != 0 {
		t.Errorf("MarkComplete called %d times, want 0 — already-completed installs must not re-invoke the writer", writer.calls)
	}
}

func TestHandler_Status_DurableCompletion_SurvivesTokenExpiry(t *testing.T) {
	// Once durably complete, an expired/missing Tesla token (tesla_connected
	// flips false) must not make the install setup_required again either.
	completedAt := time.Now().Add(-24 * time.Hour)
	state, writer := completedState(completedAt)
	h := &Handler{
		tokens:      fakeTokenReader{token: nil},
		repo:        fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 1, DataFlowing: true}},
		state:       state,
		stateWriter: writer,
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	resp := decodeStatus(t, rec.Body.Bytes())
	if resp.TeslaConnected {
		t.Errorf("TeslaConnected = true, want false (token missing) — sanity check on test setup")
	}
	if !resp.SetupComplete || resp.SetupRequired {
		t.Errorf("durable completion did not survive token expiry: setup_complete=%v setup_required=%v",
			resp.SetupComplete, resp.SetupRequired)
	}
	if writer.calls != 0 {
		t.Errorf("MarkComplete called %d times, want 0", writer.calls)
	}
}

func TestHandler_Status_DurableWriteFailure_StillReportsCompleteForThisRequest(t *testing.T) {
	// A transient failure to PERSIST the first-observed completion must
	// not regress the user's UX for the request that just satisfied all
	// three live anchors — it should still report complete, and the
	// next successful tick is expected to persist it.
	state := fakeOnboardingStateReader{state: dbuser.OnboardingState{Completed: false}}
	writer := &fakeOnboardingStateWriter{err: errors.New("write timeout")}
	h := &Handler{
		tokens:      fakeTokenReader{token: &authmodel.Token{AccessToken: "abc"}},
		repo:        fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 1, DataFlowing: true}},
		state:       state,
		stateWriter: writer,
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 even when the durable write fails", rec.Code)
	}
	resp := decodeStatus(t, rec.Body.Bytes())
	if !resp.SetupComplete {
		t.Errorf("SetupComplete = false, want true — a failed durable write must not regress this response")
	}
	if writer.calls != 1 {
		t.Errorf("MarkComplete called %d times, want 1 (attempted once)", writer.calls)
	}
}

func TestHandler_Status_DurableStateReadError_DegradesToLiveComputation(t *testing.T) {
	// A failure reading the durable row must not 500 the gate — degrade
	// to the live three-anchor computation for this response.
	state := fakeOnboardingStateReader{err: errors.New("db down")}
	writer := &fakeOnboardingStateWriter{}
	h := &Handler{
		tokens:      fakeTokenReader{token: &authmodel.Token{AccessToken: "abc"}},
		repo:        fakeOnboardingRepo{status: &dbuser.OnboardingStatus{VehicleCount: 1, DataFlowing: true}},
		state:       state,
		stateWriter: writer,
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 even when the durable state read fails", rec.Code)
	}
	resp := decodeStatus(t, rec.Body.Bytes())
	if !resp.SetupComplete {
		t.Errorf("SetupComplete = false, want true — live anchors were all satisfied despite the state-read error")
	}
}

func TestHandler_Status_DurableStateReadError_DoesNotRegressConfiguredInstall(t *testing.T) {
	state := fakeOnboardingStateReader{err: errors.New("state row unavailable")}
	writer := &fakeOnboardingStateWriter{}
	h := &Handler{
		tokens: fakeTokenReader{token: &authmodel.Token{AccessToken: "abc"}},
		repo: fakeOnboardingRepo{status: &dbuser.OnboardingStatus{
			VehicleCount: 1,
			DataFlowing:  false,
		}},
		state:       state,
		stateWriter: writer,
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	resp := decodeStatus(t, rec.Body.Bytes())
	if !resp.SetupComplete || resp.SetupRequired {
		t.Errorf("configured install regressed after state read error: setup_complete=%v setup_required=%v",
			resp.SetupComplete, resp.SetupRequired)
	}
	if writer.calls != 0 {
		t.Errorf("MarkComplete called %d times, want 0 without live telemetry", writer.calls)
	}
}

func TestHandler_Status_TelemetryHealth_Stale(t *testing.T) {
	past := time.Now().Add(-72 * time.Hour)
	state, writer := freshState()
	h := &Handler{
		tokens: fakeTokenReader{token: &authmodel.Token{AccessToken: "abc"}},
		repo: fakeOnboardingRepo{status: &dbuser.OnboardingStatus{
			VehicleCount: 1,
			DataFlowing:  false,
			LastSignalAt: &past,
		}},
		state:       state,
		stateWriter: writer,
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	resp := decodeStatus(t, rec.Body.Bytes())
	if resp.TelemetryHealth != "stale" {
		t.Errorf("TelemetryHealth = %q, want %q", resp.TelemetryHealth, "stale")
	}
	if resp.LastTelemetryAt == nil {
		t.Errorf("LastTelemetryAt = nil, want non-nil")
	}
}

func TestHandler_Status_TelemetryHealth_Healthy(t *testing.T) {
	recent := time.Now().Add(-5 * time.Minute)
	state, writer := freshState()
	h := &Handler{
		tokens: fakeTokenReader{token: &authmodel.Token{AccessToken: "abc"}},
		repo: fakeOnboardingRepo{status: &dbuser.OnboardingStatus{
			VehicleCount: 1,
			DataFlowing:  true,
			LastSignalAt: &recent,
		}},
		state:       state,
		stateWriter: writer,
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/onboarding/status", nil)
	h.Status(rec, req)

	resp := decodeStatus(t, rec.Body.Bytes())
	if resp.TelemetryHealth != "healthy" {
		t.Errorf("TelemetryHealth = %q, want %q", resp.TelemetryHealth, "healthy")
	}
}
