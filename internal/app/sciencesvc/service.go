package sciencesvc

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/domain"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/physics"
	apiscience "github.com/ev-dev-labs/teslasync/internal/science"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const maxScienceRows = 4096
const maxScienceSessions = 500

type chargeReader interface {
	GetByID(context.Context, int64) (*chargingmodel.ChargingSession, error)
	GetByVehicle(context.Context, int64, int, int, time.Time, time.Time) ([]*chargingmodel.ChargingSession, error)
}
type driveReader interface {
	GetByVehicle(context.Context, int64, int, int, time.Time, time.Time) ([]*drivemodel.Drive, error)
}
type vehicleReader interface {
	GetByID(context.Context, int64) (*vehiclemodel.Vehicle, error)
}
type Service struct {
	state    signal.StateReader
	charges  chargeReader
	drives   driveReader
	vehicles vehicleReader
	meteo    HistoryFetcher
	params   func() physics.Params
	tireKpa  *float64
}

func New(db *database.DB, state signal.StateReader, cfg *config.Config, fetch HistoryFetcher) *Service {
	s := &Service{state: state, charges: chargingdb.NewChargingRepo(db), drives: drivedb.NewDriveRepo(db),
		vehicles: vehicledb.NewVehicleRepo(db), params: paramsFromConfig(cfg)}
	if cfg != nil {
		s.tireKpa = cfg.Physics.TireRecommendedKpa
		if cfg.Physics.WeatherEnabled {
			s.meteo = fetch
		}
	}
	return s
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

func (s *Service) Report(ctx context.Context, kind string, id int64, from, to time.Time) (any, error) {
	if id <= 0 || from.IsZero() || !to.After(from) || to.Sub(from) > 30*24*time.Hour {
		return nil, fmt.Errorf("invalid science window: %w", domain.ErrValidation)
	}
	var fields []signal.FieldMapping
	switch kind {
	case "electrochem":
		fields = electrochemFields()
	case "thermal":
		fields = thermalFields()
	case "weather":
		fields = driveResidualFields()
	case "tires":
		fields = tireFields()
	case "notebook":
		seen := map[string]bool{}
		for _, group := range [][]signal.FieldMapping{electrochemFields(), thermalFields(), tireFields(), driveResidualFields()} {
			for _, f := range group {
				if !seen[f.Field] {
					fields = append(fields, f)
					seen[f.Field] = true
				}
			}
		}
	default:
		return nil, fmt.Errorf("unknown science domain: %w", domain.ErrValidation)
	}
	samples, truncated, err := s.timeline(ctx, id, fields, from, to)
	if err != nil {
		return nil, err
	}
	var charges []*chargingmodel.ChargingSession
	var drives []*drivemodel.Drive
	vin := ""
	if kind == "electrochem" || kind == "notebook" {
		v, err := s.vehicles.GetByID(ctx, id)
		if err != nil {
			return nil, fmt.Errorf("load science vehicle: %w", err)
		}
		if v == nil {
			return nil, fmt.Errorf("vehicle: %w", domain.ErrNotFound)
		}
		vin = v.VIN
		charges, err = s.charges.GetByVehicle(ctx, id, maxScienceSessions+1, 0, from, to)
		if err != nil {
			return nil, fmt.Errorf("load science charges: %w", err)
		}
		if len(charges) > maxScienceSessions {
			charges = charges[:maxScienceSessions]
			truncated = true
		}
	}
	if kind == "weather" || kind == "notebook" {
		drives, err = s.drives.GetByVehicle(ctx, id, maxScienceSessions+1, 0, from, to)
		if err != nil {
			return nil, fmt.Errorf("load science drives: %w", err)
		}
		if len(drives) > maxScienceSessions {
			drives = drives[:maxScienceSessions]
			truncated = true
		}
	}
	electrochem := func() apiscience.ElectrochemReport {
		return buildElectrochem(id, vin, from, to, samples, charges, truncated)
	}
	thermal := func() apiscience.ThermalReport { return buildThermal(id, from, to, samples, truncated) }
	weather := func() apiscience.WeatherReport {
		report := buildWeather(ctx, id, from, to, samples, drives, s.params(), s.meteo)
		if truncated {
			report.Missing = append(report.Missing, "sample_or_session_cap_hit")
		}
		return report
	}
	tires := func() apiscience.TireReport {
		twin := physics.Solve(physics.Window{VehicleID: id, Kind: "range", Start: from, End: to, Samples: samples, Params: s.params()})
		return buildTires(id, from, to, samples, s.tireKpa, twin, truncated)
	}
	switch kind {
	case "electrochem":
		return electrochem(), nil
	case "thermal":
		return thermal(), nil
	case "weather":
		return weather(), nil
	case "tires":
		return tires(), nil
	default:
		return buildNotebook(id, vin, from, to, notebookInputs{Electrochem: electrochem(), Thermal: thermal(), Weather: weather(), Tires: tires()}), nil
	}
}

func (s *Service) ChargeIR(ctx context.Context, id int64) (apiscience.ChargeIRReport, error) {
	rep := apiscience.ChargeIRReport{}
	c, err := s.charges.GetByID(ctx, id)
	if err != nil {
		return rep, fmt.Errorf("load science charging session: %w", err)
	}
	if c == nil {
		return rep, fmt.Errorf("charging session: %w", domain.ErrNotFound)
	}
	to := time.Now().UTC()
	if c.EndedAt != nil {
		to = c.EndedAt.UTC()
	}
	if !to.After(c.StartedAt) || to.Sub(c.StartedAt) > 366*24*time.Hour {
		return rep, fmt.Errorf("invalid charging window: %w", domain.ErrValidation)
	}
	samples, truncated, err := s.timeline(ctx, c.VehicleID, electrochemFields(), c.StartedAt, to)
	if err != nil {
		return rep, err
	}
	rep = apiscience.ChargeIRReport{SessionID: id, VehicleID: c.VehicleID, Points: apiscience.DCIR(samples, "charge_step"),
		SignalsUsed: []string{"PackVoltage", "PackCurrent", "Soc", "ModuleTempMax"},
		Missing:     []string{"asynchronous_voltage_current_excluded_from_dcir"}, Honesty: apiscience.ElectrochemHonesty}
	if truncated {
		rep.Missing = append(rep.Missing, "sample_cap_hit")
	}
	return rep, nil
}

func (s *Service) timeline(ctx context.Context, id int64, fields []signal.FieldMapping, from, to time.Time) ([]physics.Sample, bool, error) {
	rows, err := s.state.Timeline(ctx, id, fields, from, to, signal.TimelineOptions{MaxRows: maxScienceRows + 1})
	if err != nil {
		return nil, false, fmt.Errorf("load science timeline: %w", err)
	}
	truncated := len(rows) > maxScienceRows
	if truncated {
		rows = rows[:maxScienceRows]
	}
	return samplesFromTimeline(rows), truncated, nil
}
