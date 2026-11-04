package driveaddressrepair

import (
	"context"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	dbadmin "github.com/ev-dev-labs/teslasync/internal/database/admin"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	geofencedb "github.com/ev-dev-labs/teslasync/internal/database/geofence"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
)

// GeocodeRateLimit paces provider calls during bulk repair passes.
// Nominatim's usage policy caps callers at 1 request/second.
const GeocodeRateLimit = 1100 * time.Millisecond

// repairBatch bounds one finder round-trip of the repair.
const repairBatch = 100

// Lookup is a resolved place name for one coordinate pair. GeofenceID is
// set only when the name came from a matched geofence.
type Lookup struct {
	Name       string
	GeofenceID *int64
}

// Resolver resolves place names from coordinates: geofences first, then
// (when allowed) the places cache, then the reverse geocoder. The cache
// is keyed by the coordinates themselves, so a start and an end far apart
// never share an entry.
type Resolver struct {
	geofences *geofencedb.GeofenceRepo
	cache     *dbadmin.PlacesCacheRepo
	geocoder  geocoding.Geocoder
}

// NewResolver builds a Resolver from its repository and provider deps.
func NewResolver(geofences *geofencedb.GeofenceRepo, cache *dbadmin.PlacesCacheRepo, geocoder geocoding.Geocoder) *Resolver {
	return &Resolver{geofences: geofences, cache: cache, geocoder: geocoder}
}

// Lookup resolves a name for the given coordinates only. It writes
// nothing except, when writeCache is true, the places-cache entry and hit
// count. It reports false when no name could be resolved — callers must
// leave any stored label untouched (never substitute another endpoint's
// label).
func (r *Resolver) Lookup(ctx context.Context, lat, lon float64, useCache, writeCache bool) (Lookup, bool) {
	if geofences, err := r.geofences.FindByCoordinates(ctx, lat, lon); err == nil && len(geofences) > 0 {
		metrics.GeocodingTotal.WithLabelValues("geofence").Inc()
		return Lookup{Name: geofences[0].Name, GeofenceID: &geofences[0].ID}, true
	}
	if useCache {
		if cached, err := r.cache.FindNearby(ctx, lat, lon, 50); err == nil && cached != nil {
			if writeCache {
				_ = r.cache.IncrementHitCount(ctx, cached.ID)
			}
			metrics.GeocodingTotal.WithLabelValues("cached").Inc()
			return Lookup{Name: cached.DisplayName}, true
		}
	}
	geocodeStart := time.Now()
	result, err := r.geocoder.ReverseGeocode(ctx, lat, lon)
	metrics.ObserveDurationWithExemplar(ctx, metrics.GeocodingDuration, time.Since(geocodeStart).Seconds())
	if err != nil {
		metrics.GeocodingTotal.WithLabelValues("failure").Inc()
		log.Warn().Err(err).Float64("lat", lat).Float64("lon", lon).Msg("driveaddressrepair: reverse geocode failed")
		return Lookup{}, false
	}
	if result == nil {
		metrics.GeocodingTotal.WithLabelValues("failure").Inc()
		log.Warn().Float64("lat", lat).Float64("lon", lon).Msg("driveaddressrepair: reverse geocode returned no result")
		return Lookup{}, false
	}
	metrics.GeocodingTotal.WithLabelValues("success").Inc()
	name := result.ShortName()
	if name == "" {
		log.Warn().Float64("lat", lat).Float64("lon", lon).Msg("driveaddressrepair: reverse geocode produced an empty place name")
		return Lookup{}, false
	}
	if writeCache {
		_ = r.cache.Upsert(ctx, &dbadmin.PlaceCacheEntry{
			Latitude:     lat,
			Longitude:    lon,
			DisplayName:  name,
			Source:       "geocoding",
			BusinessName: strPtrOrNil(result.Name),
			City:         strPtrOrNil(result.City),
			State:        strPtrOrNil(result.State),
			Country:      strPtrOrNil(result.Country),
			Postcode:     strPtrOrNil(result.PostCode),
		})
	}
	return Lookup{Name: name}, true
}

func strPtrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Change describes one drive the repair proposes (dry run) or applied.
type Change struct {
	DriveID   int64
	OldEnd    string
	NewEnd    string
	StartLat  float64
	StartLon  float64
	EndLat    float64
	EndLon    float64
	DistanceM float64
}

