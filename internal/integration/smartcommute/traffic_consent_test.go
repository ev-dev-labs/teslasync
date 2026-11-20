package smartcommute_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

func TestRepresentativeTraceRequiresOwnerReviewAndCanBeRevoked(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	const root = "/api/v1/smart-commute"
	const owner = "trace-owner"
	expectStatus(t, f.request(t, http.MethodPut, root, owner, settings(42, true, true, false)), http.StatusNoContent)
	expectStatus(t, f.request(t, http.MethodPost, root+"/routines", owner, manualRoutine(42)), http.StatusCreated)
	saved := snapshot(t, f.request(t, http.MethodGet, root+"?vehicle_id=42", owner, nil))
	var routineID int64
	for _, routine := range saved.Routines {
		if routine.Status == domain.RoutineConfirmed {
			routineID = routine.ID
		}
	}
	var driveID int64
	var startedAt time.Time
	if err := f.db.Pool.QueryRow(ctx, `SELECT id, started_at FROM drives WHERE vehicle_id = 42 ORDER BY started_at DESC LIMIT 1`).
		Scan(&driveID, &startedAt); err != nil {
		t.Fatal(err)
	}
	route := fmt.Sprintf("%s/routines/%d", root, routineID)
	previewBody := map[string]int64{"vehicle_id": 42, "drive_id": driveID}
	expectStatus(t, f.request(t, http.MethodPost, route+"/traffic-preview", owner, previewBody), http.StatusUnprocessableEntity)
	seedObservedTrafficTrace(t, f, startedAt)
	expectStatus(t, f.request(t, http.MethodPost, route+"/traffic-preview", "other-subject", previewBody), http.StatusNotFound)
	expectStatus(t, f.request(t, http.MethodPost, route+"/traffic-preview", owner, map[string]int64{
		"vehicle_id": 43, "drive_id": driveID,
	}), http.StatusNotFound)
	getPreview := func() domain.TrafficPreview {
		t.Helper()
		result := f.request(t, http.MethodPost, route+"/traffic-preview", owner, previewBody)
		expectStatus(t, result, http.StatusOK)
		if result.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("private trace response is cacheable")
		}
		var envelope struct {
			Data domain.TrafficPreview `json:"data"`
		}
		if err := json.NewDecoder(result.Body).Decode(&envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.Data.DriveID != driveID || len(envelope.Data.Trace) < 3 || len(envelope.Data.Trace) >= 21 ||
			envelope.Data.Trace[0] != (domain.Point{Latitude: 47.1, Longitude: -122.1}) {
			t.Fatalf("unexpected disclosure preview: %+v", envelope.Data)
		}
		return envelope.Data
	}
	review := getPreview()
	consent := map[string]any{
		"vehicle_id": 42, "drive_id": driveID, "fingerprint": review.Fingerprint,
		"share_with_here": false, "lead_s": 900, "min_savings_s": 480,
	}
	expectStatus(t, f.request(t, http.MethodPut, route+"/traffic-consent", owner, consent), http.StatusBadRequest)
	consent["share_with_here"] = true
	consent["fingerprint"] = strings.Repeat("0", 64)
	expectStatus(t, f.request(t, http.MethodPut, route+"/traffic-consent", owner, consent), http.StatusConflict)
	consent["fingerprint"] = review.Fingerprint
	expectStatus(t, f.request(t, http.MethodPut, route+"/traffic-consent", "other-subject", consent), http.StatusNotFound)
	consent["arrival_deadline_s"] = 8 * 3600
	expectStatus(t, f.request(t, http.MethodPut, route+"/traffic-consent", owner, consent), http.StatusBadRequest)
	consent["arrival_deadline_s"] = 8*3600 + 38*60
	expectStatus(t, f.request(t, http.MethodPut, route+"/traffic-consent", owner, consent), http.StatusNoContent)
	var checkAt, departAt time.Time
	var persistedPoints, persistedDeadline int
	if err := f.db.Pool.QueryRow(ctx, `
		SELECT check_at, departure_at, cardinality(latitudes), arrival_deadline_s
		FROM smart_commute_traffic_consent WHERE routine_id = $1`, routineID).
		Scan(&checkAt, &departAt, &persistedPoints, &persistedDeadline); err != nil {
		t.Fatal(err)
	}
	if !checkAt.Equal(f.now) || departAt.Sub(checkAt) != 15*time.Minute || persistedPoints != len(review.Trace) ||
		persistedDeadline != consent["arrival_deadline_s"] {
		t.Fatalf("incorrect saved check or disclosure: %s %s, %d points, deadline %d", checkAt, departAt, persistedPoints, persistedDeadline)
	}
	expectStatus(t, f.request(t, http.MethodDelete, route+"/traffic-consent?vehicle_id=42", "other-subject", nil), http.StatusNotFound)
	expectStatus(t, f.request(t, http.MethodDelete, route+"/traffic-consent?vehicle_id=42", owner, nil), http.StatusNoContent)
	assertRevoked := func() {
		t.Helper()
		var rows int
		if err := f.db.Pool.QueryRow(ctx, `SELECT count(*) FROM smart_commute_traffic_consent WHERE routine_id = $1`, routineID).
			Scan(&rows); err != nil || rows != 0 {
			t.Fatalf("consent remains after revocation: %d, %v", rows, err)
		}
	}
	assertRevoked()
	expectStatus(t, f.request(t, http.MethodPut, route+"/traffic-consent", owner, consent), http.StatusNoContent)
	change := manualRoutine(42)
	change["name"] = "Updated destination label"
	expectStatus(t, f.request(t, http.MethodPut, route, owner, change), http.StatusOK)
	assertRevoked()
	expectStatus(t, f.request(t, http.MethodPut, route+"/traffic-consent", owner, consent), http.StatusConflict)
	consent["fingerprint"] = getPreview().Fingerprint
	expectStatus(t, f.request(t, http.MethodPut, route+"/traffic-consent", owner, consent), http.StatusNoContent)
	expectStatus(t, f.request(t, http.MethodPut, root, owner, settings(42, false, false, false)), http.StatusNoContent)
	assertRevoked()
	expectStatus(t, f.request(t, http.MethodPost, route+"/traffic-preview", owner, previewBody), http.StatusNotFound)

	for _, migration := range []string{"000270_smart_commute_arrival_deadline", "000268_smart_commute_traffic_consent"} {
		down, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", migration+".down.sql"))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.db.Pool.Exec(ctx, string(down)); err != nil {
			t.Fatalf("roll back %s: %v", migration, err)
		}
	}
	var sourceRetained bool
	if err := f.db.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM drives WHERE id = $1)`, driveID).
		Scan(&sourceRetained); err != nil || !sourceRetained {
		t.Fatalf("rollback removed source history: %t, %v", sourceRetained, err)
	}
}

func seedObservedTrafficTrace(t *testing.T, f *fixture, startedAt time.Time) {
	t.Helper()
	if _, err := f.db.Pool.Exec(context.Background(), `
		INSERT INTO signal_log(vehicle_id, ts, field, value_kind, float_value, received_at)
		SELECT 42, $1::timestamptz + (i + 1) * INTERVAL '30 seconds', p.field, $2, p.value, $1::timestamptz
		FROM generate_series(0, 20) i
		CROSS JOIN LATERAL (VALUES
		  ('LocationLatitude', 47.1 + 0.1 * (i / 20.0)),
		  ('LocationLongitude', -122.1 - 0.1 * (i / 20.0))
		) p(field, value)`, startedAt, protomodel.ValueKindDouble); err != nil {
		t.Fatal(err)
	}
}
