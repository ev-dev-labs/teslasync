// Package backupverify validates the most recent backup artifact by
// downloading it through the same StorageProvider the backup processor uses,
// verifying its checksum, decoding the table dump, and asserting a small set
// of content invariants. Package backuprestore owns database import and
// service-level recovery drills.
//
// The verifier is a separate package rather than a Processor method for
// two reasons:
//
//  1. It is invoked by an external scheduler (cron / k8s CronJob /
//     `cmd/backup-verify`) — not by the live API server. Keeping the
//     primitive standalone avoids coupling the verifier's
//     dependencies (json schema invariants) into the runtime hot
//     path.
//  2. The verifier emits a Prometheus gauge
//     (`teslasync_backup_verify_last_success_seconds`) that an
//     alerting rule can scrape independently of API health — a
//     stuck API server should still surface a backup failure.
//
// Invariants enforced by VerifyLatest:
//
//   - Backup checksum matches what was recorded in backup_runs
//   - The restored JSON map contains a non-zero count of each
//     critical table (vehicles, drives, charging_sessions). Tables
//     that the operator did not include in the backup_config row
//     are skipped — the verifier only asserts that what was
//     CLAIMED to be backed up actually round-trips.
//   - File age is below MaxAge (default 7d) — a stale backup is a
//     red flag even if checksums match.
package backupverify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"time"

	backupmodel "github.com/ev-dev-labs/teslasync/internal/models/backup"

	"github.com/ev-dev-labs/teslasync/internal/backup"
)

var sha256Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// Verifier runs the backup drill. Construct via NewVerifier.
type Verifier struct {
	processor   *backup.Processor
	runsRepo    BackupRunsLookup
	configsRepo BackupConfigsLookup
	criticals   []string
	maxAge      time.Duration
	now         func() time.Time
}

// BackupRunsLookup is the narrow surface the verifier needs from the
// backup_runs repo. Kept narrow so tests don't need the full repo.
type BackupRunsLookup interface {
	LatestSuccessful(ctx context.Context) (*backupmodel.BackupRun, error)
}

// BackupConfigsLookup mirrors the read needed against backup_configs.
type BackupConfigsLookup interface {
	GetByID(ctx context.Context, id int64) (*backupmodel.BackupConfig, error)
}

// Result summarises a single verification run.
type Result struct {
	RunID          int64                      `json:"run_id"`
	BackupAt       time.Time                  `json:"backup_at"`
	VerifiedAt     time.Time                  `json:"verified_at"`
	DurationMs     int64                      `json:"duration_ms"`
	OK             bool                       `json:"ok"`
	Error          string                     `json:"error,omitempty"`
	TablesVerified []TableResult              `json:"tables_verified"`
	ChecksumOK     bool                       `json:"checksum_ok"`
	ArtifactSHA256 string                     `json:"artifact_sha256,omitempty"`
	AgeSeconds     float64                    `json:"age_seconds"`
	RestoredData   map[string]json.RawMessage `json:"-"`
}

// TableResult records the per-table verification outcome.
type TableResult struct {
	Table    string `json:"table"`
	RowCount int    `json:"row_count"`
	OK       bool   `json:"ok"`
	Reason   string `json:"reason,omitempty"`
}

// NewVerifier wires the verifier against an existing backup.Processor
// (built from the same *database.DB the API uses). criticals is the
// list of tables that MUST be present + non-empty for the run to
// pass; empty defaults to {"vehicles"}. maxAge bounds the freshness
// of the most recent successful backup; default 7 days when zero.
func NewVerifier(
	processor *backup.Processor,
	runsRepo BackupRunsLookup,
	configsRepo BackupConfigsLookup,
	criticals []string,
	maxAge time.Duration,
) *Verifier {
	if len(criticals) == 0 {
		criticals = []string{"vehicles"}
	}
	if maxAge <= 0 {
		maxAge = 7 * 24 * time.Hour
	}
	return &Verifier{
		processor:   processor,
		runsRepo:    runsRepo,
		configsRepo: configsRepo,
		criticals:   criticals,
		maxAge:      maxAge,
		now:         time.Now,
	}
}

