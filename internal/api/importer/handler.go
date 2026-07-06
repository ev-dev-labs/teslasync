package importer

import (
	"context"
	"encoding/csv"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
	"github.com/rs/zerolog/log"
)

// driveCreator is the narrow write surface ImportDrives needs. It is satisfied
// by *drivedb.DriveRepo in production and by an in-memory fake in tests, so the
// CSV parsing and unit-conversion logic can be exercised without a live pgx
// pool.
type driveCreator interface {
	Create(ctx context.Context, d *drivemodel.Drive) error
}

// chargingCreator is the narrow write surface ImportCharging needs; satisfied
// by *chargingdb.ChargingRepo and substitutable in tests.
type chargingCreator interface {
	Create(ctx context.Context, c *chargingmodel.ChargingSession) error
}

// notificationLogFetcher is the narrow read surface ExportNotificationLogs
// needs; satisfied by *dbnotif.NotificationRepo and substitutable in tests.
type notificationLogFetcher interface {
	GetLogs(ctx context.Context, limit, offset int) ([]*notificationmodel.NotificationLog, error)
}

// Compile-time proof the concrete repositories satisfy the narrow ports above.
var (
	_ driveCreator           = (*drivedb.DriveRepo)(nil)
	_ chargingCreator        = (*chargingdb.ChargingRepo)(nil)
	_ notificationLogFetcher = (*dbnotif.NotificationRepo)(nil)
)

// ImportHandler handles CSV import endpoints for drives and charging data.
type ImportHandler struct {
	driveRepo    driveCreator
	chargingRepo chargingCreator
}

// NewImportHandler creates a new ImportHandler backed by concrete repositories.
func NewImportHandler(db *database.DB) *ImportHandler {
	return &ImportHandler{
		driveRepo:    drivedb.NewDriveRepo(db),
		chargingRepo: chargingdb.NewChargingRepo(db),
	}
}

// ImportDrives imports drive records from a CSV file upload.
// Expected CSV columns: vehicle_id, start_ts, end_ts, distance_mi, duration_min, max_speed_mph
func (h *ImportHandler) ImportDrives(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid multipart form")
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	reader := csv.NewReader(file)
	// Skip header row
	if _, err := reader.Read(); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "unable to read CSV header")
		return
	}

	var imported int
	var errors int
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

		d := &drivemodel.Drive{
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

		if err := h.driveRepo.Create(r.Context(), d); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to import drive")
			errors++
			continue
		}
		imported++
	}

	log.Info().Int("imported", imported).Int("errors", errors).Msg("drive CSV import complete")
	httpx.WriteJSON(w, http.StatusOK, map[string]int{"imported": imported, "errors": errors})
}

// ImportCharging imports charging session records from a CSV file upload.
// Expected CSV columns: vehicle_id, start_ts, end_ts, energy_added_kwh, start_battery, end_battery, charger_power_kw_max, duration_min
func (h *ImportHandler) ImportCharging(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid multipart form")
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	reader := csv.NewReader(file)
	// Skip header row
	if _, err := reader.Read(); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "unable to read CSV header")
		return
	}

	var imported int
	var errors int
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
		energyAddedKwh, err := strconv.ParseFloat(record[3], 64)
		if err != nil {
			errors++
			continue
		}
		startBattery, err := strconv.Atoi(record[4])
		if err != nil {
			errors++
			continue
		}

		// The upload CSV carries human-friendly kilo units (energy_added_kwh,
		// charger_power_kw_max) while charging_sessions is SI canonical (Wh, W)
		// per ADR-004 #2. Convert at this import boundary — mirrors the miles/
		// minutes/mph → SI conversions performed in ImportDrives.
		energyAddedWh := energyAddedKwh * 1000.0
		startSocPct := float64(startBattery)
		c := &chargingmodel.ChargingSession{
			VehicleID:          vehicleID,
			StartedAt:          startDate,
			TotalEnergyAddedWh: &energyAddedWh,
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
		if powerKw, err := strconv.ParseFloat(record[6], 64); err == nil {
			powerW := powerKw * 1000.0
			c.PeakPowerW = &powerW
		}
		if err := h.chargingRepo.Create(r.Context(), c); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to import charging session")
			errors++
			continue
		}
		imported++
	}

	log.Info().Int("imported", imported).Int("errors", errors).Msg("charging CSV import complete")
	httpx.WriteJSON(w, http.StatusOK, map[string]int{"imported": imported, "errors": errors})
}

// ExportNotificationLogs exports notification delivery logs as CSV or JSON.
func ExportNotificationLogs(db *database.DB) http.HandlerFunc {
	return exportNotificationLogs(dbnotif.NewNotificationRepo(db))
}

// exportNotificationLogs is the repository-agnostic core of
// ExportNotificationLogs. Isolating the fetcher behind notificationLogFetcher
// lets tests exercise the CSV/JSON rendering and error paths without a live
// pgx pool.
func exportNotificationLogs(repo notificationLogFetcher) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		format := r.URL.Query().Get("format")
		if format == "" {
			format = "csv"
		}

		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()

		logs, err := repo.GetLogs(ctx, 10000, 0)
		if err != nil {
			log.Error().Err(err).Msg("failed to fetch notification logs for export")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to fetch notification logs")
			return
		}
		if logs == nil {
			logs = []*notificationmodel.NotificationLog{}
		}

		if format == "json" {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Content-Disposition", "attachment; filename=teslasync-notifications.json")
			httpx.WriteJSON(w, http.StatusOK, logs)
			return
		}

		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=teslasync-notifications.csv")
		cw := csv.NewWriter(w)
		_ = cw.Write([]string{"id", "channel_id", "title", "message", "status", "error", "created_at", "sent_at"})
		for _, l := range logs {
			sentAt := ""
			if l.SentAt != nil {
				sentAt = l.SentAt.Format("2006-01-02T15:04:05Z")
			}
			_ = cw.Write([]string{
				strconv.FormatInt(l.ID, 10),
				strconv.FormatInt(l.ChannelID, 10),
				l.Title,
				l.Message,
				l.Status,
				l.Error,
				l.CreatedAt.Format("2006-01-02T15:04:05Z"),
				sentAt,
			})
		}
		cw.Flush()
	}
}
