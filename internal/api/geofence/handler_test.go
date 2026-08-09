package geofence

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/api/apperror"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/go-chi/chi/v5"
)

func TestCircleToPolygonWKT_RoundTripsCenterAndRadius(t *testing.T) {
	const (
		lat    = 47.819844
		lon    = -122.208886
		radius = 100.0
	)
	wkt := systemmodel.CircleToPolygonWKT(lat, lon, radius)
	if !strings.HasPrefix(wkt, "POLYGON((") || !strings.HasSuffix(wkt, "))") {
		t.Fatalf("WKT not well-formed: %q", wkt)
	}

	g, _, err := decodeGeofenceWriteBody(bytes.NewReader([]byte(`{
		"name":"Test","latitude":47.819844,"longitude":-122.208886,"radius":100
	}`)))
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if g.PolygonWKT == "" {
		t.Fatal("decoder did not synthesize polygon_wkt from circle inputs")
	}

	gotLat, gotLon := g.Centroid()
	if math.Abs(gotLat-lat) > 1e-3 {
		t.Errorf("round-trip latitude drift: want %.6f got %.6f", lat, gotLat)
	}
	if math.Abs(gotLon-lon) > 1e-3 {
		t.Errorf("round-trip longitude drift: want %.6f got %.6f", lon, gotLon)
	}
	gotRadius := g.Radius()
	if gotRadius < radius*0.95 || gotRadius > radius*1.05 {
		t.Errorf("round-trip radius drift: want ~%.0f got %.2f", radius, gotRadius)
	}
}

