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
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	tripdb "github.com/ev-dev-labs/teslasync/internal/database/trip"
)

// Processor generates export files from database data.
type Processor struct {
	vehicleRepo  *database.VehicleRepo
	driveRepo    *drivedb.DriveRepo
	chargingRepo *chargingdb.ChargingRepo
	tripRepo     *tripdb.TripRepo
	db           *database.DB
}

// NewProcessor creates an export processor with required repositories.
func NewProcessor(db *database.DB) *Processor {
	return &Processor{
		vehicleRepo:  database.NewVehicleRepo(db),
		driveRepo:    drivedb.NewDriveRepo(db),
		chargingRepo: chargingdb.NewChargingRepo(db),
		tripRepo:     tripdb.NewTripRepo(db),
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
func (p *Processor) Process(ctx context.Context, req *JobRequest) (*ProcessResult, error) {
	switch req.Type {
	case string(TypeDrives):
		return p.processDrives(ctx, req)
	case string(TypeCharging):
		return p.processCharging(ctx, req)
	case string(TypeTrips):
		return p.processTrips(ctx, req)
	case string(TypeBackup):
		return p.processBackup(ctx, req)
	case string(TypeAnalytics):
		return p.processAnalytics(ctx, req)
	case string(TypeImportDrives):
		return p.processImportDrives(ctx, req)
	case string(TypeImportCharging):
		return p.processImportCharging(ctx, req)
	case string(TypeAccount):
		return p.processAccount(ctx, req)
	default:
		return nil, fmt.Errorf("unsupported export type: %s", req.Type)
	}
}

// driveRow is the canonical in-memory shape for a single drive row in the
// drives export. Lifted to package scope so cellLookup helpers can be
// pure functions instead of closures over inline anonymous structs.
type driveRow struct {
	ID          int64   `json:"id"`
	VehicleID   int64   `json:"vehicle_id"`
	StartDate   string  `json:"start_date"`
	EndDate     string  `json:"end_date"`
	DistanceM   float64 `json:"distance_m"`
	DurationS   float64 `json:"duration_s"`
	MaxSpeedMps float64 `json:"max_speed_mps"`
}

type tripRow struct {
	ID             int64   `json:"id"`
	VehicleID      int64   `json:"vehicle_id"`
	Name           string  `json:"name"`
	StartedAt      string  `json:"started_at"`
	EndedAt        string  `json:"ended_at"`
	TotalDistanceM float64 `json:"total_distance_m"`
	TotalEnergyWh  float64 `json:"total_energy_wh"`
	TotalDurationS int64   `json:"total_duration_s"`
	DriveCount     int64   `json:"drive_count"`
	ChargeCount    int64   `json:"charge_count"`
	TotalCost      float64 `json:"total_cost"`
}

// chargingRow is the canonical in-memory shape for a single charging
// session row in the charging export. Lifted to package scope for the
// same reason as driveRow.
type chargingRow struct {
	ID          int64   `json:"id"`
	VehicleID   int64   `json:"vehicle_id"`
	StartedAt   string  `json:"started_at"`
	EndedAt     string  `json:"ended_at"`
	EnergyAdded float64 `json:"total_energy_added_wh"`
	StartSocPct float64 `json:"start_soc_pct"`
	EndSocPct   float64 `json:"end_soc_pct"`
	PeakPowerW  float64 `json:"peak_power_w"`
	DurationS   float64 `json:"duration_s"`
}

func (p *Processor) processDrives(ctx context.Context, req *JobRequest) (*ProcessResult, error) {
	cols, err := resolveColumnSelection(string(TypeDrives), req.Columns)
	if err != nil {
		return nil, err
	}

	vehicles, err := p.vehicleRepo.GetAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("fetch vehicles: %w", err)
	}

	var startTime, endTime time.Time
	if req.StartDate != nil {
		startTime = *req.StartDate
	}
	if req.EndDate != nil {
		endTime = *req.EndDate
	}

	var allDrives []driveRow
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
				ed := driveRow{
					ID:          d.ID,
					VehicleID:   d.VehicleID,
					StartDate:   d.StartTs.Format("2006-01-02T15:04:05Z"),
					DistanceM:   d.DistanceM,
					DurationS:   float64(d.DurationS),
					MaxSpeedMps: ptrFloat(d.MaxSpeedMps),
				}
				if d.EndTs != nil {
					ed.EndDate = d.EndTs.Format("2006-01-02T15:04:05Z")
				}
				allDrives = append(allDrives, ed)
			}
			offset += len(drives)
			if len(drives) < 500 {
				break
			}
		}
	}

	colNames := columnNames(cols)

	var buf bytes.Buffer
	ext := req.Format
	if req.Format == "json" {
		if len(req.Columns) == 0 {
			// Backwards-compat path: keep the historical strongly-typed
			// shape (slice of structs) so existing consumers parsing
			// drives JSON byte-for-byte are unaffected.
			if err := json.NewEncoder(&buf).Encode(allDrives); err != nil {
				return nil, fmt.Errorf("encode json: %w", err)
			}
		} else {
			ordered := make([]map[string]any, 0, len(allDrives))
			for _, d := range allDrives {
				row := make(map[string]any, len(colNames))
				for _, c := range colNames {
					row[c] = jsonCellForDrive(d, c)
				}
				ordered = append(ordered, row)
			}
			if err := json.NewEncoder(&buf).Encode(ordered); err != nil {
				return nil, fmt.Errorf("encode json: %w", err)
			}
		}
	} else {
		ext = "csv"
		cw := csv.NewWriter(&buf)
		_ = cw.Write(colNames)
		for _, d := range allDrives {
			row := make([]string, len(colNames))
			for i, c := range colNames {
				row[i] = csvCellForDrive(d, c)
			}
			_ = cw.Write(row)
		}
		cw.Flush()
	}

	return &ProcessResult{
		FileName:    fmt.Sprintf("teslasync-drives-v2.%s", ext),
		Data:        buf.Bytes(),
		RecordCount: len(allDrives),
	}, nil
}

