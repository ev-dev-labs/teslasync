package tesla

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

// TeslaUserOrderRepo provides data access for Tesla user order records.
type TeslaUserOrderRepo struct {
	pool teslaPool
}

// NewTeslaUserOrderRepo creates a new repository.
func NewTeslaUserOrderRepo(db *database.DB) *TeslaUserOrderRepo {
	return &TeslaUserOrderRepo{pool: db.Pool}
}

// GetAll returns all stored Tesla orders ordered by most recently updated first.
func (r *TeslaUserOrderRepo) GetAll(ctx context.Context) ([]*teslamodel.TeslaUserOrder, error) {
	query := `SELECT id, order_id, model, status, delivery_date, vin, referral_code,
		is_upgradable, fetched_at, created_at, updated_at
		FROM tesla_user_orders ORDER BY updated_at DESC`
	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query tesla_user_orders: %w", err)
	}
	defer rows.Close()

	var results []*teslamodel.TeslaUserOrder
	for rows.Next() {
		o := &teslamodel.TeslaUserOrder{}
		if err := rows.Scan(&o.ID, &o.OrderID, &o.Model, &o.Status, &o.DeliveryDate,
			&o.VIN, &o.ReferralCode, &o.IsUpgradable,
			&o.FetchedAt, &o.CreatedAt, &o.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan tesla_user_order: %w", err)
		}
		results = append(results, o)
	}
	return results, rows.Err()
}

// ReplaceAll deletes all existing orders and inserts the new set (full sync).
func (r *TeslaUserOrderRepo) ReplaceAll(ctx context.Context, orders []*teslamodel.TeslaUserOrder) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err = tx.Exec(ctx, `DELETE FROM tesla_user_orders`); err != nil {
		return fmt.Errorf("delete tesla_user_orders: %w", err)
	}

	now := time.Now().UTC()
	for i, o := range orders {
		if o == nil {
			return fmt.Errorf("insert tesla_user_order: nil order at index %d", i)
		}
		_, err = tx.Exec(ctx, `INSERT INTO tesla_user_orders
			(order_id, model, status, delivery_date, vin, referral_code, is_upgradable, fetched_at, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8)`,
			o.OrderID, o.Model, o.Status, o.DeliveryDate, o.VIN,
			o.ReferralCode, o.IsUpgradable, now)
		if err != nil {
			return fmt.Errorf("insert tesla_user_order %s: %w", o.OrderID, err)
		}
	}
	return tx.Commit(ctx)
}
