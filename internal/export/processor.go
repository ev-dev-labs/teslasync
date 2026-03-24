package export

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// Processor generates export files from database data.
type Processor struct {
	vehicleRepo  *database.VehicleRepo
	driveRepo    *database.DriveRepo
	chargingRepo *database.ChargingRepo
	db           *database.DB
}

// NewProcessor creates an export processor with required repositories.
func NewProcessor(db *database.DB) *Processor {
	return &Processor{
		vehicleRepo:  database.NewVehicleRepo(db),
		driveRepo:    database.NewDriveRepo(db),
		chargingRepo: database.NewChargingRepo(db),
		db:           db,
	}
}

// ProcessResult holds the output of a processed export job.
type ProcessResult struct {
	FileName    string
	Data        []byte
	RecordCount int
}

// Process executes the export job and returns the generated file.
func (p *Processor) Process(ctx context.Context, req *models.ExportJobRequest) (*ProcessResult, error) {
	switch req.Type {
	case string(TypeDrives):
		return p.processDrives(ctx, req)
	case string(TypeCharging):
		return p.processCharging(ctx, req)
	case string(TypeBackup):
		return p.processBackup(ctx, req)
	default:
		return nil, fmt.Errorf("unsupported export type: %s", req.Type)
	}
}

func (p *Processor) processDrives(ctx context.Context, req *models.ExportJobRequest) (*ProcessResult, error) {
	vehicles, err := p.vehicleRepo.GetAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("fetch vehicles: %w", err)
	}

	type exportDrive struct {
		ID        int64   `json:"id"`
		VehicleID int64   `json:"vehicle_id"`
		StartDate string  `json:"start_date"`
		EndDate   string  `json:"end_date"`
		Distance  float64 `json:"distance"`
		Duration  float64 `json:"duration_min"`
		SpeedMax  float64 `json:"speed_max"`
	}

	var startTime, endTime time.Time
	if req.StartDate != nil {
		startTime = *req.StartDate
	}
	if req.EndDate != nil {
		endTime = *req.EndDate
	}

	var allDrives []exportDrive
	for _, v := range vehicles {
		if req.VehicleID != nil && v.ID != *req.VehicleID {
			continue
		}
		offset := 0
		for {
			drives, err := p.driveRepo.GetByVehicle(ctx, v.ID, 500, offset, startTime, endTime)
			if err != nil {
				log.Warn().Err(err).Int64("vehicle_id", v.ID).Msg("export: failed to fetch drives")
				break
			}
			if len(drives) == 0 {
				break
			}
			for _, d := range drives {
				ed := exportDrive{
					ID:        d.ID,
					VehicleID: d.VehicleID,
					StartDate: d.StartDate.Format("2006-01-02T15:04:05Z"),
					Distance:  d.Distance,
					Duration:  d.DurationMin,
					SpeedMax:  ptrFloat(d.SpeedMax),
				}
				if d.EndDate != nil {
					ed.EndDate = d.EndDate.Format("2006-01-02T15:04:05Z")
				}
				allDrives = append(allDrives, ed)
			}
			offset += len(drives)
			if len(drives) < 500 {
				break
			}
		}
	}

	var buf bytes.Buffer
	ext := req.Format
	if req.Format == "json" {
		if err := json.NewEncoder(&buf).Encode(allDrives); err != nil {
			return nil, fmt.Errorf("encode json: %w", err)
		}
	} else {
		ext = "csv"
		cw := csv.NewWriter(&buf)
		_ = cw.Write([]string{"id", "vehicle_id", "start_date", "end_date", "distance", "duration_min", "speed_max"})
		for _, d := range allDrives {
			_ = cw.Write([]string{
				strconv.FormatInt(d.ID, 10),
				strconv.FormatInt(d.VehicleID, 10),
				d.StartDate,
				d.EndDate,
				fmt.Sprintf("%.2f", d.Distance),
				fmt.Sprintf("%.1f", d.Duration),
				fmt.Sprintf("%.1f", d.SpeedMax),
			})
		}
		cw.Flush()
	}

	return &ProcessResult{
		FileName:    fmt.Sprintf("teslasync-drives.%s", ext),
		Data:        buf.Bytes(),
		RecordCount: len(allDrives),
	}, nil
}

