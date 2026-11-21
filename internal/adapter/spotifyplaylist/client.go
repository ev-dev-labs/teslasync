package spotifyplaylist

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
)

const PlaylistScope = "playlist-modify-private"

var providerID = regexp.MustCompile(`^[A-Za-z0-9]{22}$`)
var publicClientID = regexp.MustCompile(`^[A-Fa-f0-9]{32}$`)

type Client struct {
	http        *http.Client
	accounts    string
	api         string
	clientID    string
	redirectURI string
}

func New(clientID, redirectURI string, options ...Option) (*Client, error) {
	redirect, err := url.Parse(redirectURI)
	if !publicClientID.MatchString(clientID) || err != nil ||
		redirect.User != nil || redirect.Hostname() == "" || redirect.RawQuery != "" || redirect.Fragment != "" ||
		redirect.Path != "/api/v1/media/spotify/callback" || (redirect.Scheme != "https" &&
		!(redirect.Scheme == "http" && (redirect.Hostname() == "127.0.0.1" || redirect.Hostname() == "::1"))) {
		return nil, errors.New("invalid Spotify playlist connector configuration")
	}
	c := &Client{
		accounts: "https://accounts.spotify.com", api: "https://api.spotify.com",
		clientID: clientID, redirectURI: redirectURI,
		http: &http.Client{
			Timeout:       12 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
	c.http.Transport = http.DefaultTransport
	for _, option := range options {
		option(c)
	}
	c.http.Transport = otelhttp.NewTransport(c.http.Transport, otelhttp.WithFilter(func(r *http.Request) bool {
		// Span names below cover resource-specific calls without recording private Spotify IDs.
		return r.URL.Path != "/v1/me/library" &&
			!strings.HasPrefix(r.URL.Path, "/v1/tracks/") && !strings.HasPrefix(r.URL.Path, "/v1/playlists/") &&
			!strings.HasPrefix(r.URL.Path, "/v1/episodes/")
	}))
	return c, nil
}

type Option func(*Client)

func WithTransport(transport http.RoundTripper) Option {
	return func(c *Client) { c.http.Transport = transport }
}

func (c *Client) AuthorizationURL(state, challenge string) string {
	return c.authorizationURL(state, challenge, PlaylistScope)
}

func (c *Client) authorizationURL(state, challenge, scope string) string {
	query := url.Values{
		"client_id": {c.clientID}, "redirect_uri": {c.redirectURI}, "response_type": {"code"},
		"state": {state}, "scope": {scope}, "code_challenge": {challenge}, "code_challenge_method": {"S256"},
	}
	return c.accounts + "/authorize?" + query.Encode()
}

func (c *Client) Exchange(ctx context.Context, code, verifier string) (domain.SpotifyGrant, error) {
	return c.exchange(ctx, code, verifier, PlaylistScope)
}

func (c *Client) exchange(ctx context.Context, code, verifier, scope string) (domain.SpotifyGrant, error) {
	if !opaqueValue(code, 1, 4096) || !opaqueValue(verifier, 43, 128) {
		return domain.SpotifyGrant{}, errors.New("invalid Spotify authorization response")
	}
	form := url.Values{
		"grant_type": {"authorization_code"}, "redirect_uri": {c.redirectURI}, "client_id": {c.clientID},
		"code": {code}, "code_verifier": {verifier},
	}
	var response struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		Scope       string `json:"scope"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := c.call(ctx, "exchange_code", http.MethodPost, c.accounts+"/api/token", "", "application/x-www-form-urlencoded",
		[]byte(form.Encode()), http.StatusOK, &response); err != nil {
		return domain.SpotifyGrant{}, err
	}
	if !strings.EqualFold(response.TokenType, "Bearer") || strings.TrimSpace(response.Scope) != scope ||
		response.ExpiresIn <= 0 || !opaqueValue(response.AccessToken, 1, 4096) {
		return domain.SpotifyGrant{}, errors.New("Spotify did not grant the requested authorization")
	}
	return domain.SpotifyGrant{AccessToken: response.AccessToken, ExpiresIn: time.Duration(min(response.ExpiresIn, 3600)) * time.Second}, nil
}

func (c *Client) Track(ctx context.Context, token, id string) (domain.CatalogTrack, error) {
	if !providerID.MatchString(id) || !opaqueValue(token, 1, 4096) {
		return domain.CatalogTrack{}, errors.New("invalid Spotify track reference")
	}
	var response struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Duration int    `json:"duration_ms"`
		Playable *bool  `json:"is_playable"`
		Artists  []struct {
			Name string `json:"name"`
		} `json:"artists"`
	}
	if err := c.call(ctx, "read_track", http.MethodGet, c.api+"/v1/tracks/"+id, token, "", nil, http.StatusOK, &response); err != nil {
		return domain.CatalogTrack{}, err
	}
	if response.ID != id || response.Name == "" || response.Duration < 1000 || response.Duration > 14_400_000 ||
		(response.Playable != nil && !*response.Playable) || len(response.Artists) == 0 || len(response.Artists) > 30 {
		return domain.CatalogTrack{}, errors.New("Spotify did not return the available track identity")
	}
	track := domain.CatalogTrack{ID: id, Title: response.Name, DurationS: (response.Duration + 999) / 1000, Artists: make([]string, 0, len(response.Artists))}
	for _, artist := range response.Artists {
		if artist.Name == "" {
			return domain.CatalogTrack{}, errors.New("Spotify track response is missing an artist")
		}
		track.Artists = append(track.Artists, artist.Name)
	}
	return track, nil
}

func (c *Client) CreatePrivate(ctx context.Context, token, name string) (string, error) {
	if !opaqueValue(token, 1, 4096) || strings.TrimSpace(name) == "" || !utf8.ValidString(name) ||
		utf8.RuneCountInString(name) > 100 || strings.ContainsAny(name, "\r\n\t\x00") {
		return "", errors.New("invalid Spotify playlist request")
	}
	body, _ := json.Marshal(struct {
		Name          string `json:"name"`
		Public        bool   `json:"public"`
		Collaborative bool   `json:"collaborative"`
	}{Name: name})
	var response struct {
		ID     string `json:"id"`
		Public *bool  `json:"public"`
	}
	if err := c.call(ctx, "create_private_playlist", http.MethodPost, c.api+"/v1/me/playlists", token, "application/json",
		body, http.StatusCreated, &response); err != nil {
		return "", err
	}
	if !providerID.MatchString(response.ID) || response.Public == nil || *response.Public {
		return "", &domain.SpotifyFailure{Operation: "create_private_playlist", Status: http.StatusCreated, Unknown: true}
	}
	return response.ID, nil
}

func (c *Client) AddTracks(ctx context.Context, token, playlistID string, trackIDs []string) error {
	if !opaqueValue(token, 1, 4096) || !providerID.MatchString(playlistID) || len(trackIDs) == 0 || len(trackIDs) > 100 {
		return errors.New("invalid Spotify playlist items request")
	}
	uris := make([]string, 0, len(trackIDs))
	seen := make(map[string]bool, len(trackIDs))
	for _, id := range trackIDs {
		if !providerID.MatchString(id) || seen[id] {
			return errors.New("invalid or duplicate Spotify track reference")
		}
		seen[id] = true
		uris = append(uris, "spotify:track:"+id)
	}
	body, _ := json.Marshal(struct {
		URIs []string `json:"uris"`
	}{URIs: uris})
	var response struct {
		SnapshotID string `json:"snapshot_id"`
	}
	if err := c.call(ctx, "add_playlist_items", http.MethodPost, c.api+"/v1/playlists/"+playlistID+"/items", token,
		"application/json", body, http.StatusCreated, &response); err != nil {
		return err
	}
	if !opaqueValue(response.SnapshotID, 1, 256) {
		return &domain.SpotifyFailure{Operation: "add_playlist_items", Status: http.StatusCreated, Unknown: true}
	}
	return nil
}

func (c *Client) call(ctx context.Context, operation, method, endpoint, token, contentType string, body []byte, expected int, dst any) error {
	ctx, span := otel.Tracer("spotifyplaylist").Start(ctx, "spotify."+operation)
	defer span.End()
	req, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if err != nil {
		return &domain.SpotifyFailure{Operation: operation}
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Accept", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return &domain.SpotifyFailure{Operation: operation, Unknown: true}
	}
	defer res.Body.Close()
	if res.StatusCode != expected {
		rejected := res.StatusCode >= 400 && res.StatusCode < 500 && res.StatusCode != http.StatusRequestTimeout
		return &domain.SpotifyFailure{Operation: operation, Status: res.StatusCode, Unknown: !rejected}
	}
	if dst == nil {
		if payload, err := io.ReadAll(io.LimitReader(res.Body, 1)); err != nil || len(payload) != 0 {
			return &domain.SpotifyFailure{Operation: operation, Status: res.StatusCode, Unknown: true}
		}
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 1<<20+1))
	if err != nil || len(data) > 1<<20 || json.Unmarshal(data, dst) != nil {
		return &domain.SpotifyFailure{Operation: operation, Status: res.StatusCode, Unknown: true}
	}
	return nil
}

func opaqueValue(value string, low, high int) bool {
	if len(value) < low || len(value) > high {
		return false
	}
	for _, char := range value {
		if char < 0x21 || char > 0x7e {
			return false
		}
	}
	return true
}
