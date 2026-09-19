package alerts

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
	"github.com/go-chi/chi/v5"
)

type channelsFake struct {
	fakeNotificationRepo
	err   error
	calls int
}

func (f *channelsFake) GetAllChannels(context.Context) ([]*notificationmodel.NotificationChannel, error) {
	f.calls++
	return []*notificationmodel.NotificationChannel{{ID: 2}, {ID: 3}}, f.err
}

func TestRuleChannelUpdates(t *testing.T) {
	for _, tt := range []struct {
		name, body string
		want       int
		ids        []int64
		dbErr      error
	}{
		{"subset", `{"channel_ids":[2]}`, 200, []int64{2}, nil},
		{"none", `{"channel_ids":[]}`, 200, []int64{}, nil},
		{"all", `{"channel_ids":null}`, 200, nil, nil},
		{"omitted preserves", `{"enabled":true}`, 200, []int64{3}, nil},
		{"missing channel", `{"channel_ids":[99]}`, 400, nil, nil},
		{"negative", `{"channel_ids":[-1]}`, 400, nil, nil},
		{"duplicate", `{"channel_ids":[2,2]}`, 400, nil, nil},
		{"string", `{"channel_ids":["2"]}`, 400, nil, nil},
		{"lookup error", `{"channel_ids":[2]}`, 500, nil, errors.New("private db error")},
	} {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeAlertRuleRepo{existing: &alertmodel.AlertRule{ID: 1, Name: "Battery", SignalName: "BatteryLevel", Op: "<", ValueNum: ptrFloat(20), Severity: "warn", CooldownMin: 60, TriggerMode: "once", Kind: "signal", AllVehicles: true, ChannelIDs: []int64{3}}}
			h := &AlertHandler{alertRuleRepo: repo, notifRepo: &channelsFake{err: tt.dbErr}}
			router := chi.NewRouter()
			router.Put("/rules/{ruleID}", h.UpdateRule)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/rules/1", strings.NewReader(tt.body)))
			if rec.Code != tt.want {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			if tt.want != 200 {
				if len(repo.updated) != 0 {
					t.Fatal("invalid request wrote rule")
				}
				if strings.Contains(rec.Body.String(), "private db") {
					t.Fatal("private error exposed")
				}
				return
			}
			got := repo.updated[0]
			if (got.ChannelIDs == nil) != (tt.ids == nil) || len(got.ChannelIDs) != len(tt.ids) {
				t.Fatalf("wrong channels: %v", got.ChannelIDs)
			}
			for i := range tt.ids {
				if got.ChannelIDs[i] != tt.ids[i] {
					t.Fatal("wrong channel")
				}
			}
			if got.Name != "Battery" || *got.ValueNum != 20 || got.CooldownMin != 60 {
				t.Fatal("channel update changed rule content")
			}
		})
	}
}

func ptrFloat(v float64) *float64 { return &v }
