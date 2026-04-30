package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// MediaHandler serves media playback endpoints backed by signal_log.
type MediaHandler struct {
	signalLogReader *database.SignalLogReader
}

// Signal → JSON field mappings for media pivot queries.
// Signal names must match signal_types.go; field names must match models.MediaSnapshot JSON tags.
var mediaMappings = []database.PivotMapping{
	{Signal: "MediaPlaybackStatus", Field: "playback_status"},
	{Signal: "MediaNowPlayingTitle", Field: "now_playing_title"},
	{Signal: "MediaNowPlayingArtist", Field: "now_playing_artist"},
	{Signal: "MediaNowPlayingAlbum", Field: "now_playing_album"},
	{Signal: "MediaPlaybackSource", Field: "playback_source"},
	{Signal: "MediaAudioVolume", Field: "audio_volume"},
	{Signal: "MediaAudioVolumeMax", Field: "audio_volume_max"},
	{Signal: "MediaAudioVolumeIncrement", Field: "audio_volume_increment"},
	{Signal: "MediaNowPlayingStation", Field: "now_playing_station"},
	{Signal: "MediaNowPlayingDuration", Field: "now_playing_duration"},
	{Signal: "MediaNowPlayingElapsed", Field: "now_playing_elapsed"},
}

func NewMediaHandler(slr *database.SignalLogReader) *MediaHandler {
	return &MediaHandler{signalLogReader: slr}
}

// List returns media history from signal_log via SignalTracePivotFlat.
func (h *MediaHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	from := time.Now().AddDate(0, 0, -7)
	to := time.Now()
	if start, end := parseDateRange(r); !start.IsZero() {
		from = start
		if !end.IsZero() {
			to = end
		}
	}

	rows, err := h.signalLogReader.SignalTracePivotFlat(r.Context(),
		vehicleID, mediaMappings, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get media data from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get media data")
		return
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	for i, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
		}
		row["id"] = i + 1
	}
	writeJSON(w, http.StatusOK, rows)
}

// Latest returns the most recent media values via SnapshotAt(now).
func (h *MediaHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.signalLogReader.SnapshotAt(r.Context(), vehicleID, time.Now())
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest media data")
		writeError(w, http.StatusInternalServerError, "failed to get latest media data")
		return
	}

	result := make(map[string]interface{})
	for _, m := range mediaMappings {
		if v, ok := snap[m.Signal]; ok {
			result[m.Field] = v
		}
	}
	writeJSON(w, http.StatusOK, result)
}