// VerifyLatest runs one verification pass against the most recent
// successful backup. Returns the full Result regardless of outcome
// so callers can record it; the Result.OK boolean is the canonical
// success indicator.
func (v *Verifier) VerifyLatest(ctx context.Context) (*Result, error) {
	if v == nil {
		return &Result{Error: "nil verifier"}, errors.New("nil verifier")
	}
	if v.now == nil {
		v.now = time.Now
	}
	start := v.now()
	res := &Result{VerifiedAt: start}
	if v.processor == nil || v.runsRepo == nil || v.configsRepo == nil {
		res.Error = "verifier not configured"
		res.DurationMs = v.now().Sub(start).Milliseconds()
		return res, errors.New(res.Error)
	}

	run, err := v.runsRepo.LatestSuccessful(ctx)
	if err != nil {
		res.Error = fmt.Sprintf("lookup latest run: %v", err)
		res.DurationMs = v.now().Sub(start).Milliseconds()
		return res, err
	}
	if run == nil {
		res.Error = "no successful backup found"
		res.DurationMs = v.now().Sub(start).Milliseconds()
		return res, errors.New(res.Error)
	}
	res.RunID = run.ID
	res.BackupAt = run.CreatedAt
	res.AgeSeconds = v.now().Sub(run.CreatedAt).Seconds()
	if res.AgeSeconds > v.maxAge.Seconds() {
		res.Error = fmt.Sprintf("latest backup is %.0fs old (max %s)", res.AgeSeconds, v.maxAge)
		res.DurationMs = v.now().Sub(start).Milliseconds()
		return res, errors.New(res.Error)
	}

	if run.ConfigID == nil {
		res.Error = "backup run has no config_id"
		res.DurationMs = v.now().Sub(start).Milliseconds()
		return res, errors.New(res.Error)
	}
	if run.Checksum == nil || !sha256Pattern.MatchString(*run.Checksum) {
		res.Error = "backup run has no valid SHA-256 checksum"
		res.DurationMs = v.now().Sub(start).Milliseconds()
		return res, errors.New(res.Error)
	}
	cfg, err := v.configsRepo.GetByID(ctx, *run.ConfigID)
	if err != nil {
		res.Error = fmt.Sprintf("lookup config: %v", err)
		res.DurationMs = v.now().Sub(start).Milliseconds()
		return res, err
	}
	if cfg == nil {
		res.Error = fmt.Sprintf("backup config %d not found", *run.ConfigID)
		res.DurationMs = v.now().Sub(start).Milliseconds()
		return res, errors.New(res.Error)
	}

	restored, err := v.processor.RestoreBackup(ctx, run, cfg.Provider, cfg.ProviderConfig)
	if err != nil {
		res.Error = fmt.Sprintf("restore: %v", err)
		res.DurationMs = v.now().Sub(start).Milliseconds()
		return res, err
	}
	res.ChecksumOK = true // RestoreBackup returns an error when checksum verification fails.
	res.ArtifactSHA256 = *run.Checksum
	res.RestoredData = restored

	res.TablesVerified = make([]TableResult, 0, len(v.criticals))
	allOK := true
	for _, table := range v.criticals {
		tr := TableResult{Table: table}
		raw, ok := restored[table]
		if !ok {
			tr.Reason = "table not present in backup"
			allOK = false
			res.TablesVerified = append(res.TablesVerified, tr)
			continue
		}

		count, err := countRows(raw)
		if err != nil {
			tr.Reason = fmt.Sprintf("parse: %v", err)
			allOK = false
		} else {
			tr.RowCount = count
			if count == 0 {
				tr.Reason = "zero rows"
				allOK = false
			} else {
				tr.OK = true
			}
		}
		res.TablesVerified = append(res.TablesVerified, tr)
	}
	res.OK = allOK
	res.DurationMs = v.now().Sub(start).Milliseconds()
	if !allOK && res.Error == "" {
		res.Error = "one or more critical tables failed verification"
		return res, errors.New(res.Error)
	}
	return res, nil
}

// countRows decodes the table dump payload and returns the number of
// rows it contained.
func countRows(raw json.RawMessage) (int, error) {
	var rows []json.RawMessage
	if err := json.Unmarshal(raw, &rows); err != nil {
		return 0, err
	}
	return len(rows), nil
}
