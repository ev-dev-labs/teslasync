package widgetdesignsvc

import (
	"context"
	"errors"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/domain/widgetdesign"
	port "github.com/ev-dev-labs/teslasync/internal/port/widgetdesign"
)

var ErrInvalidPack = errors.New("invalid widget design pack")

type Service struct{ repo port.Repository }

func New(repo port.Repository) *Service { return &Service{repo: repo} }

func (s *Service) Get(ctx context.Context, scope string) (widgetdesign.Preference, error) {
	value, err := s.repo.Get(ctx, scope)
	if err != nil {
		return widgetdesign.Preference{}, fmt.Errorf("read widget design preference: %w", err)
	}
	if value == nil || !widgetdesign.ValidPackID(value.PackID) {
		return widgetdesign.Preference{PackID: "classic"}, nil
	}
	return *value, nil
}

func (s *Service) Put(ctx context.Context, scope, id string, appWide *bool) (widgetdesign.Preference, error) {
	if !widgetdesign.ValidPackID(id) {
		return widgetdesign.Preference{}, ErrInvalidPack
	}
	value, err := s.repo.Put(ctx, scope, id, appWide)
	if err != nil {
		return widgetdesign.Preference{}, fmt.Errorf("save widget design preference: %w", err)
	}
	return value, nil
}
