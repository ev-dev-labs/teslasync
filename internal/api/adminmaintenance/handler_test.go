package adminmaintenance

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
)

// fakeSystemStateStore is an in-memory SystemStateStore used by these
// unit tests. It captures the last Set arguments so assertions can
// inspect them and supports forced-error injection for the failure paths.
type fakeSystemStateStore struct {
	state     systemdb.SystemState
	getErr    error
	setErr    error
	lastMode  string
	lastMsg   string
	lastUntil *time.Time
	lastBy    string
	calls     int
}

func (f *fakeSystemStateStore) Get(_ context.Context) (systemdb.SystemState, error) {
	if f.getErr != nil {
		return systemdb.SystemState{}, f.getErr
	}
	return f.state, nil
}

func (f *fakeSystemStateStore) Set(_ context.Context, mode, message string, until *time.Time, updatedBy string) (systemdb.SystemState, error) {
	f.calls++
	f.lastMode = mode
	f.lastMsg = message
	f.lastUntil = until
	f.lastBy = updatedBy
	if f.setErr != nil {
		return systemdb.SystemState{}, f.setErr
	}
	f.state = systemdb.SystemState{
		Mode:               mode,
		MaintenanceMessage: systemdb.NormalizeMaintenanceMessage(message),
		MaintenanceUntil:   until,
		UpdatedAt:          time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC),
		UpdatedBy:          updatedBy,
	}
	if mode == systemdb.SystemModeOK {
		f.state.MaintenanceMessage = ""
		f.state.MaintenanceUntil = nil
	}
	return f.state, nil
}

func newTestCfg() *config.Config {
	return &config.Config{
		Auth: config.AuthConfig{ForwardAuthHeader: "X-User"},
	}
}

