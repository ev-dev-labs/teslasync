package serviceintelligence

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/integrations/nhtsa"
)

const serviceTestVIN = "5YJ3E1EA7KF317000"

type fakeVehicleReader struct {
	metadata *VehicleMetadata
	err      error
}

func (f *fakeVehicleReader) GetVehicleMetadata(_ context.Context, _ int64) (*VehicleMetadata, error) {
	return f.metadata, f.err
}

type fakeObservationReader struct {
	observations []SignalObservation
	err          error
	gotVehicleID int64
	gotLimit     int
}

func (f *fakeObservationReader) RecentObservations(
	_ context.Context,
	vehicleID int64,
	_, _ time.Time,
	limit int,
) ([]SignalObservation, error) {
	f.gotVehicleID = vehicleID
	f.gotLimit = limit
	return f.observations, f.err
}

type fakeNHTSAProvider struct {
	decoded    nhtsa.VINDecodeResult
	decodeErr  error
	recalls    nhtsa.RecallResult
	recallsErr error
	gotVIN     string
	gotQuery   nhtsa.VehicleQuery
	gotDecode  nhtsa.FetchOptions
	gotRecalls nhtsa.FetchOptions
}

func (f *fakeNHTSAProvider) DecodeVIN(_ context.Context, vin string, opts nhtsa.FetchOptions) (nhtsa.VINDecodeResult, error) {
	f.gotVIN = vin
	f.gotDecode = opts
	return f.decoded, f.decodeErr
}

func (f *fakeNHTSAProvider) Recalls(_ context.Context, query nhtsa.VehicleQuery, opts nhtsa.FetchOptions) (nhtsa.RecallResult, error) {
	f.gotQuery = query
	f.gotRecalls = opts
	return f.recalls, f.recallsErr
}

type fakeCommunicationsProvider struct {
	result nhtsa.ManufacturerCommunicationsResult
	err    error
}

func (f *fakeCommunicationsProvider) ManufacturerCommunications(
	_ context.Context,
	_ nhtsa.VehicleQuery,
	_ nhtsa.FetchOptions,
) (nhtsa.ManufacturerCommunicationsResult, error) {
	return f.result, f.err
}

func availableSource(id string, count int, now time.Time) nhtsa.SourceMetadata {
	fetched := now
	expires := now.Add(time.Hour)
	return nhtsa.SourceMetadata{
		ID:          id,
		Name:        id,
		Status:      nhtsa.SourceStatusAvailable,
		RecordCount: count,
		FetchedAt:   &fetched,
		CheckedAt:   now,
		ExpiresAt:   &expires,
		SourceURL:   "https://www.nhtsa.gov/",
	}
}

func unavailableCommunications(now time.Time) nhtsa.ManufacturerCommunicationsResult {
	detail := "No stable public vehicle-scoped JSON API is documented; records were not fabricated."
	return nhtsa.ManufacturerCommunicationsResult{
		Communications: make([]nhtsa.ManufacturerCommunication, 0),
		Source: nhtsa.SourceMetadata{
			ID:          nhtsa.SourceIDCommunications,
			Name:        "NHTSA manufacturer communications",
			Status:      nhtsa.SourceStatusUnavailable,
			RecordCount: 0,
			CheckedAt:   now,
			SourceURL:   "https://www.nhtsa.gov/nhtsa-datasets-and-apis",
			Detail:      &detail,
		},
	}
}

func testService(now time.Time) (*Service, *fakeNHTSAProvider, *fakeObservationReader) {
	firmware := "2024.32.7"
	nhtsaProvider := &fakeNHTSAProvider{
		decoded: nhtsa.VINDecodeResult{
			Vehicle: nhtsa.DecodedVehicle{
				Make:         "TESLA",
				Model:        "Model 3",
				ModelYear:    2019,
				PlantCountry: "UNITED STATES (USA)",
				PlantState:   "CALIFORNIA",
				PlantCity:    "FREMONT",
			},
			Source: availableSource(nhtsa.SourceIDVehicleDecoder, 1, now),
		},
		recalls: nhtsa.RecallResult{
			Recalls: []nhtsa.Recall{
				{
					CampaignNumber:    "24V111000",
					Component:         "TIRES:PRESSURE MONITORING",
					Summary:           "Tire pressure warning behavior may be delayed.",
					Consequence:       "An underinflated tire may increase crash risk.",
					Remedy:            "Tesla service will inspect the warning behavior.",
					ModelYear:         2019,
					Make:              "TESLA",
					Model:             "MODEL 3",
					SourceDocumentURL: "https://www.nhtsa.gov/recalls?nhtsaId=24V111000",
				},
				{
					CampaignNumber:    "24V222000",
					Component:         "SERVICE BRAKES",
					Summary:           "Brake operation may be affected on certain vehicles.",
					Consequence:       "Stopping distance may increase.",
					Remedy:            "Tesla service will inspect the brakes.",
					ModelYear:         2019,
					Make:              "TESLA",
					Model:             "MODEL 3",
					SourceDocumentURL: "https://www.nhtsa.gov/recalls?nhtsaId=24V222000",
				},
			},
			Source: availableSource(nhtsa.SourceIDRecalls, 2, now),
		},
	}
	observations := &fakeObservationReader{
		observations: []SignalObservation{
			{
				Signal:      "TpmsPressureFl",
				Deviation:   5.4,
				SampleCount: 72,
				ObservedAt:  now.Add(-time.Hour),
			},
			{
				Signal:      "ModuleTempMax",
				Deviation:   3.3,
				SampleCount: 44,
				ObservedAt:  now.Add(-2 * time.Hour),
			},
		},
	}
	service := NewService(
		&fakeVehicleReader{metadata: &VehicleMetadata{
			ID:              42,
			VIN:             serviceTestVIN,
			FirmwareVersion: &firmware,
		}},
		observations,
		nhtsaProvider,
		&fakeCommunicationsProvider{result: unavailableCommunications(now)},
	)
	service.now = func() time.Time { return now }
	return service, nhtsaProvider, observations
}

