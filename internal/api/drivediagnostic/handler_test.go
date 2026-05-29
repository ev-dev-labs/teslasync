// Drive diagnostic handler tests.
//
// Verifies:
//   - 503 when driveRepo or diagRepo nil
//   - 400 on invalid driveID
//   - 404 when drive not found
//   - 400 on bad window
//   - 200 happy path for ended drive
//   - 200 in-progress drive returns end_ts null but window populated

package drivediagnostic

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	"github.com/go-chi/chi/v5"

	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
)

// ----- fakes ------------------------------------------------------

type fakeDriveLookup struct {
	drive *drivemodel.Drive
	err   error

	gotID int64
}

func (f *fakeDriveLookup) GetByID(_ context.Context, id int64) (*drivemodel.Drive, error) {
	f.gotID = id
	return f.drive, f.err
}

type fakeDriveDiagReader struct {
	transitions []drivedb.DriveDiagnosticTransition
	signals     []drivedb.DriveDiagnosticSignal
	errTrans    error
	errSigs     error

	gotTransVehicleID int64
	gotSigsVehicleID  int64
	gotTransWindow    time.Duration
	gotSigsWindow     time.Duration
	gotSigsFields     []string
}

func (f *fakeDriveDiagReader) TransitionsAround(_ context.Context, vid int64, _ time.Time, w time.Duration) ([]drivedb.DriveDiagnosticTransition, error) {
	f.gotTransVehicleID = vid
	f.gotTransWindow = w
	return f.transitions, f.errTrans
}

func (f *fakeDriveDiagReader) SignalsAround(_ context.Context, vid int64, _ time.Time, w time.Duration, fields []string) ([]drivedb.DriveDiagnosticSignal, error) {
	f.gotSigsVehicleID = vid
	f.gotSigsWindow = w
	f.gotSigsFields = append([]string(nil), fields...)
	return f.signals, f.errSigs
}

// ----- routing helper --------------------------------------------

func mountDriveDiagnostic(h *Handler) http.Handler {
	r := chi.NewRouter()
	r.Get("/drives/{driveID}/why-ended", h.Get)
	return r
}

// ----- tests -----------------------------------------------------

func TestHandler_NilRepos_Returns503(t *testing.T) {
	t.Parallel()
	h := NewHandler(nil, nil)
	srv := httptest.NewServer(mountDriveDiagnostic(h))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/drives/1/why-ended")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", resp.StatusCode)
	}
}

func TestHandler_BadDriveID(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name string
		id   string
	}{
		{"non_numeric", "abc"},
		{"zero", "0"},
		{"negative", "-1"},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			drv := &fakeDriveLookup{}
			diag := &fakeDriveDiagReader{}
			h := newHandlerForTest(drv, diag)
			srv := httptest.NewServer(mountDriveDiagnostic(h))
			defer srv.Close()
			resp, err := http.Get(srv.URL + "/drives/" + tc.id + "/why-ended")
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d", resp.StatusCode)
			}
			if drv.gotID != 0 {
				t.Fatalf("drive repo should not be called on invalid id")
			}
		})
	}
}

func TestHandler_DriveNotFound_Returns404(t *testing.T) {
	t.Parallel()
	drv := &fakeDriveLookup{drive: nil}
	diag := &fakeDriveDiagReader{}
	h := newHandlerForTest(drv, diag)
	srv := httptest.NewServer(mountDriveDiagnostic(h))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/drives/999/why-ended")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
	if drv.gotID != 999 {
		t.Fatalf("drive repo got wrong id: %d", drv.gotID)
	}
	if diag.gotTransVehicleID != 0 {
		t.Fatalf("diag repo must not be called when drive not found")
	}
}

func TestHandler_DriveRepoErr_Returns500(t *testing.T) {
	t.Parallel()
	drv := &fakeDriveLookup{err: errors.New("db down")}
	diag := &fakeDriveDiagReader{}
	h := newHandlerForTest(drv, diag)
	srv := httptest.NewServer(mountDriveDiagnostic(h))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/drives/1/why-ended")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.StatusCode)
	}
}

