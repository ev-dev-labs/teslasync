// Package exportcolumns serves GET /api/v1/exports/columns which returns
// the publishable column metadata for each export job type so the
// frontend column picker can render checkboxes without hard-coding the
// catalog (Phase-46 / Prompt 62).
//
// The catalog lives statically in internal/export. Two key concepts the
// frontend relies on:
//
//   - always_included ........ Columns that are emitted regardless of the
//     user's selection (e.g. primary keys).
//   - supports_selection ..... When false, the export type is recognised
//     but its column set is dynamic (e.g. account
//     exports span many tables) and the picker UI
//     should be hidden. Unknown types also return
//     200/false (rather than 404) so the client
//     can ask uniformly without branching on
//     status codes.
//
// Layer: handler
package exportcolumns
