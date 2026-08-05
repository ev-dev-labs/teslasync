package nhtsa

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

const (
	defaultCommunicationsBulkBaseURL       = "https://static.nhtsa.gov"
	defaultCommunicationsBulkTimeout       = 2 * time.Minute
	defaultCommunicationsCompressedLimit   = int64(64 << 20)
	defaultCommunicationsUncompressedLimit = int64(2 << 30)
	defaultCommunicationsMaxRows           = 5_000_000
	defaultCommunicationsMaxMatches        = 100_000
	maxCommunicationsCompressionRatio      = 50
	maxCommunicationSummaryRunes           = 20_000
)

var (
	communicationsArtifactPathPattern = regexp.MustCompile(
		`^/odi/ffdd/tsbs/TSBS_RECEIVED_([0-9]{4})(?:-([0-9]{4}))?\.zip$`,
	)
	nhtsaCommunicationIDPattern = regexp.MustCompile(`^[0-9]{6,20}$`)
)

type CommunicationsBulkConfig struct {
	BaseURL              string
	Timeout              time.Duration
	MaxCompressedBytes   int64
	MaxUncompressedBytes int64
	MaxRows              int
	MaxMatches           int
	HTTPClient           *http.Client
	UserAgent            string
}

// CommunicationsBulkClient downloads only allow-listed official NHTSA flat
// files and retains only normalized Tesla communication rows in memory.
type CommunicationsBulkClient struct {
	baseURL              *url.URL
	timeout              time.Duration
	maxCompressedBytes   int64
	maxUncompressedBytes int64
	maxRows              int
	maxMatches           int
	httpClient           *http.Client
	userAgent            string
	now                  func() time.Time
}

func NewCommunicationsBulkClient(cfg CommunicationsBulkConfig) *CommunicationsBulkClient {
	baseURL := strings.TrimSpace(cfg.BaseURL)
	if baseURL == "" {
		baseURL = defaultCommunicationsBulkBaseURL
	}
	parsedBase, err := url.Parse(baseURL)
	if err != nil || parsedBase.Scheme == "" || parsedBase.Host == "" {
		panic("nhtsa.NewCommunicationsBulkClient: invalid base URL")
	}

	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = defaultCommunicationsBulkTimeout
	}
	compressedLimit := cfg.MaxCompressedBytes
	if compressedLimit <= 0 {
		compressedLimit = defaultCommunicationsCompressedLimit
	}
	uncompressedLimit := cfg.MaxUncompressedBytes
	if uncompressedLimit <= 0 {
		uncompressedLimit = defaultCommunicationsUncompressedLimit
	}
	maxRows := cfg.MaxRows
	if maxRows <= 0 {
		maxRows = defaultCommunicationsMaxRows
	}
	maxMatches := cfg.MaxMatches
	if maxMatches <= 0 {
		maxMatches = defaultCommunicationsMaxMatches
	}
	userAgent := strings.TrimSpace(cfg.UserAgent)
	if userAgent == "" {
		userAgent = defaultUserAgent
	}

	var client http.Client
	if cfg.HTTPClient != nil {
		client = *cfg.HTTPClient
	}
	transport := client.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	client.Transport = otelhttp.NewTransport(transport)
	client.Timeout = timeout
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return errors.New("NHTSA communications artifact redirects are not allowed")
	}

	return &CommunicationsBulkClient{
		baseURL:              parsedBase,
		timeout:              timeout,
		maxCompressedBytes:   compressedLimit,
		maxUncompressedBytes: uncompressedLimit,
		maxRows:              maxRows,
		maxMatches:           maxMatches,
		httpClient:           &client,
		userAgent:            userAgent,
		now:                  time.Now,
	}
}

