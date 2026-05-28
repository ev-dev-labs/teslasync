// Package trip carves the auto-trip-naming, drive-search, and share-card
// narration tool family out of the parent internal/ai/tools/ flat package per
// ADR-011 §3 (bounded-context subpackages) + ADR-015-amend (AI subsystem in
// scope for Phase R, file-move-only). The three tools share a "trip artefact
// summary or surface" theme and a strict Layer: domain charter:
//
//	auto_name.go    — RegisterAutoTripNamingTools + AutoTripName*
//	drive_search.go — RegisterDriveSearchTools + retrieve_drive_chunks +
//	                  hydrate_drive_replay + ErrDriveReplayHydratorNotFound
//	share_card.go   — RegisterShareCardImageTools + ShareCardImage*
//
// Cross-cluster contract preserved verbatim per ADR-015 §I12 (AI-Off Contract):
// every exported type/interface/function name, JSON tag, schema field name,
// and Execute payload shape is identical to the pre-R6.14 parent-pkg version.
// ai-vet + aigen mirror at web/src/ai/features.ts verify this at gate time.
//
// Lesson 8 (R6.14 — cross-file unexported helper orphaning): the PII-redaction
// regex vars reLatLong / reStreetAddr originally lived in share_card_image.go
// AND were referenced by paint_preview.go (which stays in the parent pkg as a
// shared-fixture blocker until toolstest prep). The carve PROMOTED them to
// exported parent helpers tools.ReLatLong / tools.ReStreetAddr in a new file
// internal/ai/tools/redact_regex.go so both the carved share_card.go (via
// tools.ReLatLong) and the still-in-parent paint_preview.go (via bare
// ReLatLong, same pkg) keep compiling. Same pattern as R6.4 CachedSchema
// export.
//
// Test-fixture duplication (Lesson 6 R6.7, deferred): drive_search_test.go
// needs fakeRetriever which is defined in the parent search_test.go. We
// duplicate the minimal definition in fakes_retriever_test.go until a
// future internal/ai/tools/toolstest exported fixture package lands.
//
// Alias convention (ADR-011 §3): callsites importing this package alongside
// other clusters MAY alias as `tripaitools` to disambiguate from
// internal/app/tripsvc or other "trip" packages elsewhere in the tree. The
// composition root in internal/api/router.go imports it without alias because
// no collision exists there.
//
// Layer: domain
package trip
