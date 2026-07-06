package vehicleaccess

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	tesladb "github.com/ev-dev-labs/teslasync/internal/database/tesla"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/tesla"

	"github.com/go-chi/chi/v5"
)

const testVIN = "5YJ3TESTVIN000001"

// --- test doubles ------------------------------------------------------------

// fakeClient implements driverClient without any network or OAuth. Each method
// records its call count + last arguments and falls back to a benign 2xx empty
// response so callers only override the behaviour they exercise.
type fakeClient struct {
	hasToken bool

	getDriversFn       func(ctx context.Context, vin string) ([]byte, int, error)
	removeDriverFn     func(ctx context.Context, vin string, shareUserID int64) ([]byte, int, error)
	getInvitationsFn   func(ctx context.Context, vin string) ([]byte, int, error)
	createInvitationFn func(ctx context.Context, vin string) ([]byte, int, error)
	revokeInvitationFn func(ctx context.Context, vin, invitationID string) ([]byte, int, error)

	getDriversCalls       int
	removeDriverCalls     int
	getInvitationsCalls   int
	createInvitationCalls int
	revokeInvitationCalls int

	lastVIN                string
	lastShareUserID        int64
	lastRevokeInvitationID string
}

func (f *fakeClient) HasValidToken() bool { return f.hasToken }

func (f *fakeClient) GetVehicleDrivers(ctx context.Context, vin string) ([]byte, int, error) {
	f.getDriversCalls++
	f.lastVIN = vin
	if f.getDriversFn != nil {
		return f.getDriversFn(ctx, vin)
	}
	return []byte(`{"response":[]}`), http.StatusOK, nil
}

func (f *fakeClient) RemoveVehicleDriver(ctx context.Context, vin string, shareUserID int64) ([]byte, int, error) {
	f.removeDriverCalls++
	f.lastVIN = vin
	f.lastShareUserID = shareUserID
	if f.removeDriverFn != nil {
		return f.removeDriverFn(ctx, vin, shareUserID)
	}
	return nil, http.StatusOK, nil
}

func (f *fakeClient) GetVehicleInvitations(ctx context.Context, vin string) ([]byte, int, error) {
	f.getInvitationsCalls++
	f.lastVIN = vin
	if f.getInvitationsFn != nil {
		return f.getInvitationsFn(ctx, vin)
	}
	return []byte(`{"response":[]}`), http.StatusOK, nil
}

func (f *fakeClient) CreateVehicleInvitation(ctx context.Context, vin string) ([]byte, int, error) {
	f.createInvitationCalls++
	f.lastVIN = vin
	if f.createInvitationFn != nil {
		return f.createInvitationFn(ctx, vin)
	}
	return []byte(`{"response":{"id":"stub","status":"pending"}}`), http.StatusOK, nil
}

func (f *fakeClient) RevokeVehicleInvitation(ctx context.Context, vin, invitationID string) ([]byte, int, error) {
	f.revokeInvitationCalls++
	f.lastVIN = vin
	f.lastRevokeInvitationID = invitationID
	if f.revokeInvitationFn != nil {
		return f.revokeInvitationFn(ctx, vin, invitationID)
	}
	return nil, http.StatusOK, nil
}

// fakeStore implements driverStore. Calls are always counted and arguments
// captured; the *Fn hooks override the return value where a test needs it.
type fakeStore struct {
	getDriversFn         func(ctx context.Context, vehicleID int64) ([]*teslamodel.TeslaVehicleDriver, error)
	replaceDriversFn     func(ctx context.Context, vehicleID int64, drivers []*teslamodel.TeslaVehicleDriver) error
	getInvitationsFn     func(ctx context.Context, vehicleID int64) ([]*teslamodel.TeslaVehicleInvitation, error)
	replaceInvitationsFn func(ctx context.Context, vehicleID int64, invitations []*teslamodel.TeslaVehicleInvitation) error
	insertInvitationFn   func(ctx context.Context, inv *teslamodel.TeslaVehicleInvitation) error

	getDriversCalls         int
	replaceDriversCalls     int
	getInvitationsCalls     int
	replaceInvitationsCalls int
	insertInvitationCalls   int

	lastReplacedDrivers     []*teslamodel.TeslaVehicleDriver
	lastReplacedInvitations []*teslamodel.TeslaVehicleInvitation
	lastInsertedInvitation  *teslamodel.TeslaVehicleInvitation
}

func (s *fakeStore) GetDriversByVehicleID(ctx context.Context, vehicleID int64) ([]*teslamodel.TeslaVehicleDriver, error) {
	s.getDriversCalls++
	if s.getDriversFn != nil {
		return s.getDriversFn(ctx, vehicleID)
	}
	return nil, nil
}

func (s *fakeStore) ReplaceDriversForVehicle(ctx context.Context, vehicleID int64, drivers []*teslamodel.TeslaVehicleDriver) error {
	s.replaceDriversCalls++
	s.lastReplacedDrivers = drivers
	if s.replaceDriversFn != nil {
		return s.replaceDriversFn(ctx, vehicleID, drivers)
	}
	return nil
}

func (s *fakeStore) GetInvitationsByVehicleID(ctx context.Context, vehicleID int64) ([]*teslamodel.TeslaVehicleInvitation, error) {
	s.getInvitationsCalls++
	if s.getInvitationsFn != nil {
		return s.getInvitationsFn(ctx, vehicleID)
	}
	return nil, nil
}

func (s *fakeStore) ReplaceInvitationsForVehicle(ctx context.Context, vehicleID int64, invitations []*teslamodel.TeslaVehicleInvitation) error {
	s.replaceInvitationsCalls++
	s.lastReplacedInvitations = invitations
	if s.replaceInvitationsFn != nil {
		return s.replaceInvitationsFn(ctx, vehicleID, invitations)
	}
	return nil
}

func (s *fakeStore) InsertInvitation(ctx context.Context, inv *teslamodel.TeslaVehicleInvitation) error {
	s.insertInvitationCalls++
	s.lastInsertedInvitation = inv
	if s.insertInvitationFn != nil {
		return s.insertInvitationFn(ctx, inv)
	}
	return nil
}

// fakeVehicleStore implements vehicleStore. By default it resolves any id to a
// vehicle carrying testVIN so most handler tests get past resolveVehicle.
type fakeVehicleStore struct {
	getByIDFn    func(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
	getByIDCalls int
	lastID       int64
}

func (f *fakeVehicleStore) GetByID(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error) {
	f.getByIDCalls++
	f.lastID = id
	if f.getByIDFn != nil {
		return f.getByIDFn(ctx, id)
	}
	return &vehiclemodel.Vehicle{ID: id, VIN: testVIN}, nil
}

// The doubles must satisfy the same ports the production wiring uses.
var (
	_ driverClient = (*fakeClient)(nil)
	_ driverStore  = (*fakeStore)(nil)
	_ vehicleStore = (*fakeVehicleStore)(nil)
)

// newTestHandler wires arbitrary ports into a Handler (white-box).
func newTestHandler(c driverClient, ds driverStore, vs vehicleStore) *Handler {
	return &Handler{teslaClient: c, repo: ds, vehicleRepo: vs}
}

// newRequest builds an *http.Request with a chi RouteContext carrying the given
// URL params, mirroring how the production router injects {vehicleID} /
// {invitationID}.
func newRequest(method, target string, body io.Reader, params map[string]string) *http.Request {
	req := httptest.NewRequest(method, target, body)
	rctx := chi.NewRouteContext()
	for k, v := range params {
		rctx.URLParams.Add(k, v)
	}
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func decodeErr(t *testing.T, body []byte) map[string]string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("decode error body: %v; body=%s", err, body)
	}
	return m
}