// TestDecodeGeofenceWriteBody_AcceptsLegacyPolygonWKT ensures non-web
// callers that already produce WKT keep working unchanged.
func TestDecodeGeofenceWriteBody_AcceptsLegacyPolygonWKT(t *testing.T) {
	wkt := "POLYGON((0 0,1 0,1 1,0 1,0 0))"
	body := []byte(`{"name":"Box","polygon_wkt":"` + wkt + `"}`)
	g, _, err := decodeGeofenceWriteBody(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if g.PolygonWKT != wkt {
		t.Errorf("polygon_wkt not preserved: want %q got %q", wkt, g.PolygonWKT)
	}
}

// TestDecodeGeofenceWriteBody_CirclePrecedence — when both shapes are
// supplied the circle wins. This makes the web-client write path
// deterministic regardless of any stale `polygon_wkt` the form may carry.
func TestDecodeGeofenceWriteBody_CirclePrecedence(t *testing.T) {
	body := []byte(`{
		"name":"Mixed",
		"polygon_wkt":"POLYGON((0 0,1 0,1 1,0 1,0 0))",
		"latitude":47.0,"longitude":-122.0,"radius":50
	}`)
	g, _, err := decodeGeofenceWriteBody(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !strings.Contains(g.PolygonWKT, "POLYGON((") {
		t.Fatalf("polygon_wkt malformed: %q", g.PolygonWKT)
	}
	gotLat, _ := g.Centroid()
	if math.Abs(gotLat-47.0) > 1e-3 {
		t.Errorf("circle inputs were ignored — centroid lat=%.6f, expected ~47.0", gotLat)
	}
}

// TestGeofence_MarshalJSON_EmitsCircleFields locks in the response shape
// the web Geofence interface depends on (`latitude`, `longitude`, `radius`
// alongside `polygon_wkt`).
func TestGeofence_MarshalJSON_EmitsCircleFields(t *testing.T) {
	g, _, err := decodeGeofenceWriteBody(bytes.NewReader([]byte(`{
		"name":"Round","latitude":40.0,"longitude":-74.0,"radius":250
	}`)))
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	raw, err := json.Marshal(g)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	for _, key := range []string{"latitude", "longitude", "radius", "polygon_wkt"} {
		if _, ok := out[key]; !ok {
			t.Errorf("response missing key %q (have %v)", key, keysOf(out))
		}
	}
	if r, _ := out["radius"].(float64); r < 200 || r > 300 {
		t.Errorf("response radius=%.2f, expected ~250", r)
	}
}

func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// ---------------------------------------------------------------------------
// Phase: 000192 alert-flag merge tests
// ---------------------------------------------------------------------------

// TestDecodeGeofenceWriteBody_ParsesCamelCaseFlags pins that the web-client
// payload spelling — alertOnEntry / alertOnExit / enabled — is honored
// verbatim. These three field names are the ones GeofencesPage.tsx sends
// today via toGeofencePayload(); a regression here is the silent-save bug.
func TestDecodeGeofenceWriteBody_ParsesCamelCaseFlags(t *testing.T) {
	body := []byte(`{
		"name":"Home",
		"latitude":40.0,"longitude":-74.0,"radius":100,
		"enabled":true,
		"alertOnEntry":true,
		"alertOnExit":false
	}`)
	_, raw, err := decodeGeofenceWriteBody(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if raw.Enabled == nil || !*raw.Enabled {
		t.Errorf("enabled not parsed: got %v", raw.Enabled)
	}
	if raw.AlertOnEntry == nil || !*raw.AlertOnEntry {
		t.Errorf("alertOnEntry not parsed: got %v", raw.AlertOnEntry)
	}
	if raw.AlertOnExit == nil || *raw.AlertOnExit {
		t.Errorf("alertOnExit not parsed: got %v", raw.AlertOnExit)
	}
}

// TestDecodeGeofenceWriteBody_SnakeCaseAliasFlows ensures curl/import-bundle
// callers that author the snake_case spelling still work.
func TestDecodeGeofenceWriteBody_SnakeCaseAliasFlows(t *testing.T) {
	body := []byte(`{
		"name":"Work",
		"latitude":40.0,"longitude":-74.0,"radius":100,
		"alert_on_entry":true,
		"alert_on_exit":true
	}`)
	_, raw, err := decodeGeofenceWriteBody(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if raw.AlertOnEntry == nil || !*raw.AlertOnEntry {
		t.Errorf("alert_on_entry alias not coalesced: got %v", raw.AlertOnEntry)
	}
	if raw.AlertOnExit == nil || !*raw.AlertOnExit {
		t.Errorf("alert_on_exit alias not coalesced: got %v", raw.AlertOnExit)
	}
}

// TestDecodeGeofenceWriteBody_CamelCaseWinsOnConflict locks the documented
// precedence rule from the geofenceCreateRequest godoc.
func TestDecodeGeofenceWriteBody_CamelCaseWinsOnConflict(t *testing.T) {
	body := []byte(`{
		"name":"Conflict",
		"latitude":40.0,"longitude":-74.0,"radius":100,
		"alertOnEntry":false,
		"alert_on_entry":true
	}`)
	_, raw, err := decodeGeofenceWriteBody(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if raw.AlertOnEntry == nil || *raw.AlertOnEntry {
		t.Errorf("camelCase precedence broken: alertOnEntry=%v", raw.AlertOnEntry)
	}
}

// ---------------------------------------------------------------------------
// Update merge-semantics tests
//
// GeofenceHandler.geofenceRepo is a concrete *geofencedb.GeofenceRepo — we
// can't substitute a fake at the public seam. runGeofenceUpdateMerge
// inlines the Update body 1:1 against fakeGeofenceUpdateRepo so we get
// behavior coverage without standing up Postgres.
//
// DRIFT RISK: any logic change in GeofenceHandler.Update MUST be mirrored
// here or these tests silently start covering dead code.
// ---------------------------------------------------------------------------

type fakeGeofenceUpdateRepo struct {
	stored        *systemmodel.Geofence
	getByIDErr    error
	getByIDResult *systemmodel.Geofence
	updateErr     error
	updateCalls   int
	lastUpdate    *systemmodel.Geofence
}

func (f *fakeGeofenceUpdateRepo) GetByID(_ context.Context, _ int64) (*systemmodel.Geofence, error) {
	if f.getByIDErr != nil {
		return nil, f.getByIDErr
	}
	return f.getByIDResult, nil
}
func (f *fakeGeofenceUpdateRepo) Update(_ context.Context, g *systemmodel.Geofence) error {
	f.updateCalls++
	if f.updateErr != nil {
		return f.updateErr
	}
	cp := *g
	f.lastUpdate = &cp
	f.stored = &cp
	return nil
}

func runGeofenceUpdateMerge(t *testing.T, repo *fakeGeofenceUpdateRepo, id int64, body io.Reader) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPut, "/api/v1/geofences/1", body)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("geofenceID", "1")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))

	// MIRROR of GeofenceHandler.Update — see DRIFT RISK above.
	patch, raw, err := decodeGeofenceWriteBody(r.Body)
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidJSON)
		return w
	}
	existing, err := repo.GetByID(r.Context(), id)
	if err != nil {
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to load geofence"))
		return w
	}
	if existing == nil {
		apperror.Write(w, r, apperror.ErrGeofenceNotFound)
		return w
	}
	merged := *existing
	if patch.Name != "" {
		merged.Name = patch.Name
	}
	if patch.PolygonWKT != "" {
		merged.PolygonWKT = patch.PolygonWKT
	}
	if patch.Category != nil {
		merged.Category = patch.Category
	}
	if raw.Enabled != nil {
		merged.Enabled = *raw.Enabled
	}
	if raw.AlertOnEntry != nil {
		merged.AlertOnEntry = *raw.AlertOnEntry
	}
	if raw.AlertOnExit != nil {
		merged.AlertOnExit = *raw.AlertOnExit
	}
	merged.ID = id
	if merged.Name == "" || merged.Radius() <= 0 {
		apperror.Write(w, r, apperror.ErrMissingField.WithMessage("name and positive radius required"))
		return w
	}
	if err := validateGeofence(&merged); err != nil {
		apperror.Write(w, r, apperror.ErrGeofenceInvalidCoords.WithMessage(err.Error()))
		return w
	}
	if err := repo.Update(r.Context(), &merged); err != nil {
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to update geofence"))
		return w
	}
	httpx.WriteJSON(w, http.StatusOK, &merged)
	return w
}

