package ownershipintelsvc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

const (
	// unassignedCode is the synthetic bucket for distance that falls outside
	// every registered bounding box.
	unassignedCode = "UNASSIGNED"
	// splitConfidence is the confidence attached to a drive whose start and end
	// fall in different jurisdictions and is therefore apportioned 50/50.
	splitConfidence = 60.0
	// singleConfidence is the confidence when both endpoints agree.
	singleConfidence = 95.0
	// endpointOnlyConfidence applies when only one endpoint has coordinates.
	endpointOnlyConfidence = 70.0
)

// ListJurisdictionRates returns every registered taxing authority.
func (s *Service) ListJurisdictionRates(ctx context.Context, subject string) ([]domain.JurisdictionRate, error) {
	records, err := s.durable.ListRates(ctx, subject)
	if err != nil {
		return nil, fmt.Errorf("list jurisdiction rates: %w", err)
	}
	rates := make([]domain.JurisdictionRate, 0, len(records))
	for _, record := range records {
		rates = append(rates, jurisdictionToDomain(record))
	}
	return rates, nil
}

// CreateJurisdictionRate registers a bounding-box taxing authority.
func (s *Service) CreateJurisdictionRate(
	ctx context.Context,
	subject string,
	request domain.CreateJurisdictionRateRequest,
) (*domain.JurisdictionRate, error) {
	code, ok := requireText(strings.ToUpper(request.JurisdictionCode), 24)
	if !ok {
		return nil, fmt.Errorf("%w: jurisdiction_code is required", ErrInvalidInput)
	}
	if code == unassignedCode {
		return nil, fmt.Errorf("%w: %s is reserved", ErrInvalidInput, unassignedCode)
	}
	label, ok := requireText(request.Label, 160)
	if !ok {
		return nil, fmt.Errorf("%w: label is required", ErrInvalidInput)
	}
	currency, ok := validCurrency(request.Currency)
	if !ok {
		return nil, fmt.Errorf("%w: currency must be an ISO-4217 alpha-3 code", ErrInvalidInput)
	}
	if !requireNonNegF(request.RoadUsageMinorPerM) {
		return nil, fmt.Errorf("%w: road_usage_minor_per_m must not be negative", ErrInvalidInput)
	}
	if request.RoadUsageMinorPerM > 1 {
		return nil, fmt.Errorf("%w: road_usage_minor_per_m above 1 minor unit per metre is implausible", ErrInvalidInput)
	}
	if !requireNonNeg(request.RegistrationFeeMinor) {
		return nil, fmt.Errorf("%w: registration_fee_minor must not be negative", ErrInvalidInput)
	}
	if !requireNonNegF(request.GridIntensityGPerWh) || request.GridIntensityGPerWh > 2 {
		return nil, fmt.Errorf("%w: grid_intensity_g_per_wh must sit between 0 and 2", ErrInvalidInput)
	}
	if request.MinLat < -90 || request.MaxLat > 90 || request.MinLat >= request.MaxLat {
		return nil, fmt.Errorf("%w: latitude bounds are invalid", ErrInvalidInput)
	}
	if request.MinLng < -180 || request.MaxLng > 180 || request.MinLng >= request.MaxLng {
		return nil, fmt.Errorf("%w: longitude bounds are invalid", ErrInvalidInput)
	}
	record, err := s.durable.CreateRate(ctx, subject, port.JurisdictionRateRecord{
		JurisdictionCode:     code,
		Label:                label,
		Currency:             currency,
		RoadUsageMinorPerM:   request.RoadUsageMinorPerM,
		RegistrationFeeMinor: request.RegistrationFeeMinor,
		GridIntensityGPerWh:  request.GridIntensityGPerWh,
		MinLat:               request.MinLat,
		MaxLat:               request.MaxLat,
		MinLng:               request.MinLng,
		MaxLng:               request.MaxLng,
	})
	if err != nil {
		return nil, fmt.Errorf("create jurisdiction rate: %w", err)
	}
	rate := jurisdictionToDomain(*record)
	return &rate, nil
}

// DeleteJurisdictionRate removes a taxing authority.
func (s *Service) DeleteJurisdictionRate(ctx context.Context, subject string, id int64) error {
	if id <= 0 {
		return fmt.Errorf("%w: jurisdiction rate id must be positive", ErrInvalidInput)
	}
	if err := s.durable.DeleteRate(ctx, subject, id); err != nil {
		return fmt.Errorf("delete jurisdiction rate: %w", err)
	}
	return nil
}

