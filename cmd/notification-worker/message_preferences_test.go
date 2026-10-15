package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/alertmsg"
	apialertmsg "github.com/ev-dev-labs/teslasync/internal/api/alertmsg"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	"github.com/ev-dev-labs/teslasync/internal/notification/computed"
)

type messageSettings struct{ settings *systemmodel.Settings }

func (s messageSettings) Get(context.Context) (*systemmodel.Settings, error) { return s.settings, nil }

func TestDispatchPreviewPreferenceParity(t *testing.T) {
	templates := []string{"", "{{MetricID}} {{MetricValue}} / {{MetricThreshold}} / {{MetricChangePct}}% / {{unknown}}"}
	for _, preset := range alertmsg.Presets(&alertmodel.AlertRule{Kind: "computed_metric"}) {
		if strings.TrimSpace(preset.Template) != "" {
			templates = append(templates, preset.Template)
		}
	}
	for _, metric := range []string{"charging_cost", "distance", "peak_drive_speed", "energy_charged"} {
		for _, template := range templates {
			t.Run(metric+template, func(t *testing.T) {
				settings := &systemmodel.Settings{DecimalPrecision: 3, Locale: "de-DE", CurrencySymbol: "€", UnitOfLength: "km"}
				rule := &alertmodel.AlertRule{Name: "Measurement", Kind: "computed_metric", MetricID: ptr(metric), MetricWindow: ptr("day"), MetricThreshold: ptr(100.1234), MetricOp: ptr(">"), MsgTemplate: ptr(template), IncludeTitle: false}
				signals := map[string]any{"MetricValue": 1234.56789, "MetricPrevValue": 1000.0, "MetricChangePct": 23.456789}
				previewBody, err := json.Marshal(map[string]any{
					"name": rule.Name, "kind": rule.Kind, "metric_id": metric, "metric_window": "day",
					"metric_op": ">", "metric_threshold": *rule.MetricThreshold,
					"msg_template": template, "include_title": false, "vehicle_name": "Falcon", "signals": signals,
				})
				if err != nil {
					t.Fatal(err)
				}
				rr := httptest.NewRecorder()
				apialertmsg.NewAlertMessageHandler(messageSettings{settings}).MessagePreview(rr, httptest.NewRequest(http.MethodPost, "/alerts/message-preview", strings.NewReader(string(previewBody))))
				var preview struct{ Title, Body string }
				if err := json.Unmarshal(rr.Body.Bytes(), &preview); err != nil {
					t.Fatal(err)
				}
				client := connectedClient()
				logs := &fakeChannelLister{}
				dispatchComputedMetricNotification(context.Background(), rule, 1, "Falcon", computed.Result{Value: 1234.56789, PreviousValue: 1000, PercentChange: 23.456789}, []*notificationmodel.NotificationChannel{enabledChannel(1, "webhook")}, client, logs, alertmsg.PreferencesFromSettings(settings))
				requests := client.requests(t)
				if len(requests) != 1 {
					t.Fatalf("dispatch count=%d", len(requests))
				}
				req := requests[0]
				if req.Message != preview.Body || req.Title != preview.Title || req.Title == "" || !req.SuppressTransportTitle {
					t.Fatalf("dispatch=%+v preview=%+v", req, preview)
				}
				if strings.Contains(req.Message, "%%") {
					t.Fatal(req.Message)
				}
				t.Logf("metric=%s precision=3 locale=de-DE dispatch=preview: %s", metric, req.Message)
			})
		}
	}
}
