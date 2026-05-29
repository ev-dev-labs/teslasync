package api

import "github.com/ev-dev-labs/teslasync/internal/signal"

// stateToSignalMap converts a signal.State (named map type) into the bare
// map[string]interface{} expected by legacy parent-package signal helpers.
func stateToSignalMap(s signal.State) map[string]interface{} {
	if s == nil {
		return map[string]interface{}{}
	}
	out := make(map[string]interface{}, len(s))
	for k, v := range s {
		out[k] = v
	}
	return out
}

// timelineRowsToFlat converts ordered TimelineRows into a flat pivot shape
// used by legacy parent-package telemetry endpoints.
func timelineRowsToFlat(rows []signal.TimelineRow) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(rows))
	for _, tr := range rows {
		row := make(map[string]interface{}, len(tr.Fields)+1)
		for k, v := range tr.Fields {
			row[k] = v
		}
		row["ts"] = tr.Timestamp
		out = append(out, row)
	}
	return out
}
