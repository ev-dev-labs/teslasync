// Package scheduledexports serves authenticated recurring export schedule
// endpoints under /api/v1/scheduled-exports.
//
// Owner identity always comes from the configured ForwardAuth header. The
// handler never trusts owner_subject in the request body, and per-row writes
// collapse cross-user mutations to 404 without leaking ownership.
//
// Layer: handler
package scheduledexports
