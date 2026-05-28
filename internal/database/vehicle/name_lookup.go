package vehicle

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/database/settings"
)

// nameLookupAdapter adapts the production *VehicleRepo to the
// settings.VehicleNameLookup seam without exposing the full repo
// surface to the resolver. The router wires this adapter at
// construction time.
type nameLookupAdapter struct {
	repo *VehicleRepo
}

// NewNameLookup returns a settings.VehicleNameLookup backed by the
// supplied *VehicleRepo. Returns nil when repo is nil so the caller
// can pass it straight into NewVehicleSettingsResolver and rely on
// the resolver's nil-tolerance.
func NewNameLookup(repo *VehicleRepo) settings.VehicleNameLookup {
	if repo == nil {
		return nil
	}
	return &nameLookupAdapter{repo: repo}
}

// GetDisplayName satisfies settings.VehicleNameLookup. Maps a missing
// vehicle to (("", false, nil)) so the resolver short-circuits to the
// default — the API handler is the right place to surface 404 if the
// vehicle truly doesn't exist; the resolver itself stays fault-
// tolerant so a stale cache reference doesn't fail the bulk resolve.
func (a *nameLookupAdapter) GetDisplayName(ctx context.Context, vehicleID int64) (string, bool, error) {
	v, err := a.repo.GetByID(ctx, vehicleID)
	if err != nil {
		return "", false, err
	}
	if v == nil {
		return "", false, nil
	}
	return v.DisplayName, true, nil
}
