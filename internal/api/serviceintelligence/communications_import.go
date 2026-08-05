package serviceintelligence

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/integrations/nhtsa"
)

const communicationsImportTimeout = 3 * time.Minute

type CommunicationsImportService struct {
	catalog  communicationsCatalog
	importer nhtsa.ManufacturerCommunicationsArtifactImporter
}

func NewCommunicationsImportService(
	db *database.DB,
	importer nhtsa.ManufacturerCommunicationsArtifactImporter,
) *CommunicationsImportService {
	if importer == nil {
		panic("serviceintelligence.NewCommunicationsImportService: importer must not be nil")
	}
	return &CommunicationsImportService{
		catalog:  newCommunicationRepository(db),
		importer: importer,
	}
}

func (s *CommunicationsImportService) Status(ctx context.Context) (CommunicationsCatalogState, error) {
	if s == nil || s.catalog == nil {
		return CommunicationsCatalogState{}, errors.New("manufacturer communications import service is not configured")
	}
	state, err := s.catalog.State(ctx)
	if err != nil {
		return CommunicationsCatalogState{}, fmt.Errorf("read manufacturer communications import status: %w", err)
	}
	return state, nil
}

func (s *CommunicationsImportService) Import(
	ctx context.Context,
	artifactURL string,
) (*CommunicationImportStatus, error) {
	if s == nil || s.catalog == nil || s.importer == nil {
		return nil, errors.New("manufacturer communications import service is not configured")
	}
	artifactURL = strings.TrimSpace(artifactURL)
	if err := s.importer.ValidateManufacturerCommunicationsArtifactURL(artifactURL); err != nil {
		return nil, fmt.Errorf("validate official communications artifact URL: %w", nhtsa.ErrInvalidRequest)
	}
	validator, err := s.catalog.Validator(ctx, artifactURL)
	if err != nil {
		return nil, fmt.Errorf("read prior communications artifact validator: %w", err)
	}
	started, err := s.catalog.StartImport(ctx, artifactURL)
	if err != nil {
		return nil, err
	}

	importCtx, cancel := context.WithTimeout(ctx, communicationsImportTimeout)
	defer cancel()
	artifact, err := s.importer.ImportManufacturerCommunications(importCtx, artifactURL, validator)
	if err != nil {
		s.recordFailedImport(ctx, started.ID, err)
		return nil, fmt.Errorf("import official NHTSA manufacturer communications: %w", err)
	}
	if artifact.NotModified {
		artifact.ArtifactURL = artifactURL
		if artifact.ETag == "" {
			artifact.ETag = validator.ETag
		}
		if artifact.LastModified == "" {
			artifact.LastModified = validator.LastModified
		}
	}
	completed, err := s.catalog.CompleteImport(ctx, started.ID, artifact)
	if err != nil {
		s.recordFailedImport(ctx, started.ID, err)
		return nil, fmt.Errorf("persist normalized NHTSA manufacturer communications: %w", err)
	}
	return completed, nil
}

func (s *CommunicationsImportService) recordFailedImport(
	ctx context.Context,
	importID int64,
	importErr error,
) {
	detail := importErr.Error()
	if len(detail) > 500 {
		detail = detail[:500]
	}
	failCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_ = s.catalog.FailImport(failCtx, importID, detail)
}
