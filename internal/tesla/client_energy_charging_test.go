package tesla

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetChargingHistoryOmitsUnsupportedSortParameters(t *testing.T) {
	t.Parallel()

	const (
		vin       = "5YJ3E1EA1KF000001"
		startTime = "2026-05-08T20:39:45Z"
		endTime   = "2026-08-08T20:39:45Z"
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if r.URL.Path != "/api/1/dx/charging/history" {
			t.Errorf("path = %q, want /api/1/dx/charging/history", r.URL.Path)
		}

		query := r.URL.Query()
		if got := query.Get("vin"); got != vin {
			t.Errorf("vin = %q, want %q", got, vin)
		}
		if got := query.Get("startTime"); got != startTime {
			t.Errorf("startTime = %q, want %q", got, startTime)
		}
		if got := query.Get("endTime"); got != endTime {
			t.Errorf("endTime = %q, want %q", got, endTime)
		}
		if got := query.Get("pageNo"); got != "1" {
			t.Errorf("pageNo = %q, want 1", got)
		}
		if got := query.Get("pageSize"); got != "50" {
			t.Errorf("pageSize = %q, want 50", got)
		}
		if query.Has("sortBy") {
			t.Errorf("unsupported sortBy parameter sent: %q", query.Get("sortBy"))
		}
		if query.Has("sortOrder") {
			t.Errorf("sortOrder sent without a supported sortBy: %q", query.Get("sortOrder"))
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"response":{"data":[],"hasMoreData":false}}`))
	}))
	defer server.Close()

	client := newTestClient(server)
	body, status, err := client.GetChargingHistory(
		context.Background(),
		vin,
		startTime,
		endTime,
		1,
		50,
	)
	if err != nil {
		t.Fatalf("GetChargingHistory() error = %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}
	if len(body) == 0 {
		t.Fatal("response body is empty")
	}
}
