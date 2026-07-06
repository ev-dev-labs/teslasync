package importer

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
)

// ---------------------------------------------------------------------------
// Test doubles for the narrow ports declared in handler.go.
// ---------------------------------------------------------------------------

type fakeDriveCreator struct {
	created []*drivemodel.Drive
	failAll error
	failVeh int64 // when non-zero, Create fails for this vehicle id only
}

func (f *fakeDriveCreator) Create(_ context.Context, d *drivemodel.Drive) error {
	if f.failAll != nil {
		return f.failAll
	}
	if f.failVeh != 0 && d.VehicleID == f.failVeh {
		return errors.New("forced drive create failure")
	}
	f.created = append(f.created, d)
	return nil
}

type fakeChargingCreator struct {
	created []*chargingmodel.ChargingSession
	failAll error
	failVeh int64
}

func (f *fakeChargingCreator) Create(_ context.Context, c *chargingmodel.ChargingSession) error {
	if f.failAll != nil {
		return f.failAll
	}
	if f.failVeh != 0 && c.VehicleID == f.failVeh {
		return errors.New("forced charging create failure")
	}
	f.created = append(f.created, c)
	return nil
}

type fakeNotificationLogFetcher struct {
	logs      []*notificationmodel.NotificationLog
	err       error
	gotLimit  int
	gotOffset int
	calls     int
}

func (f *fakeNotificationLogFetcher) GetLogs(_ context.Context, limit, offset int) ([]*notificationmodel.NotificationLog, error) {
	f.calls++
	f.gotLimit, f.gotOffset = limit, offset
	return f.logs, f.err
}

// Compile-time proof the fakes satisfy the same ports the concrete repos do.
var (
	_ driveCreator           = (*fakeDriveCreator)(nil)
	_ chargingCreator        = (*fakeChargingCreator)(nil)
	_ notificationLogFetcher = (*fakeNotificationLogFetcher)(nil)
)

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

