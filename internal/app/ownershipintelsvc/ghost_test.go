package ownershipintelsvc

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
)

func ghostFP(driveID int64, profileID *int64, confidence, distOwn float64) ownershipintel.DriveFingerprint {
	return ownershipintel.DriveFingerprint{
		DriveID:         driveID,
		StartedAt:       time.Date(2026, 5, 1, 8, 0, 0, 0, time.UTC),
		DistanceM:       12000,
		DurationS:       1200,
		ClusterID:       0,
		DriverProfileID: profileID,
		ConfidencePct:   confidence,
		DistanceToOwn:   distOwn,
	}
}

func TestDetectGhosts(t *testing.T) {
	owner := int64(1)
	normal := []ownershipintel.DriveFingerprint{
		ghostFP(1, &owner, 92, 0.5),
		ghostFP(2, &owner, 88, 0.6),
		ghostFP(3, &owner, 90, 0.55),
		ghostFP(4, &owner, 85, 0.7),
	}

	t.Run("unattributed far drive flags", func(t *testing.T) {
		fps := append(append([]ownershipintel.DriveFingerprint{}, normal...),
			ghostFP(9, nil, 55, 2.5))
		got := DetectGhosts(fps)
		if len(got) != 1 || got[0].DriveID != 9 {
			t.Fatalf("ghosts = %+v, want drive 9", got)
		}
		if got[0].Score < 60 {
			t.Fatalf("score = %v, want >= 60", got[0].Score)
		}
	})

	t.Run("attributed normal drives stay quiet", func(t *testing.T) {
		if got := DetectGhosts(normal); len(got) != 0 {
			t.Fatalf("ghosts = %+v, want none", got)
		}
	})

	t.Run("attributed odd trip flags only when extreme", func(t *testing.T) {
		fps := append(append([]ownershipintel.DriveFingerprint{}, normal...),
			ghostFP(9, &owner, 30, 3.0))
		got := DetectGhosts(fps)
		if len(got) != 1 {
			t.Fatalf("ghosts = %+v, want the extreme trip", got)
		}
	})

	t.Run("attributed mild outlier stays quiet", func(t *testing.T) {
		fps := append(append([]ownershipintel.DriveFingerprint{}, normal...),
			ghostFP(9, &owner, 75, 0.9))
		if got := DetectGhosts(fps); len(got) != 0 {
			t.Fatalf("ghosts = %+v, want none", got)
		}
	})

	t.Run("empty input yields empty output", func(t *testing.T) {
		if got := DetectGhosts(nil); len(got) != 0 {
			t.Fatalf("ghosts = %+v, want none", got)
		}
	})

	t.Run("results sort by score descending", func(t *testing.T) {
		fps := append(append([]ownershipintel.DriveFingerprint{}, normal...),
			ghostFP(9, nil, 60, 1.8),
			ghostFP(10, nil, 40, 3.0),
		)
		got := DetectGhosts(fps)
		if len(got) != 2 || got[0].DriveID != 10 {
			t.Fatalf("ghosts = %+v, want 10 first", got)
		}
	})
}

func TestGhostDrivesRejectsBadVehicle(t *testing.T) {
	s := &Service{}
	_, err := s.GhostDrives(context.Background(), "tester", 0, 30)
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("err = %v, want ErrInvalidInput", err)
	}
}

func TestMedianDistance(t *testing.T) {
	if got := medianDistance(nil); got != 0 {
		t.Fatalf("empty median = %v, want 0", got)
	}
	owner := int64(1)
	fps := []ownershipintel.DriveFingerprint{
		ghostFP(1, &owner, 90, 3),
		ghostFP(2, &owner, 90, 1),
		ghostFP(3, &owner, 90, 2),
	}
	if got := medianDistance(fps); got != 2 {
		t.Fatalf("median = %v, want 2", got)
	}
}
