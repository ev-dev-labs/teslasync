package physicssvc

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	"github.com/ev-dev-labs/teslasync/internal/domain"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	"github.com/ev-dev-labs/teslasync/internal/physics"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const maxLedgerRows = 4096
const maxMarkers = 200

type chargeReader interface {
	GetByID(context.Context, int64) (*chargingmodel.ChargingSession, error)
	GetByVehicle(context.Context, int64, int, int, time.Time, time.Time) ([]*chargingmodel.ChargingSession, error)
}
type driveReader interface {
	GetByID(context.Context, int64) (*drivemodel.Drive, error)
	GetByVehicle(context.Context, int64, int, int, time.Time, time.Time) ([]*drivemodel.Drive, error)
}
type Service struct {
	state   signal.StateReader
	charges chargeReader
	drives  driveReader
	params  func() physics.Params
}

func New(db *database.DB, state signal.StateReader, cfg *config.Config) *Service {
	return &Service{state: state, charges: chargingdb.NewChargingRepo(db), drives: drivedb.NewDriveRepo(db), params: paramsFromConfig(cfg)}
}

func paramsFromConfig(cfg *config.Config) func() physics.Params {
	return func() physics.Params {
		p := physics.DefaultParams()
		if cfg == nil {
			return p
		}
		if cfg.Physics.MassKg != nil {
			p.MassKg, p.MassSource = cfg.Physics.MassKg, physics.ParamConfigured
		}
		if cfg.Physics.CdAM2 != nil {
			p.CdAM2, p.CdASource = *cfg.Physics.CdAM2, physics.ParamConfigured
		}
		if cfg.Physics.Crr != nil {
			p.Crr, p.CrrSource = *cfg.Physics.Crr, physics.ParamConfigured
		}
		return p
	}
}

func (s *Service) Window(ctx context.Context, vehicleID int64, kind string, from, to time.Time) (*physics.Ledger, error) {
	ledger, err := s.solve(ctx, vehicleID, kind, from, to, nil, nil)
	if err != nil {
		return nil, err
	}
	if kind == "range" {
		ledger.Markers, err = s.markers(ctx, vehicleID, from, to)
		if err != nil {
			return nil, err
		}
	}
	return ledger, nil
}

func (s *Service) Drive(ctx context.Context, id int64) (*physics.Ledger, error) {
	d, err := s.drives.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("load drive: %w", err)
	}
	if d == nil {
		return nil, fmt.Errorf("drive: %w", domain.ErrNotFound)
	}
	to := time.Now().UTC()
	if d.EndTs != nil {
		to = d.EndTs.UTC()
	}
	ledger, err := s.solve(ctx, d.VehicleID, "drive", d.StartTs, to, d.EnergyUsedWh, &d.DistanceM)
	if err != nil {
		return nil, err
	}
	ledger.Markers = append(ledger.Markers, physics.Marker{At: d.StartTs, Kind: "drive", ID: id, Edge: "start"})
	if d.EndTs != nil {
		ledger.Markers = append(ledger.Markers, physics.Marker{At: *d.EndTs, Kind: "drive", ID: id, Edge: "end"})
	}
	return ledger, nil
}

func (s *Service) Charge(ctx context.Context, id int64) (*physics.Ledger, error) {
	c, err := s.charges.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("load charge: %w", err)
	}
	if c == nil {
		return nil, fmt.Errorf("charge: %w", domain.ErrNotFound)
	}
	to := time.Now().UTC()
	if c.EndedAt != nil {
		to = c.EndedAt.UTC()
	}
	ledger, err := s.solve(ctx, c.VehicleID, "charge", c.StartedAt, to, c.TotalEnergyAddedWh, nil)
	if err != nil {
		return nil, err
	}
	ledger.Markers = append(ledger.Markers, physics.Marker{At: c.StartedAt, Kind: "charge", ID: id, Edge: "start"})
	if c.EndedAt != nil {
		ledger.Markers = append(ledger.Markers, physics.Marker{At: *c.EndedAt, Kind: "charge", ID: id, Edge: "end"})
	}
	return ledger, nil
}

func (s *Service) solve(ctx context.Context, id int64, kind string, from, to time.Time, energy, distance *float64) (*physics.Ledger, error) {
	if id <= 0 || from.IsZero() || !to.After(from) || to.Sub(from) > 366*24*time.Hour {
		return nil, fmt.Errorf("invalid physics window: %w", domain.ErrValidation)
	}
	rows, err := s.state.Timeline(ctx, id, ledgerFields(), from, to, signal.TimelineOptions{MaxRows: maxLedgerRows + 1})
	if err != nil {
		return nil, fmt.Errorf("load physics timeline: %w", err)
	}
	truncated := len(rows) > maxLedgerRows
	if truncated {
		rows = rows[:maxLedgerRows]
	}
	ledger := physics.Solve(physics.Window{VehicleID: id, Kind: kind, Start: from, End: to, Samples: samplesFromTimeline(rows), Params: s.params(), SessionEnergyWh: energy, SessionDistanceM: distance})
	ledger.Truncated = truncated
	ledger.Markers = []physics.Marker{}
	return ledger, nil
}

func (s *Service) markers(ctx context.Context, id int64, from, to time.Time) ([]physics.Marker, error) {
	ds, err := s.drives.GetByVehicle(ctx, id, maxMarkers, 0, from, to)
	if err != nil {
		return nil, fmt.Errorf("load drive markers: %w", err)
	}
	cs, err := s.charges.GetByVehicle(ctx, id, maxMarkers, 0, from, to)
	if err != nil {
		return nil, fmt.Errorf("load charge markers: %w", err)
	}
	out := []physics.Marker{}
	add := func(at time.Time, kind string, id int64, edge string) {
		if !at.Before(from) && !at.After(to) {
			out = append(out, physics.Marker{At: at.UTC(), Kind: kind, ID: id, Edge: edge})
		}
	}
	for _, d := range ds {
		if d == nil {
			continue
		}
		add(d.StartTs, "drive", d.ID, "start")
		if d.EndTs != nil {
			add(*d.EndTs, "drive", d.ID, "end")
		}
	}
	for _, c := range cs {
		if c == nil {
			continue
		}
		add(c.StartedAt, "charge", c.ID, "start")
		if c.EndedAt != nil {
			add(*c.EndedAt, "charge", c.ID, "end")
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out, nil
}
