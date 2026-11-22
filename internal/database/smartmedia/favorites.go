package smartmedia

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"go.opentelemetry.io/otel"

	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
)

var _ port.FavoriteDigestRepository = (*Repository)(nil)

func (r *Repository) ReadFavoriteDigest(ctx context.Context, scope port.Scope, now time.Time) (domain.FavoriteDigestSettings, error) {
	out := domain.FavoriteDigestSettings{VehicleID: scope.VehicleID, Favorites: []domain.FavoriteRecording{}}
	err := pgx.BeginTxFunc(ctx, r.db.Pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		var planID int64
		err := tx.QueryRow(ctx, `SELECT COALESCE(p.id,0),COALESCE(p.revision,0),COALESCE(p.time_zone,''),p.next_check_at
			FROM vehicles v LEFT JOIN smart_favorite_digest_plans p ON p.vehicle_id=v.id AND p.subject=$1
			WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID).
			Scan(&planID, &out.Revision, &out.TimeZone, &out.NextAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("read private favorite consent: %w", err)
		}
		if planID == 0 {
			return nil
		}
		rows, err := tx.Query(ctx, `SELECT key,title,artist,source,duration_s FROM smart_confirmed_favorite_tracks
			WHERE plan_id=$1 ORDER BY confirmed_at DESC,key`, planID)
		if err != nil {
			return fmt.Errorf("read confirmed local favorites: %w", err)
		}
		out.Favorites, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.FavoriteRecording, error) {
			var recording domain.FavoriteRecording
			err := row.Scan(&recording.Key, &recording.Title, &recording.Artist, &recording.Source, &recording.DurationS)
			return recording, err
		})
		if err != nil {
			return fmt.Errorf("scan confirmed local favorites: %w", err)
		}
		if out.NextAt == nil {
			return nil
		}
		rows, err = tx.Query(ctx, `SELECT c.period_from,c.period_until,c.expires_at,c.key,c.title,c.artist,c.source,c.duration_s,c.observed_drives,c.observed_dates
			FROM smart_favorite_digest_candidates c JOIN smart_favorite_digest_plans p ON p.id=c.plan_id
			WHERE c.plan_id=$1 AND c.expires_at>$2 AND smart_feature_current(p.subject,'favorite_digest',p.feature_checked_at)
			ORDER BY c.ordinal`, planID, now)
		if err != nil {
			return fmt.Errorf("read private favorite shortlist: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			if out.Digest == nil {
				out.Digest = &domain.FavoriteDigest{}
			}
			var candidate domain.FavoriteCandidate
			if err := rows.Scan(&out.Digest.From, &out.Digest.Until, &out.Digest.ExpiresAt, &candidate.Key,
				&candidate.Title, &candidate.Artist, &candidate.Source, &candidate.DurationS, &candidate.ObservedDrives, &candidate.ObservedDates); err != nil {
				return fmt.Errorf("scan private favorite shortlist: %w", err)
			}
			out.Digest.Candidates = append(out.Digest.Candidates, candidate)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("read private favorite shortlist rows: %w", err)
		}
		return nil
	})
	if out.Favorites == nil {
		out.Favorites = []domain.FavoriteRecording{}
	}
	return out, err
}

func (r *Repository) ReplaceFavoriteDigest(ctx context.Context, scope port.Scope, setup domain.FavoriteDigestSetup, next *time.Time) error {
	if *setup.ExpectedRevision == 0 {
		tag, err := r.db.Pool.Exec(ctx, `INSERT INTO smart_favorite_digest_plans(subject,vehicle_id,time_zone,next_check_at)
			SELECT $1,id,$3,$4 FROM vehicles WHERE id=$2 AND archived_at IS NULL ON CONFLICT (subject,vehicle_id) DO NOTHING`,
			scope.Subject, scope.VehicleID, setup.TimeZone, next)
		return changedPlaylistRow(tag, err, "enable private weekly favorite digest")
	}
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var id int64
		err := tx.QueryRow(ctx, `UPDATE smart_favorite_digest_plans p
			SET revision=DEFAULT,time_zone=$4,next_check_at=$5,lease_until=NULL
			FROM vehicles v WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.revision=$3 AND v.id=p.vehicle_id AND v.archived_at IS NULL
			RETURNING p.id`, scope.Subject, scope.VehicleID, *setup.ExpectedRevision, setup.TimeZone, next).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrChanged
		}
		if err != nil {
			return fmt.Errorf("update private weekly favorite consent: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_favorite_digest_candidates WHERE plan_id=$1`, id); err != nil {
			return fmt.Errorf("invalidate prior private favorite shortlist: %w", err)
		}
		return nil
	})
}

