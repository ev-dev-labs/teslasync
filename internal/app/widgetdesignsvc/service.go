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

func (s *Service) Get(ctx context.Context, scope string) (string, error) {
	id, err := s.repo.Get(ctx, scope)
	if err != nil {
		return "", fmt.Errorf("read widget design preference: %w", err)
	}
	if id == nil || !widgetdesign.ValidPackID(*id) {
		return "classic", nil
	}
	return *id, nil
}

func (s *Service) Put(ctx context.Context, scope, id string) error {
	if !widgetdesign.ValidPackID(id) {
		return ErrInvalidPack
	}
	if err := s.repo.Put(ctx, scope, id); err != nil {
		return fmt.Errorf("save widget design preference: %w", err)
	}
	return nil
}
