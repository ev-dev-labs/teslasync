// Package coaching is the drive-coaching AI tool carved out of the flat
// internal/ai/tools package per ADR-011 §3 (bounded-context subpackages)
// and the ADR-015 amendment (AI subsystem in scope for Phase R, file-move
// only, no logic or contract changes).
//
// Layer: domain
//
// Contract preservation (per ADR-015 §I12):
//   - RegisterDriveCoachingTools registers exactly the same set of tools
//     under exactly the same names (query_drive_telemetry_summary) as
//     before the carve.
//   - DriveCoachingSources struct mirrors the prior parent-package shape
//     verbatim.
//   - Aivet sees the same surface: "59 AI route(s), 57 feature(s) in
//     registry, 54 SPA wiring entries, TS mirror in sync".
//
// Naming: "coaching" — shorter than "drivecoaching" and clearly scopes
// the bounded context; matches the user-facing feature name "drive
// coaching".
//
// LESSON 12 (NEW, R6.25): drive_coaching.go defined 4 unexported
// pointer-deref helpers (cToFPtr, derefFloat64Ptr, derefInt16Ptr,
// derefStringPtr) that speed_profile.go (still in parent) also depends
// on. Carving drive_coaching → coaching/ would have left
// speed_profile.go with 9 undefined references. RESOLUTION: promote
// those helpers to internal/ai/tools/ptrhelpers.go as EXPORTED parent
// symbols (tools.CToFPtr, tools.DerefFloat64Ptr, tools.DerefInt16Ptr,
// tools.DerefStringPtr). The semantic contract (return `any` so JSON
// emits literal null) is preserved verbatim. Recipe addendum: future
// carves SHOULD `grep` for unexported helpers in the file-being-carved
// and promote any that have parent-package consumers BEFORE the move.
//
// LESSON 13 (NEW, R6.25): failingDrivesImpl (local test-only DriveSource
// in drive_coaching_test.go that embeds fakeDrives) was also referenced
// by speed_profile_test.go. After the carve, speed_profile_test.go got
// a local copy embedding parent's fakeDrives. The coaching/
// failingDrivesImpl was rewritten to embed toolstest.FakeDrives.
// Tiny ~10-line duplication accepted over promoting failingDrivesImpl
// to toolstest (which would have required mid-phase modification of
// the shared package).
//
// LESSON 10 reapplied (R6.22 cycle pattern): cross-tool
// RegisterDriveCoachingTools(...) blocks were stripped from 2 OTHER
// parent tests (charging_diagnosis, speed_profile) plus their
// associated "query_drive_telemetry_summary" expected-name list
// entries. Each stripped test's PRIMARY assertion (its OWN tool
// doesn't shadow builtins) is unaffected.
package coaching
