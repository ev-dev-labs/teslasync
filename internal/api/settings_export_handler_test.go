package api

// Phase-46 / Prompt 36 — settings export handler tests.
//
// Exercises the GET /settings/export response shape using fake repos
// that satisfy the SettingsSerializer interfaces. No live database is
// required.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// fakeSettingsRepo is a minimal in-memory replacement for *database.SettingsRepo.
type fakeSettingsRepo struct {
	current  *models.Settings
	upserted *models.Settings
	getErr   error
	upErr    error
}

func (f *fakeSettingsRepo) Get(_ context.Context) (*models.Settings, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	if f.current == nil {
		return &models.Settings{}, nil
	}
	cp := *f.current
	return &cp, nil
}

func (f *fakeSettingsRepo) Upsert(_ context.Context, s *models.Settings) error {
	if f.upErr != nil {
		return f.upErr
	}
	cp := *s
	f.upserted = &cp
	f.current = &cp
	return nil
}

// fakeAlertRepo mirrors the SettingsSerializerAlertRepo surface.
type fakeAlertRepo struct {
	rules     []*models.AlertRule
	created   []*models.AlertRule
	updated   map[int64]*models.AlertRule
	listErr   error
	createErr error
	updateErr error
	nextID    int64
}

func (f *fakeAlertRepo) GetAll(_ context.Context) ([]*models.AlertRule, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	out := make([]*models.AlertRule, 0, len(f.rules))
	for _, r := range f.rules {
		cp := *r
		out = append(out, &cp)
	}
	return out, nil
}

func (f *fakeAlertRepo) Create(_ context.Context, rule *models.AlertRule) error {
	if f.createErr != nil {
		return f.createErr
	}
	f.nextID++
	rule.ID = f.nextID
	rule.CreatedAt = time.Now().UTC()
	rule.UpdatedAt = rule.CreatedAt
	cp := *rule
	f.created = append(f.created, &cp)
	f.rules = append(f.rules, &cp)
	return nil
}

func (f *fakeAlertRepo) Update(_ context.Context, id int64, rule *models.AlertRule) error {
	if f.updateErr != nil {
		return f.updateErr
	}
	if f.updated == nil {
		f.updated = map[int64]*models.AlertRule{}
	}
	cp := *rule
	cp.ID = id
	f.updated[id] = &cp
	for i, r := range f.rules {
		if r.ID == id {
			f.rules[i] = &cp
		}
	}
	return nil
}

// fakeGeofenceRepo mirrors the SettingsSerializerGeofenceRepo surface.
type fakeGeofenceRepo struct {
	geofences []*models.Geofence
	created   []*models.Geofence
	updated   map[int64]*models.Geofence
	listErr   error
	createErr error
	updateErr error
	nextID    int64
}

func (f *fakeGeofenceRepo) GetAll(_ context.Context) ([]*models.Geofence, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	out := make([]*models.Geofence, 0, len(f.geofences))
	for _, g := range f.geofences {
		cp := *g
		out = append(out, &cp)
	}
	return out, nil
}

func (f *fakeGeofenceRepo) Create(_ context.Context, g *models.Geofence) error {
	if f.createErr != nil {
		return f.createErr
	}
	f.nextID++
	g.ID = f.nextID
	g.CreatedAt = time.Now().UTC()
	g.UpdatedAt = g.CreatedAt
	cp := *g
	f.created = append(f.created, &cp)
	f.geofences = append(f.geofences, &cp)
	return nil
}

func (f *fakeGeofenceRepo) Update(_ context.Context, g *models.Geofence) error {
	if f.updateErr != nil {
		return f.updateErr
	}
	if f.updated == nil {
		f.updated = map[int64]*models.Geofence{}
	}
	cp := *g
	f.updated[g.ID] = &cp
	for i, gf := range f.geofences {
		if gf.ID == g.ID {
			f.geofences[i] = &cp
		}
	}
	return nil
}

// fakeQuietHoursRepo mirrors the SettingsSerializerQuietHoursRepo surface.
type fakeQuietHoursRepo struct {
	byUser    map[string][]*models.QuietHoursWindow
	inserted  []*models.QuietHoursWindow
	updated   map[int64]*models.QuietHoursWindow
	listErr   error
	insertErr error
	updateErr error
	nextID    int64
}

func (f *fakeQuietHoursRepo) ListByUser(_ context.Context, userID string) ([]*models.QuietHoursWindow, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	if f.byUser == nil {
		return []*models.QuietHoursWindow{}, nil
	}
	out := make([]*models.QuietHoursWindow, 0, len(f.byUser[userID]))
	for _, w := range f.byUser[userID] {
		cp := *w
		out = append(out, &cp)
	}
	return out, nil
}

