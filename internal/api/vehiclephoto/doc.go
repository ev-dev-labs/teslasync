// Package vehiclephoto hosts the HTTP handlers for the per-vehicle
// photo upload + serve pipeline (Phase-46 / Prompt 54).
//
//	POST   /api/v1/vehicles/{vehicleID}/photo
//	GET    /api/v1/vehicles/{vehicleID}/photo
//	GET    /api/v1/vehicles/{vehicleID}/photo/{size}
//	DELETE /api/v1/vehicles/{vehicleID}/photo
//
// # Layer
//
// Layer: handler
//
// # Why a subpackage
//
// Carved in Phase R2c.6 — final VehicleHandler-sibling micro-carve.
// Same precedent as the rest of the R2c.* family: one resource cluster
// per subpackage; depends on shared infrastructure (httpx, apiparams)
// plus external core packages (internal/database/vehicle,
// internal/imaging, chi) and re-uses the VehicleExistenceChecker seam
// + the VEHICLE_NOT_FOUND code from sibling vehiclesettings. MUST NOT
// import its parent.
//
// # Scope
//
// In-scope (lives here):
//   - Handler (GetMeta, GetFile, Upload, Delete) + per-vehicle upload
//     mutex map.
//   - VehiclePhotoStore seam interface and the production wiring
//     against *vehicledb.VehiclePhotoRepo (constructor caller's
//     responsibility).
//   - On-disk pipeline: writeAtomicJPEG, resolveSafePath (with
//     traversal guard), cleanupStaged, removeEmptyParent.
//   - Public constants exported for SPA + tests:
//     MaxUploadBytes, PhotoSize{Thumb,Medium,Full},
//     PhotoSizesOrdered, PhotoMaxDimByName, AllowedPhotoMimeTypes,
//     VehiclePhotoUploadFormField, and the PhotoCode* error envelope
//     identifiers — names preserved verbatim.
//
// # Cross-package dependency
//
// The VEHICLE_NOT_FOUND 404 path reuses
// vehiclesettings.VehicleExistenceChecker (seam) and
// vehiclesettings.VehicleSettingsCodeNotFound (envelope code) rather
// than declaring a duplicate set — the SPA's typed-fetch layer keys
// on the same constant string regardless of which handler emits it.
// Direction is one-way: vehiclephoto -> vehiclesettings only.
//
// # Independence
//
// Constructor takes (VehiclePhotoStore, vehiclesettings.VehicleExistenceChecker,
// rootDir string). Test fixtures (fakeVehiclePhotoStore,
// fakeVehicleExistenceChecker) are local to handler_test.go and use a
// real on-disk root under t.TempDir() so the encode pipeline is fully
// exercised.
package vehiclephoto
