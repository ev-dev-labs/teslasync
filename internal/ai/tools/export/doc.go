// Package export contains the PII-redaction-shared-exports AI tool.
// ADR-011 §3 keeps bounded-context AI tools in subpackages.
// Single-tool cluster:
//
//	redaction_plan.go — RegisterPiiRedactionSharedExportsTools +
//	                    SharedExportPIICatalogEntry/Recommendation +
//	                    ScopedSharedExportRedactionWindow + helpers
//
// ADR-015 §I12 (AI-Off Contract): exported type, interface, and
// function names, JSON tags, schema fields, and Execute payload shapes
// must remain stable. ai-vet and the aigen mirror at
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
