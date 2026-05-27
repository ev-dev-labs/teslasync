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
	"time"

	"github.com/ev-dev-labs/teslasync/internal/audit"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Service is the audit viewer orchestrator.
type Service struct {
	repo     *database.AuditLogQueryRepo
	recorder *audit.Recorder
}

// New constructs the service.
func New(repo *database.AuditLogQueryRepo, recorder *audit.Recorder) *Service {
	return &Service{repo: repo, recorder: recorder}
}

// ErrNotConfigured is returned when the audit_logs read path is not wired.
var ErrNotConfigured = errors.New("audit viewer not configured on this deployment")

// Query returns rows matching the filter, ordered newest-first.
func (s *Service) Query(ctx context.Context, q database.AuditLogQuery) ([]database.AuditLogRow, error) {
	if s == nil || s.repo == nil {
		return nil, ErrNotConfigured
	}
	return s.repo.List(ctx, q)
}

// DistinctCategories / DistinctActions feed the filter UI dropdowns.
func (s *Service) DistinctCategories(ctx context.Context) ([]string, error) {
	if s == nil || s.repo == nil {
		return nil, ErrNotConfigured
	}
	return s.repo.DistinctCategories(ctx)
}

// DistinctActions returns the top-100 most-recent action names.
func (s *Service) DistinctActions(ctx context.Context) ([]string, error) {
	if s == nil || s.repo == nil {
		return nil, ErrNotConfigured
	}
	return s.repo.DistinctActions(ctx)
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
	return s.recorder.VerifyChain(ctx, since, limit)
}
