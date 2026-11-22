package spotifyplaylist

import (
	"context"
	"errors"
	"net/http"
	"strings"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
)

const EpisodeProgressScope = "user-read-playback-position"

func (c *Client) EpisodeProgressAuthorizationURL(state, challenge string) string {
	return c.authorizationURL(state, challenge, EpisodeProgressScope)
}

func (c *Client) ExchangeEpisodeProgress(ctx context.Context, code, verifier string) (domain.SpotifyGrant, error) {
	return c.exchange(ctx, code, verifier, EpisodeProgressScope)
}

func (c *Client) EpisodeProgress(ctx context.Context, token, id string) (domain.EpisodeProgress, error) {
	if !opaqueValue(token, 1, 4096) || !providerID.MatchString(id) {
		return domain.EpisodeProgress{}, errors.New("invalid Spotify episode request")
	}
	var response struct {
		ID         string `json:"id"`
		Type       string `json:"type"`
		URI        string `json:"uri"`
		Title      string `json:"name"`
		DurationMS int64  `json:"duration_ms"`
		Playable   bool   `json:"is_playable"`
		Resume     *struct {
			Played     *bool  `json:"fully_played"`
			PositionMS *int64 `json:"resume_position_ms"`
		} `json:"resume_point"`
	}
	if err := c.call(ctx, "read_episode_progress", http.MethodGet, c.api+"/v1/episodes/"+id, token, "", nil, http.StatusOK, &response); err != nil {
		return domain.EpisodeProgress{}, err
	}
	title := strings.TrimSpace(response.Title)
	if response.ID != id || response.URI != "spotify:episode:"+id || response.Type != "episode" ||
		!response.Playable || response.DurationMS <= 0 || response.DurationMS > 86400000 ||
		title == "" || len(title) > 1024 || strings.ContainsAny(title, "\r\n\t\x00") {
		return domain.EpisodeProgress{}, errors.New("unverified Spotify episode")
	}
	result := domain.EpisodeProgress{ID: id, Title: title, DurationS: int((response.DurationMS + 999) / 1000)}
	if point := response.Resume; point != nil && point.Played != nil && point.PositionMS != nil &&
		*point.PositionMS >= 0 && *point.PositionMS <= response.DurationMS {
		result.Completed = point.Played
		seconds := int(*point.PositionMS / 1000)
		if *point.PositionMS == response.DurationMS {
			seconds = result.DurationS
		}
		result.PositionS = &seconds
	}
	return result, nil
}