func (r *Repository) DeleteFavoriteDigest(ctx context.Context, scope port.Scope, revision int64) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_favorite_digest_plans WHERE subject=$1 AND vehicle_id=$2 AND revision=$3`,
		scope.Subject, scope.VehicleID, revision)
	return changedPlaylistRow(tag, err, "clear private favorite settings and choices")
}

func (r *Repository) ActOnFavoriteDigest(ctx context.Context, scope port.Scope, action domain.FavoriteDigestAction, now time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var id int64
		var active bool
		err := tx.QueryRow(ctx, `SELECT p.id,p.next_check_at IS NOT NULL
			AND smart_feature_current(p.subject,'favorite_digest',p.feature_checked_at) FROM smart_favorite_digest_plans p
			JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
			WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.revision=$3 FOR UPDATE OF p`,
			scope.Subject, scope.VehicleID, action.Revision).Scan(&id, &active)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrChanged
		}
		if err != nil {
			return fmt.Errorf("lock current private favorite plan: %w", err)
		}
		if action.Action == "remove" {
			tag, err := tx.Exec(ctx, `DELETE FROM smart_confirmed_favorite_tracks WHERE plan_id=$1 AND key=$2`, id, action.Key)
			return changedPlaylistRow(tag, err, "remove confirmed local favorite")
		}
		if !active {
			return port.ErrChanged
		}
		if action.Action == "dismiss" {
			tag, err := tx.Exec(ctx, `DELETE FROM smart_favorite_digest_candidates WHERE plan_id=$1 AND period_until=$2 AND expires_at>$3`,
				id, action.DigestUntil, now)
			if err != nil {
				return fmt.Errorf("dismiss private shortlist: %w", err)
			}
			if tag.RowsAffected() == 0 {
				return port.ErrChanged
			}
			return nil
		}
		var full bool
		if err := tx.QueryRow(ctx, `SELECT COUNT(*)>=50 FROM smart_confirmed_favorite_tracks WHERE plan_id=$1`, id).Scan(&full); err != nil {
			return fmt.Errorf("check private favorites limit: %w", err)
		}
		if full {
			return port.ErrFavoriteLimit
		}
		tag, err := tx.Exec(ctx, `WITH choice AS (
			DELETE FROM smart_favorite_digest_candidates WHERE plan_id=$1 AND period_until=$2 AND expires_at>$3 AND key=$4
			RETURNING plan_id,key,title,artist,source,duration_s
		)
		INSERT INTO smart_confirmed_favorite_tracks(plan_id,key,title,artist,source,duration_s,confirmed_at)
		SELECT plan_id,key,title,artist,source,duration_s,$3 FROM choice`, id, action.DigestUntil, now, action.Key)
		return changedPlaylistRow(tag, err, "confirm chosen local favorite")
	})
}

func (r *Repository) ClaimFavoriteDigest(ctx context.Context, now, lease time.Time) (*port.FavoriteDigestJob, error) {
	var job port.FavoriteDigestJob
	err := r.db.Pool.QueryRow(ctx, `WITH due AS (
		SELECT p.id FROM smart_favorite_digest_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		WHERE p.next_check_at<=$1 AND (p.lease_until IS NULL OR p.lease_until<=$1) AND p.subject NOT IN ($3,'open-mode')
			AND smart_feature_allowed(p.subject,'favorite_digest')
		ORDER BY p.next_check_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED
	)
	UPDATE smart_favorite_digest_plans p SET lease_until=$2,feature_claimed_at=statement_timestamp() FROM due WHERE p.id=due.id
	RETURNING p.id,p.vehicle_id,p.revision,p.time_zone,p.lease_until`, now, lease, personaldomain.OpenSubject).
		Scan(&job.ID, &job.VehicleID, &job.Revision, &job.TimeZone, &job.Lease)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim due private weekly favorite digest: %w", err)
	}
	return &job, nil
}

func (r *Repository) FavoriteEvidence(ctx context.Context, job port.FavoriteDigestJob, from, until time.Time, driveLimit int) (
	[]domain.DriveWindow, []domain.PlaybackSample, error,
) {
	ctx, span := otel.Tracer("db").Start(ctx, "db.favorite_digest_evidence")
	defer span.End()
	var drives []domain.DriveWindow
	var samples []domain.PlaybackSample
	err := pgx.BeginTxFunc(ctx, r.db.Pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		var active bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM smart_favorite_digest_plans p
			JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
			WHERE p.id=$1 AND p.vehicle_id=$2 AND p.revision=$3 AND p.lease_until=$4 AND p.next_check_at IS NOT NULL
				AND smart_feature_current(p.subject,'favorite_digest',p.feature_claimed_at))`,
			job.ID, job.VehicleID, job.Revision, job.Lease).Scan(&active); err != nil {
			return fmt.Errorf("check leased private favorite plan: %w", err)
		}
		if !active {
			return port.ErrChanged
		}
		rows, err := tx.Query(ctx, `SELECT d.id,d.started_at,d.ended_at FROM drives d
			WHERE d.vehicle_id=$1 AND d.started_at>=$2 AND d.ended_at<=$3 AND d.ended_at>d.started_at
			AND NOT EXISTS (SELECT 1 FROM drives o WHERE o.vehicle_id=d.vehicle_id AND o.id<>d.id
				AND o.started_at<d.ended_at AND (o.ended_at IS NULL OR o.ended_at>d.started_at))
			ORDER BY d.started_at,d.id LIMIT $4`, job.VehicleID, from, until, driveLimit)
		if err != nil {
			return fmt.Errorf("query bounded completed drives for private favorites: %w", err)
		}
		drives, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.DriveWindow, error) {
			var drive domain.DriveWindow
			err := row.Scan(&drive.ID, &drive.StartedAt, &drive.EndedAt)
			return drive, err
		})
		if err != nil {
			return fmt.Errorf("scan completed drives for private favorites: %w", err)
		}
		if len(drives) < 3 || len(drives) >= driveLimit {
			return nil
		}
		contextFrom := drives[0].StartedAt.Add(-domain.FavoriteContextHorizon)
		through := drives[len(drives)-1].EndedAt
		if through.Sub(contextFrom) <= 7*24*time.Hour {
			samples, err = readPlaybackSamples(ctx, tx, job.VehicleID, contextFrom, through)
			return err
		}
		// Split at the midpoint when context or DST exceeds the shared evidence bound.
		split := contextFrom.Add(through.Sub(contextFrom) / 2)
		samples, err = readPlaybackSamples(ctx, tx, job.VehicleID, contextFrom, split)
		if err != nil {
			return err
		}
		second, err := readPlaybackSamples(ctx, tx, job.VehicleID, split, through)
		if err != nil {
			return err
		}
		if last := len(samples) - 1; last >= 0 && samples[last].At.Equal(split) {
			samples = samples[:last]
		}
		samples = append(samples, second...)
		return nil
	})
	return drives, samples, err
}

