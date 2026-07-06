package postgres

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

var fsmCols = []string{
	"id", "entity_id", "fsm_name", "from_state", "event", "to_state", "created_at",
}

func fsmRow(r repository.FSMTransitionRecord) []any {
	return []any{r.ID, r.EntityID, r.FSMName, r.FromState, r.Event, r.ToState, r.CreatedAt}
}

func sampleFSMRecord() repository.FSMTransitionRecord {
	base := time.Date(2026, 10, 11, 12, 13, 14, 0, time.UTC)
	return repository.FSMTransitionRecord{
		ID:        "tr-1",
		EntityID:  "veh-42",
		FSMName:   "vehicle",
		FromState: fsm.State("offline"),
		Event:     fsm.Event("wake"),
		ToState:   fsm.State("online"),
		CreatedAt: base,
	}
}

func TestNewFSMHistoryRepository(t *testing.T) {
	t.Parallel()
	repo := NewFSMHistoryRepository(lazyPool(t))
	if repo == nil {
		t.Fatal("NewFSMHistoryRepository returned nil")
	}
	var _ repository.FSMHistoryRepository = repo
	if _, ok := repo.(*fsmHistoryRepository); !ok {
		t.Fatalf("returned %T, want *fsmHistoryRepository", repo)
	}
}

func TestFSMHistoryRepository_RecordTransition(t *testing.T) {
	t.Parallel()
	rec := sampleFSMRecord()
	execBoom := errors.New("constraint violation")

	t.Run("success", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{}
		if err := (&fsmHistoryRepository{pool: pool}).RecordTransition(context.Background(), rec); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if pool.execN != 1 {
			t.Fatalf("execN = %d, want 1", pool.execN)
		}
		if pool.execSQL != queries.InsertFSMTransition {
			t.Errorf("SQL = %q, want InsertFSMTransition", pool.execSQL)
		}
		wantArgs := []any{rec.ID, rec.EntityID, rec.FSMName, rec.FromState, rec.Event, rec.ToState, rec.CreatedAt}
		if !reflect.DeepEqual(pool.execArgs, wantArgs) {
			t.Errorf("exec args = %v,\nwant %v", pool.execArgs, wantArgs)
		}
	})

	t.Run("exec_error", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{execErr: execBoom}
		err := (&fsmHistoryRepository{pool: pool}).RecordTransition(context.Background(), rec)
		if !errors.Is(err, execBoom) {
			t.Fatalf("error = %v, want wrap of execBoom", err)
		}
		if !strings.Contains(err.Error(), "recording FSM transition for entity veh-42") {
			t.Errorf("error %q missing context 'recording FSM transition for entity veh-42'", err)
		}
	})
}

func TestFSMHistoryRepository_GetHistory(t *testing.T) {
	t.Parallel()
	r1 := sampleFSMRecord()
	r2 := sampleFSMRecord()
	r2.ID = "tr-2"
	r2.FromState = fsm.State("online")
	r2.Event = fsm.Event("drive")
	r2.ToState = fsm.State("driving")
	scenarios := listScenarios(fsmCols, fsmRow, []repository.FSMTransitionRecord{r1, r2},
		"querying FSM history for entity", "collecting FSM history for entity")
	runListMethod(t, scenarios, queries.GetFSMHistory, []any{"veh-42", 25},
		func(pool *fakePool) ([]repository.FSMTransitionRecord, error) {
			return (&fsmHistoryRepository{pool: pool}).GetHistory(context.Background(), "veh-42", 25)
		})
}

func TestFSMHistoryRepository_GetByEntityID(t *testing.T) {
	t.Parallel()
	r1 := sampleFSMRecord()
	r2 := sampleFSMRecord()
	r2.ID = "tr-3"
	scenarios := listScenarios(fsmCols, fsmRow, []repository.FSMTransitionRecord{r1, r2},
		"querying FSM history for entity", "collecting FSM history for entity")
	runListMethod(t, scenarios, queries.GetFSMHistoryByEntityID, []any{"veh-42"},
		func(pool *fakePool) ([]repository.FSMTransitionRecord, error) {
			return (&fsmHistoryRepository{pool: pool}).GetByEntityID(context.Background(), "veh-42")
		})
}