func TestAdminMaintenanceGet(t *testing.T) {
	store := &fakeSystemStateStore{
		state: systemdb.SystemState{
			Mode:               systemdb.SystemModeMaintenance,
			MaintenanceMessage: "DB upgrade",
			UpdatedAt:          time.Date(2025, 1, 1, 12, 0, 0, 0, time.UTC),
			UpdatedBy:          "alice",
		},
	}
	h := NewAdminMaintenanceHandler(store, newTestCfg())

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/maintenance", nil)
	h.Get(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var resp adminMaintenanceResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Mode != "maintenance" || resp.Message != "DB upgrade" || resp.UpdatedBy != "alice" || resp.Source != "db" {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

func TestAdminMaintenanceGetStoreErrorReturns500(t *testing.T) {
	store := &fakeSystemStateStore{getErr: errors.New("boom")}
	h := NewAdminMaintenanceHandler(store, newTestCfg())

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/maintenance", nil)
	h.Get(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: got %d, want 500", rec.Code)
	}
}

func TestAdminMaintenanceSetHappyPath(t *testing.T) {
	store := &fakeSystemStateStore{}
	h := NewAdminMaintenanceHandler(store, newTestCfg())

	body := `{"mode":"maintenance","message":"upgrade","until":"2099-01-02T03:04:05Z"}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/maintenance", strings.NewReader(body))
	req.Header.Set("X-User", "alice@example.com")
	h.Set(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if store.calls != 1 || store.lastMode != "maintenance" || store.lastMsg != "upgrade" || store.lastBy != "alice@example.com" {
		t.Fatalf("unexpected store args: calls=%d mode=%q msg=%q by=%q", store.calls, store.lastMode, store.lastMsg, store.lastBy)
	}
	if store.lastUntil == nil || !store.lastUntil.Equal(time.Date(2099, 1, 2, 3, 4, 5, 0, time.UTC)) {
		t.Fatalf("until not parsed: %v", store.lastUntil)
	}
	var resp adminMaintenanceResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Mode != "maintenance" || resp.Until == nil || *resp.Until != "2099-01-02T03:04:05Z" {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

func TestAdminMaintenanceSetClearsOnOk(t *testing.T) {
	store := &fakeSystemStateStore{}
	h := NewAdminMaintenanceHandler(store, newTestCfg())

	body := `{"mode":"ok"}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/maintenance", strings.NewReader(body))
	h.Set(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if store.lastMode != "ok" {
		t.Fatalf("mode: got %q want ok", store.lastMode)
	}
}

func TestAdminMaintenanceSetRejectsInvalidMode(t *testing.T) {
	store := &fakeSystemStateStore{}
	h := NewAdminMaintenanceHandler(store, newTestCfg())

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/maintenance", strings.NewReader(`{"mode":"broken"}`))
	h.Set(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400", rec.Code)
	}
	if store.calls != 0 {
		t.Fatalf("expected store NOT to be called, got %d", store.calls)
	}
}

func TestAdminMaintenanceSetRejectsBadUntil(t *testing.T) {
	store := &fakeSystemStateStore{}
	h := NewAdminMaintenanceHandler(store, newTestCfg())

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/maintenance", strings.NewReader(`{"mode":"maintenance","until":"not-a-date"}`))
	h.Set(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400", rec.Code)
	}
	if store.calls != 0 {
		t.Fatalf("expected store NOT to be called, got %d", store.calls)
	}
}

func TestAdminMaintenanceSetRejectsUnknownFields(t *testing.T) {
	store := &fakeSystemStateStore{}
	h := NewAdminMaintenanceHandler(store, newTestCfg())

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/maintenance", strings.NewReader(`{"mode":"ok","extra":"x"}`))
	h.Set(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestAdminMaintenanceSetEnvOverrideSurfaced(t *testing.T) {
	cfg := &config.Config{
		Auth:   config.AuthConfig{ForwardAuthHeader: "X-User"},
		System: config.SystemConfig{Mode: "maintenance"},
	}
	store := &fakeSystemStateStore{}
	h := NewAdminMaintenanceHandler(store, cfg)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/maintenance", strings.NewReader(`{"mode":"ok"}`))
	h.Set(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}
	var resp adminMaintenanceResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Source != "env" || resp.EnvOverrideMode != "maintenance" {
		t.Fatalf("env override not surfaced: %+v", resp)
	}
}

func TestBuildMaintenanceProviderEnvWins(t *testing.T) {
	until := "2099-06-01T12:00:00Z"
	cfg := &config.Config{
		System: config.SystemConfig{
			Mode:               "degraded",
			MaintenanceMessage: "upstream flapping",
			MaintenanceUntil:   until,
		},
	}
	store := &fakeSystemStateStore{
		state: systemdb.SystemState{Mode: systemdb.SystemModeOK},
	}
	provider := BuildMaintenanceProvider(store, cfg)
	view := provider(context.Background())

	if view.Source != "env" || view.Mode != "degraded" || view.Message != "upstream flapping" {
		t.Fatalf("env not honoured: %+v", view)
	}
	if view.Until == nil || view.Until.Format(time.RFC3339) != until {
		t.Fatalf("env until not parsed: %v", view.Until)
	}
}

func TestBuildMaintenanceProviderEnvOkClearsBanner(t *testing.T) {
	cfg := &config.Config{System: config.SystemConfig{Mode: "ok"}}
	store := &fakeSystemStateStore{
		state: systemdb.SystemState{
			Mode:               systemdb.SystemModeMaintenance,
			MaintenanceMessage: "DB row says maintenance",
		},
	}
	provider := BuildMaintenanceProvider(store, cfg)
	view := provider(context.Background())

	if view.Mode != "ok" || view.Source != "env" || view.Message != "" {
		t.Fatalf("env=ok did not force-clear: %+v", view)
	}
}

func TestBuildMaintenanceProviderDBFallback(t *testing.T) {
	cfg := &config.Config{System: config.SystemConfig{Mode: ""}}
	until := time.Date(2099, 1, 1, 0, 0, 0, 0, time.UTC)
	store := &fakeSystemStateStore{
		state: systemdb.SystemState{
			Mode:               systemdb.SystemModeMaintenance,
			MaintenanceMessage: "scheduled outage",
			MaintenanceUntil:   &until,
			UpdatedAt:          time.Date(2024, 12, 31, 23, 0, 0, 0, time.UTC),
		},
	}
	provider := BuildMaintenanceProvider(store, cfg)
	view := provider(context.Background())

	if view.Source != "db" || view.Mode != "maintenance" || view.Message != "scheduled outage" {
		t.Fatalf("db state not returned: %+v", view)
	}
	if view.Until == nil || !view.Until.Equal(until) {
		t.Fatalf("until not propagated: %v", view.Until)
	}
}

func TestBuildMaintenanceProviderUnknownEnvFallsThrough(t *testing.T) {
	cfg := &config.Config{System: config.SystemConfig{Mode: "weird"}}
	store := &fakeSystemStateStore{
		state: systemdb.SystemState{Mode: systemdb.SystemModeOK},
	}
	provider := BuildMaintenanceProvider(store, cfg)
	view := provider(context.Background())

	if view.Source != "db" {
		t.Fatalf("unknown env should fall through to db, got %+v", view)
	}
}

func TestBuildMaintenanceProviderNilStoreReturnsOk(t *testing.T) {
	cfg := &config.Config{}
	provider := BuildMaintenanceProvider(nil, cfg)
	view := provider(context.Background())
	if view.Mode != systemdb.SystemModeOK || view.Source != "default" {
		t.Fatalf("nil store fallback wrong: %+v", view)
	}
}
