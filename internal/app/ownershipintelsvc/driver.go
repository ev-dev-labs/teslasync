package ownershipintelsvc

import (
	"context"
	"fmt"
	"math"
	"sort"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

const (
	// maxClusters bounds k so the solver stays fast and interpretable.
	maxClusters = 6
	// kmeansIterations is the Lloyd's-algorithm iteration ceiling. Convergence
	// normally happens within a dozen passes on this feature space.
	kmeansIterations = 60
	// convergenceEpsilon stops the solver once centroids stop moving.
	convergenceEpsilon = 1e-9
)

type fingerprintSpec struct {
	code   string
	label  string
	unit   string
	weight float64
}

// fingerprintSpecs is the fixed behavioural feature space. Weights sum to 1.0
// and are applied to min-max normalised values so no single dimension can
// dominate purely because of its natural magnitude.
var fingerprintSpecs = []fingerprintSpec{
	{code: "avg_speed", label: "Average speed", unit: "m/s", weight: 0.18},
	{code: "speed_ratio", label: "Peak-to-average speed ratio", unit: "ratio", weight: 0.16},
	{code: "power_intensity", label: "Peak-to-average power ratio", unit: "ratio", weight: 0.18},
	{code: "efficiency", label: "Energy per distance", unit: "Wh/m", weight: 0.14},
	{code: "regen_share", label: "Regenerative share", unit: "fraction", weight: 0.12},
	{code: "departure_sin", label: "Departure time (sine phase)", unit: "phase", weight: 0.11},
	{code: "departure_cos", label: "Departure time (cosine phase)", unit: "phase", weight: 0.11},
}

// ListDriverProfiles returns every named driver for a vehicle.
func (s *Service) ListDriverProfiles(
	ctx context.Context,
	subject string,
	vehicleID int64,
) ([]domain.DriverProfile, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	records, err := s.durable.ListProfiles(ctx, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list driver profiles: %w", err)
	}
	profiles := make([]domain.DriverProfile, 0, len(records))
	for _, record := range records {
		profiles = append(profiles, driverProfileToDomain(record))
	}
	return profiles, nil
}

// CreateDriverProfile registers a named driver.
func (s *Service) CreateDriverProfile(
	ctx context.Context,
	subject string,
	request domain.CreateDriverProfileRequest,
) (*domain.DriverProfile, error) {
	if request.VehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	name, ok := requireText(request.Name, 120)
	if !ok {
		return nil, fmt.Errorf("%w: name is required", ErrInvalidInput)
	}
	accent := request.Accent
	if accent == "" {
		accent = "cyan"
	}
	if !isValidAccent(accent) {
		return nil, fmt.Errorf("%w: accent is not supported", ErrInvalidInput)
	}
	record, err := s.durable.CreateProfile(ctx, subject, port.DriverProfileRecord{
		VehicleID: request.VehicleID,
		Name:      name,
		Accent:    accent,
		IsPrimary: request.IsPrimary,
	})
	if err != nil {
		return nil, fmt.Errorf("create driver profile: %w", err)
	}
	profile := driverProfileToDomain(*record)
	return &profile, nil
}

// DeleteDriverProfile removes a driver and cascades its attributions.
func (s *Service) DeleteDriverProfile(ctx context.Context, subject string, id int64) error {
	if id <= 0 {
		return fmt.Errorf("%w: driver profile id must be positive", ErrInvalidInput)
	}
	if err := s.durable.DeleteProfile(ctx, subject, id); err != nil {
		return fmt.Errorf("delete driver profile: %w", err)
	}
	return nil
}

// AssignDrive records a manual attribution, which also supervises the solver.
func (s *Service) AssignDrive(
	ctx context.Context,
	subject string,
	request domain.AssignDriveRequest,
) error {
	if request.DriveID <= 0 || request.DriverProfileID <= 0 {
		return fmt.Errorf("%w: drive_id and driver_profile_id must be positive", ErrInvalidInput)
	}
	if !request.Confirmed {
		return ErrNotConfirmed
	}
	err := s.durable.UpsertAssignment(ctx, subject, port.AssignmentRecord{
		DriveID:         request.DriveID,
		DriverProfileID: request.DriverProfileID,
		Source:          "manual",
		ConfidencePct:   100,
		AssignedAt:      s.now(),
	})
	if err != nil {
		return fmt.Errorf("assign drive: %w", err)
	}
	return nil
}

// DriverAttribution fingerprints every drive and attributes it to a driver.
func (s *Service) DriverAttribution(
	ctx context.Context,
	subject string,
	vehicleID int64,
	windowDays, limit, offset int,
) (*domain.DriverAttributionReport, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	limit, offset = normalizePage(limit, offset)
	window := s.window(windowDays)

	drives, err := s.source.ListDrives(ctx, vehicleID, window.From, window.To)
	if err != nil {
		return nil, fmt.Errorf("list drives: %w", err)
	}
	profileRecords, err := s.durable.ListProfiles(ctx, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("list driver profiles: %w", err)
	}
	assignments, err := s.durable.ListAssignments(ctx, subject, vehicleID, window.From, window.To)
	if err != nil {
		return nil, fmt.Errorf("list drive assignments: %w", err)
	}
	charges, err := s.source.ListCharges(ctx, vehicleID, window.From, window.To)
	if err != nil {
		return nil, fmt.Errorf("list charging sessions: %w", err)
	}

	report := &domain.DriverAttributionReport{
		VehicleID:    vehicleID,
		Window:       window,
		Profiles:     make([]domain.DriverProfile, 0, len(profileRecords)),
		Clusters:     []domain.DriverCluster{},
		Fingerprints: []domain.DriveFingerprint{},
		Limit:        limit,
		Offset:       offset,
		Evidence:     []domain.Evidence{},
	}
	for _, record := range profileRecords {
		report.Profiles = append(report.Profiles, driverProfileToDomain(record))
	}

	usable := usableDrives(drives)
	if len(usable) < 2 {
		report.SeparationVerdict = "insufficient"
		report.Quality = quality(
			domain.QualityInsufficient, len(usable), nil, window,
			"at least two completed drives are required before behavioural clustering is meaningful",
		)
		return report, nil
	}

	raw := make([][]float64, 0, len(usable))
	for _, drive := range usable {
		raw = append(raw, rawFingerprint(drive))
	}
	normalised, mins, spans := normaliseMatrix(raw)

	clusterCount := len(profileRecords)
	if clusterCount < 2 {
		clusterCount = 2
	}
	if clusterCount > maxClusters {
		clusterCount = maxClusters
	}
	if clusterCount > len(usable) {
		clusterCount = len(usable)
	}
	labels, centroids := kmeans(normalised, clusterCount)

	assignmentByDrive := map[int64]port.AssignmentRecord{}
	for _, assignment := range assignments {
		assignmentByDrive[assignment.DriveID] = assignment
	}
	profileByID := map[int64]port.DriverProfileRecord{}
	for _, record := range profileRecords {
		profileByID[record.ID] = record
	}
	clusterToProfile := mapClustersToProfiles(usable, labels, assignmentByDrive, profileRecords, clusterCount)

	costPerWh := chargingCostPerWh(charges)
	currency := dominantCurrency(charges)
	report.Currency = currency

	fingerprints := make([]domain.DriveFingerprint, 0, len(usable))
	clusterStats := make([]clusterAccumulator, clusterCount)
	silhouetteSum := 0.0
	silhouetteCount := 0

	for index, drive := range usable {
		cluster := labels[index]
		own := euclidean(normalised[index], centroids[cluster])
		next := math.Inf(1)
		for other := range centroids {
			if other == cluster {
				continue
			}
			if distance := euclidean(normalised[index], centroids[other]); distance < next {
				next = distance
			}
		}
		fingerprint := domain.DriveFingerprint{
			DriveID:       drive.ID,
			StartedAt:     drive.StartedAt,
			DistanceM:     deref(drive.DistanceM),
			DurationS:     derefI64(drive.DurationS),
			Features:      describeFeatures(raw[index], normalised[index]),
			ClusterID:     cluster,
			Source:        "inferred",
			DistanceToOwn: own,
		}
		if !math.IsInf(next, 1) {
			fingerprint.DistanceToNext = pointer(next)
			separation := 0.0
			if next > 0 {
				separation = (next - own) / math.Max(next, own)
			}
			fingerprint.ConfidencePct = clamp(50+50*separation, 0, 100)
			fingerprint.Ambiguous = fingerprint.ConfidencePct < 60
			silhouetteSum += separation
			silhouetteCount++
		} else {
			fingerprint.ConfidencePct = 50
		}
		if profileID, ok := clusterToProfile[cluster]; ok {
			profile := profileByID[profileID]
			fingerprint.DriverProfileID = pointer(profileID)
			name := profile.Name
			fingerprint.DriverName = &name
		}
		if manual, ok := assignmentByDrive[drive.ID]; ok {
			fingerprint.Source = manual.Source
			fingerprint.ConfidencePct = manual.ConfidencePct
			fingerprint.Ambiguous = false
			fingerprint.DriverProfileID = pointer(manual.DriverProfileID)
			if profile, exists := profileByID[manual.DriverProfileID]; exists {
				name := profile.Name
				fingerprint.DriverName = &name
			}
			report.LabelledDriveCount++
		} else {
			report.InferredCount++
		}
		if fingerprint.Ambiguous {
			report.AmbiguousCount++
		}
		clusterStats[cluster].add(drive, fingerprint, own)
		fingerprints = append(fingerprints, fingerprint)
	}

	sort.SliceStable(fingerprints, func(i, j int) bool {
		return fingerprints[i].StartedAt.After(fingerprints[j].StartedAt)
	})
	paged, total := pageSlice(fingerprints, limit, offset)
	report.Fingerprints = paged
	report.Total = total

	totalDistance := 0.0
	for index := range clusterStats {
		totalDistance += clusterStats[index].distanceM
	}
	for index := range clusterStats {
		stats := clusterStats[index]
		if stats.driveCount == 0 {
			continue
		}
		cluster := stats.toDomain(index, totalDistance, centroids[index], mins, spans, costPerWh)
		if profileID, ok := clusterToProfile[index]; ok {
			cluster.DriverProfileID = pointer(profileID)
			profile := profileByID[profileID]
			name := profile.Name
			cluster.DriverName = &name
			cluster.Accent = profile.Accent
		} else {
			cluster.Accent = fallbackAccent(index)
		}
		report.Clusters = append(report.Clusters, cluster)
	}
	sort.SliceStable(report.Clusters, func(i, j int) bool {
		return report.Clusters[i].DistanceM > report.Clusters[j].DistanceM
	})

	if silhouetteCount > 0 {
		score := silhouetteSum / float64(silhouetteCount)
		report.SeparationScore = pointer(score)
		switch {
		case score >= 0.5:
			report.SeparationVerdict = "strong"
		case score >= 0.25:
			report.SeparationVerdict = "moderate"
		default:
			report.SeparationVerdict = "weak"
		}
	} else {
		report.SeparationVerdict = "unknown"
	}

	reasons := []string{}
	if len(profileRecords) == 0 {
		reasons = append(reasons, "no driver profiles exist, so clusters are unnamed")
	}
	if report.LabelledDriveCount == 0 {
		reasons = append(reasons, "no manual labels yet; cluster-to-driver mapping is unsupervised")
	}
	if report.SeparationVerdict == "weak" {
		reasons = append(reasons, "behavioural separation is weak; the drives may all share one driver")
	}
	report.Quality = quality(
		gradeQuality(len(usable), 10, 30),
		len(usable),
		domain.Float64Pointer(clamp(float64(len(usable))/30*100, 0, 100)),
		window,
		reasons...,
	)
	report.Evidence = append(report.Evidence, evidence(
		"drives",
		domain.TimePointer(window.To),
		domain.IntPointer(len(usable)),
		fmt.Sprintf(
			"%d drives were reduced to a %d-dimension behavioural vector and partitioned into %d clusters by weighted k-means.",
			len(usable), len(fingerprintSpecs), clusterCount,
		),
	))
	return report, nil
}

type clusterAccumulator struct {
	driveCount    int
	labelledCount int
	distanceM     float64
	durationS     int64
	energyWh      float64
	regenWh       float64
	speedSum      float64
	speedCount    int
	peakPowerW    float64
	nightDistance float64
	cohesionSum   float64
	aggressionSum float64
}

func (a *clusterAccumulator) add(drive port.DriveRecord, fingerprint domain.DriveFingerprint, own float64) {
	a.driveCount++
	if fingerprint.Source == "manual" {
		a.labelledCount++
	}
	distance := deref(drive.DistanceM)
	a.distanceM += distance
	a.durationS += derefI64(drive.DurationS)
	a.energyWh += math.Abs(deref(drive.EnergyUsedWh))
	a.regenWh += math.Abs(deref(drive.RegenEnergyWh))
	if drive.AvgSpeedMps != nil && *drive.AvgSpeedMps > 0 {
		a.speedSum += *drive.AvgSpeedMps
		a.speedCount++
	}
	if drive.PeakPowerW != nil && *drive.PeakPowerW > a.peakPowerW {
		a.peakPowerW = *drive.PeakPowerW
	}
	if isNight(drive.StartedAt) {
		a.nightDistance += distance
	}
	a.cohesionSum += own
	if drive.PeakPowerW != nil && drive.AvgPowerW != nil && *drive.AvgPowerW > 0 {
		a.aggressionSum += clamp(*drive.PeakPowerW/(*drive.AvgPowerW)/harshPowerRatio, 0, 2)
	}
}

func (a clusterAccumulator) toDomain(
	clusterID int,
	totalDistance float64,
	centroid, mins, spans []float64,
	costPerWh *float64,
) domain.DriverCluster {
	cluster := domain.DriverCluster{
		ClusterID:     clusterID,
		DriveCount:    a.driveCount,
		DistanceM:     a.distanceM,
		DurationS:     a.durationS,
		EnergyWh:      a.energyWh,
		LabelledCount: a.labelledCount,
		Centroid:      denormaliseCentroid(centroid, mins, spans),
	}
	if totalDistance > 0 {
		cluster.SharePct = a.distanceM / totalDistance * 100
		cluster.NightSharePct = a.nightDistance / math.Max(a.distanceM, 1) * 100
	}
	cluster.EfficiencyWhPerM = safeDiv(a.energyWh, a.distanceM)
	if a.speedCount > 0 {
		cluster.AvgSpeedMps = safeDiv(a.speedSum, float64(a.speedCount))
	}
	if a.peakPowerW > 0 {
		cluster.PeakPowerW = pointer(a.peakPowerW)
	}
	if a.energyWh > 0 {
		cluster.RegenSharePct = safeDiv(a.regenWh*100, a.energyWh)
	}
	if a.driveCount > 0 {
		cluster.Cohesion = clamp(1-a.cohesionSum/float64(a.driveCount), 0, 1)
		cluster.AggressionScore = clamp(a.aggressionSum/float64(a.driveCount)*50, 0, 100)
	}
	if costPerWh != nil {
		cluster.CostShareMinor = pointer(roundMinor(a.energyWh * *costPerWh))
	}
	return cluster
}

func rawFingerprint(drive port.DriveRecord) []float64 {
	distance := math.Max(deref(drive.DistanceM), 1)
	duration := math.Max(float64(derefI64(drive.DurationS)), 1)
	avgSpeed := distance / duration
	if drive.AvgSpeedMps != nil && *drive.AvgSpeedMps > 0 {
		avgSpeed = *drive.AvgSpeedMps
	}
	speedRatio := 1.0
	if drive.MaxSpeedMps != nil && avgSpeed > 0 {
		speedRatio = *drive.MaxSpeedMps / avgSpeed
	}
	powerIntensity := 1.0
	if drive.PeakPowerW != nil && drive.AvgPowerW != nil && *drive.AvgPowerW > 0 {
		powerIntensity = *drive.PeakPowerW / *drive.AvgPowerW
	}
	efficiency := math.Abs(deref(drive.EnergyUsedWh)) / distance
	regenShare := 0.0
	if energy := math.Abs(deref(drive.EnergyUsedWh)); energy > 0 {
		regenShare = math.Abs(deref(drive.RegenEnergyWh)) / energy
	}
	hourAngle := 2 * math.Pi * float64(drive.StartedAt.UTC().Hour()*60+drive.StartedAt.UTC().Minute()) / 1440
	return []float64{
		avgSpeed,
		clamp(speedRatio, 0, 12),
		clamp(powerIntensity, 0, 20),
		clamp(efficiency, 0, 2),
		clamp(regenShare, 0, 1),
		math.Sin(hourAngle),
		math.Cos(hourAngle),
	}
}

func normaliseMatrix(raw [][]float64) ([][]float64, []float64, []float64) {
	dimensions := len(fingerprintSpecs)
	mins := make([]float64, dimensions)
	maxs := make([]float64, dimensions)
	for dimension := 0; dimension < dimensions; dimension++ {
		mins[dimension] = math.Inf(1)
		maxs[dimension] = math.Inf(-1)
	}
	for _, row := range raw {
		for dimension, value := range row {
			mins[dimension] = math.Min(mins[dimension], value)
			maxs[dimension] = math.Max(maxs[dimension], value)
		}
	}
	spans := make([]float64, dimensions)
	for dimension := range spans {
		spans[dimension] = maxs[dimension] - mins[dimension]
	}
	normalised := make([][]float64, 0, len(raw))
	for _, row := range raw {
		scaled := make([]float64, dimensions)
		for dimension, value := range row {
			if spans[dimension] > 0 {
				scaled[dimension] = (value - mins[dimension]) / spans[dimension]
			}
			scaled[dimension] *= fingerprintSpecs[dimension].weight
		}
		normalised = append(normalised, scaled)
	}
	return normalised, mins, spans
}

// kmeans runs Lloyd's algorithm from a deterministic quantile seeding so the
// same evidence always yields the same partition.
func kmeans(points [][]float64, k int) ([]int, [][]float64) {
	if k <= 1 || len(points) == 0 {
		labels := make([]int, len(points))
		return labels, [][]float64{meanVector(points)}
	}
	order := make([]int, len(points))
	for index := range order {
		order[index] = index
	}
	magnitude := func(index int) float64 {
		total := 0.0
		for _, value := range points[index] {
			total += value
		}
		return total
	}
	sort.SliceStable(order, func(i, j int) bool { return magnitude(order[i]) < magnitude(order[j]) })

	centroids := make([][]float64, k)
	for cluster := 0; cluster < k; cluster++ {
		pick := order[(cluster*len(order))/k]
		centroids[cluster] = append([]float64(nil), points[pick]...)
	}

	labels := make([]int, len(points))
	for iteration := 0; iteration < kmeansIterations; iteration++ {
		changed := false
		for index, point := range points {
			best, bestDistance := 0, math.Inf(1)
			for cluster, centroid := range centroids {
				if distance := euclidean(point, centroid); distance < bestDistance {
					best, bestDistance = cluster, distance
				}
			}
			if labels[index] != best {
				labels[index] = best
				changed = true
			}
		}
		next := make([][]float64, k)
		counts := make([]int, k)
		for cluster := range next {
			next[cluster] = make([]float64, len(points[0]))
		}
		for index, point := range points {
			cluster := labels[index]
			counts[cluster]++
			for dimension, value := range point {
				next[cluster][dimension] += value
			}
		}
		movement := 0.0
		for cluster := range next {
			if counts[cluster] == 0 {
				next[cluster] = append([]float64(nil), centroids[cluster]...)
				continue
			}
			for dimension := range next[cluster] {
				next[cluster][dimension] /= float64(counts[cluster])
			}
			movement += euclidean(next[cluster], centroids[cluster])
		}
		centroids = next
		if !changed || movement < convergenceEpsilon {
			break
		}
	}
	return labels, centroids
}

func euclidean(left, right []float64) float64 {
	total := 0.0
	for index := range left {
		if index >= len(right) {
			break
		}
		delta := left[index] - right[index]
		total += delta * delta
	}
	return math.Sqrt(total)
}

func meanVector(points [][]float64) []float64 {
	if len(points) == 0 {
		return make([]float64, len(fingerprintSpecs))
	}
	result := make([]float64, len(points[0]))
	for _, point := range points {
		for dimension, value := range point {
			result[dimension] += value
		}
	}
	for dimension := range result {
		result[dimension] /= float64(len(points))
	}
	return result
}

func describeFeatures(raw, normalised []float64) []domain.FingerprintFeature {
	features := make([]domain.FingerprintFeature, 0, len(fingerprintSpecs))
	for index, spec := range fingerprintSpecs {
		if index >= len(raw) {
			break
		}
		features = append(features, domain.FingerprintFeature{
			Code:       spec.code,
			Label:      spec.label,
			RawValue:   raw[index],
			SIUnit:     spec.unit,
			Normalised: normalised[index],
			Weight:     spec.weight,
		})
	}
	return features
}

func denormaliseCentroid(centroid, mins, spans []float64) []domain.FingerprintFeature {
	features := make([]domain.FingerprintFeature, 0, len(fingerprintSpecs))
	for index, spec := range fingerprintSpecs {
		if index >= len(centroid) {
			break
		}
		scaled := centroid[index]
		if spec.weight > 0 {
			scaled /= spec.weight
		}
		raw := mins[index] + scaled*spans[index]
		features = append(features, domain.FingerprintFeature{
			Code:       spec.code,
			Label:      spec.label,
			RawValue:   raw,
			SIUnit:     spec.unit,
			Normalised: scaled,
			Weight:     spec.weight,
		})
	}
	return features
}

// mapClustersToProfiles resolves cluster identity from manual labels first and
// falls back to a stable ordering so unnamed installs still get consistent IDs.
func mapClustersToProfiles(
	drives []port.DriveRecord,
	labels []int,
	assignments map[int64]port.AssignmentRecord,
	profiles []port.DriverProfileRecord,
	clusterCount int,
) map[int]int64 {
	mapping := map[int]int64{}
	if len(profiles) == 0 {
		return mapping
	}
	votes := make([]map[int64]int, clusterCount)
	for cluster := range votes {
		votes[cluster] = map[int64]int{}
	}
	for index, drive := range drives {
		assignment, ok := assignments[drive.ID]
		if !ok || assignment.Source != "manual" {
			continue
		}
		votes[labels[index]][assignment.DriverProfileID]++
	}
	claimed := map[int64]bool{}
	for cluster := 0; cluster < clusterCount; cluster++ {
		bestProfile := int64(0)
		bestVotes := 0
		for profileID, count := range votes[cluster] {
			if claimed[profileID] {
				continue
			}
			if count > bestVotes || (count == bestVotes && profileID < bestProfile) {
				bestProfile, bestVotes = profileID, count
			}
		}
		if bestVotes > 0 {
			mapping[cluster] = bestProfile
			claimed[bestProfile] = true
		}
	}
	ordered := append([]port.DriverProfileRecord(nil), profiles...)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].IsPrimary != ordered[j].IsPrimary {
			return ordered[i].IsPrimary
		}
		return ordered[i].ID < ordered[j].ID
	})
	next := 0
	for cluster := 0; cluster < clusterCount; cluster++ {
		if _, done := mapping[cluster]; done {
			continue
		}
		for next < len(ordered) && claimed[ordered[next].ID] {
			next++
		}
		if next >= len(ordered) {
			break
		}
		mapping[cluster] = ordered[next].ID
		claimed[ordered[next].ID] = true
	}
	return mapping
}

