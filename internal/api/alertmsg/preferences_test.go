package alertmsg

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	alertmsgcore "github.com/ev-dev-labs/teslasync/internal/alertmsg"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

type settingsFixture struct {
	settings *systemmodel.Settings
	err      error
}

func (f settingsFixture) Get(context.Context) (*systemmodel.Settings, error) {
	return f.settings, f.err
}

func TestPreviewUsesAuthoritativePreferences(t *testing.T) {
	tests := []struct {
		locale    string
		precision int
		want      string
	}{
		{"de-DE", 2, "1.234,57 km / 1.500,00 km"},
		{"en-US", 4, "1,234.5679 km / 1,500.0000 km"},
		{"en-US", 0, "1,235 km / 1,500 km"},
	}
	for _, tc := range tests {
		t.Run(tc.locale+string(rune('0'+tc.precision)), func(t *testing.T) {
			settings := &systemmodel.Settings{DecimalPrecision: tc.precision, Locale: tc.locale}
			req := httptest.NewRequest(http.MethodPost, "/alerts/message-preview", strings.NewReader(`{"kind":"signal","name":"Range","signal_name":"Odometer","op":">","value_num":1500000,"signals":{"Odometer":1234567.89},"msg_template":"{{Value}} / {{Threshold}}"}`))
			rr := httptest.NewRecorder()
			NewAlertMessageHandler(settingsFixture{settings: settings}).MessagePreview(rr, req)
			var got alertMessagePreviewResponse
			if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if got.Body != tc.want {
				t.Fatalf("body = %q, want %q", got.Body, tc.want)
			}
			t.Logf("locale=%s precision=%d preview=%s", tc.locale, tc.precision, got.Body)
		})
	}
}

func TestCatalogExamplesUsePreferencesAndKeepTemplates(t *testing.T) {
	settings := settingsFixture{settings: &systemmodel.Settings{DecimalPrecision: 4, Locale: "de-DE", UnitOfPressure: "psi"}}
	h := NewAlertMessageHandler(settings)
	rr := httptest.NewRecorder()
	h.MessagePlaceholders(rr, httptest.NewRequest(http.MethodGet, "/alerts/message-placeholders?kind=signal&signal_name=TpmsPressureFl&op=>", nil))
	var placeholders []alertmsgcore.Placeholder
	if err := json.Unmarshal(rr.Body.Bytes(), &placeholders); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range placeholders {
		if p.Key == "Value" {
			found = true
			if p.Example != "0,0120 psi" {
				t.Fatal(p.Example)
			}
		}
	}
	if !found {
		t.Fatal("missing Value")
	}
	rr = httptest.NewRecorder()
	h.MessagePresets(rr, httptest.NewRequest(http.MethodGet, "/alerts/message-presets?kind=signal&signal_name=Soc&op=>", nil))
	var presets []alertmsgcore.Preset
	if err := json.Unmarshal(rr.Body.Bytes(), &presets); err != nil {
		t.Fatal(err)
	}
	for _, p := range presets {
		if p.ID == "signal-concise" {
			if p.Template != "{{RuleName}}: {{Value}}" {
				t.Fatalf("template changed: %q", p.Template)
			}
			if p.Example != "Sample Rule: 82,4567%" {
				t.Fatal(p.Example)
			}
		}
	}
	rr = httptest.NewRecorder()
	h.MessagePresets(rr, httptest.NewRequest(http.MethodGet, "/alerts/message-presets?kind=signal&signal_name=HvacPower&op==", nil))
	if !strings.Contains(rr.Body.String(), "Sample Rule: sample") {
		t.Fatal(rr.Body.String())
	}
}

func TestPreviewPreservesNullAndText(t *testing.T) {
	for _, test := range []struct{ value, want string }{
		{"null", "—|{{Typo}}"},
		{"0", "0.000%|{{Typo}}"},
		{`"00123"`, "00123|{{Typo}}"},
		{"false", "false|{{Typo}}"},
	} {
		req := httptest.NewRequest(http.MethodPost, "/alerts/message-preview", strings.NewReader(`{"kind":"signal","signal_name":"Soc","signals":{"Soc":`+test.value+`},"msg_template":"{{Value}}|{{Typo}}"}`))
		rr := httptest.NewRecorder()
		NewAlertMessageHandler(settingsFixture{settings: &systemmodel.Settings{DecimalPrecision: 3}}).MessagePreview(rr, req)
		var got alertMessagePreviewResponse
		if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.Body != test.want {
			t.Fatalf("value=%s body=%q want=%q", test.value, got.Body, test.want)
		}
	}
}
