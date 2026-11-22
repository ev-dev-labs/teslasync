package smartreadiness

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var _ port.ServiceCaseRepository = (*Repository)(nil)

func (r *Repository) ReadServiceCase(ctx context.Context, scope port.ServiceCaseScope) (domain.ServiceCase, error) {
	record := domain.ServiceCase{Evidence: []domain.ServiceCaseEvidence{}}
	rows, err := r.db.Pool.Query(ctx, `SELECT COALESCE(c.id,0),COALESCE(c.version,0),COALESCE(c.title,''),
		COALESCE(c.opened_at,'epoch'::timestamptz),COALESCE(e.id,0),COALESCE(e.kind,''),e.observed_at,COALESCE(e.detail,'')
		FROM vehicles v
		LEFT JOIN smart_service_cases c ON c.vehicle_id=v.id AND c.subject=$1
		LEFT JOIN smart_service_case_evidence e ON e.case_id=c.id
		WHERE v.id=$2 AND v.archived_at IS NULL
		ORDER BY e.observed_at,e.id LIMIT $3`, scope.Subject, scope.VehicleID, domain.MaxServiceCaseEvidence)
	if err != nil {
		return record, fmt.Errorf("read private service case: %w", err)
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		found = true
		var entry domain.ServiceCaseEvidence
		var observed *time.Time
		if err := rows.Scan(&record.ID, &record.Version, &record.Title, &record.OpenedAt,
			&entry.ID, &entry.Kind, &observed, &entry.Detail); err != nil {
			return record, fmt.Errorf("scan private service case: %w", err)
		}
		if observed != nil {
			entry.ObservedAt = observed.UTC()
			record.Evidence = append(record.Evidence, entry)
		}
	}
	if err := rows.Err(); err != nil {
		return record, fmt.Errorf("iterate private service case: %w", err)
	}
	if !found {
		return record, port.ErrNotFound
	}
	return record, nil
}

func (r *Repository) SaveServiceCaseTitle(ctx context.Context, scope port.ServiceCaseScope, key port.ServiceCaseKey, title string, now time.Time) error {
	if key.ID == 0 {
		tag, err := r.db.Pool.Exec(ctx, `INSERT INTO smart_service_cases(subject,vehicle_id,title,opened_at,updated_at)
			SELECT $1,id,$3,$4,$4 FROM vehicles WHERE id=$2 AND archived_at IS NULL
			ON CONFLICT (subject,vehicle_id) DO NOTHING`, scope.Subject, scope.VehicleID, title, now)
		return serviceCaseWriteOutcome(tag, err)
	}
	tag, err := r.db.Pool.Exec(ctx, `UPDATE smart_service_cases c SET version=c.version+1,title=$5
		FROM vehicles v WHERE c.subject=$1 AND c.vehicle_id=$2 AND c.id=$3 AND c.version=$4
			AND v.id=c.vehicle_id AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID, key.ID, key.Version, title)
	return serviceCaseWriteOutcome(tag, err)
}

func (r *Repository) DeleteServiceCase(ctx context.Context, scope port.ServiceCaseScope, key port.ServiceCaseKey) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_service_cases WHERE subject=$1 AND vehicle_id=$2 AND id=$3 AND version=$4`,
		scope.Subject, scope.VehicleID, key.ID, key.Version)
	return serviceCaseWriteOutcome(tag, err)
}

func (r *Repository) AppendServiceCaseEvidence(ctx context.Context, scope port.ServiceCaseScope, key port.ServiceCaseKey, entry domain.ServiceCaseEvidence, now time.Time) error {
	return r.changeServiceCaseEvidence(ctx, scope, key, now, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO smart_service_case_evidence(case_id,kind,observed_at,detail)
			SELECT $1,$2,$3,$4 WHERE (SELECT count(*) FROM smart_service_case_evidence WHERE case_id=$1)<$5`,
			key.ID, entry.Kind, entry.ObservedAt, entry.Detail, domain.MaxServiceCaseEvidence)
		if err == nil && tag.RowsAffected() == 0 {
			return port.ErrServiceCaseFull
		}
		return serviceCaseWriteOutcome(tag, err)
	})
}

func (r *Repository) DeleteServiceCaseEvidence(ctx context.Context, scope port.ServiceCaseScope, key port.ServiceCaseKey, evidenceID int64, now time.Time) error {
	return r.changeServiceCaseEvidence(ctx, scope, key, now, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM smart_service_case_evidence WHERE case_id=$1 AND id=$2`, key.ID, evidenceID)
		return serviceCaseWriteOutcome(tag, err)
	})
}

func (r *Repository) changeServiceCaseEvidence(ctx context.Context, scope port.ServiceCaseScope, key port.ServiceCaseKey, now time.Time, change func(pgx.Tx) error) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE smart_service_cases c SET version=c.version+1,updated_at=GREATEST(c.updated_at,$5)
			FROM vehicles v WHERE c.subject=$1 AND c.vehicle_id=$2 AND c.id=$3 AND c.version=$4
				AND v.id=c.vehicle_id AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID, key.ID, key.Version, now)
		if err := serviceCaseWriteOutcome(tag, err); err != nil {
			return err
		}
		return change(tx)
	})
}

func (r *Repository) ListServiceCaseCandidates(ctx context.Context, subject string, vehicleID *int64, since time.Time, limit int) ([]port.ServiceCaseCandidate, error) {
	rows, err := r.db.Pool.Query(ctx, `SELECT c.id,c.vehicle_id,v.display_name,c.updated_at
		FROM smart_service_cases c JOIN vehicles v ON v.id=c.vehicle_id AND v.archived_at IS NULL
		WHERE c.subject=$1 AND ($2::bigint IS NULL OR c.vehicle_id=$2) AND c.updated_at>$3
		  AND smart_feature_allowed(c.subject,'service_case')
		  AND EXISTS (SELECT 1 FROM smart_service_case_evidence e WHERE e.case_id=c.id)
		ORDER BY c.updated_at DESC,c.id LIMIT $4`, subject, vehicleID, since, limit)
	if err != nil {
		return nil, fmt.Errorf("list private service cases: %w", err)
	}
	cases, err := pgx.CollectRows(rows, pgx.RowToStructByPos[port.ServiceCaseCandidate])
	if err != nil {
		return nil, fmt.Errorf("scan private service cases: %w", err)
	}
	return cases, nil
}

func serviceCaseWriteOutcome(tag pgconn.CommandTag, err error) error {
	if err != nil {
		return fmt.Errorf("change private service case: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrServiceCaseChanged
	}
	return nil
}
