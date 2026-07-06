package telemetry

import (
	"io"
	"os"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// InitLogger configures the global zerolog logger with JSON output written to
// stdout, RFC3339 timestamps, and caller annotation. The supplied level string
// is parsed leniently: an unrecognised value falls back to InfoLevel so a
// misconfigured LOG_LEVEL never disables logging outright.
func InitLogger(level string) {
	// TimeFieldFormat is read at event-encode time, so setting it before the
	// logger is constructed keeps every subsequent write on RFC3339.
	zerolog.TimeFieldFormat = time.RFC3339
	zerolog.SetGlobalLevel(parseLevel(level))
	log.Logger = newLogger(os.Stdout)
}

// parseLevel resolves a textual log level, falling back to InfoLevel when the
// input is not a level zerolog recognises. It is the single branch point tested
// in isolation so InitLogger's global side effects don't have to be.
func parseLevel(level string) zerolog.Level {
	lvl, err := zerolog.ParseLevel(level)
	if err != nil {
		return zerolog.InfoLevel
	}
	return lvl
}

// newLogger builds the structured JSON logger used for the global logger. The
// writer is injectable so tests can assert the emitted field shape without
// racing on os.Stdout.
func newLogger(w io.Writer) zerolog.Logger {
	return zerolog.New(w).
		With().
		Timestamp().
		Caller().
		Logger()
}
