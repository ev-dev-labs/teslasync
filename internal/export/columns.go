package export

import (
	"fmt"
)

// ColumnInfo describes a single output column for an export type. Returned
// by AvailableColumns and surfaced through the public
// GET /api/v1/exports/columns endpoint so the frontend can render a column
// picker. AlwaysIncluded columns cannot be omitted by the caller; they are
// silently re-added when the request omits them so primary keys / required
// fields can never be dropped from the output file.
type ColumnInfo struct {
	Name           string `json:"name"`
	Label          string `json:"label"`
	AlwaysIncluded bool   `json:"always_included"`
}

// columnCatalog enumerates the columns produced by each export type's
// writer. Keep in sync with the actual writers in processor.go (drives,
// charging) — adding a column there REQUIRES an entry here so the picker
// surfaces it.
//
// "account" is intentionally omitted: account exports are multi-table ZIPs
// whose column set is dynamic per-table. Callers may still pass a Columns
// allowlist on an account request — it is applied as an intersection per
// table inside snapshotToCSV — but there is no single canonical column
// list to expose through this endpoint.
var columnCatalog = map[string][]ColumnInfo{
	"drives": {
		{Name: "id", Label: "ID", AlwaysIncluded: true},
		{Name: "vehicle_id", Label: "Vehicle ID", AlwaysIncluded: true},
		{Name: "start_date", Label: "Start date"},
		{Name: "end_date", Label: "End date"},
		{Name: "distance", Label: "Distance"},
		{Name: "duration_min", Label: "Duration (min)"},
		{Name: "speed_max", Label: "Max speed"},
	},
	"charging": {
		{Name: "id", Label: "ID", AlwaysIncluded: true},
		{Name: "vehicle_id", Label: "Vehicle ID", AlwaysIncluded: true},
		{Name: "started_at", Label: "Started at"},
		{Name: "ended_at", Label: "Ended at"},
		{Name: "total_energy_added_wh", Label: "Energy added (Wh)"},
		{Name: "start_soc_pct", Label: "Start SoC (%)"},
		{Name: "end_soc_pct", Label: "End SoC (%)"},
		{Name: "peak_power_w", Label: "Peak power (W)"},
		{Name: "duration_s", Label: "Duration (s)"},
	},
}

// AvailableColumns returns the column metadata for the given export job
// type. Returns nil for unknown types and for types that do not support
// per-column selection (e.g. analytics, backup, account).
func AvailableColumns(jobType string) []ColumnInfo {
	cols, ok := columnCatalog[jobType]
	if !ok {
		return nil
	}
	out := make([]ColumnInfo, len(cols))
	copy(out, cols)
	return out
}

// SupportsColumnSelection reports whether the export type publishes a
// fixed column list that a caller can subset.
func SupportsColumnSelection(jobType string) bool {
	_, ok := columnCatalog[jobType]
	return ok
}

// resolveColumnSelection validates a caller-supplied column allowlist
// against the catalog for jobType and returns the effective ordered list
// of columns to emit. When the caller requested no columns (nil/empty),
// all catalog columns are returned in catalog order — preserving the
// pre-Phase-46/62 default behaviour byte-for-byte.
//
// AlwaysIncluded columns are silently appended (in catalog order) when
// missing from the request, so primary keys / vehicle ID can never be
// dropped from the output file.
//
// Returns an error when any requested column is not in the catalog.
func resolveColumnSelection(jobType string, requested []string) ([]ColumnInfo, error) {
	catalog, ok := columnCatalog[jobType]
	if !ok {
		// Unknown / unsupported type — fall back to whatever the writer
		// emits natively (no filtering).
		return nil, nil
	}
	if len(requested) == 0 {
		out := make([]ColumnInfo, len(catalog))
		copy(out, catalog)
		return out, nil
	}

	byName := make(map[string]ColumnInfo, len(catalog))
	for _, c := range catalog {
		byName[c.Name] = c
	}

	seen := make(map[string]bool, len(requested))
	resolved := make([]ColumnInfo, 0, len(requested)+2)
	for _, name := range requested {
		info, ok := byName[name]
		if !ok {
			return nil, fmt.Errorf("unknown column: %s", name)
		}
		if seen[name] {
			continue
		}
		seen[name] = true
		resolved = append(resolved, info)
	}

	// Re-add any AlwaysIncluded columns the caller omitted, preserving
	// their catalog order at the front of the output.
	missingRequired := make([]ColumnInfo, 0)
	for _, c := range catalog {
		if c.AlwaysIncluded && !seen[c.Name] {
			missingRequired = append(missingRequired, c)
		}
	}
	if len(missingRequired) > 0 {
		resolved = append(missingRequired, resolved...)
	}
	return resolved, nil
}

// columnNames is a convenience that extracts the Name slice from a list
// of ColumnInfo, in order. Used by writers to produce the CSV header row
// and to look up cell values.
func columnNames(cols []ColumnInfo) []string {
	out := make([]string, len(cols))
	for i, c := range cols {
		out[i] = c.Name
	}
	return out
}

// ValidateColumns validates a caller-supplied column allowlist against the
// catalog for jobType. Returns the canonicalised column slice (deduped,
// AlwaysIncluded columns prepended when missing) or an error when any
// requested column is unknown. Used by API handlers to surface a 400
// synchronously instead of waiting for the worker to fail.
//
// Returns (nil, nil) for an empty request — that's the byte-for-byte
// backwards-compat path. Returns (nil, nil) for unknown job types as
// well; callers should consult SupportsColumnSelection first when
// strictness matters.
func ValidateColumns(jobType string, requested []string) ([]string, error) {
	cols, err := resolveColumnSelection(jobType, requested)
	if err != nil {
		return nil, err
	}
	return columnNames(cols), nil
}
