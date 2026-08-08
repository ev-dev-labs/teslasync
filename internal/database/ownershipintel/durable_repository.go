package ownershipintel

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type txRunner func(context.Context, func(database.DBTX) error) error

// DurableRepository persists every user-authored ownership-intelligence record.
type DurableRepository struct {
	q      database.DBTX
	withTx txRunner
}

// NewDurableRepository builds the write adapter.
func NewDurableRepository(db *database.DB) *DurableRepository {
	if db == nil || db.Pool == nil {
		panic("ownershipintel.NewDurableRepository: db and db.Pool must not be nil")
	}
	return &DurableRepository{
		q: db.Pool,
		withTx: func(ctx context.Context, fn func(database.DBTX) error) error {
			return db.WithTx(ctx, func(tx pgx.Tx) error { return fn(tx) })
		},
	}
}

// mapWriteError normalises driver errors onto the port's sentinel errors.
func mapWriteError(operation string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return port.ErrNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return port.ErrConflict
	}
	return fmt.Errorf("%s: %w", operation, err)
}

func affected(tag pgconn.CommandTag) error {
	if tag.RowsAffected() == 0 {
		return port.ErrNotFound
	}
	return nil
}

// ---------------------------------------------------------------------------
// 1. Insurance underwriting
// ---------------------------------------------------------------------------

const policyColumns = `id, vehicle_id, insurer, policy_ref, currency,
	annual_premium_minor, deductible_minor, coverage_start, coverage_end,
	telematics_program, max_discount_pct, version, created_at, updated_at`

