// Package feedback serves POST /api/v1/feedback, the public in-app
// feedback ingest endpoint consumed by the SPA feedback modal.
//
// The handler persists validated submissions through the user feedback
// repository and applies the same per-submitter throttle as the former
// parent-package implementation.
//
// Layer: handler
package feedback
