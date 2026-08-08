package serviceintelligence

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/integrations/nhtsa"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	defaultCommunicationsFreshness = 8 * 24 * time.Hour
	maxCommunicationMatches        = 500
	communicationInsertBatchSize   = 500
)

var ErrCommunicationImportInProgress = errors.New("manufacturer communications import already in progress")

type CommunicationImportStatus struct {
	ID                 int64      `json:"id"`
	ArtifactURL        string     `json:"artifact_url"`
	SourceETag         *string    `json:"source_etag"`
	SourceLastModified *string    `json:"source_last_modified"`
	ArtifactSHA256     *string    `json:"artifact_sha256"`
	Status             string     `json:"status"`
	TotalRows          int        `json:"total_rows"`
	ImportedRows       int        `json:"imported_rows"`
	RejectedRows       int        `json:"rejected_rows"`
	NotModified        bool       `json:"not_modified"`
	ErrorDetail        *string    `json:"error_detail"`
	StartedAt          time.Time  `json:"started_at"`
	CompletedAt        *time.Time `json:"completed_at"`
}

type CommunicationsCatalogState struct {
	LatestAttempt    *CommunicationImportStatus `json:"latest_attempt"`
	LatestSuccessful *CommunicationImportStatus `json:"latest_successful"`
	RecordCount      int                        `json:"record_count"`
}

type communicationsCatalog interface {
	Match(ctx context.Context, query nhtsa.VehicleQuery, limit int) ([]nhtsa.ManufacturerCommunication, error)
	State(ctx context.Context) (CommunicationsCatalogState, error)
	Validator(ctx context.Context, artifactURL string) (nhtsa.CommunicationsArtifactValidator, error)
	StartImport(ctx context.Context, artifactURL string) (*CommunicationImportStatus, error)
	CompleteImport(ctx context.Context, importID int64, artifact nhtsa.CommunicationsArtifact) (*CommunicationImportStatus, error)
	FailImport(ctx context.Context, importID int64, detail string) error
}

type communicationRepository struct {
	db *database.DB
	q  database.DBTX
}

func newCommunicationRepository(db *database.DB) *communicationRepository {
	if db == nil || db.Pool == nil {
		panic("serviceintelligence.newCommunicationRepository: db and db.Pool must not be nil")
	}
	return &communicationRepository{db: db, q: db.Pool}
}

const communicationMatchQuery = `
SELECT
	nhtsa_id,
	communication_number,
	communication_type,
	manufacturer,
	model,
	model_year,
	published_at,
	component,
	summary,
	source_document_url
FROM nhtsa_manufacturer_communications
WHERE upper(manufacturer) = upper($1)
  AND upper(model) = upper($2)
  AND model_year = $3
ORDER BY published_at DESC NULLS LAST, nhtsa_id
LIMIT $4`

func (r *communicationRepository) Match(
	ctx context.Context,
	query nhtsa.VehicleQuery,
	limit int,
) ([]nhtsa.ManufacturerCommunication, error) {
	if r == nil || r.q == nil {
		return nil, errors.New("manufacturer communications repository is not configured")
	}
	query.Make = strings.TrimSpace(query.Make)
	query.Model = strings.TrimSpace(query.Model)
	if query.Make == "" || query.Model == "" || query.ModelYear < 1886 || limit <= 0 || limit > maxCommunicationMatches {
		return nil, errors.New("invalid manufacturer communications match query")
	}
	rows, err := r.q.Query(ctx, communicationMatchQuery, query.Make, query.Model, query.ModelYear, limit)
	if err != nil {
		return nil, fmt.Errorf("query manufacturer communications: %w", err)
	}
	defer rows.Close()

	communications := make([]nhtsa.ManufacturerCommunication, 0)
	for rows.Next() {
		var communication nhtsa.ManufacturerCommunication
		if err := rows.Scan(
			&communication.NHTSAID,
			&communication.CommunicationNumber,
			&communication.CommunicationType,
			&communication.Manufacturer,
			&communication.Model,
			&communication.ModelYear,
			&communication.PublishedAt,
			&communication.Component,
			&communication.Summary,
			&communication.SourceDocumentURL,
		); err != nil {
			return nil, fmt.Errorf("scan manufacturer communication: %w", err)
		}
		communications = append(communications, communication)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate manufacturer communications: %w", err)
	}
	return communications, nil
}