func chargingCostPerWh(charges []port.ChargeRecord) *float64 {
	totalMinor := int64(0)
	totalWh := 0.0
	for _, charge := range charges {
		if charge.CostMinor == nil || charge.EnergyAddedWh == nil || *charge.EnergyAddedWh <= 0 {
			continue
		}
		totalMinor += *charge.CostMinor
		totalWh += *charge.EnergyAddedWh
	}
	if totalWh <= 0 || totalMinor <= 0 {
		return nil
	}
	return safeDiv(float64(totalMinor), totalWh)
}

func dominantCurrency(charges []port.ChargeRecord) string {
	counts := map[string]int{}
	for _, charge := range charges {
		if code, ok := validCurrency(charge.CostCurrency); ok {
			counts[code]++
		}
	}
	best, bestCount := "", 0
	for code, count := range counts {
		if count > bestCount || (count == bestCount && code < best) {
			best, bestCount = code, count
		}
	}
	return best
}

func isValidAccent(accent string) bool {
	switch accent {
	case "cyan", "emerald", "amber", "rose", "violet", "sky":
		return true
	default:
		return false
	}
}

func fallbackAccent(index int) string {
	accents := []string{"cyan", "emerald", "amber", "rose", "violet", "sky"}
	return accents[index%len(accents)]
}

func driverProfileToDomain(record port.DriverProfileRecord) domain.DriverProfile {
	return domain.DriverProfile{
		ID:        record.ID,
		VehicleID: record.VehicleID,
		Name:      record.Name,
		Accent:    record.Accent,
		IsPrimary: record.IsPrimary,
		Version:   record.Version,
		CreatedAt: record.CreatedAt,
		UpdatedAt: record.UpdatedAt,
	}
}
