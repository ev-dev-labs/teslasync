package smartmediasvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
)

func ptr[T any](v T) *T { return &v }

func TestObservedPlaysRequireExactIdentityAndRealProgress(t *testing.T) {
	at := time.Date(2026, 11, 20, 17, 0, 0, 0, time.UTC)
	samples := []domain.PlaybackSample{
		{At: at, Attested: true, Source: ptr("Spotify"), Status: ptr("Playing"), Title: ptr("Synthetic opening"), Artist: ptr("Example Ensemble"), DurationS: ptr(181.3), ElapsedS: ptr(0.0)},
		{At: at.Add(15 * time.Second), Attested: true, ElapsedS: ptr(14.0)},
		{At: at.Add(25 * time.Second), Attested: true, ElapsedS: ptr(24.0)},
		{At: at.Add(30 * time.Second), Attested: true, Status: ptr("Paused")},
		{At: at.Add(35 * time.Second), Attested: true, Title: ptr("Synthetic second"), Artist: ptr("Another Ensemble"), DurationS: ptr(190.0), ElapsedS: ptr(0.0)},
		{At: at.Add(50 * time.Second), Attested: true, ElapsedS: ptr(15.0)},
	}

	got := ObservedPlays(samples, at, at.Add(time.Minute))
	if len(got) != 1 || got[0].Title != "Synthetic opening" || got[0].DurationS == nil || *got[0].DurationS != 182 ||
		got[0].LastElapsedS != 24 || !got[0].LastObservedAt.Equal(samples[2].At) {
		t.Fatalf("want one actual played identity, not ticks or paused preview, got %+v", got)
	}
	for _, tt := range []struct {
		name string
		edit func([]domain.PlaybackSample)
	}{
		{"unattested identity", func(v []domain.PlaybackSample) { v[0].Attested = false }},
		{"artist absent", func(v []domain.PlaybackSample) { v[0].Artist = nil }},
		{"radio", func(v []domain.PlaybackSample) { v[0].Source = ptr("FM") }},
		{"seek", func(v []domain.PlaybackSample) { v[1].ElapsedS = ptr(130.0) }},
		{"source changed", func(v []domain.PlaybackSample) { v[1].Source = ptr("USB") }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			changed := append([]domain.PlaybackSample(nil), samples...)
			tt.edit(changed)
			if got := ObservedPlays(changed, at, at.Add(time.Minute)); len(got) != 0 {
				t.Fatalf("uncertain evidence counted as listening: %+v", got)
			}
		})
	}
}

func TestFavoritePlaybackDoesNotCarryOldArtistOrDurationIntoAChangedTitle(t *testing.T) {
	at := time.Date(2026, 11, 20, 17, 0, 0, 0, time.UTC)
	samples := []domain.PlaybackSample{
		{At: at, Attested: true, Source: ptr("Spotify"), Status: ptr("Playing"), Title: ptr("Synthetic opening"),
			Artist: ptr("Example Ensemble"), DurationS: ptr(181.3)},
		{At: at.Add(time.Second), Attested: true, Title: ptr("Unidentified second")},
		{At: at.Add(15 * time.Second), Attested: true, ElapsedS: ptr(14.0)},
		{At: at.Add(35 * time.Second), Attested: true, ElapsedS: ptr(34.0)},
	}
	if got := observedPlays(samples, at, at.Add(time.Minute), true, nil); len(got) != 0 {
		t.Fatalf("a new title inherited another recording's artist or duration: %+v", got)
	}
}

func TestSpotifySuggestionFitsTargetUsingDistinctObservedTracks(t *testing.T) {
	at := time.Date(2026, 11, 20, 17, 0, 0, 0, time.UTC)
	makePlay := func(title, source string, seconds int) domain.TrackPlay {
		return domain.TrackPlay{Title: title, Artist: "Example Ensemble", Source: source, DurationS: &seconds,
			ObservedFrom: at, LastObservedAt: at.Add(30 * time.Second)}
	}

	plays := []domain.TrackPlay{
		makePlay("Old exact", "spotify", 600),
		makePlay("Opening", "spotify", 280),
		makePlay("Closing", "spotify", 320),
		makePlay("Opening", "spotify", 280),
		makePlay("Not Spotify", "apple_music", 600),
	}
	got := SuggestSpotifyPlaylist(plays, 600)
	if got == nil || len(got.Tracks) != 2 || got.TotalDurationS != 600 {
		t.Fatalf("want two newer, distinct evidenced tracks fitting the planned drive: %+v", got)
	}
	if got := SuggestSpotifyPlaylist([]domain.TrackPlay{plays[1], plays[3], plays[4]}, 600); got != nil {
		t.Fatalf("must not fill a large gap with repeats or another provider: %+v", got)
	}
}

func TestTrackAtRequiresTwoNearbyObservationsAroundTheSelectedTime(t *testing.T) {
	start := time.Date(2026, 11, 20, 17, 0, 0, 0, time.UTC)
	end := start.Add(time.Minute)
	at := start.Add(15 * time.Second)
	samples := []domain.PlaybackSample{
		{At: start.Add(10 * time.Second), Attested: true, Source: ptr("Spotify"), Status: ptr("Playing"), Title: ptr("Synthetic track"), Artist: ptr("Synthetic artist"), ElapsedS: ptr(42.0)},
		{At: start.Add(20 * time.Second), Attested: true, ElapsedS: ptr(52.0)},
		{At: start.Add(55 * time.Second), Attested: true, ElapsedS: ptr(86.0)},
	}
	if got := TrackAt(samples, start, end, at); got == nil || got.Title != "Synthetic track" || got.DurationS != nil ||
		got.ObservedFrom != samples[0].At || got.LastObservedAt != samples[1].At {
		t.Fatalf("want exactly the known track and its bracketing observations: %+v", got)
	}
	for _, instant := range []time.Time{start.Add(-time.Second), start, start.Add(30 * time.Second), start.Add(58 * time.Second), end} {
		if got := TrackAt(samples, start, end, instant); got != nil {
			t.Fatalf("did not suppress unbracketed or out-of-drive time %s: %+v", instant, got)
		}
	}
	stalled := append([]domain.PlaybackSample{samples[0],
		{At: start.Add(19 * time.Second), Attested: true, ElapsedS: ptr(42.0)}}, samples[1:]...)
	if got := TrackAt(stalled, start, end, at); got != nil {
		t.Fatalf("must not bridge a frozen position followed by a jump: %+v", got)
	}
	samples[1].ElapsedS = ptr(43.0)
	if got := TrackAt(samples, start, end, at); got != nil {
		t.Fatalf("one second of progress does not establish playback through the selected time: %+v", got)
	}
}
