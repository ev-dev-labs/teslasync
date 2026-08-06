package ownershipintelsvc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

const (
	// expiringSoonS is the horizon at which a coverage is surfaced as urgent.
	expiringSoonS = 90 * 24 * 3600
	// paceWindowDays is the trailing window used to observe distance pace.
	paceWindowDays = 180
	// minPaceDrives is the evidence floor before a pace projection is trusted.
	minPaceDrives = 8
)

type readinessSpec struct {
	code     string
	label    string
	severity string
}

var readinessSpecs = []readinessSpec{
	{code: "coverage_active", label: "Coverage is still in force", severity: "critical"},
	{code: "distance_headroom", label: "Distance limit not yet reached", severity: "critical"},
	{code: "capacity_evidence", label: "Battery capacity evidence is available", severity: "high"},
	{code: "telemetry_continuity", label: "Telemetry history covers the coverage term", severity: "high"},
	{code: "odometer_traceable", label: "Odometer is continuously traceable", severity: "medium"},
	{code: "claim_window_open", label: "Projected claim window is longer than 30 days", severity: "medium"},
}

// ListWarranties returns every stored coverage for a vehicle.
func (s *Service) ListWarranties(ctx context.Context, subject string, vehicleID int64) ([]domain.Warranty, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	records, err := s.durable.ListWarranties(ctx, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list warranties: %w", err)
	}
	warranties := make([]domain.Warranty, 0, len(records))
	for _, record := range records {
		warranties = append(warranties, warrantyToDomain(record))
	}
	return warranties, nil
}

// CreateWarranty registers a coverage definition.
func (s *Service) CreateWarranty(
	ctx context.Context,
	subject string,
	request domain.CreateWarrantyRequest,
) (*domain.Warranty, error) {
	if request.VehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	if !isValidWarrantyKind(request.Kind) {
		return nil, fmt.Errorf("%w: kind is not a recognised coverage family", ErrInvalidInput)
	}
	label, ok := requireText(request.Label, 160)
	if !ok {
		return nil, fmt.Errorf("%w: label is required", ErrInvalidInput)
	}
	provider, ok := cleanText(request.Provider, 160)
	if !ok {
		return nil, fmt.Errorf("%w: provider is too long", ErrInvalidInput)
	}
	notes, ok := cleanText(request.Notes, 2000)
	if !ok {
		return nil, fmt.Errorf("%w: notes are too long", ErrInvalidInput)
	}
	if request.StartAt.IsZero() {
		return nil, fmt.Errorf("%w: start_at is required", ErrInvalidInput)
	}
	if !requirePositive(request.TermS) {
		return nil, fmt.Errorf("%w: term_s must be positive", ErrInvalidInput)
	}
	if request.TermS > 30*365*24*3600 {
		return nil, fmt.Errorf("%w: term_s cannot exceed 30 years", ErrInvalidInput)
	}
	if request.TermDistanceM < 0 {
		return nil, fmt.Errorf("%w: term_distance_m must not be negative", ErrInvalidInput)
	}
	if !requireNonNegF(request.StartOdometerM) {
		return nil, fmt.Errorf("%w: start_odometer_m must not be negative", ErrInvalidInput)
	}
	if request.CapacityFloorPct != nil && (*request.CapacityFloorPct <= 0 || *request.CapacityFloorPct >= 100) {
		return nil, fmt.Errorf("%w: capacity_floor_pct must sit between 0 and 100", ErrInvalidInput)
	}
	currency, ok := validCurrency(request.Currency)
	if !ok {
		return nil, fmt.Errorf("%w: currency must be an ISO-4217 alpha-3 code", ErrInvalidInput)
	}
	if !requireNonNeg(request.DeductibleMinor) {
		return nil, fmt.Errorf("%w: deductible_minor must not be negative", ErrInvalidInput)
	}
	record, err := s.durable.CreateWarranty(ctx, subject, port.WarrantyRecord{
		VehicleID:        request.VehicleID,
		Kind:             string(request.Kind),
		Label:            label,
		Provider:         provider,
		StartAt:          request.StartAt.UTC(),
		StartOdometerM:   request.StartOdometerM,
		TermS:            request.TermS,
		TermDistanceM:    request.TermDistanceM,
		CapacityFloorPct: request.CapacityFloorPct,
		DeductibleMinor:  request.DeductibleMinor,
		Currency:         currency,
		Notes:            notes,
	})
	if err != nil {
		return nil, fmt.Errorf("create warranty: %w", err)
	}
	warranty := warrantyToDomain(*record)
	return &warranty, nil
}