func (c *CommunicationsBulkClient) ImportManufacturerCommunications(
	ctx context.Context,
	artifactURL string,
	validator CommunicationsArtifactValidator,
) (CommunicationsArtifact, error) {
	parsed, err := c.validateArtifactURL(artifactURL)
	if err != nil {
		return CommunicationsArtifact{}, newUpstreamError(
			"manufacturer communications import",
			ErrorKindValidation,
			0,
			ErrInvalidRequest,
		)
	}
	canonicalURL := parsed.String()

	callCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(callCtx, http.MethodGet, canonicalURL, nil)
	if err != nil {
		return CommunicationsArtifact{}, newUpstreamError(
			"manufacturer communications import",
			ErrorKindValidation,
			0,
			ErrInvalidRequest,
		)
	}
	req.Header.Set("Accept", "application/zip, application/octet-stream")
	req.Header.Set("User-Agent", c.userAgent)
	if etag := strings.TrimSpace(validator.ETag); etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	if modified := strings.TrimSpace(validator.LastModified); modified != "" {
		req.Header.Set("If-Modified-Since", modified)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return CommunicationsArtifact{}, communicationsTransportError(ctx, callCtx, err)
	}
	defer resp.Body.Close()

	result := CommunicationsArtifact{
		ArtifactURL:  canonicalURL,
		ETag:         strings.TrimSpace(resp.Header.Get("ETag")),
		LastModified: strings.TrimSpace(resp.Header.Get("Last-Modified")),
	}
	if resp.StatusCode == http.StatusNotModified {
		result.NotModified = true
		return result, nil
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return CommunicationsArtifact{}, newUpstreamError(
			"manufacturer communications import",
			ErrorKindStatus,
			resp.StatusCode,
			ErrUnexpectedStatus,
		)
	}
	if err := validateCommunicationsContentType(resp.Header.Get("Content-Type")); err != nil {
		return CommunicationsArtifact{}, newUpstreamError(
			"manufacturer communications import",
			ErrorKindContentType,
			resp.StatusCode,
			ErrUnexpectedContentType,
		)
	}
	if resp.ContentLength > c.maxCompressedBytes {
		return CommunicationsArtifact{}, newUpstreamError(
			"manufacturer communications import",
			ErrorKindOversize,
			resp.StatusCode,
			ErrResponseTooLarge,
		)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, c.maxCompressedBytes+1))
	if err != nil {
		return CommunicationsArtifact{}, newUpstreamError(
			"manufacturer communications import",
			ErrorKindTransport,
			resp.StatusCode,
			ErrTransport,
		)
	}
	if int64(len(body)) > c.maxCompressedBytes {
		return CommunicationsArtifact{}, newUpstreamError(
			"manufacturer communications import",
			ErrorKindOversize,
			resp.StatusCode,
			ErrResponseTooLarge,
		)
	}
	sum := sha256.Sum256(body)
	result.SHA256 = hex.EncodeToString(sum[:])

	records, totalRows, rejectedRows, err := c.parseArtifact(callCtx, parsed.Path, body)
	if err != nil {
		return CommunicationsArtifact{}, err
	}
	result.Records = records
	result.TotalRows = totalRows
	result.RejectedRows = rejectedRows
	return result, nil
}

func (c *CommunicationsBulkClient) ValidateManufacturerCommunicationsArtifactURL(
	artifactURL string,
) error {
	_, err := c.validateArtifactURL(artifactURL)
	return err
}

func (c *CommunicationsBulkClient) validateArtifactURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, ErrInvalidRequest
	}
	if !strings.EqualFold(parsed.Scheme, c.baseURL.Scheme) ||
		!strings.EqualFold(parsed.Host, c.baseURL.Host) {
		return nil, ErrInvalidRequest
	}
	match := communicationsArtifactPathPattern.FindStringSubmatch(parsed.EscapedPath())
	if len(match) == 0 {
		return nil, ErrInvalidRequest
	}
	startYear, _ := strconv.Atoi(match[1])
	endYear := startYear
	if match[2] != "" {
		endYear, _ = strconv.Atoi(match[2])
	}
	maxYear := c.now().UTC().Year() + 1
	if startYear < 1990 || endYear < startYear || endYear-startYear > 4 || endYear > maxYear {
		return nil, ErrInvalidRequest
	}
	return parsed, nil
}

