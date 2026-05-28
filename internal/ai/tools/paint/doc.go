// Package paint carves the vehicle-paint-preview AI tool out of the
// parent internal/ai/tools/ flat package per ADR-011 §3
// (bounded-context subpackages) + ADR-015-amend (AI subsystem in
// scope for Phase R, file-move-only). Single-tool cluster:
//
//	preview.go — RegisterVehiclePaintPreviewTools +
//	             VehiclePaintPreviewSources port
//
// FIRST CLUSTER TO CONSUME internal/ai/tools/toolstest (R6.7.5):
// preview_test.go uses toolstest.FakeVehicles via standard composite
// literal &toolstest.FakeVehicles{One: map[int64]*vehiclemodel.Vehicle{...}}.
// This validates the toolstest contract before tackling the bigger
// 7-fake consumers (anomaly, automation_builder, charging_diagnosis,
// digest, drive_coaching, speed_profile, year_review).
//
// Cross-cluster contract preserved verbatim per ADR-015 §I12 (AI-Off
// Contract): every exported type/interface/function name, JSON tag,
// schema field name, and Execute payload shape is identical to the
// pre-R6.21 parent-pkg version. ai-vet + aigen mirror at
// web/src/ai/features.ts verify this at gate time.
//
// Layer: domain
package paint