// csvCellForDrive renders a single drive cell as the CSV string the
// pre-Phase-46/62 writer would have produced. Keep the formatting in
// lockstep with the legacy column-by-column cw.Write call so default
// (no-Columns) output is byte-for-byte identical.
func csvCellForDrive(d driveRow, col string) string {
	switch col {
	case "id":
		return strconv.FormatInt(d.ID, 10)
	case "vehicle_id":
		return strconv.FormatInt(d.VehicleID, 10)
	case "start_date":
		return d.StartDate
	case "end_date":
		return d.EndDate
	case "distance_m":
		return fmt.Sprintf("%.2f", d.DistanceM)
	case "duration_s":
		return fmt.Sprintf("%.0f", d.DurationS)
	case "max_speed_mps":
		return fmt.Sprintf("%.2f", d.MaxSpeedMps)
	default:
		return ""
	}
}

// jsonCellForDrive returns the typed value for a drive column suitable
// for JSON encoding. Used by the column-filtered JSON path so numeric
// columns survive as numbers, not strings.
func jsonCellForDrive(d driveRow, col string) any {
	switch col {
	case "id":
		return d.ID
	case "vehicle_id":
		return d.VehicleID
	case "start_date":
		return d.StartDate
	case "end_date":
		return d.EndDate
	case "distance_m":
		return d.DistanceM
	case "duration_s":
		return d.DurationS
	case "max_speed_mps":
		return d.MaxSpeedMps
	default:
		return nil
	}
}

