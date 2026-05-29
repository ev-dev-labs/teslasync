// Package adminmaintenance serves operator maintenance-mode endpoints and the
// shared maintenance-state provider. BuildMaintenanceProvider centralizes
// env-vs-DB precedence so health, status, and admin UI surfaces agree.
//
// Layer: handler
package adminmaintenance
