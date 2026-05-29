package triage

// ai_alert_inbox_categorizer.go provides the cron surface for the
// inbox-auto-categorization feature (`ai_alert_inbox_categorizer` in the
// features registry's JobNames list).
//
// The stub is fail-closed by design: every tick re-reads the
// settings table and refuses to do anything when ai_mode is off
// OR the per-feature toggle is off (ADR-015 §I12 #3 — "background
// dispatcher gate trips before execution"). The real fan-out
// implementation (walk every user_subject, recompute the category
// histogram over the user's most recent notification_log window,
// and emit an `ai_alert_category_suggested` push notification when
// a previously-rare category crosses a threshold so the inbox
// page can surface "you have 5 new tire-related alerts since yesterday"
// without the user opening the AI panel) will land with the push fan-out
// implementation; this file ships the gate and telemetry envelope so the
// off-mode invariant is provable today.
//
// The function is exported so a future scheduler (cmd/scheduler
// or the existing internal/worker pool) can install it on a
// once-per-hour cron without further plumbing changes.
//
// Why a job and not an inline categorizer:
//
//   - The notification-log corpus is per-user (alerts belong to a
//     user via the vehicle); a single scheduled tick walks every
//     user_subject and runs the deterministic category-bucketing
//     mapper from internal/ai/tools/inbox_auto_categorization.go
//     against the user's most recent rows. Doing it inline on
//     every InboxBody render would burn DB cycles for stale data
//     because the bucketing is a pure function of (rule, count)
//     pairs that change at most once per minute.
//   - The push notification fan-out is naturally batchable; a
//     once-per-hour tick coalesces "5 new tire alerts in the last
//     hour" into a single push instead of one per arrival.
//   - Off-mode users MUST NOT receive AI-attributed pushes; the
//     fail-closed gate makes that contract structurally
//     impossible to violate.

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// AlertInboxSettingsReader is the narrow view of
// [settingsdb.SettingsRepo] [RunAlertInbox] depends
// on. Defined inline so callers can supply a fake without
// dragging the full settings repo into job tests.
//
// AIFeatureEnabled returns the per-feature toggle for the given
// feature ID. The job re-checks this on every tick so an admin
// who disables inbox-auto-categorization mid-day sees the next
// run no-op immediately (no waiting for the worker pool to
// recycle).
type AlertInboxSettingsReader interface {
	AIMode(ctx context.Context) (string, error)
	AIFeatureEnabled(ctx context.Context, featureID string) (bool, error)
}

// AlertInboxResult reports the outcome of one tick. The fields are ints
// because the fan-out implementation will tally per-user category suggestions;
// today they stay zero because this gate emits no pushes.
type AlertInboxResult struct {
	// Skipped is 1 when the tick early-returned because ai_mode
	// was off OR the per-feature toggle was off. Reported
	// separately from "no work to do" so the ops dashboard can
	// distinguish a degraded settings table from an idle hour.
	Skipped int

	// UsersConsidered is the number of user_subject rows the tick fanned out
	// a category recompute for. It stays 0 until fan-out is implemented,
	// but remains in the envelope so callers can pin the shape today.
	UsersConsidered int

	// PushesEmitted is the number of `ai_alert_category_suggested` pushes
	// the tick wrote to the push queue. It stays 0 until fan-out is implemented.
	PushesEmitted int

	// Failed is the number of users whose recompute failed. It stays 0
	// until fan-out is implemented.
	Failed int
}

// RunAlertInbox is the once-per-hour cron entry for
// inbox-auto-categorization background fan-out.
//
// Re-checks ai_mode + the per-feature toggle at execution time
// per ADR-015 §I12 #3 — the scheduler may have started this loop
// while AI was on, but the admin can flip ai_mode='off' OR
// disable the toggle at any moment and we MUST honour it
// immediately. If either gate is off the function returns
// ([AlertInboxResult{Skipped: 1}], nil) without
// touching the LLM, the bucketer, or the push queue.
//
// Settings read failures are LOGGED WARN and treated as off (no
// fan-out). Fail-closed semantics: a degraded settings table
// must not silently leak push notifications to off-mode users.
//
// The current implementation is deliberately a no-op gate. The
// per-user recompute loop, histogram diff, and push-queue plumbing are
// deferred. Today's contract:
//
//   - off mode (any kind) → Skipped=1, no DB writes, no pushes;
//   - on mode             → Skipped=0, no DB writes (yet), no pushes;
//   - errors              → only on nil-arg programming bugs.
func RunAlertInbox(
	ctx context.Context,
	db *database.DB,
	settings AlertInboxSettingsReader,
) (AlertInboxResult, error) {
	if db == nil {
		return AlertInboxResult{}, fmt.Errorf("jobs: RunAlertInbox requires non-nil db")
	}
	if settings == nil {
		return AlertInboxResult{}, fmt.Errorf("jobs: RunAlertInbox requires non-nil settings")
	}

	mode, err := settings.AIMode(ctx)
	if err != nil {
		log.Warn().Err(err).
			Str("job", "ai_alert_inbox_categorizer").
			Msg("settings read failed, treating as ai_mode=off (no fan-out)")
		return AlertInboxResult{Skipped: 1}, nil
	}
	if mode == rag.AIModeOff {
		log.Debug().
			Str("job", "ai_alert_inbox_categorizer").
			Msg("ai_mode=off, skipping (per ADR-015 §I12 #3)")
		return AlertInboxResult{Skipped: 1}, nil
	}

	enabled, err := settings.AIFeatureEnabled(ctx, "inbox-auto-categorization")
	if err != nil {
		log.Warn().Err(err).
			Str("job", "ai_alert_inbox_categorizer").
			Str("feature_id", "inbox-auto-categorization").
			Msg("per-feature toggle read failed, treating as off (no fan-out)")
		return AlertInboxResult{Skipped: 1}, nil
	}
	if !enabled {
		log.Debug().
			Str("job", "ai_alert_inbox_categorizer").
			Str("feature_id", "inbox-auto-categorization").
			Msg("inbox-auto-categorization toggle off, skipping (per ADR-015 §I7)")
		return AlertInboxResult{Skipped: 1}, nil
	}

	// In on mode, return a zeroed envelope until per-user recompute,
	// histogram diff, and push emission are implemented. This gives callers
	// a stable shape and gives the off-mode tests a positive control.
	log.Debug().
		Str("job", "ai_alert_inbox_categorizer").
		Msg("ai_mode + feature on; fan-out implementation pending future slice")
	return AlertInboxResult{}, nil
}