func (p *Processor) processTrips(ctx context.Context, req *JobRequest) (*ProcessResult, error) {
	cols, err := resolveColumnSelection(string(TypeTrips), req.Columns)
	if err != nil {
		return nil, err
	}

	var startTime, endTime time.Time
	if req.StartDate != nil {
		startTime = *req.StartDate
	}
	if req.EndDate != nil {
		endTime = *req.EndDate
	}

	var summaries []*tripdb.TripSummary
	if req.VehicleID != nil {
		summaries, err = p.tripRepo.GetByVehicle(ctx, *req.VehicleID, 10000, 0, startTime, endTime)
	} else {
		summaries, err = p.tripRepo.GetAll(ctx, 10000, 0, startTime, endTime)
	}
	if err != nil {
		return nil, fmt.Errorf("fetch trips: %w", err)
	}

	rows := make([]tripRow, 0, len(summaries))
	for _, s := range summaries {
		row := tripRow{
			ID:             s.Trip.ID,
			VehicleID:      s.Trip.VehicleID,
			Name:           s.Trip.Name,
			StartedAt:      s.Trip.StartedAt.Format("2006-01-02T15:04:05Z"),
			TotalDistanceM: s.TotalDistanceM,
			TotalEnergyWh:  s.TotalEnergyWh,
			TotalDurationS: s.TotalDurationS,
			DriveCount:     s.DriveCount,
			ChargeCount:    s.ChargeCount,
			TotalCost:      s.TotalCost,
		}
		if s.Trip.EndedAt != nil {
			row.EndedAt = s.Trip.EndedAt.Format("2006-01-02T15:04:05Z")
		}
		rows = append(rows, row)
	}

	colNames := columnNames(cols)
	var buf bytes.Buffer
	ext := req.Format
	if req.Format == "json" {
		if len(req.Columns) == 0 {
			if err := json.NewEncoder(&buf).Encode(rows); err != nil {
				return nil, fmt.Errorf("encode json: %w", err)
			}
		} else {
			ordered := make([]map[string]any, 0, len(rows))
			for _, tr := range rows {
				row := make(map[string]any, len(colNames))
				for _, c := range colNames {
					row[c] = jsonCellForTrip(tr, c)
				}
				ordered = append(ordered, row)
			}
			if err := json.NewEncoder(&buf).Encode(ordered); err != nil {
				return nil, fmt.Errorf("encode json: %w", err)
			}
		}
	} else {
		ext = "csv"
		cw := csv.NewWriter(&buf)
		_ = cw.Write(colNames)
		for _, tr := range rows {
			row := make([]string, len(colNames))
			for i, c := range colNames {
				row[i] = csvCellForTrip(tr, c)
			}
			_ = cw.Write(row)
		}
		cw.Flush()
	}

	return &ProcessResult{FileName: fmt.Sprintf("teslasync-trips-v2.%s", ext), Data: buf.Bytes(), RecordCount: len(rows)}, nil
}

func csvCellForTrip(t tripRow, col string) string {
	switch col {
	case "id":
		return strconv.FormatInt(t.ID, 10)
	case "vehicle_id":
		return strconv.FormatInt(t.VehicleID, 10)
	case "name":
		return t.Name
	case "started_at":
		return t.StartedAt
	case "ended_at":
		return t.EndedAt
	case "total_distance_m":
		return fmt.Sprintf("%.2f", t.TotalDistanceM)
	case "total_energy_wh":
		return fmt.Sprintf("%.2f", t.TotalEnergyWh)
	case "total_duration_s":
		return strconv.FormatInt(t.TotalDurationS, 10)
	case "drive_count":
		return strconv.FormatInt(t.DriveCount, 10)
	case "charge_count":
		return strconv.FormatInt(t.ChargeCount, 10)
	case "total_cost":
		return fmt.Sprintf("%.2f", t.TotalCost)
	default:
		return ""
	}
}

func jsonCellForTrip(t tripRow, col string) any {
	switch col {
	case "id":
		return t.ID
	case "vehicle_id":
		return t.VehicleID
	case "name":
		return t.Name
	case "started_at":
		return t.StartedAt
	case "ended_at":
		return t.EndedAt
	case "total_distance_m":
		return t.TotalDistanceM
	case "total_energy_wh":
		return t.TotalEnergyWh
	case "total_duration_s":
		return t.TotalDurationS
	case "drive_count":
		return t.DriveCount
	case "charge_count":
		return t.ChargeCount
	case "total_cost":
		return t.TotalCost
	default:
		return nil
	}
}

