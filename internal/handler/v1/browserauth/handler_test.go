package browserauth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestBrowserLoginReturnNavigation(t *testing.T) {
	for _, tc := range []struct {
		name, target, location string
		status                 int
	}{
		{"default", "", "/", http.StatusSeeOther},
		{"deep link", "/settings?tab=appearance#packs", "/settings?tab=appearance#packs", http.StatusSeeOther},
		{"foreign origin", "https://other.example/", "", http.StatusBadRequest},
		{"scheme relative", "//other.example/", "", http.StatusBadRequest},
		{"encoded scheme relative", "/%2Fother.example/", "", http.StatusBadRequest},
		{"backslash", "/\\other.example/", "", http.StatusBadRequest},
		{"encoded backslash", "/%5Cother.example/", "", http.StatusBadRequest},
		{"script", "javascript:alert(1)", "", http.StatusBadRequest},
		{"redirect loop", "/api/v1/auth/browser-login/", "", http.StatusBadRequest},
		{"normalized redirect loop", "/api/v1/auth/./browser-login", "", http.StatusBadRequest},
		{"encoded normalized redirect loop", "/api/v1/auth/%2E/browser-login", "", http.StatusBadRequest},
		{"encoded control", "/%0D%0ALocation:example", "", http.StatusBadRequest},
		{"encoded null", "/%00", "", http.StatusBadRequest},
		{"encoded tab", "/%09", "", http.StatusBadRequest},
		{"encoded delete", "/%7F", "", http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			query := url.Values{"rd": {tc.target}}
			req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/browser-login?"+query.Encode(), nil)
			rec := httptest.NewRecorder()
			NewHandler().Login(rec, req)
			if rec.Code != tc.status || rec.Header().Get("Location") != tc.location {
				t.Fatalf("status=%d location=%q; want %d %q", rec.Code, rec.Header().Get("Location"), tc.status, tc.location)
			}
			if len(rec.Result().Cookies()) != 0 {
				t.Fatal("provider handoff must not issue an application login cookie")
			}
			if tc.status == http.StatusSeeOther && rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("provider handoff must not be cached")
			}
		})
	}
}
