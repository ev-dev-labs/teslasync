package chargeplanner

import "github.com/ev-dev-labs/teslasync/internal/signal"

// toFloatOk parses a value to float64 and returns whether the signal was present.
func toFloatOk(v interface{}) (float64, bool) {
	return signal.Float64(v)
}
