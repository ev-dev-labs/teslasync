package api

// Phase-50 / 0017 — N3 Natural-language search across drives, charges,
// and alerts.
//
// ai_search_hydrator.go implements tools.Hydrator using the existing
// canonical pgSearcher backend. The slice's Hydrator port resolves a
// (sourceType, sourceID) reference from a RAG chunk into a human-
// friendly envelope (title, subtitle, url, when) suitable for citation
// in the LLM's narration.
//
// Why pgSearcher and not bespoke per-source repos:
//
//   - pgSearcher already implements Search{Drives,Charging,Alerts}
//     with deterministic title / subtitle / url renderers — the same
//     renderers the typed GET /api/v1/search baseline uses. Reusing
//     the renderers means a hydrated AI citation is byte-equivalent
//     to a typed search hit (ADR-015 §I3 baseline-intact: no duplicate
//     read path, no risk of UI drift).
//
//   - We need ONLY the renderer's idHint match path: when q parses
//     as an int64, the underlying SQL adds an exact-ID match bonus
//     and ranks the matching row first. Calling SearchDrives with
//     the source_id as both q and idHint, limit=1, returns the
//     apisearch.SearchHit for that drive in O(1) — no new SQL, no new repo.
//
// Constraint: the apisearch.Searcher interface does not currently scope by
// user_subject (per-install single-tenant assumption). The hydrator
// accepts a userSubject parameter for future-compatibility — when
// per-user scoping is added to the existing apisearch.Searcher, the hydrator's
// signature already matches and no caller has to change.

import (
	"context"
	"errors"
	"strconv"

	apisearch "github.com/ev-dev-labs/teslasync/internal/api/search"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// aiSearchHydrator is the production tools.Hydrator implementation.
// One per process; stateless beyond the apisearch.Searcher port. Safe for
// concurrent use across requests.
type aiSearchHydrator struct {
	s apisearch.Searcher
}

// newAISearchHydrator constructs the production hydrator. The
// constructor panics on a nil apisearch.Searcher so a wiring bug surfaces at
// boot, not at the first AI search request.
func newAISearchHydrator(s apisearch.Searcher) *aiSearchHydrator {
	if s == nil {
		panic("api: newAISearchHydrator: nil apisearch.Searcher")
	}
	return &aiSearchHydrator{s: s}
}

// HydrateOne implements [tools.Hydrator]. Delegates to the
// canonical pgSearcher's per-type Search method using the source_id
// as both query and idHint, with limit=1, so the underlying SQL's
// exact-ID match bonus selects the target row in O(1).
//
// Returns [tools.ErrHydratorNotFound] when no row matches the
// (subject, type, id) tuple — the AI tool surfaces this as a
// status="not_found" envelope so the LLM can adapt its narration
// without retrying.
func (h *aiSearchHydrator) HydrateOne(ctx context.Context, _userSubject, sourceType, sourceID string) (*tools.HydratedResult, error) {
	idHint, err := strconv.ParseInt(sourceID, 10, 64)
	if err != nil {
		// Non-numeric source_id is impossible for the three corpora
		// in the slice's allowlist (drive_summary, charge_session,
		// alert_history all use numeric IDs). Surface as
		// not_found rather than a tool error so the LLM can adapt.
		return nil, tools.ErrHydratorNotFound
	}

	var (
		hits  []apisearch.SearchHit
		fetch func(context.Context, string, int64, int) ([]apisearch.SearchHit, error)
	)
	switch sourceType {
	case rag.SourceDriveSummary:
		fetch = h.s.SearchDrives
	case rag.SourceChargeSession:
		fetch = h.s.SearchCharging
	case rag.SourceAlertHistory:
		fetch = h.s.SearchAlerts
	default:
		// Unknown source type — defence in depth (the tool already
		// rejects unknown types at Validate time, but a future
		// change that widens the tool allowlist without updating
		// this switch would silently fail closed here rather than
		// crash).
		return nil, tools.ErrHydratorNotFound
	}

	hits, err = fetch(ctx, sourceID, idHint, 1)
	if err != nil {
		return nil, err
	}
	for _, h := range hits {
		if h.ID == idHint {
			out := &tools.HydratedResult{
				SourceType: sourceType,
				SourceID:   sourceID,
				Title:      h.Title,
				Subtitle:   h.Subtitle,
				URL:        h.URL,
			}
			if h.When != nil {
				// Match the search-handler convention (RFC3339Nano
				// implicit via *time.Time JSON marshal) — explicit
				// formatting here keeps the wire shape stable
				// regardless of the apisearch.Searcher's marshalling choice.
				out.When = h.When.UTC().Format("2006-01-02T15:04:05Z07:00")
			}
			return out, nil
		}
	}
	return nil, tools.ErrHydratorNotFound
}

// Compile-time assertion: aiSearchHydrator satisfies tools.Hydrator.
var _ tools.Hydrator = (*aiSearchHydrator)(nil)

// _ is a compile-time guard against the package-private errors
// import drifting. The import is genuinely required (newAISearchHydrator
// could in theory return errors.New, and future additions may rely
// on it). Pinning prevents goimports from removing it during a
// future refactor.
var _ = errors.New
