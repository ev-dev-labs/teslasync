package monthlytariff

import (
	"context"
	"fmt"
	"time"

	ownership "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/monthlytariff"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/monthlytariff"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Source struct {
	pool *pgxpool.Pool
}

func NewSource(pool *pgxpool.Pool) *Source {
	return &Source{pool: pool}
}

func (s *Source) ReadEvidence(ctx context.Context, job port.Job, from, through time.Time) (
	month domain.Month, current, alternative ownership.Tariff, err error,
) {
	if !from.Before(through) || through.Sub(from) > 32*24*time.Hour {
		return month, current, alternative, fmt.Errorf("invalid monthly tariff window")
	}
	month.From, month.Through = from, through
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}, func(tx pgx.Tx) error {
		var currentClaim bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM smart_monthly_tariff_plans p
			WHERE p.id=$1 AND p.subject=$2 AND p.vehicle_id=$3 AND p.lease_until=$4
			  AND smart_feature_current(p.subject,'monthly_tariff',p.feature_claimed_at))`,
			job.ID, job.Subject, job.VehicleID, job.Lease).Scan(&currentClaim); err != nil {
			return fmt.Errorf("check monthly tariff evidence claim: %w", err)
		}
		if !currentClaim {
			return nil
		}
		var ok bool
		var err error
		current, alternative, ok, err = readTerms(ctx, tx, job)
		if err != nil || !ok {
			return err
		}
		return readSessions(ctx, tx, job, current.Currency, &month)
	})
	return month, current, alternative, err
}

func readTerms(ctx context.Context, tx pgx.Tx, job port.Job) (current, alternative ownership.Tariff, ok bool, err error) {
	rows, err := tx.Query(ctx, `
		SELECT t.id,t.currency,t.structure,t.standing_charge_minor_per_day,t.demand_charge_minor_per_w,t.export_price_minor_per_wh,
		       t.is_current,t.version,r.day_mask,r.start_minute,r.end_minute,r.price_minor_per_wh,
		       r.tier_upper_wh,r.season_start_month,r.season_end_month
		FROM utility_tariffs t JOIN utility_tariff_rates r ON r.tariff_id=t.id
		JOIN vehicles v ON v.id=$2 AND v.archived_at IS NULL
		JOIN geofences g ON g.id=$3 AND g.updated_at=$4 AND g.enabled AND NOT g.needs_review
		    AND g.archived_at IS NULL AND g.is_charging_location
		WHERE t.subject=$1 AND ((t.id=$5 AND t.version=$6 AND t.is_current)
		    OR (t.id=$7 AND t.version=$8 AND NOT t.is_current))
		ORDER BY t.id,r.id LIMIT 129`, job.Subject, job.VehicleID, job.SiteID, job.SiteRevision,
		job.CurrentTariffID, job.CurrentVersion, job.AlternativeID, job.AlternativeVersion)
	if err != nil {
		return current, alternative, false, fmt.Errorf("read versioned tariff terms: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var t ownership.Tariff
		var rate ownership.TariffRate
		if err := rows.Scan(&t.ID, &t.Currency, &t.Structure, &t.StandingChargeMinorPerDay, &t.DemandChargeMinorPerW,
			&t.ExportPriceMinorPerWh, &t.IsCurrent, &t.Version, &rate.DayMask, &rate.StartMinute,
			&rate.EndMinute, &rate.PriceMinorPerWh, &rate.TierUpperWh, &rate.SeasonStartMonth, &rate.SeasonEndMonth); err != nil {
			return current, alternative, false, fmt.Errorf("scan tariff term: %w", err)
		}
		if t.IsCurrent {
			t.Rates = append(current.Rates, rate)
			current = t
		} else {
			t.Rates = append(alternative.Rates, rate)
			alternative = t
		}
	}
	if err := rows.Err(); err != nil {
		return current, alternative, false, fmt.Errorf("iterate tariff terms: %w", err)
	}
	return current, alternative, current.ID > 0 && alternative.ID > 0, nil
}

func readSessions(ctx context.Context, tx pgx.Tx, job port.Job, currency string, month *domain.Month) error {
	rows, err := tx.Query(ctx, `
		WITH sessions AS MATERIALIZED (
			SELECT c.id,c.vehicle_id,c.started_at,c.ended_at,c.geofence_id
			FROM charging_sessions c
			WHERE c.vehicle_id=$1 AND (c.geofence_id=$2 OR c.geofence_id IS NULL)
			  AND c.started_at<$4
			  AND (c.started_at>=$3 OR c.ended_at>$3 OR c.ended_at IS NULL)
			ORDER BY c.started_at,c.id LIMIT $5
		)
		SELECT c.started_at,c.ended_at,receipt.billed_wh,receipt.billed_minor
		FROM sessions c JOIN geofences g ON g.id=$2
		LEFT JOIN LATERAL (
			SELECT min(wh) AS billed_wh,min(minor) AS billed_minor
			FROM (
				SELECT CASE WHEN qualified THEN billed_energy_wh END AS wh,
				       CASE WHEN qualified THEN billed_energy_minor END AS minor
				FROM (
					SELECT l.billed_energy_wh,l.billed_energy_minor,
						i.currency=$6 AND i.status<>'disputed' AND i.variance_threshold_minor IS NOT NULL
						AND i.variance_complete_statement
						AND i.billed_total_minor=(SELECT sum(item.billed_total_minor) FROM charging_invoice_lines item WHERE item.invoice_id=i.id)
						AND l.billed_amount_coverage=7 AND l.review_billed_boundary='station' AND l.review_other_fees_minor=0
						AND l.billed_idle_minor=0 AND l.billed_tax_minor=0 AND l.billed_total_minor=l.billed_energy_minor
						AND l.occurred_at>=i.period_start AND l.occurred_at<i.period_end AND c.ended_at<=i.period_end
						AND l.occurred_at>=$3 AND l.occurred_at<c.ended_at
						AND NOT EXISTS (SELECT 1 FROM charging_invoice_disputes d
						                WHERE d.invoice_id=i.id AND d.status IN ('submitted','accepted')) AS qualified
					FROM charging_invoices i JOIN charging_invoice_lines l ON l.invoice_id=i.id
					WHERE i.subject=$7 AND i.vehicle_id=c.vehicle_id
					  AND i.period_start<$4 AND i.period_end>$3
					  AND l.occurred_at BETWEEN c.started_at-INTERVAL '2 minutes' AND c.started_at+INTERVAL '2 minutes'
					  AND btrim(l.location)<>'' AND lower(btrim(l.location))=lower(btrim(g.name))
					LIMIT 2
				) matching
			) priced HAVING count(*)=1
		) receipt ON c.geofence_id=$2 AND c.started_at>=$3 AND c.ended_at>c.started_at AND c.ended_at<=$4
		    AND NOT EXISTS (
			    SELECT 1 FROM charging_sessions other
			    WHERE other.vehicle_id=c.vehicle_id AND other.id<>c.id
			      AND other.started_at BETWEEN c.started_at-INTERVAL '5 minutes' AND c.started_at+INTERVAL '5 minutes'
		    )`, job.VehicleID, job.SiteID, month.From, month.Through, domain.MaxSessions+1, currency, job.Subject)
	if err != nil {
		return fmt.Errorf("query metered charging sessions: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var item domain.MeteredSession
		var end *time.Time
		var wh *float64
		var minor *int64
		if err := rows.Scan(&item.Start, &end, &wh, &minor); err != nil {
			return fmt.Errorf("scan metered charging session: %w", err)
		}
		month.Observed++
		if end != nil && wh != nil && minor != nil {
			item.End, item.BilledWh, item.BilledEnergyMinor = *end, *wh, *minor
			month.Metered = append(month.Metered, item)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate metered charging sessions: %w", err)
	}
	return nil
}
