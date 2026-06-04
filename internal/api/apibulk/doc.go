// Package apibulk defines the shared handler-layer contract for bulk
// endpoints: request/response wire shapes, the default MaxIDs cap, sentinel
// decode errors, and helpers for parsing and reporting per-id failures.
//
// # Layer
//
// Layer: handler
//
// Bulk endpoints must keep a flat, byte-compatible JSON shape because the
// frontend bulk hook switches on URL, not schema. This subpackage lets carved
// resource handlers import the contract directly without forming parent-package
// import cycles.
package apibulk