func (c *CommunicationsBulkClient) parseArtifact(
	ctx context.Context,
	artifactPath string,
	body []byte,
) ([]ManufacturerCommunication, int, int, error) {
	reader, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil || len(reader.File) != 1 {
		return nil, 0, 0, malformedCommunicationsArtifact()
	}
	file := reader.File[0]
	expectedName := strings.TrimSuffix(path.Base(artifactPath), ".zip") + ".txt"
	if file.FileInfo().IsDir() || file.Name != expectedName || path.Base(file.Name) != file.Name {
		return nil, 0, 0, malformedCommunicationsArtifact()
	}
	if file.UncompressedSize64 > uint64(c.maxUncompressedBytes) ||
		file.CompressedSize64 == 0 ||
		file.UncompressedSize64/file.CompressedSize64 > maxCommunicationsCompressionRatio {
		return nil, 0, 0, newUpstreamError(
			"manufacturer communications import",
			ErrorKindOversize,
			0,
			ErrResponseTooLarge,
		)
	}

	uncompressed, err := file.Open()
	if err != nil {
		return nil, 0, 0, malformedCommunicationsArtifact()
	}
	defer uncompressed.Close()
	counted := &countingReader{
		reader: io.LimitReader(uncompressed, c.maxUncompressedBytes+1),
	}
	tsv := csv.NewReader(counted)
	tsv.Comma = '\t'
	tsv.FieldsPerRecord = 14
	tsv.ReuseRecord = true

	records := make([]ManufacturerCommunication, 0, 1024)
	seen := make(map[string]struct{})
	totalRows := 0
	rejectedRows := 0
	for {
		row, readErr := tsv.Read()
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			if counted.bytes > c.maxUncompressedBytes {
				return nil, 0, 0, newUpstreamError(
					"manufacturer communications import",
					ErrorKindOversize,
					0,
					ErrResponseTooLarge,
				)
			}
			return nil, 0, 0, malformedCommunicationsArtifact()
		}
		totalRows++
		if totalRows > c.maxRows {
			return nil, 0, 0, newUpstreamError(
				"manufacturer communications import",
				ErrorKindOversize,
				0,
				ErrResponseTooLarge,
			)
		}
		if totalRows%1000 == 0 {
			if err := ctx.Err(); err != nil {
				return nil, 0, 0, communicationsContextError(err)
			}
		}
		if !strings.EqualFold(strings.TrimSpace(row[7]), "TESLA") {
			continue
		}
		communication, normalizeErr := normalizeCommunicationRow(
			row,
			c.now().UTC().Year()+2,
		)
		if normalizeErr != nil {
			rejectedRows++
			continue
		}
		key := strings.Join([]string{
			communication.NHTSAID,
			strings.ToUpper(communication.Manufacturer),
			strings.ToUpper(communication.Model),
			strconv.Itoa(communication.ModelYear),
		}, "\x00")
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		records = append(records, communication)
		if len(records) > c.maxMatches {
			return nil, 0, 0, newUpstreamError(
				"manufacturer communications import",
				ErrorKindOversize,
				0,
				ErrResponseTooLarge,
			)
		}
	}
	if counted.bytes > c.maxUncompressedBytes {
		return nil, 0, 0, newUpstreamError(
			"manufacturer communications import",
			ErrorKindOversize,
			0,
			ErrResponseTooLarge,
		)
	}
	return records, totalRows, rejectedRows, nil
}

