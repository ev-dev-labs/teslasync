// Package trip groups the auto-trip-naming, drive-search, and share-card
// narration tools under the trip bounded context. The three tools share a
// trip-artifact summary or surface theme and a strict Layer: domain charter:
//
//	auto_name.go    — RegisterAutoTripNamingTools + AutoTripName*
//	drive_search.go — RegisterDriveSearchTools + retrieve_drive_chunks +
//	                  hydrate_drive_replay + ErrDriveReplayHydratorNotFound
//	share_card.go   — RegisterShareCardImageTools + ShareCardImage*
//
// Cross-cluster contract preserved verbatim per ADR-015 §I12 (AI-Off Contract):
// every exported type/interface/function name, JSON tag, schema field name,
// and Execute payload shape is identical to the pre-move parent-package version.
// ai-vet + aigen mirror at web/src/ai/features.ts verify this at gate time.
//
// Share-card and paint-preview tools both need the PII-redaction regexes, so
// the shared helpers live in the parent tools package instead of either feature
// file.
//
// drive_search_test.go duplicates the small fakeRetriever fixture until a
// shared internal/ai/tools/toolstest package exists.
//
// Alias convention (ADR-011 §3): callsites importing this package alongside
// other clusters MAY alias as `tripaitools` to disambiguate from
// internal/app/tripsvc or other "trip" packages elsewhere in the tree. The
// composition root in internal/api/router.go imports it without alias because
// no collision exists there.
//
// Layer: domain
package trip
