// Package lifetime serves the /analytics/lifetime endpoint that returns
// all-time aggregated driving + charging statistics with an "achievements"
// gamification layer.
//
// Carved out of internal/api by phase-R2d.2. The package owns:
//
//   - Handler: HTTP handler bound to GET /analytics/lifetime
//   - ComputeLifetimeStats: package-level helper that runs every SQL
//     aggregate the endpoint depends on. Read-only — does NOT persist
//     achievement unlocks or broadcast SSE events. Re-used by the
//     ai_lifetime_stats_qa AI tool so the AI surface is grounded in
//     numerically-identical data to what the chart renders.
//   - LifetimeStatsResult / Achievement / PersonalRecord: typed envelope
//     and value types returned by ComputeLifetimeStats.
//   - EventBroadcaster: narrow port consumed by the canonical Handler to
//     publish achievement_unlocked SSE events. The parent api.EventHub
//     auto-satisfies this — no concrete dependency leaks into the
//     subpackage.
//
// # Layer
//
// Layer: handler
package lifetime
