package ownershipintelsvc

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

// governedDatasets is the closed allow-list of datasets a retention policy may
// target. Keeping it closed means a policy can never be pointed at an
// arbitrary table name, which is what makes the dry-run engine safe to expose.
var governedDatasets = []struct {
	dataset string
	label   string
}{
	{"signal_log", "Raw signal history"},
	{"positions", "Position snapshots"},
	{"climate_snapshots", "Climate snapshots"},
	{"security_events", "Security events"},
	{"tire_pressure_snapshots", "Tire pressure snapshots"},
	{"motor_snapshots", "Motor telemetry snapshots"},
	{"media_snapshots", "Media snapshots"},
	{"drives", "Completed drives"},
	{"charging_sessions", "Charging sessions"},
	{"notification_logs", "Notification delivery log"},
	{"alerts", "Alert history"},
	{"audit_logs", "Administrative audit log"},
}

func datasetLabel(dataset string) string {
	for _, entry := range governedDatasets {
		if entry.dataset == dataset {
			return entry.label
		}
	}
	return dataset
}

func isGovernedDataset(dataset string) bool {
	for _, entry := range governedDatasets {
		if entry.dataset == dataset {
			return true
		}
	}
	return false
}

func allGovernedDatasets() []string {
	datasets := make([]string, 0, len(governedDatasets))
	for _, entry := range governedDatasets {
		datasets = append(datasets, entry.dataset)
	}
	return datasets
}

// GovernanceOverview reports the live storage footprint alongside the
// lifecycle rules that would apply to it. TeslaSync never deletes data from
// this surface, so the response is always flagged plan-only.
func (s *Service) GovernanceOverview(ctx context.Context, subject string) (*domain.GovernanceOverview, error) {
	now := s.now()
	policies, err := s.durable.ListRetentionPolicies(ctx, subject)
	if err != nil {
		return nil, fmt.Errorf("list retention policies: %w", err)
	}
	stats, err := s.source.DatasetStats(ctx, allGovernedDatasets())
	if err != nil {
		return nil, fmt.Errorf("dataset stats: %w", err)
	}

	overview := &domain.GovernanceOverview{
		AsOf:      now,
		Policies:  make([]domain.RetentionPolicy, 0, len(policies)),
		Inventory: make([]domain.DatasetInventory, 0, len(stats)),
		PlanOnly:  true,
		Evidence:  []domain.Evidence{},
	}
	governedBy := map[string]port.RetentionPolicyRecord{}
	for _, record := range policies {
		overview.Policies = append(overview.Policies, retentionPolicyToDomain(record))
		governedBy[record.Dataset] = record
		if record.LegalHold {
			overview.LegalHoldCount++
		}
	}

	for _, stat := range stats {
		policy, governed := governedBy[stat.Dataset]
		inventory := domain.DatasetInventory{
			Dataset:      stat.Dataset,
			Label:        datasetLabel(stat.Dataset),
			RowCount:     stat.RowCount,
			TotalBytes:   stat.TotalBytes,
			OldestAt:     stat.OldestAt,
			NewestAt:     stat.NewestAt,
			IsHypertable: stat.IsHypertable,
			Governed:     governed && policy.Enabled,
		}
		if stat.OldestAt != nil && stat.NewestAt != nil {
			span := int64(stat.NewestAt.Sub(*stat.OldestAt).Seconds())
			inventory.SpanS = &span
		}
		if stat.RowCount > 0 {
			inventory.BytesPerRow = pointer(float64(stat.TotalBytes) / float64(stat.RowCount))
		}
		overview.TotalBytes += stat.TotalBytes
		if inventory.Governed {
			overview.GovernedBytes += stat.TotalBytes
		} else {
			overview.UngovernedBytes += stat.TotalBytes
		}
		overview.Inventory = append(overview.Inventory, inventory)
	}
	sort.SliceStable(overview.Inventory, func(i, j int) bool {
		return overview.Inventory[i].TotalBytes > overview.Inventory[j].TotalBytes
	})
	if overview.TotalBytes > 0 {
		overview.GovernedSharePct = float64(overview.GovernedBytes) / float64(overview.TotalBytes) * 100
	}

	reasons := []string{}
	if len(policies) == 0 {
		reasons = append(reasons, "no retention policies are defined, so every dataset grows without bound")
	}
	if overview.TotalBytes == 0 {
		reasons = append(reasons, "storage statistics are unavailable; the database may not expose relation sizes")
	}
	overview.Quality = quality(
		gradeQuality(len(overview.Inventory), 3, len(governedDatasets)),
		len(overview.Inventory),
		domain.Float64Pointer(clamp(float64(len(overview.Inventory))/float64(len(governedDatasets))*100, 0, 100)),
		domain.Window{From: now, To: now},
		reasons...,
	)
	overview.Evidence = append(overview.Evidence, evidence(
		"pg_catalog",
		domain.TimePointer(now),
		domain.IntPointer(len(overview.Inventory)),
		"Row counts and on-disk sizes are read live from the database catalog, including TimescaleDB chunk totals for hypertables.",
	))
	return overview, nil
}

