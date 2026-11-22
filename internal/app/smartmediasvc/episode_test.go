package smartmediasvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
)

func TestEpisodeFitRequiresExplicitCurrentProgressAndAnUpcomingDrive(t *testing.T) {
	now := time.Date(2026, 11, 20, 17, 15, 0, 0, time.UTC)
	departure := now.Add(30 * time.Minute)
	episode := &domain.EpisodeProgress{Title: "Synthetic episode", DurationS: 1500, PositionS: ptr(600), Completed: ptr(false)}
	if got := EvaluateEpisodeFit(now, departure, 900, true, episode); got.Reason != "fits" || got.RemainingS == nil || *got.RemainingS != 900 {
		t.Fatalf("want 900 known seconds remaining for the exact fit: %+v", got)
	}
	if got := EvaluateEpisodeFit(now, departure, 899, true, episode); got.Reason != "not_fit" {
		t.Fatalf("must not round an episode into a short drive: %+v", got)
	}
	if got := EvaluateEpisodeFit(now, now, 900, true, episode); got.Reason != "drive_unmatched" || got.RemainingS != nil {
		t.Fatalf("must not recommend after departure: %+v", got)
	}
	if got := EvaluateEpisodeFit(now, departure, 900, false, episode); got.Reason != "off" || got.RemainingS != nil {
		t.Fatalf("disabled review must not expose progress: %+v", got)
	}
	episode.PositionS = nil
	if got := EvaluateEpisodeFit(now, departure, 1800, true, episode); got.Reason != "unknown_progress" || got.RemainingS != nil {
		t.Fatalf("unknown progress must not become an unplayed episode: %+v", got)
	}
	episode.PositionS = ptr(0)
	if got := EvaluateEpisodeFit(now, departure, 1800, true, episode); got.Reason != "fits" || got.RemainingS == nil || *got.RemainingS != 1500 {
		t.Fatalf("an explicitly known zero remains valid progress: %+v", got)
	}
	episode.Completed = ptr(true)
	if got := EvaluateEpisodeFit(now, departure, 1800, true, episode); got.Reason != "completed" || got.RemainingS != nil {
		t.Fatalf("do not suggest a completed episode even when the provider retains its prior position: %+v", got)
	}
}
