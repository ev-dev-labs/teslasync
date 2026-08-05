package nhtsa

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

const (
	defaultVPICBaseURL   = "https://vpic.nhtsa.dot.gov/api/vehicles"
	defaultSafetyBaseURL = "https://api.nhtsa.gov"
	defaultTimeout       = 8 * time.Second
	defaultCacheTTL      = 6 * time.Hour
	defaultMaxBodyBytes  = int64(1 << 20)
	defaultUserAgent     = "TeslaSync/2.0"
	maxRecallRecords     = 500

	vpicDocumentationURL   = "https://vpic.nhtsa.dot.gov/api/"
	recallDocumentationURL = "https://api.nhtsa.gov/recalls/recallsByVehicle"
)

type Config struct {
	VPICBaseURL   string
	SafetyBaseURL string
	Timeout       time.Duration
	CacheTTL      time.Duration
	MaxBodyBytes  int64
	HTTPClient    *http.Client
	UserAgent     string
}

type Client struct {
	vpicBaseURL   string
	safetyBaseURL string
	timeout       time.Duration
	cacheTTL      time.Duration
	maxBodyBytes  int64
	httpClient    *http.Client
	userAgent     string
	now           func() time.Time

	mu          sync.RWMutex
	decodeCache map[string]cachedDecode
	recallCache map[string]cachedRecalls
}

type responseValidator struct {
	etag         string
	lastModified string
}

type responseMetadata struct {
	validator responseValidator
	expiresAt time.Time
}

type cachedDecode struct {
	result    VINDecodeResult
	validator responseValidator
	expiresAt time.Time
}

type cachedRecalls struct {
	result    RecallResult
	validator responseValidator
	expiresAt time.Time
}

func NewClient(cfg Config) *Client {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	cacheTTL := cfg.CacheTTL
	if cacheTTL <= 0 {
		cacheTTL = defaultCacheTTL
	}
	maxBodyBytes := cfg.MaxBodyBytes
	if maxBodyBytes <= 0 {
		maxBodyBytes = defaultMaxBodyBytes
	}
	vpicBase := strings.TrimRight(strings.TrimSpace(cfg.VPICBaseURL), "/")
	if vpicBase == "" {
		vpicBase = defaultVPICBaseURL
	}
	safetyBase := strings.TrimRight(strings.TrimSpace(cfg.SafetyBaseURL), "/")
	if safetyBase == "" {
		safetyBase = defaultSafetyBaseURL
	}
	userAgent := strings.TrimSpace(cfg.UserAgent)
	if userAgent == "" {
		userAgent = defaultUserAgent
	}

	var client http.Client
	if cfg.HTTPClient != nil {
		client = *cfg.HTTPClient
	}
	baseTransport := client.Transport
	if baseTransport == nil {
		baseTransport = http.DefaultTransport
	}
	client.Transport = otelhttp.NewTransport(baseTransport)
	client.Timeout = timeout

	return &Client{
		vpicBaseURL:   vpicBase,
		safetyBaseURL: safetyBase,
		timeout:       timeout,
		cacheTTL:      cacheTTL,
		maxBodyBytes:  maxBodyBytes,
		httpClient:    &client,
		userAgent:     userAgent,
		now:           time.Now,
		decodeCache:   make(map[string]cachedDecode),
		recallCache:   make(map[string]cachedRecalls),
	}
}

type vinDecodeEnvelope struct {
	Count   int `json:"Count"`
	Results []struct {
		Make              string `json:"Make"`
		Model             string `json:"Model"`
		ModelYear         string `json:"ModelYear"`
		Manufacturer      string `json:"Manufacturer"`
		VehicleType       string `json:"VehicleType"`
		PlantCountry      string `json:"PlantCountry"`
		PlantState        string `json:"PlantState"`
		PlantCity         string `json:"PlantCity"`
		VehicleDescriptor string `json:"VehicleDescriptor"`
		ErrorCode         string `json:"ErrorCode"`
	} `json:"Results"`
}

