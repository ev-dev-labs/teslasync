// Package vehicleaccess hosts the HTTP handlers for the
// /api/v1/vehicles/{vehicleID}/drivers and
// /api/v1/vehicles/{vehicleID}/invitations resource clusters — the
// Tesla "share access" surface.
//
// # Layer
//
// Layer: handler
//
// # Why a subpackage
//
// Carved out of the flat parent internal/api/ in Phase R2c.1 (the
// first VehicleHandler-sibling micro-carve after R2c shipped the core
// vehicle handler). Follows the precedent set by R2a/R2b/R2c: one
// resource cluster per subpackage; depends only on shared
// infrastructure subpackages (apperror, httpx, apiparams) and
// external core packages (internal/tesla, internal/database/*).
// MUST NOT import its parent.
//
// # Scope
//
// In-scope (lives here):
//   - Handler (ListDrivers / RefreshDrivers / RemoveDriver +
//     ListInvitations / RefreshInvitations / CreateInvitation /
//     RevokeInvitation).
//   - parseDriversResponse / parseInvitationsResponse /
//     parseCreateInvitationResponse — Tesla envelope decoders.
//   - truncateBody — small log-trimming helper duplicated from the
//     parent until tesla_energy_history_handler.go is also carved
//     and the parent copy can be deleted.
//
// Out-of-scope:
//   - All other vehicle.* clusters (info/settings/photo/config/states)
//     each have their own dedicated subpackage in their R2c.* slice.
//
// # Independence
//
// The constructor takes only the Tesla client + *database.DB; the
// handler does not share types, helpers, or state with the core
// VehicleHandler (internal/api/vehicle). They are wired into the same
// route tree but have no cross-handler coupling, which is why the
// carve was clean (single router.go constructor swap).
package vehicleaccess
