// Package apiflagsh serves the dynamic feature-flag admin endpoints
// mounted under /api/v1/system/flags.
//
// It is intentionally named apiflagsh (not flags) so it can import the
// runtime feature-flag store package at internal/flags without a package
// name collision while following the R2 handler-subpackage carve pattern.
//
// Layer: handler
package apiflagsh
