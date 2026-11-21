package smartreadiness

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

type solarEnergyFixture struct {
	live   string
	info   string
	denied string
}

func (s solarEnergyFixture) CheckSmartFleetEndpoints(_ context.Context, keys ...string) error {
	for _, key := range keys {
		if key == s.denied {
			return tesla.ErrEndpointDisabled
		}
	}
	return nil
}

type solarGrantWithoutRefresh struct {
	solarEnergyGrantFixture
	calls int
}

func (s *solarGrantWithoutRefresh) AccessToken(context.Context, string, int64) (string, error) {
	s.calls++
	return "", errors.New("synthetic refresh attempt")
}

func TestSolarAndBackupDoNotRequestTokensForDisabledReads(t *testing.T) {
	grants := &solarGrantWithoutRefresh{}
	provider := NewSolarEnergy(solarEnergyFixture{denied: tesla.EnergyLiveStatusEndpoint}, grants)
	ctx := t.Context()
	const owner, siteID = "synthetic-owner", 44
	if available, err := provider.Available(ctx, owner, siteID); available || err != nil {
		t.Fatalf("solar requires both routes: available=%v err=%v", available, err)
	}
	if _, err := provider.ReadObservation(ctx, owner, siteID); !errors.Is(err, errSolarEnergyUnavailable) {
		t.Fatalf("read observation: %v", err)
	}
	if _, err := provider.ReadBackupSite(ctx, owner, siteID); !errors.Is(err, errSolarEnergyUnavailable) {
		t.Fatalf("read backup: %v", err)
	}
	provider.client = solarEnergyFixture{denied: tesla.EnergySiteInfoEndpoint}
	if _, err := provider.ReadReserve(ctx, owner, siteID); !errors.Is(err, errSolarEnergyUnavailable) || grants.calls != 0 {
		t.Fatalf("disabled reads must not request or refresh a grant: %v (%d attempts)", err, grants.calls)
	}
}

func (s solarEnergyFixture) ReadPrivateEnergyLiveStatus(_ context.Context, _ int64, token string) ([]byte, int, error) {
	if token != "synthetic-energy-token" {
		return nil, http.StatusUnauthorized, nil
	}
	return []byte(s.live), http.StatusOK, nil
}

func (s solarEnergyFixture) ReadPrivateEnergySiteInfo(_ context.Context, _ int64, token string) ([]byte, int, error) {
	if token != "synthetic-energy-token" {
		return nil, http.StatusUnauthorized, nil
	}
	return []byte(s.info), http.StatusOK, nil
}

type solarEnergyGrantFixture struct{}

func (solarEnergyGrantFixture) Available(_ context.Context, subject string, siteID int64) (bool, error) {
	return subject == "synthetic-owner" && siteID == 44, nil
}

func (s solarEnergyGrantFixture) AccessToken(ctx context.Context, subject string, siteID int64) (string, error) {
	ok, err := s.Available(ctx, subject, siteID)
	if !ok {
		return "", err
	}
	return "synthetic-energy-token", nil
}

func TestSolarEnergyKeepsProviderTimeAndRejectsIncompleteEvidence(t *testing.T) {
	const live = `{"response":{"timestamp":"2026-06-18T11:59:30Z","grid_status":"Active","storm_mode_active":false,"backup_capable":true,"grid_power":-2000,"solar_power":3500,"battery_power":0,"percentage_charged":60}}`
	ctx := context.Background()
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	provider := NewSolarEnergy(solarEnergyFixture{live: live, info: `{"response":{"backup_reserve_percent":0}}`}, solarEnergyGrantFixture{})
	provider.now = func() time.Time { return now }
	const owner = "synthetic-owner"
	observation, err := provider.ReadObservation(ctx, owner, 44)
	if err != nil || !observation.GridConnected || observation.GridPowerW != -2000 ||
		observation.SiteID != 44 || !observation.ObservedAt.Equal(now.Add(-30*time.Second)) {
		t.Fatalf("unexpected provider evidence: %+v, %v", observation, err)
	}
	reserve, err := provider.ReadReserve(ctx, owner, 44)
	if err != nil || reserve.Percent != 0 || !reserve.ObservedAt.Equal(now) {
		t.Fatalf("explicit zero reserve must remain distinguishable from missing: %+v, %v", reserve, err)
	}
	if _, err := provider.ReadObservation(ctx, "synthetic-other", 44); err == nil {
		t.Fatal("foreign subject received selected site evidence")
	}
	if _, err := provider.ReadReserve(ctx, owner, 45); err == nil {
		t.Fatal("grant for a different site received reserve evidence")
	}
	for _, invalid := range []string{
		strings.Replace(live, `"timestamp":"2026-06-18T11:59:30Z",`, "", 1),
		strings.Replace(live, "11:59:30Z", "12:01:00Z", 1),
		strings.Replace(live, `"storm_mode_active":false,`, "", 1),
		strings.Replace(live, `"backup_capable":true,`, "", 1),
		strings.Replace(live, `"battery_power":0,`, "", 1),
	} {
		provider.client = solarEnergyFixture{live: invalid, info: `{"response":{}}`}
		if _, err := provider.ReadObservation(ctx, owner, 44); err == nil {
			t.Fatal("incomplete or future evidence did not fail closed")
		}
	}
	if _, err := provider.ReadReserve(ctx, owner, 44); err == nil {
		t.Fatal("missing reserve cannot default to zero")
	}
}
