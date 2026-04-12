package exportsvc

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/export"
	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"github.com/ev-dev-labs/teslasync/internal/port/external"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

// Service orchestrates export job use cases.
type Service struct {
	repo       repository.ExportJobRepository
	fsmHistory repository.FSMHistoryRepository
	storage    external.StorageProvider
	engine     *fsm.Engine[*export.ExportJob]
}

// New creates a new export service.
func New(
	repo repository.ExportJobRepository,
	fsmHistory repository.FSMHistoryRepository,
	storage external.StorageProvider,
) *Service {
	def := export.NewExportFSM()
	return &Service{
		repo:       repo,
		fsmHistory: fsmHistory,
		storage:    storage,
		engine:     fsm.NewEngine[*export.ExportJob](def),
	}
}

// Create queues a new export job.
func (s *Service) Create(ctx context.Context, job *export.ExportJob) error {
	job.FSMState = export.StateQueued
	job.CreatedAt = time.Now()
	return s.repo.Save(ctx, job)
}

// GetByID returns an export job by ID.
func (s *Service) GetByID(ctx context.Context, id string) (*export.ExportJob, error) {
	return s.repo.GetByID(ctx, id)
}

// GetByUserID returns all export jobs for a user.
func (s *Service) GetByUserID(ctx context.Context, userID string) ([]export.ExportJob, error) {
	return s.repo.GetByUserID(ctx, userID)
}

// HandleEvent processes an FSM event for an export job.
func (s *Service) HandleEvent(ctx context.Context, jobID string, event fsm.Event) error {
	job, err := s.repo.GetByID(ctx, jobID)
	if err != nil {
		return fmt.Errorf("loading export job: %w", err)
	}

	oldState := job.FSMState
	newState, err := s.engine.Fire(ctx, job, job.FSMState, event)
	if err != nil {
		return fmt.Errorf("firing event %s on export %s: %w", event, jobID, err)
	}

	job.FSMState = newState
	if newState == export.StateCompleted {
		job.CompletedAt = time.Now()
	}

	if err := s.repo.Save(ctx, job); err != nil {
		return fmt.Errorf("saving export job: %w", err)
	}

	return s.fsmHistory.RecordTransition(ctx, repository.FSMTransitionRecord{
		ID:        fmt.Sprintf("%s-%d", jobID, time.Now().UnixNano()),
		EntityID:  jobID,
		FSMName:   "export_job",
		FromState: oldState,
		Event:     event,
		ToState:   newState,
		CreatedAt: time.Now(),
	})
}