func (f *fakeQuietHoursRepo) Insert(_ context.Context, userID string, in database.QuietHoursInput) (*models.QuietHoursWindow, error) {
	if f.insertErr != nil {
		return nil, f.insertErr
	}
	f.nextID++
	w := &models.QuietHoursWindow{
		ID:               f.nextID,
		UserID:           userID,
		Enabled:          true,
		Weekdays:         models.QuietHoursWeekdayAll,
		BypassSeverities: []string{"critical"},
		CreatedAt:        time.Now().UTC(),
		UpdatedAt:        time.Now().UTC(),
	}
	if in.Enabled != nil {
		w.Enabled = *in.Enabled
	}
	if in.StartLocal != nil {
		w.StartLocal = *in.StartLocal
	}
	if in.EndLocal != nil {
		w.EndLocal = *in.EndLocal
	}
	if in.Timezone != nil {
		w.Timezone = *in.Timezone
	}
	if in.Weekdays != nil {
		w.Weekdays = *in.Weekdays
	}
	if in.BypassSeverities != nil {
		w.BypassSeverities = *in.BypassSeverities
	}
	if f.byUser == nil {
		f.byUser = map[string][]*models.QuietHoursWindow{}
	}
	cp := *w
	f.byUser[userID] = append(f.byUser[userID], &cp)
	f.inserted = append(f.inserted, &cp)
	return w, nil
}

func (f *fakeQuietHoursRepo) Update(_ context.Context, userID string, id int64, in database.QuietHoursInput) (*models.QuietHoursWindow, error) {
	if f.updateErr != nil {
		return nil, f.updateErr
	}
	if f.updated == nil {
		f.updated = map[int64]*models.QuietHoursWindow{}
	}
	for _, w := range f.byUser[userID] {
		if w.ID == id {
			if in.Enabled != nil {
				w.Enabled = *in.Enabled
			}
			if in.StartLocal != nil {
				w.StartLocal = *in.StartLocal
			}
			if in.EndLocal != nil {
				w.EndLocal = *in.EndLocal
			}
			if in.Timezone != nil {
				w.Timezone = *in.Timezone
			}
			if in.Weekdays != nil {
				w.Weekdays = *in.Weekdays
			}
			if in.BypassSeverities != nil {
				w.BypassSeverities = *in.BypassSeverities
			}
			cp := *w
			f.updated[id] = &cp
			return w, nil
		}
	}
	return nil, errors.New("not found")
}

// newTestSettingsSerializer builds a serializer wired to fresh fakes.
func newTestSettingsSerializer() (*database.SettingsSerializer, *fakeSettingsRepo, *fakeAlertRepo, *fakeGeofenceRepo, *fakeQuietHoursRepo) {
	s := &fakeSettingsRepo{}
	a := &fakeAlertRepo{}
	g := &fakeGeofenceRepo{}
	q := &fakeQuietHoursRepo{}
	return database.NewSettingsSerializer(s, a, g, q), s, a, g, q
}

// fixedSeverity is a helper to build a *string pointer inline.
func sptr(s string) *string { return &s }
func iptr(v int64) *int64   { return &v }

func TestSettingsExportHandler_Export_ReturnsBundleWithAllSections(t *testing.T) {
	cat := models.GeofenceCategoryHome
	ser, settings, alerts, geofences, quiet := newTestSettingsSerializer()
	settings.current = &models.Settings{
		UnitOfLength:   "mi",
		UnitOfTemp:     "F",
		UnitOfPressure: "psi",
		PreferredRange: "rated",
		Language:       "en",
		Theme:          "neon-cyan",
		Mode:           "dark",
	}
	alerts.rules = []*models.AlertRule{
		{ID: 1, Name: "Battery Low", SignalName: "battery_level", Op: "<",
			ValueNum: func() *float64 { v := 20.0; return &v }(),
			Severity: "warn", CooldownMin: 30, TriggerMode: "repeat", Kind: "signal", Enabled: true},
	}
	geofences.geofences = []*models.Geofence{
		{ID: 1, Name: "Home", PolygonWKT: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))", Category: &cat},
	}
	quiet.byUser = map[string][]*models.QuietHoursWindow{
		"alice@example.com": {
			{ID: 1, UserID: "alice@example.com", Enabled: true, StartLocal: "22:00",
				EndLocal: "07:00", Timezone: "UTC", Weekdays: models.QuietHoursWeekdayAll,
				BypassSeverities: []string{"critical"}},
		},
	}

	h := NewSettingsExportHandler(ser, "X-Forwarded-User")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings/export", nil)
	req.Header.Set("X-Forwarded-User", "alice@example.com")
	rec := httptest.NewRecorder()

	h.Export(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("content-type: got %q", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment; filename=\"teslasync-settings-") {
		t.Fatalf("content-disposition: got %q", cd)
	}

	var bundle database.SettingsBundle
	if err := json.Unmarshal(rec.Body.Bytes(), &bundle); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if bundle.SchemaVersion != database.SettingsBundleSchemaVersion {
		t.Errorf("schema_version: got %d", bundle.SchemaVersion)
	}
	if bundle.ExportedAt.IsZero() {
		t.Error("exported_at: must be set")
	}
	if bundle.Sections.Settings == nil || bundle.Sections.Settings.UnitOfLength != "mi" {
		t.Errorf("settings section missing or wrong: %+v", bundle.Sections.Settings)
	}
	if len(bundle.Sections.AlertRules) != 1 || bundle.Sections.AlertRules[0].Name != "Battery Low" {
		t.Errorf("alert_rules section: %+v", bundle.Sections.AlertRules)
	}
	if len(bundle.Sections.Geofences) != 1 || bundle.Sections.Geofences[0].Name != "Home" {
		t.Errorf("geofences section: %+v", bundle.Sections.Geofences)
	}
	if len(bundle.Sections.QuietHours) != 1 {
		t.Errorf("quiet_hours section length: %d", len(bundle.Sections.QuietHours))
	}
}

