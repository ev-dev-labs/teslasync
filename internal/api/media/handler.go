package media

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// MediaHandler serves media playback endpoints backed by the signal-log
// change feed via signal.StateReader (ADR-002). The reader
// forward-folds emissions, so consecutive rows always carry the most
// recently observed value for every projected signal — eliminating the
// "Spotify vanishing" phantom-empty-row regression on /media/playback-history.
type MediaHandler struct {
	state signal.StateReader
	live  signal.LiveStateReader
}

// Signal → JSON field mappings for media projection.
// Signal names must match signal_types.go; field names must match
// vehiclemodel.MediaSnapshot JSON tags.
var mediaMappings = []signal.FieldMapping{
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

// mediaIdentityCollapseFields is the tuple that defines a "distinct"
// playback-history row in the UI: a row is considered the same listening
// session as the previous row when status / title / artist / album / source
// are all identical, and Timeline collapses consecutive duplicates of this
// tuple. Volume changes, elapsed-position ticks, and station re-tunes do
// NOT split a row.
var mediaIdentityCollapseFields = []string{
	"playback_status",
	"now_playing_title",
	"now_playing_artist",
	"now_playing_album",
	"playback_source",
}

func NewMediaHandler(state signal.StateReader, live signal.LiveStateReader) *MediaHandler {
	return &MediaHandler{state: state, live: live}
}

// List returns media history derived from the signal-log change feed.
// In list mode the reader forward-folds emissions and collapses
// consecutive rows whose media-identity tuple is unchanged.
func (h *MediaHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	from := time.Now().AddDate(0, 0, -7)
	to := time.Now()
	if start, end := apiparams.ParseDateRange(r); !start.IsZero() {
		from = start
		if !end.IsZero() {
			to = end
		}
	}

	rows, err := h.state.Timeline(r.Context(), vehicleID, mediaMappings, from, to, signal.TimelineOptions{
		CollapseBy: mediaIdentityCollapseFields,
	})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get media data from signal_log")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get media data")
		return
	}

	result := make([]map[string]any, 0, len(rows))
	for i, row := range rows {
		m := make(map[string]any, len(row.Fields)+3)
		for k, v := range row.Fields {
			m[k] = v
		}
		m["ts"] = row.Timestamp
		m["created_at"] = row.Timestamp
		m["id"] = i + 1
		result = append(result, m)
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}

// Latest returns the most-recent media values as of now, derived from
// the forward-folded signal-log state. When the vehicle has no
// signal_log rows yet (fresh import, brand-new VIN, or post-purge) the
// canonical 11-key media shape is returned with all values nil — the
// frontend handles per-field nil but crashes on absent keys.
func (h *MediaHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.live.LiveState(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest media data")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get latest media data")
		return
	}

	result := make(map[string]any, len(mediaMappings))
	for _, m := range mediaMappings {
		if v, ok := snap[m.Signal]; ok {
			result[m.Field] = v
		} else {
			result[m.Field] = nil
		}
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}
