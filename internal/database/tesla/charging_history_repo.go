package tesla

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/jackc/pgx/v5"
)

// TeslaChargingHistoryRepo provides data access for Tesla Supercharger/DC charging history.
type TeslaChargingHistoryRepo struct {
	pool teslaPool
}

func NewTeslaChargingHistoryRepo(db *database.DB) *TeslaChargingHistoryRepo {
	return &TeslaChargingHistoryRepo{pool: db.Pool}
}

// GetAll returns paginated charging history, optionally filtered by VIN.
func (r *TeslaChargingHistoryRepo) GetAll(ctx context.Context, vin string, limit, offset int) ([]*teslamodel.TeslaChargingHistoryEntry, error) {
	query := `SELECT id, session_id, vin, site_location_name, charge_start_datetime, charge_stop_datetime,
		country, state, county, postal_code, billing_type, fee_type, currency_code, pricing_type,
		rate_base, usage_wh, total_due, has_invoice, invoice_content_id, fetched_at, created_at
		FROM tesla_charging_history`
	args := []interface{}{}
	argIdx := 1

	if vin != "" {
		query += fmt.Sprintf(" WHERE vin = $%d", argIdx)
		args = append(args, vin)
		argIdx++
	}

	query += fmt.Sprintf(" ORDER BY charge_start_datetime DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query tesla charging history: %w", err)
	}
	defer rows.Close()

	var results []*teslamodel.TeslaChargingHistoryEntry
	for rows.Next() {
		e := &teslamodel.TeslaChargingHistoryEntry{}
		if err := rows.Scan(
			&e.ID, &e.SessionID, &e.VIN, &e.SiteLocationName,
			&e.ChargeStartDatetime, &e.ChargeStopDatetime,
			&e.Country, &e.State, &e.County, &e.PostalCode,
			&e.BillingType, &e.FeeType, &e.CurrencyCode, &e.PricingType,
			&e.RateBase, &e.UsageWh, &e.TotalDue,
			&e.HasInvoice, &e.InvoiceContentID,
			&e.FetchedAt, &e.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan tesla charging history: %w", err)
		}
		results = append(results, e)
	}
	return results, rows.Err()
}

// GetBySessionID returns a single charging history entry by Tesla session ID.
func (r *TeslaChargingHistoryRepo) GetBySessionID(ctx context.Context, sessionID int64) (*teslamodel.TeslaChargingHistoryEntry, error) {
	query := `SELECT id, session_id, vin, site_location_name, charge_start_datetime, charge_stop_datetime,
		country, state, county, postal_code, billing_type, fee_type, currency_code, pricing_type,
		rate_base, usage_wh, total_due, has_invoice, invoice_content_id, fetched_at, created_at
		FROM tesla_charging_history WHERE session_id = $1`
	e := &teslamodel.TeslaChargingHistoryEntry{}
	err := r.pool.QueryRow(ctx, query, sessionID).Scan(
		&e.ID, &e.SessionID, &e.VIN, &e.SiteLocationName,
		&e.ChargeStartDatetime, &e.ChargeStopDatetime,
		&e.Country, &e.State, &e.County, &e.PostalCode,
		&e.BillingType, &e.FeeType, &e.CurrencyCode, &e.PricingType,
		&e.RateBase, &e.UsageWh, &e.TotalDue,
		&e.HasInvoice, &e.InvoiceContentID,
		&e.FetchedAt, &e.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get tesla charging history by session: %w", err)
	}
	return e, nil
}

// GetSummary returns aggregated stats for Tesla charging history, optionally filtered by VIN.
func (r *TeslaChargingHistoryRepo) GetSummary(ctx context.Context, vin string) (*teslamodel.TeslaChargingHistorySummary, error) {
	query := `SELECT COUNT(*), SUM(usage_wh), SUM(total_due),
		CASE WHEN SUM(usage_wh) > 0 THEN SUM(total_due) / (SUM(usage_wh) / 1000.0) ELSE NULL END
		FROM tesla_charging_history`
	args := []interface{}{}
	if vin != "" {
		query += " WHERE vin = $1"
		args = append(args, vin)
	}

	s := &teslamodel.TeslaChargingHistorySummary{}
	err := r.pool.QueryRow(ctx, query, args...).Scan(
		&s.TotalSessions, &s.TotalWh, &s.TotalSpend, &s.AvgCostPerKWh,
	)
	if err != nil {
		return nil, fmt.Errorf("get tesla charging history summary: %w", err)
	}
	return s, nil
}

// UpsertBatch inserts or updates charging history entries by session_id.
func (r *TeslaChargingHistoryRepo) UpsertBatch(ctx context.Context, entries []*teslamodel.TeslaChargingHistoryEntry) (int, error) {
	if len(entries) == 0 {
		return 0, nil
	}

	query := `INSERT INTO tesla_charging_history (
		session_id, vin, site_location_name, charge_start_datetime, charge_stop_datetime,
		country, state, county, postal_code, billing_type, fee_type, currency_code, pricing_type,
		rate_base, usage_wh, total_due, has_invoice, invoice_content_id, fetched_at
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
	ON CONFLICT (session_id) DO UPDATE SET
		site_location_name = EXCLUDED.site_location_name,
		charge_start_datetime = EXCLUDED.charge_start_datetime,
		charge_stop_datetime = EXCLUDED.charge_stop_datetime,
		country = EXCLUDED.country,
		state = EXCLUDED.state,
		county = EXCLUDED.county,
		postal_code = EXCLUDED.postal_code,
		billing_type = EXCLUDED.billing_type,
		fee_type = EXCLUDED.fee_type,
		currency_code = EXCLUDED.currency_code,
		pricing_type = EXCLUDED.pricing_type,
		rate_base = EXCLUDED.rate_base,
		usage_wh = EXCLUDED.usage_wh,
		total_due = EXCLUDED.total_due,
		has_invoice = EXCLUDED.has_invoice,
		invoice_content_id = EXCLUDED.invoice_content_id,
		fetched_at = EXCLUDED.fetched_at`

	now := time.Now().UTC()
	upserted := 0
	for i, e := range entries {
		if e == nil {
			return upserted, fmt.Errorf("upsert tesla charging history: nil entry at index %d", i)
		}
		_, err := r.pool.Exec(ctx, query,
			e.SessionID, e.VIN, e.SiteLocationName,
			e.ChargeStartDatetime, e.ChargeStopDatetime,
			e.Country, e.State, e.County, e.PostalCode,
			e.BillingType, e.FeeType, e.CurrencyCode, e.PricingType,
			e.RateBase, e.UsageWh, e.TotalDue,
			e.HasInvoice, e.InvoiceContentID,
			now,
		)
		if err != nil {
			return upserted, fmt.Errorf("upsert tesla charging history session %d: %w", e.SessionID, err)
		}
		upserted++
	}
	return upserted, nil
}
