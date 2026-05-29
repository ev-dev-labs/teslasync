package settings

// Phase-46 / Prompt 36 — settings import handler tests.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// buildBundle is a helper to create a SettingsBundle for tests.
func buildBundle(version int) *settingsdb.SettingsBundle {
	return &settingsdb.SettingsBundle{
		SchemaVersion: version,
		ExportedAt:    time.Now().UTC(),
		Sections: settingsdb.SettingsBundleSections{
			Settings: &systemmodel.Settings{
				UnitOfLength:   "mi",
				UnitOfTemp:     "F",
				UnitOfPressure: "psi",
				PreferredRange: "rated",
				Language:       "en",
				Theme:          "neon-cyan",
				Mode:           "dark",
			},
			AlertRules: []*alertmodel.AlertRule{
				{Name: "Battery Low", SignalName: "battery_level", Op: "<",
					Severity: "warn", CooldownMin: 30, TriggerMode: "repeat", Kind: "signal", Enabled: true},
			},
			Geofences: []*systemmodel.Geofence{
				{Name: "Home", PolygonWKT: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))"},
			},
			QuietHours: []*models.QuietHoursWindow{
				{Enabled: true, StartLocal: "22:00", EndLocal: "07:00", Timezone: "UTC",
					Weekdays: models.QuietHoursWeekdayAll, BypassSeverities: []string{"critical"}},
			},
		},
	}
}

func postSettingsImport(t *testing.T, h *SettingsImportHandler, body any, user string) *httptest.ResponseRecorder {
	t.Helper()
	buf, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/import", bytes.NewReader(buf))
	req.Header.Set("Content-Type", "application/json")
	if user != "" {
		req.Header.Set("X-Forwarded-User", user)
	}
	rec := httptest.NewRecorder()
	h.Import(rec, req)
	return rec
}

func TestSettingsImportHandler_DryRun_PreviewsAddsWithoutWriting(t *testing.T) {
	ser, settings, alerts, geofences, quiet := newTestSettingsSerializer()
	settings.current = &systemmodel.Settings{}
	bundle := buildBundle(settingsdb.SettingsBundleSchemaVersion)
	h := NewSettingsImportHandler(ser, "X-Forwarded-User")

	rec := postSettingsImport(t, h, map[string]any{"dry_run": true, "bundle": bundle}, "alice@example.com")
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var result settingsdb.ImportResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !result.DryRun {
		t.Error("dry_run flag must round-trip")
	}
	// Each non-settings section reports 1 added; settings reports 1 updated.
	if got, want := result.Sections["alert_rules"].Added, 1; got != want {
		t.Errorf("alert_rules.added: got %d, want %d", got, want)
	}
	if got, want := result.Sections["geofences"].Added, 1; got != want {
		t.Errorf("geofences.added: got %d, want %d", got, want)
	}
	if got, want := result.Sections["quiet_hours"].Added, 1; got != want {
		t.Errorf("quiet_hours.added: got %d, want %d", got, want)
	}

	// Crucially: no writes happened.
	if alerts.created != nil || alerts.updated != nil {
		t.Errorf("dry_run leaked writes to alert repo: created=%v updated=%v", alerts.created, alerts.updated)
	}
	if geofences.created != nil || geofences.updated != nil {
		t.Errorf("dry_run leaked writes to geofence repo: created=%v updated=%v", geofences.created, geofences.updated)
	}
	if quiet.inserted != nil || quiet.updated != nil {
		t.Errorf("dry_run leaked writes to quiet_hours repo: inserted=%v updated=%v", quiet.inserted, quiet.updated)
	}
	if settings.upserted != nil {
		t.Errorf("dry_run leaked write to settings repo: %+v", settings.upserted)
	}
}

func TestSettingsImportHandler_Apply_PersistsAcrossSections(t *testing.T) {
	ser, settings, alerts, geofences, quiet := newTestSettingsSerializer()
	settings.current = &systemmodel.Settings{}
	bundle := buildBundle(settingsdb.SettingsBundleSchemaVersion)
	h := NewSettingsImportHandler(ser, "X-Forwarded-User")

	rec := postSettingsImport(t, h, map[string]any{"dry_run": false, "bundle": bundle}, "alice@example.com")
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if settings.upserted == nil || settings.upserted.UnitOfLength != "mi" {
		t.Errorf("settings.upsert not called or wrong: %+v", settings.upserted)
	}
	if len(alerts.created) != 1 {
		t.Errorf("alerts.create: got %d", len(alerts.created))
	}
	if len(geofences.created) != 1 {
		t.Errorf("geofences.create: got %d", len(geofences.created))
	}
	if len(quiet.inserted) != 1 {
		t.Errorf("quiet_hours.insert: got %d", len(quiet.inserted))
	}
}

