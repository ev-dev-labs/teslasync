// Package adminfeedback serves the /api/v1/admin/feedback queue
// endpoints consumed by the SPA admin feedback triage surface. It owns
// list, single-row read, status/GitHub URL patch, and optional GitHub
// Issues forwarding while preserving the existing wire shapes.
//
// AUTHZ remains provider-agnostic: routes are mounted under the
// ForwardAuth-protected /api/v1 tree, and mutation accountability is
// recorded through audit_logs rather than an in-handler role model.
//
// Layer: handler
package adminfeedback
