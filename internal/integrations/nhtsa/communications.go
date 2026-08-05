package nhtsa

import (
	"context"
	"time"
)

const manufacturerCommunicationsDocsURL = "https://www.nhtsa.gov/nhtsa-datasets-and-apis"

// UnavailableManufacturerCommunicationsProvider makes the current external
// limitation explicit. As of this implementation, NHTSA exposes manufacturer
// communication documents and bulk datasets but does not document a stable
// public vehicle-scoped JSON API comparable to recallsByVehicle. Returning an
// unavailable source is safer than scraping HTML or inventing TSB records.
type UnavailableManufacturerCommunicationsProvider struct {
	now func() time.Time
}

func NewUnavailableManufacturerCommunicationsProvider() *UnavailableManufacturerCommunicationsProvider {
	return &UnavailableManufacturerCommunicationsProvider{now: time.Now}
}

func (p *UnavailableManufacturerCommunicationsProvider) ManufacturerCommunications(
	ctx context.Context,
	_ VehicleQuery,
	_ FetchOptions,
) (ManufacturerCommunicationsResult, error) {
	if err := ctx.Err(); err != nil {
		return ManufacturerCommunicationsResult{}, newUpstreamError(
			"manufacturer communications",
			ErrorKindCanceled,
			0,
			err,
		)
	}

	now := p.now().UTC()
	detail := "NHTSA does not document a stable public vehicle-scoped JSON API for manufacturer communications/TSBs; no records were inferred or fabricated."
	return ManufacturerCommunicationsResult{
		Communications: make([]ManufacturerCommunication, 0),
		Source: SourceMetadata{
			ID:          SourceIDCommunications,
			Name:        "NHTSA manufacturer communications",
			Status:      SourceStatusUnavailable,
			RecordCount: 0,
			FetchedAt:   nil,
			CheckedAt:   now,
			ExpiresAt:   nil,
			FromCache:   false,
			SourceURL:   manufacturerCommunicationsDocsURL,
			Detail:      &detail,
		},
	}, nil
}

var _ ManufacturerCommunicationsProvider = (*UnavailableManufacturerCommunicationsProvider)(nil)
