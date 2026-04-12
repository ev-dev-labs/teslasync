package exportsvc

import (
	"context"
	"fmt"
	"io"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/export"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

// mockExportJobRepo implements repository.ExportJobRepository for testing.
type mockExportJobRepo struct {
	jobs map[string]*export.ExportJob
}

func newMockExportJobRepo() *mockExportJobRepo {
	return &mockExportJobRepo{jobs: make(map[string]*export.ExportJob)}
}

func (m *mockExportJobRepo) GetByID(_ context.Context, id string) (*export.ExportJob, error) {
	j, ok := m.jobs[id]
	if !ok {
		return nil, fmt.Errorf("export job %s: not found", id)
	}
	cp := *j
	return &cp, nil
}

func (m *mockExportJobRepo) GetByUserID(_ context.Context, userID string) ([]export.ExportJob, error) {
	var result []export.ExportJob
	for _, j := range m.jobs {
		if j.UserID == userID {
			result = append(result, *j)
		}
	}
	return result, nil
}

func (m *mockExportJobRepo) Save(_ context.Context, job *export.ExportJob) error {
	cp := *job
	m.jobs[job.ID] = &cp
	return nil
}

func (m *mockExportJobRepo) GetByIDForUpdate(ctx context.Context, id string) (*export.ExportJob, error) {
	return m.GetByID(ctx, id)
}

// mockFSMHistory implements repository.FSMHistoryRepository for testing.
type mockFSMHistory struct {
	records []repository.FSMTransitionRecord
}

func (m *mockFSMHistory) RecordTransition(_ context.Context, r repository.FSMTransitionRecord) error {
	m.records = append(m.records, r)
	return nil
}

func (m *mockFSMHistory) GetHistory(_ context.Context, _ string, _ int) ([]repository.FSMTransitionRecord, error) {
	return m.records, nil
}

func (m *mockFSMHistory) GetByEntityID(_ context.Context, entityID string) ([]repository.FSMTransitionRecord, error) {
	var result []repository.FSMTransitionRecord
	for _, r := range m.records {
		if r.EntityID == entityID {
			result = append(result, r)
		}
	}
	return result, nil
}

// mockStorageProvider implements external.StorageProvider for testing.
type mockStorageProvider struct {
	url string
	err error
}

func (m *mockStorageProvider) Upload(_ context.Context, _ string, _ io.Reader) (string, error) {
	return m.url, m.err
}

func (m *mockStorageProvider) GetSignedURL(_ context.Context, _ string, _ time.Duration) (string, error) {
	return m.url, m.err
}

func (m *mockStorageProvider) Delete(_ context.Context, _ string) error {
	return m.err
}

func TestService_Create(t *testing.T) {
	repo := newMockExportJobRepo()
	svc := New(repo, &mockFSMHistory{}, &mockStorageProvider{})

	job := &export.ExportJob{
		ID:        "e1",
		UserID:    "u1",
		Format:    "csv",
		VehicleID: "v1",
		DateFrom:  time.Now().AddDate(0, -1, 0),
		DateTo:    time.Now(),
	}
	err := svc.Create(context.Background(), job)
	if err != nil {
		t.Fatalf("Create() error: %v", err)
	}

	got, err := svc.GetByID(context.Background(), "e1")
	if err != nil {
		t.Fatalf("GetByID() error: %v", err)
	}
	if got.FSMState != export.StateQueued {
		t.Errorf("expected FSMState 'queued', got %q", got.FSMState)
	}
	if got.UserID != "u1" {
		t.Errorf("expected UserID 'u1', got %q", got.UserID)
	}
}

func TestService_GetByID_NotFound(t *testing.T) {
	svc := New(newMockExportJobRepo(), &mockFSMHistory{}, &mockStorageProvider{})

	_, err := svc.GetByID(context.Background(), "nonexistent")
	if err == nil {
		t.Error("expected error for non-existent export job")
	}
}

func TestService_GetByUserID(t *testing.T) {
	repo := newMockExportJobRepo()
	svc := New(repo, &mockFSMHistory{}, &mockStorageProvider{})

	for i := 0; i < 3; i++ {
		job := &export.ExportJob{
			ID:     fmt.Sprintf("e%d", i),
			UserID: "u1",
			Format: "csv",
		}
		_ = svc.Create(context.Background(), job)
	}

	jobs, err := svc.GetByUserID(context.Background(), "u1")
	if err != nil {
		t.Fatalf("GetByUserID() error: %v", err)
	}
	if len(jobs) != 3 {
		t.Errorf("expected 3 jobs, got %d", len(jobs))
	}
}

func TestService_HandleEvent(t *testing.T) {
	repo := newMockExportJobRepo()
	history := &mockFSMHistory{}
	svc := New(repo, history, &mockStorageProvider{})

	job := &export.ExportJob{
		ID:       "e1",
		UserID:   "u1",
		Format:   "csv",
		FSMState: export.StateQueued,
	}
	_ = repo.Save(context.Background(), job)

	// Fire validate event: queued -> validating
	err := svc.HandleEvent(context.Background(), "e1", export.EventValidate)
	if err != nil {
		t.Fatalf("HandleEvent(validate) error: %v", err)
	}

	got, _ := repo.GetByID(context.Background(), "e1")
	if got.FSMState != export.StateValidating {
		t.Errorf("expected state 'validating', got %q", got.FSMState)
	}

	if len(history.records) != 1 {
		t.Errorf("expected 1 transition record, got %d", len(history.records))
	}
}

func TestService_HandleEvent_InvalidTransition(t *testing.T) {
	repo := newMockExportJobRepo()
	svc := New(repo, &mockFSMHistory{}, &mockStorageProvider{})

	job := &export.ExportJob{
		ID:       "e1",
		UserID:   "u1",
		Format:   "csv",
		FSMState: export.StateQueued,
	}
	_ = repo.Save(context.Background(), job)

	// complete is not valid from queued state
	err := svc.HandleEvent(context.Background(), "e1", export.EventComplete)
	if err == nil {
		t.Error("expected error for invalid transition")
	}
}

func TestService_HandleEvent_FullFlow(t *testing.T) {
	repo := newMockExportJobRepo()
	history := &mockFSMHistory{}
	svc := New(repo, history, &mockStorageProvider{})

	job := &export.ExportJob{ID: "e1", UserID: "u1", Format: "json", FSMState: export.StateQueued}
	_ = repo.Save(context.Background(), job)

	if err := svc.HandleEvent(context.Background(), "e1", export.EventValidate); err != nil {
		t.Fatalf("validate error: %v", err)
	}
	if err := svc.HandleEvent(context.Background(), "e1", export.EventProcess); err != nil {
		t.Fatalf("process error: %v", err)
	}
	if err := svc.HandleEvent(context.Background(), "e1", export.EventUpload); err != nil {
		t.Fatalf("upload error: %v", err)
	}
	if err := svc.HandleEvent(context.Background(), "e1", export.EventComplete); err != nil {
		t.Fatalf("complete error: %v", err)
	}

	got, _ := repo.GetByID(context.Background(), "e1")
	if got.FSMState != export.StateCompleted {
		t.Errorf("expected state 'completed', got %q", got.FSMState)
	}
	if got.CompletedAt.IsZero() {
		t.Error("expected CompletedAt to be set")
	}
	if len(history.records) != 4 {
		t.Errorf("expected 4 transition records, got %d", len(history.records))
	}
}