func (p *Processor) processCharging(ctx context.Context, req *models.ExportJobRequest) (*ProcessResult, error) {
	vehicles, err := p.vehicleRepo.GetAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("fetch vehicles: %w", err)
	}

	type exportSession struct {
		ID           int64   `json:"id"`
		VehicleID    int64   `json:"vehicle_id"`
		StartDate    string  `json:"start_date"`
		EndDate      string  `json:"end_date"`
		EnergyAdded  float64 `json:"energy_added_kwh"`
		StartBattery int     `json:"start_battery"`
		EndBattery   int     `json:"end_battery"`
		ChargerPower float64 `json:"charger_power"`
		Duration     float64 `json:"duration_min"`
	}

	var startTime, endTime time.Time
	if req.StartDate != nil {
		startTime = *req.StartDate
	}
	if req.EndDate != nil {
		endTime = *req.EndDate
	}

	var allSessions []exportSession
	for _, v := range vehicles {
		if req.VehicleID != nil && v.ID != *req.VehicleID {
			continue
		}
		offset := 0
		for {
			sessions, err := p.chargingRepo.GetByVehicle(ctx, v.ID, 500, offset, startTime, endTime)
			if err != nil {
				log.Warn().Err(err).Int64("vehicle_id", v.ID).Msg("export: failed to fetch charging")
				break
			}
			if len(sessions) == 0 {
				break
			}
			for _, s := range sessions {
				es := exportSession{
					ID:           s.ID,
					VehicleID:    s.VehicleID,
					StartDate:    s.StartDate.Format("2006-01-02T15:04:05Z"),
					EnergyAdded:  s.ChargeEnergyAdded,
					StartBattery: s.StartBatteryLevel,
					EndBattery:   ptrInt(s.EndBatteryLevel),
					ChargerPower: ptrFloat(s.ChargerPower),
					Duration:     s.DurationMin,
				}
				if s.EndDate != nil {
					es.EndDate = s.EndDate.Format("2006-01-02T15:04:05Z")
				}
				allSessions = append(allSessions, es)
			}
			offset += len(sessions)
			if len(sessions) < 500 {
				break
			}
		}
	}

	var buf bytes.Buffer
	ext := req.Format
	if req.Format == "json" {
		if err := json.NewEncoder(&buf).Encode(allSessions); err != nil {
			return nil, fmt.Errorf("encode json: %w", err)
		}
	} else {
		ext = "csv"
		cw := csv.NewWriter(&buf)
		_ = cw.Write([]string{"id", "vehicle_id", "start_date", "end_date", "energy_added_kwh", "start_battery", "end_battery", "charger_power", "duration_min"})
		for _, s := range allSessions {
			_ = cw.Write([]string{
				strconv.FormatInt(s.ID, 10),
				strconv.FormatInt(s.VehicleID, 10),
				s.StartDate,
				s.EndDate,
				fmt.Sprintf("%.2f", s.EnergyAdded),
				strconv.Itoa(s.StartBattery),
				strconv.Itoa(s.EndBattery),
				fmt.Sprintf("%.1f", s.ChargerPower),
				fmt.Sprintf("%.1f", s.Duration),
			})
		}
		cw.Flush()
	}

	return &ProcessResult{
		FileName:    fmt.Sprintf("teslasync-charging.%s", ext),
		Data:        buf.Bytes(),
		RecordCount: len(allSessions),
	}, nil
}

// allowedBackupTables mirrors the whitelist from the backup handler.
var allowedBackupTables = map[string]bool{
	"vehicles": true, "drives": true, "charging_sessions": true,
	"positions": true, "addresses": true, "geofences": true,
	"alerts": true, "alert_rules": true, "settings": true,
	"daily_mileage": true, "vehicle_states": true, "software_updates": true,
	"tire_pressure_snapshots": true, "vampire_drain_events": true,
	"visited_locations": true, "trips": true,
}

func (p *Processor) processBackup(ctx context.Context, req *models.ExportJobRequest) (*ProcessResult, error) {
	backup := make(map[string]interface{})
	totalRecords := 0

	for table := range allowedBackupTables {
		rows, err := p.db.Pool.Query(ctx, fmt.Sprintf(`SELECT row_to_json(t) FROM "%s" t`, table))
		if err != nil {
			log.Warn().Err(err).Str("table", table).Msg("export backup: failed to export table")
			continue
		}

		var records []json.RawMessage
		for rows.Next() {
			var raw json.RawMessage
			if err := rows.Scan(&raw); err == nil {
				records = append(records, raw)
			}
		}
		rows.Close()

		if records == nil {
			records = []json.RawMessage{}
		}
		backup[table] = records
		totalRecords += len(records)
	}

	backup["_meta"] = map[string]interface{}{
		"exported_at": time.Now(),
		"version":     "1.0.0",
		"tables":      len(allowedBackupTables),
	}

	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(backup); err != nil {
		return nil, fmt.Errorf("encode backup: %w", err)
	}

	return &ProcessResult{
		FileName:    fmt.Sprintf("teslasync-backup-%s.json", time.Now().Format("2006-01-02")),
		Data:        buf.Bytes(),
		RecordCount: totalRecords,
	}, nil
}

func ptrFloat(p *float64) float64 {
	if p != nil {
		return *p
	}
	return 0
}

func ptrInt(p *int) int {
	if p != nil {
		return *p
	}
	return 0
}
