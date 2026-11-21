package smartmediasvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
)

func TestFavoriteCandidatesRequireDistinctQualifiedDrivesAndDates(t *testing.T) {
	start := time.Date(2026, 11, 16, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 0, 7)
	qualified := func(at time.Time, source string) []domain.PlaybackSample {
		return []domain.PlaybackSample{
			{At: at, Attested: true, Source: ptr(source), Status: ptr("Playing"), Title: ptr("Synthetic track"),
				Artist: ptr("Synthetic artist"), DurationS: ptr(190.0), ElapsedS: ptr(0.0)},
			{At: at.Add(15 * time.Second), Attested: true, ElapsedS: ptr(15.0)},
			{At: at.Add(30 * time.Second), Attested: true, ElapsedS: ptr(30.0)},
			{At: at.Add(45 * time.Second), Attested: true, ElapsedS: ptr(45.0)},
		}
	}
	drives := make([]domain.DriveWindow, 3)
	var samples []domain.PlaybackSample
	for i, offset := range []time.Duration{8 * time.Hour, 9 * time.Hour, 32 * time.Hour} {
		at := start.Add(offset)
		drives[i] = domain.DriveWindow{ID: int64(i + 1), StartedAt: at, EndedAt: at.Add(time.Minute)}
		samples = append(samples, qualified(at, "Spotify")...)
	}
	if got := FavoriteCandidates(drives, samples, start, end, time.UTC); len(got) != 1 ||
		got[0].ObservedDrives != 3 || got[0].ObservedDates != 2 || got[0].Title != "Synthetic track" {
		t.Fatalf("want one repeated recording, counted once per drive: %+v", got)
	}
	for _, variant := range []struct {
		name string
		edit func([]domain.DriveWindow, []domain.PlaybackSample)
	}{
		{"park or ended drive without playback", func(_ []domain.DriveWindow, s []domain.PlaybackSample) {
			copy(s[8:], qualified(drives[2].EndedAt, "Spotify"))
		}},
		{"radio", func(_ []domain.DriveWindow, s []domain.PlaybackSample) { s[8].Source = ptr("FM") }},
		{"unchanged ticks", func(_ []domain.DriveWindow, s []domain.PlaybackSample) {
			s[9].ElapsedS, s[10].ElapsedS, s[11].ElapsedS = ptr(0.0), ptr(0.0), ptr(0.0)
		}},
		{"ambiguous duration match", func(_ []domain.DriveWindow, s []domain.PlaybackSample) { s[8].DurationS = ptr(199.0) }},
		{"duplicate drive", func(d []domain.DriveWindow, _ []domain.PlaybackSample) { d[2].ID = d[1].ID }},
		{"all on the same local date", func(d []domain.DriveWindow, s []domain.PlaybackSample) {
			d[2].StartedAt, d[2].EndedAt = d[2].StartedAt.Add(-12*time.Hour), d[2].EndedAt.Add(-12*time.Hour)
			for i := 8; i < len(s); i++ {
				s[i].At = s[i].At.Add(-12 * time.Hour)
			}
		}},
	} {
		t.Run(variant.name, func(t *testing.T) {
			d, s := append([]domain.DriveWindow(nil), drives...), append([]domain.PlaybackSample(nil), samples...)
			variant.edit(d, s)
			if got := FavoriteCandidates(d, s, start, end, time.UTC); len(got) != 0 {
				t.Fatalf("unqualified evidence suggested a favorite: %+v", got)
			}
		})
	}
}

func TestFavoriteWeekUsesLocalReleaseAndDST(t *testing.T) {
	zone, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		month time.Month
		day   int
		hours int
	}{
		{time.March, 9, 167},
		{time.November, 2, 169},
	} {
		release := time.Date(2026, tt.month, tt.day, 9, 0, 0, 0, zone)
		_, _, scheduled := favoriteWeek(release.Add(-time.Second), zone)
		from, until, next := favoriteWeek(release, zone)
		if !scheduled.Equal(release) || until.Sub(from) != time.Duration(tt.hours)*time.Hour ||
			next.In(zone).Hour() != 9 || next.In(zone).Weekday() != time.Monday {
			t.Fatalf("incorrect local week: %s to %s, scheduled %s, next %s", from, until, scheduled, next)
		}
	}
}
