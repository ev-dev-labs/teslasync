package api

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/export"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ExportHandler provides endpoints for data export and async export job management.
type ExportHandler struct {
	db         *database.DB
	mqttClient pahomqtt.Client
	jobRepo    *database.ExportJobRepo
}

// NewExportJobHandler creates a handler with MQTT support for async exports.
func NewExportJobHandler(db *database.DB, mqttClient pahomqtt.Client) *ExportHandler {
	return &ExportHandler{
		db:         db,
		mqttClient: mqttClient,
		jobRepo:    database.NewExportJobRepo(db),
	}
}

// SubmitJob creates a new export job and publishes it to the MQTT queue.
func (h *ExportHandler) SubmitJob(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Type      string `json:"type"`
		Format    string `json:"format"`
		VehicleID *int64 `json:"vehicle_id,omitempty"`
		Start     string `json:"start,omitempty"`
		End       string `json:"end,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Type == "" {
		writeError(w, http.StatusBadRequest, "type is required (drives, charging, backup, analytics)")
		return
	}

	validTypes := map[string]bool{
		"drives": true, "charging": true, "backup": true, "analytics": true,
		"import_drives": true, "import_charging": true,
	}
	if !validTypes[req.Type] {
		writeError(w, http.StatusBadRequest, "invalid type: must be one of drives, charging, backup, analytics")
		return
	}

	if req.Format == "" {
		req.Format = "csv"
	}
	if req.Type == "backup" || req.Type == "analytics" {
		req.Format = "json"
	}

	// Parse optional date range
	var startDate, endDate *time.Time
	if req.Start != "" {
		t, err := time.Parse("2006-01-02", req.Start)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid start date format (expected YYYY-MM-DD)")
			return
		}
		startDate = &t
	}
	if req.End != "" {
		t, err := time.Parse("2006-01-02", req.End)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid end date format (expected YYYY-MM-DD)")
			return
		}
		endDate = &t
	}

	// Generate job ID
	jobID := fmt.Sprintf("exp-%d", time.Now().UnixNano())

	now := time.Now().UTC()
	job := &models.ExportJob{
		ID:        jobID,
		Type:      req.Type,
		Format:    req.Format,
		Status:    string(export.StatusQueued),
		VehicleID: req.VehicleID,
		StartDate: startDate,
		EndDate:   endDate,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := h.jobRepo.Create(r.Context(), job); err != nil {
		log.Error().Err(err).Msg("export: failed to create job")
		writeError(w, http.StatusInternalServerError, "failed to create export job")
		return
	}

	// Publish to MQTT for worker processing
	mqttReq := &models.ExportJobRequest{
		JobID:     jobID,
		Type:      req.Type,
		Format:    req.Format,
		VehicleID: req.VehicleID,
		StartDate: startDate,
		EndDate:   endDate,
	}

	if err := export.Publish(h.mqttClient, mqttReq); err != nil {
		log.Error().Err(err).Str("job_id", jobID).Msg("export: failed to publish to MQTT")
		// Mark as failed since worker won't pick it up
		_ = h.jobRepo.Fail(r.Context(), jobID, "failed to queue: "+err.Error())
		writeError(w, http.StatusServiceUnavailable, "export service unavailable, MQTT not connected")
		return
	}

	log.Info().Str("job_id", jobID).Str("type", req.Type).Str("format", req.Format).Msg("export job submitted")

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"id":      jobID,
		"type":    req.Type,
		"format":  req.Format,
		"status":  "queued",
		"message": "Export job submitted successfully. Check status at /api/v1/export/jobs/" + jobID,
	})
}

// ListJobs returns recent export jobs.
func (h *ExportHandler) ListJobs(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	jobs, err := h.jobRepo.List(r.Context(), limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("export: failed to list jobs")
		writeError(w, http.StatusInternalServerError, "failed to list export jobs")
		return
	}
	writeJSON(w, http.StatusOK, jobs)
}

// GetJob returns the status of a specific export job.
func (h *ExportHandler) GetJob(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "jobID")
	job, err := h.jobRepo.GetByID(r.Context(), jobID)
	if err != nil {
		writeError(w, http.StatusNotFound, "export job not found")
		return
	}
	writeJSON(w, http.StatusOK, models.ExportJobSummary{
		ID:           job.ID,
		Type:         job.Type,
		Format:       job.Format,
		Status:       job.Status,
		FileName:     job.FileName,
		FileSize:     job.FileSize,
		RecordCount:  job.RecordCount,
		ErrorMessage: job.ErrorMessage,
		CreatedAt:    job.CreatedAt,
		CompletedAt:  job.CompletedAt,
	})
}

// DownloadJob serves the completed export file.
func (h *ExportHandler) DownloadJob(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "jobID")
	data, fileName, err := h.jobRepo.GetFileData(r.Context(), jobID)
	if err != nil || data == nil {
		writeError(w, http.StatusNotFound, "export file not available (job may not be ready)")
		return
	}

	// Determine content type from file extension
	contentType := "application/octet-stream"
	if len(fileName) > 4 {
		switch fileName[len(fileName)-4:] {
		case ".csv":
			contentType = "text/csv"
		case "json":
			contentType = "application/json"
		}
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", fileName))
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data)
}

// SubmitImportJob handles async CSV file import. The file is stored in the job
// record and processed by the export worker.
func (h *ExportHandler) SubmitImportJob(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil { // 10 MB limit
		writeError(w, http.StatusBadRequest, "invalid multipart form")
		return
	}

	importType := r.FormValue("type")
	if importType != "import_drives" && importType != "import_charging" {
		writeError(w, http.StatusBadRequest, "type must be import_drives or import_charging")
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	fileData, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read file")
		return
	}

	jobID := fmt.Sprintf("imp-%d", time.Now().UnixNano())
	now := time.Now().UTC()

	// Create job with the file data stored directly
	job := &models.ExportJob{
		ID:        jobID,
		Type:      importType,
		Format:    "csv",
		Status:    string(export.StatusQueued),
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := h.jobRepo.Create(r.Context(), job); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create import job")
		return
	}

	// Store the CSV data in file_data for the worker to pick up
	if _, err := h.db.Pool.Exec(r.Context(), `UPDATE export_jobs SET file_data = $2 WHERE id = $1`, jobID, fileData); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store import data")
		return
	}

	mqttReq := &models.ExportJobRequest{
		JobID:  jobID,
		Type:   importType,
		Format: "csv",
	}
	if err := export.Publish(h.mqttClient, mqttReq); err != nil {
		_ = h.jobRepo.Fail(r.Context(), jobID, "failed to queue: "+err.Error())
		writeError(w, http.StatusServiceUnavailable, "import service unavailable")
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"id":      jobID,
		"type":    importType,
		"status":  "queued",
		"message": "Import job submitted. Check status at /api/v1/export/jobs/" + jobID,
	})
}

// NewExportHandler returns a handler for the legacy synchronous data export endpoint.
// Kept for backward compatibility with direct download use cases.
func NewExportHandler(db *database.DB) http.HandlerFunc {
	vehicleRepo := database.NewVehicleRepo(db)
	driveRepo := database.NewDriveRepo(db)
	chargingRepo := database.NewChargingRepo(db)

	return func(w http.ResponseWriter, r *http.Request) {
		exportType := chi.URLParam(r, "type")
		format := r.URL.Query().Get("format")
		if format == "" {
			format = "csv"
		}

		switch exportType {
		case "drives":
			exportDrives(w, r, vehicleRepo, driveRepo, format)
		case "charging":
			exportCharging(w, r, vehicleRepo, chargingRepo, format)
		default:
			http.Error(w, "unsupported export type", http.StatusBadRequest)
		}
	}
}

func exportDrives(w http.ResponseWriter, r *http.Request, vehicleRepo *database.VehicleRepo, driveRepo *database.DriveRepo, format string) {
	vehicles, err := vehicleRepo.GetAll(r.Context())
	if err != nil {
		http.Error(w, "failed to fetch vehicles", http.StatusInternalServerError)
		return
	}

	type exportDrive struct {
		ID         int64   `json:"id"`
		VehicleID  int64   `json:"vehicle_id"`
		StartDate  string  `json:"start_date"`
		EndDate    string  `json:"end_date"`
		Distance   float64 `json:"distance"`
		Duration   float64 `json:"duration_min"`
		SpeedMax   float64 `json:"speed_max"`
	}

	var allDrives []exportDrive
	startTime, endTime := parseDateRange(r)
	for _, v := range vehicles {
		drives, err := driveRepo.GetByVehicle(r.Context(), v.ID, 500, 0, startTime, endTime)
		if err != nil {
			continue
		}
		for _, d := range drives {
			ed := exportDrive{
				ID:        d.ID,
				VehicleID: d.VehicleID,
				StartDate: d.StartTs.Format("2006-01-02T15:04:05Z"),
				Distance:  d.DistanceMi,
				Duration:  d.DurationMin,
				SpeedMax:  ptrFloat(d.MaxSpeedMph),
			}
			if d.EndTs != nil {
				ed.EndDate = d.EndTs.Format("2006-01-02T15:04:05Z")
			}
			allDrives = append(allDrives, ed)
		}
	}

	if format == "json" {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", "attachment; filename=teslasync-drives.json")
		_ = json.NewEncoder(w).Encode(allDrives)
		return
	}

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=teslasync-drives.csv")
	cw := csv.NewWriter(w)
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

func exportCharging(w http.ResponseWriter, r *http.Request, vehicleRepo *database.VehicleRepo, chargingRepo *database.ChargingRepo, format string) {
	vehicles, err := vehicleRepo.GetAll(r.Context())
	if err != nil {
		http.Error(w, "failed to fetch vehicles", http.StatusInternalServerError)
		return
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

	var allSessions []exportSession
	startTime, endTime := parseDateRange(r)
	for _, v := range vehicles {
		sessions, err := chargingRepo.GetByVehicle(r.Context(), v.ID, 500, 0, startTime, endTime)
		if err != nil {
			continue
		}
		for _, s := range sessions {
			es := exportSession{
				ID:           s.ID,
				VehicleID:    s.VehicleID,
				StartDate:    s.StartTs.Format("2006-01-02T15:04:05Z"),
				EnergyAdded:  ptrFloat(s.EnergyAddedKwh),
				StartBattery: ptrInt16(s.StartBatteryPct),
				EndBattery:   ptrInt16(s.EndBatteryPct),
				ChargerPower: ptrFloat(s.ChargerPowerKwMax),
				Duration:     ptrFloat(s.DurationMin),
			}
			if s.EndTs != nil {
				es.EndDate = s.EndTs.Format("2006-01-02T15:04:05Z")
			}
			allSessions = append(allSessions, es)
		}
	}

	if format == "json" {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", "attachment; filename=teslasync-charging.json")
		_ = json.NewEncoder(w).Encode(allSessions)
		return
	}

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=teslasync-charging.csv")
	cw := csv.NewWriter(w)
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

func ptrFloat(p *float64) float64 {
	if p != nil {
		return *p
	}
	return 0
}

func ptrInt16(p *int16) int {
	if p != nil {
		return int(*p)
	}
	return 0
}