// UpsertRetentionPolicy authors a plan-only lifecycle rule.
func (s *Service) UpsertRetentionPolicy(
	ctx context.Context,
	subject string,
	request domain.UpsertRetentionPolicyRequest,
) (*domain.RetentionPolicy, error) {
	if !isGovernedDataset(request.Dataset) {
		return nil, fmt.Errorf("%w: dataset is not governable", ErrInvalidInput)
	}
	if !requirePositive(request.RetentionS) {
		return nil, fmt.Errorf("%w: retention_s must be positive", ErrInvalidInput)
	}
	if request.RetentionS < 24*3600 {
		return nil, fmt.Errorf("%w: retention_s cannot be shorter than one day", ErrInvalidInput)
	}
	if request.DownsampleAfterS != nil {
		if *request.DownsampleAfterS <= 0 || *request.DownsampleAfterS >= request.RetentionS {
			return nil, fmt.Errorf("%w: downsample_after_s must be positive and shorter than retention_s", ErrInvalidInput)
		}
		if request.DownsampleBucketS == nil || *request.DownsampleBucketS <= 0 {
			return nil, fmt.Errorf("%w: downsample_bucket_s is required when downsampling is enabled", ErrInvalidInput)
		}
	}
	record, err := s.durable.UpsertRetentionPolicy(ctx, subject, port.RetentionPolicyRecord{
		Dataset:           request.Dataset,
		RetentionS:        request.RetentionS,
		DownsampleAfterS:  request.DownsampleAfterS,
		DownsampleBucketS: request.DownsampleBucketS,
		LegalHold:         request.LegalHold,
		Enabled:           request.Enabled,
	})
	if err != nil {
		return nil, fmt.Errorf("upsert retention policy: %w", err)
	}
	policy := retentionPolicyToDomain(*record)
	return &policy, nil
}

// DeleteRetentionPolicy removes a lifecycle rule.
func (s *Service) DeleteRetentionPolicy(ctx context.Context, subject string, id int64) error {
	if id <= 0 {
		return fmt.Errorf("%w: retention policy id must be positive", ErrInvalidInput)
	}
	if err := s.durable.DeleteRetentionPolicy(ctx, subject, id); err != nil {
		return fmt.Errorf("delete retention policy: %w", err)
	}
	return nil
}

