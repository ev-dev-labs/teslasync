package api

// Phase-50 / 0021 — D1 Natural-language drive search and replay.
//
// ai_drive_search_hydrator.go implements trip.DriveReplayHydrator
// using the existing canonical pgSearcher backend. The slice's
// DriveReplayHydrator port resolves a (sourceType, sourceID)
// reference from a RAG chunk into a human-friendly envelope (title,
// subtitle, url, replay_url, when) suitable for citation in the
// LLM's narration, WITH the replay anchor the user can jump to.
//
// Why pgSearcher and not bespoke per-source repos:
//
//   - pgSearcher already implements SearchDrives with deterministic
//     title / subtitle / url renderers — the same renderers the
//     typed GET /api/v1/search baseline uses. Reusing the renderers
//     means a hydrated AI citation is byte-equivalent to a typed
//     search hit (ADR-015 §I3 baseline-intact: no duplicate read
//     path, no risk of UI drift).
//
//   - We need ONLY the renderer's idHint match path: when q parses
//     as an int64, the underlying SQL adds an exact-ID match bonus
//     and ranks the matching row first. Calling SearchDrives with
//     the source_id as both q and idHint, limit=1, returns the
//     apisearch.SearchHit for that drive in O(1) — no new SQL, no new repo.
//
// Replay URL derivation:
//
//   - apisearch.SearchHit.URL is the SPA detail route ("/drives/{id}"). The
//     canonical replay route on the SPA side is
//     "/drives/{id}/replay" (see web/src/router/routeRegistry.ts —
//     TripReplayPage is mounted at "/drives/:id/replay"). We
//     derive the replay URL by appending "/replay" to the existing
//     URL renderer's output. This keeps the SPA path in ONE source
//     of truth (the renderer); when a future refactor renames the
//     detail route, the replay anchor follows automatically.
//
//   - route_segment and location_summary source types have no
//     dedicated drive-replay surface — they are forward-compat
//     reservations per the slice prompt. The hydrator returns a
//     not_found for them today; the strategy's narration falls
//     back to a generic "no replay anchor for this source type"
//     phrasing.
//
// Constraint: the apisearch.Searcher interface does not currently scope by
// user_subject (per-install single-tenant assumption). The
// hydrator accepts a userSubject parameter for future-compat —
// when per-user scoping is added to the existing apisearch.Searcher, the
// hydrator's signature already matches and no caller has to
// change. Same pattern as aiSearchHydrator from slice 0017.

import (
	"context"
	"errors"
	"strconv"

	apisearch "github.com/ev-dev-labs/teslasync/internal/api/search"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/trip"
)

// aiDriveSearchHydrator is the production
// trip.DriveReplayHydrator implementation. One per process;
// stateless beyond the apisearch.Searcher port. Safe for concurrent use
// across requests.
type aiDriveSearchHydrator struct {
	s apisearch.Searcher
}

// newAIDriveSearchHydrator constructs the production hydrator. The
// constructor panics on a nil apisearch.Searcher so a wiring bug surfaces at
// boot, not at the first AI drive-search request.
func newAIDriveSearchHydrator(s apisearch.Searcher) *aiDriveSearchHydrator {
	if s == nil {
		panic("api: newAIDriveSearchHydrator: nil apisearch.Searcher")
	}
	return &aiDriveSearchHydrator{s: s}
}

// HydrateOne implements [trip.DriveReplayHydrator]. Delegates to
// the canonical pgSearcher's SearchDrives method using the
// source_id as both query and idHint, with limit=1, so the
// underlying SQL's exact-ID match bonus selects the target row in
// O(1).
//
// Returns [trip.ErrDriveReplayHydratorNotFound] when no row
// matches the (subject, type, id) tuple — the AI tool surfaces
// this as a status="not_found" envelope so the LLM can adapt its
// narration without retrying.
func (h *aiDriveSearchHydrator) HydrateOne(ctx context.Context, _userSubject, sourceType, sourceID string) (*trip.HydratedDriveReplay, error) {
	// route_segment and location_summary are forward-compat
	// reservations per the slice prompt — no canonical replay
	// surface today. Surface as not_found so the LLM can adapt
	// without retrying; a future indexer slice that lights up
	// these sources should add per-type cases here.
	if sourceType != rag.SourceDriveSummary {
		// Defence in depth: validate the type IS in the allowed
		// set; an unknown type is also not_found.
		switch sourceType {
		case "route_segment", "location_summary":
			return nil, trip.ErrDriveReplayHydratorNotFound
		default:
			return nil, trip.ErrDriveReplayHydratorNotFound
		}
	}

	idHint, err := strconv.ParseInt(sourceID, 10, 64)
	if err != nil {
		// Non-numeric source_id is impossible for the
		// drive_summary corpus (drive IDs are int64). Surface
		// as not_found rather than a tool error so the LLM can
		// adapt.
		return nil, trip.ErrDriveReplayHydratorNotFound
	}

	hits, err := h.s.SearchDrives(ctx, sourceID, idHint, 1)
	if err != nil {
		return nil, err
	}
	for _, hit := range hits {
		if hit.ID == idHint {
			out := &trip.HydratedDriveReplay{
				SourceType: sourceType,
				SourceID:   sourceID,
				Title:      hit.Title,
				Subtitle:   hit.Subtitle,
				URL:        hit.URL,
				// Append "/replay" to the canonical detail
				// route. Empty URL produces empty ReplayURL
				// rather than the misleading "/replay" string;
				// callers can fall back to URL when ReplayURL
				// is empty.
				ReplayURL: appendReplay(hit.URL),
			}
			if hit.When != nil {
				out.When = hit.When.UTC().Format("2006-01-02T15:04:05Z07:00")
			}
			return out, nil
		}
	}
	return nil, trip.ErrDriveReplayHydratorNotFound
}

// appendReplay derives "/drives/{id}/replay" from "/drives/{id}".
// Returns empty string when url is empty so the caller can decide
// how to render the missing-anchor case (currently the LLM is
// instructed to drop the anchor from its narration when replay_url
// is absent).
func appendReplay(url string) string {
	if url == "" {
		return ""
	}
	return url + "/replay"
}

// Compile-time assertion: aiDriveSearchHydrator satisfies
// trip.DriveReplayHydrator.
var _ trip.DriveReplayHydrator = (*aiDriveSearchHydrator)(nil)

// _ is a compile-time guard against the package-private errors
// import drifting. The import is genuinely required (future
// additions may rely on errors.New / errors.Is). Pinning prevents
// goimports from removing it during a future refactor.
var _ = errors.New
