// Package export carves the PII-redaction-shared-exports tool out of
// the parent internal/ai/tools/ flat package per ADR-011 §3
// (bounded-context subpackages) + ADR-015-amend (AI subsystem in
// scope for Phase R, file-move-only). Single-tool cluster:
//
//	redaction_plan.go — RegisterPiiRedactionSharedExportsTools +
//	                    SharedExportPIICatalogEntry/Recommendation +
//	                    ScopedSharedExportRedactionWindow + helpers
//
// Cross-cluster contract preserved verbatim per ADR-015 §I12 (AI-Off
// Contract): every exported type/interface/function name, JSON tag,
// schema field name, and Execute payload shape is identical to the
// pre-R6.20 parent-pkg version. ai-vet + aigen mirror at
// web/src/ai/features.ts verify this at gate time.
//
// Alias convention (ADR-011 §3): callsites importing this package
// alongside internal/export MUST alias one of the two to avoid the
// collision (suggested: exportaitools for this AI tool package;
// internal/export keeps its plain name). The composition root in
// internal/api/router.go imports it without alias because
// internal/export is not co-imported there.
//
// Layer: domain
package export
