// Package weberrors owns frontend browser error ingest and the admin
// rolling-summary endpoint. It validates and rate-bounds SPA error
// reports, observes bounded Prometheus metrics, and keeps the in-memory
// last-hour summary used by the admin System Status page.
//
// Layer: handler
package weberrors
