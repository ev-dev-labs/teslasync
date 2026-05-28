// Package vehiclesettings hosts the HTTP handlers for the per-vehicle
// settings endpoints (Phase-46 / Prompt 43):
//
//	GET    /api/v1/vehicles/{vehicleID}/settings
//	PUT    /api/v1/vehicles/{vehicleID}/settings/{key}
//	DELETE /api/v1/vehicles/{vehicleID}/settings/{key}
//
// # Layer
//
// Layer: handler
//
// # Why a subpackage
//
// Carved in Phase R2c.5 — fifth VehicleHandler-sibling micro-carve.
// Same precedent as the rest of the R2c.* family: one resource cluster
// per subpackage; depends only on shared infrastructure (httpx,
// apiparams) plus external core packages
// (internal/database/settings, internal/database/vehicle, chi). MUST
// NOT import its parent.
//
// # Scope
//
// In-scope (lives here):
//   - Handler (List, Put, Delete) and its three injectable seams:
//     VehicleSettingsOverrideStore, VehicleSettingsResolverInterface,
//     VehicleExistenceChecker.
//   - Production adapter NewVehicleExistenceChecker(*vehicledb.VehicleRepo)
//     — also referenced by the future vehiclephoto subpackage, so the
//     constructor stays exported.
//   - Error-envelope code constants (VehicleSettingsCodeInvalidKey,
//     VehicleSettingsCodeInvalidValue, VehicleSettingsCodeNotFound,
//     VehicleSettingsCodeBadBody) — names preserved verbatim for SPA
//     parity.
//   - Body-size guard MaxVehicleSettingsBodyBytes.
//   - decodeValueForKey + MarshalVehicleSettingPayload helpers.
//
// # Independence
//
// Constructor takes only the three seam interfaces; production wires
// settingsdb.NewVehicleSettingsRepo + settingsdb.NewVehicleSettingsResolver
// + NewVehicleExistenceChecker(vehicledb.NewVehicleRepo(db)). Tests
// inject the local fake{VehicleSettingsStore,Resolver,ExistenceChecker}
// stubs declared in handler_test.go.
package vehiclesettings
