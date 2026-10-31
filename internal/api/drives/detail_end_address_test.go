package drives

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
)

// The drive detail response must never present the start address as the
// destination. Each endpoint's address comes from its own coordinates;
// a stored end label identical to the start label while the endpoints
// are far apart is suppressed so the client shows the end coordinates /
// unavailable state instead.

const (
	detailStartAddr = "19720 Bothell Everett Highway, Bothell"
	detailEndAddr   = "1 Microsoft Way, Redmond"
)

func getDriveDetail(t *testing.T, drive *drivemodel.Drive) map[string]interface{} {
	t.Helper()
	h := &driveDetailHandler{
		DriveHandler: &DriveHandler{},
		state:        &fakeStateReader{},
		drives:       &fakeDriveByIDFetcher{drive: drive},
	}
	rec := httptest.NewRecorder()
	h.Get(rec, newDriveDetailRequest(t, "555", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("Get status = %d, body %s", rec.Code, rec.Body.String())
	}
	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return body
}

func addressedDrive(startAddr, endAddr string, endLat, endLon float64) *drivemodel.Drive {
	t0 := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	t1 := t0.Add(40 * time.Minute)
	// Canyon Park, Bothell -> Redmond.
	startLat, startLon := 47.8060, -122.2050
	return &drivemodel.Drive{
		ID: 555, VehicleID: 42, StartTs: t0, EndTs: &t1,
		StartAddress: &startAddr, EndAddress: &endAddr,
		StartLat: &startLat, StartLon: &startLon,
		EndLat: &endLat, EndLon: &endLon,
	}
}

func TestDriveDetail_EndAddressFromOwnCoordinates(t *testing.T) {
	body := getDriveDetail(t, addressedDrive(detailStartAddr, detailEndAddr, 47.6740, -122.1215))
	if body["start_address"] != detailStartAddr {
		t.Errorf("start_address = %v, want %q", body["start_address"], detailStartAddr)
	}
	if body["end_address"] != detailEndAddr {
		t.Errorf("end_address = %v, want %q (resolved from end coordinates)", body["end_address"], detailEndAddr)
	}
}

func TestDriveDetail_DuplicateEndAddressSuppressed(t *testing.T) {
	body := getDriveDetail(t, addressedDrive(detailStartAddr, detailStartAddr, 47.6740, -122.1215))
	if body["start_address"] != detailStartAddr {
		t.Errorf("start_address = %v, want %q", body["start_address"], detailStartAddr)
	}
	if body["end_address"] != nil {
		t.Errorf("end_address = %v, want nil (unavailable) — never the start address", body["end_address"])
	}
	// End coordinates remain so the client can show them.
	if body["end_lat"] == nil || body["end_lon"] == nil {
		t.Errorf("end coordinates missing: %v / %v", body["end_lat"], body["end_lon"])
	}
}

func TestDriveDetail_RoundTripSameAddressKept(t *testing.T) {
	body := getDriveDetail(t, addressedDrive(detailStartAddr, detailStartAddr, 47.8061, -122.2050))
	if body["end_address"] != detailStartAddr {
		t.Errorf("end_address = %v, want %q for a genuine round trip", body["end_address"], detailStartAddr)
	}
}
