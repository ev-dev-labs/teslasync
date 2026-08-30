package share

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	telemetrymodel "github.com/ev-dev-labs/teslasync/internal/models/telemetry"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// TestMain silences the global zerolog logger so handler log lines don't
// pollute `go test` output; the handlers log at their boundaries and those
// side-effects are irrelevant to the assertions.
func TestMain(m *testing.M) {
	log.Logger = zerolog.New(io.Discard)
	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// In-memory fakes for the four persistence ports. Each records call counts and
// dispatches to an optional func so table cases can inject success/error/edge
// behaviour without a pgx pool.
// ---------------------------------------------------------------------------

type fakeShareStore struct {
	createFn func(ctx context.Context, st *drivemodel.ShareToken) error
	getFn    func(ctx context.Context, token string) (*drivemodel.ShareToken, error)
	listFn   func(ctx context.Context, driveID int64) ([]*drivemodel.ShareToken, error)
	incFn    func(ctx context.Context, id int64) error
	deleteFn func(ctx context.Context, token string) error

	createCalls int
	created     *drivemodel.ShareToken
	getCalls    int
	getToken    string
	listCalls   int
	listDriveID int64
	incCalls    int
	incID       int64
	deleteCalls int
	deleteToken string
}

func (f *fakeShareStore) Create(ctx context.Context, st *drivemodel.ShareToken) error {
	f.createCalls++
	f.created = st
	if f.createFn == nil {
		// Emulate the real repo: assign a generated-looking token + id.
		st.Token = "0123456789abcdef0123456789abcdef"
		st.ID = 555
		return nil
	}
	return f.createFn(ctx, st)
}

func (f *fakeShareStore) GetByToken(ctx context.Context, token string) (*drivemodel.ShareToken, error) {
	f.getCalls++
	f.getToken = token
	if f.getFn == nil {
		return nil, nil
	}
	return f.getFn(ctx, token)
}

func (f *fakeShareStore) ListByDrive(ctx context.Context, driveID int64) ([]*drivemodel.ShareToken, error) {
	f.listCalls++
	f.listDriveID = driveID
	if f.listFn == nil {
		return nil, nil
	}
	return f.listFn(ctx, driveID)
}

func (f *fakeShareStore) IncrementViews(ctx context.Context, id int64) error {
	f.incCalls++
	f.incID = id
	if f.incFn == nil {
		return nil
	}
	return f.incFn(ctx, id)
}

func (f *fakeShareStore) Delete(ctx context.Context, token string) error {
	f.deleteCalls++
	f.deleteToken = token
	if f.deleteFn == nil {
		return nil
	}
	return f.deleteFn(ctx, token)
}

var _ shareTokenStore = (*fakeShareStore)(nil)

type fakeDriveStore struct {
	driveFn func(ctx context.Context, id int64) (*drivemodel.Drive, error)
	calls   int
	gotID   int64
}

func (f *fakeDriveStore) GetByID(ctx context.Context, id int64) (*drivemodel.Drive, error) {
	f.calls++
	f.gotID = id
	if f.driveFn == nil {
		return nil, nil
	}
	return f.driveFn(ctx, id)
}

var _ driveByIDFetcher = (*fakeDriveStore)(nil)

type fakePositionStore struct {
	listFn func(ctx context.Context, vehicleID int64, from, to time.Time) ([]telemetrymodel.Position, error)
	calls  int
	gotID  int64
	gotTo  time.Time
}

func (f *fakePositionStore) ListByVehicle(ctx context.Context, vehicleID int64, from, to time.Time) ([]telemetrymodel.Position, error) {
	f.calls++
	f.gotID = vehicleID
	f.gotTo = to
	if f.listFn == nil {
		return nil, nil
	}
	return f.listFn(ctx, vehicleID, from, to)
}

var _ positionLister = (*fakePositionStore)(nil)

type fakeVehicleStore struct {
	vehicleFn func(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
	calls     int
}

func (f *fakeVehicleStore) GetByID(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error) {
	f.calls++
	if f.vehicleFn == nil {
		return nil, nil
	}
	return f.vehicleFn(ctx, id)
}

var _ vehicleByIDFetcher = (*fakeVehicleStore)(nil)

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

func newRequest(t *testing.T, method, target string, body io.Reader, params map[string]string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, target, body)
	routeCtx := chi.NewRouteContext()
	for k, v := range params {
		routeCtx.URLParams.Add(k, v)
	}
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode error body: %v; body=%s", err, rec.Body.String())
	}
	return m
}

func ptrStr(s string) *string   { return &s }
func ptrI16(v int16) *int16     { return &v }
func ptrF64(v float64) *float64 { return &v }

func approx(a, b, tol float64) bool { return math.Abs(a-b) <= tol }

// completedDrive is a fully-populated *drivemodel.Drive for share-view tests.
func completedDrive(id, vehicleID int64) *drivemodel.Drive {
	start := time.Date(2026, 3, 15, 8, 0, 0, 0, time.UTC)
	end := start.Add(30 * time.Minute)
	return &drivemodel.Drive{
		ID:              id,
		VehicleID:       vehicleID,
		StartTs:         start,
		EndTs:           &end,
		DurationS:       1800,
		DistanceM:       12000,
		StartAddress:    ptrStr("123 Start St"),
		EndAddress:      ptrStr("456 End Ave"),
		StartBatteryPct: ptrI16(90),
		EndBatteryPct:   ptrI16(70),
		MaxSpeedMps:     ptrF64(30),
		AvgSpeedMps:     ptrF64(15),
	}
}

