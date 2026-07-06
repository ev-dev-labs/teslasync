// Service unit tests. The orchestrator talks to persistence through the
// unexported artifactStore port, so these tests substitute a scripted fake
// (fakeStore) and never touch a live database — mirroring the database.DBTX
// seam the underlying repo uses (see internal/database/gdpr/artifact_repo_test.go)
// and the port-fake pattern in sibling services (exportsvc). Everything is
// table-driven and safe under -race.
package gdprexportsvc

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	dbgdpr "github.com/ev-dev-labs/teslasync/internal/database/gdpr"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Scripted port fake.
// ---------------------------------------------------------------------------

// fakeStore is a scripted artifactStore. It records every call so tests can
// pin the forwarded id, and returns pre-loaded responses. A mutex guards the
// recorders so the concurrency test can hammer it under -race.
type fakeStore struct {
	mu sync.Mutex

	getArtifact *Artifact
	getErr      error
	recErr      error

	getCalls []string
	recCalls []string
}

func (f *fakeStore) GetByID(_ context.Context, id string) (*Artifact, error) {
	f.mu.Lock()
	f.getCalls = append(f.getCalls, id)
	f.mu.Unlock()
	return f.getArtifact, f.getErr
}

func (f *fakeStore) RecordDownload(_ context.Context, id string) error {
	f.mu.Lock()
	f.recCalls = append(f.recCalls, id)
	f.mu.Unlock()
	return f.recErr
}

func (f *fakeStore) getCallCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.getCalls)
}

func (f *fakeStore) recCallCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.recCalls)
}

func (f *fakeStore) lastGetID() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.getCalls) == 0 {
		return ""
	}
	return f.getCalls[len(f.getCalls)-1]
}

func (f *fakeStore) lastRecID() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.recCalls) == 0 {
		return ""
	}
	return f.recCalls[len(f.recCalls)-1]
}

// Compile-time proof the fake satisfies the same port the real repo does.
var _ artifactStore = (*fakeStore)(nil)

// errBoom is a distinct sentinel used to prove error wrapping preserves the
// chain (errors.Is still matches) while adding call-site context.
var errBoom = errors.New("boom: simulated repo failure")

func sampleArtifact() *Artifact {
	return &Artifact{
		ID:          "art-1",
		ExportJobID: "job-1",
		VehicleID:   7,
		StorageKind: StorageKindLocalFS,
		StoragePath: "/exports/art-1.tar.gz",
		SHA256:      strings.Repeat("a", 64),
		ByteCount:   2048,
		CreatedAt:   time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC),
		ExpiresAt:   time.Date(2026, 6, 8, 10, 0, 0, 0, time.UTC),
	}
}

// ---------------------------------------------------------------------------
// New — construction + typed-nil normalisation contract.
// ---------------------------------------------------------------------------

func TestNew_NilRepo_LeavesPortNil(t *testing.T) {
	t.Parallel()
	svc := New(nil)
	if svc == nil {
		t.Fatal("New(nil) returned a nil *Service")
	}
	// The critical property: a nil *dbgdpr.ArtifactRepo must NOT become a
	// non-nil (typed-nil) interface, otherwise the s.repo == nil guard breaks
	// and callers would hit the repo instead of getting ErrNotConfigured.
	if svc.repo != nil {
		t.Error("New(nil): svc.repo must be a nil port (typed-nil footgun)")
	}

	if _, err := svc.Get(context.Background(), "x"); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("Get on nil-repo service = %v, want ErrNotConfigured", err)
	}
	if err := svc.RecordDownload(context.Background(), "x"); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("RecordDownload on nil-repo service = %v, want ErrNotConfigured", err)
	}
}

func TestNew_NonNilRepo_Wired(t *testing.T) {
	t.Parallel()
	// A lazily-created pool does not connect (pgxpool.NewWithConfig is lazy),
	// so a non-nil repo is available with no live database. We only assert the
	// port was wired — no method is invoked, so nothing dials Postgres.
	cfg, err := pgxpool.ParseConfig("postgres://u:p@127.0.0.1:5432/db?sslmode=disable")
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	cfg.MinConns = 0
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("NewWithConfig (should be lazy): %v", err)
	}
	defer pool.Close()

	repo := dbgdpr.NewArtifactRepo(&database.DB{Pool: pool})
	if repo == nil {
		t.Fatal("NewArtifactRepo(valid lazy pool) = nil, want non-nil")
	}
	svc := New(repo)
	if svc.repo == nil {
		t.Error("New(non-nil repo): svc.repo must be wired, got nil port")
	}
}

