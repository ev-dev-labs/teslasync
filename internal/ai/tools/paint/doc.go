// Package paint contains the vehicle-paint-preview AI tool split out
// under the bounded-context layout described by ADR-011 §3. Single-tool cluster:
//
//	preview.go — RegisterVehiclePaintPreviewTools +
//	             VehiclePaintPreviewSources port
//
// Cross-cluster contract preserved per ADR-015 §I12 (AI-Off Contract):
// every exported type/interface/function name, JSON tag, schema field
// name, and Execute payload shape stays compatible. ai-vet + aigen mirror at
// web/src/ai/features.ts verify this at gate time.
//
// Layer: domain
package paint
