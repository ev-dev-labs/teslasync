package api

import "github.com/rs/zerolog/log"

// safeGo runs fn in a goroutine with panic recovery.
// Any panic is logged but does NOT crash the process.
func safeGo(name string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Error().
					Interface("panic", r).
					Str("goroutine", name).
					Msg("recovered panic in background goroutine")
			}
		}()
		fn()
	}()
}
