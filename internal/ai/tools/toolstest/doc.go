// Package toolstest provides reusable, deterministic, hermetic fake
// implementations of the narrow read/write ports the parent
// internal/ai/tools/* packages need, plus a handful of pointer-helper
// and clock-fixture utilities.
//
// This package is NOT a *_test.go file — it is a regular Go package
// so that sibling bounded-context subpackages (alert, charge,
// diagnostic, …, anomaly, drive_coaching, route_efficiency, …) can
// import it from THEIR _test.go files. A _test.go file can only be
// referenced by tests inside the same package, so the only way to
// share these fakes across the carved subpackage tree is to
// promote them into a normal importable package.
//
// Rationale: several ai/tools/* clusters (anomaly, automation_builder,
// charge_curve_clustering, charging_diagnosis, digest, drive_coaching,
// paint_preview, route_efficiency, speed_profile, trip_planner_llm_agent,
// year_review) were blocked on shared test-fixture coupling
// (fakeVehicles, fakeState, etc. defined in builtins_test.go). This
// package unblocks them by providing the canonical exported
// equivalents — same shapes, same method bodies, just `Field` instead
// of `field` so composite-literal callsites stay tidy.
//
// During the carve transition the parent internal/ai/tools/* test
// files continue to use their existing unexported local fakes
// verbatim — toolstest is the EXPORTED parallel for carved subpkg
// tests, NOT a forced replacement for the parent. When all 11 blocked
// clusters are carved out, the parent's local fakes
// can be deleted in a final cleanup.
//
// Layer: domain
package toolstest
