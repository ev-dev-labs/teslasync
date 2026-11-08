package v1

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

func TestCurrentUserUsesVerifiedRequestIdentity(t *testing.T) {
	for _, native := range []bool{false, true} {
		req := httptest.NewRequest(http.MethodGet, "/users/me", nil)
		if native {
			req = req.WithContext(tsauth.WithAppTokenSubject(req.Context(), "native-owner"))
		} else {
			req.Header.Set("X-Forwarded-User", "provider-owner")
		}
		req.AddCookie(&http.Cookie{Name: "teslasync_session", Value: "retired-cookie"})
		rec := httptest.NewRecorder()
		NewUserHandler("X-Forwarded-User").GetCurrentUser(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("native=%v status=%d body=%s", native, rec.Code, rec.Body.String())
		}
		var response struct {
			Data struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		want := "provider-owner"
		if native {
			want = "native-owner"
		}
		if response.Data.ID != want {
			t.Fatalf("native=%v identity=%v", native, response.Data.ID)
		}
	}
}

func TestIdentityProfileUpdatesDoNotPretendToPersist(t *testing.T) {
	req := httptest.NewRequest(http.MethodPut, "/users/me", nil)
	req.Header.Set("X-Forwarded-User", "provider-owner")
	rec := httptest.NewRecorder()
	NewUserHandler("X-Forwarded-User").UpdateCurrentUser(rec, req)
	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("expected provider-managed profile, got %d: %s", rec.Code, rec.Body.String())
	}
}
