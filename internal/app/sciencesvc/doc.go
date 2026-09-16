// Package sciencesvc assembles VIN-scoped scientific reports: battery
// electrochemistry (flagship), thermal science, weather coupling, tire
// mechanics, and the statistical notebook.
//
// Endpoints (all under /api/v1/science):
//
//   - GET /electrochem?vehicle_id&start&end
//   - GET /thermal?vehicle_id&start&end
//   - GET /weather?vehicle_id&start&end
//   - GET /tires?vehicle_id&start&end
//   - GET /notebook?vehicle_id&start&end
//   - GET /charging/{sessionID}/ir
//
// Historical reads come from signal_log via signal.StateReader plus the
// charging/drives read models. Weather history is injected by the composition
// root using the shared Open-Meteo client. Drive residuals come from the
// physics twin (internal/physics); this package never reimplements aero
// or rolling resistance.
//
// Layer: app
package sciencesvc
