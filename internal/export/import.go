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

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// processImportDrives imports drive records from CSV data stored in the job's file_data.
// The CSV is stored as the job's "payload" — the API handler reads the uploaded file,
// stores it in export_jobs.file_data, and then the worker processes it here.
func (p *Processor) processImportDrives(ctx context.Context, req *JobRequest) (*ProcessResult, error) {
	// The import data is stored in the job's file_data field by the API handler
	jobRepo := p.db.Pool
	var csvData []byte
	err := jobRepo.QueryRow(ctx, `SELECT file_data FROM export_jobs WHERE id = $1`, req.JobID).Scan(&csvData)
	if err != nil || len(csvData) == 0 {
		return nil, fmt.Errorf("no import data found for job %s", req.JobID)
	}

	reader := csv.NewReader(bytes.NewReader(csvData))
	// Skip header
	if _, err := reader.Read(); err != nil {
		return nil, fmt.Errorf("unable to read CSV header: %w", err)
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
		if len(record) < 6 {
			errors++
			continue
		}

		vehicleID, err := strconv.ParseInt(record[0], 10, 64)
		if err != nil {
			errors++
			continue
		}
		startDate, err := time.Parse("2006-01-02T15:04:05Z", record[1])
		if err != nil {
			errors++
			continue
		}
		distance, err := strconv.ParseFloat(record[3], 64)
		if err != nil {
			errors++
			continue
		}
		duration, err := strconv.ParseFloat(record[4], 64)
		if err != nil {
			errors++
			continue
		}
		speedMax, _ := strconv.ParseFloat(record[5], 64)

		d := &models.Drive{
			VehicleID: vehicleID,
			StartTs:   startDate,
			DistanceM: distance * 1609.344,
			DurationS: int64(duration*60.0 + 0.5),
		}
		if speedMax > 0 {
			mps := speedMax * 0.44704
			d.MaxSpeedMps = &mps
		}
		if record[2] != "" {
			if endDate, err := time.Parse("2006-01-02T15:04:05Z", record[2]); err == nil {
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
	if _, err := reader.Read(); err != nil {
		return nil, fmt.Errorf("unable to read CSV header: %w", err)
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
		if len(record) < 8 {
			errors++
			continue
		}

		vehicleID, err := strconv.ParseInt(record[0], 10, 64)
		if err != nil {
			errors++
			continue
		}
		startDate, err := time.Parse("2006-01-02T15:04:05Z", record[1])
		if err != nil {
			errors++
			continue
		}
		energyAdded, err := strconv.ParseFloat(record[3], 64)
		if err != nil {
			errors++
			continue
		}
		startBattery, err := strconv.Atoi(record[4])
		if err != nil {
			errors++
			continue
		}
		startSocPct := float64(startBattery)

		c := &models.ChargingSession{
			VehicleID:          vehicleID,
			StartedAt:          startDate,
			TotalEnergyAddedWh: &energyAdded,
			StartSocPct:        &startSocPct,
		}

		if record[2] != "" {
			if endDate, err := time.Parse("2006-01-02T15:04:05Z", record[2]); err == nil {
				c.EndedAt = &endDate
			}
		}
		if endBatt, err := strconv.Atoi(record[5]); err == nil {
			endSocPct := float64(endBatt)
			c.EndSocPct = &endSocPct
		}
		if power, err := strconv.ParseFloat(record[6], 64); err == nil {
			c.PeakPowerW = &power
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
