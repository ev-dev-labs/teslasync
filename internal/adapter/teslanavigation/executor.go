package teslanavigation

import (
	"context"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

type Executor struct {
	Client *tesla.Client
}

func (e Executor) Connectivity(ctx context.Context, vin string) string {
	return e.Client.NavigationConnectivity(ctx, vin)
}

func (e Executor) Wake(ctx context.Context, vin string, authorize func(context.Context) error) (string, domain.NavigationOutcome) {
	state, outcome := e.Client.RequestNavigationWake(ctx, vin, authorize)
	return state, domain.NavigationOutcome(outcome)
}

func (e Executor) Send(ctx context.Context, vin, address string, authorize func(context.Context) error) domain.NavigationOutcome {
	return domain.NavigationOutcome(e.Client.SendNavigationAddress(ctx, vin, address, authorize))
}
