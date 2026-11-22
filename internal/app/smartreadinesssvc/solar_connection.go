package smartreadinesssvc

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"time"

	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

const (
	solarAuthorizationLifetime = 10 * time.Minute
	solarRefreshRetry          = time.Minute
)

type SolarEnergyAuthorizationClient interface {
	EnergyReadAuthURL(ctx context.Context, state string) (string, error)
	ExchangeEnergyAuthorization(ctx context.Context, code string) (port.SolarEnergyTokens, error)
	RefreshEnergyAuthorization(ctx context.Context, refreshToken string) (port.SolarEnergyTokens, error)
	CheckEnergySiteAccess(ctx context.Context, siteID int64, accessToken string) error
}

type SolarEnergyConnections struct {
	repo   port.SolarEnergyConnectionRepository
	client SolarEnergyAuthorizationClient
	now    func() time.Time
}

func NewSolarEnergyConnections(repo port.SolarEnergyConnectionRepository, client SolarEnergyAuthorizationClient) *SolarEnergyConnections {
	return &SolarEnergyConnections{repo: repo, client: client, now: time.Now}
}

func (s *SolarEnergyConnections) Begin(ctx context.Context, subject string, siteID int64) (link, state string, err error) {
	if err := validateScope(subject, siteID); err != nil {
		return "", "", err
	}
	if s.client == nil {
		return "", "", ErrSolarChargingUnavailable
	}
	var nonce [32]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", "", err
	}
	state = base64.RawURLEncoding.EncodeToString(nonce[:])
	link, err = s.client.EnergyReadAuthURL(ctx, state)
	if err != nil {
		return "", "", ErrSolarChargingUnavailable
	}
	err = s.repo.BeginEnergyAuthorization(ctx, subject, siteID, sha256.Sum256([]byte(state)),
		s.now().UTC().Add(solarAuthorizationLifetime))
	if err != nil {
		return "", "", err
	}
	return link, state, nil
}

func (s *SolarEnergyConnections) Complete(ctx context.Context, subject, state, code string) error {
	if validateScope(subject, 1) != nil || len(state) != 43 || code == "" || len(code) > 4096 {
		return ErrInvalidInput
	}
	if s.client == nil {
		return ErrSolarChargingUnavailable
	}
	hash := sha256.Sum256([]byte(state))
	auth, err := s.repo.ClaimEnergyAuthorization(ctx, subject, hash, s.now().UTC())
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	tokens, err := s.client.ExchangeEnergyAuthorization(ctx, code)
	if err != nil {
		return ErrSolarChargingUnavailable
	}
	if err := s.client.CheckEnergySiteAccess(ctx, auth.SiteID, tokens.AccessToken); err != nil {
		return ErrSolarChargingUnavailable
	}
	return s.repo.CompleteEnergyAuthorization(ctx, *auth, hash, tokens, s.now().UTC())
}

func (s *SolarEnergyConnections) Site(ctx context.Context, subject string) (int64, error) {
	if err := validateScope(subject, 1); err != nil {
		return 0, err
	}
	return s.repo.FindSolarEnergySite(ctx, subject)
}

func (s *SolarEnergyConnections) CanConnect() bool { return s.client != nil }

func (s *SolarEnergyConnections) Disconnect(ctx context.Context, subject string) error {
	if err := validateScope(subject, 1); err != nil {
		return err
	}
	return s.repo.DisconnectSolarEnergy(ctx, subject)
}

func (s *SolarEnergyConnections) Available(ctx context.Context, subject string, siteID int64) (bool, error) {
	site, err := s.Site(ctx, subject)
	return site > 0 && site == siteID, err
}

func (s *SolarEnergyConnections) AccessToken(ctx context.Context, subject string, siteID int64) (string, error) {
	now := s.now().UTC().Truncate(time.Microsecond)
	token, err := s.repo.FindSolarEnergyAccessToken(ctx, subject, siteID, now)
	if err != nil || token != "" {
		return token, err
	}
	retryAfter := now.Add(solarRefreshRetry)
	id, refreshToken, err := s.repo.ClaimSolarEnergyRefresh(ctx, subject, siteID, now, retryAfter)
	if err != nil {
		return "", err
	}
	tokens, err := s.client.RefreshEnergyAuthorization(ctx, refreshToken)
	if err != nil {
		return "", ErrSolarChargingUnavailable
	}
	if err := s.repo.CompleteSolarEnergyRefresh(ctx, id, retryAfter, tokens); err != nil {
		return "", err
	}
	return tokens.AccessToken, nil
}

func (s *SolarEnergyConnections) Prune(ctx context.Context) error {
	return s.repo.PruneEnergyAuthorizations(ctx, s.now().UTC())
}
