package smartmediasvc

import (
	"crypto/sha256"
	"encoding/hex"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
)

const (
	maxFavoriteDrives = 100
	maxFavoriteTracks = 5
)

func favoriteWeek(now time.Time, loc *time.Location) (from, to, next time.Time) {
	local := now.In(loc)
	offset := (int(local.Weekday()) + 6) % 7
	release := time.Date(local.Year(), local.Month(), local.Day()-offset, 9, 0, 0, 0, loc)
	if local.Before(release) {
		release = release.AddDate(0, 0, -7)
	}
	to = time.Date(release.Year(), release.Month(), release.Day(), 0, 0, 0, 0, loc)
	return to.AddDate(0, 0, -7).UTC(), to.UTC(), release.AddDate(0, 0, 7).UTC()
}

func favoriteRecording(play domain.TrackPlay) domain.FavoriteRecording {
	seconds := *play.DurationS
	identity := strings.Join([]string{strings.ToLower(play.Title), strings.ToLower(play.Artist), play.Source, strconv.Itoa(seconds)}, "\x00")
	digest := sha256.Sum256([]byte(identity))
	return domain.FavoriteRecording{Key: hex.EncodeToString(digest[:]), Title: play.Title, Artist: play.Artist,
		Source: play.Source, DurationS: seconds}
}

func FavoriteCandidates(drives []domain.DriveWindow, samples []domain.PlaybackSample, from, until time.Time,
	loc *time.Location) []domain.FavoriteCandidate {
	if len(drives) < 3 || len(drives) > maxFavoriteDrives || loc == nil || !until.After(from) {
		return nil
	}
	type evidence struct {
		candidate domain.FavoriteCandidate
		dates     map[string]struct{}
		lastDrive int64
	}
	byRecording := make(map[string]*evidence)
	seen := make(map[int64]struct{}, len(drives))
	previousEnd := from
	for _, drive := range drives {
		if drive.ID <= 0 || drive.StartedAt.Before(previousEnd) || !drive.EndedAt.After(drive.StartedAt) || drive.EndedAt.After(until) {
			return nil
		}
		if _, duplicate := seen[drive.ID]; duplicate {
			return nil
		}
		seen[drive.ID], previousEnd = struct{}{}, drive.EndedAt
		contextFrom := drive.StartedAt.Add(-domain.FavoriteContextHorizon)
		low := sort.Search(len(samples), func(i int) bool { return !samples[i].At.Before(contextFrom) })
		high := sort.Search(len(samples), func(i int) bool { return !samples[i].At.Before(drive.EndedAt) })
		day := drive.StartedAt.In(loc).Format(time.DateOnly)
		observedPlays(samples[low:high], drive.StartedAt, drive.EndedAt, true,
			func(play domain.TrackPlay, before, after time.Time, advanced float64) {
				gap := after.Sub(before).Seconds()
				if play.DurationS == nil || *play.DurationS < 30 || *play.DurationS > 1800 ||
					advanced < 15 || gap > 30 || math.Abs(gap-advanced) > 3 {
					return
				}
				recording := favoriteRecording(play)
				item := byRecording[recording.Key]
				if item == nil {
					item = &evidence{candidate: domain.FavoriteCandidate{FavoriteRecording: recording},
						dates: make(map[string]struct{})}
					byRecording[recording.Key] = item
				}
				if item.lastDrive != drive.ID {
					item.lastDrive = drive.ID
					item.candidate.ObservedDrives++
					item.dates[day] = struct{}{}
				}
			})
	}
	candidates := make([]domain.FavoriteCandidate, 0, min(len(byRecording), maxFavoriteTracks))
	for _, item := range byRecording {
		item.candidate.ObservedDates = len(item.dates)
		if item.candidate.ObservedDrives >= 3 && item.candidate.ObservedDates >= 2 {
			candidates = append(candidates, item.candidate)
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		if a.ObservedDrives != b.ObservedDrives {
			return a.ObservedDrives > b.ObservedDrives
		}
		if a.ObservedDates != b.ObservedDates {
			return a.ObservedDates > b.ObservedDates
		}
		return a.Key < b.Key
	})
	return candidates[:min(len(candidates), maxFavoriteTracks)]
}
