package smartreadiness

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

var errSolarEnergyUnavailable = errors.New("Tesla energy evidence unavailable")

type SolarEnergyClient interface {
	CheckSmartFleetEndpoints(context.Context, ...string) error
	ReadPrivateEnergyLiveStatus(context.Context, int64, string) ([]byte, int, error)
	ReadPrivateEnergySiteInfo(context.Context, int64, string) ([]byte, int, error)
}

type SolarEnergyGrants interface {
	Available(ctx context.Context, subject string, siteID int64) (bool, error)
	AccessToken(ctx context.Context, subject string, siteID int64) (string, error)
}

type SolarEnergy struct {
	client SolarEnergyClient
	grants SolarEnergyGrants
	now    func() time.Time
}

func NewSolarEnergy(client SolarEnergyClient, grants SolarEnergyGrants) *SolarEnergy {
	return &SolarEnergy{client: client, grants: grants, now: time.Now}
}

func (s *SolarEnergy) Available(ctx context.Context, subject string, siteID int64) (bool, error) {
	if s.client.CheckSmartFleetEndpoints(ctx, tesla.EnergySiteInfoEndpoint, tesla.EnergyLiveStatusEndpoint) != nil {
		return false, nil
	}
	return s.grants.Available(ctx, subject, siteID)
}

func (s *SolarEnergy) accessToken(ctx context.Context, subject string, siteID int64, endpoint string) (string, error) {
	// A disabled read must not trigger an otherwise unnecessary OAuth refresh.
	if s.client.CheckSmartFleetEndpoints(ctx, endpoint) != nil {
		return "", errSolarEnergyUnavailable
	}
	token, err := s.grants.AccessToken(ctx, subject, siteID)
	if err != nil || token == "" {
		return "", errSolarEnergyUnavailable
	}
	return token, nil
}

func (s *SolarEnergy) ReadReserve(ctx context.Context, subject string, siteID int64) (domain.SolarBackupReserve, error) {
	token, err := s.accessToken(ctx, subject, siteID, tesla.EnergySiteInfoEndpoint)
	if err != nil {
		return domain.SolarBackupReserve{}, errSolarEnergyUnavailable
	}
	return readSolarReserve(ctx, s.client, siteID, token, s.now)
}

func readSolarReserve(ctx context.Context, client SolarEnergyClient, siteID int64, token string,
	now func() time.Time,
) (domain.SolarBackupReserve, error) {
	var response struct {
		Response struct {
			Percent *float64 `json:"backup_reserve_percent"`
		} `json:"response"`
	}
	body, status, err := client.ReadPrivateEnergySiteInfo(ctx, siteID, token)
	if err != nil || status != http.StatusOK || json.Unmarshal(body, &response) != nil ||
		response.Response.Percent == nil || *response.Response.Percent < 0 || *response.Response.Percent > 100 {
		return domain.SolarBackupReserve{}, errSolarEnergyUnavailable
	}
	return domain.SolarBackupReserve{SiteID: siteID, ObservedAt: now().UTC(), Percent: *response.Response.Percent}, nil
}

type TeslaSolarAuthorization struct {
	client *tesla.Client
}

func NewTeslaSolarAuthorization(client *tesla.Client) *TeslaSolarAuthorization {
	return &TeslaSolarAuthorization{client: client}
}

func (a *TeslaSolarAuthorization) EnergyReadAuthURL(ctx context.Context, state string) (string, error) {
	if a.client.CheckSmartFleetEndpoints(ctx, tesla.EnergySiteInfoEndpoint) != nil {
		return "", errSolarEnergyUnavailable
	}
	return a.client.EnergyReadAuthURL(state)
}

func (a *TeslaSolarAuthorization) ExchangeEnergyAuthorization(ctx context.Context, code string) (port.SolarEnergyTokens, error) {
	if a.client.CheckSmartFleetEndpoints(ctx, tesla.EnergySiteInfoEndpoint) != nil {
		return port.SolarEnergyTokens{}, errSolarEnergyUnavailable
	}
	return solarTokens(a.client.ExchangeEnergyReadCode(ctx, code))
}

func (a *TeslaSolarAuthorization) RefreshEnergyAuthorization(ctx context.Context, refresh string) (port.SolarEnergyTokens, error) {
	return solarTokens(a.client.RefreshEnergyReadGrant(ctx, refresh))
}

func (a *TeslaSolarAuthorization) CheckEnergySiteAccess(ctx context.Context, siteID int64, token string) error {
	_, err := readSolarReserve(ctx, a.client, siteID, token, time.Now)
	return err
}

func solarTokens(tokens *tesla.TokenResponse, err error) (port.SolarEnergyTokens, error) {
	if err != nil || tokens == nil {
		return port.SolarEnergyTokens{}, errSolarEnergyUnavailable
	}
	return port.SolarEnergyTokens{
		AccessToken: tokens.AccessToken, RefreshToken: tokens.RefreshToken,
		ExpiresAt: time.Now().UTC().Add(time.Duration(tokens.ExpiresIn) * time.Second),
	}, nil
}

func (s *SolarEnergy) ReadObservation(ctx context.Context, subject string, siteID int64) (domain.SolarSurplusObservation, error) {
	token, err := s.accessToken(ctx, subject, siteID, tesla.EnergyLiveStatusEndpoint)
	if err != nil {
		return domain.SolarSurplusObservation{}, errSolarEnergyUnavailable
	}
	var response struct {
		Response struct {
			ObservedAt    time.Time `json:"timestamp"`
			GridStatus    string    `json:"grid_status"`
			StormMode     *bool     `json:"storm_mode_active"`
			BackupCapable bool      `json:"backup_capable"`
			GridPowerW    *float64  `json:"grid_power"`
			SolarPowerW   *float64  `json:"solar_power"`
			BatteryPowerW *float64  `json:"battery_power"`
			BatteryPct    *float64  `json:"percentage_charged"`
		} `json:"response"`
	}
	body, status, err := s.client.ReadPrivateEnergyLiveStatus(ctx, siteID, token)
	if err != nil || status != http.StatusOK || json.Unmarshal(body, &response) != nil {
		return domain.SolarSurplusObservation{}, errSolarEnergyUnavailable
	}
	v := response.Response
	if v.ObservedAt.IsZero() || v.ObservedAt.After(s.now().UTC()) || v.StormMode == nil || !v.BackupCapable ||
		v.GridPowerW == nil || v.SolarPowerW == nil || v.BatteryPowerW == nil || v.BatteryPct == nil {
		return domain.SolarSurplusObservation{}, errSolarEnergyUnavailable
	}
	return domain.SolarSurplusObservation{
		SiteID: siteID, ObservedAt: v.ObservedAt.UTC(), GridConnected: v.GridStatus == "Active", StormMode: *v.StormMode,
		GridPowerW: *v.GridPowerW, SolarPowerW: *v.SolarPowerW, BatteryPowerW: *v.BatteryPowerW, BatteryPct: *v.BatteryPct,
	}, nil
}
