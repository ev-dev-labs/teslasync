package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
)

// ─── Fakes ──────────────────────────────────────────────────────

type fakeVehicleSettingsStore struct {
	mu        sync.Mutex
	upserts   []fakeVehicleSettingUpsert
	deletes   []fakeVehicleSettingDelete
	upsertErr error
	deleteErr error
}

type fakeVehicleSettingUpsert struct {
	VehicleID int64
	Key       string
	Value     any
}

type fakeVehicleSettingDelete struct {
	VehicleID int64
	Key       string
}

func (f *fakeVehicleSettingsStore) Upsert(_ context.Context, vehicleID int64, key string, value any) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.upsertErr != nil {
		return f.upsertErr
	}
	f.upserts = append(f.upserts, fakeVehicleSettingUpsert{VehicleID: vehicleID, Key: key, Value: value})
	return nil
}

func (f *fakeVehicleSettingsStore) Delete(_ context.Context, vehicleID int64, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.deleteErr != nil {
		return f.deleteErr
	}
	f.deletes = append(f.deletes, fakeVehicleSettingDelete{VehicleID: vehicleID, Key: key})
	return nil
}

type fakeVehicleSettingsResolver struct {
	settings []settingsdb.EffectiveSetting
	err      error
	calls    int
}

func (f *fakeVehicleSettingsResolver) Resolve(_ context.Context, _ int64) ([]settingsdb.EffectiveSetting, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return f.settings, nil
}

type fakeVehicleExistenceChecker struct {
	exists bool
	err    error
	calls  int
}

func (f *fakeVehicleExistenceChecker) Exists(_ context.Context, _ int64) (bool, error) {
	f.calls++
	if f.err != nil {
		return false, f.err
	}
	return f.exists, nil
}

// newVehicleSettingsTestServer wires the handler to a chi router so
// the path-param `{vehicleID}` and `{key}` come through as they do
// in production.
func newVehicleSettingsTestServer(t *testing.T, h *VehicleSettingsHandler) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Get("/vehicles/{vehicleID}/settings", h.List)
	r.Put("/vehicles/{vehicleID}/settings/{key}", h.Put)
	r.Delete("/vehicles/{vehicleID}/settings/{key}", h.Delete)
	return httptest.NewServer(r)
}

func newVehicleSettingsTestHandler(
	store *fakeVehicleSettingsStore,
	resolver *fakeVehicleSettingsResolver,
	vehicles *fakeVehicleExistenceChecker,
) *VehicleSettingsHandler {
	if store == nil {
		store = &fakeVehicleSettingsStore{}
	}
	if resolver == nil {
		resolver = &fakeVehicleSettingsResolver{}
	}
	if vehicles == nil {
		vehicles = &fakeVehicleExistenceChecker{exists: true}
	}
	return NewVehicleSettingsHandler(store, resolver, vehicles)
}

// ─── List ───────────────────────────────────────────────────────

func TestVehicleSettingsHandler_List_Success(t *testing.T) {
	resolver := &fakeVehicleSettingsResolver{
		settings: []settingsdb.EffectiveSetting{
			{Key: "nickname", Value: "Snowball", Source: settingsdb.EffectiveSourceOverride},
		},
	}
	h := newVehicleSettingsTestHandler(nil, resolver, nil)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/vehicles/42/settings")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var got vehicleSettingsListResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Settings) != 1 || got.Settings[0].Key != "nickname" {
		t.Fatalf("unexpected payload: %+v", got)
	}
	if resolver.calls != 1 {
		t.Fatalf("expected 1 resolve call, got %d", resolver.calls)
	}
}

func TestVehicleSettingsHandler_List_BadVehicleID(t *testing.T) {
	h := newVehicleSettingsTestHandler(nil, nil, nil)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/vehicles/not-a-number/settings")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestVehicleSettingsHandler_List_VehicleNotFound(t *testing.T) {
	vehicles := &fakeVehicleExistenceChecker{exists: false}
	h := newVehicleSettingsTestHandler(nil, nil, vehicles)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/vehicles/99/settings")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
	body := decodeErrorBody(t, resp)
	if body.Code != VehicleSettingsCodeNotFound {
		t.Fatalf("expected code %q, got %q", VehicleSettingsCodeNotFound, body.Code)
	}
}

