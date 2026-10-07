package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	apialertmsg "github.com/ev-dev-labs/teslasync/internal/api/alertmsg"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
)

type eventDateSettings struct{ value *systemmodel.Settings }

func (s eventDateSettings) Get(context.Context) (*systemmodel.Settings, error) { return s.value, nil }

type eventDateVehicle struct {
	calls int
	err   error
}

func (v *eventDateVehicle) GetByID(_ context.Context, id int64) (*vehiclemodel.Vehicle, error) {
	v.calls++
	if id != 42 {
		return nil, errors.New("unexpected vehicle")
	}
	return &vehiclemodel.Vehicle{ID: id, Timezone: "America/Los_Angeles"}, v.err
}

func TestEventAlertTimestampPreviewDispatchParity(t *testing.T) {
	at := time.Date(2026, 11, 1, 9, 30, 0, 0, time.UTC)
	settings := &systemmodel.Settings{Locale: "de-DE", TimeFormatDefault: "absolute", TzDisplayDefault: "vehicle", TimezoneUser: "Asia/Kolkata"}
	vehicle, placeID, transition := &eventDateVehicle{}, int64(71), "enter"
	template := "{{NowDisplay}}|{{NowDateShort}}|{{NowTime}}|{{NowRFC3339}}|{{PlaceID}}|{{Unknown}}"
	rule := &alertmodel.AlertRule{ID: 1, Name: "Arrived", Enabled: true, AllVehicles: true, Kind: alertmodel.AlertRuleKindPlace, PlaceID: &placeID, Transition: &transition, MsgTemplate: &template, IncludeTitle: false}
	var delivered componentTransitionEvent
	observer := &eventAlertObserver{
		rules:    &eventRulesFake{rules: []*alertmodel.AlertRule{rule}},
		claims:   &eventClaimsFake{claimed: true},
		settings: eventDateSettings{settings}, vehicles: vehicle,
		now:     func() time.Time { return at },
		deliver: func(_ context.Context, event componentTransitionEvent) { delivered = event },
	}
	tests := []struct {
		mode, format, want string
		lookup             bool
	}{
		{"vehicle", "absolute", "1. Nov. 2026, 01:30", true},
		{"user", "absolute", "1. Nov. 2026, 15:00", false},
		{"utc", "absolute", "1. Nov. 2026, 09:30", false},
		{"vehicle", "relative", "jetzt", true},
	}
	for _, tc := range tests {
		settings.TzDisplayDefault, settings.TimeFormatDefault = tc.mode, tc.format
		before := vehicle.calls
		observer.fire(context.Background(), alertmodel.AlertRuleKindPlace, "place:71:vehicle:42:enter", 42, 71, "Home", "", "enter", "Home enter", "Vehicle 42 entered Home", "place.enter")
		if (vehicle.calls > before) != tc.lookup {
			t.Fatalf("mode=%s lookups=%d", tc.mode, vehicle.calls-before)
		}
		if !strings.HasPrefix(delivered.Message, tc.want+"|") {
			t.Fatal(delivered.Message)
		}
		reqBody, _ := json.Marshal(map[string]any{
			"name": rule.Name, "kind": rule.Kind, "place_id": 71, "place_name": "Home", "transition": "enter",
			"vehicle_name": "Vehicle 42", "vehicle_timezone": "America/Los_Angeles",
			"msg_template": template, "include_title": false,
		})
		rr := httptest.NewRecorder()
		apialertmsg.NewAlertMessageHandler(eventDateSettings{settings}).WithClock(func() time.Time { return at }).MessagePreview(rr, httptest.NewRequest(http.MethodPost, "/alerts/message-preview", strings.NewReader(string(reqBody))))
		var preview struct{ Title, Body string }
		if err := json.Unmarshal(rr.Body.Bytes(), &preview); err != nil {
			t.Fatal(err)
		}
		if delivered.Message != preview.Body || delivered.Title != preview.Title || delivered.Title == "" || !delivered.SuppressTransportTitle {
			t.Fatalf("dispatch=%+v preview=%+v", delivered, preview)
		}
		t.Logf("event mode=%s format=%s dispatch=preview: %s", tc.mode, tc.format, delivered.Message)
	}
	vehicle.err = errors.New("lookup unavailable")
	settings.TzDisplayDefault, settings.TimeFormatDefault = "vehicle", "absolute"
	observer.fire(context.Background(), alertmodel.AlertRuleKindPlace, "fallback", 42, 71, "Home", "", "enter", "Home enter", "", "place.enter")
	if !strings.HasPrefix(delivered.Message, "1. Nov. 2026, 15:00|") {
		t.Fatal(delivered.Message)
	}
}
