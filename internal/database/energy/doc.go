// Package energy holds the Energy aggregate-root repositories: vehicle
// energy-stats history, command-execution log, and the Tesla Powerwall /
// energy-site projections (history, live-status, site-info,
// backup-event, Wall Connector charging-session).
//
// Layer: adapter
//
// Repository layout:
//
//   - repo.go                    (was internal/database/energy_repo.go)
//     Vehicle energy-stats history + CommandLogRepo (command-execution log).
//   - tesla_history_repo.go      (was internal/database/tesla_energy_history_repo.go)
//     Tesla Powerwall historical readings (5m / 15m / 1h granularities).
//   - tesla_live_status_repo.go  (was internal/database/tesla_energy_live_status_repo.go)
//     Tesla Powerwall live-status snapshots.
//   - tesla_site_repo.go         (was internal/database/tesla_energy_site_repo.go)
//     Tesla energy-site config + backup-event + Wall-Connector charging
//     companion repositories.
//
// Aggregate root: Energy. The vehicle-energy and powerwall-energy
// projections share the same temporal substrate and roll-up cadence.
//
// Cross-package wiring: callers import this subpkg as `energydb` per the
// ADR-011 alias convention (e.g.
// `energydb "github.com/ev-dev-labs/teslasync/internal/database/energy"`).
//
// CommandLogRepo is grouped here for now because its sole producer is
// the energy-site command flow (charge-set, backup-reserve, etc); if a
// separate command aggregate emerges later it can move into
// internal/database/command/.
package energy
