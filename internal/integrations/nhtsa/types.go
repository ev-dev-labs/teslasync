package nhtsa

import (
	"context"
	"errors"
	"fmt"
	"net"
	"time"
)

const (
	SourceStatusAvailable   = "available"
	SourceStatusStale       = "stale"
	SourceStatusUnavailable = "unavailable"

	SourceIDVehicleDecoder = "nhtsa_vpic_vehicle_decoder"
	SourceIDRecalls        = "nhtsa_recalls"
	SourceIDCommunications = "nhtsa_manufacturer_communications"
)

// FetchOptions controls whether a provider may serve a still-fresh normalized
// cache entry. Refresh still uses conditional requests when an ETag or
// Last-Modified validator is available.
type FetchOptions struct {
	Refresh bool
}

// SourceMetadata describes provenance and freshness without exposing the
// request URL used for vehicle decoding (that URL contains the VIN).
type SourceMetadata struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Status      string     `json:"status"`
	RecordCount int        `json:"record_count"`
	FetchedAt   *time.Time `json:"fetched_at"`
	CheckedAt   time.Time  `json:"checked_at"`
	ExpiresAt   *time.Time `json:"expires_at"`
	FromCache   bool       `json:"from_cache"`
	SourceURL   string     `json:"source_url"`
	Detail      *string    `json:"detail"`
}

// DecodedVehicle is the privacy-safe subset of the vPIC extended VIN decode
// response needed for safety applicability. It deliberately has no VIN field.
type DecodedVehicle struct {
	Make              string `json:"make"`
	Model             string `json:"model"`
	ModelYear         int    `json:"model_year"`
	Manufacturer      string `json:"manufacturer"`
	VehicleType       string `json:"vehicle_type"`
	PlantCountry      string `json:"plant_country"`
	PlantState        string `json:"plant_state"`
	PlantCity         string `json:"plant_city"`
	VehicleDescriptor string `json:"vehicle_descriptor"`
}

type VINDecodeResult struct {
	Vehicle DecodedVehicle `json:"vehicle"`
	Source  SourceMetadata `json:"source"`
}

type VehicleQuery struct {
	Make      string
	Model     string
	ModelYear int
}

// Recall is a normalized NHTSA recall campaign. Completion status is not part
// of the documented make/model/model-year endpoint and is therefore not
// represented here.
type Recall struct {
	Manufacturer      string     `json:"manufacturer"`
	CampaignNumber    string     `json:"campaign_number"`
	ReportReceivedAt  *time.Time `json:"report_received_at"`
	Component         string     `json:"component"`
	Summary           string     `json:"summary"`
	Consequence       string     `json:"consequence"`
	Remedy            string     `json:"remedy"`
	Notes             string     `json:"notes"`
	ModelYear         int        `json:"model_year"`
	Make              string     `json:"make"`
	Model             string     `json:"model"`
	ParkIt            bool       `json:"park_it"`
	ParkOutside       bool       `json:"park_outside"`
	OverTheAirUpdate  bool       `json:"over_the_air_update"`
	SourceDocumentURL string     `json:"source_document_url"`
}

type RecallResult struct {
	Recalls []Recall       `json:"recalls"`
	Source  SourceMetadata `json:"source"`
}

// ManufacturerCommunication is the normalized contract a future documented
// provider may populate. The unavailable provider returns an empty slice; it
// never fabricates bulletin identifiers or document links.
type ManufacturerCommunication struct {
	NHTSAID             string     `json:"nhtsa_id"`
	CommunicationNumber string     `json:"communication_number"`
	CommunicationType   string     `json:"communication_type"`
	Manufacturer        string     `json:"manufacturer"`
	Model               string     `json:"model"`
	ModelYear           int        `json:"model_year"`
	PublishedAt         *time.Time `json:"published_at"`
	Component           string     `json:"component"`
	Summary             string     `json:"summary"`
	SourceDocumentURL   string     `json:"source_document_url"`
}

type ManufacturerCommunicationsResult struct {
	Communications []ManufacturerCommunication `json:"communications"`
	Source         SourceMetadata              `json:"source"`
}

