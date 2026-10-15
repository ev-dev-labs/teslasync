package alertmsg

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	core "github.com/ev-dev-labs/teslasync/internal/alertmsg"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

type dateSettings struct{ value *systemmodel.Settings }

func (s dateSettings) Get(context.Context) (*systemmodel.Settings, error) { return s.value, nil }

func TestTimestampPlaceholderPreferencesAndVehicleContext(t *testing.T) {
	settings := &systemmodel.Settings{Locale: "de-DE", TimeFormatDefault: "absolute", TzDisplayDefault: "vehicle", TimezoneUser: "Asia/Kolkata"}
	h := NewAlertMessageHandler(dateSettings{settings}).WithClock(func() time.Time { return time.Date(2026, 3, 8, 10, 1, 0, 0, time.UTC) })
	for _, tc := range []struct{ mode, format, want string }{
		{"vehicle", "absolute", "8. März 2026, 03:01"},
		{"user", "absolute", "8. März 2026, 15:31"},
		{"utc", "absolute", "8. März 2026, 10:01"},
		{"vehicle", "relative", "jetzt"},
	} {
		settings.TzDisplayDefault, settings.TimeFormatDefault = tc.mode, tc.format
		rr := httptest.NewRecorder()
		h.MessagePlaceholders(rr, httptest.NewRequest(http.MethodGet, "/alerts/message-placeholders?kind=place&vehicle_timezone=America%2FLos_Angeles", nil))
		var placeholders []core.Placeholder
		if err := json.Unmarshal(rr.Body.Bytes(), &placeholders); err != nil {
			t.Fatal(err)
		}
		examples := map[string]string{}
		for _, p := range placeholders {
			examples[p.Key] = p.Example
		}
		if examples["NowDisplay"] != tc.want || examples["NowRFC3339"] != "2026-03-08T10:01:00Z" {
			t.Fatalf("%s %s: %+v", tc.mode, tc.format, examples)
		}
	}
}
