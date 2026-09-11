package teslachargehist

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

func siteEntry(site string, wh, due float64, day string) *teslamodel.TeslaChargingHistoryEntry {
	t, _ := time.Parse("2006-01-02", day)
	return &teslamodel.TeslaChargingHistoryEntry{
		SiteLocationName: site, UsageWh: &wh, TotalDue: &due, ChargeStartDatetime: t,
	}
}

func TestRankSitesCheapestFirst(t *testing.T) {
	got := RankSites([]*teslamodel.TeslaChargingHistoryEntry{
		siteEntry("Pricey SC", 50000, 25, "2026-01-02"), // $0.50/kWh
		siteEntry("Cheap SC", 50000, 15, "2026-01-03"),  // $0.30/kWh
		siteEntry("Cheap SC", 25000, 7.5, "2026-01-10"), // $0.30/kWh again
		{SiteLocationName: "No invoice"},                // unpriced
	})
	if len(got.Sites) != 2 {
		t.Fatalf("sites = %d, want 2", len(got.Sites))
	}
	if got.Sites[0].Site != "Cheap SC" || got.Sites[0].AvgPerKWh != 0.3 {
		t.Fatalf("first = %+v, want Cheap SC @ 0.30", got.Sites[0])
	}
	if got.Sites[0].Visits != 2 || got.Sites[0].LastVisit != "2026-01-10" {
		t.Fatalf("cheap site = %+v", got.Sites[0])
	}
	if got.UnpricedCount != 1 {
		t.Fatalf("unpriced = %d, want 1", got.UnpricedCount)
	}
}

func TestRankSitesEmpty(t *testing.T) {
	got := RankSites(nil)
	if got.Sites == nil || len(got.Sites) != 0 {
		t.Fatalf("expected empty non-nil sites: %+v", got)
	}
}

func TestSitesServesRanking(t *testing.T) {
	h := newHandler(&fakeChargeHistoryAPI{}, &fakeChargeHistoryStore{
		getAllFn: func(_ context.Context, _ string, _ int, _ int) ([]*teslamodel.TeslaChargingHistoryEntry, error) {
			return []*teslamodel.TeslaChargingHistoryEntry{
				siteEntry("A", 40000, 12, "2026-01-01"),
			}, nil
		},
	})
	req := httptest.NewRequest(http.MethodGet, "/sites?vin=V1", nil)
	rec := httptest.NewRecorder()
	h.Sites(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var res SiteRanking
	if err := json.NewDecoder(rec.Body).Decode(&res); err != nil {
		t.Fatal(err)
	}
	if len(res.Sites) != 1 || res.Sites[0].AvgPerKWh != 0.3 {
		t.Fatalf("unexpected ranking: %+v", res)
	}
}