func validShare(driveID int64) *drivemodel.ShareToken {
	return &drivemodel.ShareToken{
		ID:           1,
		Token:        "0123456789abcdef0123456789abcdef",
		DriveID:      driveID,
		IncludeMap:   true,
		IncludeSpeed: true,
	}
}

// ---------------------------------------------------------------------------
// Pure helper unit tests
// ---------------------------------------------------------------------------

func TestTruncateToken(t *testing.T) {
	tests := []struct {
		name  string
		token string
		want  string
	}{
		{"empty", "", ""},
		{"short_1", "a", "a"},
		{"short_7", "1234567", "1234567"},
		{"exactly_8", "12345678", "12345678"},
		{"9_chars", "123456789", "12345678..."},
		{"generated_32", "0123456789abcdef0123456789abcdef", "01234567..."},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := truncateToken(tt.token); got != tt.want {
				t.Fatalf("truncateToken(%q) = %q, want %q", tt.token, got, tt.want)
			}
		})
	}
}

func TestSafeDeref(t *testing.T) {
	value := "hello"
	empty := ""
	tests := []struct {
		name     string
		in       *string
		fallback string
		want     string
	}{
		{"nil_returns_fallback", nil, "fallback", "fallback"},
		{"non_nil_returns_value", &value, "fallback", "hello"},
		{"non_nil_empty_returns_empty", &empty, "fallback", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := safeDeref(tt.in, tt.fallback); got != tt.want {
				t.Fatalf("safeDeref = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestHaversineKm(t *testing.T) {
	tests := []struct {
		name                   string
		lat1, lng1, lat2, lng2 float64
		want                   float64
		tol                    float64
	}{
		{"same_point_is_zero", 37.5, -122.5, 37.5, -122.5, 0, 1e-9},
		{"one_deg_lng_at_equator", 0, 0, 0, 1, 111.19, 0.5},
		{"one_deg_lat", 0, 0, 1, 0, 111.19, 0.5},
		{"sf_to_la", 37.7749, -122.4194, 34.0522, -118.2437, 559.0, 5.0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := haversineKm(tt.lat1, tt.lng1, tt.lat2, tt.lng2)
			if !approx(got, tt.want, tt.tol) {
				t.Fatalf("haversineKm = %.4f, want %.4f (±%.2f)", got, tt.want, tt.tol)
			}
		})
	}
}

func TestHaversineKm_Symmetric(t *testing.T) {
	ab := haversineKm(40.0, -70.0, 41.0, -71.0)
	ba := haversineKm(41.0, -71.0, 40.0, -70.0)
	if !approx(ab, ba, 1e-9) {
		t.Fatalf("haversine not symmetric: ab=%.6f ba=%.6f", ab, ba)
	}
	if ab <= 0 {
		t.Fatalf("expected positive distance, got %.6f", ab)
	}
}

// buildPositions returns n positions along a diagonal; the caller decorates the
// middle (clipped) window with elevation/speed.
func buildPositions(n int) []telemetrymodel.Position {
	positions := make([]telemetrymodel.Position, n)
	base := time.Date(2026, 3, 15, 8, 0, 0, 0, time.UTC)
	for i := range positions {
		positions[i] = telemetrymodel.Position{
			VehicleID: 42,
			Ts:        base.Add(time.Duration(i) * time.Minute),
			Latitude:  37.0 + float64(i)*0.01,
			Longitude: -122.0 + float64(i)*0.01,
			Source:    "test",
		}
	}
	return positions
}

func TestBuildFromPositions_TooFewClipsToNothing(t *testing.T) {
	h := &ShareHandler{}
	share := validShare(7)
	// clipPoints*2 == 6: exactly 6 (and fewer) must yield an early return.
	for _, n := range []int{0, 1, 6} {
		resp := &publicShareResponse{}
		h.buildFromPositions(resp, buildPositions(n), share)
		if len(resp.MapPoints) != 0 || len(resp.ElevationProfile) != 0 || len(resp.SpeedProfile) != 0 {
			t.Fatalf("n=%d: expected no points, got map=%d elev=%d speed=%d",
				n, len(resp.MapPoints), len(resp.ElevationProfile), len(resp.SpeedProfile))
		}
	}
}

func TestBuildFromPositions_ClipsEndsAndBuildsProfiles(t *testing.T) {
	h := &ShareHandler{}
	positions := buildPositions(9) // clipped window = indices [3,6)
	for i := 3; i < 6; i++ {
		positions[i].ElevationM = ptrF64(100 + float64(i))
		positions[i].SpeedMph = ptrF64(20 + float64(i)) // mph
	}
	share := &drivemodel.ShareToken{IncludeMap: true, IncludeSpeed: true}
	resp := &publicShareResponse{}

	h.buildFromPositions(resp, positions, share)

	if len(resp.MapPoints) != 3 {
		t.Fatalf("MapPoints = %d, want 3 (9 - 2*clipPoints)", len(resp.MapPoints))
	}
	// First surfaced point must be positions[3], NOT positions[0] (privacy clip).
	if resp.MapPoints[0].Lat != positions[3].Latitude || resp.MapPoints[0].Lng != positions[3].Longitude {
		t.Fatalf("first map point = (%v,%v), want clipped start (%v,%v)",
			resp.MapPoints[0].Lat, resp.MapPoints[0].Lng, positions[3].Latitude, positions[3].Longitude)
	}
	if len(resp.ElevationProfile) != 3 {
		t.Fatalf("ElevationProfile = %d, want 3", len(resp.ElevationProfile))
	}
	if len(resp.SpeedProfile) != 3 {
		t.Fatalf("SpeedProfile = %d, want 3", len(resp.SpeedProfile))
	}
	// mph -> mps conversion at the first clipped point: (20+3) mph.
	wantMps := (20 + 3.0) * 0.44704
	if !approx(resp.SpeedProfile[0].SpeedMps, wantMps, 1e-6) {
		t.Fatalf("SpeedProfile[0].SpeedMps = %.6f, want %.6f", resp.SpeedProfile[0].SpeedMps, wantMps)
	}
	// Cumulative distance must be non-decreasing and start at 0.
	if resp.SpeedProfile[0].DistanceM != 0 {
		t.Fatalf("first cumulative distance = %v, want 0", resp.SpeedProfile[0].DistanceM)
	}
	for i := 1; i < len(resp.SpeedProfile); i++ {
		if resp.SpeedProfile[i].DistanceM < resp.SpeedProfile[i-1].DistanceM {
			t.Fatalf("cumulative distance decreased at %d: %v < %v",
				i, resp.SpeedProfile[i].DistanceM, resp.SpeedProfile[i-1].DistanceM)
		}
	}
}

func TestBuildFromPositions_SkipsZeroCoordsAndRespectsFlags(t *testing.T) {
	h := &ShareHandler{}
	positions := buildPositions(9)
	// Zero-out one clipped point (index 4) → it must be skipped entirely.
	positions[4].Latitude = 0
	positions[4].Longitude = 0
	for i := 3; i < 6; i++ {
		positions[i].ElevationM = ptrF64(100 + float64(i))
		positions[i].SpeedMph = ptrF64(20 + float64(i))
	}
	// IncludeSpeed=false and IncludeMap=false: only elevation should populate.
	share := &drivemodel.ShareToken{IncludeMap: false, IncludeSpeed: false}
	resp := &publicShareResponse{}

	h.buildFromPositions(resp, positions, share)

	if len(resp.MapPoints) != 0 {
		t.Fatalf("MapPoints = %d, want 0 (IncludeMap false)", len(resp.MapPoints))
	}
	if len(resp.SpeedProfile) != 0 {
		t.Fatalf("SpeedProfile = %d, want 0 (IncludeSpeed false)", len(resp.SpeedProfile))
	}
	// Two of three clipped points remain (index 4 skipped for zero coords).
	if len(resp.ElevationProfile) != 2 {
		t.Fatalf("ElevationProfile = %d, want 2 (zero-coord point skipped)", len(resp.ElevationProfile))
	}
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

func TestCreate_ErrorPaths(t *testing.T) {
	tests := []struct {
		name            string
		driveIDParam    string
		driveFn         func(ctx context.Context, id int64) (*drivemodel.Drive, error)
		body            io.Reader
		createFn        func(ctx context.Context, st *drivemodel.ShareToken) error
		wantStatus      int
		wantErrContains string
		wantCreateCalls int
	}{
		{
			name:            "invalid_drive_id",
			driveIDParam:    "abc",
			wantStatus:      http.StatusBadRequest,
			wantErrContains: "invalid drive ID",
			wantCreateCalls: 0,
		},
		{
			name:            "drive_lookup_error",
			driveIDParam:    "7",
			driveFn:         func(context.Context, int64) (*drivemodel.Drive, error) { return nil, errors.New("db down") },
			wantStatus:      http.StatusInternalServerError,
			wantErrContains: "failed to get drive",
			wantCreateCalls: 0,
		},
		{
			name:            "drive_not_found",
			driveIDParam:    "7",
			driveFn:         func(context.Context, int64) (*drivemodel.Drive, error) { return nil, nil },
			wantStatus:      http.StatusNotFound,
			wantErrContains: "drive not found",
			wantCreateCalls: 0,
		},
		{
			name:            "malformed_body",
			driveIDParam:    "7",
			driveFn:         func(context.Context, int64) (*drivemodel.Drive, error) { return completedDrive(7, 42), nil },
			body:            strings.NewReader("{not json"),
			wantStatus:      http.StatusBadRequest,
			wantErrContains: "invalid request body",
			wantCreateCalls: 0,
		},
		{
			name:            "repo_create_error",
			driveIDParam:    "7",
			driveFn:         func(context.Context, int64) (*drivemodel.Drive, error) { return completedDrive(7, 42), nil },
			createFn:        func(context.Context, *drivemodel.ShareToken) error { return errors.New("insert failed") },
			wantStatus:      http.StatusInternalServerError,
			wantErrContains: "failed to create share link",
			wantCreateCalls: 1,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			shareStore := &fakeShareStore{createFn: tt.createFn}
			h := &ShareHandler{
				shareRepo: shareStore,
				driveRepo: &fakeDriveStore{driveFn: tt.driveFn},
			}
			rec := httptest.NewRecorder()
			h.Create(rec, newRequest(t, http.MethodPost, "/drives/"+tt.driveIDParam+"/share", tt.body, map[string]string{"driveID": tt.driveIDParam}))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if got := decodeError(t, rec)["error"]; !strings.Contains(got, tt.wantErrContains) {
				t.Fatalf("error = %q, want contains %q", got, tt.wantErrContains)
			}
			if shareStore.createCalls != tt.wantCreateCalls {
				t.Fatalf("createCalls = %d, want %d", shareStore.createCalls, tt.wantCreateCalls)
			}
		})
	}
}

func TestCreate_EmptyBodyUsesDefaults(t *testing.T) {
	shareStore := &fakeShareStore{}
	h := &ShareHandler{
		shareRepo: shareStore,
		driveRepo: &fakeDriveStore{driveFn: func(context.Context, int64) (*drivemodel.Drive, error) { return completedDrive(7, 42), nil }},
	}
	rec := httptest.NewRecorder()
	// Nil body → empty request → all-optional fields default (no 400).
	h.Create(rec, newRequest(t, http.MethodPost, "/drives/7/share", nil, map[string]string{"driveID": "7"}))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	st := shareStore.created
	if st == nil {
		t.Fatal("expected Create to be called with a token")
	}
	if st.DriveID != 7 {
		t.Fatalf("DriveID = %d, want 7", st.DriveID)
	}
	if !st.IncludeMap {
		t.Fatal("IncludeMap should default true")
	}
	if !st.IncludeSpeed {
		t.Fatal("IncludeSpeed should default true")
	}
	if st.IncludeTelemetry {
		t.Fatal("IncludeTelemetry should default false")
	}
	if st.Title != nil || st.Description != nil {
		t.Fatalf("Title/Description should be nil, got %v/%v", st.Title, st.Description)
	}
	if st.ExpiresAt != nil {
		t.Fatalf("ExpiresAt should be nil when expires_in_days omitted, got %v", st.ExpiresAt)
	}

	var body struct {
		Token string `json:"token"`
		URL   string `json:"url"`
		ID    int64  `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Token == "" || body.URL != "/s/"+body.Token || body.ID != 555 {
		t.Fatalf("unexpected response body: %+v", body)
	}
}

func TestCreate_FullBodyHonoursFields(t *testing.T) {
	shareStore := &fakeShareStore{}
	h := &ShareHandler{
		shareRepo: shareStore,
		driveRepo: &fakeDriveStore{driveFn: func(context.Context, int64) (*drivemodel.Drive, error) { return completedDrive(7, 42), nil }},
	}
	body := `{"title":"My Drive","description":"Scenic route","include_speed":false,"include_telemetry":true,"expires_in_days":7}`
	rec := httptest.NewRecorder()
	before := time.Now().UTC()
	h.Create(rec, newRequest(t, http.MethodPost, "/drives/7/share", strings.NewReader(body), map[string]string{"driveID": "7"}))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	st := shareStore.created
	if st.Title == nil || *st.Title != "My Drive" {
		t.Fatalf("Title = %v, want 'My Drive'", st.Title)
	}
	if st.Description == nil || *st.Description != "Scenic route" {
		t.Fatalf("Description = %v, want 'Scenic route'", st.Description)
	}
	if st.IncludeSpeed {
		t.Fatal("IncludeSpeed should be false (explicit override)")
	}
	if !st.IncludeTelemetry {
		t.Fatal("IncludeTelemetry should be true (explicit override)")
	}
	if st.ExpiresAt == nil {
		t.Fatal("ExpiresAt should be set for expires_in_days=7")
	}
	wantMin := before.Add(6*24*time.Hour + 23*time.Hour)
	wantMax := before.Add(7*24*time.Hour + time.Hour)
	if st.ExpiresAt.Before(wantMin) || st.ExpiresAt.After(wantMax) {
		t.Fatalf("ExpiresAt = %v, want ~7 days from now", st.ExpiresAt)
	}
}

// TestCreate_ExpiryClampNoOverflow guards the int64-nanosecond overflow bug: an
// absurd expires_in_days must clamp to a FUTURE instant, never wrap to the past.
func TestCreate_ExpiryClampNoOverflow(t *testing.T) {
	shareStore := &fakeShareStore{}
	h := &ShareHandler{
		shareRepo: shareStore,
		driveRepo: &fakeDriveStore{driveFn: func(context.Context, int64) (*drivemodel.Drive, error) { return completedDrive(7, 42), nil }},
	}
	body := `{"expires_in_days":1000000000}`
	rec := httptest.NewRecorder()
	now := time.Now().UTC()
	h.Create(rec, newRequest(t, http.MethodPost, "/drives/7/share", strings.NewReader(body), map[string]string{"driveID": "7"}))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	st := shareStore.created
	if st.ExpiresAt == nil {
		t.Fatal("ExpiresAt should be set")
	}
	if !st.ExpiresAt.After(now) {
		t.Fatalf("ExpiresAt = %v is not in the future (overflow bug)", st.ExpiresAt)
	}
	// Clamped to maxExpiryDays.
	wantMax := now.Add((maxExpiryDays + 1) * 24 * time.Hour)
	if st.ExpiresAt.After(wantMax) {
		t.Fatalf("ExpiresAt = %v exceeds clamp of %d days", st.ExpiresAt, maxExpiryDays)
	}
}

// TestCreate_RepoLeavesTokenEmptyNoPanic ensures the success-log path does not
// panic when the store leaves Token empty (truncateToken robustness).
func TestCreate_RepoLeavesTokenEmptyNoPanic(t *testing.T) {
	shareStore := &fakeShareStore{createFn: func(_ context.Context, st *drivemodel.ShareToken) error {
		st.Token = "" // shorter than 8: would panic under a naive token[:8]
		st.ID = 9
		return nil
	}}
	h := &ShareHandler{
		shareRepo: shareStore,
		driveRepo: &fakeDriveStore{driveFn: func(context.Context, int64) (*drivemodel.Drive, error) { return completedDrive(7, 42), nil }},
	}
	rec := httptest.NewRecorder()
	h.Create(rec, newRequest(t, http.MethodPost, "/drives/7/share", nil, map[string]string{"driveID": "7"}))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

func TestList(t *testing.T) {
	tests := []struct {
		name         string
		driveIDParam string
		listFn       func(ctx context.Context, driveID int64) ([]*drivemodel.ShareToken, error)
		wantStatus   int
		wantErr      string
		wantLen      int
	}{
		{
			name:         "invalid_drive_id",
			driveIDParam: "xyz",
			wantStatus:   http.StatusBadRequest,
			wantErr:      "invalid drive ID",
		},
		{
			name:         "repo_error",
			driveIDParam: "5",
			listFn:       func(context.Context, int64) ([]*drivemodel.ShareToken, error) { return nil, errors.New("boom") },
			wantStatus:   http.StatusInternalServerError,
			wantErr:      "failed to list shares",
		},
		{
			name:         "nil_becomes_empty_array",
			driveIDParam: "5",
			listFn:       func(context.Context, int64) ([]*drivemodel.ShareToken, error) { return nil, nil },
			wantStatus:   http.StatusOK,
			wantLen:      0,
		},
		{
			name:         "populated",
			driveIDParam: "5",
			listFn: func(context.Context, int64) ([]*drivemodel.ShareToken, error) {
				return []*drivemodel.ShareToken{validShare(5), validShare(5)}, nil
			},
			wantStatus: http.StatusOK,
			wantLen:    2,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &ShareHandler{shareRepo: &fakeShareStore{listFn: tt.listFn}}
			rec := httptest.NewRecorder()
			h.List(rec, newRequest(t, http.MethodGet, "/drives/"+tt.driveIDParam+"/shares", nil, map[string]string{"driveID": tt.driveIDParam}))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if tt.wantErr != "" {
				if got := decodeError(t, rec)["error"]; !strings.Contains(got, tt.wantErr) {
					t.Fatalf("error = %q, want contains %q", got, tt.wantErr)
				}
				return
			}
			// Success: must be a JSON array (never null), of the expected length.
			if trimmed := strings.TrimSpace(rec.Body.String()); tt.wantLen == 0 && trimmed != "[]" {
				t.Fatalf("empty list body = %q, want '[]'", trimmed)
			}
			var arr []*drivemodel.ShareToken
			if err := json.Unmarshal(rec.Body.Bytes(), &arr); err != nil {
				t.Fatalf("decode array: %v; body=%s", err, rec.Body.String())
			}
			if len(arr) != tt.wantLen {
				t.Fatalf("len = %d, want %d", len(arr), tt.wantLen)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

func TestRevoke(t *testing.T) {
	tests := []struct {
		name        string
		token       string
		omitParam   bool
		deleteFn    func(ctx context.Context, token string) error
		wantStatus  int
		wantErr     string
		wantDeleted bool
	}{
		{
			name:       "missing_token",
			omitParam:  true,
			wantStatus: http.StatusBadRequest,
			wantErr:    "token required",
		},
		{
			// Regression: a short (<8 char) user-supplied token previously
			// panicked on token[:8] in the success log line.
			name:        "short_token_success_no_panic",
			token:       "abc",
			wantStatus:  http.StatusOK,
			wantDeleted: true,
		},
		{
			// Regression: short token in the ERROR log line must not panic.
			name:        "short_token_delete_error_no_panic",
			token:       "abc",
			deleteFn:    func(context.Context, string) error { return errors.New("not found") },
			wantStatus:  http.StatusNotFound,
			wantErr:     "share link not found",
			wantDeleted: true,
		},
		{
			name:        "normal_token_success",
			token:       "0123456789abcdef0123456789abcdef",
			wantStatus:  http.StatusOK,
			wantDeleted: true,
		},
		{
			name:        "delete_error_maps_to_404",
			token:       "0123456789abcdef0123456789abcdef",
			deleteFn:    func(context.Context, string) error { return errors.New("gone") },
			wantStatus:  http.StatusNotFound,
			wantErr:     "share link not found",
			wantDeleted: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &fakeShareStore{deleteFn: tt.deleteFn}
			h := &ShareHandler{shareRepo: store}
			params := map[string]string{}
			if !tt.omitParam {
				params["token"] = tt.token
			}
			rec := httptest.NewRecorder()
			h.Revoke(rec, newRequest(t, http.MethodDelete, "/shares/"+tt.token, nil, params))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if tt.wantErr != "" {
				if got := decodeError(t, rec)["error"]; !strings.Contains(got, tt.wantErr) {
					t.Fatalf("error = %q, want contains %q", got, tt.wantErr)
				}
			} else {
				var m map[string]string
				if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
					t.Fatalf("decode body: %v", err)
				}
				if m["status"] != "revoked" {
					t.Fatalf("status field = %q, want 'revoked'", m["status"])
				}
			}
			if (store.deleteCalls == 1) != tt.wantDeleted {
				t.Fatalf("deleteCalls = %d, wantDeleted = %v", store.deleteCalls, tt.wantDeleted)
			}
			if tt.wantDeleted && store.deleteToken != tt.token {
				t.Fatalf("deleted token = %q, want %q", store.deleteToken, tt.token)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// GetPublicShare — error / status paths
// ---------------------------------------------------------------------------

func TestGetPublicShare_ErrorPaths(t *testing.T) {
	past := time.Now().UTC().Add(-time.Hour)
	tests := []struct {
		name       string
		token      string
		omitParam  bool
		getFn      func(ctx context.Context, token string) (*drivemodel.ShareToken, error)
		driveFn    func(ctx context.Context, id int64) (*drivemodel.Drive, error)
		wantStatus int
		wantErr    string
	}{
		{
			name:       "missing_token",
			omitParam:  true,
			wantStatus: http.StatusNotFound,
			wantErr:    "not found",
		},
		{
			name:       "get_token_error",
			token:      "tok",
			getFn:      func(context.Context, string) (*drivemodel.ShareToken, error) { return nil, errors.New("db err") },
			wantStatus: http.StatusInternalServerError,
			wantErr:    "internal error",
		},
		{
			name:       "share_not_found",
			token:      "tok",
			getFn:      func(context.Context, string) (*drivemodel.ShareToken, error) { return nil, nil },
			wantStatus: http.StatusNotFound,
			wantErr:    "share not found or expired",
		},
		{
			name:  "share_expired",
			token: "tok",
			getFn: func(context.Context, string) (*drivemodel.ShareToken, error) {
				s := validShare(7)
				s.ExpiresAt = &past
				return s, nil
			},
			wantStatus: http.StatusGone,
			wantErr:    "share link has expired",
		},
		{
			name:       "drive_gone",
			token:      "tok",
			getFn:      func(context.Context, string) (*drivemodel.ShareToken, error) { return validShare(7), nil },
			driveFn:    func(context.Context, int64) (*drivemodel.Drive, error) { return nil, nil },
			wantStatus: http.StatusNotFound,
			wantErr:    "shared drive no longer exists",
		},
		{
			name:       "drive_lookup_error",
			token:      "tok",
			getFn:      func(context.Context, string) (*drivemodel.ShareToken, error) { return validShare(7), nil },
			driveFn:    func(context.Context, int64) (*drivemodel.Drive, error) { return nil, errors.New("boom") },
			wantStatus: http.StatusNotFound,
			wantErr:    "shared drive no longer exists",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &ShareHandler{
				shareRepo:   &fakeShareStore{getFn: tt.getFn},
				driveRepo:   &fakeDriveStore{driveFn: tt.driveFn},
				posRepo:     &fakePositionStore{},
				vehicleRepo: &fakeVehicleStore{},
			}
			params := map[string]string{}
			if !tt.omitParam {
				params["token"] = tt.token
			}
			rec := httptest.NewRecorder()
			h.GetPublicShare(rec, newRequest(t, http.MethodGet, "/share/"+tt.token, nil, params))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if got := decodeError(t, rec)["error"]; !strings.Contains(got, tt.wantErr) {
				t.Fatalf("error = %q, want contains %q", got, tt.wantErr)
			}
		})
	}
}

// TestGetPublicShare_IncrementViewsErrorStillSucceeds proves the view-counter
// write is best-effort: a failure is logged, not fatal.
func TestGetPublicShare_IncrementViewsErrorStillSucceeds(t *testing.T) {
	store := &fakeShareStore{
		getFn: func(context.Context, string) (*drivemodel.ShareToken, error) { return validShare(7), nil },
		incFn: func(context.Context, int64) error { return errors.New("redis down") },
	}
	h := &ShareHandler{
		shareRepo:   store,
		driveRepo:   &fakeDriveStore{driveFn: func(context.Context, int64) (*drivemodel.Drive, error) { return completedDrive(7, 42), nil }},
		posRepo:     &fakePositionStore{},
		vehicleRepo: &fakeVehicleStore{},
	}
	rec := httptest.NewRecorder()
	h.GetPublicShare(rec, newRequest(t, http.MethodGet, "/share/tok", nil, map[string]string{"token": "tok"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if store.incCalls != 1 {
		t.Fatalf("IncrementViews calls = %d, want 1", store.incCalls)
	}
	if store.incID != 1 {
		t.Fatalf("IncrementViews id = %d, want 1 (share.ID)", store.incID)
	}
}

// TestGetPublicShare_SuccessFullPayload exercises the happy path with map,
// elevation, and speed profiles plus vehicle info, PII filtering, efficiency,
// and cache headers.
func TestGetPublicShare_SuccessFullPayload(t *testing.T) {
	positions := buildPositions(9)
	for i := 3; i < 6; i++ {
		positions[i].ElevationM = ptrF64(100 + float64(i))
		positions[i].SpeedMph = ptrF64(20 + float64(i))
	}
	share := validShare(7)
	share.Title = ptrStr("Weekend Trip")
	share.Description = ptrStr("Coast road")

	posStore := &fakePositionStore{listFn: func(context.Context, int64, time.Time, time.Time) ([]telemetrymodel.Position, error) {
		return positions, nil
	}}
	h := &ShareHandler{
		shareRepo: &fakeShareStore{getFn: func(context.Context, string) (*drivemodel.ShareToken, error) { return share, nil }},
		driveRepo: &fakeDriveStore{driveFn: func(context.Context, int64) (*drivemodel.Drive, error) { return completedDrive(7, 42), nil }},
		posRepo:   posStore,
		vehicleRepo: &fakeVehicleStore{vehicleFn: func(context.Context, int64) (*vehiclemodel.Vehicle, error) {
			return &vehiclemodel.Vehicle{Model: ptrStr("Model 3"), Color: ptrStr("Red")}, nil
		}},
	}
	rec := httptest.NewRecorder()
	h.GetPublicShare(rec, newRequest(t, http.MethodGet, "/share/tok", nil, map[string]string{"token": "tok"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=300" {
		t.Fatalf("Cache-Control = %q, want 'public, max-age=300'", cc)
	}

	var resp publicShareResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, rec.Body.String())
	}
	if resp.PayloadVersion != "v2" {
		t.Fatalf("PayloadVersion = %q, want 'v2'", resp.PayloadVersion)
	}
	if resp.Title != "Weekend Trip" || resp.Description != "Coast road" {
		t.Fatalf("title/description = %q/%q", resp.Title, resp.Description)
	}
	if resp.Drive.Date != "2026-03-15" {
		t.Fatalf("Drive.Date = %q, want '2026-03-15'", resp.Drive.Date)
	}
	if resp.Drive.DistanceM != 12000 || resp.Drive.DurationS != 1800 {
		t.Fatalf("Drive distance/duration = %v/%v", resp.Drive.DistanceM, resp.Drive.DurationS)
	}
	if resp.Drive.StartAddress != "123 Start St" || resp.Drive.EndAddress != "456 End Ave" {
		t.Fatalf("addresses = %q/%q", resp.Drive.StartAddress, resp.Drive.EndAddress)
	}
	if resp.Drive.MaxSpeedMps == nil || *resp.Drive.MaxSpeedMps != 30 {
		t.Fatalf("MaxSpeedMps = %v, want 30 (IncludeSpeed on)", resp.Drive.MaxSpeedMps)
	}
	if resp.Drive.AvgSpeedMps == nil || *resp.Drive.AvgSpeedMps != 15 {
		t.Fatalf("AvgSpeedMps = %v, want 15", resp.Drive.AvgSpeedMps)
	}
	// Efficiency: battUsed=20, dist=12000 → 20/12000*100*750 = 125 Wh/m.
	if resp.Drive.EfficiencyWhM == nil || !approx(*resp.Drive.EfficiencyWhM, 125, 1e-6) {
		t.Fatalf("EfficiencyWhM = %v, want ~125", resp.Drive.EfficiencyWhM)
	}
	if resp.Vehicle == nil || resp.Vehicle.Model != "Model 3" || resp.Vehicle.Color != "Red" {
		t.Fatalf("Vehicle = %+v, want Model 3 / Red", resp.Vehicle)
	}
	if len(resp.MapPoints) != 3 {
		t.Fatalf("MapPoints = %d, want 3 (clipped)", len(resp.MapPoints))
	}
	if len(resp.ElevationProfile) != 3 {
		t.Fatalf("ElevationProfile = %d, want 3", len(resp.ElevationProfile))
	}
	if len(resp.SpeedProfile) != 3 {
		t.Fatalf("SpeedProfile = %d, want 3", len(resp.SpeedProfile))
	}
	// Position lister must be scoped to the drive's vehicle.
	if posStore.gotID != 42 {
		t.Fatalf("ListByVehicle vehicleID = %d, want 42", posStore.gotID)
	}

	// PII filtering: no VIN or vehicle_id leaks into the public payload, and
	// the raw start coordinates (positions[0..2]) are clipped out.
	body := rec.Body.String()
	for _, forbidden := range []string{"vehicle_id", "\"vin\"", "start_lat", "end_lat"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("public payload leaked %q: %s", forbidden, body)
		}
	}
	if resp.MapPoints[0].Lat != positions[3].Latitude {
		t.Fatalf("first map point not clipped: got %v, want %v", resp.MapPoints[0].Lat, positions[3].Latitude)
	}
}

// TestGetPublicShare_SpeedExcludedWhenFlagOff verifies IncludeSpeed=false hides
// both the summary speeds and the speed profile.
func TestGetPublicShare_SpeedExcludedWhenFlagOff(t *testing.T) {
	share := validShare(7)
	share.IncludeSpeed = false
	share.IncludeMap = true
	positions := buildPositions(9)
	for i := 3; i < 6; i++ {
		positions[i].SpeedMph = ptrF64(25)
		positions[i].ElevationM = ptrF64(50)
	}
	h := &ShareHandler{
		shareRepo: &fakeShareStore{getFn: func(context.Context, string) (*drivemodel.ShareToken, error) { return share, nil }},
		driveRepo: &fakeDriveStore{driveFn: func(context.Context, int64) (*drivemodel.Drive, error) { return completedDrive(7, 42), nil }},
		posRepo: &fakePositionStore{listFn: func(context.Context, int64, time.Time, time.Time) ([]telemetrymodel.Position, error) {
			return positions, nil
		}},
		vehicleRepo: &fakeVehicleStore{},
	}
	rec := httptest.NewRecorder()
	h.GetPublicShare(rec, newRequest(t, http.MethodGet, "/share/tok", nil, map[string]string{"token": "tok"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var resp publicShareResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Drive.MaxSpeedMps != nil || resp.Drive.AvgSpeedMps != nil {
		t.Fatalf("speeds should be omitted when IncludeSpeed false: max=%v avg=%v", resp.Drive.MaxSpeedMps, resp.Drive.AvgSpeedMps)
	}
	if len(resp.SpeedProfile) != 0 {
		t.Fatalf("SpeedProfile = %d, want 0 when IncludeSpeed false", len(resp.SpeedProfile))
	}
	// Map + elevation still populate.
	if len(resp.MapPoints) != 3 || len(resp.ElevationProfile) != 3 {
		t.Fatalf("map/elevation = %d/%d, want 3/3", len(resp.MapPoints), len(resp.ElevationProfile))
	}
	// Vehicle omitted when the store returns nil.
	if resp.Vehicle != nil {
		t.Fatalf("Vehicle = %+v, want nil (store returned nil)", resp.Vehicle)
	}
}

// TestGetPublicShare_EfficiencyEdgeCases covers the three guards on the
// approximate efficiency computation.
func TestGetPublicShare_EfficiencyEdgeCases(t *testing.T) {
	tests := []struct {
		name      string
		mutate    func(d *drivemodel.Drive)
		wantEffOK bool
	}{
		{
			name:      "short_drive_no_efficiency",
			mutate:    func(d *drivemodel.Drive) { d.DistanceM = 1500 }, // <= 2000
			wantEffOK: false,
		},
		{
			name:      "no_battery_change_no_efficiency",
			mutate:    func(d *drivemodel.Drive) { d.EndBatteryPct = ptrI16(90) }, // battUsed == 0
			wantEffOK: false,
		},
		{
			name:      "battery_gain_no_efficiency",
			mutate:    func(d *drivemodel.Drive) { d.EndBatteryPct = ptrI16(95) }, // battUsed < 0
			wantEffOK: false,
		},
		{
			name:      "nil_start_battery_no_efficiency",
			mutate:    func(d *drivemodel.Drive) { d.StartBatteryPct = nil },
			wantEffOK: false,
		},
		{
			name:      "valid_efficiency",
			mutate:    func(d *drivemodel.Drive) {},
			wantEffOK: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			drive := completedDrive(7, 42)
			tt.mutate(drive)
			share := validShare(7)
			share.IncludeMap = false
			h := &ShareHandler{
				shareRepo:   &fakeShareStore{getFn: func(context.Context, string) (*drivemodel.ShareToken, error) { return share, nil }},
				driveRepo:   &fakeDriveStore{driveFn: func(context.Context, int64) (*drivemodel.Drive, error) { return drive, nil }},
				posRepo:     &fakePositionStore{},
				vehicleRepo: &fakeVehicleStore{},
			}
			rec := httptest.NewRecorder()
			h.GetPublicShare(rec, newRequest(t, http.MethodGet, "/share/tok", nil, map[string]string{"token": "tok"}))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			var resp publicShareResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if (resp.Drive.EfficiencyWhM != nil) != tt.wantEffOK {
				t.Fatalf("EfficiencyWhM present = %v, want %v (val=%v)", resp.Drive.EfficiencyWhM != nil, tt.wantEffOK, resp.Drive.EfficiencyWhM)
			}
		})
	}
}

// TestGetPublicShare_InProgressDriveNoProfiles verifies that an in-progress
// drive (EndTs nil) skips profile building even with IncludeMap set.
func TestGetPublicShare_InProgressDriveNoProfiles(t *testing.T) {
	drive := completedDrive(7, 42)
	drive.EndTs = nil // in-progress
	posStore := &fakePositionStore{listFn: func(context.Context, int64, time.Time, time.Time) ([]telemetrymodel.Position, error) {
		t.Fatal("ListByVehicle must not be called for an in-progress drive")
		return nil, nil
	}}
	h := &ShareHandler{
		shareRepo:   &fakeShareStore{getFn: func(context.Context, string) (*drivemodel.ShareToken, error) { return validShare(7), nil }},
		driveRepo:   &fakeDriveStore{driveFn: func(context.Context, int64) (*drivemodel.Drive, error) { return drive, nil }},
		posRepo:     posStore,
		vehicleRepo: &fakeVehicleStore{},
	}
	rec := httptest.NewRecorder()
	h.GetPublicShare(rec, newRequest(t, http.MethodGet, "/share/tok", nil, map[string]string{"token": "tok"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var resp publicShareResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.MapPoints) != 0 {
		t.Fatalf("MapPoints = %d, want 0 for in-progress drive", len(resp.MapPoints))
	}
	if posStore.calls != 0 {
		t.Fatalf("position lister calls = %d, want 0", posStore.calls)
	}
}

// TestGetPublicShare_DefaultTitleWhenNil confirms the fallback title when the
// share carries no explicit title.
func TestGetPublicShare_DefaultTitleWhenNil(t *testing.T) {
	share := validShare(7)
	share.Title = nil
	share.IncludeMap = false
	h := &ShareHandler{
		shareRepo:   &fakeShareStore{getFn: func(context.Context, string) (*drivemodel.ShareToken, error) { return share, nil }},
		driveRepo:   &fakeDriveStore{driveFn: func(context.Context, int64) (*drivemodel.Drive, error) { return completedDrive(7, 42), nil }},
		posRepo:     &fakePositionStore{},
		vehicleRepo: &fakeVehicleStore{},
	}
	rec := httptest.NewRecorder()
	h.GetPublicShare(rec, newRequest(t, http.MethodGet, "/share/tok", nil, map[string]string{"token": "tok"}))

	var resp publicShareResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Title != "Shared Drive" {
		t.Fatalf("Title = %q, want default 'Shared Drive'", resp.Title)
	}
}

// TestGetPublicShare_VehicleLookupErrorIgnored ensures a vehicle-repo failure
// degrades gracefully (no vehicle block) rather than failing the request.
func TestGetPublicShare_VehicleLookupErrorIgnored(t *testing.T) {
	share := validShare(7)
	share.IncludeMap = false
	h := &ShareHandler{
		shareRepo:   &fakeShareStore{getFn: func(context.Context, string) (*drivemodel.ShareToken, error) { return share, nil }},
		driveRepo:   &fakeDriveStore{driveFn: func(context.Context, int64) (*drivemodel.Drive, error) { return completedDrive(7, 42), nil }},
		posRepo:     &fakePositionStore{},
		vehicleRepo: &fakeVehicleStore{vehicleFn: func(context.Context, int64) (*vehiclemodel.Vehicle, error) { return nil, errors.New("vehicle db down") }},
	}
	rec := httptest.NewRecorder()
	h.GetPublicShare(rec, newRequest(t, http.MethodGet, "/share/tok", nil, map[string]string{"token": "tok"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var resp publicShareResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Vehicle != nil {
		t.Fatalf("Vehicle = %+v, want nil on lookup error", resp.Vehicle)
	}
}