// --- NewHandler --------------------------------------------------------------

func TestNewHandler_Wiring(t *testing.T) {
	tc := tesla.NewClient(config.TeslaConfig{BaseURL: "http://localhost", Timeout: time.Second})
	h := NewHandler(tc, &database.DB{})
	if h == nil {
		t.Fatal("NewHandler returned nil")
	}
	gotTC, ok := h.teslaClient.(*tesla.Client)
	if !ok || gotTC != tc {
		t.Errorf("teslaClient = %#v, want the passed *tesla.Client", h.teslaClient)
	}
	if _, ok := h.repo.(*tesladb.TeslaVehicleDriverRepo); !ok {
		t.Errorf("repo = %T, want *tesladb.TeslaVehicleDriverRepo", h.repo)
	}
	if _, ok := h.vehicleRepo.(*vehicledb.VehicleRepo); !ok {
		t.Errorf("vehicleRepo = %T, want *vehicledb.VehicleRepo", h.vehicleRepo)
	}
}

// --- parse helpers -----------------------------------------------------------

func TestParseDriversResponse(t *testing.T) {
	const vehicleID = int64(7)

	tests := []struct {
		name    string
		body    string
		wantErr bool
		wantLen int
		check   func(t *testing.T, got []*teslamodel.TeslaVehicleDriver)
	}{
		{name: "invalid envelope json", body: `not json`, wantErr: true},
		{name: "response wrong type", body: `{"response":"nope"}`, wantErr: true},
		{name: "missing response field", body: `{}`, wantLen: 0},
		{name: "empty response array", body: `{"response":[]}`, wantLen: 0},
		{
			name:    "full driver populated",
			body:    `{"response":[{"share_user_id":123,"driver_email":"a@b.com","driver_first_name":"Alice","public_key":"pk","role":"driver"}]}`,
			wantLen: 1,
			check: func(t *testing.T, got []*teslamodel.TeslaVehicleDriver) {
				d := got[0]
				if d.VehicleID != vehicleID || d.VIN != testVIN {
					t.Errorf("vehicleID/VIN not propagated: %+v", d)
				}
				if d.ShareUserID == nil || *d.ShareUserID != 123 {
					t.Errorf("ShareUserID = %v, want 123", d.ShareUserID)
				}
				if d.DriverEmail == nil || *d.DriverEmail != "a@b.com" {
					t.Errorf("DriverEmail = %v, want a@b.com", d.DriverEmail)
				}
				if d.DriverName == nil || *d.DriverName != "Alice" {
					t.Errorf("DriverName = %v, want Alice", d.DriverName)
				}
				if d.Role == nil || *d.Role != "driver" {
					t.Errorf("Role = %v, want driver", d.Role)
				}
			},
		},
		{
			name:    "null optionals stay nil",
			body:    `{"response":[{"public_key":"pk"}]}`,
			wantLen: 1,
			check: func(t *testing.T, got []*teslamodel.TeslaVehicleDriver) {
				d := got[0]
				if d.ShareUserID != nil || d.DriverEmail != nil || d.DriverName != nil || d.Role != nil {
					t.Errorf("expected nil optionals, got %+v", d)
				}
			},
		},
		{
			name:    "skips unparseable entry keeps valid",
			body:    `{"response":[{"share_user_id":"not-an-int"},{"share_user_id":5,"public_key":"pk"}]}`,
			wantLen: 1,
			check: func(t *testing.T, got []*teslamodel.TeslaVehicleDriver) {
				if got[0].ShareUserID == nil || *got[0].ShareUserID != 5 {
					t.Errorf("expected surviving driver 5, got %+v", got[0])
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseDriversResponse([]byte(tt.body), vehicleID, testVIN)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (got=%v)", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != tt.wantLen {
				t.Fatalf("len = %d, want %d", len(got), tt.wantLen)
			}
			if tt.check != nil {
				tt.check(t, got)
			}
		})
	}
}

func TestParseInvitationsResponse(t *testing.T) {
	const vehicleID = int64(7)

	tests := []struct {
		name    string
		body    string
		wantErr bool
		wantLen int
		check   func(t *testing.T, got []*teslamodel.TeslaVehicleInvitation)
	}{
		{name: "invalid envelope json", body: `nope`, wantErr: true},
		{name: "response wrong type", body: `{"response":{}}`, wantErr: true},
		{name: "empty response array", body: `{"response":[]}`, wantLen: 0},
		{
			name:    "full invitation with valid expires_at",
			body:    `{"response":[{"id":"inv1","invite_url":"https://x","status":"active","expires_at":"2026-01-02T15:04:05Z","owner_email":"o@b.com"}]}`,
			wantLen: 1,
			check: func(t *testing.T, got []*teslamodel.TeslaVehicleInvitation) {
				inv := got[0]
				if inv.VehicleID != vehicleID || inv.VIN != testVIN {
					t.Errorf("vehicleID/VIN not propagated: %+v", inv)
				}
				if inv.InvitationID != "inv1" {
					t.Errorf("InvitationID = %q, want inv1", inv.InvitationID)
				}
				if inv.InviteURL == nil || *inv.InviteURL != "https://x" {
					t.Errorf("InviteURL = %v, want https://x", inv.InviteURL)
				}
				if inv.Status != "active" {
					t.Errorf("Status = %q, want active", inv.Status)
				}
				if inv.CreatedBy == nil || *inv.CreatedBy != "o@b.com" {
					t.Errorf("CreatedBy = %v, want o@b.com", inv.CreatedBy)
				}
				if inv.ExpiresAt == nil {
					t.Fatal("ExpiresAt is nil, want parsed time")
				}
				want := time.Date(2026, 1, 2, 15, 4, 5, 0, time.UTC)
				if !inv.ExpiresAt.Equal(want) {
					t.Errorf("ExpiresAt = %v, want %v", *inv.ExpiresAt, want)
				}
			},
		},
		{
			name:    "invalid expires_at leaves nil",
			body:    `{"response":[{"id":"inv2","status":"pending","expires_at":"garbage"}]}`,
			wantLen: 1,
			check: func(t *testing.T, got []*teslamodel.TeslaVehicleInvitation) {
				if got[0].ExpiresAt != nil {
					t.Errorf("ExpiresAt = %v, want nil", got[0].ExpiresAt)
				}
			},
		},
		{
			name:    "empty status defaults to pending",
			body:    `{"response":[{"id":"inv3","status":""}]}`,
			wantLen: 1,
			check: func(t *testing.T, got []*teslamodel.TeslaVehicleInvitation) {
				if got[0].Status != "pending" {
					t.Errorf("Status = %q, want pending", got[0].Status)
				}
			},
		},
		{
			name:    "skips unparseable entry keeps valid",
			body:    `{"response":[{"id":123},{"id":"ok","status":"pending"}]}`,
			wantLen: 1,
			check: func(t *testing.T, got []*teslamodel.TeslaVehicleInvitation) {
				if got[0].InvitationID != "ok" {
					t.Errorf("surviving invitation id = %q, want ok", got[0].InvitationID)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseInvitationsResponse([]byte(tt.body), vehicleID, testVIN)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (got=%v)", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != tt.wantLen {
				t.Fatalf("len = %d, want %d", len(got), tt.wantLen)
			}
			if tt.check != nil {
				tt.check(t, got)
			}
		})
	}
}

