// Package charge carves the charge-curve-clusters tool out of the
// parent internal/ai/tools/ flat package per ADR-011 §3
// (bounded-context subpackages) + ADR-015-amend (AI subsystem in
// scope for Phase R, file-move-only). Currently a single-tool
// cluster — the sibling charge_curve_clustering tool stays in the
// parent until toolstest prep unlocks shared-fixture clusters
// (Lesson 6 R6.7 deferred).
//
//	curve_clusters.go — RegisterChargeCurveClustersTools +
//	                    ChargeCurveClustersSources (query the
//	                    pre-trained clusters produced by the
//	                    charge_curve_clustering training tool)
//
// Cross-cluster contract preserved verbatim per ADR-015 §I12 (AI-Off
// Contract): every exported type/interface/function name, JSON tag,
// schema field name, and Execute payload shape is identical to the
// pre-R6.18 parent-pkg version. ai-vet + aigen mirror at
// web/src/ai/features.ts verify this at gate time.
//
// Alias convention (ADR-011 §3): callsites importing this package
// alongside other clusters MAY alias as `chargeaitools` to
// disambiguate from internal/database/charging or
// internal/api/charging. The composition root in
// internal/api/router.go imports it without alias because no
// collision exists there.
//
// Layer: domain
package charge
