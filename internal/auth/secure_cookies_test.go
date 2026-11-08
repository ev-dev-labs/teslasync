package auth

import (
	"net/http/httptest"
	"testing"
)

func TestAuthCookiesAlwaysSecureIncludingForwardedAndLocalHTTP(t *testing.T) {
	for _, proto := range []string{"", "http", "https"} {
		t.Run("forwarded="+proto, func(t *testing.T) {
			req := httptest.NewRequest("GET", "http://localhost/", nil)
			req.Header.Set("X-Forwarded-Proto", proto)
			w := httptest.NewRecorder()
			SetImpersonationCookie(w, req, "test-token")
			ClearImpersonationCookie(w, req)
			cookies := w.Result().Cookies()
			if len(cookies) != 2 {
				t.Fatalf("want two impersonation cookies, got %d", len(cookies))
			}
			for _, cookie := range cookies {
				if !cookie.Secure || !cookie.HttpOnly {
					t.Fatalf("unsafe cookie attributes: %+v", cookie)
				}
			}
		})
	}
}
