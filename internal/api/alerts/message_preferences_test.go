package alerts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apialertmsg "github.com/ev-dev-labs/teslasync/internal/api/alertmsg"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type alertMessageSettings struct{ settings *systemmodel.Settings }

func (s alertMessageSettings) Get(context.Context) (*systemmodel.Settings, error) {
	return s.settings, nil
}

func TestTestMessagePreviewFormattingParity(t *testing.T) {
	settings := &systemmodel.Settings{DecimalPrecision: 2, Locale: "de-DE", UnitOfLength: "mi"}
	store, err := signal.NewLiveSignalStore(signal.New(), nil, "local")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Update(context.Background(), 1, map[string]any{"VehicleSpeed": 26.8224}); err != nil {
		t.Fatal(err)
	}
	handler := newAlertHandlerForTest()
	repo := &fakeNotificationRepo{}
	handler.notifRepo = repo
	handler.liveSignals = store
	handler.messageSettings = alertMessageSettings{settings}
	request := `{"name":"Limit","signal_name":"VehicleSpeed","op":">","value_num":30,"vehicle_id":1,"vehicle_name":"Falcon","msg_template":"{{VehicleName}} {{Value}} / {{Threshold}} / {{VehicleSpeed}} / {{Typo}}","include_title":false,"target":{"channel_ids":[999]}}`
	rr := httptest.NewRecorder()
	handler.TestRule(rr, httptest.NewRequest(http.MethodPost, "/alerts/test", strings.NewReader(request)))
	if rr.Code != http.StatusOK || len(repo.logs) != 1 {
		t.Fatalf("status=%d logs=%d body=%s", rr.Code, len(repo.logs), rr.Body.String())
	}
	if repo.logs[0].Message != "Falcon 60,00 mph / 67,11 mph / 60,00 mph / {{Typo}}" {
		t.Fatal(repo.logs[0].Message)
	}
	previewReq := `{"kind":"signal","name":"Limit","signal_name":"VehicleSpeed","op":">","value_num":30,"vehicle_name":"Falcon","signals":{"VehicleSpeed":26.8224},"msg_template":"{{VehicleName}} {{Value}} / {{Threshold}} / {{VehicleSpeed}} / {{Typo}}","include_title":false}`
	rr = httptest.NewRecorder()
	apialertmsg.NewAlertMessageHandler(alertMessageSettings{settings}).MessagePreview(rr, httptest.NewRequest(http.MethodPost, "/alerts/message-preview", strings.NewReader(previewReq)))
	var preview struct{ Title, Body string }
	if err := json.Unmarshal(rr.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if repo.logs[0].Message != preview.Body || repo.logs[0].Title != "[TEST] "+preview.Title {
		t.Fatalf("event=%+v preview=%+v", repo.logs[0], preview)
	}
	t.Logf("Test Message persisted body = backend preview: %s", preview.Body)
}
