package api

import (
	"io"
	"os"
	"strings"
	"sync"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/platform"
)

// adminLogStreamTapState guards installAdminLogStreamTap so the global
// zerolog.Logger is teed to a LogSubscriberRegistry exactly once per
// process even when NewRouter is invoked multiple times (router tests
// run in parallel inside the same binary). The first call captures the
// pre-existing logger sink as `primary` and re-assigns the global
// log.Logger to a MultiLevelWriter; subsequent calls swap the registry
// pointer in-place via SetTarget so a fresh router still receives
// events without rebuilding the underlying tee.
var adminLogStreamTapState struct {
	mu      sync.Mutex
	primary io.Writer
	current *adminLogStreamTapForwarder
}

// adminLogStreamTapForwarder satisfies zerolog.LevelWriter by
// delegating to a swappable target registry. SetTarget is called on
// every NewRouter invocation so each router instance owns the
// registry it hands to its handler — without this, a stale registry
// from a previous test would silently swallow events.
type adminLogStreamTapForwarder struct {
	mu     sync.RWMutex
	target zerolog.LevelWriter
}

func (f *adminLogStreamTapForwarder) Write(p []byte) (int, error) {
	f.mu.RLock()
	t := f.target
	f.mu.RUnlock()
	if t == nil {
		return len(p), nil
	}
	return t.Write(p)
}

func (f *adminLogStreamTapForwarder) WriteLevel(level zerolog.Level, p []byte) (int, error) {
	f.mu.RLock()
	t := f.target
	f.mu.RUnlock()
	if t == nil {
		return len(p), nil
	}
	return t.WriteLevel(level, p)
}

func (f *adminLogStreamTapForwarder) SetTarget(t zerolog.LevelWriter) {
	f.mu.Lock()
	f.target = t
	f.mu.Unlock()
}

// installAdminLogStreamTap wires the zerolog global logger so every
// log record fans out to the supplied registry in addition to the
// configured primary sink. The first invocation chooses the primary
// sink (ConsoleWriter when TESLASYNC_DEV=true, otherwise os.Stdout)
// and rewires log.Logger via zerolog.MultiLevelWriter; subsequent
// invocations only swap the registry pointer.
func installAdminLogStreamTap(reg *platform.LogSubscriberRegistry) {
	adminLogStreamTapState.mu.Lock()
	defer adminLogStreamTapState.mu.Unlock()
	if adminLogStreamTapState.current == nil {
		var primary io.Writer = os.Stdout
		if strings.EqualFold(os.Getenv("TESLASYNC_DEV"), "true") {
			primary = zerolog.ConsoleWriter{Out: os.Stderr}
		}
		fwd := &adminLogStreamTapForwarder{target: reg}
		adminLogStreamTapState.primary = primary
		adminLogStreamTapState.current = fwd
		log.Logger = log.Logger.Output(zerolog.MultiLevelWriter(primary, fwd))
		return
	}
	adminLogStreamTapState.current.SetTarget(reg)
}
