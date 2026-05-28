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

// Service is the orchestrator. Holds a pointer so the App can wire
// once and pass nil for any subsystem not configured.
type Service struct {
	repo *dbgdpr.ArtifactRepo
}

// New constructs the service. repo MAY be nil; methods then return
// ErrNotConfigured.
func New(repo *dbgdpr.ArtifactRepo) *Service {
	return &Service{repo: repo}
}

// Get fetches the manifest by ID. Returns ErrNotConfigured when the
// repo is nil and ErrNotFound when the id is unknown.
func (s *Service) Get(ctx context.Context, id string) (*Artifact, error) {
	if s == nil || s.repo == nil {
		return nil, ErrNotConfigured
	}
	a, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
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
	return s.repo.RecordDownload(ctx, id)
}