func TestServiceRanksApplicabilityAndObservedSymptoms(t *testing.T) {
	now := time.Date(2026, 8, 5, 6, 0, 0, 0, time.UTC)
	service, provider, observations := testService(now)

	response, err := service.Get(context.Background(), 42, true)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if provider.gotVIN != serviceTestVIN {
		t.Errorf("provider VIN = %q", provider.gotVIN)
	}
	if !provider.gotDecode.Refresh || !provider.gotRecalls.Refresh {
		t.Errorf("refresh options not propagated: decode=%+v recalls=%+v", provider.gotDecode, provider.gotRecalls)
	}
	if provider.gotQuery != (nhtsa.VehicleQuery{Make: "TESLA", Model: "Model 3", ModelYear: 2019}) {
		t.Errorf("recall query = %+v", provider.gotQuery)
	}
	if observations.gotVehicleID != 42 || observations.gotLimit != maxObservations {
		t.Errorf("observation call vehicle=%d limit=%d", observations.gotVehicleID, observations.gotLimit)
	}
	if len(response.RecallFindings) != 2 {
		t.Fatalf("len(findings) = %d, want 2", len(response.RecallFindings))
	}

	first := response.RecallFindings[0]
	if first.ID != "24V111000" {
		t.Errorf("first finding = %q, want tire campaign", first.ID)
	}
	if first.Applicability != applicabilityLikely || first.Confidence <= response.RecallFindings[1].Confidence {
		t.Errorf("ranked confidence = %.2f then %.2f", first.Confidence, response.RecallFindings[1].Confidence)
	}
	if len(first.SymptomMatches) != 1 || first.SymptomMatches[0].Signal != "TpmsPressureFl" {
		t.Errorf("symptom matches = %+v", first.SymptomMatches)
	}
	if first.SymptomMatches[0].Severity != "critical" {
		t.Errorf("symptom severity = %q", first.SymptomMatches[0].Severity)
	}
	if response.Summary.SymptomMatches != 1 || len(response.RankedSymptoms) != 1 {
		t.Errorf("summary/ranked symptoms = %+v / %+v", response.Summary, response.RankedSymptoms)
	}
	if response.VehicleContext.BuildDate != nil || response.VehicleContext.FirmwareVersion == nil {
		t.Errorf("vehicle context = %+v", response.VehicleContext)
	}
}

func TestServiceFirmwareFactorMatchesOnlyExplicitCampaignVersion(t *testing.T) {
	firmware := "2024.32.7"
	recall := nhtsa.Recall{
		CampaignNumber: "24V333000",
		Component:      "ELECTRICAL SYSTEM:SOFTWARE",
		Summary:        "Vehicles running version 2024.32.7 may exhibit the behavior.",
		ModelYear:      2019,
		Make:           "TESLA",
		Model:          "MODEL 3",
	}
	factors, confidence := applicabilityFactors(recall, nhtsa.DecodedVehicle{
		Make: "TESLA", Model: "Model 3", ModelYear: 2019,
	}, &firmware)
	if confidence != 0.75 {
		t.Errorf("confidence = %.2f, want 0.75", confidence)
	}
	var firmwareFactor *MatchFactor
	for i := range factors {
		if factors[i].Dimension == "firmware" {
			firmwareFactor = &factors[i]
		}
	}
	if firmwareFactor == nil || firmwareFactor.Status != "matched" {
		t.Errorf("firmware factor = %+v", firmwareFactor)
	}
}

