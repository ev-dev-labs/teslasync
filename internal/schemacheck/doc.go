// Layer: platform
//
// Package schemacheck computes a stable SHA256 fingerprint of the live
// public-schema (tables + columns + indexes) and diffs it against the
// boot-time seed so Phase-45's /admin/observability/schema-drift can
// flag unintended DDL drift between releases.
package schemacheck