// SimulateGovernance computes the dry-run impact of every enabled policy. It
// counts rows and estimates reclaimable bytes but never mutates a single row.
func (s *Service) SimulateGovernance(
	ctx context.Context,
	subject string,
	request domain.GovernanceSimulationRequest,
) (*domain.GovernanceSimulationResponse, error) {
	if !request.Confirmed {
		return nil, ErrNotConfirmed
	}
	now := s.now()
	policies, err := s.durable.ListRetentionPolicies(ctx, subject)
	if err != nil {
		return nil, fmt.Errorf("list retention policies: %w", err)
	}
	if len(policies) == 0 {
		return nil, fmt.Errorf("%w: define at least one retention policy before simulating", ErrInvalidInput)
	}
	selected := map[string]bool{}
	for _, dataset := range request.Datasets {
		if !isGovernedDataset(dataset) {
			return nil, fmt.Errorf("%w: %q is not a governable dataset", ErrInvalidInput, dataset)
		}
		selected[dataset] = true
	}

	targets := make([]port.RetentionPolicyRecord, 0, len(policies))
	datasets := make([]string, 0, len(policies))
	for _, policy := range policies {
		if !policy.Enabled {
			continue
		}
		if len(selected) > 0 && !selected[policy.Dataset] {
			continue
		}
		targets = append(targets, policy)
		datasets = append(datasets, policy.Dataset)
	}
	if len(targets) == 0 {
		return nil, fmt.Errorf("%w: no enabled policies match the requested datasets", ErrInvalidInput)
	}

	stats, err := s.source.DatasetStats(ctx, datasets)
	if err != nil {
		return nil, fmt.Errorf("dataset stats: %w", err)
	}
	statByDataset := map[string]port.DatasetStat{}
	for _, stat := range stats {
		statByDataset[stat.Dataset] = stat
	}

	response := &domain.GovernanceSimulationResponse{
		AsOf:     now,
		Impacts:  make([]domain.RetentionImpact, 0, len(targets)),
		PlanOnly: true,
		Evidence: []domain.Evidence{},
	}
	runs := make([]port.RetentionRunRecord, 0, len(targets))
	fidelityWeighted, fidelityWeight := 0.0, 0.0

	for _, policy := range targets {
		cutoff := now.Add(-time.Duration(policy.RetentionS) * time.Second)
		downsampleCutoff := cutoff
		if policy.DownsampleAfterS != nil {
			downsampleCutoff = now.Add(-time.Duration(*policy.DownsampleAfterS) * time.Second)
		}
		scanned, expiring, downsampling, err := s.source.DatasetExpiry(ctx, policy.Dataset, cutoff, downsampleCutoff)
		if err != nil {
			return nil, fmt.Errorf("dataset expiry for %s: %w", policy.Dataset, err)
		}
		stat := statByDataset[policy.Dataset]
		impact := domain.RetentionImpact{
			Dataset:            policy.Dataset,
			Label:              datasetLabel(policy.Dataset),
			PolicyID:           pointer(policy.ID),
			RetentionS:         policy.RetentionS,
			RowsScanned:        scanned,
			RowsExpiring:       expiring,
			RowsDownsampling:   downsampling,
			RowsRetained:       maxInt64(scanned-expiring, 0),
			BlockedByLegalHold: policy.LegalHold,
			Warnings:           []string{},
		}

		bytesPerRow := 0.0
		if stat.RowCount > 0 {
			bytesPerRow = float64(stat.TotalBytes) / float64(stat.RowCount)
		}
		reclaimable := int64(float64(expiring) * bytesPerRow)
		if policy.DownsampleBucketS != nil && *policy.DownsampleBucketS > 0 && downsampling > 0 {
			// A downsampled row is replaced by one bucket row, so the saving is
			// proportional to how many source rows collapse into each bucket.
			collapse := estimateCollapseRatio(stat, *policy.DownsampleBucketS)
			reclaimable += int64(float64(downsampling) * bytesPerRow * (1 - 1/math.Max(collapse, 1)))
		}
		if policy.LegalHold {
			reclaimable = 0
			impact.Warnings = append(impact.Warnings, "A legal hold is active, so nothing would be removed even if execution were enabled.")
		}
		impact.BytesReclaimable = reclaimable
		if stat.TotalBytes > 0 {
			impact.ReclaimSharePct = clamp(float64(reclaimable)/float64(stat.TotalBytes)*100, 0, 100)
		}
		if scanned > 0 {
			loss := float64(expiring)/float64(scanned)*100 + float64(downsampling)/float64(scanned)*25
			impact.FidelityLossPct = clamp(loss, 0, 100)
			fidelityWeighted += impact.FidelityLossPct * float64(scanned)
			fidelityWeight += float64(scanned)
		}
		if stat.OldestAt != nil && stat.NewestAt != nil && stat.RowCount > 0 {
			span := stat.NewestAt.Sub(*stat.OldestAt).Hours() / 24
			if span >= 1 {
				daily := float64(stat.TotalBytes) / span
				impact.ProjectedDailyBytes = pointer(daily)
				if daily > 0 && reclaimable > 0 {
					runway := int(float64(reclaimable) / daily)
					impact.RunwayDays = &runway
				}
			}
		}
		if impact.FidelityLossPct > 50 {
			impact.Warnings = append(impact.Warnings,
				"More than half the dataset would age out under this policy; consider a longer retention or a downsample tier.")
		}
		if expiring == 0 && downsampling == 0 {
			impact.Warnings = append(impact.Warnings, "Nothing is old enough to be affected by this policy yet.")
		}

		response.Impacts = append(response.Impacts, impact)
		response.TotalRowsExpiring += expiring
		response.TotalBytesReclaim += reclaimable
		runs = append(runs, port.RetentionRunRecord{
			Dataset:          policy.Dataset,
			Mode:             "dry_run",
			RowsScanned:      scanned,
			RowsExpiring:     expiring,
			RowsDownsampling: downsampling,
			BytesReclaimable: reclaimable,
			FidelityLossPct:  impact.FidelityLossPct,
			BlockedByHold:    policy.LegalHold,
			ExecutedAt:       now,
		})
	}

	sort.SliceStable(response.Impacts, func(i, j int) bool {
		return response.Impacts[i].BytesReclaimable > response.Impacts[j].BytesReclaimable
	})
	if fidelityWeight > 0 {
		response.TotalFidelityLossPct = fidelityWeighted / fidelityWeight
	}
	if err := s.durable.RecordRuns(ctx, subject, runs); err != nil {
		return nil, fmt.Errorf("record retention runs: %w", err)
	}

	response.Quality = quality(
		gradeQuality(len(response.Impacts), 1, len(governedDatasets)),
		len(response.Impacts),
		domain.Float64Pointer(clamp(float64(len(response.Impacts))/float64(len(governedDatasets))*100, 0, 100)),
		domain.Window{From: now, To: now},
	)
	response.Evidence = append(response.Evidence, evidence(
		"retention_runs",
		domain.TimePointer(now),
		domain.IntPointer(len(runs)),
		"Every simulation is written to an immutable dry-run ledger. TeslaSync never executes a deletion from this surface.",
	))
	return response, nil
}

