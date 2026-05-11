// Package arch enforces TeslaSync's architectural boundaries via a Go test.
//
// Layer: tool
//
// The test in arch_test.go fails when:
//   - A new import edge appears that crosses a forbidden boundary
//     (see ForbiddenEdges in rules.go).
//   - The package count or doc.go coverage regresses compared to
//     tools/archmetrics/baseline.json.
//
// To intentionally evolve the graph (e.g. legitimately add a new layer),
// update both the ForbiddenEdges/AllowedExceptions lists in rules.go AND
// the baseline (`make arch-baseline`).
package arch
