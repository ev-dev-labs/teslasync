// Package backupverify exercises the most recent backup artifact end-
// to-end so a silently-broken backup pipeline is caught BEFORE it is
// needed for a restore.
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
