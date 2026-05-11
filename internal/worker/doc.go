// Package worker contains the background goroutines that keep TeslaSync
// data up to date without user interaction.
//
// [Worker] polls the Tesla Fleet API on a configurable interval (default
// 15 s), persists positions, detects driving and charging sessions, and
// publishes real-time updates over MQTT. Per-vehicle adaptive backoff
// prevents a single failing vehicle from blocking the fleet. The
// maintenance worker handles data retention enforcement, old record
// cleanup, and periodic PostgreSQL VACUUM to reclaim storage. Both
// workers shut down gracefully on context cancellation.
// Layer: platform
//
package worker
