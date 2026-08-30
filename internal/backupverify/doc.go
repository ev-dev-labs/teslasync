// Package backupverify validates the checksum, freshness, decoding, and
// critical-table contents of the most recent backup artifact. Database import
// and service recovery are exercised separately by package backuprestore.
//
// Layer: platform
//
// Kept as a standalone package rather than a Processor method so:
//
//  1. The external scheduler (cron / k8s CronJob / cmd/backup-verify)
//     can run it without dragging the live API server's hot path into
//     its dependency closure.
//  2. The Prometheus gauge
//     `teslasync_backup_verify_last_success_seconds` can be scraped
//     independently of API health — a stuck API server should still
//     surface a backup failure.
//
// Consumers depend on this package via the small Verifier interface;
// see verifier.go.
package backupverify
