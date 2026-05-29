package export

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	"github.com/rs/zerolog/log"
)

// processImportDrives imports drive records from export_jobs.file_data, where
// the API handler stores the uploaded CSV before the worker processes it.
func (p *Processor) processImportDrives(ctx context.Context, req *JobRequest) (*ProcessResult, error) {
	jobRepo := p.db.Pool
	var csvData []byte
	err := jobRepo.QueryRow(ctx, `SELECT file_data FROM export_jobs WHERE id = $1`, req.JobID).Scan(&csvData)
	if err != nil || len(csvData) == 0 {
		return nil, fmt.Errorf("no import data found for job %s", req.JobID)
	}

	reader := csv.NewReader(bytes.NewReader(csvData))
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("unable to read CSV header: %w", err)
	}
	cols := csvHeaderIndex(header)
	required := []string{"vehicle_id", "start_date", "distance_m", "duration_s"}
	for _, c := range required {
		if _, ok := cols[c]; !ok {
			return nil, fmt.Errorf("unsupported drives CSV schema: missing v2 column %s", c)
		}
	}

	var imported, errors int
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			errors++
			continue
		}
		vehicleID, err := strconv.ParseInt(record[cols["vehicle_id"]], 10, 64)
		if err != nil {
			errors++
			continue
		}
		startDate, err := time.Parse("2006-01-02T15:04:05Z", record[cols["start_date"]])
		if err != nil {
			errors++
			continue
		}
		distance, err := strconv.ParseFloat(record[cols["distance_m"]], 64)
		if err != nil {
			errors++
			continue
		}
		duration, err := strconv.ParseFloat(record[cols["duration_s"]], 64)
		if err != nil {
			errors++
			continue
		}
		speedMax := 0.0
		if idx, ok := cols["max_speed_mps"]; ok && idx < len(record) {
			speedMax, _ = strconv.ParseFloat(record[idx], 64)
		}

		d := &drivemodel.Drive{
			VehicleID: vehicleID,
			StartTs:   startDate,
			DistanceM: distance,
			DurationS: int64(duration + 0.5),
		}
		if speedMax > 0 {
			mps := speedMax
			d.MaxSpeedMps = &mps
		}
		if idx, ok := cols["end_date"]; ok && idx < len(record) && record[idx] != "" {
			if endDate, err := time.Parse("2006-01-02T15:04:05Z", record[idx]); err == nil {
				d.EndTs = &endDate
			}
		}

		if err := p.driveRepo.Create(ctx, d); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("import: failed to import drive")
			errors++
			continue
		}
		imported++
	}

	result := map[string]int{"imported": imported, "errors": errors}
	data, _ := json.Marshal(result)

	return &ProcessResult{
		FileName:    "import-drives-result.json",
		Data:        data,
		RecordCount: imported,
	}, nil
}

// processImportCharging imports charging records from CSV data stored in the job.
func (p *Processor) processImportCharging(ctx context.Context, req *JobRequest) (*ProcessResult, error) {
	jobRepo := p.db.Pool
	var csvData []byte
	err := jobRepo.QueryRow(ctx, `SELECT file_data FROM export_jobs WHERE id = $1`, req.JobID).Scan(&csvData)
	if err != nil || len(csvData) == 0 {
		return nil, fmt.Errorf("no import data found for job %s", req.JobID)
	}

	reader := csv.NewReader(bytes.NewReader(csvData))
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("unable to read CSV header: %w", err)
	}
	cols := csvHeaderIndex(header)
	for _, c := range []string{"vehicle_id", "started_at", "total_energy_added_wh", "start_soc_pct"} {
		if _, ok := cols[c]; !ok {
			return nil, fmt.Errorf("unsupported charging CSV schema: missing v2 column %s", c)
		}
	}

	var imported, errors int
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			errors++
			continue
		}
		vehicleID, err := strconv.ParseInt(record[cols["vehicle_id"]], 10, 64)
		if err != nil {
			errors++
			continue
		}
		startDate, err := time.Parse("2006-01-02T15:04:05Z", record[cols["started_at"]])
		if err != nil {
			errors++
			continue
		}
		energyAdded, err := strconv.ParseFloat(record[cols["total_energy_added_wh"]], 64)
		if err != nil {
			errors++
			continue
		}
		startSocPct, err := strconv.ParseFloat(record[cols["start_soc_pct"]], 64)
		if err != nil {
			errors++
			continue
		}

		c := &chargingmodel.ChargingSession{
			VehicleID:          vehicleID,
			StartedAt:          startDate,
			TotalEnergyAddedWh: &energyAdded,
			StartSocPct:        &startSocPct,
		}

		if idx, ok := cols["ended_at"]; ok && idx < len(record) && record[idx] != "" {
			if endDate, err := time.Parse("2006-01-02T15:04:05Z", record[idx]); err == nil {
				c.EndedAt = &endDate
			}
		}
		if idx, ok := cols["end_soc_pct"]; ok && idx < len(record) {
			if endSocPct, err := strconv.ParseFloat(record[idx], 64); err == nil {
				c.EndSocPct = &endSocPct
			}
		}
		if idx, ok := cols["peak_power_w"]; ok && idx < len(record) {
			if power, err := strconv.ParseFloat(record[idx], 64); err == nil {
				c.PeakPowerW = &power
			}
		}
		if err := p.chargingRepo.Create(ctx, c); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("import: failed to import charging session")
			errors++
			continue
		}
		imported++
	}

	result := map[string]int{"imported": imported, "errors": errors}
	data, _ := json.Marshal(result)

	return &ProcessResult{
		FileName:    "import-charging-result.json",
		Data:        data,
		RecordCount: imported,
	}, nil
}

func csvHeaderIndex(header []string) map[string]int {
	out := make(map[string]int, len(header))
	for i, name := range header {
		out[name] = i
	}
	return out
}
