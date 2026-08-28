package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestBuildOperatorChainJourneyProbeCarriesAuthAndSessionCookie(t *testing.T) {
	t.Parallel()
	var requests, requestsWithCookie atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if got := r.Header.Get("X-Forwarded-User"); got != "teslasync-synthetic" {
			t.Errorf("X-Forwarded-User = %q, want teslasync-synthetic", got)
		}
		if _, err := r.Cookie("teslasync_test_session"); err == nil {
			requestsWithCookie.Add(1)
		} else {
			http.SetCookie(w, &http.Cookie{Name: "teslasync_test_session", Value: "active", Path: "/"})
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v1/vehicles/states" {
			_, _ = w.Write([]byte(`{"data":{"vehicles":[{"vehicle_id":42}]}}`))
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	probe, err := buildOperatorChainJourneyProbe(srv.URL+"/", time.Second, "X-Forwarded-User")
	if err != nil {
		t.Fatalf("buildOperatorChainJourneyProbe() error = %v", err)
	}
	if err := probe.Run(context.Background()); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if got := requests.Load(); got != 4 {
		t.Fatalf("request count = %d, want 4", got)
	}
	if got := requestsWithCookie.Load(); got != 3 {
		t.Fatalf("requests carrying persisted session cookie = %d, want 3", got)
	}
}