// DeleteWarranty removes a coverage definition and its claims.
func (s *Service) DeleteWarranty(ctx context.Context, subject string, id int64) error {
	if id <= 0 {
		return fmt.Errorf("%w: warranty id must be positive", ErrInvalidInput)
	}
	if err := s.durable.DeleteWarranty(ctx, subject, id); err != nil {
		return fmt.Errorf("delete warranty: %w", err)
	}
	return nil
}

// CreateWarrantyClaim opens a claim against a coverage.
func (s *Service) CreateWarrantyClaim(
	ctx context.Context,
	subject string,
	request domain.CreateClaimRequest,
) (*domain.WarrantyClaim, error) {
	if request.WarrantyID <= 0 {
		return nil, fmt.Errorf("%w: warranty_id must be positive", ErrInvalidInput)
	}
	if !request.Confirmed {
		return nil, ErrNotConfirmed
	}
	title, ok := requireText(request.Title, 200)
	if !ok {
		return nil, fmt.Errorf("%w: title is required", ErrInvalidInput)
	}
	note, ok := cleanText(request.EvidenceNote, 4000)
	if !ok {
		return nil, fmt.Errorf("%w: evidence_note is too long", ErrInvalidInput)
	}
	status := request.Status
	if status == "" {
		status = domain.ClaimDraft
	}
	if !isValidClaimStatus(status) {
		return nil, fmt.Errorf("%w: status must be draft, submitted, approved, denied, or closed", ErrInvalidInput)
	}
	if !requireNonNeg(request.AmountMinor) {
		return nil, fmt.Errorf("%w: amount_minor must not be negative", ErrInvalidInput)
	}
	record, err := s.durable.CreateClaim(ctx, subject, port.ClaimRecord{
		WarrantyID:   request.WarrantyID,
		Title:        title,
		Status:       string(status),
		OpenedAt:     s.now(),
		AmountMinor:  request.AmountMinor,
		EvidenceNote: note,
	})
	if err != nil {
		return nil, fmt.Errorf("create warranty claim: %w", err)
	}
	claim := claimToDomain(*record)
	return &claim, nil
}

