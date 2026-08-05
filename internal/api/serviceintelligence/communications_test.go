package serviceintelligence

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/integrations/nhtsa"
)

type fakeCommunicationsCatalog struct {
	matches        []nhtsa.ManufacturerCommunication
	state          CommunicationsCatalogState
	validator      nhtsa.CommunicationsArtifactValidator
	started        *CommunicationImportStatus
	completed      *CommunicationImportStatus
	matchErr       error
	stateErr       error
	validatorErr   error
	startErr       error
	completeErr    error
	failErr        error
	failedID       int64
	failedDetail   string
	completeID     int64
	completeResult nhtsa.CommunicationsArtifact
}

func (f *fakeCommunicationsCatalog) Match(
	_ context.Context,
	_ nhtsa.VehicleQuery,
	_ int,
) ([]nhtsa.ManufacturerCommunication, error) {
	return f.matches, f.matchErr
}

func (f *fakeCommunicationsCatalog) State(context.Context) (CommunicationsCatalogState, error) {
	return f.state, f.stateErr
}

func (f *fakeCommunicationsCatalog) Validator(
	_ context.Context,
	_ string,
) (nhtsa.CommunicationsArtifactValidator, error) {
	return f.validator, f.validatorErr
}

func (f *fakeCommunicationsCatalog) StartImport(
	_ context.Context,
	_ string,
) (*CommunicationImportStatus, error) {
	return f.started, f.startErr
}

func (f *fakeCommunicationsCatalog) CompleteImport(
	_ context.Context,
	importID int64,
	artifact nhtsa.CommunicationsArtifact,
) (*CommunicationImportStatus, error) {
	f.completeID = importID
	f.completeResult = artifact
	return f.completed, f.completeErr
}

func (f *fakeCommunicationsCatalog) FailImport(
	_ context.Context,
	importID int64,
	detail string,
) error {
	f.failedID = importID
	f.failedDetail = detail
	return f.failErr
}

type fakeArtifactImporter struct {
	validateErr  error
	result       nhtsa.CommunicationsArtifact
	err          error
	gotURL       string
	gotValidator nhtsa.CommunicationsArtifactValidator
}

func (f *fakeArtifactImporter) ValidateManufacturerCommunicationsArtifactURL(string) error {
	return f.validateErr
}

func (f *fakeArtifactImporter) ImportManufacturerCommunications(
	_ context.Context,
	artifactURL string,
	validator nhtsa.CommunicationsArtifactValidator,
) (nhtsa.CommunicationsArtifact, error) {
	f.gotURL = artifactURL
	f.gotValidator = validator
	return f.result, f.err
}

func TestDatabaseManufacturerCommunicationsProviderUnavailableWithoutImport(t *testing.T) {
	now := time.Date(2026, 8, 5, 6, 0, 0, 0, time.UTC)
	catalog := &fakeCommunicationsCatalog{}
	provider := &DatabaseManufacturerCommunicationsProvider{
		catalog:  catalog,
		freshFor: defaultCommunicationsFreshness,
		now:      func() time.Time { return now },
	}
	result, err := provider.ManufacturerCommunications(
		context.Background(),
		nhtsa.VehicleQuery{Make: "TESLA", Model: "MODEL 3", ModelYear: 2024},
		nhtsa.FetchOptions{},
	)
	if err != nil {
		t.Fatalf("ManufacturerCommunications: %v", err)
	}
	if result.Source.Status != nhtsa.SourceStatusUnavailable ||
		result.Source.Detail == nil ||
		result.Communications == nil {
		t.Errorf("result = %+v", result)
	}
}