func (p *Processor) processCharging(ctx context.Context, req *JobRequest) (*ProcessResult, error) {
	cols, err := resolveColumnSelection(string(TypeCharging), req.Columns)
	if err != nil {
		return nil, err
	}

	vehicles, err := p.vehicleRepo.GetAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("fetch vehicles: %w", err)
	}

	var startTime, endTime time.Time
	if req.StartDate != nil {
		startTime = *req.StartDate
	}
	if req.EndDate != nil {
		endTime = *req.EndDate
	}

	var allSessions []chargingRow
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
				es := chargingRow{
					ID:          s.ID,
					VehicleID:   s.VehicleID,
					StartedAt:   s.StartedAt.Format("2006-01-02T15:04:05Z"),
					EnergyAdded: ptrFloat(s.TotalEnergyAddedWh),
					StartSocPct: ptrFloat(s.StartSocPct),
					EndSocPct:   ptrFloat(s.EndSocPct),
					PeakPowerW:  ptrFloat(s.PeakPowerW),
				}
				if s.EndedAt != nil {
					es.EndedAt = s.EndedAt.Format("2006-01-02T15:04:05Z")
					es.DurationS = s.EndedAt.Sub(s.StartedAt).Seconds()
				}
				allSessions = append(allSessions, es)
			}
			offset += len(sessions)
			if len(sessions) < 500 {
				break
			}
		}
	}

	colNames := columnNames(cols)

	var buf bytes.Buffer
	ext := req.Format
	if req.Format == "json" {
		if len(req.Columns) == 0 {
			if err := json.NewEncoder(&buf).Encode(allSessions); err != nil {
				return nil, fmt.Errorf("encode json: %w", err)
			}
		} else {
			ordered := make([]map[string]any, 0, len(allSessions))
			for _, s := range allSessions {
				row := make(map[string]any, len(colNames))
				for _, c := range colNames {
					row[c] = jsonCellForCharging(s, c)
				}
				ordered = append(ordered, row)
			}
			if err := json.NewEncoder(&buf).Encode(ordered); err != nil {
				return nil, fmt.Errorf("encode json: %w", err)
			}
		}
	} else {
		ext = "csv"
		cw := csv.NewWriter(&buf)
		_ = cw.Write(colNames)
		for _, s := range allSessions {
			row := make([]string, len(colNames))
			for i, c := range colNames {
				row[i] = csvCellForCharging(s, c)
			}
			_ = cw.Write(row)
		}
		cw.Flush()
	}

	return &ProcessResult{
		FileName:    fmt.Sprintf("teslasync-charging-v2.%s", ext),
		Data:        buf.Bytes(),
		RecordCount: len(allSessions),
	}, nil
}

// csvCellForCharging matches the legacy column-by-column cw.Write call.
func csvCellForCharging(s chargingRow, col string) string {
	switch col {
	case "id":
		return strconv.FormatInt(s.ID, 10)
	case "vehicle_id":
		return strconv.FormatInt(s.VehicleID, 10)
	case "started_at":
		return s.StartedAt
	case "ended_at":
		return s.EndedAt
	case "total_energy_added_wh":
		return fmt.Sprintf("%.2f", s.EnergyAdded)
	case "start_soc_pct":
		return fmt.Sprintf("%.1f", s.StartSocPct)
	case "end_soc_pct":
		return fmt.Sprintf("%.1f", s.EndSocPct)
	case "peak_power_w":
		return fmt.Sprintf("%.1f", s.PeakPowerW)
	case "duration_s":
		return fmt.Sprintf("%.0f", s.DurationS)
	default:
		return ""
	}
}

// jsonCellForCharging returns typed values for the column-filtered JSON
// charging-export path so numbers stay numeric in the output.
func jsonCellForCharging(s chargingRow, col string) any {
	switch col {
	case "id":
		return s.ID
	case "vehicle_id":
		return s.VehicleID
	case "started_at":
		return s.StartedAt
	case "ended_at":
		return s.EndedAt
	case "total_energy_added_wh":
		return s.EnergyAdded
	case "start_soc_pct":
		return s.StartSocPct
	case "end_soc_pct":
		return s.EndSocPct
	case "peak_power_w":
		return s.PeakPowerW
	case "duration_s":
		return s.DurationS
	default:
		return nil
	}
}

// allowedBackupTables mirrors the whitelist from the backup handler.
var allowedBackupTables = map[string]bool{
	"vehicles": true, "drives": true, "charging_sessions": true,
	"positions": true, "addresses": true, "geofences": true,
	"alerts": true, "alert_rules": true, "settings": true,
	"daily_mileage": true, "vehicle_states": true, "software_updates": true,
	"vampire_drain_events": true, "signal_log": true,
	"visited_locations": true, "trips": true,
}

func (p *Processor) processBackup(ctx context.Context, req *JobRequest) (*ProcessResult, error) {
	_ = req // backup ignores per-job options today (full snapshot only)
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
		"exported_at": time.Now().UTC(),
		"version":     "2.0.0",
		"tables":      len(allowedBackupTables),
	}

	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(backup); err != nil {
		return nil, fmt.Errorf("encode backup: %w", err)
	}

	return &ProcessResult{
		FileName:    fmt.Sprintf("teslasync-backup-%s.json", time.Now().UTC().Format("2006-01-02")),
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
