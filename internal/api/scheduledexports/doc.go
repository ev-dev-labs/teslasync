// Package scheduledexports serves the authenticated /api/v1/scheduled-exports
// recurring export schedule endpoints consumed by the SPA's scheduled export
// panel.
//
// Routes (all mounted under /api/v1/scheduled-exports):
//
//	GET    /scheduled-exports          — list current user's schedules
//	POST   /scheduled-exports          — create a new schedule
//	PUT    /scheduled-exports/{id}     — update an existing schedule
//	DELETE /scheduled-exports/{id}     — delete a schedule
//	POST   /scheduled-exports/{id}/run — manual "Run now" trigger
//
// Owner identity always comes from the configured ForwardAuth header. The
// handler never trusts owner_subject in the request body; per-row writes are
// scoped by (id, owner_subject) in the repository so cross-user mutations
// collapse to 404 without leaking ownership information.
//
// Layer: handler
package scheduledexports