func TestSettingsImportHandler_RoundTrip_ExportThenImportYieldsSkip(t *testing.T) {
	// Export -> reimport same bundle -> every section reports skipped=N
	// (no behaviour change, no writes). Models the "save backup, restore
	// on the same install" UX.
	ser, settings, alerts, geofences, quiet := newTestSettingsSerializer()
	settings.current = &systemmodel.Settings{
		UnitOfLength: "mi", UnitOfTemp: "F", UnitOfPressure: "psi",
		PreferredRange: "rated", Language: "en", Theme: "neon-cyan", Mode: "dark",
	}
	alerts.rules = []*alertmodel.AlertRule{
		{ID: 1, Name: "Battery Low", SignalName: "battery_level", Op: "<",
			Severity: "warn", CooldownMin: 30, TriggerMode: "repeat", Kind: "signal", Enabled: true},
	}
	geofences.geofences = []*systemmodel.Geofence{
		{ID: 1, Name: "Home", PolygonWKT: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))"},
	}
	quiet.byUser = map[string][]*models.QuietHoursWindow{
		"alice@example.com": {
			{ID: 1, UserID: "alice@example.com", Enabled: true, StartLocal: "22:00",
				EndLocal: "07:00", Timezone: "UTC", Weekdays: models.QuietHoursWeekdayAll,
				BypassSeverities: []string{"critical"}},
		},
	}

	// Export
	bundle, err := ser.ExportSettings(context.Background(), "alice@example.com")
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	// Reimport (apply mode)
	h := NewSettingsImportHandler(ser, "X-Forwarded-User")
	rec := postSettingsImport(t, h, map[string]any{"dry_run": false, "bundle": bundle}, "alice@example.com")
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var result settingsdb.ImportResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, sec := range []string{"settings", "alert_rules", "geofences", "quiet_hours"} {
		r := result.Sections[sec]
		if r.Added != 0 || r.Updated != 0 {
			t.Errorf("section %s: round-trip should be a no-op; got %+v", sec, r)
		}
		if r.Skipped != 1 {
			t.Errorf("section %s: skipped count: got %d, want 1", sec, r.Skipped)
		}
	}
}

func TestSettingsImportHandler_RejectsUnsupportedSchemaVersion(t *testing.T) {
	ser, settings, _, _, _ := newTestSettingsSerializer()
	settings.current = &systemmodel.Settings{}
	h := NewSettingsImportHandler(ser, "")

	for _, v := range []int{0, 999, -1} {
		bundle := buildBundle(v)
		rec := postSettingsImport(t, h, map[string]any{"dry_run": true, "bundle": bundle}, "")
		if rec.Code != http.StatusBadRequest {
			t.Errorf("schema_version=%d: got %d, want 400; body=%s", v, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "schema_version") {
			t.Errorf("schema_version=%d: body should mention schema_version; got %s", v, rec.Body.String())
		}
	}
}

func TestSettingsImportHandler_RejectsMissingBundle(t *testing.T) {
	ser, _, _, _, _ := newTestSettingsSerializer()
	h := NewSettingsImportHandler(ser, "")

	rec := postSettingsImport(t, h, map[string]any{"dry_run": true}, "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing bundle: got %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestSettingsImportHandler_RejectsEmptyBody(t *testing.T) {
	ser, _, _, _, _ := newTestSettingsSerializer()
	h := NewSettingsImportHandler(ser, "")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/import", strings.NewReader(""))
	rec := httptest.NewRecorder()
	h.Import(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty body: got %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestSettingsImportHandler_RejectsUnknownFields(t *testing.T) {
	ser, _, _, _, _ := newTestSettingsSerializer()
	h := NewSettingsImportHandler(ser, "")

	body := []byte(`{"dry_run": true, "bundle": {"schema_version": 1, "exported_at": "2024-01-01T00:00:00Z", "sections": {}}, "extra": "no"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/import", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.Import(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown fields: got %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestSettingsImportHandler_NilSerializer(t *testing.T) {
	h := NewSettingsImportHandler(nil, "")
	rec := postSettingsImport(t, h, map[string]any{"dry_run": true, "bundle": buildBundle(1)}, "")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("nil serializer: got %d, want 500", rec.Code)
	}
}

func TestSettingsImportHandler_BodyTooLarge(t *testing.T) {
	ser, _, _, _, _ := newTestSettingsSerializer()
	h := NewSettingsImportHandler(ser, "")
	// Build a payload > MaxSettingsImportBodyBytes by stuffing the
	// bundle's sections.alert_rules with many copies of a long rule.
	payload := bytes.Repeat([]byte("a"), int(MaxSettingsImportBodyBytes+1024))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/import", bytes.NewReader(payload))
	rec := httptest.NewRecorder()
	h.Import(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("oversize body: got %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}