// ---------------------------------------------------------------------------
// Get — full matrix.
// ---------------------------------------------------------------------------

func TestService_Get(t *testing.T) {
	tests := []struct {
		name      string
		build     func() (*Service, *fakeStore)
		id        string
		wantArtID string // expected returned artifact ID; "" => expect nil artifact
		wantErrIs error  // errors.Is target; nil => expect no error
		wantCalls int    // expected GetByID invocations on the fake
	}{
		{
			name: "success returns artifact and forwards id",
			build: func() (*Service, *fakeStore) {
				f := &fakeStore{getArtifact: sampleArtifact()}
				return &Service{repo: f}, f
			},
			id:        "art-1",
			wantArtID: "art-1",
			wantErrIs: nil,
			wantCalls: 1,
		},
		{
			name: "repo returns nil artifact maps to ErrNotFound",
			build: func() (*Service, *fakeStore) {
				f := &fakeStore{getArtifact: nil, getErr: nil}
				return &Service{repo: f}, f
			},
			id:        "missing",
			wantArtID: "",
			wantErrIs: ErrNotFound,
			wantCalls: 1,
		},
		{
			name: "repo error is wrapped and still matches via errors.Is",
			build: func() (*Service, *fakeStore) {
				f := &fakeStore{getErr: errBoom}
				return &Service{repo: f}, f
			},
			id:        "art-1",
			wantArtID: "",
			wantErrIs: errBoom,
			wantCalls: 1,
		},
		{
			name: "empty id short-circuits to ErrNotFound without a repo call",
			build: func() (*Service, *fakeStore) {
				f := &fakeStore{getArtifact: sampleArtifact()}
				return &Service{repo: f}, f
			},
			id:        "",
			wantArtID: "",
			wantErrIs: ErrNotFound,
			wantCalls: 0,
		},
		{
			name: "nil repo returns ErrNotConfigured",
			build: func() (*Service, *fakeStore) {
				return New(nil), nil
			},
			id:        "art-1",
			wantArtID: "",
			wantErrIs: ErrNotConfigured,
			wantCalls: 0,
		},
		{
			name: "nil service receiver returns ErrNotConfigured",
			build: func() (*Service, *fakeStore) {
				return nil, nil
			},
			id:        "art-1",
			wantArtID: "",
			wantErrIs: ErrNotConfigured,
			wantCalls: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, fake := tt.build()

			got, err := svc.Get(context.Background(), tt.id)

			if tt.wantErrIs == nil {
				if err != nil {
					t.Fatalf("Get() unexpected error: %v", err)
				}
			} else if !errors.Is(err, tt.wantErrIs) {
				t.Fatalf("Get() error = %v, want errors.Is(%v)", err, tt.wantErrIs)
			}

			// A repo/plumbing error must never be mistaken for one of the
			// routed sentinels the handler maps to 404/503.
			if tt.wantErrIs == errBoom {
				if errors.Is(err, ErrNotFound) || errors.Is(err, ErrNotConfigured) {
					t.Errorf("repo error must not match a routed sentinel: %v", err)
				}
				if !strings.Contains(err.Error(), "gdprexportsvc: get") {
					t.Errorf("repo error missing call-site context: %q", err.Error())
				}
			}

			if tt.wantArtID == "" {
				if got != nil {
					t.Errorf("Get() artifact = %+v, want nil", got)
				}
			} else {
				if got == nil {
					t.Fatalf("Get() artifact = nil, want id %q", tt.wantArtID)
				}
				if got.ID != tt.wantArtID {
					t.Errorf("Get() artifact id = %q, want %q", got.ID, tt.wantArtID)
				}
			}

			if fake != nil {
				if n := fake.getCallCount(); n != tt.wantCalls {
					t.Errorf("GetByID call count = %d, want %d", n, tt.wantCalls)
				}
				if tt.wantCalls > 0 && fake.lastGetID() != tt.id {
					t.Errorf("GetByID forwarded id = %q, want %q", fake.lastGetID(), tt.id)
				}
			}
		})
	}
}

// ---------------------------------------------------------------------------
// RecordDownload — full matrix.
// ---------------------------------------------------------------------------

