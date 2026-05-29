// Package curve contains the charging-curve fingerprint clustering AI tools.
// It is a bounded context under internal/ai/tools for higher-level analysis
// across many charging sessions; internal/ai/tools/charge covers individual
// charge-session basics.
//
// Layer: domain
//
// Contract preservation (ADR-015 §I12):
//   - RegisterChargingCurveFingerprintClusteringTools registers the same tool
//     names exposed by this bounded context.
//   - ChargingCurveFingerprintClusteringSources and
//     AllowedChargeCurveSourceTypes define the public shape consumers rely on.
package curve
