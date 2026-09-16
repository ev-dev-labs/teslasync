// Package science is the VIN-scoped laboratory: battery electrochemistry,
// thermal science, weather coupling, tire mechanics, and the statistical
// generated reports. Fits disclose available uncertainty, missing signals,
// firmware epoch, and holdout; descriptive observations are not causal fits.
//
// The package consumes the physics twin (internal/physics) for drive
// residuals; it never reimplements aero or rolling resistance.
//
// Honesty rules (hard):
//
//   - Null is never zero. Missing inputs make their fit unknown.
//   - Pack aggregates stay pack-equivalent (OCV_pack, IR_pack). Tesla
//     sends no per-cell current, so this package never claims cell truth.
//   - No lithium-plating, lithium-inventory, or failure-mileage claims.
//   - Throughput and rest exposure do not identify cycle/calendar aging.
//   - No single true SOH percent. Capacity is a proxy with method, n, CI.
//   - Range estimators disagree; this package never emits true_range.
//
// Signal mapping lives in internal/app/sciencesvc.
//
// Layer: domain
package science
