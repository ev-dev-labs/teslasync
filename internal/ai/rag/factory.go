package rag

import (
	"context"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// SettingsReader is the narrow view of [settingsdb.SettingsRepo] the
// factory depends on. We do not pin to *SettingsRepo so the rag
// package can be tested with a fake reader (no DB required) and so a
// future settings backend swap doesn't ripple through every retriever
// caller.
type SettingsReader interface {
	// AIMode returns the current AI mode: "off" | "local" | "cloud".
	// Errors propagate so the factory can fail closed (treat any
	// settings read failure as off — see [New]).
	AIMode(ctx context.Context) (string, error)
}

// AIModeOff is the value returned by [SettingsReader.AIMode] when
// AI is disabled. Mirrors the constant used by the settings repo so
// a typo on either side is caught at compile time.
const AIModeOff = "off"

// New constructs a [Retriever] honouring the global AI gate.
//
// The returned retriever is:
//   - [NoopRetriever] when ai_mode='off' OR the settings read fails
//     (fail-closed semantics — a degraded settings table MUST NOT
//     accidentally enable network egress; see ADR-015 §I1).
//   - [PgvectorRetriever] when ai_mode is on and the model is known.
//
// The factory is invoked at construction time (typically from
// app.New() or from a feature constructor in N3/N6/D2/D5/C4). It
// reads the mode ONCE at construction; live mode flips that happen
// later are caught by the per-call [ProviderResolver.For] gate
// inside PgvectorRetriever (see ADR-015 §I12 — background jobs and
// long-lived caches re-check the mode at execution).
//
// Pre-conditions and error cases:
//   - settings : non-nil. Programmer error → panic.
//   - db       : non-nil when not in off-mode. (When off-mode, db
//     may be nil — the noop never touches it.)
//   - resolver : non-nil when not in off-mode. Same rationale.
//   - featureID: non-empty when not in off-mode. PgvectorRetriever
//     requires it to stamp the audit log row.
//   - model    : when not in off-mode, must be present in
//     [modelDims]. Returns [ErrUnknownModel] otherwise.
//
// Why fail-closed on settings error: an admin who flipped AI off
// expects no further AI calls. If we returned an error and the
// caller fell back to "default on", a transient DB blip during boot
// would silently re-enable AI for the duration of the process. The
// noop short-circuit removes that failure mode entirely.
func New(
	ctx context.Context,
	settings SettingsReader,
	db *database.DB,
	resolver ProviderResolver,
	featureID string,
	model string,
) (Retriever, error) {
	if settings == nil {
		panic("rag: New called with nil settings")
	}

	mode, err := settings.AIMode(ctx)
	if err != nil {
		// Fail closed — see godoc rationale above.
		return NoopRetriever{}, nil
	}
	if mode == AIModeOff {
		return NoopRetriever{}, nil
	}

	if db == nil {
		return nil, fmt.Errorf("rag: New requires db when ai_mode=%q", mode)
	}
	if resolver == nil {
		return nil, fmt.Errorf("rag: New requires resolver when ai_mode=%q", mode)
	}
	return NewPgvectorRetriever(db, resolver, featureID, model)
}