// WarrantyOverview projects every coverage against measured usage and grades
// how ready each one is to survive a claim.
func (s *Service) WarrantyOverview(
	ctx context.Context,
	subject string,
	vehicleID int64,
) (*domain.WarrantyOverview, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	now := s.now()
	snapshot, err := s.source.VehicleSnapshot(ctx, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("vehicle snapshot: %w", err)
	}
	warranties, err := s.durable.ListWarranties(ctx, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list warranties: %w", err)
	}
	claims, err := s.durable.ListClaims(ctx, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list warranty claims: %w", err)
	}
	paceWindow := s.window(paceWindowDays)
	drives, err := s.source.ListDrives(ctx, vehicleID, paceWindow.From, paceWindow.To)
	if err != nil {
		return nil, fmt.Errorf("list drives: %w", err)
	}

	overview := &domain.WarrantyOverview{
		VehicleID: vehicleID,
		AsOf:      now,
		Coverages: []domain.WarrantyCoverage{},
		Evidence:  []domain.Evidence{},
	}
	if snapshot != nil {
		overview.OdometerM = snapshot.OdometerM
	}

	pace := observedPace(drives)
	retention := capacityRetention(snapshot)
	claimsByWarranty := map[int64][]domain.WarrantyClaim{}
	for _, claim := range claims {
		claimsByWarranty[claim.WarrantyID] = append(claimsByWarranty[claim.WarrantyID], claimToDomain(claim))
		overview.TotalClaimedMinor += claim.AmountMinor
	}

	for _, record := range warranties {
		coverage := projectCoverage(record, snapshot, pace, retention, claimsByWarranty[record.ID], now, len(drives))
		if coverage.Active {
			overview.ActiveCount++
			remaining := coverage.ProjectedExpiryAt.Sub(now).Seconds()
			if remaining <= expiringSoonS {
				overview.ExpiringSoonCount++
			}
			if overview.NextExpiryAt == nil || coverage.ProjectedExpiryAt.Before(*overview.NextExpiryAt) {
				overview.NextExpiryAt = domain.TimePointer(coverage.ProjectedExpiryAt)
			}
		}
		if overview.Currency == "" {
			overview.Currency = record.Currency
		}
		overview.Coverages = append(overview.Coverages, coverage)
	}
	sort.SliceStable(overview.Coverages, func(i, j int) bool {
		return overview.Coverages[i].ProjectedExpiryAt.Before(overview.Coverages[j].ProjectedExpiryAt)
	})
	overview.EvidenceBundleHash = warrantyDigest(vehicleID, overview)

	reasons := []string{}
	if len(warranties) == 0 {
		reasons = append(reasons, "no coverages have been registered yet")
	}
	if pace == nil {
		reasons = append(reasons, "not enough recent drives to observe a distance pace, so expiry is time-only")
	}
	if retention == nil {
		reasons = append(reasons, "no usable charge sessions to estimate battery capacity retention")
	}
	if snapshot == nil || snapshot.OdometerM == nil {
		reasons = append(reasons, "odometer is unknown, so distance consumption is estimated from drive totals")
	}
	overview.Quality = quality(
		gradeQuality(len(drives), minPaceDrives, 60),
		len(drives),
		domain.Float64Pointer(clamp(float64(len(drives))/60*100, 0, 100)),
		paceWindow,
		reasons...,
	)
	overview.Evidence = append(overview.Evidence,
		evidence("drives", domain.TimePointer(paceWindow.To), domain.IntPointer(len(drives)),
			fmt.Sprintf("Distance pace was observed across the trailing %d days of drives.", paceWindowDays)),
		evidence("warranty_claims", domain.TimePointer(now), domain.IntPointer(len(claims)),
			"Claim history is folded into readiness scoring and the evidence bundle hash."),
	)
	if snapshot != nil && snapshot.CapacitySamples > 0 {
		overview.Evidence = append(overview.Evidence, evidence(
			"charging_sessions",
			snapshot.LastObservedAt,
			domain.IntPointer(snapshot.CapacitySamples),
			"Usable-capacity retention was derived from deep charge sessions with at least a 20% state-of-charge delta.",
		))
	}
	return overview, nil
}

