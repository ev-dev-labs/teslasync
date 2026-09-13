package nextcharge

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/api/teslachargehist"
	"github.com/ev-dev-labs/teslasync/internal/database"
	tesladb "github.com/ev-dev-labs/teslasync/internal/database/tesla"
)

// VINFinder resolves a vehicle row to its Tesla VIN.
type VINFinder interface {
	VIN(ctx context.Context, vehicleID int64) (string, error)
}

// QuoteFinder returns the cheapest billed Supercharger site for a VIN.
type QuoteFinder interface {
	Cheapest(ctx context.Context, vin string) (*Quote, error)
}

type pgVIN struct {
	pool interface {
		QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	}
}

func (p pgVIN) VIN(ctx context.Context, vehicleID int64) (string, error) {
	if p.pool == nil {
		return "", nil
	}
	var vin string
	err := p.pool.QueryRow(ctx, `SELECT vin FROM vehicles WHERE id = $1`, vehicleID).Scan(&vin)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("lookup vehicle vin: %w", err)
	}
	return vin, nil
}

type billedQuotes struct {
	repo *tesladb.TeslaChargingHistoryRepo
}

func (b billedQuotes) Cheapest(ctx context.Context, vin string) (*Quote, error) {
	if b.repo == nil || vin == "" {
		return nil, nil
	}
	entries, err := b.repo.GetAll(ctx, vin, 2000, 0)
	if err != nil {
		return nil, fmt.Errorf("list tesla charging history: %w", err)
	}
	ranking := teslachargehist.RankSites(entries)
	if len(ranking.Sites) == 0 {
		return nil, nil
	}
	s := ranking.Sites[0]
	return &Quote{Site: s.Site, AvgPerKWh: s.AvgPerKWh}, nil
}

func newFinders(db *database.DB) (VINFinder, QuoteFinder) {
	if db == nil || db.Pool == nil {
		return nil, nil
	}
	return pgVIN{pool: db.Pool}, billedQuotes{repo: tesladb.NewTeslaChargingHistoryRepo(db)}
}