const latestImportQuery = `
SELECT
	id,
	artifact_url,
	source_etag,
	source_last_modified,
	artifact_sha256,
	status,
	total_rows,
	imported_rows,
	rejected_rows,
	not_modified,
	error_detail,
	started_at,
	completed_at
FROM nhtsa_communication_imports
%s
ORDER BY started_at DESC, id DESC
LIMIT 1`

func (r *communicationRepository) State(ctx context.Context) (CommunicationsCatalogState, error) {
	if r == nil || r.q == nil {
		return CommunicationsCatalogState{}, errors.New("manufacturer communications repository is not configured")
	}
	latest, err := r.latestImport(ctx, "")
	if err != nil {
		return CommunicationsCatalogState{}, err
	}
	successful, err := r.latestImport(ctx, "WHERE status = 'succeeded'")
	if err != nil {
		return CommunicationsCatalogState{}, err
	}
	var count int
	if err := r.q.QueryRow(ctx, `SELECT count(*) FROM nhtsa_manufacturer_communications`).Scan(&count); err != nil {
		return CommunicationsCatalogState{}, fmt.Errorf("count manufacturer communications: %w", err)
	}
	return CommunicationsCatalogState{
		LatestAttempt:    latest,
		LatestSuccessful: successful,
		RecordCount:      count,
	}, nil
}

func (r *communicationRepository) Validator(
	ctx context.Context,
	artifactURL string,
) (nhtsa.CommunicationsArtifactValidator, error) {
	if r == nil || r.q == nil {
		return nhtsa.CommunicationsArtifactValidator{}, errors.New("manufacturer communications repository is not configured")
	}
	var etag, modified *string
	err := r.q.QueryRow(
		ctx,
		fmt.Sprintf(latestImportQuery, "WHERE status = 'succeeded' AND artifact_url = $1"),
		artifactURL,
	).Scan(
		new(int64),
		new(string),
		&etag,
		&modified,
		new(*string),
		new(string),
		new(int),
		new(int),
		new(int),
		new(bool),
		new(*string),
		new(time.Time),
		new(*time.Time),
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nhtsa.CommunicationsArtifactValidator{}, nil
	}
	if err != nil {
		return nhtsa.CommunicationsArtifactValidator{}, fmt.Errorf("read communications artifact validator: %w", err)
	}
	validator := nhtsa.CommunicationsArtifactValidator{}
	if etag != nil {
		validator.ETag = *etag
	}
	if modified != nil {
		validator.LastModified = *modified
	}
	return validator, nil
}

func (r *communicationRepository) StartImport(
	ctx context.Context,
	artifactURL string,
) (*CommunicationImportStatus, error) {
	if r == nil || r.q == nil || strings.TrimSpace(artifactURL) == "" {
		return nil, errors.New("invalid manufacturer communications import")
	}
	status := &CommunicationImportStatus{}
	err := r.q.QueryRow(
		ctx,
		`INSERT INTO nhtsa_communication_imports (artifact_url, status)
		 VALUES ($1, 'running')
		 RETURNING id, artifact_url, source_etag, source_last_modified,
		           artifact_sha256, status, total_rows, imported_rows,
		           rejected_rows, not_modified, error_detail, started_at, completed_at`,
		artifactURL,
	).Scan(importStatusDestinations(status)...)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrCommunicationImportInProgress
		}
		return nil, fmt.Errorf("start manufacturer communications import: %w", err)
	}
	return status, nil
}

