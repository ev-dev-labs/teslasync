package fsm

import "context"

// ActionExecutor is called on every committed state transition.
// Implementations handle side effects: DB persistence, session lifecycle,
// transition logging, SSE broadcast, etc.
type ActionExecutor interface {
	Execute(ctx context.Context, vehicleID int64, from, to State, sctx *SignalContext) error
}

// ActionFunc is a convenience adapter for single-function actions.
type ActionFunc func(ctx context.Context, vehicleID int64, from, to State, sctx *SignalContext) error

// Execute implements ActionExecutor.
func (f ActionFunc) Execute(ctx context.Context, vehicleID int64, from, to State, sctx *SignalContext) error {
	return f(ctx, vehicleID, from, to, sctx)
}

// CompositeAction executes multiple actions in order, stopping on first error.
type CompositeAction struct {
	Actions []ActionExecutor
}

// Execute runs each action in sequence.
func (c *CompositeAction) Execute(ctx context.Context, vehicleID int64, from, to State, sctx *SignalContext) error {
	for _, a := range c.Actions {
		if err := a.Execute(ctx, vehicleID, from, to, sctx); err != nil {
			return err
		}
	}
	return nil
}

// NoOpAction does nothing — used when no actions are configured (e.g., in tests).
type NoOpAction struct{}

// Execute is a no-op.
func (NoOpAction) Execute(_ context.Context, _ int64, _, _ State, _ *SignalContext) error {
	return nil
}
