package ainldash

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestValidateWidgetDraft(t *testing.T) {
	t.Parallel()
	catalog := []widgetCatalogEntry{
		{ID: "battery-gauge", Name: "Battery"},
		{ID: "charge-status", Name: "Charging"},
	}
	for _, tt := range []struct {
		name     string
		response string
		valid    bool
	}{
		{"valid selection", `{"title":"Battery desk","widget_ids":["battery-gauge","charge-status"]}`, true},
		{"unknown widget", `{"title":"Battery desk","widget_ids":["other"]}`, false},
		{"duplicate", `{"title":"Battery desk","widget_ids":["battery-gauge","battery-gauge"]}`, false},
		{"empty selection", `{"title":"Battery desk","widget_ids":[]}`, false},
		{"markdown instead of JSON", "```json\n{}\n```", false},
		{"unexpected field", `{"title":"Battery desk","widget_ids":["battery-gauge"],"execute":true}`, false},
		{"trailing object", `{"title":"Battery desk","widget_ids":["battery-gauge"]}{}`, false},
		{"blank title", `{"title":"   ","widget_ids":["battery-gauge"]}`, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := validateWidgetDraft(tt.response, catalog)
			if (err == nil) != tt.valid {
				t.Fatalf("validateWidgetDraft error = %v, want valid = %t", err, tt.valid)
			}
		})
	}
}

func TestWidgetDraftRejectsInvalidRequestsBeforeProvider(t *testing.T) {
	t.Parallel()
	for _, body := range []string{
		`{"prompt":"","widgets":[{"id":"battery-gauge","name":"Battery","description":""}]}`,
		`{"prompt":"Battery","widgets":[{"id":"bad id","name":"Battery","description":""}]}`,
		`{"prompt":"Battery","widgets":[{"id":"battery-gauge","name":"Battery","description":""},{"id":"battery-gauge","name":"Battery","description":""}]}`,
		`{"prompt":"Battery","widgets":[{"id":"battery-gauge","name":"Battery","description":""}]}{}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/dashboard/widgets/draft", bytes.NewBufferString(body))
		rec := httptest.NewRecorder()
		(&Handler{}).ServeWidgetDraftHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("request %s: status = %d, want 400", body, rec.Code)
		}
	}
}
