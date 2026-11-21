package smartmediasvc

import (
	"math"
	"strings"
	"time"
	"unicode/utf8"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

const (
	playbackProgressHorizon = 90 * time.Second
	playbackContextHorizon  = 2 * time.Hour
	favoriteMetadataSpan    = 20 * time.Second
	maximumMediaDurationS   = 4 * 3600
)

type pendingTrack struct {
	track      domain.TrackPlay
	duration   *float64
	lastAt     time.Time
	position   float64
	playedSlot int
}

func ObservedPlays(samples []domain.PlaybackSample, from, to time.Time) []domain.TrackPlay {
	return observedPlays(samples, from, to, false, nil)
}

func observedPlays(samples []domain.PlaybackSample, from, to time.Time, allowFavoriteContext bool,
	progress func(track domain.TrackPlay, before, after time.Time, advanced float64)) []domain.TrackPlay {
	out := make([]domain.TrackPlay, 0)
	var pending *pendingTrack
	var metadata domain.PlaybackSample
	var source string
	var sourceAt, playingAt time.Time
	for _, sample := range samples {
		if sample.At.After(to) {
			break
		}
		if !sample.Attested {
			pending, source, sourceAt, playingAt = nil, "", time.Time{}, time.Time{}
			metadata = domain.PlaybackSample{}
			continue
		}
		if sample.Source != nil {
			next := mediaSource(*sample.Source)
			if next != source {
				pending, playingAt = nil, time.Time{}
				metadata = domain.PlaybackSample{}
			}
			source, sourceAt = next, sample.At
		}
		if sample.Status != nil {
			status, err := protomodel.ParseMediaStatus(*sample.Status)
			if err != nil || status != protomodel.MediaStatus_MediaStatusPlaying {
				playingAt, pending = time.Time{}, nil
				metadata = domain.PlaybackSample{}
			} else {
				playingAt = sample.At
			}
		}
		if allowFavoriteContext {
			if foldFavoriteMetadata(&metadata, sample) {
				identity := metadata
				identity.At = sample.At
				pending = newTrack(identity, source, sourceAt)
			}
		} else if sample.Title != nil || sample.Artist != nil {
			pending = newTrack(sample, source, sourceAt)
		} else if pending != nil && sample.DurationS != nil && (pending.duration == nil || *sample.DurationS != *pending.duration) {
			pending = nil
		}
		if pending == nil || sample.ElapsedS == nil || playingAt.IsZero() || sample.At.Sub(playingAt) > playbackContextHorizon {
			continue
		}
		if allowFavoriteContext {
			if sample.At.Sub(sourceAt) > domain.FavoriteContextHorizon || sample.At.Sub(metadata.At) > domain.FavoriteContextHorizon {
				continue
			}
		} else if pending.track.IdentityAt.Before(from) {
			continue
		}
		if !validMediaTime(*sample.ElapsedS) || (pending.track.DurationS != nil && *sample.ElapsedS > float64(*pending.track.DurationS)) {
			pending = nil
			metadata = domain.PlaybackSample{}
			continue
		}
		if pending.lastAt.IsZero() {
			pending.lastAt, pending.position = sample.At, *sample.ElapsedS
			continue
		}
		gap, advanced := sample.At.Sub(pending.lastAt), *sample.ElapsedS-pending.position
		if gap <= 0 || gap > playbackProgressHorizon || advanced < 0 || advanced > gap.Seconds()+2 {
			pending = nil
			metadata = domain.PlaybackSample{}
			continue
		}
		if allowFavoriteContext && pending.lastAt.Before(from) {
			pending.lastAt, pending.position = sample.At, *sample.ElapsedS
			continue
		}
		if advanced < 1 {
			if progress != nil {
				pending.lastAt, pending.position = sample.At, *sample.ElapsedS
			}
			continue
		}
		if pending.playedSlot < 0 {
			pending.playedSlot = len(out)
			pending.track.ObservedFrom = pending.lastAt
			out = append(out, pending.track)
		}
		before := pending.lastAt
		pending.lastAt, pending.position = sample.At, *sample.ElapsedS
		out[pending.playedSlot].LastObservedAt, out[pending.playedSlot].LastElapsedS = sample.At, pending.position
		if progress != nil {
			track := out[pending.playedSlot]
			track.ObservedFrom = before
			progress(track, before, sample.At, advanced)
		}
	}
	return out
}

func foldFavoriteMetadata(metadata *domain.PlaybackSample, sample domain.PlaybackSample) bool {
	if sample.Title == nil && sample.Artist == nil && sample.DurationS == nil {
		return false
	}
	missing := addsTrackField(metadata.Title, sample.Title) || addsTrackField(metadata.Artist, sample.Artist) ||
		addsTrackField(metadata.DurationS, sample.DurationS)
	// A partial update may complete a nearby identity, but never borrow fields from a different recording.
	if (sample.Title != nil && sample.Artist != nil && sample.DurationS != nil) ||
		metadata.At.IsZero() || sample.At.Sub(metadata.At) > domain.FavoriteContextHorizon ||
		(missing && sample.At.Sub(metadata.At) > favoriteMetadataSpan) ||
		differsTrackField(metadata.Title, sample.Title) || differsTrackField(metadata.Artist, sample.Artist) ||
		differsTrackField(metadata.DurationS, sample.DurationS) {
		*metadata = domain.PlaybackSample{At: sample.At, Title: sample.Title, Artist: sample.Artist, DurationS: sample.DurationS}
		return true
	}
	if sample.Title != nil {
		metadata.Title = sample.Title
	}
	if sample.Artist != nil {
		metadata.Artist = sample.Artist
	}
	if sample.DurationS != nil {
		metadata.DurationS = sample.DurationS
	}
	return missing
}

func addsTrackField[T any](previous, next *T) bool { return previous == nil && next != nil }

func differsTrackField[T comparable](previous, next *T) bool {
	return previous != nil && next != nil && *previous != *next
}

func newTrack(sample domain.PlaybackSample, source string, sourceAt time.Time) *pendingTrack {
	if sample.Title == nil || sample.Artist == nil || source == "" || sample.At.Sub(sourceAt) > playbackContextHorizon {
		return nil
	}
	title, artist := strings.TrimSpace(*sample.Title), strings.TrimSpace(*sample.Artist)
	if !validMediaLabel(title) || !validMediaLabel(artist) {
		return nil
	}
	result := &pendingTrack{track: domain.TrackPlay{Title: title, Artist: artist, Source: source, IdentityAt: sample.At}, playedSlot: -1}
	if sample.DurationS != nil && *sample.DurationS >= 10 && validMediaTime(*sample.DurationS) {
		result.duration = sample.DurationS
		duration := int(math.Ceil(*sample.DurationS))
		result.track.DurationS = &duration
	}
	return result
}

func validMediaLabel(text string) bool {
	return text != "" && utf8.ValidString(text) && utf8.RuneCountInString(text) <= 256 &&
		!strings.ContainsAny(text, "\r\n\t\x00")
}

func validMediaTime(seconds float64) bool {
	return seconds >= 0 && seconds <= maximumMediaDurationS
}

func mediaSource(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "spotify":
		return "spotify"
	case "youtube music", "youtubemusic":
		return "youtube_music"
	case "apple music", "applemusic":
		return "apple_music"
	case "tidal", "bluetooth", "usb":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}
