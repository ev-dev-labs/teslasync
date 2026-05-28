// Package vehicleinfo hosts the HTTP handlers for the per-vehicle Tesla
// account metadata cluster — mobile-enabled status, option codes,
// vehicle specs, subscription eligibility, upgrade eligibility, and
// warranty details. All routes are mounted under
// /api/v1/vehicles/{vehicleID}/.
//
// # Layer
//
// Layer: handler
//
// # Why a subpackage
//
// Carved in Phase R2c.2 — the second VehicleHandler-sibling micro-carve
// after R2c.1 (vehicleaccess). Same precedent as R2a/R2b/R2c/R2c.1:
// one resource cluster per subpackage, depends only on shared
// infrastructure (apperror, httpx, apiparams) and external core
// packages (internal/tesla, internal/database/*). MUST NOT import its
// parent.
//
// # Scope
//
// In-scope (lives here):
//   - Handler — 12 method receivers covering:
//     MobileEnabled / RefreshMobileEnabled
//     VehicleOptions / RefreshVehicleOptions
//     VehicleSpecs / RefreshVehicleSpecs
//     SubscriptionEligibility / RefreshSubscriptionEligibility
//     UpgradeEligibility / RefreshUpgradeEligibility
//     WarrantyDetails / RefreshWarrantyDetails
//   - vehicleInfoEnvelope wire shape ({data,fetched_at}).
//   - resolveVIN helper.
//
// Out-of-scope:
//   - All other vehicle.* clusters (access, settings, photo, config,
//     states) each carved into their own subpackage.
//
// # Independence
//
// The constructor takes only the Tesla client + *database.DB; the
// handler does not share types, helpers, or state with the core
// VehicleHandler or any sibling. Clean carve: single router.go
// constructor swap; no cross-handler coupling.
package vehicleinfo
