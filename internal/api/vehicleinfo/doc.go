// Package vehicleinfo serves the per-vehicle Tesla account metadata routes:
// mobile-enabled status, options, specs, subscription and upgrade eligibility,
// and warranty details.
//
// # Layer
//
// Layer: handler
//
// This metadata cluster stays independent from the core VehicleHandler and
// sibling vehicle subpackages; it depends only on shared API helpers plus
// Tesla/database packages.
package vehicleinfo
