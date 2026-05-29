// Package anomaly hosts the anomaly-context AI tool.
//
// Layer: domain
//
// Contract notes:
//   - RegisterAnomalyTools registers query_anomaly_context.
//   - AnomalySources, AnomalySource, AnomalyContextResult, and
//     AnomalyContextEntry are the stable public tool shapes.
//
// Alias convention (ADR-011 §3): callsites that ALSO import
// internal/ml/anomaly MUST alias this package as `anomalytool` to avoid
// the bare `anomaly` collision. Currently applied at
// internal/api/router.go. Single-import callsites (anomaly_handler.go,
// anomaly_handler_test.go) use the bare name.
//
// FakeAnomalySource stays local to anomaly_test.go because moving it to
// internal/ai/tools/toolstest would create a package cycle through
// anomaly.AnomalyContextResult.
package anomaly
