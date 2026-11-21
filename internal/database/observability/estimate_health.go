package observability

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
	"github.com/jackc/pgx/v5"
)

type EstimateHealth struct {
	db       *database.DB
	operator string
}

var _ port.EstimateHealth = (*EstimateHealth)(nil)

func NewEstimateHealth(db *database.DB, operator string) port.EstimateHealth {
	if db == nil || db.Pool == nil {
		return nil
	}
	if len(operator) > 512 || strings.TrimSpace(operator) != operator {
		operator = ""
	}
	return &EstimateHealth{db: db, operator: operator}
}

func (r *EstimateHealth) BeginEstimate(ctx context.Context, feed port.EstimateFeed) (port.EstimateAttempt, error) {
	var attempt port.EstimateAttempt
	err := r.db.Pool.QueryRow(ctx, `
		SELECT clock_timestamp(), last_outage_at
		FROM here_estimate_health WHERE feed = $1 AND incident_id IS NULL`, feed).
		Scan(&attempt.StartedAt, &attempt.OutageAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// Eligible demand can try a recovery once a minute. The shared lease
		// survives a crashed pod without treating a timeout as recovery.
		err = r.db.Pool.QueryRow(ctx, `
			UPDATE here_estimate_health SET next_probe_at = clock_timestamp() + INTERVAL '1 minute'
			WHERE feed = $1 AND incident_id IS NOT NULL AND next_probe_at <= clock_timestamp()
			RETURNING clock_timestamp(), last_outage_at`, feed).Scan(&attempt.StartedAt, &attempt.OutageAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.EstimateAttempt{}, port.ErrEstimatesPaused
		}
		attempt.Recovery = true
	}
	if err != nil {
		return port.EstimateAttempt{}, fmt.Errorf("lease HERE estimate request: %w", err)
	}
	return attempt, nil
}

type estimateTransition int

const (
	estimateUnchanged estimateTransition = iota
	estimateOpen
	estimateRecover
)

func nextEstimateTransition(active bool, changedAt time.Time, attempt port.EstimateAttempt, healthy bool) (estimateTransition, error) {
	if !attempt.StartedAt.After(changedAt) {
		if healthy {
			return estimateUnchanged, port.ErrEstimatesPaused
		}
		return estimateUnchanged, nil
	}
	if healthy {
		if active {
			if !attempt.Recovery {
				return estimateUnchanged, port.ErrEstimatesPaused
			}
			return estimateRecover, nil
		}
		return estimateUnchanged, nil
	}
	if !active {
		return estimateOpen, nil
	}
	return estimateUnchanged, nil
}

func (r *EstimateHealth) FinishEstimate(
	ctx context.Context, feed port.EstimateFeed, attempt port.EstimateAttempt, healthy bool,
) error {
	switch feed {
	case port.HEREImport, port.HERERoutes, port.HEREFlow:
	default:
		return errors.New("unknown HERE estimate feed")
	}
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var id *int64
		var changedAt time.Time
		err := tx.QueryRow(ctx, `
			SELECT incident_id, changed_at FROM here_estimate_health WHERE feed = $1 FOR UPDATE`, feed).
			Scan(&id, &changedAt)
		if err != nil {
			return fmt.Errorf("lock HERE estimate health: %w", err)
		}
		next, err := nextEstimateTransition(id != nil, changedAt, attempt, healthy)
		if err != nil {
			return err
		}
		switch next {
		case estimateOpen:
			return r.openEstimateIncident(ctx, tx, feed)
		case estimateRecover:
			return recoverEstimateIncident(ctx, tx, feed, *id)
		default:
			return nil
		}
	})
}

func (r *EstimateHealth) openEstimateIncident(ctx context.Context, tx pgx.Tx, feed port.EstimateFeed) error {
	tag, err := tx.Exec(ctx, `
		WITH incident AS (
			INSERT INTO here_estimate_incidents (feed, operator_subject, started_at)
			VALUES ($1, $2, statement_timestamp())
			RETURNING id, started_at
		)
		UPDATE here_estimate_health h SET incident_id = incident.id, last_outage_at = incident.started_at,
			changed_at = incident.started_at, next_probe_at = incident.started_at + INTERVAL '1 minute'
		FROM incident WHERE h.feed = $1`, feed, r.operator)
	if err != nil {
		return fmt.Errorf("open HERE estimate incident: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return errors.New("HERE estimate incident was not recorded")
	}
	return nil
}

func recoverEstimateIncident(ctx context.Context, tx pgx.Tx, feed port.EstimateFeed, id int64) error {
	tag, err := tx.Exec(ctx, `
		WITH incident AS (
			UPDATE here_estimate_incidents SET resolved_at = statement_timestamp()
			WHERE feed = $1 AND id = $2 AND resolved_at IS NULL
			RETURNING id, resolved_at
		)
		UPDATE here_estimate_health h SET incident_id = NULL, changed_at = incident.resolved_at
		FROM incident WHERE h.feed = $1 AND h.incident_id = incident.id`, feed, id)
	if err != nil {
		return fmt.Errorf("resolve HERE estimate incident: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return errors.New("HERE estimate incident was not resolved")
	}
	return nil
}
