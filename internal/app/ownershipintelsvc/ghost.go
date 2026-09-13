package ownershipintelsvc

import (
	"context"
	"fmt"
	"sort"

	"github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
)

// Ghost scoring: unattributed drives far from their cluster centroid are
// the ghost signature (valet, teen, thief — or just a hire car weekend).
// Score 0..100; ghostScoreThreshold flags. Median-based ratio keeps the
// bar adaptive per vehicle instead of a magic absolute distance.
const (
	ghostScoreThreshold = 60.0
	ghostConfidenceBar  = 70.0
	ghostScanLimit      = 100
)

// GhostDrives scores recent drives for unknown-driver activity, reusing
// the full attribution pipeline (fingerprints + clusters + profiles).
func (s *Service) GhostDrives(ctx context.Context, subject string, vehicleID int64, windowDays int) (*ownershipintel.GhostReport, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	report, err := s.DriverAttribution(ctx, subject, vehicleID, windowDays, ghostScanLimit, 0)
	if err != nil {
		return nil, err
	}
	return &ownershipintel.GhostReport{
		VehicleID: vehicleID,
		Scanned:   len(report.Fingerprints),
		Ghosts:    DetectGhosts(report.Fingerprints),
	}, nil
}

// DetectGhosts flags unattributed drives whose behaviour deviates from
// the norm. Pure: no I/O, deterministic. Score composition:
//
//   - 40 points for being unattributed to any named profile;
//   - up to 40 for distance-to-own-centroid above the fleet median
//     (ratio excess × 20, capped);
//   - up to 20 for attribution confidence below 70.
//
// Attributed drives can never score above 60 without both strong
// distance AND weak confidence, so a named driver's odd trip only flags
// when it genuinely looks like someone else.
func DetectGhosts(fps []ownershipintel.DriveFingerprint) []ownershipintel.GhostDrive {
	median := medianDistance(fps)
	out := []ownershipintel.GhostDrive{}
	for _, fp := range fps {
		score := 0.0
		if fp.DriverProfileID == nil {
			score += 40
		}
		ratio := 1.0
		if median > 0 {
			ratio = fp.DistanceToOwn / median
		}
		if excess := ratio - 1; excess > 0 {
			score += minFloat(excess*20, 40)
		}
		if short := ghostConfidenceBar - fp.ConfidencePct; short > 0 {
			score += minFloat(short*0.5, 20)
		}
		if score < ghostScoreThreshold {
			continue
		}
		out = append(out, ownershipintel.GhostDrive{
			DriveID: fp.DriveID, StartedAt: fp.StartedAt,
			DistanceM: fp.DistanceM, DurationS: fp.DurationS,
			ClusterID: fp.ClusterID, Score: round1(score),
			ConfidencePct: fp.ConfidencePct, DistanceRatio: round2(ratio),
			Reason: ghostReason(fp, ratio),
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	return out
}

func ghostReason(fp ownershipintel.DriveFingerprint, ratio float64) string {
	switch {
	case fp.DriverProfileID == nil && ratio >= 2:
		return fmt.Sprintf("unattributed drive, %.0f%% confidence, %.1f× typical distance", fp.ConfidencePct, ratio)
	case fp.DriverProfileID == nil:
		return fmt.Sprintf("unattributed drive, %.0f%% confidence", fp.ConfidencePct)
	default:
		return fmt.Sprintf("drives unlike its profile (%.1f× typical distance)", ratio)
	}
}

func medianDistance(fps []ownershipintel.DriveFingerprint) float64 {
	if len(fps) == 0 {
		return 0
	}
	ds := make([]float64, 0, len(fps))
	for _, fp := range fps {
		ds = append(ds, fp.DistanceToOwn)
	}
	sort.Float64s(ds)
	mid := len(ds) / 2
	if len(ds)%2 == 1 {
		return ds[mid]
	}
	return (ds[mid-1] + ds[mid]) / 2
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func round1(v float64) float64 { return float64(int(v*10+0.5)) / 10 }

func round2(v float64) float64 { return float64(int(v*100+0.5)) / 100 }
