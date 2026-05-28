// Package softwareupdate serves GET /api/v1/software-updates which returns
// the durable history of Tesla over-the-air firmware updates.
//
// Two query modes are supported:
//
//   - no vehicle_id ............ GetAll across the fleet
//   - vehicle_id=<int64> ....... GetByVehicle scoped to one vehicle
//
// Both modes accept the standard ?start=&end= date range and ?limit=
// pagination. Results are ordered newest-first by install_time.
//
// Layer: handler
package softwareupdate