func (c *Client) DecodeVIN(ctx context.Context, vin string, opts FetchOptions) (VINDecodeResult, error) {
	normalizedVIN := strings.ToUpper(strings.TrimSpace(vin))
	if !isValidVIN(normalizedVIN) {
		return VINDecodeResult{}, newUpstreamError("vehicle decode", ErrorKindValidation, 0, ErrInvalidRequest)
	}

	cacheKey := hashVIN(normalizedVIN)
	now := c.now().UTC()
	cached, hasCached := c.getDecodeCache(cacheKey)
	if hasCached && !opts.Refresh && now.Before(cached.expiresAt) {
		return decodeCacheHit(cached.result, now), nil
	}

	endpoint := c.vpicBaseURL + "/DecodeVinValuesExtended/" + url.PathEscape(normalizedVIN)
	values := url.Values{}
	values.Set("format", "json")
	endpoint += "?" + values.Encode()

	validator := responseValidator{}
	if hasCached {
		validator = cached.validator
	}
	body, meta, notModified, err := c.fetchJSON(ctx, "vehicle decode", endpoint, validator)
	if err != nil {
		return VINDecodeResult{}, fmt.Errorf("decode vehicle with NHTSA: %w", err)
	}
	if notModified {
		if !hasCached {
			return VINDecodeResult{}, newUpstreamError("vehicle decode", ErrorKindMalformed, http.StatusNotModified, ErrMalformedResponse)
		}
		cached.expiresAt = meta.expiresAt
		cached.validator = meta.validator
		cached.result.Source.CheckedAt = now
		cached.result.Source.ExpiresAt = timePointer(meta.expiresAt)
		cached.result.Source.FromCache = true
		c.putDecodeCache(cacheKey, cached)
		return cached.result, nil
	}

	var envelope vinDecodeEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return VINDecodeResult{}, newUpstreamError("vehicle decode", ErrorKindMalformed, 0, ErrMalformedResponse)
	}
	if envelope.Count < 1 || len(envelope.Results) != 1 {
		return VINDecodeResult{}, newUpstreamError("vehicle decode", ErrorKindMalformed, 0, ErrMalformedResponse)
	}
	raw := envelope.Results[0]
	if code := strings.TrimSpace(raw.ErrorCode); code != "" && code != "0" {
		return VINDecodeResult{}, newUpstreamError("vehicle decode", ErrorKindMalformed, 0, ErrMalformedResponse)
	}
	modelYear, err := strconv.Atoi(strings.TrimSpace(raw.ModelYear))
	if err != nil || modelYear < 1886 || modelYear > now.Year()+2 ||
		strings.TrimSpace(raw.Make) == "" || strings.TrimSpace(raw.Model) == "" {
		return VINDecodeResult{}, newUpstreamError("vehicle decode", ErrorKindMalformed, 0, ErrMalformedResponse)
	}

	fetchedAt := now
	result := VINDecodeResult{
		Vehicle: DecodedVehicle{
			Make:              strings.TrimSpace(raw.Make),
			Model:             strings.TrimSpace(raw.Model),
			ModelYear:         modelYear,
			Manufacturer:      strings.TrimSpace(raw.Manufacturer),
			VehicleType:       strings.TrimSpace(raw.VehicleType),
			PlantCountry:      strings.TrimSpace(raw.PlantCountry),
			PlantState:        strings.TrimSpace(raw.PlantState),
			PlantCity:         strings.TrimSpace(raw.PlantCity),
			VehicleDescriptor: strings.TrimSpace(raw.VehicleDescriptor),
		},
		Source: SourceMetadata{
			ID:          SourceIDVehicleDecoder,
			Name:        "NHTSA vPIC vehicle decoder",
			Status:      SourceStatusAvailable,
			RecordCount: 1,
			FetchedAt:   &fetchedAt,
			CheckedAt:   now,
			ExpiresAt:   timePointer(meta.expiresAt),
			FromCache:   false,
			SourceURL:   vpicDocumentationURL,
			Detail:      nil,
		},
	}
	c.putDecodeCache(cacheKey, cachedDecode{result: result, validator: meta.validator, expiresAt: meta.expiresAt})
	return result, nil
}

type recallEnvelope struct {
	Count   int `json:"Count"`
	Results []struct {
		Manufacturer       string `json:"Manufacturer"`
		CampaignNumber     string `json:"NHTSACampaignNumber"`
		ParkIt             bool   `json:"parkIt"`
		ParkOutside        bool   `json:"parkOutSide"`
		OverTheAirUpdate   bool   `json:"overTheAirUpdate"`
		ReportReceivedDate string `json:"ReportReceivedDate"`
		Component          string `json:"Component"`
		Summary            string `json:"Summary"`
		Consequence        string `json:"Consequence"`
		Remedy             string `json:"Remedy"`
		Notes              string `json:"Notes"`
		ModelYear          string `json:"ModelYear"`
		Make               string `json:"Make"`
		Model              string `json:"Model"`
	} `json:"results"`
}

