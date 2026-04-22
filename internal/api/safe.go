package api

import (
	"runtime/debug"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/metrics"
)

// safeGo runs fn in a goroutine with panic recovery.
// Any panic is logged, counted via metrics.PanicsRecovered, and does NOT crash the process.
func safeGo(name string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				metrics.PanicsRecovered.WithLabelValues(name).Inc()
				log.Error().
					Interface("panic", r).
					Str("goroutine", name).
					Bytes("stack", debug.Stack()).
					Msg("recovered panic in background goroutine")
			}
		}()
		fn()
	}()
}
