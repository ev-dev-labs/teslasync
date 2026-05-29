// Package dashboard hosts persistence + transport DTOs for the
// user-dashboard bounded context: customizable per-user dashboard state.
//
//   - DashboardLayout — saved widget arrangement per user/vehicle.
//   - ChartAnnotation, AnnotationCategory — user-drawn callouts on time-series charts.
//   - SavedView — saved time-range / filter / signal combinations.
//   - PinnedItem, PinnedItemType — pinned shortcuts on the home dashboard.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011, use this import alias when importing alongside other model
// subpackages:
//
//	dashboardmodel "github.com/ev-dev-labs/teslasync/internal/models/dashboard"
package dashboard