// ComplianceApportionment splits measured distance and energy across every
// registered jurisdiction and prices the resulting liability.
func (s *Service) ComplianceApportionment(
	ctx context.Context,
	subject string,
	vehicleID int64,
	windowDays int,
) (*domain.ComplianceApportionment, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	window := s.window(windowDays)
	return s.apportion(ctx, subject, vehicleID, window)
}

func (s *Service) apportion(
	ctx context.Context,
	subject string,
	vehicleID int64,
	window domain.Window,
) (*domain.ComplianceApportionment, error) {
	rates, err := s.durable.ListRates(ctx, subject)
	if err != nil {
		return nil, fmt.Errorf("list jurisdiction rates: %w", err)
	}
	drives, err := s.source.ListDrives(ctx, vehicleID, window.From, window.To)
	if err != nil {
		return nil, fmt.Errorf("list drives: %w", err)
	}

	report := &domain.ComplianceApportionment{
		VehicleID:     vehicleID,
		Window:        window,
		Jurisdictions: []domain.JurisdictionApportionment{},
		Evidence:      []domain.Evidence{},
	}

	type bucket struct {
		distanceM      float64
		energyWh       float64
		driveCount     int
		confidenceSum  float64
		confidenceRows float64
	}
	buckets := map[string]*bucket{}
	ensure := func(code string) *bucket {
		if buckets[code] == nil {
			buckets[code] = &bucket{}
		}
		return buckets[code]
	}

	usable := usableDrives(drives)
	for _, drive := range usable {
		distance := deref(drive.DistanceM)
		energy := math.Abs(deref(drive.EnergyUsedWh))
		report.TotalDistanceM += distance
		report.TotalEnergyWh += energy
		report.DriveCount++

		startCode := locateJurisdiction(rates, drive.StartLat, drive.StartLng)
		endCode := locateJurisdiction(rates, drive.EndLat, drive.EndLng)
		switch {
		case startCode != "" && endCode != "" && startCode == endCode:
			target := ensure(startCode)
			target.distanceM += distance
			target.energyWh += energy
			target.driveCount++
			target.confidenceSum += singleConfidence
			target.confidenceRows++
		case startCode != "" && endCode != "" && startCode != endCode:
			// The route between two authorities is not reconstructable from
			// endpoints alone, so the distance is split evenly and the
			// confidence is downgraded rather than guessed.
			for _, code := range []string{startCode, endCode} {
				target := ensure(code)
				target.distanceM += distance / 2
				target.energyWh += energy / 2
				target.driveCount++
				target.confidenceSum += splitConfidence
				target.confidenceRows++
			}
		case startCode != "" || endCode != "":
			code := startCode
			if code == "" {
				code = endCode
			}
			target := ensure(code)
			target.distanceM += distance
			target.energyWh += energy
			target.driveCount++
			target.confidenceSum += endpointOnlyConfidence
			target.confidenceRows++
		default:
			target := ensure(unassignedCode)
			target.distanceM += distance
			target.energyWh += energy
			target.driveCount++
			target.confidenceSum += 0
			target.confidenceRows++
		}
	}

	rateByCode := map[string]port.JurisdictionRateRecord{}
	for _, rate := range rates {
		rateByCode[rate.JurisdictionCode] = rate
		if report.Currency == "" {
			report.Currency = rate.Currency
		}
	}
	periodYears := math.Max(window.To.Sub(window.From).Hours()/24/365.25, 0)

	for code, data := range buckets {
		entry := domain.JurisdictionApportionment{
			JurisdictionCode: code,
			DistanceM:        data.distanceM,
			EnergyWh:         data.energyWh,
			DriveCount:       data.driveCount,
		}
		if data.confidenceRows > 0 {
			entry.Confidence = data.confidenceSum / data.confidenceRows
		}
		if report.TotalDistanceM > 0 {
			entry.DistanceSharePct = data.distanceM / report.TotalDistanceM * 100
		}
		if code == unassignedCode {
			entry.Label = "Outside every registered jurisdiction"
			report.UnassignedDistanceM += data.distanceM
		} else {
			rate := rateByCode[code]
			entry.Label = rate.Label
			entry.Currency = rate.Currency
			entry.RoadUsageChargeMin = roundMinor(data.distanceM * rate.RoadUsageMinorPerM)
			entry.RegistrationMinor = roundMinor(float64(rate.RegistrationFeeMinor) * periodYears * (entry.DistanceSharePct / 100))
			entry.TotalLiabilityMin = entry.RoadUsageChargeMin + entry.RegistrationMinor
			entry.EmissionsG = data.energyWh * rate.GridIntensityGPerWh
			if data.distanceM > 0 {
				entry.EmissionsGPerM = pointer(entry.EmissionsG / data.distanceM)
			}
			report.AssignedDistanceM += data.distanceM
			report.TotalRoadUsageMinor += entry.RoadUsageChargeMin
			report.TotalRegistrationMinor += entry.RegistrationMinor
			report.TotalLiabilityMinor += entry.TotalLiabilityMin
			report.TotalEmissionsG += entry.EmissionsG
		}
		report.Jurisdictions = append(report.Jurisdictions, entry)
	}
	sort.SliceStable(report.Jurisdictions, func(i, j int) bool {
		return report.Jurisdictions[i].DistanceM > report.Jurisdictions[j].DistanceM
	})
	if report.TotalDistanceM > 0 {
		report.UnassignedSharePct = report.UnassignedDistanceM / report.TotalDistanceM * 100
	}
	report.Digest = complianceDigest(vehicleID, report)

	reasons := []string{}
	if len(rates) == 0 {
		reasons = append(reasons, "no jurisdictions are registered, so every metre is unassigned")
	}
	if report.UnassignedSharePct > 25 {
		reasons = append(reasons, fmt.Sprintf("%.0f%% of distance falls outside every registered bounding box", report.UnassignedSharePct))
	}
	if report.DriveCount > 0 && report.AssignedDistanceM == 0 {
		reasons = append(reasons, "no drive endpoints carry coordinates")
	}
	coverage := 0.0
	if report.TotalDistanceM > 0 {
		coverage = report.AssignedDistanceM / report.TotalDistanceM * 100
	}
	report.Quality = quality(
		gradeQuality(report.DriveCount, 10, 100),
		report.DriveCount,
		domain.Float64Pointer(coverage),
		window,
		reasons...,
	)
	report.Evidence = append(report.Evidence, evidence(
		"drives",
		domain.TimePointer(window.To),
		domain.IntPointer(report.DriveCount),
		"Distance is apportioned from drive start and end coordinates. Cross-border drives are split evenly because the intermediate route cannot be reconstructed from endpoints alone.",
	))
	return report, nil
}

