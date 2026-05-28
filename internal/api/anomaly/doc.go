// Package anomaly serves GET /api/v1/analytics/anomalies and exports the
// shared [Handler.DetectAnomalies] detector consumed by the anomaly AI tool.
//
// Wire-shape stability: the canonical /api/v1/analytics/anomalies JSON shape
// is BYTE-IDENTICAL with the pre-carve parent-package handler. A contract test
// (handler_test.go::TestGetAnomalies_WireShapeUnchanged) pins the JSON field
// list and the load-bearing empty-slice semantics so frontend hooks keep seeing
// `"anomalies":[]`, not `null`.
//
// Layer: handler
package anomaly