// multipartCSV builds a multipart/form-data POST whose single part carries the
// given CSV content under the supplied form field name.
func multipartCSV(t *testing.T, field, content string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile(field, "upload.csv")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fw.Write([]byte(content)); err != nil {
		t.Fatalf("write content: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/import", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

func decodeCounts(t *testing.T, body []byte) map[string]int {
	t.Helper()
	var m map[string]int
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("unmarshal counts: %v; body=%s", err, string(body))
	}
	return m
}

func approxEqual(a, b float64) bool {
	return math.Abs(a-b) <= 1e-6*math.Max(1, math.Max(math.Abs(a), math.Abs(b)))
}

func ts(t *testing.T, s string) time.Time {
	t.Helper()
	parsed, err := time.Parse("2006-01-02T15:04:05Z", s)
	if err != nil {
		t.Fatalf("parse fixture time %q: %v", s, err)
	}
	return parsed
}

// ---------------------------------------------------------------------------
// ImportDrives — success + precise unit conversion.
// ---------------------------------------------------------------------------

func TestImportDrives_Success_ConvertsToSI(t *testing.T) {
	csvBody := strings.Join([]string{
		"vehicle_id,start_ts,end_ts,distance_mi,duration_min,max_speed_mph",
		"42,2026-01-02T10:00:00Z,2026-01-02T10:30:00Z,10,30,60",
		"7,2026-02-03T08:00:00Z,,5,15,0",
	}, "\n")

	fake := &fakeDriveCreator{}
	h := &ImportHandler{driveRepo: fake}

	rec := httptest.NewRecorder()
	h.ImportDrives(rec, multipartCSV(t, "file", csvBody))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	counts := decodeCounts(t, rec.Body.Bytes())
	if counts["imported"] != 2 || counts["errors"] != 0 {
		t.Fatalf("counts = %+v, want imported=2 errors=0", counts)
	}
	if len(fake.created) != 2 {
		t.Fatalf("created %d drives, want 2", len(fake.created))
	}

	// Row 1: 10 mi → meters, 30 min → seconds, 60 mph → m/s, end_ts present.
	d0 := fake.created[0]
	if d0.VehicleID != 42 {
		t.Errorf("d0.VehicleID = %d, want 42", d0.VehicleID)
	}
	if !approxEqual(d0.DistanceM, 10*1609.344) {
		t.Errorf("d0.DistanceM = %f, want %f (10 mi in m)", d0.DistanceM, 10*1609.344)
	}
	if d0.DurationS != 1800 {
		t.Errorf("d0.DurationS = %d, want 1800 (30 min in s)", d0.DurationS)
	}
	if d0.MaxSpeedMps == nil || !approxEqual(*d0.MaxSpeedMps, 60*0.44704) {
		t.Errorf("d0.MaxSpeedMps = %v, want %f (60 mph in m/s)", d0.MaxSpeedMps, 60*0.44704)
	}
	if d0.EndTs == nil || !d0.EndTs.Equal(ts(t, "2026-01-02T10:30:00Z")) {
		t.Errorf("d0.EndTs = %v, want 2026-01-02T10:30:00Z", d0.EndTs)
	}
	if !d0.StartTs.Equal(ts(t, "2026-01-02T10:00:00Z")) {
		t.Errorf("d0.StartTs = %v, want 2026-01-02T10:00:00Z", d0.StartTs)
	}

	// Row 2: zero max speed leaves MaxSpeedMps nil; missing end_ts leaves EndTs nil.
	d1 := fake.created[1]
	if d1.MaxSpeedMps != nil {
		t.Errorf("d1.MaxSpeedMps = %v, want nil when max_speed_mph is 0", *d1.MaxSpeedMps)
	}
	if d1.EndTs != nil {
		t.Errorf("d1.EndTs = %v, want nil when end_ts is blank", *d1.EndTs)
	}
	if !approxEqual(d1.DistanceM, 5*1609.344) {
		t.Errorf("d1.DistanceM = %f, want %f", d1.DistanceM, 5*1609.344)
	}
	if d1.DurationS != 900 {
		t.Errorf("d1.DurationS = %d, want 900", d1.DurationS)
	}
}

func TestImportDrives_RowErrors(t *testing.T) {
	const hdr = "vehicle_id,start_ts,end_ts,distance_mi,duration_min,max_speed_mph"
	good := "42,2026-01-02T10:00:00Z,2026-01-02T10:30:00Z,10,30,60"

	tests := []struct {
		name         string
		rows         []string
		wantImported int
		wantErrors   int
	}{
		{"bad vehicle_id", []string{"abc,2026-01-02T10:00:00Z,,10,30,60"}, 0, 1},
		{"bad start_ts", []string{"42,notadate,,10,30,60"}, 0, 1},
		{"bad distance", []string{"42,2026-01-02T10:00:00Z,,nope,30,60"}, 0, 1},
		{"bad duration", []string{"42,2026-01-02T10:00:00Z,,10,nope,60"}, 0, 1},
		{"bad max_speed is ignored", []string{"42,2026-01-02T10:00:00Z,,10,30,nope"}, 1, 0},
		{"wrong field count", []string{good, "7,2026-01-02T11:00:00Z,,5,15"}, 1, 1},
		{"good and bad mixed", []string{good, "abc,2026-01-02T10:00:00Z,,10,30,60"}, 1, 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body := hdr + "\n" + strings.Join(tc.rows, "\n")
			fake := &fakeDriveCreator{}
			h := &ImportHandler{driveRepo: fake}

			rec := httptest.NewRecorder()
			h.ImportDrives(rec, multipartCSV(t, "file", body))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			counts := decodeCounts(t, rec.Body.Bytes())
			if counts["imported"] != tc.wantImported {
				t.Errorf("imported = %d, want %d", counts["imported"], tc.wantImported)
			}
			if counts["errors"] != tc.wantErrors {
				t.Errorf("errors = %d, want %d", counts["errors"], tc.wantErrors)
			}
			if len(fake.created) != tc.wantImported {
				t.Errorf("Create called %d time(s), want %d", len(fake.created), tc.wantImported)
			}
		})
	}
}

func TestImportDrives_ShortRecord(t *testing.T) {
	// Header with < 6 columns keeps csv.Reader's FieldsPerRecord below the
	// handler's minimum, exercising the len(record) < 6 guard.
	body := "a,b,c\n1,2,3\n"
	fake := &fakeDriveCreator{}
	h := &ImportHandler{driveRepo: fake}

	rec := httptest.NewRecorder()
	h.ImportDrives(rec, multipartCSV(t, "file", body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	counts := decodeCounts(t, rec.Body.Bytes())
	if counts["imported"] != 0 || counts["errors"] != 1 {
		t.Fatalf("counts = %+v, want imported=0 errors=1", counts)
	}
}

func TestImportDrives_CreateError(t *testing.T) {
	body := strings.Join([]string{
		"vehicle_id,start_ts,end_ts,distance_mi,duration_min,max_speed_mph",
		"42,2026-01-02T10:00:00Z,,10,30,60",
		"7,2026-01-02T11:00:00Z,,5,15,20",
	}, "\n")
	fake := &fakeDriveCreator{failVeh: 42}
	h := &ImportHandler{driveRepo: fake}

	rec := httptest.NewRecorder()
	h.ImportDrives(rec, multipartCSV(t, "file", body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	counts := decodeCounts(t, rec.Body.Bytes())
	if counts["imported"] != 1 || counts["errors"] != 1 {
		t.Fatalf("counts = %+v, want imported=1 errors=1 (vehicle 42 fails)", counts)
	}
	if len(fake.created) != 1 || fake.created[0].VehicleID != 7 {
		t.Fatalf("only vehicle 7 should persist; got %+v", fake.created)
	}
}

func TestImportDrives_HeaderOnly(t *testing.T) {
	body := "vehicle_id,start_ts,end_ts,distance_mi,duration_min,max_speed_mph\n"
	fake := &fakeDriveCreator{}
	h := &ImportHandler{driveRepo: fake}

	rec := httptest.NewRecorder()
	h.ImportDrives(rec, multipartCSV(t, "file", body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	counts := decodeCounts(t, rec.Body.Bytes())
	if counts["imported"] != 0 || counts["errors"] != 0 {
		t.Fatalf("counts = %+v, want imported=0 errors=0", counts)
	}
}

// ---------------------------------------------------------------------------
// ImportCharging — success + the kWh→Wh / kW→W conversion contract.
// ---------------------------------------------------------------------------

func TestImportCharging_Success_ConvertsKiloToSI(t *testing.T) {
	csvBody := strings.Join([]string{
		"vehicle_id,start_ts,end_ts,energy_added_kwh,start_battery,end_battery,charger_power_kw_max,duration_min",
		"42,2026-01-02T10:00:00Z,2026-01-02T11:00:00Z,50,20,80,11,60",
		"7,2026-02-03T08:00:00Z,,25,30,,,0",
	}, "\n")

	fake := &fakeChargingCreator{}
	h := &ImportHandler{chargingRepo: fake}

	rec := httptest.NewRecorder()
	h.ImportCharging(rec, multipartCSV(t, "file", csvBody))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	counts := decodeCounts(t, rec.Body.Bytes())
	if counts["imported"] != 2 || counts["errors"] != 0 {
		t.Fatalf("counts = %+v, want imported=2 errors=0", counts)
	}
	if len(fake.created) != 2 {
		t.Fatalf("created %d sessions, want 2", len(fake.created))
	}

	// Row 1: energy 50 kWh → 50000 Wh; power 11 kW → 11000 W (the bug fix).
	c0 := fake.created[0]
	if c0.VehicleID != 42 {
		t.Errorf("c0.VehicleID = %d, want 42", c0.VehicleID)
	}
	if c0.TotalEnergyAddedWh == nil || !approxEqual(*c0.TotalEnergyAddedWh, 50000) {
		t.Errorf("c0.TotalEnergyAddedWh = %v, want 50000 (50 kWh in Wh)", c0.TotalEnergyAddedWh)
	}
	if c0.PeakPowerW == nil || !approxEqual(*c0.PeakPowerW, 11000) {
		t.Errorf("c0.PeakPowerW = %v, want 11000 (11 kW in W)", c0.PeakPowerW)
	}
	if c0.StartSocPct == nil || *c0.StartSocPct != 20 {
		t.Errorf("c0.StartSocPct = %v, want 20", c0.StartSocPct)
	}
	if c0.EndSocPct == nil || *c0.EndSocPct != 80 {
		t.Errorf("c0.EndSocPct = %v, want 80", c0.EndSocPct)
	}
	if c0.EndedAt == nil || !c0.EndedAt.Equal(ts(t, "2026-01-02T11:00:00Z")) {
		t.Errorf("c0.EndedAt = %v, want 2026-01-02T11:00:00Z", c0.EndedAt)
	}

	// Row 2: minimal — blank end_battery/power/end_ts stay nil.
	c1 := fake.created[1]
	if c1.TotalEnergyAddedWh == nil || !approxEqual(*c1.TotalEnergyAddedWh, 25000) {
		t.Errorf("c1.TotalEnergyAddedWh = %v, want 25000", c1.TotalEnergyAddedWh)
	}
	if c1.EndSocPct != nil {
		t.Errorf("c1.EndSocPct = %v, want nil when end_battery blank", *c1.EndSocPct)
	}
	if c1.PeakPowerW != nil {
		t.Errorf("c1.PeakPowerW = %v, want nil when charger_power blank", *c1.PeakPowerW)
	}
	if c1.EndedAt != nil {
		t.Errorf("c1.EndedAt = %v, want nil when end_ts blank", *c1.EndedAt)
	}
}

func TestImportCharging_RowErrors(t *testing.T) {
	const hdr = "vehicle_id,start_ts,end_ts,energy_added_kwh,start_battery,end_battery,charger_power_kw_max,duration_min"
	good := "42,2026-01-02T10:00:00Z,2026-01-02T11:00:00Z,50,20,80,11,60"

	tests := []struct {
		name         string
		rows         []string
		wantImported int
		wantErrors   int
	}{
		{"bad vehicle_id", []string{"abc,2026-01-02T10:00:00Z,,50,20,80,11,60"}, 0, 1},
		{"bad start_ts", []string{"42,notadate,,50,20,80,11,60"}, 0, 1},
		{"bad energy", []string{"42,2026-01-02T10:00:00Z,,nope,20,80,11,60"}, 0, 1},
		{"non-integer start_battery", []string{"42,2026-01-02T10:00:00Z,,50,20.5,80,11,60"}, 0, 1},
		{"wrong field count", []string{good, "7,2026-01-02T11:00:00Z,,25,30"}, 1, 1},
		{"good and bad mixed", []string{good, "abc,2026-01-02T10:00:00Z,,50,20,80,11,60"}, 1, 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body := hdr + "\n" + strings.Join(tc.rows, "\n")
			fake := &fakeChargingCreator{}
			h := &ImportHandler{chargingRepo: fake}

			rec := httptest.NewRecorder()
			h.ImportCharging(rec, multipartCSV(t, "file", body))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			counts := decodeCounts(t, rec.Body.Bytes())
			if counts["imported"] != tc.wantImported {
				t.Errorf("imported = %d, want %d", counts["imported"], tc.wantImported)
			}
			if counts["errors"] != tc.wantErrors {
				t.Errorf("errors = %d, want %d", counts["errors"], tc.wantErrors)
			}
		})
	}
}

func TestImportCharging_ShortRecord(t *testing.T) {
	// Header with < 8 columns exercises the len(record) < 8 guard.
	body := "a,b,c,d\n1,2,3,4\n"
	fake := &fakeChargingCreator{}
	h := &ImportHandler{chargingRepo: fake}

	rec := httptest.NewRecorder()
	h.ImportCharging(rec, multipartCSV(t, "file", body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	counts := decodeCounts(t, rec.Body.Bytes())
	if counts["imported"] != 0 || counts["errors"] != 1 {
		t.Fatalf("counts = %+v, want imported=0 errors=1", counts)
	}
}

func TestImportCharging_CreateError(t *testing.T) {
	body := strings.Join([]string{
		"vehicle_id,start_ts,end_ts,energy_added_kwh,start_battery,end_battery,charger_power_kw_max,duration_min",
		"42,2026-01-02T10:00:00Z,,50,20,80,11,60",
		"7,2026-01-02T11:00:00Z,,25,30,60,7,45",
	}, "\n")
	fake := &fakeChargingCreator{failVeh: 7}
	h := &ImportHandler{chargingRepo: fake}

	rec := httptest.NewRecorder()
	h.ImportCharging(rec, multipartCSV(t, "file", body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	counts := decodeCounts(t, rec.Body.Bytes())
	if counts["imported"] != 1 || counts["errors"] != 1 {
		t.Fatalf("counts = %+v, want imported=1 errors=1 (vehicle 7 fails)", counts)
	}
	if len(fake.created) != 1 || fake.created[0].VehicleID != 42 {
		t.Fatalf("only vehicle 42 should persist; got %+v", fake.created)
	}
}

// ---------------------------------------------------------------------------
// Shared request-level error paths for both import handlers.
// ---------------------------------------------------------------------------

func TestImport_RequestErrors(t *testing.T) {
	notMultipart := func(t *testing.T) *http.Request {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/import", strings.NewReader("x=1"))
		req.Header.Set("Content-Type", "text/plain")
		return req
	}
	missingFile := func(t *testing.T) *http.Request { return multipartCSV(t, "notfile", "data") }
	emptyFile := func(t *testing.T) *http.Request { return multipartCSV(t, "file", "") }

	tests := []struct {
		name    string
		req     func(*testing.T) *http.Request
		wantMsg string
	}{
		{"not multipart", notMultipart, "invalid multipart form"},
		{"missing file field", missingFile, "missing file field"},
		{"empty file header", emptyFile, "unable to read CSV header"},
	}

	invoke := map[string]func(*ImportHandler, http.ResponseWriter, *http.Request){
		"drives":   (*ImportHandler).ImportDrives,
		"charging": (*ImportHandler).ImportCharging,
	}

	for _, tc := range tests {
		for endpoint, call := range invoke {
			t.Run(endpoint+"/"+tc.name, func(t *testing.T) {
				h := &ImportHandler{driveRepo: &fakeDriveCreator{}, chargingRepo: &fakeChargingCreator{}}
				rec := httptest.NewRecorder()
				call(h, rec, tc.req(t))

				if rec.Code != http.StatusBadRequest {
					t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
				}
				var resp map[string]string
				if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
					t.Fatalf("unmarshal error body: %v; body=%s", err, rec.Body.String())
				}
				if resp["error"] != tc.wantMsg {
					t.Errorf("error = %q, want %q", resp["error"], tc.wantMsg)
				}
				if resp["code"] != "BAD_REQUEST" {
					t.Errorf("code = %q, want BAD_REQUEST", resp["code"])
				}
			})
		}
	}
}

// ---------------------------------------------------------------------------
// ExportNotificationLogs.
// ---------------------------------------------------------------------------

func sampleLogs(t *testing.T) []*notificationmodel.NotificationLog {
	t.Helper()
	sent := ts(t, "2026-01-02T10:00:00Z")
	return []*notificationmodel.NotificationLog{
		{
			ID:        7,
			ChannelID: 3,
			Title:     "Battery Alert",
			Message:   "Battery low",
			Status:    "sent",
			Error:     "",
			CreatedAt: ts(t, "2026-01-02T09:00:00Z"),
			SentAt:    &sent,
		},
		{
			ID:        8,
			ChannelID: 4,
			Title:     "Charge Complete",
			Message:   "Done",
			Status:    "failed",
			Error:     "smtp timeout",
			CreatedAt: ts(t, "2026-01-03T09:00:00Z"),
			SentAt:    nil,
		},
	}
}

func TestExportNotificationLogs_CSVDefault(t *testing.T) {
	fetcher := &fakeNotificationLogFetcher{logs: sampleLogs(t)}
	h := exportNotificationLogs(fetcher)

	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/notifications/export", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/csv" {
		t.Errorf("Content-Type = %q, want text/csv", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, "teslasync-notifications.csv") {
		t.Errorf("Content-Disposition = %q, want csv filename", cd)
	}
	if fetcher.gotLimit != 10000 || fetcher.gotOffset != 0 {
		t.Errorf("GetLogs called with limit=%d offset=%d, want 10000/0", fetcher.gotLimit, fetcher.gotOffset)
	}

	rows, err := csv.NewReader(strings.NewReader(rec.Body.String())).ReadAll()
	if err != nil {
		t.Fatalf("parse csv response: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("csv rows = %d, want 3 (header + 2)", len(rows))
	}
	wantHeader := []string{"id", "channel_id", "title", "message", "status", "error", "created_at", "sent_at"}
	for i, h := range wantHeader {
		if rows[0][i] != h {
			t.Errorf("header[%d] = %q, want %q", i, rows[0][i], h)
		}
	}
	want0 := []string{"7", "3", "Battery Alert", "Battery low", "sent", "", "2026-01-02T09:00:00Z", "2026-01-02T10:00:00Z"}
	for i := range want0 {
		if rows[1][i] != want0[i] {
			t.Errorf("row1[%d] = %q, want %q", i, rows[1][i], want0[i])
		}
	}
	// Second row has a nil SentAt → trailing sent_at column must be blank.
	if rows[2][7] != "" {
		t.Errorf("row2 sent_at = %q, want empty for nil SentAt", rows[2][7])
	}
	if rows[2][5] != "smtp timeout" {
		t.Errorf("row2 error = %q, want smtp timeout", rows[2][5])
	}
}

func TestExportNotificationLogs_JSON(t *testing.T) {
	fetcher := &fakeNotificationLogFetcher{logs: sampleLogs(t)}
	h := exportNotificationLogs(fetcher)

	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/notifications/export?format=json", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	// httpx.WriteJSON authoritatively sets the charset-qualified content type,
	// overriding the handler's bare "application/json" — assert the effective value.
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, "teslasync-notifications.json") {
		t.Errorf("Content-Disposition = %q, want json filename", cd)
	}
	var got []*notificationmodel.NotificationLog
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal json: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != 2 {
		t.Fatalf("logs = %d, want 2", len(got))
	}
	if got[0].ID != 7 || got[0].Title != "Battery Alert" {
		t.Errorf("got[0] = %+v, want ID=7 Title=Battery Alert", got[0])
	}
}

func TestExportNotificationLogs_FetchError(t *testing.T) {
	fetcher := &fakeNotificationLogFetcher{err: errors.New("db connection lost")}
	h := exportNotificationLogs(fetcher)

	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/notifications/export", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error body: %v", err)
	}
	if resp["error"] != "failed to fetch notification logs" {
		t.Errorf("error = %q, want failed to fetch notification logs", resp["error"])
	}
	if resp["code"] != "INTERNAL_ERROR" {
		t.Errorf("code = %q, want INTERNAL_ERROR", resp["code"])
	}
}

func TestExportNotificationLogs_NilLogs(t *testing.T) {
	tests := []struct {
		name       string
		target     string
		wantBody   string
		wantHeader string
	}{
		{"csv nil → header only", "/notifications/export", "id,channel_id,title,message,status,error,created_at,sent_at\n", "text/csv"},
		{"json nil → empty array", "/notifications/export?format=json", "[]\n", "application/json; charset=utf-8"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fetcher := &fakeNotificationLogFetcher{logs: nil}
			h := exportNotificationLogs(fetcher)

			rec := httptest.NewRecorder()
			h(rec, httptest.NewRequest(http.MethodGet, tc.target, nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			if ct := rec.Header().Get("Content-Type"); ct != tc.wantHeader {
				t.Errorf("Content-Type = %q, want %q", ct, tc.wantHeader)
			}
			if rec.Body.String() != tc.wantBody {
				t.Errorf("body = %q, want %q", rec.Body.String(), tc.wantBody)
			}
		})
	}
}

func TestExportNotificationLogs_ExplicitCSVFormat(t *testing.T) {
	fetcher := &fakeNotificationLogFetcher{logs: sampleLogs(t)}
	h := exportNotificationLogs(fetcher)

	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/notifications/export?format=csv", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/csv" {
		t.Errorf("Content-Type = %q, want text/csv for explicit format=csv", ct)
	}
}