func (r *communicationRepository) CompleteImport(
	ctx context.Context,
	importID int64,
	artifact nhtsa.CommunicationsArtifact,
) (*CommunicationImportStatus, error) {
	if r == nil || r.db == nil || importID <= 0 {
		return nil, errors.New("invalid manufacturer communications import completion")
	}
	var completed CommunicationImportStatus
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if !artifact.NotModified {
			if _, err := tx.Exec(
				ctx,
				`DELETE FROM nhtsa_manufacturer_communications
				 WHERE import_id IN (
					SELECT id
					FROM nhtsa_communication_imports
					WHERE artifact_url = $1 AND status = 'succeeded'
				 )`,
				artifact.ArtifactURL,
			); err != nil {
				return fmt.Errorf("remove prior normalized communications artifact: %w", err)
			}
			for start := 0; start < len(artifact.Records); start += communicationInsertBatchSize {
				end := start + communicationInsertBatchSize
				if end > len(artifact.Records) {
					end = len(artifact.Records)
				}
				batch := &pgx.Batch{}
				for _, communication := range artifact.Records[start:end] {
					batch.Queue(
						`INSERT INTO nhtsa_manufacturer_communications (
							nhtsa_id, communication_number, communication_type,
							manufacturer, model, model_year, published_at,
							component, summary, source_document_url, import_id
						 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
						 ON CONFLICT (nhtsa_id, manufacturer, model, model_year)
						 DO UPDATE SET
							communication_number = EXCLUDED.communication_number,
							communication_type = EXCLUDED.communication_type,
							published_at = EXCLUDED.published_at,
							component = EXCLUDED.component,
							summary = EXCLUDED.summary,
							source_document_url = EXCLUDED.source_document_url,
							import_id = EXCLUDED.import_id`,
						communication.NHTSAID,
						communication.CommunicationNumber,
						communication.CommunicationType,
						communication.Manufacturer,
						communication.Model,
						communication.ModelYear,
						communication.PublishedAt,
						communication.Component,
						communication.Summary,
						communication.SourceDocumentURL,
						importID,
					)
				}
				results := tx.SendBatch(ctx, batch)
				for range artifact.Records[start:end] {
					if _, err := results.Exec(); err != nil {
						_ = results.Close()
						return fmt.Errorf("upsert normalized manufacturer communication: %w", err)
					}
				}
				if err := results.Close(); err != nil {
					return fmt.Errorf("close manufacturer communications batch: %w", err)
				}
			}
		}

		importedRows := len(artifact.Records)
		err := tx.QueryRow(
			ctx,
			`WITH prior AS (
				SELECT source_etag, source_last_modified, artifact_sha256,
				       total_rows, imported_rows, rejected_rows
				FROM nhtsa_communication_imports
				WHERE artifact_url = (
					SELECT artifact_url FROM nhtsa_communication_imports WHERE id = $1
				)
				  AND status = 'succeeded'
				ORDER BY completed_at DESC, id DESC
				LIMIT 1
			 )
			 UPDATE nhtsa_communication_imports
			 SET source_etag = COALESCE(NULLIF($2, ''), (SELECT source_etag FROM prior)),
			     source_last_modified = COALESCE(NULLIF($3, ''), (SELECT source_last_modified FROM prior)),
			     artifact_sha256 = COALESCE(NULLIF($4, ''), (SELECT artifact_sha256 FROM prior)),
			     status = 'succeeded',
			     total_rows = CASE WHEN $8 THEN COALESCE((SELECT total_rows FROM prior), 0) ELSE $5 END,
			     imported_rows = CASE WHEN $8 THEN COALESCE((SELECT imported_rows FROM prior), 0) ELSE $6 END,
			     rejected_rows = CASE WHEN $8 THEN COALESCE((SELECT rejected_rows FROM prior), 0) ELSE $7 END,
			     not_modified = $8,
			     error_detail = NULL,
			     completed_at = now()
			 WHERE id = $1 AND status = 'running'
			 RETURNING id, artifact_url, source_etag, source_last_modified,
			           artifact_sha256, status, total_rows, imported_rows,
			           rejected_rows, not_modified, error_detail, started_at, completed_at`,
			importID,
			artifact.ETag,
			artifact.LastModified,
			artifact.SHA256,
			artifact.TotalRows,
			importedRows,
			artifact.RejectedRows,
			artifact.NotModified,
		).Scan(importStatusDestinations(&completed)...)
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("manufacturer communications import is no longer running")
		}
		if err != nil {
			return fmt.Errorf("complete manufacturer communications import: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &completed, nil
}

func (r *communicationRepository) FailImport(ctx context.Context, importID int64, detail string) error {
	if r == nil || r.q == nil || importID <= 0 {
		return errors.New("invalid manufacturer communications import failure")
	}
	if len(detail) > 500 {
		detail = detail[:500]
	}
	_, err := r.q.Exec(
		ctx,
		`UPDATE nhtsa_communication_imports
		 SET status = 'failed', error_detail = $2, completed_at = now()
		 WHERE id = $1 AND status = 'running'`,
		importID,
		detail,
	)
	if err != nil {
		return fmt.Errorf("fail manufacturer communications import: %w", err)
	}
	return nil
}

func (r *communicationRepository) latestImport(
	ctx context.Context,
	filter string,
) (*CommunicationImportStatus, error) {
	status := &CommunicationImportStatus{}
	err := r.q.QueryRow(ctx, fmt.Sprintf(latestImportQuery, filter)).
		Scan(importStatusDestinations(status)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read manufacturer communications import status: %w", err)
	}
	return status, nil
}

func importStatusDestinations(status *CommunicationImportStatus) []any {
	return []any{
		&status.ID,
		&status.ArtifactURL,
		&status.SourceETag,
		&status.SourceLastModified,
		&status.ArtifactSHA256,
		&status.Status,
		&status.TotalRows,
		&status.ImportedRows,
		&status.RejectedRows,
		&status.NotModified,
		&status.ErrorDetail,
		&status.StartedAt,
		&status.CompletedAt,
	}
}

// DatabaseManufacturerCommunicationsProvider is the request-time adapter over
// the normalized local NHTSA catalog. It never downloads a bulk artifact on a
// vehicle request.
type DatabaseManufacturerCommunicationsProvider struct {
	catalog  communicationsCatalog
	freshFor time.Duration
	now      func() time.Time
}

func NewDatabaseManufacturerCommunicationsProvider(db *database.DB) *DatabaseManufacturerCommunicationsProvider {
	return &DatabaseManufacturerCommunicationsProvider{
		catalog:  newCommunicationRepository(db),
		freshFor: defaultCommunicationsFreshness,
		now:      time.Now,
	}
}

func (p *DatabaseManufacturerCommunicationsProvider) ManufacturerCommunications(
	ctx context.Context,
	query nhtsa.VehicleQuery,
	_ nhtsa.FetchOptions,
) (nhtsa.ManufacturerCommunicationsResult, error) {
	if p == nil || p.catalog == nil {
		return nhtsa.ManufacturerCommunicationsResult{}, errors.New("manufacturer communications provider is not configured")
	}
	state, err := p.catalog.State(ctx)
	if err != nil {
		return nhtsa.ManufacturerCommunicationsResult{}, fmt.Errorf("read manufacturer communications catalog state: %w", err)
	}
	now := p.now().UTC()
	if state.LatestSuccessful == nil || state.LatestSuccessful.CompletedAt == nil {
		detail := "No successful official NHTSA manufacturer-communications import is available; an authenticated admin import is required."
		return nhtsa.ManufacturerCommunicationsResult{
			Communications: make([]nhtsa.ManufacturerCommunication, 0),
			Source: nhtsa.SourceMetadata{
				ID:          nhtsa.SourceIDCommunications,
				Name:        "NHTSA manufacturer communications",
				Status:      nhtsa.SourceStatusUnavailable,
				RecordCount: 0,
				CheckedAt:   now,
				FromCache:   true,
				SourceURL:   manufacturerCommunicationsDatasetURL,
				Detail:      &detail,
			},
		}, nil
	}

	communications, err := p.catalog.Match(ctx, query, maxCommunicationMatches)
	if err != nil {
		return nhtsa.ManufacturerCommunicationsResult{}, fmt.Errorf("match manufacturer communications: %w", err)
	}
	successful := state.LatestSuccessful
	fetchedAt := successful.CompletedAt.UTC()
	expiresAt := fetchedAt.Add(p.freshFor)
	status := nhtsa.SourceStatusAvailable
	var detail *string
	if !now.Before(expiresAt) {
		status = nhtsa.SourceStatusStale
		message := "The local normalized NHTSA manufacturer-communications index is stale; an authenticated admin import should refresh it."
		detail = &message
	} else if state.LatestAttempt != nil && state.LatestAttempt.Status == "failed" &&
		state.LatestAttempt.StartedAt.After(fetchedAt) {
		message := "The latest import attempt failed; matches are served from the last successful normalized official artifact."
		detail = &message
	}
	return nhtsa.ManufacturerCommunicationsResult{
		Communications: communications,
		Source: nhtsa.SourceMetadata{
			ID:          nhtsa.SourceIDCommunications,
			Name:        "NHTSA manufacturer communications",
			Status:      status,
			RecordCount: len(communications),
			FetchedAt:   &fetchedAt,
			CheckedAt:   now,
			ExpiresAt:   &expiresAt,
			FromCache:   true,
			SourceURL:   successful.ArtifactURL,
			Detail:      detail,
		},
	}, nil
}

const manufacturerCommunicationsDatasetURL = "https://static.nhtsa.gov/odi/ffdd/tsbs/"

var (
	_ communicationsCatalog                    = (*communicationRepository)(nil)
	_ nhtsa.ManufacturerCommunicationsProvider = (*DatabaseManufacturerCommunicationsProvider)(nil)
)