// Provider is the typed safety-data port consumed by service intelligence.
// Client is the production adapter.
type Provider interface {
	DecodeVIN(ctx context.Context, vin string, opts FetchOptions) (VINDecodeResult, error)
	Recalls(ctx context.Context, query VehicleQuery, opts FetchOptions) (RecallResult, error)
}

// ManufacturerCommunicationsProvider is separate because NHTSA does not
// currently document a stable public vehicle-scoped JSON API for manufacturer
// communications/TSBs.
type ManufacturerCommunicationsProvider interface {
	ManufacturerCommunications(ctx context.Context, query VehicleQuery, opts FetchOptions) (ManufacturerCommunicationsResult, error)
}

// CommunicationsArtifactValidator is safe conditional-request metadata from a
// prior successful normalized import.
type CommunicationsArtifactValidator struct {
	ETag         string
	LastModified string
}

// CommunicationsArtifact is the normalized Tesla subset of one official
// NHTSA manufacturer-communications flat-file artifact. Raw TSV bytes are not
// retained after parsing.
type CommunicationsArtifact struct {
	ArtifactURL  string
	ETag         string
	LastModified string
	SHA256       string
	TotalRows    int
	RejectedRows int
	NotModified  bool
	Records      []ManufacturerCommunication
}

// ManufacturerCommunicationsArtifactImporter is the external-source port used
// by the authenticated admin import service.
type ManufacturerCommunicationsArtifactImporter interface {
	ValidateManufacturerCommunicationsArtifactURL(artifactURL string) error
	ImportManufacturerCommunications(
		ctx context.Context,
		artifactURL string,
		validator CommunicationsArtifactValidator,
	) (CommunicationsArtifact, error)
}

type ErrorKind string

const (
	ErrorKindValidation  ErrorKind = "validation"
	ErrorKindTimeout     ErrorKind = "timeout"
	ErrorKindCanceled    ErrorKind = "canceled"
	ErrorKindStatus      ErrorKind = "status"
	ErrorKindContentType ErrorKind = "content_type"
	ErrorKindOversize    ErrorKind = "oversize"
	ErrorKindMalformed   ErrorKind = "malformed"
	ErrorKindTransport   ErrorKind = "transport"
)

var (
	ErrInvalidRequest        = errors.New("invalid NHTSA request")
	ErrUpstreamTimeout       = errors.New("NHTSA upstream timeout")
	ErrUnexpectedStatus      = errors.New("unexpected NHTSA status")
	ErrUnexpectedContentType = errors.New("unexpected NHTSA content type")
	ErrResponseTooLarge      = errors.New("NHTSA response too large")
	ErrMalformedResponse     = errors.New("malformed NHTSA response")
	ErrTransport             = errors.New("NHTSA transport failure")
)

// UpstreamError deliberately omits request URLs and response bodies so a VIN
// can never be disclosed through handler logs or client-facing errors.
type UpstreamError struct {
	Operation  string
	Kind       ErrorKind
	StatusCode int
	cause      error
}

func (e *UpstreamError) Error() string {
	if e.StatusCode > 0 {
		return fmt.Sprintf("NHTSA %s failed (%s, status %d)", e.Operation, e.Kind, e.StatusCode)
	}
	return fmt.Sprintf("NHTSA %s failed (%s)", e.Operation, e.Kind)
}

func (e *UpstreamError) Unwrap() error { return e.cause }

func newUpstreamError(operation string, kind ErrorKind, status int, cause error) error {
	return &UpstreamError{
		Operation:  operation,
		Kind:       kind,
		StatusCode: status,
		cause:      cause,
	}
}

func requestTimedOut(parent, call context.Context, requestErr error) bool {
	var netErr net.Error
	return errors.Is(parent.Err(), context.DeadlineExceeded) ||
		errors.Is(call.Err(), context.DeadlineExceeded) ||
		errors.Is(requestErr, context.DeadlineExceeded) ||
		(errors.As(requestErr, &netErr) && netErr.Timeout())
}
