package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/alertmsg"
	apialertmsg "github.com/ev-dev-labs/teslasync/internal/api/alertmsg"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	"github.com/ev-dev-labs/teslasync/internal/notification/computed"
)

func TestDatetimeWorkerPreviewDispatchParity(t *testing.T) {
	at := time.Date(2026, 3, 8, 10, 1, 0, 0, time.UTC)
	template := "{{NowDisplay}}|{{NowDate}}|{{NowDateShort}}|{{NowTime}}|{{NowRFC3339}}|{{MetricValue}}|{{Unknown}}"
	rule := &alertmodel.AlertRule{Name: "Cost", Kind: "computed_metric", MetricID: ptr("charging_cost"), MsgTemplate: &template, IncludeTitle: false}
	for _, locale := range []string{"en-US", "de-DE", "fr-FR", "ja-JP"} {
		for _, mode := range []string{"utc", "user", "vehicle"} {
			for _, format := range []string{"absolute", "relative"} {
				settings := &systemmodel.Settings{Locale: locale, DecimalPrecision: 2, CurrencySymbol: "€", TimeFormatDefault: format, TzDisplayDefault: mode, TimezoneUser: "Asia/Kolkata"}
				prefs := alertmsg.PreferencesFromSettings(settings).WithVehicleTimezone("America/Los_Angeles")
				prefs.ReferenceTime = at
				client := connectedClient()
				dispatchComputedMetricNotification(context.Background(), rule, 42, "Falcon", computed.Result{Value: 12.345}, []*notificationmodel.NotificationChannel{enabledChannel(1, "webhook")}, client, &fakeChannelLister{}, prefs)
				reqs := client.requests(t)
				reqBody, _ := json.Marshal(map[string]any{"name": rule.Name, "kind": rule.Kind, "metric_id": "charging_cost", "vehicle_name": "Falcon", "vehicle_timezone": "America/Los_Angeles", "include_title": false, "msg_template": template, "signals": map[string]any{"MetricValue": 12.345}})
				rr := httptest.NewRecorder()
				apialertmsg.NewAlertMessageHandler(messageSettings{settings}).WithClock(func() time.Time { return at }).MessagePreview(rr, httptest.NewRequest(http.MethodPost, "/alerts/message-preview", strings.NewReader(string(reqBody))))
				var preview struct{ Title, Body string }
				if err := json.Unmarshal(rr.Body.Bytes(), &preview); err != nil {
					t.Fatal(err)
				}
				if len(reqs) != 1 || reqs[0].Message != preview.Body || reqs[0].Title != preview.Title || !reqs[0].SuppressTransportTitle {
					t.Fatalf("locale=%s mode=%s format=%s dispatch=%+v preview=%+v", locale, mode, format, reqs, preview)
				}
				if !strings.Contains(preview.Body, "2026-03-08T10:01:00Z") {
					t.Fatal(preview.Body)
				}
			}
		}
	}
}
