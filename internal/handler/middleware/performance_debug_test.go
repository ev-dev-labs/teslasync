package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPerformanceDebugDisabledHasNoTrailer(t *testing.T) {
	for _, header := range []string{"", "0", "true"} {
		t.Run(header, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/widgets", nil)
			if header != "" {
				request.Header.Set(PerformanceDebugRequestHeader, header)
			}
			handler := PerformanceDebug(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if w != recorder || r != request {
					t.Fatal("disabled middleware must pass through the original writer and request")
				}
				w.WriteHeader(http.StatusAccepted)
				_, _ = w.Write([]byte("body"))
			}))
			handler.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusAccepted || recorder.Body.String() != "body" {
				t.Fatal("disabled middleware changed the response")
			}
			if got := recorder.Header().Get("Trailer"); got != "" {
				t.Fatalf("Trailer = %q, want empty", got)
			}
			if got := recorder.Header().Get(PerformanceDebugTrailer); got != "" {
				t.Fatalf("%s = %q, want empty", PerformanceDebugTrailer, got)
			}
		})
	}
}

func BenchmarkPerformanceDebugDisabled(b *testing.B) {
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	for _, tc := range []struct {
		name    string
		handler http.Handler
	}{
		{name: "baseline", handler: next},
		{name: "middleware", handler: PerformanceDebug(next)},
	} {
		b.Run(tc.name, func(b *testing.B) {
			request := httptest.NewRequest(http.MethodGet, "/widgets", nil)
			recorder := httptest.NewRecorder()
			b.ReportAllocs()
			for b.Loop() {
				tc.handler.ServeHTTP(recorder, request)
			}
		})
	}
}

func TestPerformanceDebugReportsRequestAndPayload(t *testing.T) {
	handler := PerformanceDebug(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("four"))
	}))
	request := httptest.NewRequest(http.MethodGet, "/widgets", nil)
	request.Header.Set(PerformanceDebugRequestHeader, "1")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusCreated)
	}

	if got := recorder.Body.String(); got != "four" {
		t.Fatalf("body = %q, want exact original body", got)
	}
	var measurement RequestPerformance
	if err := json.Unmarshal([]byte(recorder.Header().Get(PerformanceDebugTrailer)), &measurement); err != nil {
		t.Fatalf("decode performance trailer: %v", err)
	}
	if measurement.TotalRequestMS < 0 {
		t.Fatalf("total_request_ms = %f, want non-negative", measurement.TotalRequestMS)
	}
	if measurement.QueryCount != 0 || measurement.QueryTimeMS != 0 {
		t.Fatalf("unexpected query metrics: %+v", measurement)
	}
	if measurement.PayloadKB != float64(len("four"))/1024 {
		t.Fatalf("payload_kb = %f, want %f", measurement.PayloadKB, float64(len("four"))/1024)
	}
}

func TestPerformanceDebugBodylessResponsesHaveNoTrailer(t *testing.T) {
	for _, tc := range []struct {
		method string
		status int
	}{
		{method: http.MethodHead, status: http.StatusOK},
		{method: http.MethodHead, status: http.StatusCreated},
		{method: http.MethodPost, status: http.StatusNoContent},
		{method: http.MethodGet, status: http.StatusNotModified},
	} {
		t.Run(http.StatusText(tc.status), func(t *testing.T) {
			handler := PerformanceDebug(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if tc.status == http.StatusOK {
					_, _ = w.Write([]byte("head representation"))
				} else {
					w.WriteHeader(tc.status)
				}
			}))
			request := httptest.NewRequest(tc.method, "/widgets", nil)
			request.Header.Set(PerformanceDebugRequestHeader, "1")
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			response := recorder.Result()
			defer response.Body.Close()
			if response.StatusCode != tc.status {
				t.Fatalf("status = %d, want %d", response.StatusCode, tc.status)
			}
			if response.Header.Get("Trailer") != "" || response.Trailer.Get(PerformanceDebugTrailer) != "" {
				t.Fatal("bodyless response must not advertise or send a performance trailer")
			}
		})
	}
}

func TestPerformanceDebugPreservesStreaming(t *testing.T) {
	handler := PerformanceDebug(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: live\n\n"))
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("debug writer must preserve streaming support")
		}
		flusher.Flush()
	}))
	request := httptest.NewRequest(http.MethodGet, "/events", nil)
	request.Header.Set(PerformanceDebugRequestHeader, "1")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if !recorder.Flushed || recorder.Body.String() != "data: live\n\n" {
		t.Fatal("debug instrumentation changed streaming behavior")
	}
}
