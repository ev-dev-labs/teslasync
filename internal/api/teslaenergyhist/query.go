package teslaenergyhist

import (
	"encoding/json"
	"fmt"
	"time"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

// parseEnergyHistoryResponse parses Tesla calendar_history kind=energy response.
func parseEnergyHistoryResponse(body []byte, siteID int64, period string) ([]*teslamodel.TeslaEnergyHistory, error) {
	var resp teslaCalendarHistoryResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal energy history: %w", err)
	}

	var entries []*teslamodel.TeslaEnergyHistory
	for _, raw := range resp.Response.TimeSeriesData {
		var point struct {
			Timestamp        string   `json:"timestamp"`
			SolarEnergy      *float64 `json:"solar_energy_exported"`
			BatteryEnergyIn  *float64 `json:"battery_energy_imported_from_grid"`
			BatteryEnergyOut *float64 `json:"battery_energy_exported_to_grid"`
			GridEnergyIn     *float64 `json:"grid_energy_imported"`
			GridEnergyOut    *float64 `json:"grid_energy_exported_from_solar"`
			ConsumerEnergy   *float64 `json:"consumer_energy_imported_from_grid"`
		}
		if err := json.Unmarshal(raw, &point); err != nil {
			continue
		}
		ts, err := time.Parse(time.RFC3339, point.Timestamp)
		if err != nil {
			continue
		}
		entries = append(entries, &teslamodel.TeslaEnergyHistory{
			EnergySiteID:       siteID,
			Period:             period,
			Timestamp:          ts,
			SolarEnergyWh:      point.SolarEnergy,
			BatteryEnergyInWh:  point.BatteryEnergyIn,
			BatteryEnergyOutWh: point.BatteryEnergyOut,
			GridEnergyInWh:     point.GridEnergyIn,
			GridEnergyOutWh:    point.GridEnergyOut,
			ConsumerEnergyWh:   point.ConsumerEnergy,
		})
	}
	return entries, nil
}

// parseBackupHistoryResponse parses Tesla calendar_history kind=backup response.
func parseBackupHistoryResponse(body []byte, siteID int64, period string) ([]*teslamodel.TeslaEnergyBackupEvent, error) {
	var resp teslaCalendarHistoryResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal backup history: %w", err)
	}

	var entries []*teslamodel.TeslaEnergyBackupEvent
	for _, raw := range resp.Response.TimeSeriesData {
		var point struct {
			Timestamp string `json:"timestamp"`
			Duration  int    `json:"duration"`
		}
		if err := json.Unmarshal(raw, &point); err != nil {
			continue
		}
		ts, err := time.Parse(time.RFC3339, point.Timestamp)
		if err != nil {
			continue
		}
		entries = append(entries, &teslamodel.TeslaEnergyBackupEvent{
			EnergySiteID:    siteID,
			Period:          period,
			Timestamp:       ts,
			DurationSeconds: point.Duration,
		})
	}
	return entries, nil
}

// parseWCChargingResponse parses Tesla telemetry_history kind=charge response.
func parseWCChargingResponse(body []byte, siteID int64) ([]*teslamodel.TeslaEnergyWCCharging, error) {
	var resp teslaTelemetryHistoryResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal wc charging history: %w", err)
	}

	var entries []*teslamodel.TeslaEnergyWCCharging
	for _, raw := range resp.Response.Data {
		var point struct {
			Timestamp string   `json:"timestamp"`
			DIN       *string  `json:"din"`
			EnergyWh  *float64 `json:"energy_wh"`
		}
		if err := json.Unmarshal(raw, &point); err != nil {
			continue
		}
		ts, err := time.Parse(time.RFC3339, point.Timestamp)
		if err != nil {
			continue
		}
		entries = append(entries, &teslamodel.TeslaEnergyWCCharging{
			EnergySiteID: siteID,
			DIN:          point.DIN,
			Timestamp:    ts,
			EnergyWh:     point.EnergyWh,
		})
	}
	return entries, nil
}
