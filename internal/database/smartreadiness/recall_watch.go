package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	featuredb "github.com/ev-dev-labs/teslasync/internal/database/smartfeature"
	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartfeature"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
)

var _ port.RecallWatchRepository = (*Repository)(nil)

func (r *Repository) ReadRecallWatch(ctx context.Context, scope port.RecallWatchScope, now time.Time) (domain.RecallWatch, error) {
	watch := domain.RecallWatch{Matches: []domain.RecallCampaignMatch{}}
	rows, err := r.db.Pool.Query(ctx, `
		SELECT COALESCE(w.id,0),COALESCE(w.model,''),COALESCE(w.model_year,0),w.last_success,COALESCE(w.last_failed,false),
			COALESCE(m.campaign,''),COALESCE(m.component,''),COALESCE(m.remedy,''),m.reported_at,m.checked_at,m.fresh_until
		FROM vehicles v
		LEFT JOIN smart_recall_watches w ON w.vehicle_id=v.id AND w.subject=$1
		LEFT JOIN smart_recall_campaign_matches m ON m.watch_id=w.id AND m.current_match AND m.fresh_until>$3
			AND smart_feature_current(w.subject,'recall_watch',w.feature_checked_at)
		WHERE v.id=$2 AND v.archived_at IS NULL
		ORDER BY m.reported_at DESC,m.campaign LIMIT 5`, scope.Subject, scope.VehicleID, now)
	if err != nil {
		return watch, fmt.Errorf("read private recall watch: %w", err)
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		found = true
		var match domain.RecallCampaignMatch
		var reported, checked, fresh *time.Time
		err := rows.Scan(&watch.ID, &watch.Setup.Model, &watch.Setup.ModelYear, &watch.LastSuccess, &watch.LastFailed,
			&match.Campaign, &match.Component, &match.Remedy, &reported, &checked, &fresh)
		if err != nil {
			return watch, fmt.Errorf("scan private recall watch: %w", err)
		}
		if reported != nil && checked != nil && fresh != nil {
			match.ReportedAt, match.CheckedAt, match.FreshUntil = *reported, *checked, *fresh
			populateRecallMatch(&match, watch.Setup)
			watch.Matches = append(watch.Matches, match)
		}
	}
	if err := rows.Err(); err != nil {
		return watch, fmt.Errorf("iterate private recall watch: %w", err)
	}
	if !found {
		return watch, port.ErrNotFound
	}
	return watch, nil
}

func (r *Repository) ReplaceRecallWatch(ctx context.Context, scope port.RecallWatchScope, expectedID int64, setup domain.RecallWatchSetup, now time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if expectedID != 0 {
			tag, err := tx.Exec(ctx, `DELETE FROM smart_recall_watches WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
				scope.Subject, scope.VehicleID, expectedID)
			if err != nil {
				return fmt.Errorf("clear previous private recall watch: %w", err)
			}
			if tag.RowsAffected() == 0 {
				return port.ErrRecallWatchChanged
			}
		}
		tag, err := tx.Exec(ctx, `INSERT INTO smart_recall_watches(subject,vehicle_id,model,model_year,next_check_at)
			SELECT $1,id,$3,$4,$5 FROM vehicles WHERE id=$2 AND archived_at IS NULL
			ON CONFLICT (subject,vehicle_id) DO NOTHING`, scope.Subject, scope.VehicleID, setup.Model, setup.ModelYear, now)
		if err != nil {
			return fmt.Errorf("enable private recall watch: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return port.ErrRecallWatchChanged
		}
		return nil
	})
}

func (r *Repository) DeleteRecallWatch(ctx context.Context, scope port.RecallWatchScope, expectedID int64) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_recall_watches WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		scope.Subject, scope.VehicleID, expectedID)
	if err != nil {
		return fmt.Errorf("delete private recall watch: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return port.ErrRecallWatchChanged
	}
	return nil
}

func (r *Repository) ClaimRecallWatch(ctx context.Context, now, leaseUntil time.Time) (*port.DueRecallWatch, error) {
	var claim port.DueRecallWatch
	err := r.db.Pool.QueryRow(ctx, `
		WITH due AS (
			SELECT w.id FROM smart_recall_watches w
			JOIN vehicles v ON v.id=w.vehicle_id AND v.archived_at IS NULL
			WHERE w.next_check_at<=$1 AND (w.lease_until IS NULL OR w.lease_until<=$1)
				AND w.subject NOT IN ($3,'open-mode')
				AND smart_feature_allowed(w.subject,'recall_watch')
			ORDER BY w.next_check_at,w.id LIMIT 1 FOR UPDATE OF w SKIP LOCKED
		)
		UPDATE smart_recall_watches w SET lease_until=$2,feature_claimed_at=statement_timestamp() FROM due WHERE w.id=due.id
		RETURNING w.id,w.subject,w.model,w.model_year,w.lease_until`, now, leaseUntil, personaldomain.OpenSubject).
		Scan(&claim.ID, &claim.Subject, &claim.Setup.Model, &claim.Setup.ModelYear, &claim.LeaseUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim due private recall watch: %w", err)
	}
	return &claim, nil
}

func (r *Repository) RecallWatchStillCurrent(ctx context.Context, job port.DueRecallWatch) (bool, error) {
	var current bool
	err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM smart_recall_watches w
		JOIN vehicles v ON v.id=w.vehicle_id AND v.archived_at IS NULL WHERE w.id=$1 AND w.lease_until=$2
		AND smart_feature_current(w.subject,'recall_watch',w.feature_claimed_at))`,
		job.ID, job.LeaseUntil).Scan(&current)
	if err != nil {
		return false, fmt.Errorf("recheck recall watch consent: %w", err)
	}
	return current, nil
}

func (r *Repository) FinishRecallWatch(ctx context.Context, job port.DueRecallWatch, result port.CheckedRecallWatch) (bool, int, error) {
	applied := false
	created := 0
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		allowed, err := featuredb.HoldAllowed(ctx, tx, job.Subject, smartfeature.RecallWatch)
		if err != nil || !allowed {
			return err
		}
		tag, err := tx.Exec(ctx, `UPDATE smart_recall_watches w
			SET next_check_at=$3,lease_until=NULL,last_failed=$4,last_success=CASE WHEN $4 THEN w.last_success ELSE $5 END,
			    feature_checked_at=CASE WHEN $4 THEN w.feature_checked_at ELSE w.feature_claimed_at END
			FROM vehicles v WHERE w.id=$1 AND w.lease_until=$2 AND $5<w.lease_until
				AND v.id=w.vehicle_id AND v.archived_at IS NULL
				AND smart_feature_current(w.subject,'recall_watch',w.feature_claimed_at)`,
			job.ID, job.LeaseUntil, result.NextCheck, result.Failed, result.CheckedAt)
		if err != nil {
			return fmt.Errorf("finish private recall watch: %w", err)
		}
		applied = tag.RowsAffected() == 1
		if !applied || result.Failed {
			return nil
		}
		created, err = persistRecallMatches(ctx, tx, job.ID, result)
		return err
	})
	if err != nil {
		return false, 0, err
	}
	return applied, created, nil
}

