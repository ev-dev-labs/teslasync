package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"github.com/go-chi/chi/v5"
)

func TestRateLimitPolicyIsolatesRoutesAndIdentities(t *testing.T) {
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		r.With(LimitByIP(1, time.Minute)).Post("/vehicles/{id}/wake", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})
		r.Get("/vehicles/{id}/state", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})
	})
	request := func(method, path, peer string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		req.RemoteAddr = peer
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	first := request(http.MethodPost, "/api/v1/vehicles/1/wake", "192.0.2.1:1000")
	limited := request(http.MethodPost, "/api/v1/vehicles/2/wake", "192.0.2.1:2000")
	if first.Code != http.StatusNoContent || limited.Code != http.StatusTooManyRequests {
		t.Fatalf("statuses = %d, %d", first.Code, limited.Code)
	}
	for name, want := range map[string]string{
		httputil.RateLimitScopeHeader:       "/vehicles/{id}/wake",
		httputil.RateLimitMethodsHeader:     "POST",
		httputil.RateLimitSourceHeader:      "teslasync",
		httputil.RateLimitEnforcementHeader: "process",
		httputil.RateLimitLimitedHeader:     "true",
		"Retry-After":                       "60",
	} {
		if got := limited.Header().Get(name); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
	bucket := first.Header().Get(httputil.RateLimitBucketHeader)
	if len(bucket) != 32 || bucket != limited.Header().Get(httputil.RateLimitBucketHeader) {
		t.Fatalf("same client must share an opaque bucket: %q", bucket)
	}
	other := request(http.MethodPost, "/api/v1/vehicles/1/wake", "192.0.2.2:1000")
	if other.Code != http.StatusNoContent || other.Header().Get(httputil.RateLimitBucketHeader) == bucket {
		t.Fatal("a different client must retain its own quota")
	}
	if request(http.MethodGet, "/api/v1/vehicles/1/state", "192.0.2.1:1000").Code != http.StatusNoContent {
		t.Fatal("a limited mutation must not prevent unrelated reads")
	}
}

func TestRateLimitPolicyDescribesSharedRouteGroup(t *testing.T) {
	router := chi.NewRouter()
	router.Route("/api/v1/settings", func(r chi.Router) {
		r.Use(LimitByIP(1, time.Minute))
		r.Get("/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
		r.Put("/{key}", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	})
	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/api/v1/settings/", nil))
	second := httptest.NewRecorder()
	router.ServeHTTP(second, httptest.NewRequest(http.MethodPut, "/api/v1/settings/theme", nil))
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("group status = %d", second.Code)
	}
	if scope := second.Header().Get(httputil.RateLimitScopeHeader); scope != "/settings/*" {
		t.Fatalf("group scope = %q, want /settings/*", scope)
	}
	if methods := second.Header().Get(httputil.RateLimitMethodsHeader); methods != "*" {
		t.Fatalf("group methods = %q, want *", methods)
	}
	if first.Header().Get(httputil.RateLimitBucketHeader) != second.Header().Get(httputil.RateLimitBucketHeader) {
		t.Fatal("all methods in a shared group must advertise the same bucket")
	}
}

func TestRateLimitResponsesPreservesUpstreamTiming(t *testing.T) {
	router := chi.NewRouter()
	router.Use(RateLimitResponses("X-Forwarded-User"))
	router.Post("/api/v1/vehicles/{id}/refresh", func(w http.ResponseWriter, r *http.Request) {
		httputil.RecordUpstreamRateLimit(r.Context(), "tesla", http.Header{"Retry-After": {"120"}})
		httputil.RespondError(w, http.StatusTooManyRequests, "TESLA_API_RATE_LIMITED", "Tesla rate limit reached")
	})
	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodPost, "/api/v1/vehicles/1/refresh", nil))
	if res.Header().Get("Retry-After") != "120" || res.Header().Get(httputil.RateLimitSourceHeader) != "tesla" {
		t.Fatalf("upstream metadata = %v", res.Header())
	}
	if scope := res.Header().Get(httputil.RateLimitScopeHeader); scope != "/vehicles/1/refresh" {
		t.Fatalf("unknown upstream scope must stay resource-specific: %q", scope)
	}
}

func TestAnonymousRateLimitGroupDoesNotClaimUnrelatedRoutes(t *testing.T) {
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(LimitByIP(1, time.Minute, "/settings", "/settings/polling-config"))
			r.Get("/settings", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
			r.Put("/settings/polling-config", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
		})
		r.Get("/settings/widget-design-pack", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	})
	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil))
	second := httptest.NewRecorder()
	router.ServeHTTP(second, httptest.NewRequest(http.MethodPut, "/api/v1/settings/polling-config", nil))
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("shared group status = %d", second.Code)
	}
	if scope := second.Header().Get(httputil.RateLimitScopeHeader); scope != "/settings /settings/polling-config" {
		t.Fatalf("anonymous group scope = %q", scope)
	}
	if second.Header().Get(httputil.RateLimitMethodsHeader) != "*" ||
		first.Header().Get(httputil.RateLimitBucketHeader) != second.Header().Get(httputil.RateLimitBucketHeader) {
		t.Fatal("anonymous group routes must share one method-independent bucket")
	}
	unrelated := httptest.NewRecorder()
	router.ServeHTTP(unrelated, httptest.NewRequest(http.MethodGet, "/api/v1/settings/widget-design-pack", nil))
	if unrelated.Code != http.StatusNoContent || unrelated.Header().Get(httputil.RateLimitBucketHeader) != "" {
		t.Fatal("a sibling outside the anonymous group must not inherit its limit")
	}
}

func TestRateLimitResponsesDoesNotMisattributeLocalRejection(t *testing.T) {
	router := chi.NewRouter()
	router.Use(RateLimitResponses(""))
	router.With(LimitByIP(1, time.Minute)).Get("/", func(w http.ResponseWriter, r *http.Request) {
		httputil.RecordUpstreamRateLimit(r.Context(), "tesla", http.Header{"Retry-After": {"120"}})
		w.WriteHeader(http.StatusNoContent)
	})
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/", nil))
	if res.Header().Get(httputil.RateLimitSourceHeader) != "teslasync" || res.Header().Get("Retry-After") != "60" {
		t.Fatalf("local rejection must retain its own policy: %v", res.Header())
	}
}
