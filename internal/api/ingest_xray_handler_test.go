// Phase-44 / observability-batch / Prompt F6 — Ingest X-Ray handler tests.
//
// Exercises the HTTP layer end-to-end through chi using a fake repo
// implementing ingestXRayRepo. Verifies:
//   - 503 when repo nil
//   - 400 on missing/invalid vehicleID, window, bucket
//   - 400 when bucket >= window
//   - 200 happy path including freshness_seconds derivation
//   - 500 when repo errors propagate

package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ----- fake repo --------------------------------------------------

type fakeIngestXRayRepo struct {
	fields      []database.IngestXRayFieldStat
	buckets     []database.IngestXRayBucket
	lastSeen    time.Time
	errFields   error
	errBuckets  error
	errLastSeen error

	gotFieldsVehicleID  int64
	gotBucketsVehicleID int64
	gotLastSeenVehicleID int64
	gotBucketWidth     time.Duration
	gotLimit           int
}

func (f *fakeIngestXRayRepo) FieldStats(_ context.Context, vid int64, _ time.Time, limit int) ([]database.IngestXRayFieldStat, error) {
	f.gotFieldsVehicleID = vid
	f.gotLimit = limit
	return f.fields, f.errFields
}

func (f *fakeIngestXRayRepo) SampleCountByBucket(_ context.Context, vid int64, _ time.Time, w time.Duration) ([]database.IngestXRayBucket, error) {
	f.gotBucketsVehicleID = vid
	f.gotBucketWidth = w
	return f.buckets, f.errBuckets
}

func (f *fakeIngestXRayRepo) LastSeen(_ context.Context, vid int64) (time.Time, error) {
	f.gotLastSeenVehicleID = vid
	return f.lastSeen, f.errLastSeen
}

// ----- routing helper --------------------------------------------

func mountIngestXRay(h *IngestXRayHandler) http.Handler {
	r := chi.NewRouter()
	r.Get("/system/ingest-xray/{vehicleID}", h.Get)
	return r
}

// ----- tests -----------------------------------------------------

func TestIngestXRayHandler_NilRepo_Returns503(t *testing.T) {
	t.Parallel()
	h := NewIngestXRayHandler(nil)
	srv := httptest.NewServer(mountIngestXRay(h))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/system/ingest-xray/1")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", resp.StatusCode)
	}
}

func TestIngestXRayHandler_BadVehicleID(t *testing.T) {
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
			fake := &fakeIngestXRayRepo{}
			h := newIngestXRayHandlerForTest(fake)
			srv := httptest.NewServer(mountIngestXRay(h))
			defer srv.Close()
			resp, err := http.Get(srv.URL + "/system/ingest-xray/" + tc.id)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d", resp.StatusCode)
			}
			if fake.gotFieldsVehicleID != 0 {
				t.Fatalf("repo should not be called on invalid id")
			}
		})
	}
}

func TestIngestXRayHandler_BadWindow(t *testing.T) {
	t.Parallel()
	fake := &fakeIngestXRayRepo{}
	h := newIngestXRayHandlerForTest(fake)
	srv := httptest.NewServer(mountIngestXRay(h))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/system/ingest-xray/1?window=bogus")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestIngestXRayHandler_BadBucket(t *testing.T) {
	t.Parallel()
	fake := &fakeIngestXRayRepo{}
	h := newIngestXRayHandlerForTest(fake)
	srv := httptest.NewServer(mountIngestXRay(h))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/system/ingest-xray/1?bucket=bogus")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestIngestXRayHandler_BucketGreaterThanWindow_Returns400(t *testing.T) {
	t.Parallel()
	fake := &fakeIngestXRayRepo{}
	h := newIngestXRayHandlerForTest(fake)
	srv := httptest.NewServer(mountIngestXRay(h))
	defer srv.Close()
	// window=5m, bucket=1h → bucket > window
	resp, err := http.Get(srv.URL + "/system/ingest-xray/1?window=5m&bucket=1h")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestIngestXRayHandler_HappyPath_200WithFreshness(t *testing.T) {
	t.Parallel()
	lastSeen := time.Now().UTC().Add(-30 * time.Second)
	fake := &fakeIngestXRayRepo{
		fields: []database.IngestXRayFieldStat{
			{Field: "VehicleSpeed", SampleCount: 100, LastSeenAt: lastSeen, ValueKind: 5},
			{Field: "Gear", SampleCount: 5, LastSeenAt: lastSeen, ValueKind: 7},
		},
		buckets: []database.IngestXRayBucket{
			{BucketStart: time.Now().UTC().Add(-2 * time.Minute), Count: 50},
			{BucketStart: time.Now().UTC().Add(-1 * time.Minute), Count: 55},
		},
		lastSeen: lastSeen,
	}
	h := newIngestXRayHandlerForTest(fake)
	srv := httptest.NewServer(mountIngestXRay(h))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/system/ingest-xray/42?window=1h&bucket=1m&limit=50")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var body IngestXRayResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.VehicleID != 42 {
		t.Fatalf("vehicle_id mismatch: %d", body.VehicleID)
	}
	if body.Window != "1h" || body.Bucket != "1m" {
		t.Fatalf("window/bucket round-trip wrong: %s/%s", body.Window, body.Bucket)
	}
	if body.TotalSamples != 105 {
		t.Fatalf("total_samples should be sum of field counts (105), got %d", body.TotalSamples)
	}
	if body.LastSeenAt == nil {
		t.Fatalf("expected last_seen_at populated")
	}
	if body.FreshnessSeconds == nil || *body.FreshnessSeconds < 25 || *body.FreshnessSeconds > 60 {
		t.Fatalf("expected freshness ~30s, got %v", body.FreshnessSeconds)
	}
	if fake.gotFieldsVehicleID != 42 {
		t.Fatalf("repo got wrong vehicle id: %d", fake.gotFieldsVehicleID)
	}
	if fake.gotBucketWidth != time.Minute {
		t.Fatalf("repo got wrong bucket width: %v", fake.gotBucketWidth)
	}
	if fake.gotLimit != 50 {
		t.Fatalf("repo got wrong limit: %d", fake.gotLimit)
	}
}

func TestIngestXRayHandler_HappyPath_NoLastSeenOmitsFreshness(t *testing.T) {
	t.Parallel()
	fake := &fakeIngestXRayRepo{
		fields:  []database.IngestXRayFieldStat{},
		buckets: []database.IngestXRayBucket{},
		// lastSeen left as zero time
	}
	h := newIngestXRayHandlerForTest(fake)
	srv := httptest.NewServer(mountIngestXRay(h))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/system/ingest-xray/7")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var body IngestXRayResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.LastSeenAt != nil {
		t.Fatalf("expected last_seen_at omitted when never observed, got %v", body.LastSeenAt)
	}
	if body.FreshnessSeconds != nil {
		t.Fatalf("expected freshness_seconds omitted when never observed")
	}
	if body.TotalSamples != 0 {
		t.Fatalf("expected total_samples 0, got %d", body.TotalSamples)
	}
}

func TestIngestXRayHandler_RepoError_500(t *testing.T) {
	t.Parallel()
	fake := &fakeIngestXRayRepo{errFields: errors.New("simulated db error")}
	h := newIngestXRayHandlerForTest(fake)
	srv := httptest.NewServer(mountIngestXRay(h))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/system/ingest-xray/1")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.StatusCode)
	}
}
