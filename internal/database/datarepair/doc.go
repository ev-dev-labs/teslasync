// Package datarepair holds the READ-ONLY change-feed queries that back the
// evidence-based session-repair diagnosis served at
// GET /api/v1/data-repair/suggestions.
//
// Layer: adapter
//
// Scope boundary (ADR-002): every query here is a change-feed / aggregation
// read over durable history — "what is the FIRST row after T", "what is the
// LAST row before T". Point-in-time state reconstruction ("what was the value
// of X at T", which requires forward-folding the whole feed) belongs in
// internal/signal behind signal.StateReader and is deliberately NOT done here.
//
// Nothing in this package mutates. The explicit apply path reuses the existing
// chargingdb / drivedb PartialUpdate writers via the data-repair handler.
//
// Recommended caller alias:
//
//	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
package datarepair
