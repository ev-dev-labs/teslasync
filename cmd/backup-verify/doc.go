// Package main is the cmd/backup-verify entrypoint.
//
// Layer: cmd-internal
//
// A one-shot binary intended for weekly cron / k8s CronJob execution.
// Verifies the most recent successful backup_run artifact by
// round-tripping it through the configured StorageProvider, checking
// the recorded checksum, decompressing it, and asserting a non-zero
// count of operator-configured critical tables. Emits a JSON result
// to stdout and exits 0 on success / 1 on failure so an external
// scheduler can alert directly.
//
// See package internal/backupverify for the verification primitives.
package main