func TestSettingsExportHandler_Export_NoSensitiveFieldsLeak(t *testing.T) {
	// Belt-and-braces: even if a future change adds sensitive fields
	// to one of the underlying models, this canary fires before they
	// hit the wire.
	ser, settings, alerts, geofences, quiet := newTestSettingsSerializer()
	settings.current = &models.Settings{UnitOfLength: "mi"}
	alerts.rules = []*models.AlertRule{}
	geofences.geofences = []*models.Geofence{}
	quiet.byUser = map[string][]*models.QuietHoursWindow{"u": {}}

	h := NewSettingsExportHandler(ser, "X-Forwarded-User")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings/export", nil)
	req.Header.Set("X-Forwarded-User", "u")
	rec := httptest.NewRecorder()
	h.Export(rec, req)

	body := rec.Body.String()
	for _, banned := range []string{
		"refresh_token", "access_token", "client_secret", "client_id",
		"smtp_password", "bot_token", "auth_token", "api_token",
		"webhook_url", "totp_secret", "password_hash", "encrypted_secret",
	} {
		if strings.Contains(body, banned) {
			t.Errorf("sensitive token leak: bundle contains %q\n---\n%s\n---", banned, body)
		}
	}
}

func TestSettingsExportHandler_Export_ScopesQuietHoursPerUser(t *testing.T) {
	ser, settings, alerts, geofences, quiet := newTestSettingsSerializer()
	settings.current = &models.Settings{}
	alerts.rules = []*models.AlertRule{}
	geofences.geofences = []*models.Geofence{}
	quiet.byUser = map[string][]*models.QuietHoursWindow{
		"alice@example.com": {{ID: 1, UserID: "alice@example.com", StartLocal: "22:00", EndLocal: "07:00", Timezone: "UTC"}},
		"bob@example.com":   {{ID: 2, UserID: "bob@example.com", StartLocal: "23:00", EndLocal: "06:00", Timezone: "UTC"}},
	}

	h := NewSettingsExportHandler(ser, "X-Forwarded-User")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings/export", nil)
	req.Header.Set("X-Forwarded-User", "alice@example.com")
	rec := httptest.NewRecorder()
	h.Export(rec, req)

	var bundle database.SettingsBundle
	if err := json.Unmarshal(rec.Body.Bytes(), &bundle); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(bundle.Sections.QuietHours) != 1 || bundle.Sections.QuietHours[0].UserID != "alice@example.com" {
		t.Errorf("quiet_hours not scoped to alice: %+v", bundle.Sections.QuietHours)
	}
}

func TestSettingsExportHandler_Export_NilSerializer(t *testing.T) {
	h := NewSettingsExportHandler(nil, "")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings/export", nil)
	rec := httptest.NewRecorder()
	h.Export(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("nil serializer: got %d, want 500", rec.Code)
	}
}

func TestSettingsExportHandler_Export_RepoError(t *testing.T) {
	ser, settings, _, _, _ := newTestSettingsSerializer()
	settings.getErr = errors.New("db down")

	h := NewSettingsExportHandler(ser, "")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings/export", nil)
	rec := httptest.NewRecorder()
	h.Export(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("repo error: got %d, want 500", rec.Code)
	}
}
