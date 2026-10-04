package alertmsg

import (
	"strings"
	"testing"
	"time"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

func TestTimestampLocalePresentation(t *testing.T) {
	at := time.Date(2026, 1, 2, 4, 5, 0, 0, time.UTC)
	tests := []struct{ locale, absolute, date, short, clock string }{
		{"en-US", "Jan 2, 2026, 04:05 AM", "Jan 2, 2026", "Jan 2", "04:05 AM"},
		{"en-GB", "2 Jan 2026, 04:05", "2 Jan 2026", "2 Jan", "04:05"},
		{"de-DE", "2. Jan. 2026, 04:05", "2. Jan. 2026", "2. Jan.", "04:05"},
		{"fr-FR", "2 janv. 2026, 04:05", "2 janv. 2026", "2 janv.", "04:05"},
		{"es-ES", "2 ene 2026, 04:05", "2 ene 2026", "2 ene", "04:05"},
		{"ja-JP", "2026年1月2日 04:05", "2026年1月2日", "1月2日", "04:05"},
		{"zh-CN", "2026年1月2日 04:05", "2026年1月2日", "1月2日", "04:05"},
	}
	for _, tc := range tests {
		t.Run(tc.locale, func(t *testing.T) {
			p := PreferencesFromSettings(&systemmodel.Settings{Locale: tc.locale, TimeFormatDefault: "absolute", TzDisplayDefault: "utc"})
			p.ReferenceTime = at
			ctx := BuildContext(&alertmodel.AlertRule{}, "2026-01-02", nil, map[string]any{"PlaceID": "2026-01-02"}, p)
			got := Substitute("{{NowDisplay}}|{{NowAbsolute}}|{{NowDate}}|{{NowDateShort}}|{{NowTime}}|{{NowRFC3339}}|{{VehicleName}}|{{PlaceID}}|{{Unknown}}", ctx)
			want := strings.Join([]string{tc.absolute, tc.absolute, tc.date, tc.short, tc.clock, "2026-01-02T04:05:00Z", "2026-01-02", "2026-01-02", "{{Unknown}}"}, "|")
			if got != want {
				t.Fatalf("got=%q want=%q", got, want)
			}
		})
	}
}

func TestTimestampTimezoneAndDST(t *testing.T) {
	tests := []struct{ instant, mode, user, vehicle, want string }{
		{"2026-03-08T09:59:00Z", "vehicle", "Asia/Kolkata", "America/Los_Angeles", "8. März 2026, 01:59|2026-03-08T01:59:00-08:00"},
		{"2026-03-08T10:01:00Z", "vehicle", "Asia/Kolkata", "America/Los_Angeles", "8. März 2026, 03:01|2026-03-08T03:01:00-07:00"},
		{"2026-11-01T08:30:00Z", "vehicle", "", "America/Los_Angeles", "1. Nov. 2026, 01:30|2026-11-01T01:30:00-07:00"},
		{"2026-11-01T09:30:00Z", "vehicle", "", "America/Los_Angeles", "1. Nov. 2026, 01:30|2026-11-01T01:30:00-08:00"},
		{"2026-01-02T23:30:00Z", "user", "Asia/Kolkata", "America/Los_Angeles", "3. Jan. 2026, 05:00|2026-01-03T05:00:00+05:30"},
		{"2026-01-02T23:30:00Z", "utc", "Asia/Kolkata", "America/Los_Angeles", "2. Jan. 2026, 23:30|2026-01-02T23:30:00Z"},
		{"2026-01-02T23:30:00Z", "vehicle", "Asia/Kolkata", "UTC", "3. Jan. 2026, 05:00|2026-01-03T05:00:00+05:30"},
		{"2026-01-02T23:30:00Z", "user", "", "", "2. Jan. 2026, 23:30|2026-01-02T23:30:00Z"},
	}
	for _, tc := range tests {
		t.Run(tc.instant+tc.mode+tc.vehicle, func(t *testing.T) {
			at, err := time.Parse(time.RFC3339, tc.instant)
			if err != nil {
				t.Fatal(err)
			}
			p := PreferencesFromSettings(&systemmodel.Settings{Locale: "de-DE", TimeFormatDefault: "absolute", TzDisplayDefault: tc.mode, TimezoneUser: tc.user}).WithVehicleTimezone(tc.vehicle)
			p.ReferenceTime = at
			ctx := BuildContext(nil, "", nil, nil, p)
			if got := Substitute("{{NowDisplay}}|{{Now}}", ctx); got != tc.want {
				t.Fatalf("got=%q want=%q", got, tc.want)
			}
			if raw := Substitute("{{NowRFC3339}}", ctx); raw != tc.instant {
				t.Fatal(raw)
			}
		})
	}
}

func TestTimestampRelativeAndPreferenceChanges(t *testing.T) {
	now := time.Date(2026, 4, 4, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		locale string
		ago    time.Duration
		want   string
	}{
		{"en-US", 10 * time.Second, "just now"},
		{"en-US", 2 * time.Minute, "2m ago"},
		{"de-DE", 2 * time.Hour, "vor 2 Std."},
		{"de-DE", 24 * time.Hour, "vor 1 Tag"},
		{"de-DE", -24 * time.Hour, "in 1 Tag"},
		{"fr-FR", 2 * time.Minute, "-2 min"},
		{"es-ES", 2 * 24 * time.Hour, "hace 2 d"},
		{"ja-JP", -2 * time.Minute, "2分後"},
		{"zh-CN", 2 * time.Hour, "2小时前"},
		{"en-GB", 8 * 24 * time.Hour, "27 Mar 2026"},
	}
	for _, tc := range tests {
		p := PreferencesFromSettings(&systemmodel.Settings{Locale: tc.locale, TzDisplayDefault: "utc", TimeFormatDefault: "relative"})
		p.ReferenceTime = now
		ctx := BuildContext(nil, "", nil, map[string]any{"Now": now.Add(-tc.ago)}, p)
		if got := Substitute("{{NowDisplay}}", ctx); got != tc.want {
			t.Fatalf("locale=%s got=%q want=%q", tc.locale, got, tc.want)
		}
	}
	settings := &systemmodel.Settings{Locale: "de-DE", TzDisplayDefault: "utc", TimeFormatDefault: "relative"}
	p := PreferencesFromSettings(settings)
	p.ReferenceTime = now
	ctx := BuildContext(nil, "", nil, nil, p)
	if got := Substitute("{{NowDisplay}}", ctx); got != "jetzt" {
		t.Fatal(got)
	}
	settings.TimeFormatDefault, settings.TzDisplayDefault, settings.TimezoneUser = "absolute", "user", "Asia/Kolkata"
	p = PreferencesFromSettings(settings)
	p.ReferenceTime = now
	ctx = BuildContext(nil, "", nil, nil, p)
	if got := Substitute("{{NowDisplay}}", ctx); got != "4. Apr. 2026, 17:30" {
		t.Fatal(got)
	}
	for _, invalid := range []any{"not a timestamp", "", nil, time.Time{}, 42} {
		ctx = BuildContext(nil, "", nil, map[string]any{"Now": invalid}, p)
		if got := Substitute("{{NowDisplay}}|{{NowDate}}|{{NowRFC3339}}", ctx); got != "—|—|—" {
			t.Fatal(got)
		}
	}
}