func projectCoverage(
	record port.WarrantyRecord,
	snapshot *port.VehicleSnapshot,
	pace *float64,
	retention *float64,
	claims []domain.WarrantyClaim,
	now time.Time,
	driveCount int,
) domain.WarrantyCoverage {
	coverage := domain.WarrantyCoverage{
		Warranty:  warrantyToDomain(record),
		Claims:    claims,
		Readiness: []domain.ReadinessCheck{},
	}
	if coverage.Claims == nil {
		coverage.Claims = []domain.WarrantyClaim{}
	}

	elapsed := int64(now.Sub(record.StartAt).Seconds())
	if elapsed < 0 {
		elapsed = 0
	}
	coverage.ElapsedS = elapsed
	coverage.RemainingS = record.TermS - elapsed
	coverage.TimeUsedPct = clamp(float64(elapsed)/float64(maxInt64(record.TermS, 1))*100, 0, 100)
	coverage.TimeExpiryAt = record.StartAt.Add(time.Duration(record.TermS) * time.Second)

	odometer := 0.0
	if snapshot != nil && snapshot.OdometerM != nil {
		odometer = *snapshot.OdometerM
	}
	used := math.Max(odometer-record.StartOdometerM, 0)
	coverage.DistanceUsedM = used
	if record.TermDistanceM > 0 {
		coverage.DistanceRemainingM = math.Max(record.TermDistanceM-used, 0)
		coverage.DistanceUsedPct = clamp(used/record.TermDistanceM*100, 0, 100)
	}

	coverage.ProjectedExpiryAt = coverage.TimeExpiryAt
	coverage.BindingLimit = "time"
	if pace != nil {
		coverage.ObservedPaceMPerS = pace
		if record.TermDistanceM > 0 && *pace > 0 {
			secondsLeft := coverage.DistanceRemainingM / *pace
			expiry := now.Add(time.Duration(secondsLeft) * time.Second)
			coverage.DistanceExpiryAt = domain.TimePointer(expiry)
			if expiry.Before(coverage.ProjectedExpiryAt) {
				coverage.ProjectedExpiryAt = expiry
				coverage.BindingLimit = "distance"
			}
		}
	}

	if retention != nil {
		coverage.CapacityRetentionPct = retention
		if record.CapacityFloorPct != nil {
			headroom := *retention - *record.CapacityFloorPct
			coverage.CapacityHeadroomPct = pointer(headroom)
			if headroom <= 0 {
				coverage.CapacityFloorBreachAt = domain.TimePointer(now)
				coverage.BindingLimit = "capacity"
			} else if elapsed > 0 {
				degradation := (100 - *retention) / float64(elapsed)
				if degradation > 0 {
					secondsToFloor := headroom / degradation
					breach := now.Add(time.Duration(secondsToFloor) * time.Second)
					coverage.CapacityFloorBreachAt = domain.TimePointer(breach)
				}
			}
		}
	}

	coverage.Active = now.Before(coverage.TimeExpiryAt) &&
		(record.TermDistanceM <= 0 || used < record.TermDistanceM)
	switch {
	case !coverage.Active:
		coverage.Status = "expired"
	case coverage.ProjectedExpiryAt.Sub(now).Seconds() <= expiringSoonS:
		coverage.Status = "expiring"
	default:
		coverage.Status = "active"
	}
	if coverage.Active {
		window := int64(coverage.ProjectedExpiryAt.Sub(now).Seconds())
		coverage.ClaimWindowClosingS = pointer(window)
	}

	coverage.Readiness = buildReadiness(record, coverage, snapshot, retention, driveCount, now)
	satisfied := 0
	weightTotal, weightHit := 0.0, 0.0
	for _, check := range coverage.Readiness {
		weight := severityWeight(check.Severity)
		weightTotal += weight
		if check.Satisfied {
			satisfied++
			weightHit += weight
		}
	}
	if weightTotal > 0 {
		coverage.ReadinessScore = clamp(weightHit/weightTotal*100, 0, 100)
	}
	coverage.Narrative = coverageNarrative(record, coverage, satisfied, len(coverage.Readiness))
	return coverage
}

