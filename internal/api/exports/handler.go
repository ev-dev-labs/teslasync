package exports

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	exportmodel "github.com/ev-dev-labs/teslasync/internal/models/export"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"

	"github.com/ev-dev-labs/teslasync/internal/database"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	exportdb "github.com/ev-dev-labs/teslasync/internal/database/export"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/export"
)

// ExportHandler provides endpoints for data export and async export job management.
type ExportHandler struct {
	db         *database.DB
	mqttClient pahomqtt.Client
	jobRepo    *exportdb.ExportJobRepo
	// bulkOverride lets tests substitute the bulk store without standing
	// up a real *exportdb.ExportJobRepo. Always nil in production.
	bulkOverride exportBulkStore
}

const (
	maxExportJobRequestBytes = 64 << 10
)

type submitJobRequest struct {
	Type      string   `json:"type"`
	Format    string   `json:"format"`
	VehicleID *int64   `json:"vehicle_id,omitempty"`
	Start     string   `json:"start,omitempty"`
	End       string   `json:"end,omitempty"`
	Columns   []string `json:"columns,omitempty"`
}

func decodeSubmitJobRequest(w http.ResponseWriter, r *http.Request) (submitJobRequest, error) {
	var req submitJobRequest
	r.Body = http.MaxBytesReader(w, r.Body, maxExportJobRequestBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		return submitJobRequest{}, errors.New("invalid request body")
	}
	var trailing json.RawMessage
	if err := dec.Decode(&trailing); !errors.Is(err, io.EOF) {
		return submitJobRequest{}, errors.New("request body must contain one JSON object")
	}
	return req, nil
}

// parseAsyncExportWindow preserves nil bounds for the export worker's
// intentional "All Time" contract. Jobs are queued and streamed by the
// worker, so changing an omitted range into a synthetic recent window would
// silently omit records. Explicit date-only bounds retain the established
// request format and reject only malformed or reversed windows.
func parseAsyncExportWindow(startRaw, endRaw string) (*time.Time, *time.Time, error) {
	parse := func(raw, field string) (*time.Time, error) {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return nil, nil
		}
		value, err := time.Parse("2006-01-02", raw)
		if err != nil {
			return nil, fmt.Errorf("%s must use YYYY-MM-DD format", field)
		}
		value = value.UTC()
		return &value, nil
	}

	start, err := parse(startRaw, "start")
	if err != nil {
		return nil, nil, err
	}
	end, err := parse(endRaw, "end")
	if err != nil {
		return nil, nil, err
	}
	if start != nil && end != nil {
		if err := apiparams.ValidateDateRange(*start, *end, 0); err != nil {
			return nil, nil, err
		}
	}
	return start, end, nil
}

// syncExportWindow delegates all parsing to the legacy shared helper so
// synchronous downloads preserve RFC3339 support and the inclusive
// end-of-day behavior for YYYY-MM-DD filters.
func syncExportWindow(r *http.Request) (time.Time, time.Time) {
	return apiparams.ParseDateRange(r)
}

// NewExportJobHandler creates a handler with MQTT support for async exports.
func NewExportJobHandler(db *database.DB, mqttClient pahomqtt.Client) *ExportHandler {
	return &ExportHandler{
		db:         db,
		mqttClient: mqttClient,
		jobRepo:    exportdb.NewExportJobRepo(db),
	}
}