func TestHandler_BadWindow_Returns400(t *testing.T) {
	t.Parallel()
	start := time.Now().UTC().Add(-1 * time.Hour)
	end := time.Now().UTC().Add(-5 * time.Minute)
	drv := &fakeDriveLookup{drive: &drivemodel.Drive{ID: 1, VehicleID: 7, StartTs: start, EndTs: &end}}
	diag := &fakeDriveDiagReader{}
	h := newHandlerForTest(drv, diag)
	srv := httptest.NewServer(mountDriveDiagnostic(h))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/drives/1/why-ended?window=bogus")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestHandler_HappyPath_EndedDrive(t *testing.T) {
	t.Parallel()
	start := time.Now().UTC().Add(-1 * time.Hour)
	end := time.Now().UTC().Add(-5 * time.Minute)
	endedStatus := "completed"
	drv := &fakeDriveLookup{drive: &drivemodel.Drive{
		ID:          42,
		VehicleID:   7,
		StartTs:     start,
		EndTs:       &end,
		EndedStatus: &endedStatus,
	}}
	diag := &fakeDriveDiagReader{
		transitions: []drivedb.DriveDiagnosticTransition{
			{ID: 1, TS: end.Add(-2 * time.Second), FSMName: "vehicle", FromState: "drive", ToState: "parked", Trigger: "Gear=P"},
		},
		signals: []drivedb.DriveDiagnosticSignal{
			{TS: end.Add(-1 * time.Second), Field: "Gear", Value: "P"},
			{TS: end.Add(-3 * time.Second), Field: "VehicleSpeed", Value: "0"},
		},
	}
	h := newHandlerForTest(drv, diag)
	srv := httptest.NewServer(mountDriveDiagnostic(h))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/drives/42/why-ended?window=60s")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var body DriveDiagnosticResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.DriveID != 42 || body.VehicleID != 7 {
		t.Fatalf("identity mismatch: %+v", body)
	}
	if body.EndTs == nil {
		t.Fatalf("ended drive must have end_ts populated")
	}
	if body.EndedStatus == nil || *body.EndedStatus != "completed" {
		t.Fatalf("expected ended_status=completed, got %v", body.EndedStatus)
	}
	if body.Window != "60s" {
		t.Fatalf("window round-trip: %s", body.Window)
	}
	if len(body.FSMTransitions) != 1 {
		t.Fatalf("expected 1 transition, got %d", len(body.FSMTransitions))
	}
	if len(body.SignalWindow) != 2 {
		t.Fatalf("expected 2 signals, got %d", len(body.SignalWindow))
	}
	if diag.gotTransVehicleID != 7 || diag.gotSigsVehicleID != 7 {
		t.Fatalf("diag repo got wrong vehicle id: trans=%d sigs=%d", diag.gotTransVehicleID, diag.gotSigsVehicleID)
	}
	if diag.gotTransWindow != 60*time.Second {
		t.Fatalf("trans window mismatch: %v", diag.gotTransWindow)
	}
	if len(diag.gotSigsFields) == 0 {
		t.Fatalf("expected signal field whitelist to be passed")
	}
}

func TestHandler_HappyPath_InProgressDrive(t *testing.T) {
	t.Parallel()
	start := time.Now().UTC().Add(-30 * time.Minute)
	drv := &fakeDriveLookup{drive: &drivemodel.Drive{
		ID:        7,
		VehicleID: 1,
		StartTs:   start,
		EndTs:     nil, // in progress
	}}
	diag := &fakeDriveDiagReader{
		transitions: []drivedb.DriveDiagnosticTransition{},
		signals:     []drivedb.DriveDiagnosticSignal{},
	}
	h := newHandlerForTest(drv, diag)
	srv := httptest.NewServer(mountDriveDiagnostic(h))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/drives/7/why-ended")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var body DriveDiagnosticResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.EndTs != nil {
		t.Fatalf("in-progress drive must have end_ts null; got %v", *body.EndTs)
	}
	if body.EndedStatus != nil {
		t.Fatalf("in-progress drive must have ended_status null")
	}
	// Diag repos must still be called using NOW as the anchor.
	if diag.gotTransVehicleID != 1 {
		t.Fatalf("diag repo not called for in-progress drive")
	}
}

func TestHandler_DiagRepoErr_Returns500(t *testing.T) {
	t.Parallel()
	start := time.Now().UTC().Add(-1 * time.Hour)
	end := time.Now().UTC().Add(-5 * time.Minute)
	drv := &fakeDriveLookup{drive: &drivemodel.Drive{ID: 1, VehicleID: 1, StartTs: start, EndTs: &end}}
	diag := &fakeDriveDiagReader{errTrans: errors.New("hypertable busy")}
	h := newHandlerForTest(drv, diag)
	srv := httptest.NewServer(mountDriveDiagnostic(h))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/drives/1/why-ended")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.StatusCode)
	}
}
