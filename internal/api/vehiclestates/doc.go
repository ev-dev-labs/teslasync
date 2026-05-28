// Package vehiclestates hosts the HTTP handlers for the
// /api/v1/vehicle-states/timeline and /api/v1/vehicle-states/summary
// endpoints — FSM-transition-backed views over the fsm_transitions
// hypertable (mig 000187), restoring functionality deleted by
// Phase-42 prompt 0077.
//
// # Layer
//
// Layer: handler
//
// # Why a subpackage
//
// Carved in Phase R2c.4 — fourth VehicleHandler-sibling micro-carve.
// Same precedent as the R2c.* family: one resource cluster per
// subpackage, depends only on shared infrastructure (httpx) and
// external core packages (internal/database/vehicle). MUST NOT import
// its parent.
//
// # Scope
//
// In-scope (lives here):
//   - Handler (Timeline, Summary).
//   - vehicleStatesRepository (narrow interface that the production
//     *vehicledb.VehicleStatesRepo satisfies; test fakes don't need a
//     real database).
//   - vehicleStatesClock — injectable time provider for stable test
//     boundaries.
//   - VehicleStatesTimelineResponse / VehicleStatesSummaryResponse
//     envelope types — names preserved verbatim from the parent for
//     external-callable name parity.
//   - parseVehicleStatesParams / windowFor helpers.
//   - Decision-locked constants: vehicleStatesDefaultDays = 7,
//     vehicleStatesMaxDays = 90.
//
// # Independence
//
// The constructor takes only *vehicledb.VehicleStatesRepo; clock is
// production-defaulted to time.Now().UTC(). Zero coupling to sibling
// vehicle.* clusters. Test fixtures (fakeVehicleStatesRepo,
// timelineCall, summaryCall) are local to handler_test.go.
package vehiclestates