// ListFilings returns the immutable filing ledger.
func (s *Service) ListFilings(
	ctx context.Context,
	subject string,
	vehicleID int64,
	limit, offset int,
) (*domain.Page[domain.ComplianceFiling], error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	limit, offset = normalizePage(limit, offset)
	records, total, err := s.durable.ListFilings(ctx, subject, vehicleID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list compliance filings: %w", err)
	}
	items := make([]domain.ComplianceFiling, 0, len(records))
	for _, record := range records {
		items = append(items, filingToDomain(record))
	}
	return &domain.Page[domain.ComplianceFiling]{Items: items, Total: total, Limit: limit, Offset: offset}, nil
}

// CreateFiling freezes an apportionment window into an immutable snapshot.
func (s *Service) CreateFiling(
	ctx context.Context,
	subject string,
	request domain.CreateFilingRequest,
) (*domain.ComplianceFiling, error) {
	if request.VehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	if !request.Confirmed {
		return nil, ErrNotConfirmed
	}
	if request.PeriodStart.IsZero() || !request.PeriodEnd.After(request.PeriodStart) {
		return nil, fmt.Errorf("%w: period_end must be after period_start", ErrInvalidInput)
	}
	if request.PeriodEnd.After(s.now().Add(time.Hour)) {
		return nil, fmt.Errorf("%w: a filing period cannot extend into the future", ErrInvalidInput)
	}
	window := domain.Window{
		From: request.PeriodStart.UTC(),
		To:   request.PeriodEnd.UTC(),
		Days: int(request.PeriodEnd.Sub(request.PeriodStart).Hours() / 24),
	}
	apportionment, err := s.apportion(ctx, subject, request.VehicleID, window)
	if err != nil {
		return nil, err
	}
	if apportionment.DriveCount == 0 {
		return nil, fmt.Errorf("%w: the selected period contains no completed drives", ErrInvalidInput)
	}
	snapshot, err := json.Marshal(apportionment)
	if err != nil {
		return nil, fmt.Errorf("encode filing snapshot: %w", err)
	}
	record, err := s.durable.CreateFiling(ctx, subject, port.FilingRecord{
		VehicleID:        request.VehicleID,
		PeriodStart:      window.From,
		PeriodEnd:        window.To,
		Status:           "filed",
		TotalDistanceM:   apportionment.TotalDistanceM,
		TotalEnergyWh:    apportionment.TotalEnergyWh,
		TotalChargeMinor: apportionment.TotalLiabilityMinor,
		Currency:         apportionment.Currency,
		Digest:           apportionment.Digest,
		Snapshot:         snapshot,
		FiledAt:          domain.TimePointer(s.now()),
	})
	if err != nil {
		return nil, fmt.Errorf("create compliance filing: %w", err)
	}
	filing := filingToDomain(*record)
	return &filing, nil
}

