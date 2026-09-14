package journey

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// SaveChecklistRun persists one evaluation. Items marshal to JSONB; a
// missing session reports ErrNoSession.
func (s *Store) SaveChecklistRun(ctx context.Context, sessionID int64, items []Item) (*Run, error) {
	raw, err := json.Marshal(items)
	if err != nil {
		return nil, fmt.Errorf("journey: encode checklist: %w", err)
	}
	var exists bool
	if err := s.db.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM journey_sessions WHERE id = $1)`, sessionID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("journey: checklist session check: %w", err)
	}
	if !exists {
		return nil, ErrNoSession
	}
	run := &Run{}
	var stored json.RawMessage
	if err := s.db.Pool.QueryRow(ctx, `
		INSERT INTO journey_checklist_runs (session_id, items)
		VALUES ($1, $2)
		RETURNING id, session_id, run_at, items`, sessionID, string(raw),
	).Scan(&run.ID, &run.SessionID, &run.RunAt, &stored); err != nil {
		return nil, fmt.Errorf("journey: save checklist: %w", err)
	}
	if err := json.Unmarshal(stored, &run.Items); err != nil {
		return nil, fmt.Errorf("journey: decode checklist: %w", err)
	}
	return run, nil
}

// LatestChecklistRun returns the newest run for a session, or nil when
// the checklist never ran.
func (s *Store) LatestChecklistRun(ctx context.Context, sessionID int64) (*Run, error) {
	run := &Run{}
	var stored json.RawMessage
	err := s.db.Pool.QueryRow(ctx, `
		SELECT id, session_id, run_at, items FROM journey_checklist_runs
		WHERE session_id = $1 ORDER BY run_at DESC LIMIT 1`, sessionID,
	).Scan(&run.ID, &run.SessionID, &run.RunAt, &stored)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("journey: latest checklist: %w", err)
	}
	if err := json.Unmarshal(stored, &run.Items); err != nil {
		return nil, fmt.Errorf("journey: decode checklist: %w", err)
	}
	return run, nil
}

// Compile-time port assertion.
var _ RunStore = (*Store)(nil)