func TestServiceRanksOfficialManufacturerCommunicationMatches(t *testing.T) {
	now := time.Date(2026, 8, 5, 6, 0, 0, 0, time.UTC)
	service, _, _ := testService(now)
	published := now.Add(-30 * 24 * time.Hour)
	source := availableSource(nhtsa.SourceIDCommunications, 1, now)
	service.communications.(*fakeCommunicationsProvider).result = nhtsa.ManufacturerCommunicationsResult{
		Communications: []nhtsa.ManufacturerCommunication{{
			NHTSAID:             "11012218",
			CommunicationNumber: "SB-21-12-005",
			CommunicationType:   "Service Bulletin/Repair Instructions",
			Manufacturer:        "TESLA",
			Model:               "MODEL 3",
			ModelYear:           2019,
			PublishedAt:         &published,
			Component:           "TIRES:PRESSURE MONITORING",
			Summary:             "Vehicles on firmware 2024.32.7 may display a tire pressure alert.",
			SourceDocumentURL:   "https://static.nhtsa.gov/odi/tsbs/2025/MC-11012218-0001.pdf",
		}},
		Source: source,
	}

	response, err := service.Get(context.Background(), 42, false)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if response.Summary.ManufacturerCommunications != 1 || len(response.Communications) != 1 {
		t.Fatalf("communications = %+v summary=%+v", response.Communications, response.Summary)
	}
	finding := response.Communications[0]
	if finding.Applicability != applicabilityLikely ||
		finding.ConfidenceLabel != "high" ||
		finding.Confidence != 0.86 ||
		len(finding.SymptomMatches) != 1 {
		t.Errorf("ranked communication = %+v", finding)
	}
	if finding.SymptomMatches[0].FindingID != "tsb-11012218" {
		t.Errorf("symptom finding ID = %q", finding.SymptomMatches[0].FindingID)
	}
	foundEvidence := false
	for _, item := range response.Evidence.Items {
		if item.Kind == "manufacturer_communication_hypothesis" &&
			item.SourceDocumentURL != nil &&
			*item.SourceDocumentURL == finding.SourceDocumentURL {
			foundEvidence = true
		}
	}
	if !foundEvidence {
		t.Errorf("communication evidence missing: %+v", response.Evidence.Items)
	}
	if strings.Contains(strings.ToLower(finding.Hypothesis), "diagnos") {
		t.Errorf("hypothesis uses diagnostic language: %q", finding.Hypothesis)
	}
}

func TestServiceResponsePrivacyAndHypothesisLanguage(t *testing.T) {
	now := time.Date(2026, 8, 5, 6, 0, 0, 0, time.UTC)
	service, _, _ := testService(now)
	response, err := service.Get(context.Background(), 42, false)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	body, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	wire := strings.ToLower(string(body))
	if strings.Contains(wire, strings.ToLower(serviceTestVIN)) || strings.Contains(wire, `"vin"`) {
		t.Fatalf("VIN leaked in response: %s", body)
	}
	for _, finding := range response.RecallFindings {
		language := strings.ToLower(finding.Hypothesis)
		for _, forbidden := range []string{"diagnosed", "caused by", "definitively"} {
			if strings.Contains(language, forbidden) {
				t.Errorf("hypothesis %q contains causal language %q", finding.Hypothesis, forbidden)
			}
		}
	}
	if response.Evidence.SchemaVersion != EvidenceSchemaVersion || len(response.Evidence.Items) < 4 {
		t.Errorf("evidence bundle = %+v", response.Evidence)
	}
	if response.Summary.ManufacturerCommunications != 0 || response.Communications == nil {
		t.Errorf("communications = %#v summary=%+v", response.Communications, response.Summary)
	}
	if response.Sources[2].Status != nhtsa.SourceStatusUnavailable {
		t.Errorf("communications source = %+v", response.Sources[2])
	}
}

func TestServicePropagatesExplicitFailures(t *testing.T) {
	now := time.Date(2026, 8, 5, 6, 0, 0, 0, time.UTC)
	service, provider, observations := testService(now)

	service.vehicles = &fakeVehicleReader{}
	_, err := service.Get(context.Background(), 42, false)
	if !errors.Is(err, ErrVehicleNotFound) {
		t.Errorf("not found error = %v", err)
	}

	service, provider, observations = testService(now)
	provider.recallsErr = &nhtsa.UpstreamError{Operation: "recalls", Kind: nhtsa.ErrorKindStatus, StatusCode: 503}
	_, err = service.Get(context.Background(), 42, false)
	var upstream *nhtsa.UpstreamError
	if !errors.As(err, &upstream) || upstream.StatusCode != 503 {
		t.Errorf("upstream error = %v", err)
	}

	service, provider, observations = testService(now)
	observations.err = errors.New("signal store unavailable")
	_, err = service.Get(context.Background(), 42, false)
	if err == nil || !strings.Contains(err.Error(), "load observed symptoms") {
		t.Errorf("observation error = %v", err)
	}
	_ = provider
}
