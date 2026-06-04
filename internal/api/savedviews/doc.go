// Package savedviews serves /api/v1/saved-views, the per-user CRUD
// endpoint for named URL querystrings consumed by list pages in the SPA.
//
// The handler is intentionally agnostic about what a saved query means;
// the owning frontend surface re-applies the stored query to the URL so
// existing URL-bound filters rehydrate normally.
//
// Layer: handler
package savedviews
