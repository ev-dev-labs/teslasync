// Package diagnosis contains the charging-diagnosis AI tool.
//
// Layer: domain
//
// This package is distinct from internal/ai/tools/diagnostic, the
// general-purpose diagnostic tool family. It provides the charging
// flag-detection, cost-per-kWh, and power-curve diagnosis tool registered
// as query_charging_diagnosis_context.
//
// RegisterChargingDiagnosisTools preserves the public tool names expected
// by the dispatcher and registry wiring.
package diagnosis
