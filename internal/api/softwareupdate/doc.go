// Package softwareupdate serves GET /api/v1/software-updates which returns
// the durable history of Tesla over-the-air firmware updates.
//
// Two query modes are supported:
//
//   - no vehicle_id ............ GetAll across the fleet
//   - vehicle_id=<int64>>0 ..... GetByVehicle scoped to one vehicle
//
// A present-but-invalid vehicle_id (non-numeric, zero, or negative) is a
// 400 rather than a silent fleet-wide fallback. Both modes accept the
// standard ?start=&end= date range and ?limit= pagination. Results are
// ordered newest-first by install_time.
//
// Layer: handler
package softwareupdate
