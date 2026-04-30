package api

import (
	"encoding/json"
)

// ---------------------------------------------------------------------------
// Tesla response parsing
// ---------------------------------------------------------------------------

// Tesla calendar_history response envelope.
type teslaCalendarHistoryResponse struct {
	Response struct {
		SerialNumber   string            `json:"serial_number"`
		Period         string            `json:"period"`
		TimeSeriesData []json.RawMessage `json:"time_series"`
	} `json:"response"`
}

// Tesla telemetry_history response envelope.
type teslaTelemetryHistoryResponse struct {
	Response struct {
		Data []json.RawMessage `json:"data"`
	} `json:"response"`
}
