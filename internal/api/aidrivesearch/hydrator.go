package aidrivesearch

// Natural-language drive search and replay hydrator.
//
// This hydrator reuses the canonical search renderer so AI drive citations match
// typed /search results and inherit route changes. route_segment and
// location_summary remain forward-compatible reservations and return not_found
// until a canonical replay surface exists for them.

import (
	"context"
	"strconv"

	apisearch "github.com/ev-dev-labs/teslasync/internal/api/search"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/trip"
)

// hydrator is the production
// trip.DriveReplayHydrator implementation. One per process;
// stateless beyond the apisearch.Searcher port. Safe for concurrent use
// across requests.
type hydrator struct {
	s apisearch.Searcher
}

// NewHydrator constructs the production hydrator for router wiring.
func NewHydrator(s apisearch.Searcher) trip.DriveReplayHydrator {
	return newHydrator(s)
}

// newHydrator constructs the production hydrator. The constructor panics on a
// nil apisearch.Searcher so a wiring bug surfaces at boot, not at the first AI
// drive-search request.
func newHydrator(s apisearch.Searcher) *hydrator {
	if s == nil {
		panic("aidrivesearch: newHydrator: nil apisearch.Searcher")
	}
	return &hydrator{s: s}
}

// HydrateOne implements [trip.DriveReplayHydrator]. It uses the canonical search
// exact-ID path, returning not_found envelopes instead of retryable tool errors
// when a cited source cannot produce a replay anchor.
func (h *hydrator) HydrateOne(ctx context.Context, _userSubject, sourceType, sourceID string) (*trip.HydratedDriveReplay, error) {
	// Reserved source types have no canonical replay surface yet.
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

// Compile-time assertion: hydrator satisfies
// trip.DriveReplayHydrator.
var _ trip.DriveReplayHydrator = (*hydrator)(nil)
