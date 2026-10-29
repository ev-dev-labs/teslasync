package telemetry

import (
	"context"
	"strings"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	"github.com/rs/zerolog/log"
)

// duplicateEndAddressRepairBatch bounds one finder round-trip of the
// duplicate-end-address repair, mirroring placeLabelRepairBatch.
const duplicateEndAddressRepairBatch = 100

// EndAddressRepairChange describes one drive the duplicate-end-address
// repair proposes (dry run) or applied.
type EndAddressRepairChange struct {
	DriveID   int64
	OldEnd    string
	NewEnd    string
	StartLat  float64
	StartLon  float64
	EndLat    float64
	EndLon    float64
	DistanceM float64
}

// EndAddressRepairReport summarizes one RepairDuplicateEndAddresses pass.
type EndAddressRepairReport struct {
	DryRun  bool
	Scanned int
	Changed []EndAddressRepairChange
	Failed  int
}

// planEndAddressRepair decides the new end label for a suspect drive from
// the name resolved at its end coordinates. It returns false when nothing
// may be written: the drive is not suspect (e.g. a genuine round trip),
// the lookup failed, or the end coordinates resolve to the start label
// again. A failed or unhelpful lookup never copies the start address —
// the stored label is left for a later pass and readers suppress it in
// the meantime (see drivemodel.Drive.ClearSuspectEndAddress).
func planEndAddressRepair(d *drivemodel.Drive, resolved string, lookupOK bool) (string, bool) {
	if d == nil || !d.HasDuplicateEndAddress() || !lookupOK {
		return "", false
	}
	resolved = strings.TrimSpace(resolved)
	if resolved == "" || resolved == strings.TrimSpace(*d.StartAddress) {
		return "", false
	}
	return resolved, true
}

// RepairDuplicateEndAddresses re-resolves the end address from the end
// coordinates for drives whose stored end address equals the start
// address while the endpoints are far apart
// (drivemodel.DuplicateEndAddressDistanceM). It is idempotent: once a
// drive's end label differs from its start label it is never selected
// again, and genuine round trips are excluded by the distance predicate
// in both the finder and planEndAddressRepair.
//
// In dry-run mode it lists the affected drives and the proposed new end
// labels without writing anything (no drive update, no places-cache
// write). Lookups bypass the places cache, which may hold the stale
// label, and are paced by geocodeRateLimit. Failures are logged and left
// unchanged for a later pass.
func (t *TelemetrySessionTracker) RepairDuplicateEndAddresses(ctx context.Context, dryRun bool) (EndAddressRepairReport, error) {
	report := EndAddressRepairReport{DryRun: dryRun}
	if t.driveRepo == nil || t.geocoder == nil {
		return report, nil
	}
	seen := make(map[int64]struct{})
	for {
		if ctx.Err() != nil {
			break
		}
		drives, err := t.driveRepo.FindDuplicateEndAddresses(ctx, duplicateEndAddressRepairBatch)
		if err != nil {
			return report, err
		}
		progressed := false
		for _, d := range drives {
			if ctx.Err() != nil {
				break
			}
			if _, dup := seen[d.ID]; dup {
				continue
			}
			seen[d.ID] = struct{}{}
			progressed = true
			report.Scanned++

			lookup, lookupOK := t.lookupPlaceName(ctx, *d.EndLat, *d.EndLon, resolveBypassCache, !dryRun)
			newEnd, write := planEndAddressRepair(d, lookup.Name, lookupOK)
			if !write {
				report.Failed++
				log.Warn().Int64("drive_id", d.ID).
					Bool("lookup_ok", lookupOK).Str("resolved", lookup.Name).
					Msg("drive end-address repair: end lookup did not produce a distinct label; leaving drive unchanged")
				time.Sleep(geocodeRateLimit)
				continue
			}
			change := EndAddressRepairChange{
				DriveID: d.ID, OldEnd: *d.EndAddress, NewEnd: newEnd,
				StartLat: *d.StartLat, StartLon: *d.StartLon,
				EndLat: *d.EndLat, EndLon: *d.EndLon,
			}
			change.DistanceM, _ = d.EndpointDistanceM()
			report.Changed = append(report.Changed, change)
			if dryRun {
				log.Info().Int64("drive_id", d.ID).Str("old_end", change.OldEnd).
					Str("proposed_end", newEnd).Float64("distance_m", change.DistanceM).
					Msg("drive end-address repair (dry run): would re-resolve end address")
				time.Sleep(geocodeRateLimit)
				continue
			}
			fields := map[string]interface{}{"end_place": newEnd}
			if lookup.GeofenceID != nil {
				fields["end_geofence_id"] = *lookup.GeofenceID
			}
			if err := t.driveRepo.PartialUpdate(ctx, d.ID, fields); err != nil {
				report.Failed++
				// Drop the unapplied change from the report.
				report.Changed = report.Changed[:len(report.Changed)-1]
				log.Error().Err(err).Int64("drive_id", d.ID).
					Msg("drive end-address repair: failed to update end address")
				time.Sleep(geocodeRateLimit)
				continue
			}
			log.Info().Int64("drive_id", d.ID).Str("old_end", change.OldEnd).
				Str("new_end", newEnd).Float64("distance_m", change.DistanceM).
				Msg("drive end-address repair: re-resolved end address from end coordinates")
			time.Sleep(geocodeRateLimit)
		}
		if !progressed {
			break
		}
	}
	log.Info().Bool("dry_run", dryRun).Int("scanned", report.Scanned).
		Int("changed", len(report.Changed)).Int("failed", report.Failed).
		Msg("drive end-address repair: complete")
	return report, nil
}