func basePersistedGeofence() *systemmodel.Geofence {
	return &systemmodel.Geofence{
		ID:           1,
		Name:         "Home",
		PolygonWKT:   "POLYGON((-74.0 40.0,-74.001 40.0,-74.001 40.001,-74.0 40.001,-74.0 40.0))",
		Enabled:      false,
		AlertOnEntry: false,
		AlertOnExit:  false,
	}
}

// TestGeofenceUpdate_TogglePreservesNameAndPolygon — the toggle row sends
// only `{enabled: true}` (or false). Without merge semantics this used to
// blank the name + polygon, fail validation, and silently 400.
func TestGeofenceUpdate_TogglePreservesNameAndPolygon(t *testing.T) {
	repo := &fakeGeofenceUpdateRepo{getByIDResult: basePersistedGeofence()}
	body := bytes.NewReader([]byte(`{"enabled":true}`))
	w := runGeofenceUpdateMerge(t, repo, 1, body)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if repo.lastUpdate == nil {
		t.Fatal("Update was not called")
	}
	if !repo.lastUpdate.Enabled {
		t.Error("enabled flag was not flipped on")
	}
	if repo.lastUpdate.Name != "Home" {
		t.Errorf("name was wiped: got %q", repo.lastUpdate.Name)
	}
	if !strings.Contains(repo.lastUpdate.PolygonWKT, "POLYGON((") {
		t.Errorf("polygon was wiped: got %q", repo.lastUpdate.PolygonWKT)
	}
}