func TestDatabaseManufacturerCommunicationsProviderServesFreshAndStaleMatches(t *testing.T) {
	now := time.Date(2026, 8, 5, 6, 0, 0, 0, time.UTC)
	artifactURL := "https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS_RECEIVED_2025-2026.zip"
	communication := nhtsa.ManufacturerCommunication{
		NHTSAID:             "11012218",
		CommunicationNumber: "SB-21-12-005",
		Manufacturer:        "TESLA",
		Model:               "MODEL 3",
		ModelYear:           2024,
		Summary:             "Official normalized record.",
	}
	for _, test := range []struct {
		name       string
		completed  time.Time
		wantStatus string
	}{
		{name: "fresh", completed: now.Add(-time.Hour), wantStatus: nhtsa.SourceStatusAvailable},
		{name: "stale", completed: now.Add(-9 * 24 * time.Hour), wantStatus: nhtsa.SourceStatusStale},
	} {
		t.Run(test.name, func(t *testing.T) {
			completed := test.completed
			catalog := &fakeCommunicationsCatalog{
				matches: []nhtsa.ManufacturerCommunication{communication},
				state: CommunicationsCatalogState{
					LatestSuccessful: &CommunicationImportStatus{
						ID:          4,
						ArtifactURL: artifactURL,
						Status:      "succeeded",
						CompletedAt: &completed,
					},
				},
			}
			provider := &DatabaseManufacturerCommunicationsProvider{
				catalog:  catalog,
				freshFor: defaultCommunicationsFreshness,
				now:      func() time.Time { return now },
			}
			result, err := provider.ManufacturerCommunications(
				context.Background(),
				nhtsa.VehicleQuery{Make: "TESLA", Model: "MODEL 3", ModelYear: 2024},
				nhtsa.FetchOptions{},
			)
			if err != nil {
				t.Fatalf("ManufacturerCommunications: %v", err)
			}
			if result.Source.Status != test.wantStatus ||
				result.Source.SourceURL != artifactURL ||
				len(result.Communications) != 1 {
				t.Errorf("result = %+v", result)
			}
		})
	}
}

func TestCommunicationsImportServiceCompletesNormalizedArtifact(t *testing.T) {
	artifactURL := "https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS_RECEIVED_2025-2026.zip"
	catalog := &fakeCommunicationsCatalog{
		validator: nhtsa.CommunicationsArtifactValidator{ETag: `"old"`},
		started:   &CommunicationImportStatus{ID: 7, Status: "running"},
		completed: &CommunicationImportStatus{ID: 7, Status: "succeeded"},
	}
	importer := &fakeArtifactImporter{result: nhtsa.CommunicationsArtifact{
		ArtifactURL: artifactURL,
		ETag:        `"new"`,
		TotalRows:   20,
		Records: []nhtsa.ManufacturerCommunication{{
			NHTSAID: "11012218",
		}},
	}}
	service := &CommunicationsImportService{catalog: catalog, importer: importer}
	status, err := service.Import(context.Background(), artifactURL)
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if status.Status != "succeeded" ||
		importer.gotValidator.ETag != `"old"` ||
		catalog.completeID != 7 ||
		len(catalog.completeResult.Records) != 1 {
		t.Errorf("status=%+v importer=%+v catalog=%+v", status, importer, catalog)
	}
}

func TestCommunicationsImportServicePreservesValidatorsOnNotModified(t *testing.T) {
	artifactURL := "https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS_RECEIVED_2025.zip"
	catalog := &fakeCommunicationsCatalog{
		validator: nhtsa.CommunicationsArtifactValidator{
			ETag:         `"same"`,
			LastModified: "Tue, 05 Aug 2026 00:00:00 GMT",
		},
		started:   &CommunicationImportStatus{ID: 8, Status: "running"},
		completed: &CommunicationImportStatus{ID: 8, Status: "succeeded"},
	}
	service := &CommunicationsImportService{
		catalog:  catalog,
		importer: &fakeArtifactImporter{result: nhtsa.CommunicationsArtifact{NotModified: true}},
	}
	if _, err := service.Import(context.Background(), artifactURL); err != nil {
		t.Fatalf("Import: %v", err)
	}
	if catalog.completeResult.ArtifactURL != artifactURL ||
		catalog.completeResult.ETag != `"same"` ||
		catalog.completeResult.LastModified == "" {
		t.Errorf("not-modified completion = %+v", catalog.completeResult)
	}
}

func TestCommunicationsImportServiceRecordsSafeFailure(t *testing.T) {
	artifactURL := "https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS_RECEIVED_2025.zip"
	upstreamErr := &nhtsa.UpstreamError{
		Operation: "manufacturer communications import",
		Kind:      nhtsa.ErrorKindMalformed,
	}
	catalog := &fakeCommunicationsCatalog{
		started: &CommunicationImportStatus{ID: 9, Status: "running"},
	}
	service := &CommunicationsImportService{
		catalog:  catalog,
		importer: &fakeArtifactImporter{err: upstreamErr},
	}
	_, err := service.Import(context.Background(), artifactURL)
	if !errors.As(err, &upstreamErr) {
		t.Fatalf("Import error = %v", err)
	}
	if catalog.failedID != 9 ||
		!strings.Contains(catalog.failedDetail, "manufacturer communications import") {
		t.Errorf("failure record id=%d detail=%q", catalog.failedID, catalog.failedDetail)
	}
}