func (c *Client) Recalls(ctx context.Context, query VehicleQuery, opts FetchOptions) (RecallResult, error) {
	query.Make = strings.TrimSpace(query.Make)
	query.Model = strings.TrimSpace(query.Model)
	if query.Make == "" || query.Model == "" || query.ModelYear < 1886 || query.ModelYear > c.now().UTC().Year()+2 {
		return RecallResult{}, newUpstreamError("recalls", ErrorKindValidation, 0, ErrInvalidRequest)
	}

	cacheKey := recallCacheKey(query)
	now := c.now().UTC()
	cached, hasCached := c.getRecallCache(cacheKey)
	if hasCached && !opts.Refresh && now.Before(cached.expiresAt) {
		return recallsCacheHit(cached.result, now), nil
	}

	values := url.Values{}
	values.Set("make", query.Make)
	values.Set("model", query.Model)
	values.Set("modelYear", strconv.Itoa(query.ModelYear))
	endpoint := c.safetyBaseURL + "/recalls/recallsByVehicle?" + values.Encode()

	validator := responseValidator{}
	if hasCached {
		validator = cached.validator
	}
	body, meta, notModified, err := c.fetchJSON(ctx, "recalls", endpoint, validator)
	if err != nil {
		return RecallResult{}, fmt.Errorf("fetch NHTSA recalls: %w", err)
	}
	if notModified {
		if !hasCached {
			return RecallResult{}, newUpstreamError("recalls", ErrorKindMalformed, http.StatusNotModified, ErrMalformedResponse)
		}
		cached.expiresAt = meta.expiresAt
		cached.validator = meta.validator
		cached.result.Source.CheckedAt = now
		cached.result.Source.ExpiresAt = timePointer(meta.expiresAt)
		cached.result.Source.FromCache = true
		c.putRecallCache(cacheKey, cached)
		return cloneRecallResult(cached.result), nil
	}

	var envelope recallEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return RecallResult{}, newUpstreamError("recalls", ErrorKindMalformed, 0, ErrMalformedResponse)
	}
	if envelope.Count < 0 || len(envelope.Results) > maxRecallRecords {
		return RecallResult{}, newUpstreamError("recalls", ErrorKindMalformed, 0, ErrMalformedResponse)
	}

	recalls := make([]Recall, 0, len(envelope.Results))
	for _, raw := range envelope.Results {
		campaign := strings.TrimSpace(raw.CampaignNumber)
		modelYear, parseErr := strconv.Atoi(strings.TrimSpace(raw.ModelYear))
		if campaign == "" || parseErr != nil || modelYear < 1886 {
			return RecallResult{}, newUpstreamError("recalls", ErrorKindMalformed, 0, ErrMalformedResponse)
		}
		recalls = append(recalls, Recall{
			Manufacturer:      strings.TrimSpace(raw.Manufacturer),
			CampaignNumber:    campaign,
			ReportReceivedAt:  parseRecallDate(raw.ReportReceivedDate),
			Component:         strings.TrimSpace(raw.Component),
			Summary:           strings.TrimSpace(raw.Summary),
			Consequence:       strings.TrimSpace(raw.Consequence),
			Remedy:            strings.TrimSpace(raw.Remedy),
			Notes:             strings.TrimSpace(raw.Notes),
			ModelYear:         modelYear,
			Make:              strings.TrimSpace(raw.Make),
			Model:             strings.TrimSpace(raw.Model),
			ParkIt:            raw.ParkIt,
			ParkOutside:       raw.ParkOutside,
			OverTheAirUpdate:  raw.OverTheAirUpdate,
			SourceDocumentURL: campaignDocumentURL(campaign),
		})
	}

	fetchedAt := now
	result := RecallResult{
		Recalls: recalls,
		Source: SourceMetadata{
			ID:          SourceIDRecalls,
			Name:        "NHTSA recalls",
			Status:      SourceStatusAvailable,
			RecordCount: len(recalls),
			FetchedAt:   &fetchedAt,
			CheckedAt:   now,
			ExpiresAt:   timePointer(meta.expiresAt),
			FromCache:   false,
			SourceURL:   recallDocumentationURL,
			Detail:      nil,
		},
	}
	c.putRecallCache(cacheKey, cachedRecalls{result: cloneRecallResult(result), validator: meta.validator, expiresAt: meta.expiresAt})
	return result, nil
}

