// Package auditviewersvc serves the admin audit log viewer page.
//
// The viewer reads from the audit_logs table via AuditLogQueryRepo
// and verifies hash-chain integrity via audit.Recorder.VerifyChain.
// Write operations are NOT in this package — every actor in the
// codebase that records audit events does so via internal/audit
// directly (see Recorder.Record).
package auditviewersvc

import (
	"context"
	"errors"
	"fmt"
	"time"

	auditdb "github.com/ev-dev-labs/teslasync/internal/database/audit"

	"github.com/ev-dev-labs/teslasync/internal/audit"
)

// queryPort is the read-side port the viewer depends on. The concrete
// *auditdb.AuditLogQueryRepo satisfies it in production; unit tests
// supply an in-package fake so the service can be exercised without a
// live PostgreSQL pool (the same test-double approach the database/audit
// repos use against their DBTX fake).
type queryPort interface {
	List(ctx context.Context, q auditdb.AuditLogQuery) ([]auditdb.AuditLogRow, error)
	DistinctCategories(ctx context.Context) ([]string, error)
	DistinctActions(ctx context.Context) ([]string, error)
}

// verifyPort is the hash-chain verification port, satisfied by
// *audit.Recorder in production.
type verifyPort interface {
	VerifyChain(ctx context.Context, since time.Time, limit int) (firstBadID int64, checked int, err error)
}

// Service is the audit viewer orchestrator.
type Service struct {
	repo     queryPort
	recorder verifyPort
}

// New constructs the service.
//
// A nil *AuditLogQueryRepo or *audit.Recorder (which is what those
// constructors return on deployments where the audit read path is not
// wired) is stored as a genuine nil port rather than a typed-nil
// interface, so the ErrNotConfigured guards below keep firing instead
// of dereferencing a nil concrete value.
func New(repo *auditdb.AuditLogQueryRepo, recorder *audit.Recorder) *Service {
	s := &Service{}
	if repo != nil {
		s.repo = repo
	}
	if recorder != nil {
		s.recorder = recorder
	}
	return s
}

// ErrNotConfigured is returned when the audit_logs read path is not wired.
var ErrNotConfigured = errors.New("audit viewer not configured on this deployment")

// Query returns rows matching the filter, ordered newest-first.
func (s *Service) Query(ctx context.Context, q auditdb.AuditLogQuery) ([]auditdb.AuditLogRow, error) {
	if s == nil || s.repo == nil {
		return nil, ErrNotConfigured
	}
	rows, err := s.repo.List(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("auditviewersvc: query: %w", err)
	}
	return rows, nil
}

// DistinctCategories feeds the filter UI dropdown with the distinct
// audit categories present in audit_logs.
func (s *Service) DistinctCategories(ctx context.Context) ([]string, error) {
	if s == nil || s.repo == nil {
		return nil, ErrNotConfigured
	}
	cats, err := s.repo.DistinctCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("auditviewersvc: distinct categories: %w", err)
	}
	return cats, nil
}

// DistinctActions returns the top-100 most-recent action names.
func (s *Service) DistinctActions(ctx context.Context) ([]string, error) {
	if s == nil || s.repo == nil {
		return nil, ErrNotConfigured
	}
	actions, err := s.repo.DistinctActions(ctx)
	if err != nil {
		return nil, fmt.Errorf("auditviewersvc: distinct actions: %w", err)
	}
	return actions, nil
}

// VerifyChain re-derives the SHA256 chain on audit_logs rows since
// `since` (up to `limit`) and returns the first bad row id (or 0
// when intact) plus the number of rows checked.
// Operators run this periodically (admin button) to confirm no row
// was tampered with after-the-fact.
func (s *Service) VerifyChain(ctx context.Context, since time.Time, limit int) (firstBadID int64, checked int, err error) {
	if s == nil || s.recorder == nil {
		return 0, 0, ErrNotConfigured
	}
	badID, checked, err := s.recorder.VerifyChain(ctx, since, limit)
	if err != nil {
		return badID, checked, fmt.Errorf("auditviewersvc: verify chain: %w", err)
	}
	return badID, checked, nil
}