func persistRecallMatches(ctx context.Context, tx pgx.Tx, watchID int64, result port.CheckedRecallWatch) (int, error) {
	if _, err := tx.Exec(ctx, `DELETE FROM smart_recall_campaign_matches WHERE watch_id=$1
		AND reported_at<=$2::timestamptz-INTERVAL '90 days'`, watchID, result.CheckedAt); err != nil {
		return 0, fmt.Errorf("prune aged recall matches: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE smart_recall_campaign_matches SET current_match=false WHERE watch_id=$1 AND current_match`,
		watchID); err != nil {
		return 0, fmt.Errorf("replace current recall matches: %w", err)
	}
	created := 0
	for _, match := range result.Matches {
		tag, err := tx.Exec(ctx, `UPDATE smart_recall_campaign_matches
			SET component=$3,remedy=$4,reported_at=$5,checked_at=$6,fresh_until=$7,current_match=true
			WHERE watch_id=$1 AND campaign=$2`,
			watchID, match.Campaign, match.Component, match.Remedy, match.ReportedAt, match.CheckedAt, match.FreshUntil)
		if err != nil {
			return 0, fmt.Errorf("refresh recall campaign match: %w", err)
		}
		if tag.RowsAffected() != 0 {
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO smart_recall_campaign_matches
			(watch_id,campaign,component,remedy,reported_at,checked_at,fresh_until) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			watchID, match.Campaign, match.Component, match.Remedy, match.ReportedAt, match.CheckedAt, match.FreshUntil); err != nil {
			return 0, fmt.Errorf("persist recall campaign match: %w", err)
		}
		created++
	}
	return created, nil
}

func (r *Repository) ListRecallWatchMatches(ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int) ([]port.RecallWatchCandidate, error) {
	rows, err := r.db.Pool.Query(ctx, `SELECT w.id,w.vehicle_id,v.display_name,w.model,w.model_year,
		m.campaign,m.component,m.remedy,m.reported_at,m.checked_at,m.fresh_until
		FROM smart_recall_watches w
		JOIN smart_recall_campaign_matches m ON m.watch_id=w.id AND m.current_match AND m.fresh_until>$3
		JOIN vehicles v ON v.id=w.vehicle_id AND v.archived_at IS NULL
		WHERE w.subject=$1 AND ($2::bigint IS NULL OR w.vehicle_id=$2)
			AND smart_feature_current(w.subject,'recall_watch',w.feature_checked_at)
		ORDER BY m.reported_at DESC,m.campaign,w.id LIMIT $4`, subject, vehicleID, now, limit)
	if err != nil {
		return nil, fmt.Errorf("list private recall matches: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (port.RecallWatchCandidate, error) {
		var item port.RecallWatchCandidate
		var setup domain.RecallWatchSetup
		m := &item.Match
		err := row.Scan(&item.WatchID, &item.VehicleID, &item.VehicleName, &setup.Model, &setup.ModelYear,
			&m.Campaign, &m.Component, &m.Remedy, &m.ReportedAt, &m.CheckedAt, &m.FreshUntil)
		populateRecallMatch(m, setup)
		return item, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan private recall matches: %w", err)
	}
	return items, nil
}

func populateRecallMatch(match *domain.RecallCampaignMatch, setup domain.RecallWatchSetup) {
	match.Model, match.ModelYear = setup.Model, setup.ModelYear
	match.SourceURL = domain.RecallSourceURL(match.Campaign)
	match.VerifyVINURL = domain.RecallVerificationURL
}
