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
		{"encoded local path separator", "/drives%2F42", "/drives%2F42", http.StatusSeeOther},
		{"double encoded separator remains local", "/%252Fother.example/", "/%252Fother.example/", http.StatusSeeOther},
		{"empty query delimiter", "/settings?", "/settings?", http.StatusSeeOther},
		{"external-looking query value", "/settings?next=https%3A%2F%2Fother.example%2F", "/settings?next=https%3A%2F%2Fother.example%2F", http.StatusSeeOther},
		{"external-looking fragment", "/settings#https://other.example/", "/settings#https://other.example/", http.StatusSeeOther},
		{"fragment path segments stay in fragment", "/safe#/../api/v1/auth/browser-login", "/safe#/../api/v1/auth/browser-login", http.StatusSeeOther},
		{"foreign origin", "https://other.example/", "", http.StatusBadRequest},
		{"scheme relative", "//other.example/", "", http.StatusBadRequest},
		{"authority without hostname", "//:443/settings", "", http.StatusBadRequest},
		{"foreign authority with userinfo", "//synthetic-user@other.example/settings", "", http.StatusBadRequest},
		{"userinfo authority without hostname", "//synthetic-user@/settings", "", http.StatusBadRequest},
		{"encoded scheme relative", "/%2Fother.example/", "", http.StatusBadRequest},
		{"lowercase encoded scheme relative", "/%2fother.example/", "", http.StatusBadRequest},
		{"encoded leading root separator", "%2Fsettings", "", http.StatusBadRequest},
		{"backslash", "/\\other.example/", "", http.StatusBadRequest},
		{"encoded backslash", "/%5Cother.example/", "", http.StatusBadRequest},
		{"lowercase encoded backslash", "/%5cother.example/", "", http.StatusBadRequest},
		{"malformed escape", "/%zz", "", http.StatusBadRequest},
		{"script", "javascript:alert(1)", "", http.StatusBadRequest},
		{"redirect loop", "/api/v1/auth/browser-login/", "", http.StatusBadRequest},
		{"normalized redirect loop", "/api/v1/auth/./browser-login", "", http.StatusBadRequest},
		{"encoded normalized redirect loop", "/api/v1/auth/%2E/browser-login", "", http.StatusBadRequest},
		{"encoded control", "/%0D%0ALocation:example", "", http.StatusBadRequest},
		{"encoded null", "/%00", "", http.StatusBadRequest},
		{"encoded tab", "/%09", "", http.StatusBadRequest},
		{"encoded delete", "/%7F", "", http.StatusBadRequest},
		{"encoded unicode control", "/%C2%85settings", "", http.StatusBadRequest},
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
