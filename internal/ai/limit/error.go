package limit

import (
	"errors"
	"fmt"
)

// ErrLimited is the sentinel root of every LimitError. Callers that
// just want "any limit hit, treat as soft fail" check errors.Is(err,
// ErrLimited); callers that need the structured Decision (most of
// the dispatcher path) use errors.As(&LimitError{}).
var ErrLimited = errors.New("ai/limit: request rejected by limiter")

// LimitError wraps a [Decision] with Allowed=false so the rate-limit
// + cost-cap decorators can return it as a typed Go error. The
// dispatcher (internal/ai/dispatch/dispatch.go) extracts the Decision
// via errors.As and surfaces it as an SSE error event with the
// Decision fields embedded so the frontend banner can render the
// reason verbatim.
//
// Implements the standard error interface; Is/Unwrap methods chain
// to ErrLimited so existing error inspection paths keep working.
type LimitError struct {
	Decision Decision
}

// Error formats the public rejection reason; structured details stay
// in Decision.
func (e *LimitError) Error() string {
	if e == nil {
		return "ai/limit: nil decision"
	}
	if e.Decision.Reason == "" {
		return "ai/limit: rejected (unspecified reason)"
	}
	if e.Decision.RetryAfter > 0 {
		return fmt.Sprintf("ai/limit: rejected (%s, retry in %s)", e.Decision.Reason, e.Decision.RetryAfter)
	}
	return fmt.Sprintf("ai/limit: rejected (%s)", e.Decision.Reason)
}

// Is matches against the package sentinel so errors.Is(err,
// ErrLimited) returns true for any LimitError. Carrying the sentinel
// in the chain lets non-dispatcher callers treat any rejection as
// the same class without unpacking the Decision.
func (e *LimitError) Is(target error) bool {
	return target == ErrLimited
}

// Unwrap returns the package sentinel.
func (e *LimitError) Unwrap() error {
	return ErrLimited
}

// NewLimitError wraps decision in a [*LimitError]. Returns nil when
// decision.Allowed is true so callers can do
// `return inner.Chat(ctx, req); err == nil ... return NewLimitError(d)`
// without a redundant guard.
func NewLimitError(d Decision) *LimitError {
	if d.Allowed {
		return nil
	}
	return &LimitError{Decision: d}
}
