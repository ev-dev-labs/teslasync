// Package dataquality serves ADR-009 data-quality scoring and signal-lineage
// read endpoints.
//
// GET /api/v1/admin/observability/data-quality scores signal_log freshness,
// gaps, and duplicates; GET /api/v1/admin/observability/lineage returns the
// embedded routing DAG.
//
// Layer: handler
package dataquality