func TestParseCreateInvitationResponse(t *testing.T) {
	const vehicleID = int64(7)

	tests := []struct {
		name    string
		body    string
		wantErr bool
		check   func(t *testing.T, got *teslamodel.TeslaVehicleInvitation)
	}{
		{name: "invalid outer envelope", body: `nope`, wantErr: true},
		{name: "missing response field", body: `{}`, wantErr: true},
		{name: "response not object", body: `{"response":123}`, wantErr: true},
		{
			name: "full invitation populated",
			body: `{"response":{"id":"created1","invite_url":"https://y","status":"active","expires_at":"2026-03-04T05:06:07Z","owner_email":"me@x.com"}}`,
			check: func(t *testing.T, got *teslamodel.TeslaVehicleInvitation) {
				if got.VehicleID != vehicleID || got.VIN != testVIN {
					t.Errorf("vehicleID/VIN not propagated: %+v", got)
				}
				if got.InvitationID != "created1" {
					t.Errorf("InvitationID = %q, want created1", got.InvitationID)
				}
				if got.InviteURL == nil || *got.InviteURL != "https://y" {
					t.Errorf("InviteURL = %v, want https://y", got.InviteURL)
				}
				if got.Status != "active" {
					t.Errorf("Status = %q, want active", got.Status)
				}
				if got.ExpiresAt == nil {
					t.Fatal("ExpiresAt nil, want parsed")
				}
				want := time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC)
				if !got.ExpiresAt.Equal(want) {
					t.Errorf("ExpiresAt = %v, want %v", *got.ExpiresAt, want)
				}
			},
		},
		{
			name: "empty status defaults to pending",
			body: `{"response":{"id":"c2","status":""}}`,
			check: func(t *testing.T, got *teslamodel.TeslaVehicleInvitation) {
				if got.Status != "pending" {
					t.Errorf("Status = %q, want pending", got.Status)
				}
			},
		},
		{
			name: "invalid expires_at leaves nil",
			body: `{"response":{"id":"c3","status":"pending","expires_at":"bad"}}`,
			check: func(t *testing.T, got *teslamodel.TeslaVehicleInvitation) {
				if got.ExpiresAt != nil {
					t.Errorf("ExpiresAt = %v, want nil", got.ExpiresAt)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseCreateInvitationResponse([]byte(tt.body), vehicleID, testVIN)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (got=%v)", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got == nil {
				t.Fatal("got nil invitation without error")
			}
			if tt.check != nil {
				tt.check(t, got)
			}
		})
	}
}

func TestTruncateBody(t *testing.T) {
	tests := []struct {
		name    string
		in      []byte
		wantLen int
	}{
		{name: "nil", in: nil, wantLen: 0},
		{name: "empty", in: []byte(""), wantLen: 0},
		{name: "short", in: []byte("hello"), wantLen: 5},
		{name: "exactly 500 not truncated", in: bytes.Repeat([]byte("a"), 500), wantLen: 500},
		{name: "over 500 truncated", in: bytes.Repeat([]byte("b"), 750), wantLen: 500},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := truncateBody(tt.in)
			if len(got) != tt.wantLen {
				t.Fatalf("len = %d, want %d", len(got), tt.wantLen)
			}
		})
	}
}

// --- ListDrivers / ListInvitations ------------------------------------------

func TestListDrivers(t *testing.T) {
	tests := []struct {
		name        string
		param       string
		store       *fakeStore
		wantStatus  int
		wantErrCode string
		wantLen     int
	}{
		{
			name:        "invalid vehicle id",
			param:       "abc",
			store:       &fakeStore{},
			wantStatus:  http.StatusBadRequest,
			wantErrCode: "BAD_REQUEST",
		},
		{
			name:  "repo error",
			param: "7",
			store: &fakeStore{getDriversFn: func(context.Context, int64) ([]*teslamodel.TeslaVehicleDriver, error) {
				return nil, errors.New("pg pool exhausted")
			}},
			wantStatus:  http.StatusInternalServerError,
			wantErrCode: "INTERNAL_ERROR",
		},
		{
			name:  "nil drivers yields empty array",
			param: "7",
			store: &fakeStore{getDriversFn: func(context.Context, int64) ([]*teslamodel.TeslaVehicleDriver, error) {
				return nil, nil
			}},
			wantStatus: http.StatusOK,
			wantLen:    0,
		},
		{
			name:  "drivers returned",
			param: "7",
			store: &fakeStore{getDriversFn: func(context.Context, int64) ([]*teslamodel.TeslaVehicleDriver, error) {
				return []*teslamodel.TeslaVehicleDriver{{ID: 1}, {ID: 2}}, nil
			}},
			wantStatus: http.StatusOK,
			wantLen:    2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHandler(&fakeClient{}, tt.store, &fakeVehicleStore{})
			rec := httptest.NewRecorder()
			req := newRequest(http.MethodGet, "/drivers", nil, map[string]string{"vehicleID": tt.param})
			h.ListDrivers(rec, req)

			assertListResponse(t, rec, tt.wantStatus, tt.wantErrCode, tt.wantLen)
		})
	}
}

