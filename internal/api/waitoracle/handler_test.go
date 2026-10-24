package waitoracle

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeStore struct {
	sites   []*Site
	history SiteHistory
	err     error
	gotZone *string
}

func (f *fakeStore) ListSites(_ context.Context, _ string, _ int) ([]*Site, error) {
	return f.sites, f.err
}

func (f *fakeStore) History(_ context.Context, _ string, zone string) (SiteHistory, error) {
	if f.gotZone != nil {
		*f.gotZone = zone
	}
	return f.history, f.err
}

var _ HistoryStore = (*fakeStore)(nil)

func TestNewHandlerPanicsOnNil(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	NewHandler(nil)
}

func TestSites(t *testing.T) {
	h := NewHandler(&fakeStore{sites: []*Site{
		{Name: "Kettleman City", Sessions: 200},
		{Name: "Barstow", Sessions: 40},
	}})
	req := httptest.NewRequest(http.MethodGet, "/waitoracle/sites?q=kettle&limit=10", nil)
	rec := httptest.NewRecorder()
	h.Sites(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	var got []*Site
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Name != "Kettleman City" {
		t.Fatalf("sites = %+v", got)
	}
}

func TestSitesStoreError(t *testing.T) {
	h := NewHandler(&fakeStore{err: errors.New("db down")})
	req := httptest.NewRequest(http.MethodGet, "/waitoracle/sites", nil)
	rec := httptest.NewRecorder()
	h.Sites(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("code = %d, want 500", rec.Code)
	}
}

func TestForecastHandler(t *testing.T) {
	h := NewHandler(&fakeStore{history: fridayPeakHistory()})
	req := httptest.NewRequest(http.MethodGet,
		"/waitoracle/forecast?site=Kettleman+City&arrive_at=2026-09-11T18:00:00Z", nil)
	rec := httptest.NewRecorder()
	h.Forecast(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got Forecast
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Verdict != VerdictPacked || got.Site != "Kettleman City" {
		t.Fatalf("forecast = %+v", got)
	}
}

func TestForecastHandlerDefaultsToNow(t *testing.T) {
	now := time.Date(2026, 9, 11, 18, 0, 0, 0, time.UTC)
	h := NewHandler(&fakeStore{history: fridayPeakHistory()})
	h.now = func() time.Time { return now }
	req := httptest.NewRequest(http.MethodGet, "/waitoracle/forecast?site=Kettleman+City", nil)
	rec := httptest.NewRecorder()
	h.Forecast(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	var got Forecast
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.ArriveAt.Equal(now) {
		t.Fatalf("arrive_at = %v, want %v", got.ArriveAt, now)
	}
}

func TestForecastHandlerErrors(t *testing.T) {
	h := NewHandler(&fakeStore{history: fridayPeakHistory()})
	cases := []struct {
		name string
		url  string
		code int
	}{
		{"missing site", "/waitoracle/forecast", http.StatusBadRequest},
		{"bad arrive_at", "/waitoracle/forecast?site=x&arrive_at=tomorrow", http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, c.url, nil)
			rec := httptest.NewRecorder()
			h.Forecast(rec, req)
			if rec.Code != c.code {
				t.Fatalf("code = %d, want %d", rec.Code, c.code)
			}
		})
	}
}

func TestForecastHandlerNoHistory(t *testing.T) {
	h := NewHandler(&fakeStore{err: ErrNoHistory})
	req := httptest.NewRequest(http.MethodGet, "/waitoracle/forecast?site=Nowhere", nil)
	rec := httptest.NewRecorder()
	h.Forecast(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
}

func TestForecastHandlerStoreError(t *testing.T) {
	h := NewHandler(&fakeStore{err: errors.New("db down")})
	req := httptest.NewRequest(http.MethodGet, "/waitoracle/forecast?site=x", nil)
	rec := httptest.NewRecorder()
	h.Forecast(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("code = %d, want 500", rec.Code)
	}
}

func TestForecastHandlerTimezone(t *testing.T) {
	cases := []struct {
		name     string
		param    string
		wantZone string
	}{
		{"omitted defaults to UTC", "", "UTC"},
		{"explicit zone honored", "America/Los_Angeles", "America/Los_Angeles"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var gotZone string
			h := NewHandler(&fakeStore{history: fridayPeakHistory(), gotZone: &gotZone})
			url := "/waitoracle/forecast?site=Kettleman+City&arrive_at=2026-09-11T18:00:00Z"
			if c.param != "" {
				url += "&timezone=" + c.param
			}
			req := httptest.NewRequest(http.MethodGet, url, nil)
			rec := httptest.NewRecorder()
			h.Forecast(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
			}
			if gotZone != c.wantZone {
				t.Fatalf("store zone = %q, want %q", gotZone, c.wantZone)
			}
		})
	}
}

func TestForecastHandlerBadTimezone(t *testing.T) {
	h := NewHandler(&fakeStore{history: fridayPeakHistory()})
	long := "America/" + strings.Repeat("x", 60)
	cases := []struct {
		name string
		url  string
	}{
		{"unknown zone", "/waitoracle/forecast?site=x&timezone=Mars/Olympus"},
		{"overlong zone", "/waitoracle/forecast?site=x&timezone=" + long},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, c.url, nil)
			rec := httptest.NewRecorder()
			h.Forecast(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("code = %d, want 400", rec.Code)
			}
		})
	}
}

func TestForecastHandlerBestHourKey(t *testing.T) {
	h := NewHandler(&fakeStore{history: fridayPeakHistory()})
	req := httptest.NewRequest(http.MethodGet,
		"/waitoracle/forecast?site=Kettleman+City&arrive_at=2026-09-11T18:00:00Z", nil)
	rec := httptest.NewRecorder()
	h.Forecast(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"best_hour":`) {
		t.Fatalf("body lacks best_hour key: %s", body)
	}
	if strings.Contains(body, "best_hour_utc") {
		t.Fatalf("body still carries the UTC-suffixed key: %s", body)
	}
}
