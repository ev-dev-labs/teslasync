package smartfeaturesvc

import (
	"context"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartfeature"
)

type Repository interface {
	Preferences(context.Context, string) (map[smartfeature.Key]bool, error)
	SetPreference(context.Context, string, smartfeature.Preference) error
	Allows(context.Context, string, smartfeature.Key) (bool, error)
}

type Service struct{ repo Repository }

func New(repo Repository) *Service { return &Service{repo: repo} }

func (s *Service) List(ctx context.Context, subject string) ([]smartfeature.Preference, error) {
	if !validSubject(subject) {
		return nil, domain.ErrValidation
	}
	overrides, err := s.repo.Preferences(ctx, subject)
	if err != nil {
		return nil, err
	}
	keys := smartfeature.Keys()
	prefs := make([]smartfeature.Preference, 0, len(keys))
	for _, key := range keys {
		if !key.AvailableTo(subject) {
			continue
		}
		allowed, hasOverride := overrides[key]
		prefs = append(prefs, smartfeature.Preference{Feature: key, Allowed: !hasOverride || allowed})
	}
	return prefs, nil
}

func (s *Service) Set(ctx context.Context, subject string, pref smartfeature.Preference) error {
	if !validSubject(subject) || !pref.Feature.AvailableTo(subject) {
		return domain.ErrValidation
	}
	return s.repo.SetPreference(ctx, subject, pref)
}

func (s *Service) Allows(ctx context.Context, subject string, feature smartfeature.Key) (bool, error) {
	if !validSubject(subject) || !feature.AvailableTo(subject) {
		return false, domain.ErrValidation
	}
	return s.repo.Allows(ctx, subject, feature)
}

func validSubject(subject string) bool {
	return strings.TrimSpace(subject) != "" && len(subject) <= 512
}