func scanPolicy(row pgx.Row) (*port.PolicyRecord, error) {
	var record port.PolicyRecord
	if err := row.Scan(
		&record.ID, &record.VehicleID, &record.Insurer, &record.PolicyRef, &record.Currency,
		&record.AnnualPremiumMinor, &record.DeductibleMinor, &record.CoverageStart, &record.CoverageEnd,
		&record.TelematicsProgram, &record.MaxDiscountPct, &record.Version, &record.CreatedAt, &record.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *DurableRepository) GetPolicy(ctx context.Context, subject string, vehicleID int64) (*port.PolicyRecord, error) {
	const query = `SELECT ` + policyColumns + `
		FROM insurance_policies
		WHERE subject = $1 AND vehicle_id = $2
		ORDER BY updated_at DESC, id DESC
		LIMIT 1`
	record, err := scanPolicy(r.q.QueryRow(ctx, query, subject, vehicleID))
	if errors.Is(err, pgx.ErrNoRows) {
		// A subject that has not configured a policy yet is an expected empty
		// state — the risk profile still renders without one.
		return nil, nil
	}
	if err != nil {
		return nil, mapWriteError("get insurance policy", err)
	}
	return record, nil
}

func (r *DurableRepository) UpsertPolicy(ctx context.Context, subject string, in port.PolicyRecord) (*port.PolicyRecord, error) {
	const query = `
		INSERT INTO insurance_policies (
		    subject, vehicle_id, insurer, policy_ref, currency,
		    annual_premium_minor, deductible_minor, coverage_start, coverage_end,
		    telematics_program, max_discount_pct
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (subject, vehicle_id, insurer, policy_ref) DO UPDATE SET
		    currency = EXCLUDED.currency,
		    annual_premium_minor = EXCLUDED.annual_premium_minor,
		    deductible_minor = EXCLUDED.deductible_minor,
		    coverage_start = EXCLUDED.coverage_start,
		    coverage_end = EXCLUDED.coverage_end,
		    telematics_program = EXCLUDED.telematics_program,
		    max_discount_pct = EXCLUDED.max_discount_pct,
		    version = insurance_policies.version + 1,
		    updated_at = now()
		RETURNING ` + policyColumns
	record, err := scanPolicy(r.q.QueryRow(ctx, query,
		subject, in.VehicleID, in.Insurer, in.PolicyRef, in.Currency,
		in.AnnualPremiumMinor, in.DeductibleMinor, in.CoverageStart, in.CoverageEnd,
		in.TelematicsProgram, in.MaxDiscountPct,
	))
	if err != nil {
		return nil, mapWriteError("upsert insurance policy", err)
	}
	return record, nil
}

func (r *DurableRepository) DeletePolicy(ctx context.Context, subject string, id int64) error {
	tag, err := r.q.Exec(ctx, `DELETE FROM insurance_policies WHERE subject = $1 AND id = $2`, subject, id)
	if err != nil {
		return mapWriteError("delete insurance policy", err)
	}
	return affected(tag)
}

// ---------------------------------------------------------------------------
// 2. Utility tariffs
// ---------------------------------------------------------------------------

const tariffColumns = `id, name, provider, currency, structure,
	standing_charge_minor_per_day, demand_charge_minor_per_w, export_price_minor_per_wh,
	is_current, version, created_at, updated_at`

func scanTariff(row pgx.Row) (*port.TariffRecord, error) {
	var record port.TariffRecord
	if err := row.Scan(
		&record.ID, &record.Name, &record.Provider, &record.Currency, &record.Structure,
		&record.StandingChargeMinorPerDay, &record.DemandChargeMinorPerW, &record.ExportPriceMinorPerWh,
		&record.IsCurrent, &record.Version, &record.CreatedAt, &record.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *DurableRepository) loadTariffRates(ctx context.Context, q database.DBTX, tariffIDs []int64) (map[int64][]port.TariffRateRecord, error) {
	if len(tariffIDs) == 0 {
		return map[int64][]port.TariffRateRecord{}, nil
	}
	const query = `
		SELECT id, tariff_id, label, day_mask, start_minute, end_minute,
		       price_minor_per_wh, tier_upper_wh, season_start_month, season_end_month
		FROM utility_tariff_rates
		WHERE tariff_id = ANY($1)
		ORDER BY tariff_id, start_minute, id`
	rows, err := q.Query(ctx, query, tariffIDs)
	if err != nil {
		return nil, fmt.Errorf("query tariff rates: %w", err)
	}
	defer rows.Close()

	byTariff := map[int64][]port.TariffRateRecord{}
	for rows.Next() {
		var rate port.TariffRateRecord
		if err := rows.Scan(
			&rate.ID, &rate.TariffID, &rate.Label, &rate.DayMask, &rate.StartMinute, &rate.EndMinute,
			&rate.PriceMinorPerWh, &rate.TierUpperWh, &rate.SeasonStartMonth, &rate.SeasonEndMonth,
		); err != nil {
			return nil, fmt.Errorf("scan tariff rate: %w", err)
		}
		byTariff[rate.TariffID] = append(byTariff[rate.TariffID], rate)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tariff rates: %w", err)
	}
	return byTariff, nil
}

func (r *DurableRepository) ListTariffs(ctx context.Context, subject string, limit, offset int) ([]port.TariffRecord, int, error) {
	const query = `
		SELECT ` + tariffColumns + `, COUNT(*) OVER()::int
		FROM utility_tariffs
		WHERE subject = $1
		ORDER BY is_current DESC, name ASC, id ASC
		LIMIT $2 OFFSET $3`
	rows, err := r.q.Query(ctx, query, subject, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list tariffs: %w", err)
	}
	defer rows.Close()

	items := make([]port.TariffRecord, 0)
	total := 0
	for rows.Next() {
		var item port.TariffRecord
		if err := rows.Scan(
			&item.ID, &item.Name, &item.Provider, &item.Currency, &item.Structure,
			&item.StandingChargeMinorPerDay, &item.DemandChargeMinorPerW, &item.ExportPriceMinorPerWh,
			&item.IsCurrent, &item.Version, &item.CreatedAt, &item.UpdatedAt, &total,
		); err != nil {
			return nil, 0, fmt.Errorf("scan tariff: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate tariffs: %w", err)
	}
	if err := r.attachRates(ctx, items); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *DurableRepository) attachRates(ctx context.Context, items []port.TariffRecord) error {
	ids := make([]int64, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	byTariff, err := r.loadTariffRates(ctx, r.q, ids)
	if err != nil {
		return err
	}
	for index := range items {
		items[index].Rates = byTariff[items[index].ID]
	}
	return nil
}

func (r *DurableRepository) GetTariffs(ctx context.Context, subject string, ids []int64) ([]port.TariffRecord, error) {
	if len(ids) == 0 {
		return []port.TariffRecord{}, nil
	}
	const query = `SELECT ` + tariffColumns + `
		FROM utility_tariffs
		WHERE subject = $1 AND id = ANY($2)
		ORDER BY name ASC, id ASC`
	rows, err := r.q.Query(ctx, query, subject, ids)
	if err != nil {
		return nil, fmt.Errorf("get tariffs: %w", err)
	}
	defer rows.Close()

	items := make([]port.TariffRecord, 0, len(ids))
	for rows.Next() {
		var item port.TariffRecord
		if err := rows.Scan(
			&item.ID, &item.Name, &item.Provider, &item.Currency, &item.Structure,
			&item.StandingChargeMinorPerDay, &item.DemandChargeMinorPerW, &item.ExportPriceMinorPerWh,
			&item.IsCurrent, &item.Version, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan tariff: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tariffs: %w", err)
	}
	if len(items) == 0 {
		return nil, port.ErrNotFound
	}
	if err := r.attachRates(ctx, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *DurableRepository) CreateTariff(ctx context.Context, subject string, in port.TariffRecord) (*port.TariffRecord, error) {
	var created *port.TariffRecord
	err := r.withTx(ctx, func(tx database.DBTX) error {
		const insertTariff = `
			INSERT INTO utility_tariffs (
			    subject, name, provider, currency, structure,
			    standing_charge_minor_per_day, demand_charge_minor_per_w,
			    export_price_minor_per_wh, is_current
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
			RETURNING ` + tariffColumns
		record, err := scanTariff(tx.QueryRow(ctx, insertTariff,
			subject, in.Name, in.Provider, in.Currency, in.Structure,
			in.StandingChargeMinorPerDay, in.DemandChargeMinorPerW,
			in.ExportPriceMinorPerWh, in.IsCurrent,
		))
		if err != nil {
			return mapWriteError("insert tariff", err)
		}
		const insertRate = `
			INSERT INTO utility_tariff_rates (
			    tariff_id, label, day_mask, start_minute, end_minute,
			    price_minor_per_wh, tier_upper_wh, season_start_month, season_end_month
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
			RETURNING id`
		record.Rates = make([]port.TariffRateRecord, 0, len(in.Rates))
		for _, rate := range in.Rates {
			rate.TariffID = record.ID
			if err := tx.QueryRow(ctx, insertRate,
				record.ID, rate.Label, rate.DayMask, rate.StartMinute, rate.EndMinute,
				rate.PriceMinorPerWh, rate.TierUpperWh, rate.SeasonStartMonth, rate.SeasonEndMonth,
			).Scan(&rate.ID); err != nil {
				return mapWriteError("insert tariff rate", err)
			}
			record.Rates = append(record.Rates, rate)
		}
		created = record
		return nil
	})
	if err != nil {
		return nil, err
	}
	return created, nil
}

func (r *DurableRepository) DeleteTariff(ctx context.Context, subject string, id int64) error {
	tag, err := r.q.Exec(ctx, `DELETE FROM utility_tariffs WHERE subject = $1 AND id = $2`, subject, id)
	if err != nil {
		return mapWriteError("delete tariff", err)
	}
	return affected(tag)
}

// ---------------------------------------------------------------------------
// 3. Charging invoices, lines, and disputes
// ---------------------------------------------------------------------------

const invoiceColumns = `id, vehicle_id, provider, invoice_ref, currency,
	period_start, period_end, billed_total_minor, status, version, created_at, updated_at`

func scanInvoice(row pgx.Row) (*port.InvoiceRecord, error) {
	var record port.InvoiceRecord
	if err := row.Scan(
		&record.ID, &record.VehicleID, &record.Provider, &record.InvoiceRef, &record.Currency,
		&record.PeriodStart, &record.PeriodEnd, &record.BilledTotalMinor, &record.Status,
		&record.Version, &record.CreatedAt, &record.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *DurableRepository) loadInvoiceLines(ctx context.Context, q database.DBTX, invoiceIDs []int64) (map[int64][]port.InvoiceLineRecord, error) {
	if len(invoiceIDs) == 0 {
		return map[int64][]port.InvoiceLineRecord{}, nil
	}
	const query = `
		SELECT id, invoice_id, line_ref, occurred_at, location,
		       billed_energy_wh, billed_energy_minor, billed_idle_minor,
		       billed_tax_minor, billed_total_minor
		FROM charging_invoice_lines
		WHERE invoice_id = ANY($1)
		ORDER BY invoice_id, occurred_at, id`
	rows, err := q.Query(ctx, query, invoiceIDs)
	if err != nil {
		return nil, fmt.Errorf("query invoice lines: %w", err)
	}
	defer rows.Close()

	byInvoice := map[int64][]port.InvoiceLineRecord{}
	for rows.Next() {
		var line port.InvoiceLineRecord
		if err := rows.Scan(
			&line.ID, &line.InvoiceID, &line.LineRef, &line.OccurredAt, &line.Location,
			&line.BilledEnergyWh, &line.BilledEnergyMinor, &line.BilledIdleMinor,
			&line.BilledTaxMinor, &line.BilledTotalMinor,
		); err != nil {
			return nil, fmt.Errorf("scan invoice line: %w", err)
		}
		byInvoice[line.InvoiceID] = append(byInvoice[line.InvoiceID], line)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate invoice lines: %w", err)
	}
	return byInvoice, nil
}

func (r *DurableRepository) ListInvoices(ctx context.Context, subject string, vehicleID int64, limit, offset int) ([]port.InvoiceRecord, int, error) {
	const query = `
		SELECT ` + invoiceColumns + `, COUNT(*) OVER()::int
		FROM charging_invoices
		WHERE subject = $1 AND vehicle_id = $2
		ORDER BY period_end DESC, id DESC
		LIMIT $3 OFFSET $4`
	rows, err := r.q.Query(ctx, query, subject, vehicleID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list invoices: %w", err)
	}
	defer rows.Close()

	items := make([]port.InvoiceRecord, 0)
	total := 0
	for rows.Next() {
		var item port.InvoiceRecord
		if err := rows.Scan(
			&item.ID, &item.VehicleID, &item.Provider, &item.InvoiceRef, &item.Currency,
			&item.PeriodStart, &item.PeriodEnd, &item.BilledTotalMinor, &item.Status,
			&item.Version, &item.CreatedAt, &item.UpdatedAt, &total,
		); err != nil {
			return nil, 0, fmt.Errorf("scan invoice: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate invoices: %w", err)
	}
	ids := make([]int64, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	byInvoice, err := r.loadInvoiceLines(ctx, r.q, ids)
	if err != nil {
		return nil, 0, err
	}
	for index := range items {
		items[index].Lines = byInvoice[items[index].ID]
	}
	return items, total, nil
}

func (r *DurableRepository) GetInvoice(ctx context.Context, subject string, id int64) (*port.InvoiceRecord, error) {
	const query = `SELECT ` + invoiceColumns + ` FROM charging_invoices WHERE subject = $1 AND id = $2`
	record, err := scanInvoice(r.q.QueryRow(ctx, query, subject, id))
	if err != nil {
		return nil, mapWriteError("get invoice", err)
	}
	byInvoice, err := r.loadInvoiceLines(ctx, r.q, []int64{record.ID})
	if err != nil {
		return nil, err
	}
	record.Lines = byInvoice[record.ID]
	return record, nil
}

func (r *DurableRepository) CreateInvoice(ctx context.Context, subject string, in port.InvoiceRecord) (*port.InvoiceRecord, error) {
	var created *port.InvoiceRecord
	err := r.withTx(ctx, func(tx database.DBTX) error {
		const insertInvoice = `
			INSERT INTO charging_invoices (
			    subject, vehicle_id, provider, invoice_ref, currency,
			    period_start, period_end, billed_total_minor, status
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
			RETURNING ` + invoiceColumns
		record, err := scanInvoice(tx.QueryRow(ctx, insertInvoice,
			subject, in.VehicleID, in.Provider, in.InvoiceRef, in.Currency,
			in.PeriodStart, in.PeriodEnd, in.BilledTotalMinor, in.Status,
		))
		if err != nil {
			return mapWriteError("insert invoice", err)
		}
		const insertLine = `
			INSERT INTO charging_invoice_lines (
			    invoice_id, line_ref, occurred_at, location, billed_energy_wh,
			    billed_energy_minor, billed_idle_minor, billed_tax_minor, billed_total_minor
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
			RETURNING id`
		record.Lines = make([]port.InvoiceLineRecord, 0, len(in.Lines))
		for _, line := range in.Lines {
			line.InvoiceID = record.ID
			if err := tx.QueryRow(ctx, insertLine,
				record.ID, line.LineRef, line.OccurredAt, line.Location, line.BilledEnergyWh,
				line.BilledEnergyMinor, line.BilledIdleMinor, line.BilledTaxMinor, line.BilledTotalMinor,
			).Scan(&line.ID); err != nil {
				return mapWriteError("insert invoice line", err)
			}
			record.Lines = append(record.Lines, line)
		}
		created = record
		return nil
	})
	if err != nil {
		return nil, err
	}
	return created, nil
}

func (r *DurableRepository) DeleteInvoice(ctx context.Context, subject string, id int64) error {
	tag, err := r.q.Exec(ctx, `DELETE FROM charging_invoices WHERE subject = $1 AND id = $2`, subject, id)
	if err != nil {
		return mapWriteError("delete invoice", err)
	}
	return affected(tag)
}

const disputeColumns = `id, invoice_id, claimed_minor, recovered_minor, status,
	reasons, note, opened_at, resolved_at`

func (r *DurableRepository) CreateDispute(ctx context.Context, subject string, in port.DisputeRecord) (*port.DisputeRecord, error) {
	const query = `
		INSERT INTO charging_invoice_disputes (
		    invoice_id, subject, claimed_minor, status, reasons, note, opened_at
		)
		SELECT $1, $2, $3, $4, $5, $6, $7
		WHERE EXISTS (SELECT 1 FROM charging_invoices WHERE id = $1 AND subject = $2)
		RETURNING ` + disputeColumns
	var record port.DisputeRecord
	err := r.q.QueryRow(ctx, query,
		in.InvoiceID, subject, in.ClaimedMinor, in.Status, in.Reasons, in.Note, in.OpenedAt,
	).Scan(
		&record.ID, &record.InvoiceID, &record.ClaimedMinor, &record.RecoveredMinor,
		&record.Status, &record.Reasons, &record.Note, &record.OpenedAt, &record.ResolvedAt,
	)
	if err != nil {
		return nil, mapWriteError("create dispute", err)
	}
	return &record, nil
}

func (r *DurableRepository) ListDisputes(ctx context.Context, subject string, invoiceID int64) ([]port.DisputeRecord, error) {
	const query = `SELECT ` + disputeColumns + `
		FROM charging_invoice_disputes
		WHERE subject = $1 AND invoice_id = $2
		ORDER BY opened_at DESC, id DESC`
	rows, err := r.q.Query(ctx, query, subject, invoiceID)
	if err != nil {
		return nil, fmt.Errorf("list disputes: %w", err)
	}
	defer rows.Close()

	items := make([]port.DisputeRecord, 0)
	for rows.Next() {
		var record port.DisputeRecord
		if err := rows.Scan(
			&record.ID, &record.InvoiceID, &record.ClaimedMinor, &record.RecoveredMinor,
			&record.Status, &record.Reasons, &record.Note, &record.OpenedAt, &record.ResolvedAt,
		); err != nil {
			return nil, fmt.Errorf("scan dispute: %w", err)
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate disputes: %w", err)
	}
	return items, nil
}

// ---------------------------------------------------------------------------
// 4. Driver profiles and attribution
// ---------------------------------------------------------------------------

const profileColumns = `id, vehicle_id, name, accent, is_primary, version, created_at, updated_at`

func (r *DurableRepository) ListProfiles(ctx context.Context, subject string, vehicleID int64) ([]port.DriverProfileRecord, error) {
	const query = `SELECT ` + profileColumns + `
		FROM driver_profiles
		WHERE subject = $1 AND vehicle_id = $2
		ORDER BY is_primary DESC, name ASC, id ASC`
	rows, err := r.q.Query(ctx, query, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list driver profiles: %w", err)
	}
	defer rows.Close()

	items := make([]port.DriverProfileRecord, 0)
	for rows.Next() {
		var record port.DriverProfileRecord
		if err := rows.Scan(
			&record.ID, &record.VehicleID, &record.Name, &record.Accent,
			&record.IsPrimary, &record.Version, &record.CreatedAt, &record.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan driver profile: %w", err)
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate driver profiles: %w", err)
	}
	return items, nil
}

func (r *DurableRepository) CreateProfile(ctx context.Context, subject string, in port.DriverProfileRecord) (*port.DriverProfileRecord, error) {
	const query = `
		INSERT INTO driver_profiles (subject, vehicle_id, name, accent, is_primary)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING ` + profileColumns
	var record port.DriverProfileRecord
	err := r.q.QueryRow(ctx, query, subject, in.VehicleID, in.Name, in.Accent, in.IsPrimary).Scan(
		&record.ID, &record.VehicleID, &record.Name, &record.Accent,
		&record.IsPrimary, &record.Version, &record.CreatedAt, &record.UpdatedAt,
	)
	if err != nil {
		return nil, mapWriteError("create driver profile", err)
	}
	return &record, nil
}

func (r *DurableRepository) DeleteProfile(ctx context.Context, subject string, id int64) error {
	tag, err := r.q.Exec(ctx, `DELETE FROM driver_profiles WHERE subject = $1 AND id = $2`, subject, id)
	if err != nil {
		return mapWriteError("delete driver profile", err)
	}
	return affected(tag)
}

func (r *DurableRepository) ListAssignments(ctx context.Context, subject string, vehicleID int64, from, to time.Time) ([]port.AssignmentRecord, error) {
	const query = `
		SELECT a.drive_id, a.driver_profile_id, a.source, a.confidence_pct, a.assigned_at
		FROM drive_driver_assignments a
		JOIN drives d ON d.id = a.drive_id
		WHERE a.subject = $1 AND d.vehicle_id = $2 AND d.started_at >= $3 AND d.started_at < $4
		ORDER BY a.assigned_at DESC`
	rows, err := r.q.Query(ctx, query, subject, vehicleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("list drive assignments: %w", err)
	}
	defer rows.Close()

	items := make([]port.AssignmentRecord, 0)
	for rows.Next() {
		var record port.AssignmentRecord
		if err := rows.Scan(
			&record.DriveID, &record.DriverProfileID, &record.Source,
			&record.ConfidencePct, &record.AssignedAt,
		); err != nil {
			return nil, fmt.Errorf("scan drive assignment: %w", err)
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate drive assignments: %w", err)
	}
	return items, nil
}

func (r *DurableRepository) UpsertAssignment(ctx context.Context, subject string, in port.AssignmentRecord) error {
	const query = `
		INSERT INTO drive_driver_assignments (
		    drive_id, subject, driver_profile_id, source, confidence_pct, assigned_at
		)
		SELECT $1, $2, $3, $4, $5, $6
		WHERE EXISTS (SELECT 1 FROM driver_profiles WHERE id = $3 AND subject = $2)
		ON CONFLICT (subject, drive_id) DO UPDATE SET
		    driver_profile_id = EXCLUDED.driver_profile_id,
		    source = EXCLUDED.source,
		    confidence_pct = EXCLUDED.confidence_pct,
		    assigned_at = EXCLUDED.assigned_at`
	tag, err := r.q.Exec(ctx, query,
		in.DriveID, subject, in.DriverProfileID, in.Source, in.ConfidencePct, in.AssignedAt)
	if err != nil {
		return mapWriteError("upsert drive assignment", err)
	}
	return affected(tag)
}

// ---------------------------------------------------------------------------
// 5. Warranties and claims
// ---------------------------------------------------------------------------

const warrantyColumns = `id, vehicle_id, kind, label, provider, start_at,
	start_odometer_m, term_s, term_distance_m, capacity_floor_pct,
	deductible_minor, currency, notes, version, created_at, updated_at`

func (r *DurableRepository) ListWarranties(ctx context.Context, subject string, vehicleID int64) ([]port.WarrantyRecord, error) {
	const query = `SELECT ` + warrantyColumns + `
		FROM vehicle_warranties
		WHERE subject = $1 AND vehicle_id = $2
		ORDER BY start_at ASC, id ASC`
	rows, err := r.q.Query(ctx, query, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list warranties: %w", err)
	}
	defer rows.Close()

	items := make([]port.WarrantyRecord, 0)
	for rows.Next() {
		var record port.WarrantyRecord
		if err := rows.Scan(
			&record.ID, &record.VehicleID, &record.Kind, &record.Label, &record.Provider, &record.StartAt,
			&record.StartOdometerM, &record.TermS, &record.TermDistanceM, &record.CapacityFloorPct,
			&record.DeductibleMinor, &record.Currency, &record.Notes, &record.Version,
			&record.CreatedAt, &record.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan warranty: %w", err)
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate warranties: %w", err)
	}
	return items, nil
}

func (r *DurableRepository) CreateWarranty(ctx context.Context, subject string, in port.WarrantyRecord) (*port.WarrantyRecord, error) {
	const query = `
		INSERT INTO vehicle_warranties (
		    subject, vehicle_id, kind, label, provider, start_at, start_odometer_m,
		    term_s, term_distance_m, capacity_floor_pct, deductible_minor, currency, notes
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		RETURNING ` + warrantyColumns
	var record port.WarrantyRecord
	err := r.q.QueryRow(ctx, query,
		subject, in.VehicleID, in.Kind, in.Label, in.Provider, in.StartAt, in.StartOdometerM,
		in.TermS, in.TermDistanceM, in.CapacityFloorPct, in.DeductibleMinor, in.Currency, in.Notes,
	).Scan(
		&record.ID, &record.VehicleID, &record.Kind, &record.Label, &record.Provider, &record.StartAt,
		&record.StartOdometerM, &record.TermS, &record.TermDistanceM, &record.CapacityFloorPct,
		&record.DeductibleMinor, &record.Currency, &record.Notes, &record.Version,
		&record.CreatedAt, &record.UpdatedAt,
	)
	if err != nil {
		return nil, mapWriteError("create warranty", err)
	}
	return &record, nil
}

func (r *DurableRepository) DeleteWarranty(ctx context.Context, subject string, id int64) error {
	tag, err := r.q.Exec(ctx, `DELETE FROM vehicle_warranties WHERE subject = $1 AND id = $2`, subject, id)
	if err != nil {
		return mapWriteError("delete warranty", err)
	}
	return affected(tag)
}

const claimColumns = `id, warranty_id, title, status, opened_at, closed_at,
	amount_minor, evidence_note, created_at, updated_at`

func (r *DurableRepository) ListClaims(ctx context.Context, subject string, vehicleID int64) ([]port.ClaimRecord, error) {
	const query = `
		SELECT c.id, c.warranty_id, c.title, c.status, c.opened_at, c.closed_at,
		       c.amount_minor, c.evidence_note, c.created_at, c.updated_at
		FROM warranty_claims c
		JOIN vehicle_warranties w ON w.id = c.warranty_id
		WHERE c.subject = $1 AND w.vehicle_id = $2
		ORDER BY c.opened_at DESC, c.id DESC`
	rows, err := r.q.Query(ctx, query, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list warranty claims: %w", err)
	}
	defer rows.Close()

	items := make([]port.ClaimRecord, 0)
	for rows.Next() {
		var record port.ClaimRecord
		if err := rows.Scan(
			&record.ID, &record.WarrantyID, &record.Title, &record.Status, &record.OpenedAt,
			&record.ClosedAt, &record.AmountMinor, &record.EvidenceNote, &record.CreatedAt, &record.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan warranty claim: %w", err)
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate warranty claims: %w", err)
	}
	return items, nil
}

func (r *DurableRepository) CreateClaim(ctx context.Context, subject string, in port.ClaimRecord) (*port.ClaimRecord, error) {
	const query = `
		INSERT INTO warranty_claims (
		    warranty_id, subject, title, status, opened_at, amount_minor, evidence_note
		)
		SELECT $1, $2, $3, $4, $5, $6, $7
		WHERE EXISTS (SELECT 1 FROM vehicle_warranties WHERE id = $1 AND subject = $2)
		RETURNING ` + claimColumns
	var record port.ClaimRecord
	err := r.q.QueryRow(ctx, query,
		in.WarrantyID, subject, in.Title, in.Status, in.OpenedAt, in.AmountMinor, in.EvidenceNote,
	).Scan(
		&record.ID, &record.WarrantyID, &record.Title, &record.Status, &record.OpenedAt,
		&record.ClosedAt, &record.AmountMinor, &record.EvidenceNote, &record.CreatedAt, &record.UpdatedAt,
	)
	if err != nil {
		return nil, mapWriteError("create warranty claim", err)
	}
	return &record, nil
}

// ---------------------------------------------------------------------------
// 6. Retention governance
// ---------------------------------------------------------------------------

const retentionColumns = `id, dataset, retention_s, downsample_after_s,
	downsample_bucket_s, legal_hold, enabled, version, created_at, updated_at`

func (r *DurableRepository) ListRetentionPolicies(ctx context.Context, subject string) ([]port.RetentionPolicyRecord, error) {
	const query = `SELECT ` + retentionColumns + `
		FROM retention_policies WHERE subject = $1 ORDER BY dataset ASC`
	rows, err := r.q.Query(ctx, query, subject)
	if err != nil {
		return nil, fmt.Errorf("list retention policies: %w", err)
	}
	defer rows.Close()

	items := make([]port.RetentionPolicyRecord, 0)
	for rows.Next() {
		var record port.RetentionPolicyRecord
		if err := rows.Scan(
			&record.ID, &record.Dataset, &record.RetentionS, &record.DownsampleAfterS,
			&record.DownsampleBucketS, &record.LegalHold, &record.Enabled, &record.Version,
			&record.CreatedAt, &record.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan retention policy: %w", err)
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate retention policies: %w", err)
	}
	return items, nil
}

func (r *DurableRepository) UpsertRetentionPolicy(ctx context.Context, subject string, in port.RetentionPolicyRecord) (*port.RetentionPolicyRecord, error) {
	const query = `
		INSERT INTO retention_policies (
		    subject, dataset, retention_s, downsample_after_s,
		    downsample_bucket_s, legal_hold, enabled
		) VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (subject, dataset) DO UPDATE SET
		    retention_s = EXCLUDED.retention_s,
		    downsample_after_s = EXCLUDED.downsample_after_s,
		    downsample_bucket_s = EXCLUDED.downsample_bucket_s,
		    legal_hold = EXCLUDED.legal_hold,
		    enabled = EXCLUDED.enabled,
		    version = retention_policies.version + 1,
		    updated_at = now()
		RETURNING ` + retentionColumns
	var record port.RetentionPolicyRecord
	err := r.q.QueryRow(ctx, query,
		subject, in.Dataset, in.RetentionS, in.DownsampleAfterS,
		in.DownsampleBucketS, in.LegalHold, in.Enabled,
	).Scan(
		&record.ID, &record.Dataset, &record.RetentionS, &record.DownsampleAfterS,
		&record.DownsampleBucketS, &record.LegalHold, &record.Enabled, &record.Version,
		&record.CreatedAt, &record.UpdatedAt,
	)
	if err != nil {
		return nil, mapWriteError("upsert retention policy", err)
	}
	return &record, nil
}

func (r *DurableRepository) DeleteRetentionPolicy(ctx context.Context, subject string, id int64) error {
	tag, err := r.q.Exec(ctx, `DELETE FROM retention_policies WHERE subject = $1 AND id = $2`, subject, id)
	if err != nil {
		return mapWriteError("delete retention policy", err)
	}
	return affected(tag)
}

const runColumns = `id, dataset, mode, rows_scanned, rows_expiring,
	rows_downsampling, bytes_reclaimable, fidelity_loss_pct, blocked_by_hold, executed_at`

func (r *DurableRepository) RecordRuns(ctx context.Context, subject string, records []port.RetentionRunRecord) error {
	if len(records) == 0 {
		return nil
	}
	return r.withTx(ctx, func(tx database.DBTX) error {
		const query = `
			INSERT INTO retention_runs (
			    subject, dataset, mode, rows_scanned, rows_expiring, rows_downsampling,
			    bytes_reclaimable, fidelity_loss_pct, blocked_by_hold, executed_at
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
		for _, record := range records {
			if _, err := tx.Exec(ctx, query,
				subject, record.Dataset, record.Mode, record.RowsScanned, record.RowsExpiring,
				record.RowsDownsampling, record.BytesReclaimable, record.FidelityLossPct,
				record.BlockedByHold, record.ExecutedAt,
			); err != nil {
				return mapWriteError("insert retention run", err)
			}
		}
		return nil
	})
}

func (r *DurableRepository) ListRuns(ctx context.Context, subject string, limit, offset int) ([]port.RetentionRunRecord, int, error) {
	const query = `SELECT ` + runColumns + `, COUNT(*) OVER()::int
		FROM retention_runs WHERE subject = $1
		ORDER BY executed_at DESC, id DESC
		LIMIT $2 OFFSET $3`
	rows, err := r.q.Query(ctx, query, subject, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list retention runs: %w", err)
	}
	defer rows.Close()

	items := make([]port.RetentionRunRecord, 0)
	total := 0
	for rows.Next() {
		var record port.RetentionRunRecord
		if err := rows.Scan(
			&record.ID, &record.Dataset, &record.Mode, &record.RowsScanned, &record.RowsExpiring,
			&record.RowsDownsampling, &record.BytesReclaimable, &record.FidelityLossPct,
			&record.BlockedByHold, &record.ExecutedAt, &total,
		); err != nil {
			return nil, 0, fmt.Errorf("scan retention run: %w", err)
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate retention runs: %w", err)
	}
	return items, total, nil
}

// ---------------------------------------------------------------------------
// 7. Model trust
// ---------------------------------------------------------------------------

const predictionColumns = `id, vehicle_id, model_name, target, si_unit,
	predicted_at, horizon_s, predicted_value, predicted_low, predicted_high,
	reference, observed_value, observed_at, created_at`

func scanPrediction(row pgx.Row) (*port.PredictionRecord, error) {
	var record port.PredictionRecord
	if err := row.Scan(
		&record.ID, &record.VehicleID, &record.ModelName, &record.Target, &record.SIUnit,
		&record.PredictedAt, &record.HorizonS, &record.PredictedValue, &record.PredictedLow,
		&record.PredictedHigh, &record.Reference, &record.ObservedValue, &record.ObservedAt,
		&record.CreatedAt,
	); err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *DurableRepository) CreatePrediction(ctx context.Context, subject string, in port.PredictionRecord) (*port.PredictionRecord, error) {
	const query = `
		INSERT INTO model_predictions (
		    subject, vehicle_id, model_name, target, si_unit, predicted_at,
		    horizon_s, predicted_value, predicted_low, predicted_high, reference
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING ` + predictionColumns
	record, err := scanPrediction(r.q.QueryRow(ctx, query,
		subject, in.VehicleID, in.ModelName, in.Target, in.SIUnit, in.PredictedAt,
		in.HorizonS, in.PredictedValue, in.PredictedLow, in.PredictedHigh, in.Reference,
	))
	if err != nil {
		return nil, mapWriteError("create prediction", err)
	}
	return record, nil
}

func (r *DurableRepository) RecordOutcome(ctx context.Context, subject string, id int64, value float64, observedAt time.Time) (*port.PredictionRecord, error) {
	const query = `
		UPDATE model_predictions
		SET observed_value = $3, observed_at = $4
		WHERE subject = $1 AND id = $2
		RETURNING ` + predictionColumns
	record, err := scanPrediction(r.q.QueryRow(ctx, query, subject, id, value, observedAt))
	if err != nil {
		return nil, mapWriteError("record prediction outcome", err)
	}
	return record, nil
}

func (r *DurableRepository) ListPredictions(ctx context.Context, subject string, vehicleID int64, from, to time.Time) ([]port.PredictionRecord, error) {
	const query = `SELECT ` + predictionColumns + `
		FROM model_predictions
		WHERE subject = $1 AND vehicle_id = $2 AND predicted_at >= $3 AND predicted_at < $4
		ORDER BY predicted_at ASC, id ASC
		LIMIT 20000`
	rows, err := r.q.Query(ctx, query, subject, vehicleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("list predictions: %w", err)
	}
	defer rows.Close()

	items := make([]port.PredictionRecord, 0)
	for rows.Next() {
		var record port.PredictionRecord
		if err := rows.Scan(
			&record.ID, &record.VehicleID, &record.ModelName, &record.Target, &record.SIUnit,
			&record.PredictedAt, &record.HorizonS, &record.PredictedValue, &record.PredictedLow,
			&record.PredictedHigh, &record.Reference, &record.ObservedValue, &record.ObservedAt,
			&record.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan prediction: %w", err)
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate predictions: %w", err)
	}
	return items, nil
}

// ---------------------------------------------------------------------------
// 8. Jurisdictional compliance
// ---------------------------------------------------------------------------

const rateColumns = `id, jurisdiction_code, label, currency, road_usage_minor_per_m,
	registration_fee_minor, grid_intensity_g_per_wh, min_lat, max_lat, min_lng, max_lng,
	version, created_at, updated_at`

func (r *DurableRepository) ListRates(ctx context.Context, subject string) ([]port.JurisdictionRateRecord, error) {
	const query = `SELECT ` + rateColumns + `
		FROM jurisdiction_rates WHERE subject = $1 ORDER BY jurisdiction_code ASC`
	rows, err := r.q.Query(ctx, query, subject)
	if err != nil {
		return nil, fmt.Errorf("list jurisdiction rates: %w", err)
	}
	defer rows.Close()

	items := make([]port.JurisdictionRateRecord, 0)
	for rows.Next() {
		var record port.JurisdictionRateRecord
		if err := rows.Scan(
			&record.ID, &record.JurisdictionCode, &record.Label, &record.Currency,
			&record.RoadUsageMinorPerM, &record.RegistrationFeeMinor, &record.GridIntensityGPerWh,
			&record.MinLat, &record.MaxLat, &record.MinLng, &record.MaxLng,
			&record.Version, &record.CreatedAt, &record.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan jurisdiction rate: %w", err)
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate jurisdiction rates: %w", err)
	}
	return items, nil
}

func (r *DurableRepository) CreateRate(ctx context.Context, subject string, in port.JurisdictionRateRecord) (*port.JurisdictionRateRecord, error) {
	const query = `
		INSERT INTO jurisdiction_rates (
		    subject, jurisdiction_code, label, currency, road_usage_minor_per_m,
		    registration_fee_minor, grid_intensity_g_per_wh, min_lat, max_lat, min_lng, max_lng
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING ` + rateColumns
	var record port.JurisdictionRateRecord
	err := r.q.QueryRow(ctx, query,
		subject, in.JurisdictionCode, in.Label, in.Currency, in.RoadUsageMinorPerM,
		in.RegistrationFeeMinor, in.GridIntensityGPerWh, in.MinLat, in.MaxLat, in.MinLng, in.MaxLng,
	).Scan(
		&record.ID, &record.JurisdictionCode, &record.Label, &record.Currency,
		&record.RoadUsageMinorPerM, &record.RegistrationFeeMinor, &record.GridIntensityGPerWh,
		&record.MinLat, &record.MaxLat, &record.MinLng, &record.MaxLng,
		&record.Version, &record.CreatedAt, &record.UpdatedAt,
	)
	if err != nil {
		return nil, mapWriteError("create jurisdiction rate", err)
	}
	return &record, nil
}

func (r *DurableRepository) DeleteRate(ctx context.Context, subject string, id int64) error {
	tag, err := r.q.Exec(ctx, `DELETE FROM jurisdiction_rates WHERE subject = $1 AND id = $2`, subject, id)
	if err != nil {
		return mapWriteError("delete jurisdiction rate", err)
	}
	return affected(tag)
}

const filingColumns = `id, vehicle_id, period_start, period_end, status,
	total_distance_m, total_energy_wh, total_charge_minor, currency, digest, filed_at, created_at`

func (r *DurableRepository) ListFilings(ctx context.Context, subject string, vehicleID int64, limit, offset int) ([]port.FilingRecord, int, error) {
	const query = `SELECT ` + filingColumns + `, COUNT(*) OVER()::int
		FROM compliance_filings
		WHERE subject = $1 AND vehicle_id = $2
		ORDER BY period_end DESC, id DESC
		LIMIT $3 OFFSET $4`
	rows, err := r.q.Query(ctx, query, subject, vehicleID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list compliance filings: %w", err)
	}
	defer rows.Close()

	items := make([]port.FilingRecord, 0)
	total := 0
	for rows.Next() {
		var record port.FilingRecord
		if err := rows.Scan(
			&record.ID, &record.VehicleID, &record.PeriodStart, &record.PeriodEnd, &record.Status,
			&record.TotalDistanceM, &record.TotalEnergyWh, &record.TotalChargeMinor, &record.Currency,
			&record.Digest, &record.FiledAt, &record.CreatedAt, &total,
		); err != nil {
			return nil, 0, fmt.Errorf("scan compliance filing: %w", err)
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate compliance filings: %w", err)
	}
	return items, total, nil
}

func (r *DurableRepository) CreateFiling(ctx context.Context, subject string, in port.FilingRecord) (*port.FilingRecord, error) {
	const query = `
		INSERT INTO compliance_filings (
		    subject, vehicle_id, period_start, period_end, status, total_distance_m,
		    total_energy_wh, total_charge_minor, currency, digest, snapshot, filed_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING ` + filingColumns
	var record port.FilingRecord
	err := r.q.QueryRow(ctx, query,
		subject, in.VehicleID, in.PeriodStart, in.PeriodEnd, in.Status, in.TotalDistanceM,
		in.TotalEnergyWh, in.TotalChargeMinor, in.Currency, in.Digest, in.Snapshot, in.FiledAt,
	).Scan(
		&record.ID, &record.VehicleID, &record.PeriodStart, &record.PeriodEnd, &record.Status,
		&record.TotalDistanceM, &record.TotalEnergyWh, &record.TotalChargeMinor, &record.Currency,
		&record.Digest, &record.FiledAt, &record.CreatedAt,
	)
	if err != nil {
		return nil, mapWriteError("create compliance filing", err)
	}
	return &record, nil
}

// ---------------------------------------------------------------------------
// 9. Consumables
// ---------------------------------------------------------------------------

const itemColumns = `id, vehicle_id, category, label, position, installed_at,
	installed_odometer_m, rated_life_m, rated_life_s, cost_minor, currency,
	retired_at, notes, version, created_at, updated_at`

func (r *DurableRepository) ListItems(ctx context.Context, subject string, vehicleID int64) ([]port.ConsumableItemRecord, error) {
	const query = `SELECT ` + itemColumns + `
		FROM consumable_items
		WHERE subject = $1 AND vehicle_id = $2
		ORDER BY category ASC, position ASC, id ASC`
	rows, err := r.q.Query(ctx, query, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list consumable items: %w", err)
	}
	defer rows.Close()

	items := make([]port.ConsumableItemRecord, 0)
	for rows.Next() {
		var record port.ConsumableItemRecord
		if err := rows.Scan(
			&record.ID, &record.VehicleID, &record.Category, &record.Label, &record.Position,
			&record.InstalledAt, &record.InstalledOdometerM, &record.RatedLifeM, &record.RatedLifeS,
			&record.CostMinor, &record.Currency, &record.RetiredAt, &record.Notes, &record.Version,
			&record.CreatedAt, &record.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan consumable item: %w", err)
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate consumable items: %w", err)
	}
	return items, nil
}

func (r *DurableRepository) CreateItem(ctx context.Context, subject string, in port.ConsumableItemRecord) (*port.ConsumableItemRecord, error) {
	const query = `
		INSERT INTO consumable_items (
		    subject, vehicle_id, category, label, position, installed_at,
		    installed_odometer_m, rated_life_m, rated_life_s, cost_minor, currency, notes
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING ` + itemColumns
	var record port.ConsumableItemRecord
	err := r.q.QueryRow(ctx, query,
		subject, in.VehicleID, in.Category, in.Label, in.Position, in.InstalledAt,
		in.InstalledOdometerM, in.RatedLifeM, in.RatedLifeS, in.CostMinor, in.Currency, in.Notes,
	).Scan(
		&record.ID, &record.VehicleID, &record.Category, &record.Label, &record.Position,
		&record.InstalledAt, &record.InstalledOdometerM, &record.RatedLifeM, &record.RatedLifeS,
		&record.CostMinor, &record.Currency, &record.RetiredAt, &record.Notes, &record.Version,
		&record.CreatedAt, &record.UpdatedAt,
	)
	if err != nil {
		return nil, mapWriteError("create consumable item", err)
	}
	return &record, nil
}

func (r *DurableRepository) DeleteItem(ctx context.Context, subject string, id int64) error {
	tag, err := r.q.Exec(ctx, `DELETE FROM consumable_items WHERE subject = $1 AND id = $2`, subject, id)
	if err != nil {
		return mapWriteError("delete consumable item", err)
	}
	return affected(tag)
}

const eventColumns = `id, item_id, kind, occurred_at, odometer_m, cost_minor, note, created_at`

func (r *DurableRepository) ListEvents(ctx context.Context, subject string, vehicleID int64) ([]port.ConsumableEventRecord, error) {
	const query = `
		SELECT e.id, e.item_id, e.kind, e.occurred_at, e.odometer_m, e.cost_minor, e.note, e.created_at
		FROM consumable_events e
		JOIN consumable_items i ON i.id = e.item_id
		WHERE e.subject = $1 AND i.vehicle_id = $2
		ORDER BY e.occurred_at DESC, e.id DESC`
	rows, err := r.q.Query(ctx, query, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list consumable events: %w", err)
	}
	defer rows.Close()

	items := make([]port.ConsumableEventRecord, 0)
	for rows.Next() {
		var record port.ConsumableEventRecord
		if err := rows.Scan(
			&record.ID, &record.ItemID, &record.Kind, &record.OccurredAt,
			&record.OdometerM, &record.CostMinor, &record.Note, &record.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan consumable event: %w", err)
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate consumable events: %w", err)
	}
	return items, nil
}

func (r *DurableRepository) CreateEvent(ctx context.Context, subject string, in port.ConsumableEventRecord) (*port.ConsumableEventRecord, error) {
	const query = `
		INSERT INTO consumable_events (item_id, subject, kind, occurred_at, odometer_m, cost_minor, note)
		SELECT $1, $2, $3, $4, $5, $6, $7
		WHERE EXISTS (SELECT 1 FROM consumable_items WHERE id = $1 AND subject = $2)
		RETURNING ` + eventColumns
	var record port.ConsumableEventRecord
	err := r.q.QueryRow(ctx, query,
		in.ItemID, subject, in.Kind, in.OccurredAt, in.OdometerM, in.CostMinor, in.Note,
	).Scan(
		&record.ID, &record.ItemID, &record.Kind, &record.OccurredAt,
		&record.OdometerM, &record.CostMinor, &record.Note, &record.CreatedAt,
	)
	if err != nil {
		return nil, mapWriteError("create consumable event", err)
	}
	return &record, nil
}

// ---------------------------------------------------------------------------
// 10. Subscriptions
// ---------------------------------------------------------------------------

const subscriptionColumns = `id, vehicle_id, name, kind, billing_period, price_minor,
	currency, usage_metric, benchmark_minor_per_unit, started_at, ended_at,
	version, created_at, updated_at`

func (r *DurableRepository) ListSubscriptions(ctx context.Context, subject string, vehicleID int64) ([]port.SubscriptionRecord, error) {
	const query = `SELECT ` + subscriptionColumns + `
		FROM vehicle_subscriptions
		WHERE subject = $1 AND vehicle_id = $2
		ORDER BY started_at DESC, id DESC`
	rows, err := r.q.Query(ctx, query, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list subscriptions: %w", err)
	}
	defer rows.Close()

	items := make([]port.SubscriptionRecord, 0)
	for rows.Next() {
		var record port.SubscriptionRecord
		if err := rows.Scan(
			&record.ID, &record.VehicleID, &record.Name, &record.Kind, &record.BillingPeriod,
			&record.PriceMinor, &record.Currency, &record.UsageMetric, &record.BenchmarkMinorPerUnit,
			&record.StartedAt, &record.EndedAt, &record.Version, &record.CreatedAt, &record.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan subscription: %w", err)
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate subscriptions: %w", err)
	}
	return items, nil
}

func (r *DurableRepository) CreateSubscription(ctx context.Context, subject string, in port.SubscriptionRecord) (*port.SubscriptionRecord, error) {
	const query = `
		INSERT INTO vehicle_subscriptions (
		    subject, vehicle_id, name, kind, billing_period, price_minor, currency,
		    usage_metric, benchmark_minor_per_unit, started_at, ended_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING ` + subscriptionColumns
	var record port.SubscriptionRecord
	err := r.q.QueryRow(ctx, query,
		subject, in.VehicleID, in.Name, in.Kind, in.BillingPeriod, in.PriceMinor, in.Currency,
		in.UsageMetric, in.BenchmarkMinorPerUnit, in.StartedAt, in.EndedAt,
	).Scan(
		&record.ID, &record.VehicleID, &record.Name, &record.Kind, &record.BillingPeriod,
		&record.PriceMinor, &record.Currency, &record.UsageMetric, &record.BenchmarkMinorPerUnit,
		&record.StartedAt, &record.EndedAt, &record.Version, &record.CreatedAt, &record.UpdatedAt,
	)
	if err != nil {
		return nil, mapWriteError("create subscription", err)
	}
	return &record, nil
}

func (r *DurableRepository) DeleteSubscription(ctx context.Context, subject string, id int64) error {
	tag, err := r.q.Exec(ctx, `DELETE FROM vehicle_subscriptions WHERE subject = $1 AND id = $2`, subject, id)
	if err != nil {
		return mapWriteError("delete subscription", err)
	}
	return affected(tag)
}

var (
	_ port.SourceRepository  = (*SourceRepository)(nil)
	_ port.DurableRepository = (*DurableRepository)(nil)
)
