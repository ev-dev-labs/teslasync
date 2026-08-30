// Package main is the cmd/backup-verify entrypoint.
//
// Layer: cmd-internal
//
// A one-shot binary intended for weekly cron / k8s CronJob execution.
// Verifies artifact freshness, storage download, checksum, decoding, and
// critical-table contents. It does not import a database; use
// cmd/backup-restore-drill for measured recovery evidence.
//
// See package internal/backupverify for the verification primitives.
package main
