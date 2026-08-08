package actioncenter

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	models "github.com/ev-dev-labs/teslasync/internal/models/actioncenter"
	port "github.com/ev-dev-labs/teslasync/internal/port/actioncenter"
	"github.com/jackc/pgx/v5"
)

type StateRepository struct {
	db *database.DB
}

func NewStateRepository(db *database.DB) *StateRepository {
	if db == nil || db.Pool == nil {
		panic("actioncenter.NewStateRepository: db and db.Pool must not be nil")
	}
	return &StateRepository{db: db}
}

func (r *StateRepository) ListStates(
	ctx context.Context,
	subject string,
	recommendationIDs []string,
) (map[string]domain.CurrentState, error) {
	result := make(map[string]domain.CurrentState, len(recommendationIDs))
	if len(recommendationIDs) == 0 {
		return result, nil
	}
	const query = `
		SELECT recommendation_id, state, snoozed_until, version, updated_at
		FROM action_center_states
		WHERE subject = $1 AND recommendation_id = ANY($2::text[])`
	rows, err := r.db.Pool.Query(ctx, query, subject, recommendationIDs)
	if err != nil {
		return nil, fmt.Errorf("list action center states: %w", err)
	}
	defer rows.Close()

	now := time.Now().UTC()
	for rows.Next() {
		var id string
		var state domain.CurrentState
		if err := rows.Scan(&id, &state.Status, &state.SnoozedUntil, &state.Version, &state.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan action center state: %w", err)
		}
		if state.Status == domain.StateSnoozed &&
			state.SnoozedUntil != nil && !state.SnoozedUntil.After(now) {
			state.Status = domain.StateOpen
			state.SnoozedUntil = nil
		}
		result[id] = state
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate action center states: %w", err)
	}
	return result, nil
}

