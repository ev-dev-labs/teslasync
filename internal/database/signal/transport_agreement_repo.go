package signal

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal/agreement"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
)

const transportAgreementEvidenceSQL = `
SELECT
	field,
	ingest_origin,
	source_emitted_at,
	value_kind,
	str_value,
	bool_value,
	int_value,
	float_value,
	time_value
FROM signal_transport_evidence
WHERE vehicle_id = $1
  AND source_emitted_at >= $2
  AND source_emitted_at <= $3
  AND normalization_version >= 1
ORDER BY source_emitted_at ASC, field ASC, ingest_origin ASC
LIMIT $4`

// TransportAgreementRepo reads bounded, trusted change-feed evidence used by
// the cross-transport agreement analyzer.
type TransportAgreementRepo struct {
	q database.DBTX
}

func NewTransportAgreementRepo(db *database.DB) *TransportAgreementRepo {
	if db == nil || db.Pool == nil {
		panic("signal.NewTransportAgreementRepo: db and db.Pool must not be nil")
	}
	return &TransportAgreementRepo{q: db.Pool}
}

// AgreementEvidence returns at most limit evidence rows and reports whether
// an additional row proved that the bounded result was truncated.
func (r *TransportAgreementRepo) AgreementEvidence(
	ctx context.Context,
	vehicleID int64,
	from, to time.Time,
	limit int,
) (samples []agreement.Sample, truncated bool, err error) {
	ctx, span := tracing.DBSpan(ctx, "select", "signal_transport_evidence", tracing.VehicleID(vehicleID))
	defer func() { tracing.EndSpan(span, err) }()

	if r == nil || r.q == nil {
		return nil, false, errors.New("transport agreement repository is not configured")
	}
	if vehicleID <= 0 || from.IsZero() || to.IsZero() || !from.Before(to) || limit <= 0 {
		return nil, false, errors.New("invalid transport agreement evidence query")
	}

	rows, err := r.q.Query(ctx, transportAgreementEvidenceSQL, vehicleID, from.UTC(), to.UTC(), limit+1)
	if err != nil {
		return nil, false, fmt.Errorf("query transport agreement evidence: %w", err)
	}
	defer rows.Close()

	samples = make([]agreement.Sample, 0, limit)
	for rows.Next() {
		var (
			sample   agreement.Sample
			value    agreement.Value
			sourceAt time.Time
		)
		if err := rows.Scan(
			&sample.Field,
			&sample.Origin,
			&sourceAt,
			&value.Kind,
			&value.Text,
			&value.Bool,
			&value.Int,
			&value.Float,
			&value.Time,
		); err != nil {
			return nil, false, fmt.Errorf("scan transport agreement evidence: %w", err)
		}
		sample.SourceEmittedAt = sourceAt.UTC()
		sample.Value = value
		samples = append(samples, sample)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("iterate transport agreement evidence: %w", err)
	}
	if len(samples) > limit {
		samples = samples[:limit]
		truncated = true
	}
	return samples, truncated, nil
}

var _ interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
} = (database.DBTX)(nil)
