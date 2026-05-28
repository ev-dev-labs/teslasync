package models

// All tests previously in this file have been carved out into per-domain
// subpackages in phase-R5:
//   - Token tests           → internal/models/auth/auth_test.go      (R5.2)
//   - TestVehicle_*         → internal/models/vehicle/vehicle_test.go (R5.12)
//   - TestChargingSession_* → internal/models/charging/charging_test.go (R5.13)
//   - TestDrive_*           → internal/models/drive/drive_test.go    (R5.14)
//
// This file is kept (rather than deleted) so the breadcrumb is visible
// to anyone using `go doc` or `git log models_test.go`.