func (r *Repository) FinishFavoriteDigest(ctx context.Context, job port.FavoriteDigestJob, now, next time.Time,
	digest domain.FavoriteDigest,
) (bool, error) {
	var published bool
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE smart_favorite_digest_plans p SET next_check_at=$5,lease_until=NULL,feature_checked_at=p.feature_claimed_at
			FROM vehicles v WHERE p.id=$1 AND p.revision=$2 AND p.lease_until=$3 AND $4<p.lease_until
			AND p.next_check_at IS NOT NULL AND p.vehicle_id=v.id AND v.archived_at IS NULL
			AND smart_feature_current(p.subject,'favorite_digest',p.feature_claimed_at)`, job.ID, job.Revision, job.Lease, now, next)
		if err != nil {
			return fmt.Errorf("finish leased private favorite digest: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_favorite_digest_candidates WHERE plan_id=$1`, job.ID); err != nil {
			return fmt.Errorf("remove prior private favorite candidates: %w", err)
		}
		if !now.Before(digest.ExpiresAt) {
			return nil
		}
		for i, candidate := range digest.Candidates {
			tag, err := tx.Exec(ctx, `INSERT INTO smart_favorite_digest_candidates
				(plan_id,key,ordinal,period_from,period_until,expires_at,title,artist,source,duration_s,observed_drives,observed_dates)
				SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE NOT EXISTS (
					SELECT 1 FROM smart_confirmed_favorite_tracks WHERE plan_id=$1 AND key=$2
				)`, job.ID, candidate.Key, i+1, digest.From, digest.Until, digest.ExpiresAt, candidate.Title,
				candidate.Artist, candidate.Source, candidate.DurationS, candidate.ObservedDrives, candidate.ObservedDates)
			if err != nil {
				return fmt.Errorf("publish private favorite candidate: %w", err)
			}
			published = published || tag.RowsAffected() == 1
		}
		return nil
	})
	return published && err == nil, err
}
