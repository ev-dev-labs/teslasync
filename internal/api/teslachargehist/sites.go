package teslachargehist

import (
	"math"
	"net/http"
	"sort"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

// siteRankLimit bounds the invoice scan for the site ranking. History rows
// are small and the fold is O(n); 2000 covers years of Supercharging.
const siteRankLimit = 2000

// SiteRank is one visited Supercharger/DC site with its realized $/kWh.
type SiteRank struct {
	Site       string  `json:"site"`
	Visits     int     `json:"visits"`
	TotalWh    float64 `json:"total_wh"`
	TotalSpend float64 `json:"total_spend"`
	AvgPerKWh  float64 `json:"avg_per_kwh"`
	LastVisit  string  `json:"last_visit"`
}

// SiteRanking is the GET /tesla/charging/history/sites response.
type SiteRanking struct {
	Sites         []SiteRank `json:"sites"`
	UnpricedCount int        `json:"unpriced_count"`
}

// RankSites folds invoice entries into per-site realized pricing, cheapest
// first. Entries without metered usage + spend are counted as unpriced
// instead of polluting the ranking with zeros.
func RankSites(entries []*teslamodel.TeslaChargingHistoryEntry) SiteRanking {
	ranking := SiteRanking{Sites: []SiteRank{}}
	bySite := map[string]*SiteRank{}
	for _, e := range entries {
		if e == nil {
			continue
		}
		wh, spend := deref(e.UsageWh), deref(e.TotalDue)
		if wh <= 0 || spend <= 0 {
			ranking.UnpricedCount++
			continue
		}
		name := e.SiteLocationName
		if name == "" {
			name = "Unknown site"
		}
		s, ok := bySite[name]
		if !ok {
			s = &SiteRank{Site: name}
			bySite[name] = s
		}
		s.Visits++
		s.TotalWh += wh
		s.TotalSpend += spend
		if last := e.ChargeStartDatetime.Format("2006-01-02"); last > s.LastVisit {
			s.LastVisit = last
		}
	}
	for _, s := range bySite {
		s.TotalWh = round2(s.TotalWh)
		s.TotalSpend = round2(s.TotalSpend)
		s.AvgPerKWh = round4(s.TotalSpend / (s.TotalWh / 1000))
		ranking.Sites = append(ranking.Sites, *s)
	}
	sort.Slice(ranking.Sites, func(i, j int) bool { return ranking.Sites[i].AvgPerKWh < ranking.Sites[j].AvgPerKWh })
	return ranking
}

// Sites serves GET /tesla/charging/history/sites?vin=....
func (h *TeslaChargingHistoryHandler) Sites(w http.ResponseWriter, r *http.Request) {
	vin := r.URL.Query().Get("vin")
	entries, err := h.repo.GetAll(r.Context(), vin, siteRankLimit, 0)
	if err != nil {
		log.Error().Err(err).Msg("failed to list tesla charging history for site ranking")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to rank charging sites")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, RankSites(entries))
}

func deref(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

func round2(f float64) float64 { return math.Round(f*100) / 100 }

func round4(f float64) float64 { return math.Round(f*10000) / 10000 }
