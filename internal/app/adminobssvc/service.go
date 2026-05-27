// Package adminobssvc orchestrates the read-only Phase-45 admin
// observability surface: schema drift, slow queries, per-vehicle
// cost, disk forecast, and secret rotation status.
//
// All five features share a tracker/repo dependency owned by App and
// surface through one handler/v1 with five HTTP routes so a future
// page-builder iteration can fetch them in parallel from the
// /admin/observability page.
package adminobssvc

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/audit"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/rotation"
	"github.com/ev-dev-labs/teslasync/internal/schemacheck"
)

// Service is the orchestrator. All fields are optional so the App can
// pass nil for any subsystem that is not configured (e.g. timescale
// not installed) and the handler returns 503 for just that route.
type Service struct {
	now           func() time.Time
	rotation      *rotation.Tracker
	schemaRepo    schemacheck.Querier
	schemaSeed    schemacheck.Fingerprint
	slowQueries   *database.SlowQueriesRepo
	hypertable    *database.HypertableMetricsRepo
	ingestXRay    *database.IngestXRayRepo
	auditRecorder *audit.Recorder
	excludeTables []string
	quotaBytes    int64
}

// Options bundles constructor params.
type Options struct {
	Now              func() time.Time
	Rotation         *rotation.Tracker
	SchemaPool       schemacheck.Querier
	SchemaSeed       schemacheck.Fingerprint
	SlowQueries      *database.SlowQueriesRepo
	Hypertable       *database.HypertableMetricsRepo
	IngestXRay       *database.IngestXRayRepo
	AuditRecorder    *audit.Recorder
	ExcludeTables    []string
	QuotaBytes       int64
}

// New constructs the service.
func New(opt Options) *Service {
	if opt.Now == nil {
		opt.Now = time.Now
	}
	if opt.QuotaBytes <= 0 {
		// Default quota = 100 GiB per hypertable — operators override
		// via the env-driven cfg.
		opt.QuotaBytes = 100 * 1024 * 1024 * 1024
	}
	return &Service{
		now:           opt.Now,
		rotation:      opt.Rotation,
		schemaRepo:    opt.SchemaPool,
		schemaSeed:    opt.SchemaSeed,
		slowQueries:   opt.SlowQueries,
		hypertable:    opt.Hypertable,
		ingestXRay:    opt.IngestXRay,
		auditRecorder: opt.AuditRecorder,
		excludeTables: opt.ExcludeTables,
		quotaBytes:    opt.QuotaBytes,
	}
}

// SchemaDriftResult is the wire shape for SchemaDrift.
type SchemaDriftResult struct {
	Drift       schemacheck.Drift `json:"drift"`
	IsDifferent bool              `json:"is_different"`
}

// ErrNotConfigured is returned by methods whose backing repo is nil.
var ErrNotConfigured = errors.New("subsystem not configured on this deployment")

// SchemaDrift returns the current schema fingerprint vs the
// recorded seed. The seed is captured once at boot and persisted in
// schema_fingerprint; the diff highlights additive/removed tables
// or columns since deploy.
func (s *Service) SchemaDrift(ctx context.Context) (*SchemaDriftResult, error) {
	if s == nil || s.schemaRepo == nil {
		return nil, ErrNotConfigured
	}
	current, err := schemacheck.Compute(ctx, s.schemaRepo, s.excludeTables)
	if err != nil {
		return nil, fmt.Errorf("compute current fingerprint: %w", err)
	}
	drift := schemacheck.Diff(current, s.schemaSeed, "")
	return &SchemaDriftResult{
		Drift:       drift,
		IsDifferent: drift.HasDrift,
	}, nil
}

// SlowQueries returns the top N by mean execution time. Maps the
// pg_stat_statements absence to ErrNotConfigured.
func (s *Service) SlowQueries(ctx context.Context, orderBy database.SlowQueryOrderBy, limit int) ([]database.SlowQuery, error) {
	if s == nil || s.slowQueries == nil {
		return nil, ErrNotConfigured
	}
	out, err := s.slowQueries.TopLive(ctx, orderBy, limit)
	if errors.Is(err, database.ErrPgStatStatementsUnavailable) {
		return nil, ErrNotConfigured
	}
	return out, err
}

// VehicleCost returns the per-vehicle cost report.
func (s *Service) VehicleCost(ctx context.Context, since time.Time, limit int) (*database.VehicleCostReport, error) {
	if s == nil || s.ingestXRay == nil {
		return nil, ErrNotConfigured
	}
	if since.IsZero() {
		since = s.now().Add(-30 * 24 * time.Hour)
	}
	return s.ingestXRay.VehicleCostReport(ctx, since, limit)
}

// DiskForecast returns per-hypertable size + days-to-quota.
func (s *Service) DiskForecast(ctx context.Context) ([]database.HypertableSize, error) {
	if s == nil || s.hypertable == nil {
		return nil, ErrNotConfigured
	}
	out, err := s.hypertable.Forecast(ctx, s.quotaBytes)
	if errors.Is(err, database.ErrTimescaleUnavailable) {
		return nil, ErrNotConfigured
	}
	return out, err
}

// SecretRotation returns the most-recent rotation status per
// (kind, target_id) pair plus a per-kind summary.
func (s *Service) SecretRotation(ctx context.Context) ([]rotation.Status, error) {
	if s == nil || s.rotation == nil {
		return nil, ErrNotConfigured
	}
	return s.rotation.Status(ctx)
}