func TestListInvitations(t *testing.T) {
	tests := []struct {
		name        string
		param       string
		store       *fakeStore
		wantStatus  int
		wantErrCode string
		wantLen     int
	}{
		{
			name:        "invalid vehicle id",
			param:       "abc",
			store:       &fakeStore{},
			wantStatus:  http.StatusBadRequest,
			wantErrCode: "BAD_REQUEST",
		},
		{
			name:  "repo error",
			param: "7",
			store: &fakeStore{getInvitationsFn: func(context.Context, int64) ([]*teslamodel.TeslaVehicleInvitation, error) {
				return nil, errors.New("pg pool exhausted")
			}},
			wantStatus:  http.StatusInternalServerError,
			wantErrCode: "INTERNAL_ERROR",
		},
		{
			name:  "nil invitations yields empty array",
			param: "7",
			store: &fakeStore{getInvitationsFn: func(context.Context, int64) ([]*teslamodel.TeslaVehicleInvitation, error) {
				return nil, nil
			}},
			wantStatus: http.StatusOK,
			wantLen:    0,
		},
		{
			name:  "invitations returned",
			param: "7",
			store: &fakeStore{getInvitationsFn: func(context.Context, int64) ([]*teslamodel.TeslaVehicleInvitation, error) {
				return []*teslamodel.TeslaVehicleInvitation{{ID: 1}, {ID: 2}, {ID: 3}}, nil
			}},
			wantStatus: http.StatusOK,
			wantLen:    3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHandler(&fakeClient{}, tt.store, &fakeVehicleStore{})
			rec := httptest.NewRecorder()
			req := newRequest(http.MethodGet, "/invitations", nil, map[string]string{"vehicleID": tt.param})
			h.ListInvitations(rec, req)

			assertListResponse(t, rec, tt.wantStatus, tt.wantErrCode, tt.wantLen)
		})
	}
}

// assertListResponse checks the shared contract of the two list endpoints:
// exact status, JSON content-type, error code on failure, and a non-null JSON
// array of the expected length on success.
func assertListResponse(t *testing.T, rec *httptest.ResponseRecorder, wantStatus int, wantErrCode string, wantLen int) {
	t.Helper()
	if rec.Code != wantStatus {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, wantStatus, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}
	if wantErrCode != "" {
		m := decodeErr(t, rec.Body.Bytes())
		if m["code"] != wantErrCode {
			t.Errorf("code = %q, want %q", m["code"], wantErrCode)
		}
		if m["error"] == "" {
			t.Errorf("expected non-empty error message; got %v", m)
		}
		return
	}
	body := strings.TrimSpace(rec.Body.String())
	if !strings.HasPrefix(body, "[") {
		t.Fatalf("success body is not a JSON array (null-safety): %s", body)
	}
	var got []json.RawMessage
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, body)
	}
	if len(got) != wantLen {
		t.Fatalf("len = %d, want %d", len(got), wantLen)
	}
}

// --- RefreshDrivers ----------------------------------------------------------

func TestRefreshDrivers(t *testing.T) {
	tests := []struct {
		name              string
		hasToken          bool
		param             string
		vehicleFn         func(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
		teslaFn           func(ctx context.Context, vin string) ([]byte, int, error)
		replaceErr        error
		listAfterFn       func(ctx context.Context, id int64) ([]*teslamodel.TeslaVehicleDriver, error)
		wantStatus        int
		wantErrCode       string
		wantTeslaCalled   bool
		wantReplaceCalled bool
	}{
		{
			name:        "unauthenticated",
			hasToken:    false,
			param:       "7",
			wantStatus:  http.StatusUnauthorized,
			wantErrCode: "UNAUTHORIZED",
		},
		{
			name:        "invalid vehicle id",
			hasToken:    true,
			param:       "abc",
			wantStatus:  http.StatusBadRequest,
			wantErrCode: "BAD_REQUEST",
		},
		{
			name:        "vehicle not found",
			hasToken:    true,
			param:       "7",
			vehicleFn:   func(context.Context, int64) (*vehiclemodel.Vehicle, error) { return nil, nil },
			wantStatus:  http.StatusNotFound,
			wantErrCode: "NOT_FOUND",
		},
		{
			name:        "vehicle lookup error",
			hasToken:    true,
			param:       "7",
			vehicleFn:   func(context.Context, int64) (*vehiclemodel.Vehicle, error) { return nil, errors.New("pg down") },
			wantStatus:  http.StatusInternalServerError,
			wantErrCode: "INTERNAL_ERROR",
		},
		{
			name:            "tesla transport error",
			hasToken:        true,
			param:           "7",
			teslaFn:         func(context.Context, string) ([]byte, int, error) { return nil, 0, errors.New("dial refused") },
			wantStatus:      http.StatusBadGateway,
			wantErrCode:     "ERROR",
			wantTeslaCalled: true,
		},
		{
			name:     "tesla non-2xx",
			hasToken: true,
			param:    "7",
			teslaFn: func(context.Context, string) ([]byte, int, error) {
				return []byte(`{"error":"x"}`), http.StatusForbidden, nil
			},
			wantStatus:      http.StatusBadGateway,
			wantErrCode:     "ERROR",
			wantTeslaCalled: true,
		},
		{
			name:            "status below 200 boundary",
			hasToken:        true,
			param:           "7",
			teslaFn:         func(context.Context, string) ([]byte, int, error) { return []byte(`{}`), 199, nil },
			wantStatus:      http.StatusBadGateway,
			wantErrCode:     "ERROR",
			wantTeslaCalled: true,
		},
		{
			name:     "parse error",
			hasToken: true,
			param:    "7",
			teslaFn: func(context.Context, string) ([]byte, int, error) {
				return []byte(`this is not json`), http.StatusOK, nil
			},
			wantStatus:      http.StatusInternalServerError,
			wantErrCode:     "INTERNAL_ERROR",
			wantTeslaCalled: true,
		},
		{
			name:     "replace error",
			hasToken: true,
			param:    "7",
			teslaFn: func(context.Context, string) ([]byte, int, error) {
				return []byte(`{"response":[]}`), http.StatusOK, nil
			},
			replaceErr:        errors.New("tx failed"),
			wantStatus:        http.StatusInternalServerError,
			wantErrCode:       "INTERNAL_ERROR",
			wantTeslaCalled:   true,
			wantReplaceCalled: true,
		},
		{
			name:     "list after refresh error",
			hasToken: true,
			param:    "7",
			teslaFn: func(context.Context, string) ([]byte, int, error) {
				return []byte(`{"response":[]}`), http.StatusOK, nil
			},
			listAfterFn: func(context.Context, int64) ([]*teslamodel.TeslaVehicleDriver, error) {
				return nil, errors.New("select failed")
			},
			wantStatus:        http.StatusInternalServerError,
			wantErrCode:       "INTERNAL_ERROR",
			wantTeslaCalled:   true,
			wantReplaceCalled: true,
		},
		{
			name:              "status 299 upper boundary success",
			hasToken:          true,
			param:             "7",
			teslaFn:           func(context.Context, string) ([]byte, int, error) { return []byte(`{"response":[]}`), 299, nil },
			wantStatus:        http.StatusOK,
			wantTeslaCalled:   true,
			wantReplaceCalled: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &fakeClient{hasToken: tt.hasToken, getDriversFn: tt.teslaFn}
			store := &fakeStore{getDriversFn: tt.listAfterFn}
			if tt.replaceErr != nil {
				store.replaceDriversFn = func(context.Context, int64, []*teslamodel.TeslaVehicleDriver) error { return tt.replaceErr }
			}
			vs := &fakeVehicleStore{getByIDFn: tt.vehicleFn}
			h := newTestHandler(client, store, vs)

			rec := httptest.NewRecorder()
			req := newRequest(http.MethodPost, "/drivers/refresh", nil, map[string]string{"vehicleID": tt.param})
			h.RefreshDrivers(rec, req)

			assertRefreshResponse(t, rec, tt.wantStatus, tt.wantErrCode)
			if (client.getDriversCalls > 0) != tt.wantTeslaCalled {
				t.Errorf("GetVehicleDrivers called=%v (n=%d), want %v", client.getDriversCalls > 0, client.getDriversCalls, tt.wantTeslaCalled)
			}
			if (store.replaceDriversCalls > 0) != tt.wantReplaceCalled {
				t.Errorf("ReplaceDriversForVehicle called=%v (n=%d), want %v", store.replaceDriversCalls > 0, store.replaceDriversCalls, tt.wantReplaceCalled)
			}
		})
	}
}