func TestVehicleSettingsHandler_List_ResolverError(t *testing.T) {
	resolver := &fakeVehicleSettingsResolver{err: errors.New("db boom")}
	h := newVehicleSettingsTestHandler(nil, resolver, nil)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/vehicles/42/settings")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.StatusCode)
	}
}

// ─── Put ────────────────────────────────────────────────────────

func TestVehicleSettingsHandler_Put_TextValue(t *testing.T) {
	store := &fakeVehicleSettingsStore{}
	h := newVehicleSettingsTestHandler(store, nil, nil)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	body := strings.NewReader(`{"value":"Snowball"}`)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/vehicles/42/settings/nickname", body)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", resp.StatusCode)
	}
	if len(store.upserts) != 1 {
		t.Fatalf("expected 1 upsert, got %d", len(store.upserts))
	}
	got := store.upserts[0]
	if got.VehicleID != 42 || got.Key != "nickname" || got.Value.(string) != "Snowball" {
		t.Fatalf("unexpected upsert: %+v", got)
	}
}

func TestVehicleSettingsHandler_Put_TimestampValue(t *testing.T) {
	store := &fakeVehicleSettingsStore{}
	h := newVehicleSettingsTestHandler(store, nil, nil)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	body := strings.NewReader(`{"value":"2025-12-31T23:59:59Z"}`)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/vehicles/42/settings/mute_until", body)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", resp.StatusCode)
	}
	if len(store.upserts) != 1 {
		t.Fatalf("expected 1 upsert, got %d", len(store.upserts))
	}
	tv, ok := store.upserts[0].Value.(time.Time)
	if !ok {
		t.Fatalf("expected time.Time value, got %T", store.upserts[0].Value)
	}
	if tv.Year() != 2025 || tv.Month() != 12 {
		t.Fatalf("unexpected time: %v", tv)
	}
}

func TestVehicleSettingsHandler_Put_BadKey(t *testing.T) {
	store := &fakeVehicleSettingsStore{}
	h := newVehicleSettingsTestHandler(store, nil, nil)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	body := strings.NewReader(`{"value":"x"}`)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/vehicles/42/settings/some_random_key", body)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
	got := decodeErrorBody(t, resp)
	if got.Code != VehicleSettingsCodeInvalidKey {
		t.Fatalf("expected code %q, got %q", VehicleSettingsCodeInvalidKey, got.Code)
	}
	if len(store.upserts) != 0 {
		t.Fatalf("store should not have been called, got %d upserts", len(store.upserts))
	}
}

func TestVehicleSettingsHandler_Put_BadValueType(t *testing.T) {
	store := &fakeVehicleSettingsStore{}
	h := newVehicleSettingsTestHandler(store, nil, nil)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	// nickname is text — sending a bare number must 400.
	body := strings.NewReader(`{"value":123}`)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/vehicles/42/settings/nickname", body)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
	got := decodeErrorBody(t, resp)
	if got.Code != VehicleSettingsCodeInvalidValue {
		t.Fatalf("expected code %q, got %q", VehicleSettingsCodeInvalidValue, got.Code)
	}
}

func TestVehicleSettingsHandler_Put_NullValue(t *testing.T) {
	store := &fakeVehicleSettingsStore{}
	h := newVehicleSettingsTestHandler(store, nil, nil)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	body := strings.NewReader(`{"value":null}`)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/vehicles/42/settings/nickname", body)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
	got := decodeErrorBody(t, resp)
	if got.Code != VehicleSettingsCodeInvalidValue {
		t.Fatalf("expected code %q, got %q", VehicleSettingsCodeInvalidValue, got.Code)
	}
}

func TestVehicleSettingsHandler_Put_RejectsUnknownFields(t *testing.T) {
	store := &fakeVehicleSettingsStore{}
	h := newVehicleSettingsTestHandler(store, nil, nil)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	body := strings.NewReader(`{"value":"x","extra":"junk"}`)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/vehicles/42/settings/nickname", body)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestVehicleSettingsHandler_Put_EnforcesBodyLimit(t *testing.T) {
	store := &fakeVehicleSettingsStore{}
	h := newVehicleSettingsTestHandler(store, nil, nil)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	huge := strings.Repeat("x", int(MaxVehicleSettingsBodyBytes)+1024)
	body := strings.NewReader(fmt.Sprintf(`{"value":"%s"}`, huge))
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/vehicles/42/settings/nickname", body)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for oversized body, got %d", resp.StatusCode)
	}
}

