// Package charge contains charge-domain AI tools split out under the
// bounded-context layout described by ADR-011 §3. It is currently a
// single-tool cluster; charge_curve_clustering remains in the parent
// package until shared fixtures cover that tool family.
//
//	curve_clusters.go — RegisterChargeCurveClustersTools +
//	                    ChargeCurveClustersSources (query the
//	                    pre-trained clusters produced by the
//	                    charge_curve_clustering training tool)
//
// Cross-cluster contract preserved per ADR-015 §I12 (AI-Off Contract):
// every exported type/interface/function name, JSON tag, schema field
// name, and Execute payload shape stays compatible. ai-vet + aigen mirror at
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
