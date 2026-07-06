package telemetry

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// restoreLogGlobals snapshots the mutable zerolog globals InitLogger touches
// and restores them when the test ends, so global-state tests can't leak into
// one another regardless of execution order.
func restoreLogGlobals(t *testing.T) {
	t.Helper()
	lvl := zerolog.GlobalLevel()
	logger := log.Logger
	timeFmt := zerolog.TimeFieldFormat
	t.Cleanup(func() {
		zerolog.SetGlobalLevel(lvl)
		log.Logger = logger
		zerolog.TimeFieldFormat = timeFmt
	})
}

func TestParseLevel(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want zerolog.Level
	}{
		{"trace", "trace", zerolog.TraceLevel},
		{"debug", "debug", zerolog.DebugLevel},
		{"info", "info", zerolog.InfoLevel},
		{"warn", "warn", zerolog.WarnLevel},
		{"error", "error", zerolog.ErrorLevel},
		{"fatal", "fatal", zerolog.FatalLevel},
		{"panic", "panic", zerolog.PanicLevel},
		{"disabled", "disabled", zerolog.Disabled},
		{"case insensitive", "INFO", zerolog.InfoLevel},
		{"mixed case warn", "WaRn", zerolog.WarnLevel},
		{"numeric warn", "2", zerolog.WarnLevel},
		{"numeric trace", "-1", zerolog.TraceLevel},
		// zerolog treats "" as its NoLevel marker and returns no error, so the
		// fallback branch is NOT taken — pin that documented behaviour.
		{"empty is nolevel", "", zerolog.NoLevel},
		// Genuinely unparseable inputs hit the error branch and fall back.
		{"unknown word falls back", "bogus", zerolog.InfoLevel},
		{"near miss falls back", "warning", zerolog.InfoLevel},
		{"out of bounds falls back", "9999", zerolog.InfoLevel},
		{"whitespace falls back", "  info  ", zerolog.InfoLevel},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := parseLevel(tc.in); got != tc.want {
				t.Errorf("parseLevel(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

func TestInitLogger_SetsGlobalLevel(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want zerolog.Level
	}{
		{"debug applies", "debug", zerolog.DebugLevel},
		{"warn applies", "warn", zerolog.WarnLevel},
		{"error applies", "error", zerolog.ErrorLevel},
		{"invalid falls back to info", "not-a-level", zerolog.InfoLevel},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			restoreLogGlobals(t)
			InitLogger(tc.in)
			if got := zerolog.GlobalLevel(); got != tc.want {
				t.Errorf("after InitLogger(%q) GlobalLevel()=%v, want %v", tc.in, got, tc.want)
			}
			if zerolog.TimeFieldFormat != time.RFC3339 {
				t.Errorf("TimeFieldFormat=%q, want RFC3339", zerolog.TimeFieldFormat)
			}
		})
	}
}

func TestInitLogger_ReplacesGlobalLogger(t *testing.T) {
	restoreLogGlobals(t)
	zerolog.SetGlobalLevel(zerolog.TraceLevel)

	// Point the global logger at a sink we control, then let InitLogger run.
	var sentinel bytes.Buffer
	log.Logger = zerolog.New(&sentinel)

	InitLogger("info")

	// InitLogger must repoint log.Logger to os.Stdout, so subsequent writes
	// no longer land in our sentinel buffer.
	log.Info().Msg("after init: this line goes to stdout, not the sentinel")
	if sentinel.Len() != 0 {
		t.Errorf("global logger still writing to the pre-init sink: %s", sentinel.String())
	}
}

func TestNewLogger_EmitsStructuredJSON(t *testing.T) {
	restoreLogGlobals(t)
	zerolog.SetGlobalLevel(zerolog.TraceLevel) // ensure Info is not filtered out

	var buf bytes.Buffer
	lg := newLogger(&buf)
	lg.Info().Str("component", "telemetry").Int("attempt", 3).Msg("hello world")

	line := strings.TrimSpace(buf.String())
	if line == "" {
		t.Fatal("newLogger produced no output")
	}

	var fields map[string]any
	if err := json.Unmarshal([]byte(line), &fields); err != nil {
		t.Fatalf("output is not valid JSON: %v\nraw: %s", err, line)
	}

	if fields["level"] != "info" {
		t.Errorf("level=%v, want info", fields["level"])
	}
	if fields["message"] != "hello world" {
		t.Errorf("message=%v, want %q", fields["message"], "hello world")
	}
	if fields["component"] != "telemetry" {
		t.Errorf("component=%v, want telemetry", fields["component"])
	}
	// JSON numbers decode as float64.
	if attempt, ok := fields["attempt"].(float64); !ok || attempt != 3 {
		t.Errorf("attempt=%v, want 3", fields["attempt"])
	}
	if _, ok := fields["time"]; !ok {
		t.Error("expected a timestamp field")
	}
	caller, ok := fields["caller"].(string)
	if !ok || !strings.Contains(caller, ".go") {
		t.Errorf("caller=%v, want a *.go reference", fields["caller"])
	}
}

func TestNewLogger_RespectsGlobalLevelFiltering(t *testing.T) {
	restoreLogGlobals(t)
	zerolog.SetGlobalLevel(zerolog.ErrorLevel)

	var buf bytes.Buffer
	lg := newLogger(&buf)

	// Below-threshold events are dropped...
	lg.Info().Msg("suppressed")
	lg.Warn().Msg("also suppressed")
	if buf.Len() != 0 {
		t.Fatalf("expected sub-threshold events to be filtered, got: %s", buf.String())
	}

	// ...while at-or-above-threshold events pass through.
	lg.Error().Msg("emitted")
	if !strings.Contains(buf.String(), "emitted") {
		t.Errorf("expected error event to be written, got: %s", buf.String())
	}
}