func TestVehicleSettingsHandler_Put_MapsRepoInvalidValue(t *testing.T) {
	store := &fakeVehicleSettingsStore{upsertErr: settingsdb.ErrVehicleSettingInvalidValue}
	h := newVehicleSettingsTestHandler(store, nil, nil)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	body := strings.NewReader(`{"value":""}`)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/vehicles/42/settings/nickname", body)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
	got := decodeErrorBody(t, resp)
	if got.Code != VehicleSettingsCodeInvalidValue {
		t.Fatalf("expected code %q, got %q", VehicleSettingsCodeInvalidValue, got.Code)
	}
}

func TestVehicleSettingsHandler_Put_VehicleNotFound(t *testing.T) {
	store := &fakeVehicleSettingsStore{}
	vehicles := &fakeVehicleExistenceChecker{exists: false}
	h := newVehicleSettingsTestHandler(store, nil, vehicles)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	body := strings.NewReader(`{"value":"Snowball"}`)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/vehicles/99/settings/nickname", body)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
	if len(store.upserts) != 0 {
		t.Fatalf("store should not have been called")
	}
}

// ─── Delete ─────────────────────────────────────────────────────

func TestVehicleSettingsHandler_Delete_Success(t *testing.T) {
	store := &fakeVehicleSettingsStore{}
	h := newVehicleSettingsTestHandler(store, nil, nil)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/vehicles/42/settings/nickname", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", resp.StatusCode)
	}
	if len(store.deletes) != 1 || store.deletes[0].Key != "nickname" {
		t.Fatalf("unexpected deletes: %+v", store.deletes)
	}
}

func TestVehicleSettingsHandler_Delete_IdempotentNotFound(t *testing.T) {
	store := &fakeVehicleSettingsStore{deleteErr: settingsdb.ErrVehicleSettingNotFound}
	h := newVehicleSettingsTestHandler(store, nil, nil)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/vehicles/42/settings/nickname", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204 for missing override, got %d", resp.StatusCode)
	}
}

func TestVehicleSettingsHandler_Delete_BadKey(t *testing.T) {
	store := &fakeVehicleSettingsStore{}
	h := newVehicleSettingsTestHandler(store, nil, nil)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/vehicles/42/settings/no_such_key", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
	if len(store.deletes) != 0 {
		t.Fatalf("store should not have been called")
	}
}

func TestVehicleSettingsHandler_Delete_VehicleNotFound(t *testing.T) {
	store := &fakeVehicleSettingsStore{}
	vehicles := &fakeVehicleExistenceChecker{exists: false}
	h := newVehicleSettingsTestHandler(store, nil, vehicles)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/vehicles/99/settings/nickname", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
}

func TestVehicleSettingsHandler_Delete_StoreError(t *testing.T) {
	store := &fakeVehicleSettingsStore{deleteErr: errors.New("db down")}
	h := newVehicleSettingsTestHandler(store, nil, nil)
	srv := newVehicleSettingsTestServer(t, h)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/vehicles/42/settings/nickname", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.StatusCode)
	}
}

// ─── decodeValueForKey unit tests ───────────────────────────────

func TestDecodeValueForKey_TableDriven(t *testing.T) {
	cases := []struct {
		name    string
		key     string
		raw     string
		wantErr bool
	}{
		{"text accepts string", "nickname", `"x"`, false},
		{"text rejects number", "nickname", `42`, true},
		{"text rejects bool", "nickname", `true`, true},
		{"timestamp accepts rfc3339", "mute_until", `"2025-12-31T23:59:59Z"`, false},
		{"timestamp rejects bad string", "mute_until", `"not-a-date"`, true},
		{"timestamp rejects number", "mute_until", `1234567890`, true},
		{"unknown key fails", "no_such_key", `"x"`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := decodeValueForKey(tc.key, []byte(tc.raw))
			if tc.wantErr && err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

// ─── Decode helper ──────────────────────────────────────────────

type vehicleSettingsErrorBody struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

func decodeErrorBody(t *testing.T, resp *http.Response) vehicleSettingsErrorBody {
	t.Helper()
	var body vehicleSettingsErrorBody
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	return body
}