func (r *StateRepository) ListRecentEvents(
	ctx context.Context,
	subject string,
	recommendationIDs []string,
	perRecommendation int,
) (map[string][]domain.ActionEvent, error) {
	result := make(map[string][]domain.ActionEvent, len(recommendationIDs))
	if len(recommendationIDs) == 0 {
		return result, nil
	}
	const query = `
		SELECT id, recommendation_id, fingerprint, action, from_state, to_state,
		       outcome, state_version, occurred_at
		FROM (
			SELECT a.*, row_number() OVER (
				PARTITION BY recommendation_id ORDER BY occurred_at DESC, id DESC
			) AS row_number
			FROM action_center_action_audit a
			WHERE subject = $1 AND recommendation_id = ANY($2::text[])
		) ranked
		WHERE row_number <= $3
		ORDER BY recommendation_id, occurred_at DESC, id DESC`
	rows, err := r.db.Pool.Query(ctx, query, subject, recommendationIDs, perRecommendation)
	if err != nil {
		return nil, fmt.Errorf("list recent action center events: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		event, err := scanEvent(rows)
		if err != nil {
			return nil, fmt.Errorf("scan recent action center event: %w", err)
		}
		result[event.RecommendationID] = append(result[event.RecommendationID], *event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate recent action center events: %w", err)
	}
	return result, nil
}

func (r *StateRepository) Transition(
	ctx context.Context,
	request port.TransitionRequest,
) (*domain.CurrentState, *domain.ActionEvent, error) {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("begin action center transition: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var current models.StateRecord
	err = tx.QueryRow(ctx, `
		SELECT subject, recommendation_id, fingerprint, state, snoozed_until,
		       version, created_at, updated_at
		FROM action_center_states
		WHERE subject = $1 AND recommendation_id = $2
		FOR UPDATE`,
		request.Subject, request.RecommendationID,
	).Scan(
		&current.Subject, &current.RecommendationID, &current.Fingerprint,
		&current.State, &current.SnoozedUntil, &current.Version,
		&current.CreatedAt, &current.UpdatedAt,
	)

	fromState := domain.StateOpen
	nextVersion := 1
	if errors.Is(err, pgx.ErrNoRows) {
		if request.ExpectedVersion != 0 {
			return nil, nil, port.ErrStateConflict
		}
	} else if err != nil {
		return nil, nil, fmt.Errorf("lock action center state: %w", err)
	} else {
		if current.Version != request.ExpectedVersion {
			return nil, nil, port.ErrStateConflict
		}
		fromState = domain.State(current.State)
		if fromState == domain.StateSnoozed &&
			current.SnoozedUntil != nil && !current.SnoozedUntil.After(request.Now) {
			fromState = domain.StateOpen
		}
		nextVersion = current.Version + 1
	}
	if !containsState(request.AllowedFrom, fromState) {
		return nil, nil, port.ErrStateConflict
	}

	var updatedAt time.Time
	if current.RecommendationID == "" {
		err = tx.QueryRow(ctx, `
			INSERT INTO action_center_states
			    (subject, recommendation_id, fingerprint, state, snoozed_until,
			     version, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, 1, $6, $6)
			RETURNING updated_at`,
			request.Subject, request.RecommendationID, request.Fingerprint,
			request.ToState, request.SnoozedUntil, request.Now,
		).Scan(&updatedAt)
	} else {
		err = tx.QueryRow(ctx, `
			UPDATE action_center_states
			SET fingerprint = $3, state = $4, snoozed_until = $5,
			    version = version + 1, updated_at = $6
			WHERE subject = $1 AND recommendation_id = $2 AND version = $7
			RETURNING updated_at`,
			request.Subject, request.RecommendationID, request.Fingerprint,
			request.ToState, request.SnoozedUntil, request.Now,
			request.ExpectedVersion,
		).Scan(&updatedAt)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, port.ErrStateConflict
	}
	if err != nil {
		return nil, nil, fmt.Errorf("write action center state: %w", err)
	}

	event, err := scanEvent(tx.QueryRow(ctx, `
		INSERT INTO action_center_action_audit
		    (subject, recommendation_id, fingerprint, action, from_state,
		     to_state, outcome, state_version, occurred_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'applied', $7, $8)
		RETURNING id, recommendation_id, fingerprint, action, from_state,
		          to_state, outcome, state_version, occurred_at`,
		request.Subject, request.RecommendationID, request.Fingerprint,
		request.Action, fromState, request.ToState, nextVersion, request.Now,
	))
	if err != nil {
		return nil, nil, fmt.Errorf("audit action center transition: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("commit action center transition: %w", err)
	}
	state := &domain.CurrentState{
		Status:       request.ToState,
		Version:      nextVersion,
		SnoozedUntil: request.SnoozedUntil,
		UpdatedAt:    &updatedAt,
	}
	return state, event, nil
}

func (r *StateRepository) ListHistory(
	ctx context.Context,
	subject, recommendationID string,
	limit, offset int,
) (*domain.HistoryPage, error) {
	var total int
	if err := r.db.Pool.QueryRow(ctx, `
		SELECT count(*)
		FROM action_center_action_audit
		WHERE subject = $1 AND recommendation_id = $2`,
		subject, recommendationID,
	).Scan(&total); err != nil {
		return nil, fmt.Errorf("count action center history: %w", err)
	}
	const query = `
		SELECT id, recommendation_id, fingerprint, action, from_state, to_state,
		       outcome, state_version, occurred_at
		FROM action_center_action_audit
		WHERE subject = $1 AND recommendation_id = $2
		ORDER BY occurred_at DESC, id DESC
		LIMIT $3 OFFSET $4`
	rows, err := r.db.Pool.Query(ctx, query, subject, recommendationID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list action center history: %w", err)
	}
	defer rows.Close()
	items := make([]domain.ActionEvent, 0)
	for rows.Next() {
		event, scanErr := scanEvent(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan action center history: %w", scanErr)
		}
		items = append(items, *event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate action center history: %w", err)
	}
	return &domain.HistoryPage{Items: items, Total: total, Limit: limit, Offset: offset}, nil
}

func scanEvent(row pgx.Row) (*domain.ActionEvent, error) {
	event := &domain.ActionEvent{}
	err := row.Scan(
		&event.ID, &event.RecommendationID, &event.Fingerprint,
		&event.Action, &event.FromState, &event.ToState, &event.Outcome,
		&event.StateVersion, &event.OccurredAt,
	)
	return event, err
}

func containsState(states []domain.State, target domain.State) bool {
	for _, state := range states {
		if state == target {
			return true
		}
	}
	return false
}
