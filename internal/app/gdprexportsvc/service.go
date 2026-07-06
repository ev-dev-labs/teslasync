// Package gdprexportsvc orchestrates the GDPR data-subject export
// surface used by internal/handler/v1/gdpr_export_handler.go.
//
// The actual export bundle creation happens in the export-worker
// reading export_jobs rows. This service only exposes the manifest
// + download path so the HTTP handler stays thin (per ADR-009
// TestHandlerV1Thinness) and the worker stays decoupled from any
// HTTP-layer types.
package gdprexportsvc

import (
	"context"
	"errors"
	"fmt"

	dbgdpr "github.com/ev-dev-labs/teslasync/internal/database/gdpr"
)

// ErrNotConfigured is returned when the backing repo is nil
// (subsystem disabled on this deployment).
var ErrNotConfigured = errors.New("gdpr export subsystem not configured on this deployment")

// ErrNotFound is returned when an artifact id is unknown.
var ErrNotFound = errors.New("export not found")

// Artifact is the wire shape returned by Get + recorded by Insert.
type Artifact = dbgdpr.Artifact

// StorageKind enumerates the supported backends.
type StorageKind = dbgdpr.StorageKind

// StorageKind constants re-exported for the handler.
const (
	StorageKindLocalFS = dbgdpr.StorageKindLocalFS
	StorageKindS3      = dbgdpr.StorageKindS3
)

// artifactStore is the persistence port the orchestrator depends on: the
// subset of *dbgdpr.ArtifactRepo the service actually calls. Declaring the
// seam (instead of holding the concrete repo) lets unit tests substitute a
// scripted fake without a live database — mirroring the database.DBTX seam the
// repo itself uses, and the port pattern in sibling services (exportsvc).
type artifactStore interface {
	GetByID(ctx context.Context, id string) (*Artifact, error)
	RecordDownload(ctx context.Context, id string) error
}

// Compile-time proof the concrete repo still satisfies the port. If a repo
// method signature drifts this fails at build time rather than at the first
// request.
var _ artifactStore = (*dbgdpr.ArtifactRepo)(nil)

// Service is the orchestrator. Holds the repo behind a port so the App can
// wire once and pass nil for any subsystem not configured.
type Service struct {
	repo artifactStore
}

// New constructs the service. repo MAY be nil; methods then return
// ErrNotConfigured. A nil *dbgdpr.ArtifactRepo is deliberately normalised to a
// nil port (rather than assigned straight into the interface) so the
// ErrNotConfigured guard keeps working — assigning a nil concrete pointer into
// an interface yields a non-nil interface value (the typed-nil footgun) that
// would defeat the s.repo == nil check.
func New(repo *dbgdpr.ArtifactRepo) *Service {
	s := &Service{}
	if repo != nil {
		s.repo = repo
	}
	return s
}

// Get fetches the manifest by ID. Returns ErrNotConfigured when the
// repo is nil and ErrNotFound when the id is unknown.
func (s *Service) Get(ctx context.Context, id string) (*Artifact, error) {
	if s == nil || s.repo == nil {
		return nil, ErrNotConfigured
	}
	if id == "" {
		// An unknown id can never match a stored manifest; short-circuit the
		// pointless round trip. Matches the effective GetByID("") result.
		return nil, ErrNotFound
	}
	a, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("gdprexportsvc: get %q: %w", id, err)
	}
	if a == nil {
		return nil, ErrNotFound
	}
	return a, nil
}

// RecordDownload bumps the download counter + audit row. Best-effort:
// the caller already streamed bytes successfully when this is invoked.
func (s *Service) RecordDownload(ctx context.Context, id string) error {
	if s == nil || s.repo == nil {
		return ErrNotConfigured
	}
	if err := s.repo.RecordDownload(ctx, id); err != nil {
		return fmt.Errorf("gdprexportsvc: record download %q: %w", id, err)
	}
	return nil
}
