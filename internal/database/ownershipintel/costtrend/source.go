// Package costtrend loads bounded and provenance-aware ownership cost evidence.
package costtrend

import (
	"context"
	"fmt"
	"math"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/costtrend"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/text/currency"
)

type Source struct {
	pool *pgxpool.Pool
}

func NewSource(pool *pgxpool.Pool) *Source {
	return &Source{pool: pool}
}

func (s *Source) ReadCostPeriods(ctx context.Context, subject string, vehicleID int64, code string,
	from, midpoint, end time.Time,
) (domain.Period, domain.Period, error) {
	unit, err := currency.ParseISO(code)
	if err != nil || unit == currency.XXX || !from.Before(midpoint) || !midpoint.Before(end) ||
		end.Sub(from) > 64*24*time.Hour {
		return domain.Period{}, domain.Period{}, fmt.Errorf("invalid charging spend window")
	}
	scale, _ := currency.Standard.Rounding(unit)
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return domain.Period{}, domain.Period{}, fmt.Errorf("begin charging cost evidence read: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	multiplier := int64(math.Pow10(scale))
	prior, err := readPeriod(ctx, tx, subject, vehicleID, code, multiplier, from, midpoint)
	if err != nil {
		return domain.Period{}, domain.Period{}, err
	}
	current, err := readPeriod(ctx, tx, subject, vehicleID, code, multiplier, midpoint, end)
	if err != nil {
		return domain.Period{}, domain.Period{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.Period{}, domain.Period{}, fmt.Errorf("commit charging cost evidence read: %w", err)
	}
	return prior, current, nil
}

func readPeriod(ctx context.Context, tx pgx.Tx, subject string, vehicleID int64, code string,
	multiplier int64, from, to time.Time,
) (domain.Period, error) {
	distance, err := periodDistance(ctx, tx, vehicleID, from, to)
	if err != nil {
		return domain.Period{}, err
	}
	rows, err := tx.Query(ctx, `
		WITH sessions AS MATERIALIZED (
			SELECT c.id,c.vehicle_id,c.started_at,c.ended_at,c.geofence_id,c.start_place,v.vin
			FROM charging_sessions c JOIN vehicles v ON v.id=c.vehicle_id AND v.archived_at IS NULL
			WHERE c.vehicle_id=$1 AND c.started_at >= $2 AND c.started_at < $3
			ORDER BY c.started_at,c.id LIMIT $4
		)
		SELECT COALESCE(g.id,0), evidence.minor, evidence.wh
		FROM sessions c
		LEFT JOIN geofences g ON g.id=c.geofence_id AND g.enabled AND NOT g.needs_review AND g.archived_at IS NULL
		LEFT JOIN LATERAL (
			SELECT min(minor) FILTER (WHERE qualified) AS minor,min(wh) FILTER (WHERE qualified) AS wh
			FROM (
				SELECT CASE WHEN b.total_due BETWEEN 0 AND $8::bigint::numeric / $6::bigint
				            THEN round(b.total_due::numeric * $6::bigint)::bigint END AS minor,
				       CASE WHEN upper(btrim(b.pricing_type))='PER_KWH' THEN b.usage_wh END AS wh,
				       b.has_invoice AND upper(btrim(b.fee_type))='CHARGING'
				       AND b.currency_code=$5 AND b.total_due BETWEEN 0 AND $8::bigint::numeric / $6::bigint
				       AND b.charge_start_datetime>=$2 AND b.charge_start_datetime<c.ended_at
				       AND b.charge_stop_datetime>greatest(c.started_at,b.charge_start_datetime) AND b.charge_stop_datetime<=$3 AS qualified
				FROM tesla_charging_history b
				WHERE b.vin=c.vin AND COALESCE(upper(btrim(b.fee_type)),'') IN ('CHARGING','')
				  AND b.charge_start_datetime BETWEEN c.started_at-INTERVAL '2 minutes' AND c.started_at+INTERVAL '2 minutes'
				UNION ALL
				SELECT l.billed_total_minor,l.billed_energy_wh,
				       i.currency=$5 AND c.ended_at<=i.period_end AND i.status<>'disputed' AND i.variance_threshold_minor IS NOT NULL
				       AND l.billed_amount_coverage=7 AND l.review_billed_boundary='station' AND l.review_other_fees_minor IS NOT NULL
				       AND l.billed_total_minor BETWEEN 0 AND $8::bigint
				       AND l.billed_total_minor=l.billed_energy_minor::numeric+l.billed_idle_minor+l.billed_tax_minor+l.review_other_fees_minor
				       AND NOT EXISTS (SELECT 1 FROM charging_invoice_disputes d
				                       WHERE d.invoice_id=i.id AND d.status IN ('submitted','accepted')) AS qualified
				FROM charging_invoices i JOIN charging_invoice_lines l ON l.invoice_id=i.id
				WHERE i.subject=$7 AND i.vehicle_id=c.vehicle_id
				  AND l.occurred_at>=i.period_start AND l.occurred_at<i.period_end
				  AND l.occurred_at>=$2 AND l.occurred_at<$3
				  AND l.occurred_at BETWEEN c.started_at-INTERVAL '2 minutes' AND c.started_at+INTERVAL '2 minutes'
				  AND btrim(l.location)<>'' AND lower(btrim(l.location))=lower(btrim(c.start_place))
				LIMIT 2
			) matches
			HAVING count(*)=1
		) evidence ON c.ended_at>c.started_at AND c.ended_at<=$3 AND NOT EXISTS (
			SELECT 1 FROM charging_sessions other
			WHERE other.vehicle_id=c.vehicle_id AND other.id<>c.id
			  AND other.started_at BETWEEN c.started_at-INTERVAL '5 minutes' AND c.started_at+INTERVAL '5 minutes'
		)`, vehicleID, from, to, domain.MaxSessions+1, code, multiplier, subject, int64(domain.MaxCostMinor))
	if err != nil {
		return domain.Period{}, fmt.Errorf("query recorded charging spend: %w", err)
	}
	defer rows.Close()
	result := domain.Period{DistanceM: distance}
	for rows.Next() {
		item := domain.Session{Currency: code}
		if err := rows.Scan(&item.SiteID, &item.CostMinor, &item.BilledEnergyWh); err != nil {
			return domain.Period{}, fmt.Errorf("scan recorded charging spend: %w", err)
		}
		result.Sessions = append(result.Sessions, item)
	}
	if err := rows.Err(); err != nil {
		return domain.Period{}, fmt.Errorf("read recorded charging spend: %w", err)
	}
	return result, nil
}

func periodDistance(ctx context.Context, tx pgx.Tx, vehicleID int64, from, to time.Time) (*float64, error) {
	const maxDrives = 8192
	rows, err := tx.Query(ctx, `
		SELECT d.started_at,d.ended_at,d.distance_m,d.start_odometer_m,d.end_odometer_m
		FROM drives d JOIN vehicles v ON v.id=d.vehicle_id AND v.archived_at IS NULL
		WHERE d.vehicle_id=$1 AND d.started_at>=$2::timestamptz-INTERVAL '1 day' AND d.started_at<$3
		  AND (d.started_at>=$2 OR d.ended_at>$2)
		ORDER BY d.started_at,d.id LIMIT $4`, vehicleID, from, to, maxDrives+1)
	if err != nil {
		return nil, fmt.Errorf("query recorded driving distance: %w", err)
	}
	defer rows.Close()
	var count int
	var sum, first, last float64
	var lastEnd time.Time
	for rows.Next() {
		var start time.Time
		var end *time.Time
		var distance, odoStart, odoEnd *float64
		if err := rows.Scan(&start, &end, &distance, &odoStart, &odoEnd); err != nil {
			return nil, fmt.Errorf("scan recorded driving distance: %w", err)
		}
		if count >= maxDrives || start.Before(from) || start.Before(lastEnd) || end == nil ||
			!end.After(start) || end.After(to) || !qualifiedDriveDistance(distance, odoStart, odoEnd) {
			return nil, nil
		}
		if count == 0 {
			first = *odoStart
		} else if math.Abs(last-*odoStart) > 250 {
			return nil, nil
		}
		sum += *distance
		last, lastEnd = *odoEnd, *end
		count++
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read recorded driving distance: %w", err)
	}
	if count < 2 || math.Abs(sum-(last-first)) > math.Max(250, sum*0.03) {
		return nil, nil
	}
	return &sum, nil
}

func qualifiedDriveDistance(distance, start, end *float64) bool {
	if distance == nil || start == nil || end == nil || !(*start >= 0 && *end >= *start && *end <= 10_000_000_000) {
		return false
	}
	return *distance > 0 && *distance <= 2_000_000 &&
		math.Abs(*distance-(*end-*start)) <= math.Max(100, *distance*0.05)
}
