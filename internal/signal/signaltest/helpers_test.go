package signaltest

import (
	"reflect"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// equalSignalValue compares two opaque signal values by deep equality so tests
// can assert on numeric, string, bool, and structured (slice/map) payloads
// alike.
func equalSignalValue(a, b signal.SignalValue) bool {
	return reflect.DeepEqual(a, b)
}