// TestRefreshDrivers_Success proves the happy path end-to-end: a deadline is
// applied to the Tesla call, the resolved VIN flows through, the parsed drivers
// are persisted with the vehicle identity attached, and the freshly stored list
// is echoed back.
func TestRefreshDrivers_Success(t *testing.T) {
	client := &fakeClient{
		hasToken: true,
		getDriversFn: func(ctx context.Context, vin string) ([]byte, int, error) {
			if _, ok := ctx.Deadline(); !ok {
				t.Error("GetVehicleDrivers ctx has no deadline — context.WithTimeout not applied")
			}
			if vin != testVIN {
				t.Errorf("vin = %q, want %q", vin, testVIN)
			}
			return []byte(`{"response":[{"share_user_id":9,"public_key":"pk"}]}`), http.StatusOK, nil
		},
	}
	store := &fakeStore{getDriversFn: func(context.Context, int64) ([]*teslamodel.TeslaVehicleDriver, error) {
		return []*teslamodel.TeslaVehicleDriver{{ID: 1, VehicleID: 7}}, nil
	}}
	h := newTestHandler(client, store, &fakeVehicleStore{})

	rec := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/drivers/refresh", nil, map[string]string{"vehicleID": "7"})
	h.RefreshDrivers(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if store.replaceDriversCalls != 1 {
		t.Fatalf("ReplaceDriversForVehicle calls = %d, want 1", store.replaceDriversCalls)
	}
	if len(store.lastReplacedDrivers) != 1 {
		t.Fatalf("persisted drivers len = %d, want 1", len(store.lastReplacedDrivers))
	}
	d := store.lastReplacedDrivers[0]
	if d.ShareUserID == nil || *d.ShareUserID != 9 {
		t.Errorf("persisted ShareUserID = %v, want 9", d.ShareUserID)
	}
	if d.VIN != testVIN || d.VehicleID != 7 {
		t.Errorf("persisted VIN/VehicleID = %q/%d, want %q/7", d.VIN, d.VehicleID, testVIN)
	}
	var got []*teslamodel.TeslaVehicleDriver
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != 1 {
		t.Fatalf("response len = %d, want 1", len(got))
	}
}

// --- RefreshInvitations ------------------------------------------------------

func TestRefreshInvitations(t *testing.T) {
	tests := []struct {
		name              string
		hasToken          bool
		param             string
		vehicleFn         func(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
		teslaFn           func(ctx context.Context, vin string) ([]byte, int, error)
		replaceErr        error
		listAfterFn       func(ctx context.Context, id int64) ([]*teslamodel.TeslaVehicleInvitation, error)
		wantStatus        int
		wantErrCode       string
		wantTeslaCalled   bool
		wantReplaceCalled bool
	}{
		{
			name:        "unauthenticated",
			hasToken:    false,
			param:       "7",
			wantStatus:  http.StatusUnauthorized,
			wantErrCode: "UNAUTHORIZED",
		},
		{
			name:        "invalid vehicle id",
			hasToken:    true,
			param:       "abc",
			wantStatus:  http.StatusBadRequest,
			wantErrCode: "BAD_REQUEST",
		},
		{
			name:        "vehicle not found",
			hasToken:    true,
			param:       "7",
			vehicleFn:   func(context.Context, int64) (*vehiclemodel.Vehicle, error) { return nil, nil },
			wantStatus:  http.StatusNotFound,
			wantErrCode: "NOT_FOUND",
		},
		{
			name:        "vehicle lookup error",
			hasToken:    true,
			param:       "7",
			vehicleFn:   func(context.Context, int64) (*vehiclemodel.Vehicle, error) { return nil, errors.New("pg down") },
			wantStatus:  http.StatusInternalServerError,
			wantErrCode: "INTERNAL_ERROR",
		},
		{
			name:            "tesla transport error",
			hasToken:        true,
			param:           "7",
			teslaFn:         func(context.Context, string) ([]byte, int, error) { return nil, 0, errors.New("dial refused") },
			wantStatus:      http.StatusBadGateway,
			wantErrCode:     "ERROR",
			wantTeslaCalled: true,
		},
		{
			name:     "tesla non-2xx",
			hasToken: true,
			param:    "7",
			teslaFn: func(context.Context, string) ([]byte, int, error) {
				return []byte(`{"error":"x"}`), http.StatusInternalServerError, nil
			},
			wantStatus:      http.StatusBadGateway,
			wantErrCode:     "ERROR",
			wantTeslaCalled: true,
		},
		{
			name:            "parse error",
			hasToken:        true,
			param:           "7",
			teslaFn:         func(context.Context, string) ([]byte, int, error) { return []byte(`not json`), http.StatusOK, nil },
			wantStatus:      http.StatusInternalServerError,
			wantErrCode:     "INTERNAL_ERROR",
			wantTeslaCalled: true,
		},
		{
			name:     "replace error",
			hasToken: true,
			param:    "7",
			teslaFn: func(context.Context, string) ([]byte, int, error) {
				return []byte(`{"response":[]}`), http.StatusOK, nil
			},
			replaceErr:        errors.New("tx failed"),
			wantStatus:        http.StatusInternalServerError,
			wantErrCode:       "INTERNAL_ERROR",
			wantTeslaCalled:   true,
			wantReplaceCalled: true,
		},
		{
			name:     "list after refresh error",
			hasToken: true,
			param:    "7",
			teslaFn: func(context.Context, string) ([]byte, int, error) {
				return []byte(`{"response":[]}`), http.StatusOK, nil
			},
			listAfterFn: func(context.Context, int64) ([]*teslamodel.TeslaVehicleInvitation, error) {
				return nil, errors.New("select failed")
			},
			wantStatus:        http.StatusInternalServerError,
			wantErrCode:       "INTERNAL_ERROR",
			wantTeslaCalled:   true,
			wantReplaceCalled: true,
		},
		{
			name:     "success",
			hasToken: true,
			param:    "7",
			teslaFn: func(context.Context, string) ([]byte, int, error) {
				return []byte(`{"response":[]}`), http.StatusOK, nil
			},
			wantStatus:        http.StatusOK,
			wantTeslaCalled:   true,
			wantReplaceCalled: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &fakeClient{hasToken: tt.hasToken, getInvitationsFn: tt.teslaFn}
			store := &fakeStore{getInvitationsFn: tt.listAfterFn}
			if tt.replaceErr != nil {
				store.replaceInvitationsFn = func(context.Context, int64, []*teslamodel.TeslaVehicleInvitation) error { return tt.replaceErr }
			}
			vs := &fakeVehicleStore{getByIDFn: tt.vehicleFn}
			h := newTestHandler(client, store, vs)

			rec := httptest.NewRecorder()
			req := newRequest(http.MethodPost, "/invitations/refresh", nil, map[string]string{"vehicleID": tt.param})
			h.RefreshInvitations(rec, req)

			assertRefreshResponse(t, rec, tt.wantStatus, tt.wantErrCode)
			if (client.getInvitationsCalls > 0) != tt.wantTeslaCalled {
				t.Errorf("GetVehicleInvitations called=%v (n=%d), want %v", client.getInvitationsCalls > 0, client.getInvitationsCalls, tt.wantTeslaCalled)
			}
			if (store.replaceInvitationsCalls > 0) != tt.wantReplaceCalled {
				t.Errorf("ReplaceInvitationsForVehicle called=%v (n=%d), want %v", store.replaceInvitationsCalls > 0, store.replaceInvitationsCalls, tt.wantReplaceCalled)
			}
		})
	}
}

func TestRefreshInvitations_Success(t *testing.T) {
	client := &fakeClient{
		hasToken: true,
		getInvitationsFn: func(ctx context.Context, vin string) ([]byte, int, error) {
			if _, ok := ctx.Deadline(); !ok {
				t.Error("GetVehicleInvitations ctx has no deadline — context.WithTimeout not applied")
			}
			if vin != testVIN {
				t.Errorf("vin = %q, want %q", vin, testVIN)
			}
			return []byte(`{"response":[{"id":"inv1","status":"pending"}]}`), http.StatusOK, nil
		},
	}
	store := &fakeStore{getInvitationsFn: func(context.Context, int64) ([]*teslamodel.TeslaVehicleInvitation, error) {
		return []*teslamodel.TeslaVehicleInvitation{{ID: 1, VehicleID: 7}}, nil
	}}
	h := newTestHandler(client, store, &fakeVehicleStore{})

	rec := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/invitations/refresh", nil, map[string]string{"vehicleID": "7"})
	h.RefreshInvitations(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if store.replaceInvitationsCalls != 1 {
		t.Fatalf("ReplaceInvitationsForVehicle calls = %d, want 1", store.replaceInvitationsCalls)
	}
	if len(store.lastReplacedInvitations) != 1 {
		t.Fatalf("persisted invitations len = %d, want 1", len(store.lastReplacedInvitations))
	}
	inv := store.lastReplacedInvitations[0]
	if inv.InvitationID != "inv1" || inv.VIN != testVIN || inv.VehicleID != 7 {
		t.Errorf("persisted invitation = %+v, want id inv1 / VIN %s / vehicle 7", inv, testVIN)
	}
	var got []*teslamodel.TeslaVehicleInvitation
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != 1 {
		t.Fatalf("response len = %d, want 1", len(got))
	}
}

// --- RemoveDriver ------------------------------------------------------------

func TestRemoveDriver(t *testing.T) {
	strptr := func(s string) *string { return &s }

	tests := []struct {
		name             string
		hasToken         bool
		param            string
		vehicleFn        func(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
		body             *string
		removeFn         func(ctx context.Context, vin string, shareUserID int64) ([]byte, int, error)
		wantStatus       int
		wantErrCode      string
		wantRemoveCalled bool
	}{
		{
			name:        "unauthenticated",
			hasToken:    false,
			param:       "7",
			body:        strptr(`{"share_user_id":42}`),
			wantStatus:  http.StatusUnauthorized,
			wantErrCode: "UNAUTHORIZED",
		},
		{
			name:        "invalid vehicle id",
			hasToken:    true,
			param:       "abc",
			body:        strptr(`{"share_user_id":42}`),
			wantStatus:  http.StatusBadRequest,
			wantErrCode: "BAD_REQUEST",
		},
		{
			name:        "vehicle not found",
			hasToken:    true,
			param:       "7",
			vehicleFn:   func(context.Context, int64) (*vehiclemodel.Vehicle, error) { return nil, nil },
			body:        strptr(`{"share_user_id":42}`),
			wantStatus:  http.StatusNotFound,
			wantErrCode: "NOT_FOUND",
		},
		{
			name:        "malformed body",
			hasToken:    true,
			param:       "7",
			body:        strptr(`{not-json`),
			wantStatus:  http.StatusBadRequest,
			wantErrCode: "BAD_REQUEST",
		},
		{
			name:        "empty body",
			hasToken:    true,
			param:       "7",
			body:        nil,
			wantStatus:  http.StatusBadRequest,
			wantErrCode: "BAD_REQUEST",
		},
		{
			name:        "missing share_user_id",
			hasToken:    true,
			param:       "7",
			body:        strptr(`{}`),
			wantStatus:  http.StatusBadRequest,
			wantErrCode: "BAD_REQUEST",
		},
		{
			name:             "tesla remove error",
			hasToken:         true,
			param:            "7",
			body:             strptr(`{"share_user_id":42}`),
			removeFn:         func(context.Context, string, int64) ([]byte, int, error) { return nil, 0, errors.New("dial refused") },
			wantStatus:       http.StatusBadGateway,
			wantErrCode:      "ERROR",
			wantRemoveCalled: true,
		},
		{
			name:             "tesla non-2xx",
			hasToken:         true,
			param:            "7",
			body:             strptr(`{"share_user_id":42}`),
			removeFn:         func(context.Context, string, int64) ([]byte, int, error) { return nil, http.StatusForbidden, nil },
			wantStatus:       http.StatusBadGateway,
			wantErrCode:      "ERROR",
			wantRemoveCalled: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &fakeClient{hasToken: tt.hasToken, removeDriverFn: tt.removeFn}
			vs := &fakeVehicleStore{getByIDFn: tt.vehicleFn}
			h := newTestHandler(client, &fakeStore{}, vs)

			var body io.Reader
			if tt.body != nil {
				body = strings.NewReader(*tt.body)
			}
			rec := httptest.NewRecorder()
			req := newRequest(http.MethodDelete, "/drivers", body, map[string]string{"vehicleID": tt.param})
			h.RemoveDriver(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if tt.wantErrCode != "" {
				m := decodeErr(t, rec.Body.Bytes())
				if m["code"] != tt.wantErrCode {
					t.Errorf("code = %q, want %q", m["code"], tt.wantErrCode)
				}
			}
			if (client.removeDriverCalls > 0) != tt.wantRemoveCalled {
				t.Errorf("RemoveVehicleDriver called=%v (n=%d), want %v", client.removeDriverCalls > 0, client.removeDriverCalls, tt.wantRemoveCalled)
			}
		})
	}
}

// TestRemoveDriver_Success proves the happy path: the parsed share_user_id and
// resolved VIN reach the Tesla call under a deadline, and on success the handler
// delegates to RefreshDrivers (a second Tesla fetch + a persist) and returns the
// refreshed list.
func TestRemoveDriver_Success(t *testing.T) {
	client := &fakeClient{
		hasToken: true,
		removeDriverFn: func(ctx context.Context, vin string, shareUserID int64) ([]byte, int, error) {
			if _, ok := ctx.Deadline(); !ok {
				t.Error("RemoveVehicleDriver ctx has no deadline — context.WithTimeout not applied")
			}
			if vin != testVIN {
				t.Errorf("vin = %q, want %q", vin, testVIN)
			}
			if shareUserID != 42 {
				t.Errorf("shareUserID = %d, want 42", shareUserID)
			}
			return nil, http.StatusOK, nil
		},
		getDriversFn: func(context.Context, string) ([]byte, int, error) {
			return []byte(`{"response":[]}`), http.StatusOK, nil
		},
	}
	store := &fakeStore{}
	h := newTestHandler(client, store, &fakeVehicleStore{})

	rec := httptest.NewRecorder()
	req := newRequest(http.MethodDelete, "/drivers", strings.NewReader(`{"share_user_id":42}`), map[string]string{"vehicleID": "7"})
	h.RemoveDriver(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if client.removeDriverCalls != 1 {
		t.Errorf("RemoveVehicleDriver calls = %d, want 1", client.removeDriverCalls)
	}
	if client.lastShareUserID != 42 {
		t.Errorf("lastShareUserID = %d, want 42", client.lastShareUserID)
	}
	if client.getDriversCalls != 1 {
		t.Errorf("delegated GetVehicleDrivers calls = %d, want 1", client.getDriversCalls)
	}
	if store.replaceDriversCalls != 1 {
		t.Errorf("delegated ReplaceDriversForVehicle calls = %d, want 1", store.replaceDriversCalls)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != "[]" {
		t.Errorf("body = %s, want []", got)
	}
}

// --- CreateInvitation --------------------------------------------------------

func TestCreateInvitation(t *testing.T) {
	tests := []struct {
		name             string
		hasToken         bool
		param            string
		vehicleFn        func(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
		createFn         func(ctx context.Context, vin string) ([]byte, int, error)
		insertErr        error
		wantStatus       int
		wantErrCode      string
		wantCreateCalled bool
		wantInsertCalled bool
	}{
		{
			name:        "unauthenticated",
			hasToken:    false,
			param:       "7",
			wantStatus:  http.StatusUnauthorized,
			wantErrCode: "UNAUTHORIZED",
		},
		{
			name:        "invalid vehicle id",
			hasToken:    true,
			param:       "abc",
			wantStatus:  http.StatusBadRequest,
			wantErrCode: "BAD_REQUEST",
		},
		{
			name:        "vehicle not found",
			hasToken:    true,
			param:       "7",
			vehicleFn:   func(context.Context, int64) (*vehiclemodel.Vehicle, error) { return nil, nil },
			wantStatus:  http.StatusNotFound,
			wantErrCode: "NOT_FOUND",
		},
		{
			name:             "tesla create error",
			hasToken:         true,
			param:            "7",
			createFn:         func(context.Context, string) ([]byte, int, error) { return nil, 0, errors.New("dial refused") },
			wantStatus:       http.StatusBadGateway,
			wantErrCode:      "ERROR",
			wantCreateCalled: true,
		},
		{
			name:     "tesla non-2xx",
			hasToken: true,
			param:    "7",
			createFn: func(context.Context, string) ([]byte, int, error) {
				return []byte(`{"error":"x"}`), http.StatusBadRequest, nil
			},
			wantStatus:       http.StatusBadGateway,
			wantErrCode:      "ERROR",
			wantCreateCalled: true,
		},
		{
			name:             "parse error",
			hasToken:         true,
			param:            "7",
			createFn:         func(context.Context, string) ([]byte, int, error) { return []byte(`not json`), http.StatusOK, nil },
			wantStatus:       http.StatusInternalServerError,
			wantErrCode:      "INTERNAL_ERROR",
			wantCreateCalled: true,
		},
		{
			name:     "insert error",
			hasToken: true,
			param:    "7",
			createFn: func(context.Context, string) ([]byte, int, error) {
				return []byte(`{"response":{"id":"c1","status":"pending"}}`), http.StatusOK, nil
			},
			insertErr:        errors.New("unique violation"),
			wantStatus:       http.StatusInternalServerError,
			wantErrCode:      "INTERNAL_ERROR",
			wantCreateCalled: true,
			wantInsertCalled: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &fakeClient{hasToken: tt.hasToken, createInvitationFn: tt.createFn}
			store := &fakeStore{}
			if tt.insertErr != nil {
				store.insertInvitationFn = func(context.Context, *teslamodel.TeslaVehicleInvitation) error { return tt.insertErr }
			}
			vs := &fakeVehicleStore{getByIDFn: tt.vehicleFn}
			h := newTestHandler(client, store, vs)

			rec := httptest.NewRecorder()
			req := newRequest(http.MethodPost, "/invitations", nil, map[string]string{"vehicleID": tt.param})
			h.CreateInvitation(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if tt.wantErrCode != "" {
				m := decodeErr(t, rec.Body.Bytes())
				if m["code"] != tt.wantErrCode {
					t.Errorf("code = %q, want %q", m["code"], tt.wantErrCode)
				}
			}
			if (client.createInvitationCalls > 0) != tt.wantCreateCalled {
				t.Errorf("CreateVehicleInvitation called=%v (n=%d), want %v", client.createInvitationCalls > 0, client.createInvitationCalls, tt.wantCreateCalled)
			}
			if (store.insertInvitationCalls > 0) != tt.wantInsertCalled {
				t.Errorf("InsertInvitation called=%v (n=%d), want %v", store.insertInvitationCalls > 0, store.insertInvitationCalls, tt.wantInsertCalled)
			}
		})
	}
}

func TestCreateInvitation_Success(t *testing.T) {
	client := &fakeClient{
		hasToken: true,
		createInvitationFn: func(ctx context.Context, vin string) ([]byte, int, error) {
			if _, ok := ctx.Deadline(); !ok {
				t.Error("CreateVehicleInvitation ctx has no deadline — context.WithTimeout not applied")
			}
			if vin != testVIN {
				t.Errorf("vin = %q, want %q", vin, testVIN)
			}
			return []byte(`{"response":{"id":"created1","invite_url":"https://y","status":"pending","owner_email":"me@x.com"}}`), http.StatusOK, nil
		},
	}
	store := &fakeStore{}
	h := newTestHandler(client, store, &fakeVehicleStore{})

	rec := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/invitations", nil, map[string]string{"vehicleID": "7"})
	h.CreateInvitation(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if store.insertInvitationCalls != 1 {
		t.Fatalf("InsertInvitation calls = %d, want 1", store.insertInvitationCalls)
	}
	if store.lastInsertedInvitation == nil {
		t.Fatal("no invitation inserted")
	}
	if store.lastInsertedInvitation.InvitationID != "created1" {
		t.Errorf("inserted InvitationID = %q, want created1", store.lastInsertedInvitation.InvitationID)
	}
	if store.lastInsertedInvitation.VIN != testVIN || store.lastInsertedInvitation.VehicleID != 7 {
		t.Errorf("inserted VIN/VehicleID = %q/%d, want %q/7", store.lastInsertedInvitation.VIN, store.lastInsertedInvitation.VehicleID, testVIN)
	}
	var got teslamodel.TeslaVehicleInvitation
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if got.InvitationID != "created1" {
		t.Errorf("response invitation_id = %q, want created1", got.InvitationID)
	}
}

// --- RevokeInvitation --------------------------------------------------------

func TestRevokeInvitation(t *testing.T) {
	tests := []struct {
		name             string
		hasToken         bool
		param            string
		invitationID     string // "" ⇒ param omitted
		vehicleFn        func(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
		revokeFn         func(ctx context.Context, vin, invitationID string) ([]byte, int, error)
		wantStatus       int
		wantErrCode      string
		wantRevokeCalled bool
	}{
		{
			name:         "unauthenticated",
			hasToken:     false,
			param:        "7",
			invitationID: "inv-1",
			wantStatus:   http.StatusUnauthorized,
			wantErrCode:  "UNAUTHORIZED",
		},
		{
			name:         "invalid vehicle id",
			hasToken:     true,
			param:        "abc",
			invitationID: "inv-1",
			wantStatus:   http.StatusBadRequest,
			wantErrCode:  "BAD_REQUEST",
		},
		{
			name:         "vehicle not found",
			hasToken:     true,
			param:        "7",
			invitationID: "inv-1",
			vehicleFn:    func(context.Context, int64) (*vehiclemodel.Vehicle, error) { return nil, nil },
			wantStatus:   http.StatusNotFound,
			wantErrCode:  "NOT_FOUND",
		},
		{
			name:         "missing invitation id",
			hasToken:     true,
			param:        "7",
			invitationID: "",
			wantStatus:   http.StatusBadRequest,
			wantErrCode:  "BAD_REQUEST",
		},
		{
			name:             "tesla revoke error",
			hasToken:         true,
			param:            "7",
			invitationID:     "inv-1",
			revokeFn:         func(context.Context, string, string) ([]byte, int, error) { return nil, 0, errors.New("dial refused") },
			wantStatus:       http.StatusBadGateway,
			wantErrCode:      "ERROR",
			wantRevokeCalled: true,
		},
		{
			name:             "tesla non-2xx",
			hasToken:         true,
			param:            "7",
			invitationID:     "inv-1",
			revokeFn:         func(context.Context, string, string) ([]byte, int, error) { return nil, http.StatusNotFound, nil },
			wantStatus:       http.StatusBadGateway,
			wantErrCode:      "ERROR",
			wantRevokeCalled: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &fakeClient{hasToken: tt.hasToken, revokeInvitationFn: tt.revokeFn}
			vs := &fakeVehicleStore{getByIDFn: tt.vehicleFn}
			h := newTestHandler(client, &fakeStore{}, vs)

			params := map[string]string{"vehicleID": tt.param}
			if tt.invitationID != "" {
				params["invitationID"] = tt.invitationID
			}
			rec := httptest.NewRecorder()
			req := newRequest(http.MethodPost, "/invitations/revoke", nil, params)
			h.RevokeInvitation(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if tt.wantErrCode != "" {
				m := decodeErr(t, rec.Body.Bytes())
				if m["code"] != tt.wantErrCode {
					t.Errorf("code = %q, want %q", m["code"], tt.wantErrCode)
				}
			}
			if (client.revokeInvitationCalls > 0) != tt.wantRevokeCalled {
				t.Errorf("RevokeVehicleInvitation called=%v (n=%d), want %v", client.revokeInvitationCalls > 0, client.revokeInvitationCalls, tt.wantRevokeCalled)
			}
		})
	}
}

func TestRevokeInvitation_Success(t *testing.T) {
	client := &fakeClient{
		hasToken: true,
		revokeInvitationFn: func(ctx context.Context, vin, invitationID string) ([]byte, int, error) {
			if _, ok := ctx.Deadline(); !ok {
				t.Error("RevokeVehicleInvitation ctx has no deadline — context.WithTimeout not applied")
			}
			if vin != testVIN {
				t.Errorf("vin = %q, want %q", vin, testVIN)
			}
			if invitationID != "inv-123" {
				t.Errorf("invitationID = %q, want inv-123", invitationID)
			}
			return nil, http.StatusOK, nil
		},
		getInvitationsFn: func(context.Context, string) ([]byte, int, error) {
			return []byte(`{"response":[]}`), http.StatusOK, nil
		},
	}
	store := &fakeStore{}
	h := newTestHandler(client, store, &fakeVehicleStore{})

	rec := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/invitations/revoke", nil, map[string]string{"vehicleID": "7", "invitationID": "inv-123"})
	h.RevokeInvitation(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if client.revokeInvitationCalls != 1 {
		t.Errorf("RevokeVehicleInvitation calls = %d, want 1", client.revokeInvitationCalls)
	}
	if client.lastRevokeInvitationID != "inv-123" {
		t.Errorf("lastRevokeInvitationID = %q, want inv-123", client.lastRevokeInvitationID)
	}
	if client.getInvitationsCalls != 1 {
		t.Errorf("delegated GetVehicleInvitations calls = %d, want 1", client.getInvitationsCalls)
	}
	if store.replaceInvitationsCalls != 1 {
		t.Errorf("delegated ReplaceInvitationsForVehicle calls = %d, want 1", store.replaceInvitationsCalls)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != "[]" {
		t.Errorf("body = %s, want []", got)
	}
}

// assertRefreshResponse is the shared success/error check for the refresh
// endpoints: exact status, and on error a machine code + non-empty message; on
// success a non-null JSON array.
func assertRefreshResponse(t *testing.T, rec *httptest.ResponseRecorder, wantStatus int, wantErrCode string) {
	t.Helper()
	if rec.Code != wantStatus {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, wantStatus, rec.Body.String())
	}
	if wantErrCode != "" {
		m := decodeErr(t, rec.Body.Bytes())
		if m["code"] != wantErrCode {
			t.Errorf("code = %q, want %q; body=%s", m["code"], wantErrCode, rec.Body.String())
		}
		if m["error"] == "" {
			t.Errorf("expected non-empty error message; got %v", m)
		}
		return
	}
	if body := strings.TrimSpace(rec.Body.String()); !strings.HasPrefix(body, "[") {
		t.Fatalf("success body is not a JSON array (null-safety): %s", body)
	}
}