func buildReadiness(
	record port.WarrantyRecord,
	coverage domain.WarrantyCoverage,
	snapshot *port.VehicleSnapshot,
	retention *float64,
	driveCount int,
	now time.Time,
) []domain.ReadinessCheck {
	checks := make([]domain.ReadinessCheck, 0, len(readinessSpecs))
	for _, spec := range readinessSpecs {
		check := domain.ReadinessCheck{Code: spec.code, Label: spec.label, Severity: spec.severity}
		switch spec.code {
		case "coverage_active":
			check.Satisfied = coverage.Active
			if check.Satisfied {
				check.Detail = fmt.Sprintf("Time coverage runs until %s.", coverage.TimeExpiryAt.Format(time.RFC3339))
			} else {
				check.Detail = "Coverage has already lapsed on time or distance."
			}
		case "distance_headroom":
			check.Satisfied = record.TermDistanceM <= 0 || coverage.DistanceRemainingM > 0
			if record.TermDistanceM <= 0 {
				check.Detail = "This coverage has no distance limit."
			} else {
				check.Detail = fmt.Sprintf("%.0f m of the %.0f m allowance remains.", coverage.DistanceRemainingM, record.TermDistanceM)
			}
		case "capacity_evidence":
			check.Satisfied = retention != nil
			if retention != nil {
				check.Detail = fmt.Sprintf("Usable capacity is measured at %.1f%% of the earliest observed baseline.", *retention)
			} else {
				check.Detail = "No deep charge sessions are available to establish capacity retention."
			}
		case "telemetry_continuity":
			check.Satisfied = snapshot != nil && snapshot.FirstObservedAt != nil &&
				!snapshot.FirstObservedAt.After(record.StartAt.Add(30*24*time.Hour))
			if snapshot != nil && snapshot.FirstObservedAt != nil {
				check.Detail = fmt.Sprintf("Telemetry starts at %s against a coverage start of %s.",
					snapshot.FirstObservedAt.Format(time.RFC3339), record.StartAt.Format(time.RFC3339))
			} else {
				check.Detail = "No telemetry history is recorded for this vehicle."
			}
		case "odometer_traceable":
			check.Satisfied = snapshot != nil && snapshot.OdometerM != nil && snapshot.FirstOdometerM != nil
			if check.Satisfied {
				check.Detail = fmt.Sprintf("Odometer is traceable from %.0f m to %.0f m.", *snapshot.FirstOdometerM, *snapshot.OdometerM)
			} else {
				check.Detail = "Odometer readings are incomplete, weakening a distance-based claim."
			}
		case "claim_window_open":
			check.Satisfied = coverage.Active && coverage.ProjectedExpiryAt.Sub(now) > 30*24*time.Hour
			if coverage.Active {
				check.Detail = fmt.Sprintf("Projected expiry is %s (%s limit).",
					coverage.ProjectedExpiryAt.Format(time.RFC3339), coverage.BindingLimit)
			} else {
				check.Detail = "The claim window is already closed."
			}
		}
		checks = append(checks, check)
	}
	if driveCount < minPaceDrives {
		checks = append(checks, domain.ReadinessCheck{
			Code:      "pace_evidence",
			Label:     "Enough recent drives to project distance pace",
			Satisfied: false,
			Severity:  "medium",
			Detail: fmt.Sprintf("Only %d recent drives are recorded; %d are needed for a trustworthy pace projection.",
				driveCount, minPaceDrives),
		})
	} else {
		checks = append(checks, domain.ReadinessCheck{
			Code:      "pace_evidence",
			Label:     "Enough recent drives to project distance pace",
			Satisfied: true,
			Severity:  "medium",
			Detail:    fmt.Sprintf("%d recent drives back the distance pace projection.", driveCount),
		})
	}
	return checks
}

func coverageNarrative(record port.WarrantyRecord, coverage domain.WarrantyCoverage, satisfied, total int) string {
	if !coverage.Active {
		return fmt.Sprintf("%s coverage has lapsed. %d of %d readiness gates still pass, which is what a retroactive claim would rest on.",
			record.Label, satisfied, total)
	}
	return fmt.Sprintf(
		"%s expires on the %s limit at %s. %.0f%% of the time allowance and %.0f%% of the distance allowance are consumed, and %d of %d readiness gates pass.",
		record.Label,
		coverage.BindingLimit,
		coverage.ProjectedExpiryAt.Format("2006-01-02"),
		coverage.TimeUsedPct,
		coverage.DistanceUsedPct,
		satisfied,
		total,
	)
}