// ListRetentionRuns returns the dry-run ledger.
func (s *Service) ListRetentionRuns(
	ctx context.Context,
	subject string,
	limit, offset int,
) (*domain.Page[domain.RetentionRun], error) {
	limit, offset = normalizePage(limit, offset)
	records, total, err := s.durable.ListRuns(ctx, subject, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list retention runs: %w", err)
	}
	items := make([]domain.RetentionRun, 0, len(records))
	for _, record := range records {
		items = append(items, domain.RetentionRun{
			ID:               record.ID,
			Dataset:          record.Dataset,
			Mode:             record.Mode,
			RowsScanned:      record.RowsScanned,
			RowsExpiring:     record.RowsExpiring,
			RowsDownsampling: record.RowsDownsampling,
			BytesReclaimable: record.BytesReclaimable,
			FidelityLossPct:  record.FidelityLossPct,
			BlockedByHold:    record.BlockedByHold,
			ExecutedAt:       record.ExecutedAt,
		})
	}
	return &domain.Page[domain.RetentionRun]{Items: items, Total: total, Limit: limit, Offset: offset}, nil
}

// estimateCollapseRatio approximates how many source rows fall into one
// downsample bucket, using the dataset's observed row density over its span.
func estimateCollapseRatio(stat port.DatasetStat, bucketS int64) float64 {
	if stat.OldestAt == nil || stat.NewestAt == nil || stat.RowCount <= 0 {
		return 1
	}
	span := stat.NewestAt.Sub(*stat.OldestAt).Seconds()
	if span <= 0 {
		return 1
	}
	rowsPerSecond := float64(stat.RowCount) / span
	return math.Max(rowsPerSecond*float64(bucketS), 1)
}

func retentionPolicyToDomain(record port.RetentionPolicyRecord) domain.RetentionPolicy {
	return domain.RetentionPolicy{
		ID:                record.ID,
		Dataset:           record.Dataset,
		RetentionS:        record.RetentionS,
		DownsampleAfterS:  record.DownsampleAfterS,
		DownsampleBucketS: record.DownsampleBucketS,
		LegalHold:         record.LegalHold,
		Enabled:           record.Enabled,
		Version:           record.Version,
		CreatedAt:         record.CreatedAt,
		UpdatedAt:         record.UpdatedAt,
	}
}
