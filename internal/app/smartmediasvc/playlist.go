package smartmediasvc

import (
	"slices"
	"strings"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
)

const (
	minPlaylistTargetS = 5 * 60
	maxPlaylistTargetS = 6 * 3600
	maxPlaylistPool    = 100
)

func SuggestSpotifyPlaylist(plays []domain.TrackPlay, targetS int) *domain.PlaylistSuggestion {
	if targetS < minPlaylistTargetS || targetS > maxPlaylistTargetS {
		return nil
	}
	tolerance := max(120, targetS/10)
	limit := targetS + tolerance
	tracks := make([]domain.TrackPlay, 0, min(len(plays), maxPlaylistPool))
	type identity struct{ title, artist string }
	seen := make(map[identity]struct{})
	for _, play := range slices.Backward(plays) {
		if play.Source != "spotify" || play.DurationS == nil || *play.DurationS < 10 || *play.DurationS > limit ||
			play.LastObservedAt.IsZero() || !play.LastObservedAt.After(play.ObservedFrom) {
			continue
		}
		key := identity{strings.ToLower(play.Title), strings.ToLower(play.Artist)}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		tracks = append(tracks, play)
		if len(tracks) == maxPlaylistPool {
			break
		}
	}
	if len(tracks) == 0 {
		return nil
	}

	// Bounded subset sum; a descending pass keeps each observed recording eligible only once.
	type predecessor struct{ total, track int }
	from := make([]predecessor, limit+1)
	for i := range from {
		from[i].track = -1
	}
	best := 0
	for index, play := range tracks {
		d := *play.DurationS
		for total := limit; total >= d; total-- {
			if from[total].track >= 0 || (total > d && from[total-d].track < 0) {
				continue
			}
			from[total] = predecessor{total - d, index}
			delta, bestDelta := distance(total, targetS), distance(best, targetS)
			if delta < bestDelta || (delta == bestDelta && total <= targetS && best > targetS) {
				best = total
			}
		}
		if best == targetS {
			break
		}
	}
	if best == 0 || distance(best, targetS) > tolerance {
		return nil
	}
	result := &domain.PlaylistSuggestion{TargetDurationS: targetS, TotalDurationS: best, Tracks: make([]domain.TrackPlay, 0)}
	for total := best; total > 0; total = from[total].total {
		result.Tracks = append(result.Tracks, tracks[from[total].track])
	}
	slices.Reverse(result.Tracks)
	for _, candidate := range tracks {
		if !slices.ContainsFunc(result.Tracks, func(chosen domain.TrackPlay) bool {
			return candidate.Title == chosen.Title && candidate.Artist == chosen.Artist
		}) {
			result.Alternatives = append(result.Alternatives, candidate)
		}
	}
	return result
}

func distance(a, b int) int { return max(a-b, b-a) }
