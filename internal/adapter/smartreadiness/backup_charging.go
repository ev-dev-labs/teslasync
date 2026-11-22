package smartreadiness

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

func (s *SolarEnergy) ReadBackupSite(ctx context.Context, subject string, siteID int64) (domain.BackupSiteReading, error) {
	token, err := s.accessToken(ctx, subject, siteID, tesla.EnergyLiveStatusEndpoint)
	if err != nil {
		return domain.BackupSiteReading{}, errSolarEnergyUnavailable
	}
	body, status, err := s.client.ReadPrivateEnergyLiveStatus(ctx, siteID, token)
	if err != nil || status != http.StatusOK {
		return domain.BackupSiteReading{}, errSolarEnergyUnavailable
	}
	return decodeBackupSiteReading(body, siteID)
}

func decodeBackupSiteReading(body []byte, siteID int64) (domain.BackupSiteReading, error) {
	var envelope struct {
		Response struct {
			ObservedAt    time.Time `json:"timestamp"`
			GridStatus    string    `json:"grid_status"`
			IslandStatus  string    `json:"island_status"`
			BackupCapable bool      `json:"backup_capable"`
			Grid          *float64  `json:"grid_power"`
			Solar         *float64  `json:"solar_power"`
			Battery       *float64  `json:"battery_power"`
			Load          *float64  `json:"load_power"`
		} `json:"response"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return domain.BackupSiteReading{}, errSolarEnergyUnavailable
	}
	v := envelope.Response
	r := domain.BackupSiteReading{SiteID: siteID, ObservedAt: v.ObservedAt.UTC(), BackupCapable: v.BackupCapable}
	if r.ObservedAt.IsZero() {
		return domain.BackupSiteReading{}, errSolarEnergyUnavailable
	}
	switch {
	case v.GridStatus == "Active" || v.IslandStatus == "on_grid":
		r.Grid = domain.BackupGridConnected
		return r, nil
	case v.IslandStatus == "off_grid_intentional":
		r.Grid = domain.BackupGridIntentional
		return r, nil
	case v.IslandStatus == "off_grid" || v.IslandStatus == "off_grid_unintentional":
		r.Grid = domain.BackupGridIslanded
	}
	if v.Grid == nil || v.Solar == nil || v.Battery == nil || v.Load == nil {
		return domain.BackupSiteReading{}, errSolarEnergyUnavailable
	}
	r.GridPowerW, r.SolarPowerW, r.SiteLoadW = *v.Grid, *v.Solar, *v.Load
	// Tesla's public contract doesn't specify the battery sign. Require both
	// a positive contribution from the meter balance and agreement with the
	// independent battery reading without assigning either sign to discharge.
	netBattery := *v.Load - *v.Solar - *v.Grid
	if netBattery > 0 && math.Abs(netBattery-math.Abs(*v.Battery)) <= 150 {
		r.BatteryPowerW = min(netBattery, math.Abs(*v.Battery))
	}
	return r, nil
}