func normalizeCommunicationRow(row []string, maxModelYear int) (ManufacturerCommunication, error) {
	for _, field := range row {
		if !utf8.ValidString(field) || strings.ContainsRune(field, '\x00') {
			return ManufacturerCommunication{}, ErrMalformedResponse
		}
	}
	nhtsaID := strings.TrimSpace(row[0])
	manufacturer := compactText(row[7])
	model := compactText(row[8])
	modelYear, err := strconv.Atoi(strings.TrimSpace(row[9]))
	if !nhtsaCommunicationIDPattern.MatchString(nhtsaID) ||
		!strings.EqualFold(manufacturer, "TESLA") ||
		model == "" ||
		err != nil ||
		modelYear < 1886 ||
		modelYear > maxModelYear {
		return ManufacturerCommunication{}, ErrMalformedResponse
	}

	receivedAt, err := parseCommunicationDate(row[2])
	if err != nil {
		return ManufacturerCommunication{}, ErrMalformedResponse
	}
	publishedAt, err := parseCommunicationDate(row[4])
	if err != nil {
		return ManufacturerCommunication{}, ErrMalformedResponse
	}
	documentYear := 0
	if receivedAt != nil {
		documentYear = receivedAt.Year()
	} else if publishedAt != nil {
		documentYear = publishedAt.Year()
	}
	if documentYear == 0 {
		return ManufacturerCommunication{}, ErrMalformedResponse
	}

	number := compactText(row[5])
	if number == "" {
		number = compactText(row[3])
	}
	if number == "" {
		number = nhtsaID
	}
	communicationType := compactText(row[6])
	component := compactText(row[10])
	summary := compactText(row[13])
	if summary == "" ||
		utf8.RuneCountInString(number) > 160 ||
		utf8.RuneCountInString(communicationType) > 160 ||
		utf8.RuneCountInString(manufacturer) > 120 ||
		utf8.RuneCountInString(model) > 120 ||
		utf8.RuneCountInString(component) > 500 ||
		utf8.RuneCountInString(summary) > maxCommunicationSummaryRunes {
		return ManufacturerCommunication{}, ErrMalformedResponse
	}

	return ManufacturerCommunication{
		NHTSAID:             nhtsaID,
		CommunicationNumber: number,
		CommunicationType:   communicationType,
		Manufacturer:        manufacturer,
		Model:               model,
		ModelYear:           modelYear,
		PublishedAt:         publishedAt,
		Component:           component,
		Summary:             summary,
		SourceDocumentURL: fmt.Sprintf(
			"https://static.nhtsa.gov/odi/tsbs/%d/MC-%s-0001.pdf",
			documentYear,
			nhtsaID,
		),
	}, nil
}

func parseCommunicationDate(raw string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	parsed, err := time.Parse("20060102", raw)
	if err != nil {
		return nil, err
	}
	utc := parsed.UTC()
	return &utc, nil
}

func compactText(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func validateCommunicationsContentType(raw string) error {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(raw))
	if err != nil {
		return err
	}
	switch mediaType {
	case "application/zip", "application/octet-stream":
		return nil
	default:
		return ErrUnexpectedContentType
	}
}

func communicationsTransportError(
	parent context.Context,
	call context.Context,
	requestErr error,
) error {
	var netErr net.Error
	switch {
	case errors.Is(parent.Err(), context.DeadlineExceeded),
		errors.Is(call.Err(), context.DeadlineExceeded),
		errors.Is(requestErr, context.DeadlineExceeded),
		errors.As(requestErr, &netErr) && netErr.Timeout():
		return newUpstreamError(
			"manufacturer communications import",
			ErrorKindTimeout,
			0,
			ErrUpstreamTimeout,
		)
	case parent.Err() != nil:
		return communicationsContextError(parent.Err())
	case call.Err() != nil:
		return communicationsContextError(call.Err())
	default:
		return newUpstreamError(
			"manufacturer communications import",
			ErrorKindTransport,
			0,
			ErrTransport,
		)
	}
}

func communicationsContextError(err error) error {
	return newUpstreamError(
		"manufacturer communications import",
		ErrorKindCanceled,
		0,
		err,
	)
}

func malformedCommunicationsArtifact() error {
	return newUpstreamError(
		"manufacturer communications import",
		ErrorKindMalformed,
		0,
		ErrMalformedResponse,
	)
}

type countingReader struct {
	reader io.Reader
	bytes  int64
}

func (r *countingReader) Read(buffer []byte) (int, error) {
	n, err := r.reader.Read(buffer)
	r.bytes += int64(n)
	return n, err
}

var _ ManufacturerCommunicationsArtifactImporter = (*CommunicationsBulkClient)(nil)