// SubmitJob creates a new export job and publishes it to the MQTT queue.
func (h *ExportHandler) SubmitJob(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.exports.submit_job")
	defer span.End()
	traceID := span.SpanContext().TraceID().String()

	req, err := decodeSubmitJobRequest(w, r)
	if err != nil {
		span.RecordError(err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if req.Type == "" {
		validationErr := errors.New("type is required (drives, charging, trips, backup, analytics)")
		span.RecordError(validationErr)
		writeError(w, http.StatusBadRequest, validationErr.Error())
		return
	}

	validTypes := map[string]bool{
		"drives": true, "charging": true, "trips": true, "backup": true, "analytics": true,
		"import_drives": true, "import_charging": true,
		"account": true,
	}
	if !validTypes[req.Type] {
		validationErr := errors.New("invalid type: must be one of drives, charging, trips, backup, analytics, account")
		span.RecordError(validationErr)
		writeError(w, http.StatusBadRequest, validationErr.Error())
		return
	}

	if req.Format == "" {
		req.Format = "csv"
	}
	if req.Type == "backup" || req.Type == "analytics" {
		req.Format = "json"
	}
	if req.Type == "account" {
		req.Format = "zip"
	}

	// validate columns allowlist up-front so the caller
	// learns about a typo synchronously instead of through a failed job.
	// Account exports skip strict per-type validation: their column set
	// is dynamic per-table and the writer applies a per-table
	// intersection downstream.
	if len(req.Columns) > 0 && req.Type != "account" {
		if !export.SupportsColumnSelection(req.Type) {
			validationErr := errors.New("columns are not supported for this export type")
			span.RecordError(validationErr)
			writeError(w, http.StatusBadRequest, validationErr.Error())
			return
		}
		if _, err := export.ValidateColumns(req.Type, req.Columns); err != nil {
			span.RecordError(err)
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	startDate, endDate, err := parseAsyncExportWindow(req.Start, req.End)
	if err != nil {
		span.RecordError(err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Generate job ID
	jobID := fmt.Sprintf("exp-%d", time.Now().UnixNano())

	now := time.Now().UTC()
	job := &exportmodel.ExportJob{
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

	if err := h.jobRepo.Create(ctx, job); err != nil {
		span.RecordError(err)
		log.Error().Err(err).Str("trace_id", traceID).Msg("export: failed to create job")
		writeError(w, http.StatusInternalServerError, "failed to create export job")
		return
	}

	// Publish to MQTT for worker processing
	mqttReq := &export.JobRequest{
		ExportJobRequest: exportmodel.ExportJobRequest{
			JobID:     jobID,
			Type:      req.Type,
			Format:    req.Format,
			VehicleID: req.VehicleID,
			StartDate: startDate,
			EndDate:   endDate,
		},
		Columns: req.Columns,
	}

	if err := export.PublishCtx(ctx, h.mqttClient, mqttReq); err != nil {
		span.RecordError(err)
		log.Error().Err(err).Str("job_id", jobID).Str("trace_id", traceID).Msg("export: failed to publish to MQTT")
		// Mark as failed since worker won't pick it up
		if failErr := h.jobRepo.Fail(ctx, jobID, "failed to queue: "+err.Error()); failErr != nil {
			log.Warn().Err(failErr).Str("job_id", jobID).Str("trace_id", traceID).
				Msg("export: failed to mark unqueued job as failed")
		}
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
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.exports.list_jobs")
	defer span.End()

	limit, offset := pagination(r)
	jobs, err := h.jobRepo.List(ctx, limit, offset)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).
			Msg("export: failed to list jobs")
		writeError(w, http.StatusInternalServerError, "failed to list export jobs")
		return
	}
	apiparams.SetPaginationHeaders(w, limit, offset, len(jobs))
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
	writeJSON(w, http.StatusOK, exportmodel.ExportJobSummary{
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
		case ".zip":
			contentType = "application/zip"
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

	job := &exportmodel.ExportJob{
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

	mqttReq := &export.JobRequest{
		ExportJobRequest: exportmodel.ExportJobRequest{
			JobID:  jobID,
			Type:   importType,
			Format: "csv",
		},
	}
	if err := export.PublishCtx(r.Context(), h.mqttClient, mqttReq); err != nil {
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

// SubmitAccountJob queues a GDPR-style "Download my data" full account export.
// Produces a ZIP containing one CSV per allowed table plus manifest.json.
// Convenience wrapper around SubmitJob with type=account so the frontend can
// hit a single dedicated endpoint instead of crafting the generic payload.
func (h *ExportHandler) SubmitAccountJob(w http.ResponseWriter, r *http.Request) {
	var req struct {
		VehicleID *int64 `json:"vehicle_id,omitempty"`
		Start     string `json:"start,omitempty"`
		End       string `json:"end,omitempty"`
	}
	// Empty body is allowed — defaults to "all data, all vehicles, all time".
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
	}

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

	jobID := fmt.Sprintf("acc-%d", time.Now().UnixNano())
	now := time.Now().UTC()
	job := &exportmodel.ExportJob{
		ID:        jobID,
		Type:      string(export.TypeAccount),
		Format:    "zip",
		Status:    string(export.StatusQueued),
		VehicleID: req.VehicleID,
		StartDate: startDate,
		EndDate:   endDate,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := h.jobRepo.Create(r.Context(), job); err != nil {
		log.Error().Err(err).Msg("export account: failed to create job")
		writeError(w, http.StatusInternalServerError, "failed to create export job")
		return
	}

	mqttReq := &export.JobRequest{
		ExportJobRequest: exportmodel.ExportJobRequest{
			JobID:     jobID,
			Type:      string(export.TypeAccount),
			Format:    "zip",
			VehicleID: req.VehicleID,
			StartDate: startDate,
			EndDate:   endDate,
		},
	}
	if err := export.PublishCtx(r.Context(), h.mqttClient, mqttReq); err != nil {
		log.Error().Err(err).Str("job_id", jobID).Msg("export account: failed to publish to MQTT")
		_ = h.jobRepo.Fail(r.Context(), jobID, "failed to queue: "+err.Error())
		writeError(w, http.StatusServiceUnavailable, "export service unavailable, MQTT not connected")
		return
	}

	log.Info().Str("job_id", jobID).Msg("export account job submitted")
	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"id":      jobID,
		"type":    string(export.TypeAccount),
		"format":  "zip",
		"status":  "queued",
		"message": "Account export queued. Check status at /api/v1/export/jobs/" + jobID,
	})
}

// NewExportHandler returns a handler for the legacy synchronous data export endpoint.
// Kept for backward compatibility with direct download use cases.
func NewExportHandler(db *database.DB) http.HandlerFunc {
	vehicleRepo := vehicledb.NewVehicleRepo(db)
	driveRepo := drivedb.NewDriveRepo(db)
	chargingRepo := chargingdb.NewChargingRepo(db)

	return func(w http.ResponseWriter, r *http.Request) {
		ctx, span := otel.Tracer("api").Start(r.Context(), "api.exports.download")
		defer span.End()
		r = r.WithContext(ctx)

		startTime, endTime := syncExportWindow(r)
		exportType := chi.URLParam(r, "type")
		format := r.URL.Query().Get("format")
		if format == "" {
			format = "csv"
		}

		switch exportType {
		case "drives":
			exportDrives(w, r, vehicleRepo, driveRepo, format, startTime, endTime)
		case "charging":
			exportCharging(w, r, vehicleRepo, chargingRepo, format, startTime, endTime)
		default:
			validationErr := errors.New("unsupported export type")
			span.RecordError(validationErr)
			httpx.WriteError(w, http.StatusBadRequest, validationErr.Error())
		}
	}
}

func exportDrives(
	w http.ResponseWriter,
	r *http.Request,
	vehicleRepo *vehicledb.VehicleRepo,
	driveRepo *drivedb.DriveRepo,
	format string,
	startTime, endTime time.Time,
) {
	vehicles, err := vehicleRepo.GetAll(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to fetch vehicles")
		return
	}

	type exportDrive struct {
		ID        int64   `json:"id"`
		VehicleID int64   `json:"vehicle_id"`
		StartDate string  `json:"start_date"`
		EndDate   string  `json:"end_date"`
		DistanceM float64 `json:"distance_m"`
		DurationS int64   `json:"duration_s"`
		SpeedMax  float64 `json:"max_speed_mps"`
	}

	var allDrives []exportDrive
	partial := false
	for _, v := range vehicles {
		drives, err := driveRepo.GetByVehicle(r.Context(), v.ID, 500, 0, startTime, endTime)
		if err != nil {
			log.Warn().Err(err).Int64("vehicle_id", v.ID).Msg("export drives: skipped vehicle after query failure")
			partial = true
			continue
		}
		if len(drives) >= 500 {
			partial = true
		}
		for _, d := range drives {
			ed := exportDrive{
				ID:        d.ID,
				VehicleID: d.VehicleID,
				StartDate: d.StartTs.Format("2006-01-02T15:04:05Z"),
				DistanceM: d.DistanceM,
				DurationS: d.DurationS,
				SpeedMax:  ptrFloat(d.MaxSpeedMps),
			}
			if d.EndTs != nil {
				ed.EndDate = d.EndTs.Format("2006-01-02T15:04:05Z")
			}
			allDrives = append(allDrives, ed)
		}
	}
	w.Header().Set("X-Export-Partial", strconv.FormatBool(partial))

	if format == "json" {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", "attachment; filename=teslasync-drives.json")
		_ = json.NewEncoder(w).Encode(allDrives)
		return
	}

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=teslasync-drives.csv")
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"id", "vehicle_id", "start_date", "end_date", "distance_m", "duration_s", "max_speed_mps"})
	for _, d := range allDrives {
		_ = cw.Write([]string{
			strconv.FormatInt(d.ID, 10),
			strconv.FormatInt(d.VehicleID, 10),
			d.StartDate,
			d.EndDate,
			fmt.Sprintf("%.2f", d.DistanceM),
			strconv.FormatInt(d.DurationS, 10),
			fmt.Sprintf("%.1f", d.SpeedMax),
		})
	}
	cw.Flush()
}

func exportCharging(
	w http.ResponseWriter,
	r *http.Request,
	vehicleRepo *vehicledb.VehicleRepo,
	chargingRepo *chargingdb.ChargingRepo,
	format string,
	startTime, endTime time.Time,
) {
	vehicles, err := vehicleRepo.GetAll(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to fetch vehicles")
		return
	}

	type exportSession struct {
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

	var allSessions []exportSession
	partial := false
	for _, v := range vehicles {
		sessions, err := chargingRepo.GetByVehicle(r.Context(), v.ID, 500, 0, startTime, endTime)
		if err != nil {
			log.Warn().Err(err).Int64("vehicle_id", v.ID).Msg("export charging: skipped vehicle after query failure")
			partial = true
			continue
		}
		if len(sessions) >= 500 {
			partial = true
		}
		for _, s := range sessions {
			es := exportSession{
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
	}
	w.Header().Set("X-Export-Partial", strconv.FormatBool(partial))

	if format == "json" {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", "attachment; filename=teslasync-charging.json")
		_ = json.NewEncoder(w).Encode(allSessions)
		return
	}

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=teslasync-charging.csv")
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"id", "vehicle_id", "started_at", "ended_at", "total_energy_added_wh", "start_soc_pct", "end_soc_pct", "peak_power_w", "duration_s"})
	for _, s := range allSessions {
		_ = cw.Write([]string{
			strconv.FormatInt(s.ID, 10),
			strconv.FormatInt(s.VehicleID, 10),
			s.StartedAt,
			s.EndedAt,
			fmt.Sprintf("%.2f", s.EnergyAdded),
			fmt.Sprintf("%.1f", s.StartSocPct),
			fmt.Sprintf("%.1f", s.EndSocPct),
			fmt.Sprintf("%.1f", s.PeakPowerW),
			fmt.Sprintf("%.0f", s.DurationS),
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

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	httpx.WriteJSON(w, status, data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

func pagination(r *http.Request) (limit, offset int) {
	return apiparams.Pagination(r)
}

func parseDateRange(r *http.Request) (startTime, endTime time.Time) {
	return apiparams.ParseDateRange(r)
}