func observedPace(drives []port.DriveRecord) *float64 {
	usable := usableDrives(drives)
	if len(usable) < minPaceDrives {
		return nil
	}
	distance := 0.0
	earliest, latest := usable[0].StartedAt, usable[0].StartedAt
	for _, drive := range usable {
		distance += deref(drive.DistanceM)
		if drive.StartedAt.Before(earliest) {
			earliest = drive.StartedAt
		}
		if drive.StartedAt.After(latest) {
			latest = drive.StartedAt
		}
	}
	span := latest.Sub(earliest).Seconds()
	if span <= 0 || distance <= 0 {
		return nil
	}
	return pointer(distance / span)
}

func capacityRetention(snapshot *port.VehicleSnapshot) *float64 {
	if snapshot == nil || snapshot.BaselineCapacityWh == nil || snapshot.RecentCapacityWh == nil {
		return nil
	}
	if *snapshot.BaselineCapacityWh <= 0 || snapshot.CapacitySamples < 4 {
		return nil
	}
	return pointer(clamp(*snapshot.RecentCapacityWh / *snapshot.BaselineCapacityWh * 100, 0, 130))
}

func severityWeight(severity string) float64 {
	switch severity {
	case "critical":
		return 3
	case "high":
		return 2
	default:
		return 1
	}
}

func warrantyDigest(vehicleID int64, overview *domain.WarrantyOverview) string {
	hasher := sha256.New()
	fmt.Fprintf(hasher, "warranty-v1|%d|%s|", vehicleID, overview.AsOf.UTC().Format(time.RFC3339))
	for _, coverage := range overview.Coverages {
		fmt.Fprintf(hasher, "%s:%s:%.2f:%.2f:%s;",
			coverage.Warranty.Kind,
			coverage.Status,
			coverage.TimeUsedPct,
			coverage.DistanceUsedPct,
			coverage.ProjectedExpiryAt.UTC().Format(time.RFC3339),
		)
	}
	return hex.EncodeToString(hasher.Sum(nil))
}

func isValidWarrantyKind(kind domain.WarrantyKind) bool {
	switch kind {
	case domain.WarrantyBasic, domain.WarrantyDrivetrain, domain.WarrantyBattery,
		domain.WarrantyCorrosion, domain.WarrantyTires, domain.WarrantyAftermarket, domain.WarrantyExtended:
		return true
	default:
		return false
	}
}

func isValidClaimStatus(status domain.ClaimStatus) bool {
	switch status {
	case domain.ClaimDraft, domain.ClaimSubmitted, domain.ClaimApproved,
		domain.ClaimDenied, domain.ClaimClosed:
		return true
	default:
		return false
	}
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func warrantyToDomain(record port.WarrantyRecord) domain.Warranty {
	return domain.Warranty{
		ID:               record.ID,
		VehicleID:        record.VehicleID,
		Kind:             domain.WarrantyKind(record.Kind),
		Label:            record.Label,
		Provider:         record.Provider,
		StartAt:          record.StartAt,
		StartOdometerM:   record.StartOdometerM,
		TermS:            record.TermS,
		TermDistanceM:    record.TermDistanceM,
		CapacityFloorPct: record.CapacityFloorPct,
		DeductibleMinor:  record.DeductibleMinor,
		Currency:         record.Currency,
		Notes:            record.Notes,
		Version:          record.Version,
		CreatedAt:        record.CreatedAt,
		UpdatedAt:        record.UpdatedAt,
	}
}

func claimToDomain(record port.ClaimRecord) domain.WarrantyClaim {
	return domain.WarrantyClaim{
		ID:           record.ID,
		WarrantyID:   record.WarrantyID,
		Title:        record.Title,
		Status:       domain.ClaimStatus(record.Status),
		OpenedAt:     record.OpenedAt,
		ClosedAt:     record.ClosedAt,
		AmountMinor:  record.AmountMinor,
		EvidenceNote: record.EvidenceNote,
		CreatedAt:    record.CreatedAt,
		UpdatedAt:    record.UpdatedAt,
	}
}
