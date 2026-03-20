package api

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/teslasync/teslasync/internal/database"
)

// NewExportHandler returns a handler for data export endpoints.
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
	}

	if format == "json" {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", "attachment; filename=teslasync-drives.json")
		json.NewEncoder(w).Encode(allDrives)
		return
	}

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=teslasync-drives.csv")
	cw := csv.NewWriter(w)
	cw.Write([]string{"id", "vehicle_id", "start_date", "end_date", "distance", "duration_min", "speed_max"})
	for _, d := range allDrives {
		cw.Write([]string{
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
	}

	if format == "json" {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", "attachment; filename=teslasync-charging.json")
		json.NewEncoder(w).Encode(allSessions)
		return
	}

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=teslasync-charging.csv")
	cw := csv.NewWriter(w)
	cw.Write([]string{"id", "vehicle_id", "start_date", "end_date", "energy_added_kwh", "start_battery", "end_battery", "charger_power", "duration_min"})
	for _, s := range allSessions {
		cw.Write([]string{
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

func ptrInt(p *int) int {
	if p != nil {
		return *p
	}
	return 0
}
