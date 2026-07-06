package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

type fsmHistoryRepository struct {
	pool pgxPool
}

func NewFSMHistoryRepository(pool *pgxpool.Pool) repository.FSMHistoryRepository {
	return &fsmHistoryRepository{pool: pool}
}

func (r *fsmHistoryRepository) RecordTransition(ctx context.Context, record repository.FSMTransitionRecord) error {
	_, err := r.pool.Exec(ctx, queries.InsertFSMTransition,
		record.ID, record.EntityID, record.FSMName,
		record.FromState, record.Event, record.ToState, record.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("recording FSM transition for entity %s: %w", record.EntityID, err)
	}
	return nil
}

func (r *fsmHistoryRepository) GetHistory(ctx context.Context, entityID string, limit int) ([]repository.FSMTransitionRecord, error) {
	rows, err := r.pool.Query(ctx, queries.GetFSMHistory, entityID, limit)
	if err != nil {
		return nil, fmt.Errorf("querying FSM history for entity %s: %w", entityID, err)
	}
	records, err := pgx.CollectRows(rows, pgx.RowToStructByName[repository.FSMTransitionRecord])
	if err != nil {
		return nil, fmt.Errorf("collecting FSM history for entity %s: %w", entityID, err)
	}
	return records, nil
}

func (r *fsmHistoryRepository) GetByEntityID(ctx context.Context, entityID string) ([]repository.FSMTransitionRecord, error) {
	rows, err := r.pool.Query(ctx, queries.GetFSMHistoryByEntityID, entityID)
	if err != nil {
		return nil, fmt.Errorf("querying FSM history for entity %s: %w", entityID, err)
	}
	records, err := pgx.CollectRows(rows, pgx.RowToStructByName[repository.FSMTransitionRecord])
	if err != nil {
		return nil, fmt.Errorf("collecting FSM history for entity %s: %w", entityID, err)
	}
	return records, nil
}