// locateJurisdiction returns the smallest bounding box containing the point so
// a city inside a state resolves to the city rather than the state.
func locateJurisdiction(rates []port.JurisdictionRateRecord, lat, lng *float64) string {
	if lat == nil || lng == nil {
		return ""
	}
	best, bestArea := "", math.Inf(1)
	for _, rate := range rates {
		if *lat < rate.MinLat || *lat > rate.MaxLat || *lng < rate.MinLng || *lng > rate.MaxLng {
			continue
		}
		area := (rate.MaxLat - rate.MinLat) * (rate.MaxLng - rate.MinLng)
		if area < bestArea {
			best, bestArea = rate.JurisdictionCode, area
		}
	}
	return best
}

func complianceDigest(vehicleID int64, report *domain.ComplianceApportionment) string {
	hasher := sha256.New()
	fmt.Fprintf(hasher, "compliance-v1|%d|%s|%s|",
		vehicleID, report.Window.From.UTC().Format(time.RFC3339), report.Window.To.UTC().Format(time.RFC3339))
	codes := make([]string, 0, len(report.Jurisdictions))
	amounts := map[string]string{}
	for _, entry := range report.Jurisdictions {
		codes = append(codes, entry.JurisdictionCode)
		amounts[entry.JurisdictionCode] = fmt.Sprintf("%.3f:%.3f:%d", entry.DistanceM, entry.EnergyWh, entry.TotalLiabilityMin)
	}
	sort.Strings(codes)
	for _, code := range codes {
		fmt.Fprintf(hasher, "%s=%s;", code, amounts[code])
	}
	return hex.EncodeToString(hasher.Sum(nil))
}

func jurisdictionToDomain(record port.JurisdictionRateRecord) domain.JurisdictionRate {
	return domain.JurisdictionRate{
		ID:                   record.ID,
		JurisdictionCode:     record.JurisdictionCode,
		Label:                record.Label,
		Currency:             record.Currency,
		RoadUsageMinorPerM:   record.RoadUsageMinorPerM,
		RegistrationFeeMinor: record.RegistrationFeeMinor,
		GridIntensityGPerWh:  record.GridIntensityGPerWh,
		MinLat:               record.MinLat,
		MaxLat:               record.MaxLat,
		MinLng:               record.MinLng,
		MaxLng:               record.MaxLng,
		Version:              record.Version,
		CreatedAt:            record.CreatedAt,
		UpdatedAt:            record.UpdatedAt,
	}
}

func filingToDomain(record port.FilingRecord) domain.ComplianceFiling {
	return domain.ComplianceFiling{
		ID:               record.ID,
		VehicleID:        record.VehicleID,
		PeriodStart:      record.PeriodStart,
		PeriodEnd:        record.PeriodEnd,
		Status:           record.Status,
		TotalDistanceM:   record.TotalDistanceM,
		TotalEnergyWh:    record.TotalEnergyWh,
		TotalChargeMinor: record.TotalChargeMinor,
		Currency:         record.Currency,
		Digest:           record.Digest,
		FiledAt:          record.FiledAt,
		CreatedAt:        record.CreatedAt,
	}
}
