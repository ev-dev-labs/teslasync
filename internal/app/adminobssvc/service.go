// Package adminobssvc orchestrates the read-only admin observability
// surface: schema drift, slow queries, per-vehicle
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
	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
	"github.com/ev-dev-labs/teslasync/internal/rotation"
	"github.com/ev-dev-labs/teslasync/internal/schemacheck"
)

// slowQueriesPort is the narrow slow-query surface Service depends on.
// Satisfied by *dbobs.SlowQueriesRepo in production and by a fake in
// tests, so the ErrPgStatStatementsUnavailable -> ErrNotConfigured
// mapping can be exercised without a live pg_stat_statements.
type slowQueriesPort interface {
	TopLive(ctx context.Context, orderBy dbobs.SlowQueryOrderBy, limit int) ([]dbobs.SlowQuery, error)
}

// hypertablePort is the narrow disk-forecast surface Service depends on.
type hypertablePort interface {
	Forecast(ctx context.Context, quotaBytes int64) ([]dbobs.HypertableSize, error)
}

// ingestXRayPort is the narrow per-vehicle-cost surface Service depends
// on.
type ingestXRayPort interface {
	VehicleCostReport(ctx context.Context, since time.Time, limit int) (*dbobs.VehicleCostReport, error)
}

// rotationPort is the narrow secret-rotation surface Service depends on.
type rotationPort interface {
	Status(ctx context.Context) ([]rotation.Status, error)
}

// Compile-time proof that the production repos satisfy the ports. These
// catch signature drift the moment a repo method changes shape.
var (
	_ slowQueriesPort = (*dbobs.SlowQueriesRepo)(nil)
	_ hypertablePort  = (*dbobs.HypertableMetricsRepo)(nil)
	_ ingestXRayPort  = (*dbobs.IngestXRayRepo)(nil)
	_ rotationPort    = (*rotation.Tracker)(nil)
)

// Service is the orchestrator. All fields are optional so the App can
// pass nil for any subsystem that is not configured (e.g. timescale
// not installed) and the handler returns 503 for just that route.
//
// The repo dependencies are held as narrow interfaces (ports) rather
// than concrete pointers so each method's error-mapping and defaulting
// logic is unit-testable with in-memory fakes. New performs a non-nil
// guard when wiring the concrete repos so a nil *repo argument leaves
// the port as a genuinely-nil interface (not a non-nil interface value
// wrapping a nil pointer), preserving the nil == ErrNotConfigured
// contract every method relies on.
type Service struct {
	now           func() time.Time
	rotation      rotationPort
	schemaRepo    schemacheck.Querier
	schemaSeed    schemacheck.Fingerprint
	slowQueries   slowQueriesPort
	hypertable    hypertablePort
	ingestXRay    ingestXRayPort
	auditRecorder *audit.Recorder
	excludeTables []string
	quotaBytes    int64
}

// Options bundles constructor params.
type Options struct {
	Now           func() time.Time
	Rotation      *rotation.Tracker
	SchemaPool    schemacheck.Querier
	SchemaSeed    schemacheck.Fingerprint
	SlowQueries   *dbobs.SlowQueriesRepo
	Hypertable    *dbobs.HypertableMetricsRepo
	IngestXRay    *dbobs.IngestXRayRepo
	AuditRecorder *audit.Recorder
	ExcludeTables []string
	QuotaBytes    int64
}

// New constructs the service.
//
// Concrete repo pointers are copied into the interface-typed fields
// only when non-nil. A direct assignment of a nil *Repo into an
// interface field would produce a non-nil interface wrapping a nil
// pointer, defeating the `field == nil` guard each method uses to
// return ErrNotConfigured; the explicit guards below keep an unwired
// subsystem as a genuinely-nil interface.
func New(opt Options) *Service {
	if opt.Now == nil {
		opt.Now = time.Now
	}
	if opt.QuotaBytes <= 0 {
		// Default quota = 100 GiB per hypertable — operators override
		// via the env-driven cfg.
		opt.QuotaBytes = 100 * 1024 * 1024 * 1024
	}
	s := &Service{
		now:           opt.Now,
		schemaRepo:    opt.SchemaPool,
		schemaSeed:    opt.SchemaSeed,
		auditRecorder: opt.AuditRecorder,
		excludeTables: opt.ExcludeTables,
		quotaBytes:    opt.QuotaBytes,
	}
	if opt.Rotation != nil {
		s.rotation = opt.Rotation
	}
	if opt.SlowQueries != nil {
		s.slowQueries = opt.SlowQueries
	}
	if opt.Hypertable != nil {
		s.hypertable = opt.Hypertable
	}
	if opt.IngestXRay != nil {
		s.ingestXRay = opt.IngestXRay
	}
	return s
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
func (s *Service) SlowQueries(ctx context.Context, orderBy dbobs.SlowQueryOrderBy, limit int) ([]dbobs.SlowQuery, error) {
	if s == nil || s.slowQueries == nil {
		return nil, ErrNotConfigured
	}
	out, err := s.slowQueries.TopLive(ctx, orderBy, limit)
	if errors.Is(err, dbobs.ErrPgStatStatementsUnavailable) {
		return nil, ErrNotConfigured
	}
	return out, err
}

// VehicleCost returns the per-vehicle cost report.
func (s *Service) VehicleCost(ctx context.Context, since time.Time, limit int) (*dbobs.VehicleCostReport, error) {
	if s == nil || s.ingestXRay == nil {
		return nil, ErrNotConfigured
	}
	if since.IsZero() {
		since = s.now().Add(-30 * 24 * time.Hour)
	}
	return s.ingestXRay.VehicleCostReport(ctx, since, limit)
}

// DiskForecast returns per-hypertable size + days-to-quota.
func (s *Service) DiskForecast(ctx context.Context) ([]dbobs.HypertableSize, error) {
	if s == nil || s.hypertable == nil {
		return nil, ErrNotConfigured
	}
	out, err := s.hypertable.Forecast(ctx, s.quotaBytes)
	if errors.Is(err, dbobs.ErrTimescaleUnavailable) {
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