// TestGeofenceUpdate_FullModalPersistsFlags — the modal sends a complete
// payload including all three flags plus circle geometry. This is the
// happy path the user reports as broken in the screenshots.
func TestGeofenceUpdate_FullModalPersistsFlags(t *testing.T) {
	repo := &fakeGeofenceUpdateRepo{getByIDResult: basePersistedGeofence()}
	body := bytes.NewReader([]byte(`{
		"name":"Home",
		"latitude":40.0,"longitude":-74.0,"radius":100,
		"enabled":true,
		"alertOnEntry":true,
		"alertOnExit":true
	}`))
	w := runGeofenceUpdateMerge(t, repo, 1, body)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if !repo.lastUpdate.Enabled || !repo.lastUpdate.AlertOnEntry || !repo.lastUpdate.AlertOnExit {
		t.Errorf("flags not persisted: %+v", repo.lastUpdate)
	}
}

// TestGeofenceUpdate_TurnFlagsOff — explicit `false` (a non-nil pointer)
// must overlay; this is distinct from "field omitted" which preserves.
func TestGeofenceUpdate_TurnFlagsOff(t *testing.T) {
	existing := basePersistedGeofence()
	existing.Enabled = true
	existing.AlertOnEntry = true
	existing.AlertOnExit = true
	repo := &fakeGeofenceUpdateRepo{getByIDResult: existing}
	body := bytes.NewReader([]byte(`{
		"enabled":false,
		"alertOnEntry":false,
		"alertOnExit":false
	}`))
	w := runGeofenceUpdateMerge(t, repo, 1, body)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if repo.lastUpdate.Enabled || repo.lastUpdate.AlertOnEntry || repo.lastUpdate.AlertOnExit {
		t.Errorf("flags not turned off: %+v", repo.lastUpdate)
	}
}

// TestGeofenceUpdate_OmittedFlagsPreserved — flags absent from the payload
// MUST keep the persisted value, not coerce to zero.
func TestGeofenceUpdate_OmittedFlagsPreserved(t *testing.T) {
	existing := basePersistedGeofence()
	existing.Enabled = true
	existing.AlertOnEntry = true
	repo := &fakeGeofenceUpdateRepo{getByIDResult: existing}
	body := bytes.NewReader([]byte(`{"name":"HomeRenamed"}`))
	w := runGeofenceUpdateMerge(t, repo, 1, body)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if repo.lastUpdate.Name != "HomeRenamed" {
		t.Errorf("name not updated: got %q", repo.lastUpdate.Name)
	}
	if !repo.lastUpdate.Enabled {
		t.Error("enabled was wiped by omission — merge broken")
	}
	if !repo.lastUpdate.AlertOnEntry {
		t.Error("alertOnEntry was wiped by omission — merge broken")
	}
}

// TestGeofenceUpdate_404OnMissingRow — Update against an unknown ID must
// 404 cleanly without calling the writer.
func TestGeofenceUpdate_404OnMissingRow(t *testing.T) {
	repo := &fakeGeofenceUpdateRepo{getByIDResult: nil}
	body := bytes.NewReader([]byte(`{"enabled":true}`))
	w := runGeofenceUpdateMerge(t, repo, 99, body)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", w.Code, w.Body.String())
	}
	if repo.updateCalls != 0 {
		t.Errorf("Update was called %d times despite 404", repo.updateCalls)
	}
}

// TestGeofenceUpdate_500OnLoadFailure — surface a load error as 500 and
// do not attempt the write.
func TestGeofenceUpdate_500OnLoadFailure(t *testing.T) {
	repo := &fakeGeofenceUpdateRepo{getByIDErr: errors.New("db down")}
	body := bytes.NewReader([]byte(`{"enabled":true}`))
	w := runGeofenceUpdateMerge(t, repo, 1, body)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", w.Code, w.Body.String())
	}
	if repo.updateCalls != 0 {
		t.Errorf("Update was called %d times despite load failure", repo.updateCalls)
	}
}
