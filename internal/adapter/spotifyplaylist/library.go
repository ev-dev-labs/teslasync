package spotifyplaylist

import (
	"context"
	"errors"
	"net/http"
	"net/url"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
)

const LibraryTrackScope = "user-library-modify"

func (c *Client) LibraryAuthorizationURL(state, challenge string) string {
	return c.authorizationURL(state, challenge, LibraryTrackScope)
}

func (c *Client) ExchangeLibrary(ctx context.Context, code, verifier string) (domain.SpotifyGrant, error) {
	return c.exchange(ctx, code, verifier, LibraryTrackScope)
}

func (c *Client) SaveLibraryTrack(ctx context.Context, token, id string) error {
	if !opaqueValue(token, 1, 4096) || !providerID.MatchString(id) {
		return errors.New("invalid Spotify library track request")
	}
	query := url.Values{"uris": {"spotify:track:" + id}}
	return c.call(ctx, "save_library_track", http.MethodPut, c.api+"/v1/me/library?"+query.Encode(),
		token, "", nil, http.StatusOK, nil)
}