// Report summarizes one Repair pass.
type Report struct {
	DryRun  bool
	Scanned int
	Changed []Change
	Failed  int
}

// PlanEndAddressRepair decides the new end label for a suspect drive
// from the name resolved at its end coordinates. It returns false when
// nothing may be written: the drive is not suspect (e.g. a genuine
// round trip), the lookup failed, or the end coordinates resolve to the
// start label again. A failed or unhelpful lookup never copies the
// start address.
func PlanEndAddressRepair(d *drivemodel.Drive, resolved string, lookupOK bool) (string, bool) {
	if d == nil || !d.HasDuplicateEndAddress() || !lookupOK {
		return "", false
	}
	resolved = strings.TrimSpace(resolved)
	if resolved == "" || resolved == strings.TrimSpace(*d.StartAddress) {
		return "", false
	}
	return resolved, true
}

// Repairer re-resolves duplicate end addresses. Pace paces lookups for
// the geocoding provider's rate limit; nil uses GeocodeRateLimit.
type Repairer struct {
	drives   *drivedb.DriveRepo
	resolver *Resolver
	Pace     func()
}

// NewRepairer builds a Repairer from its deps.
func NewRepairer(drives *drivedb.DriveRepo, resolver *Resolver) *Repairer {
	return &Repairer{drives: drives, resolver: resolver}
}

func (r *Repairer) pace() {
	if r.Pace != nil {
		r.Pace()
		return
	}
	time.Sleep(GeocodeRateLimit)
}

// Repair re-resolves the end address from the end coordinates for
// drives whose stored end address equals the start address while the
// endpoints are far apart. It is idempotent: once a drive's end label
// differs from its start label it is never selected again, and genuine
// round trips are excluded by the distance predicate. In dry-run mode
// it lists affected drives and proposed changes without writing
// anything. Failures are logged and left unchanged for a later pass.
func (r *Repairer) Repair(ctx context.Context, dryRun bool) (Report, error) {
	report := Report{DryRun: dryRun}
	if r.drives == nil || r.resolver == nil {
		return report, nil
	}
	seen := make(map[int64]struct{})
	for {
		if ctx.Err() != nil {
			break
		}
		drives, err := r.drives.FindDuplicateEndAddresses(ctx, repairBatch)
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

			lookup, lookupOK := r.resolver.Lookup(ctx, *d.EndLat, *d.EndLon, false, !dryRun)
			newEnd, write := PlanEndAddressRepair(d, lookup.Name, lookupOK)
			if !write {
				report.Failed++
				log.Warn().Int64("drive_id", d.ID).
					Bool("lookup_ok", lookupOK).Str("resolved", lookup.Name).
					Msg("drive end-address repair: end lookup did not produce a distinct label; leaving drive unchanged")
				r.pace()
				continue
			}
			change := Change{
				DriveID: d.ID, OldEnd: *d.EndAddress, NewEnd: newEnd,
				StartLat: *d.StartLat, StartLon: *d.StartLon,
				EndLat: *d.EndLat, EndLon: *d.EndLon,
			}
			change.DistanceM, _ = d.EndpointDistanceM()
			if dryRun {
				report.Changed = append(report.Changed, change)
				log.Info().Int64("drive_id", d.ID).Str("old_end", change.OldEnd).
					Str("proposed_end", newEnd).Float64("distance_m", change.DistanceM).
					Msg("drive end-address repair (dry run): would re-resolve end address")
				r.pace()
				continue
			}
			fields := map[string]interface{}{"end_place": newEnd}
			if lookup.GeofenceID != nil {
				fields["end_geofence_id"] = *lookup.GeofenceID
			}
			if err := r.drives.PartialUpdate(ctx, d.ID, fields); err != nil {
				report.Failed++
				log.Error().Err(err).Int64("drive_id", d.ID).
					Msg("drive end-address repair: failed to update end address")
				r.pace()
				continue
			}
			report.Changed = append(report.Changed, change)
			log.Info().Int64("drive_id", d.ID).Str("old_end", change.OldEnd).
				Str("new_end", newEnd).Float64("distance_m", change.DistanceM).
				Msg("drive end-address repair: re-resolved end address from end coordinates")
			r.pace()
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