func TestService_RecordDownload(t *testing.T) {
	tests := []struct {
		name      string
		build     func() (*Service, *fakeStore)
		id        string
		wantErrIs error // errors.Is target; nil => expect no error
		wantCalls int
	}{
		{
			name: "success forwards id and returns nil",
			build: func() (*Service, *fakeStore) {
				f := &fakeStore{}
				return &Service{repo: f}, f
			},
			id:        "art-1",
			wantErrIs: nil,
			wantCalls: 1,
		},
		{
			name: "repo error is wrapped and still matches via errors.Is",
			build: func() (*Service, *fakeStore) {
				f := &fakeStore{recErr: errBoom}
				return &Service{repo: f}, f
			},
			id:        "art-1",
			wantErrIs: errBoom,
			wantCalls: 1,
		},
		{
			name: "nil repo returns ErrNotConfigured",
			build: func() (*Service, *fakeStore) {
				return New(nil), nil
			},
			id:        "art-1",
			wantErrIs: ErrNotConfigured,
			wantCalls: 0,
		},
		{
			name: "nil service receiver returns ErrNotConfigured",
			build: func() (*Service, *fakeStore) {
				return nil, nil
			},
			id:        "art-1",
			wantErrIs: ErrNotConfigured,
			wantCalls: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, fake := tt.build()

			err := svc.RecordDownload(context.Background(), tt.id)

			if tt.wantErrIs == nil {
				if err != nil {
					t.Fatalf("RecordDownload() unexpected error: %v", err)
				}
			} else if !errors.Is(err, tt.wantErrIs) {
				t.Fatalf("RecordDownload() error = %v, want errors.Is(%v)", err, tt.wantErrIs)
			}

			if tt.wantErrIs == errBoom {
				if errors.Is(err, ErrNotConfigured) {
					t.Errorf("repo error must not match ErrNotConfigured: %v", err)
				}
				if !strings.Contains(err.Error(), "gdprexportsvc: record download") {
					t.Errorf("repo error missing call-site context: %q", err.Error())
				}
			}

			if fake != nil {
				if n := fake.recCallCount(); n != tt.wantCalls {
					t.Errorf("RecordDownload call count = %d, want %d", n, tt.wantCalls)
				}
				if tt.wantCalls > 0 && fake.lastRecID() != tt.id {
					t.Errorf("RecordDownload forwarded id = %q, want %q", fake.lastRecID(), tt.id)
				}
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Re-exported surface — guard against silent value drift.
// ---------------------------------------------------------------------------

func TestReExportedSymbols(t *testing.T) {
	t.Parallel()

	if string(StorageKindLocalFS) != "local_fs" {
		t.Errorf("StorageKindLocalFS = %q, want %q", StorageKindLocalFS, "local_fs")
	}
	if string(StorageKindS3) != "s3" {
		t.Errorf("StorageKindS3 = %q, want %q", StorageKindS3, "s3")
	}
	if StorageKindLocalFS == StorageKindS3 {
		t.Error("re-exported storage kinds must be distinct")
	}

	// The re-exported consts must be identical to their dbgdpr source so the
	// handler and worker agree on the persisted CHECK values.
	if StorageKindLocalFS != dbgdpr.StorageKindLocalFS || StorageKindS3 != dbgdpr.StorageKindS3 {
		t.Error("re-exported storage kinds drifted from dbgdpr source")
	}

	// Artifact is a type alias for dbgdpr.Artifact — assignable both ways.
	var a Artifact = dbgdpr.Artifact{ID: "x"}
	var b dbgdpr.Artifact = a
	if b.ID != "x" {
		t.Errorf("Artifact alias round-trip lost data: %+v", b)
	}

	if errors.Is(ErrNotConfigured, ErrNotFound) {
		t.Error("ErrNotConfigured and ErrNotFound must be distinct sentinels")
	}
}

// ---------------------------------------------------------------------------
// Concurrency — the service must be race-clean under simultaneous callers.
// ---------------------------------------------------------------------------

func TestService_ConcurrentAccess(t *testing.T) {
	fake := &fakeStore{getArtifact: sampleArtifact()}
	svc := &Service{repo: fake}

	const workers = 50
	var wg sync.WaitGroup
	wg.Add(workers * 2)
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			if _, err := svc.Get(context.Background(), "art-1"); err != nil {
				t.Errorf("concurrent Get error: %v", err)
			}
		}()
		go func() {
			defer wg.Done()
			if err := svc.RecordDownload(context.Background(), "art-1"); err != nil {
				t.Errorf("concurrent RecordDownload error: %v", err)
			}
		}()
	}
	wg.Wait()

	if got := fake.getCallCount(); got != workers {
		t.Errorf("GetByID calls = %d, want %d", got, workers)
	}
	if got := fake.recCallCount(); got != workers {
		t.Errorf("RecordDownload calls = %d, want %d", got, workers)
	}
}
