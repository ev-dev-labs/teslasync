package tesla

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPrivateEnergySiteReadsDoNotAuditIdentifiersOrPayloads(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Bearer synthetic-energy-only-token" {
			t.Errorf("expected a read authenticated by the energy account")
		}
		switch r.URL.Path {
		case "/api/1/energy_sites/96745/live_status":
			_, _ = w.Write([]byte(`{"response":{"synthetic_private_value":42}}`))
		case "/api/1/energy_sites/96745/site_info":
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"synthetic_private_details"}`))
		default:
			t.Errorf("unexpected request %q", r.URL.Path)
		}
	}))
	defer server.Close()

	client := newTestClient(server)
	var paths []string
	client.SetLogCallback(func(method, path string, _ int, request, response []byte, _ int, _ error) {
		paths = append(paths, strings.TrimPrefix(path, server.URL))
		if method != http.MethodGet || len(request) != 0 || len(response) != 0 {
			t.Error("private request leaked an audit payload or changed method")
		}
	})
	ctx := context.Background()
	body, status, err := client.ReadPrivateEnergyLiveStatus(ctx, 96745, "synthetic-energy-only-token")
	if status != http.StatusOK || err != nil || !strings.Contains(string(body), "synthetic_private_value") {
		t.Fatalf("private GET status=%d err=%v; expected response for the caller", status, err)
	}
	_, status, err = client.ReadPrivateEnergySiteInfo(ctx, 96745, "synthetic-energy-only-token")
	if status != http.StatusForbidden || err != nil {
		t.Fatalf("site_info status=%d err=%v; expected independent provider denial", status, err)
	}
	_, status, err = client.ReadPrivateEnergyLiveStatus(ctx, 96745, "")
	if status != http.StatusUnauthorized || err == nil {
		t.Fatal("expected disconnected reads to fail before contacting Tesla")
	}
	if strings.Join(paths, ",") != "/api/1/energy_sites/{site_id}/live_status,/api/1/energy_sites/{site_id}/site_info" {
		t.Fatalf("unexpected private audit paths: %v", paths)
	}
}

func TestPrivateEnergyReadsRejectProviderRedirectsAndOversizedData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/1/energy_sites/96745/live_status":
			http.Redirect(w, r, "/unrelated", http.StatusFound)
		case "/api/1/energy_sites/96745/site_info":
			_, _ = w.Write([]byte(strings.Repeat("x", 1<<20+1)))
		default:
			t.Error("private client followed a provider redirect")
		}
	}))
	defer server.Close()

	client := newTestClient(server)
	ctx := context.Background()
	if _, status, err := client.ReadPrivateEnergyLiveStatus(ctx, 96745, "synthetic-energy-only-token"); status != http.StatusFound || err != nil {
		t.Fatalf("private GET status=%d err=%v; expected redirect to remain unfollowed", status, err)
	}
	if body, _, err := client.ReadPrivateEnergySiteInfo(ctx, 96745, "synthetic-energy-only-token"); err == nil || len(body) != 0 {
		t.Fatal("expected a bounded read to reject oversized provider data")
	}
}

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
