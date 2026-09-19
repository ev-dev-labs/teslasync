package alerts

import (
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestPackChannelsUseOneLookupAndFailAtomically(t *testing.T) {
	for _, lookupErr := range []error{nil, errors.New("private database details")} {
		repo := &packFake{}
		channels := &channelsFake{err: lookupErr}
		h := &AlertHandler{packRepo: repo, notifRepo: channels}
		router := chi.NewRouter()
		router.Post("/packs/{packID}/install", h.InstallPack)
		body := `{"version":2,"all_vehicles":true,"rules":[{"template_id":"battery-low","channel_ids":[2,3]},{"template_id":"charge-complete","channel_ids":[2]}]}`
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("POST", "/packs/everyday/install", strings.NewReader(body)))
		if channels.calls != 1 {
			t.Fatalf("channel lookups=%d, want one per installation", channels.calls)
		}
		if lookupErr == nil {
			if rec.Code != 201 || repo.calls != 1 {
				t.Fatalf("valid selection rejected: %s", rec.Body.String())
			}
		} else if rec.Code != 500 || repo.calls != 0 || strings.Contains(rec.Body.String(), "private") {
			t.Fatalf("lookup failure was not safely atomic: status=%d calls=%d", rec.Code, repo.calls)
		}
	}
}