func (c *Client) fetchJSON(
	ctx context.Context,
	operation string,
	endpoint string,
	validator responseValidator,
) ([]byte, responseMetadata, bool, error) {
	callCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(callCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, responseMetadata{}, false, newUpstreamError(operation, ErrorKindValidation, 0, ErrInvalidRequest)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.userAgent)
	if validator.etag != "" {
		req.Header.Set("If-None-Match", validator.etag)
	}
	if validator.lastModified != "" {
		req.Header.Set("If-Modified-Since", validator.lastModified)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		switch {
		case requestTimedOut(ctx, callCtx, err):
			return nil, responseMetadata{}, false, newUpstreamError(operation, ErrorKindTimeout, 0, ErrUpstreamTimeout)
		case ctx.Err() != nil:
			return nil, responseMetadata{}, false, newUpstreamError(operation, ErrorKindCanceled, 0, ctx.Err())
		case callCtx.Err() != nil:
			return nil, responseMetadata{}, false, newUpstreamError(operation, ErrorKindCanceled, 0, callCtx.Err())
		default:
			return nil, responseMetadata{}, false, newUpstreamError(operation, ErrorKindTransport, 0, ErrTransport)
		}
	}
	defer resp.Body.Close()

	now := c.now().UTC()
	meta := responseMetadata{
		validator: responseValidator{
			etag:         strings.TrimSpace(resp.Header.Get("ETag")),
			lastModified: strings.TrimSpace(resp.Header.Get("Last-Modified")),
		},
		expiresAt: responseExpiry(resp.Header.Get("Cache-Control"), now, c.cacheTTL),
	}
	if resp.StatusCode == http.StatusNotModified {
		return nil, meta, true, nil
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, responseMetadata{}, false, newUpstreamError(operation, ErrorKindStatus, resp.StatusCode, ErrUnexpectedStatus)
	}

	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	mediaType, _, parseErr := mime.ParseMediaType(contentType)
	if parseErr != nil || mediaType != "application/json" {
		return nil, responseMetadata{}, false, newUpstreamError(operation, ErrorKindContentType, resp.StatusCode, ErrUnexpectedContentType)
	}
	if resp.ContentLength > c.maxBodyBytes {
		return nil, responseMetadata{}, false, newUpstreamError(operation, ErrorKindOversize, resp.StatusCode, ErrResponseTooLarge)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, c.maxBodyBytes+1))
	if err != nil {
		return nil, responseMetadata{}, false, newUpstreamError(operation, ErrorKindTransport, resp.StatusCode, ErrTransport)
	}
	if int64(len(body)) > c.maxBodyBytes {
		return nil, responseMetadata{}, false, newUpstreamError(operation, ErrorKindOversize, resp.StatusCode, ErrResponseTooLarge)
	}
	return body, meta, false, nil
}

func isValidVIN(vin string) bool {
	if len(vin) != 17 {
		return false
	}
	for _, r := range vin {
		if (r < '0' || r > '9') && (r < 'A' || r > 'Z') {
			return false
		}
		if r == 'I' || r == 'O' || r == 'Q' {
			return false
		}
	}
	return true
}

func hashVIN(vin string) string {
	sum := sha256.Sum256([]byte(vin))
	return hex.EncodeToString(sum[:])
}

func recallCacheKey(query VehicleQuery) string {
	return strings.ToUpper(strings.TrimSpace(query.Make)) + "|" +
		strings.ToUpper(strings.Join(strings.Fields(query.Model), " ")) + "|" +
		strconv.Itoa(query.ModelYear)
}

func parseRecallDate(value string) *time.Time {
	value = strings.TrimSpace(value)
	for _, layout := range []string{"02/01/2006", "01/02/2006", time.RFC3339} {
		if parsed, err := time.Parse(layout, value); err == nil {
			utc := parsed.UTC()
			return &utc
		}
	}
	return nil
}

func campaignDocumentURL(campaign string) string {
	values := url.Values{}
	values.Set("nhtsaId", campaign)
	return "https://www.nhtsa.gov/recalls?" + values.Encode()
}

func responseExpiry(cacheControl string, now time.Time, fallback time.Duration) time.Time {
	for _, directive := range strings.Split(cacheControl, ",") {
		parts := strings.SplitN(strings.TrimSpace(directive), "=", 2)
		if len(parts) == 1 && strings.EqualFold(parts[0], "no-store") {
			return now
		}
		if len(parts) == 2 && strings.EqualFold(parts[0], "max-age") {
			seconds, err := strconv.Atoi(strings.Trim(parts[1], `"`))
			if err == nil && seconds >= 0 {
				return now.Add(time.Duration(seconds) * time.Second)
			}
		}
	}
	return now.Add(fallback)
}

func timePointer(value time.Time) *time.Time {
	v := value.UTC()
	return &v
}

func decodeCacheHit(result VINDecodeResult, now time.Time) VINDecodeResult {
	result.Source.CheckedAt = now
	result.Source.FromCache = true
	return result
}

func recallsCacheHit(result RecallResult, now time.Time) RecallResult {
	result = cloneRecallResult(result)
	result.Source.CheckedAt = now
	result.Source.FromCache = true
	return result
}

func cloneRecallResult(result RecallResult) RecallResult {
	cloned := make([]Recall, len(result.Recalls))
	copy(cloned, result.Recalls)
	result.Recalls = cloned
	return result
}

func (c *Client) getDecodeCache(key string) (cachedDecode, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	item, ok := c.decodeCache[key]
	return item, ok
}

func (c *Client) putDecodeCache(key string, item cachedDecode) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.decodeCache[key] = item
}

func (c *Client) getRecallCache(key string) (cachedRecalls, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	item, ok := c.recallCache[key]
	return item, ok
}

func (c *Client) putRecallCache(key string, item cachedRecalls) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.recallCache[key] = item
}

var _ Provider = (*Client)(nil)
