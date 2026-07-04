package alertmsg

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	alertmsgcore "github.com/ev-dev-labs/teslasync/internal/alertmsg"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
)

// errReader always fails on Read, used to exercise the body-read error
// branch of MessagePreview that a normal in-memory body cannot reach.
type errReader struct{}

func (errReader) Read([]byte) (int, error) { return 0, errors.New("simulated read failure") }

// --- pointer helpers -------------------------------------------------

func sp(s string) *string   { return &s }
func fp(f float64) *float64 { return &f }
func bp(b bool) *bool       { return &b }

// --- shared assertions -----------------------------------------------

// assertJSONContentType pins the exact Content-Type the SPA hooks match
// against, mirroring the contract asserted in internal/api/httpx.
func assertJSONContentType(t *testing.T, rr *httptest.ResponseRecorder) {
	t.Helper()
	const want = "application/json; charset=utf-8"
	if got := rr.Header().Get("Content-Type"); got != want {
		t.Errorf("Content-Type = %q, want %q", got, want)
	}
}

// --- constructor -----------------------------------------------------

func TestNewAlertMessageHandler(t *testing.T) {
	h := NewAlertMessageHandler()
	if h == nil {
		t.Fatal("NewAlertMessageHandler returned nil")
	}
	// Two independent constructions must both be usable (stateless).
	if NewAlertMessageHandler() == nil {
		t.Fatal("second NewAlertMessageHandler returned nil")
	}
}

// --- GET /alerts/message-presets -------------------------------------

func TestMessagePresets(t *testing.T) {
	cases := []struct {
		name  string
		query string
		// check runs per-preset + whole-slice assertions.
		check func(t *testing.T, presets []alertmsgcore.Preset)
	}{
		{
			name:  "no kind returns full catalog with both kinds",
			query: "",
			check: func(t *testing.T, presets []alertmsgcore.Preset) {
				if len(presets) == 0 {
					t.Fatal("expected a non-empty preset catalog")
				}
				var hasSignal, hasComputed bool
				for _, p := range presets {
					switch p.Kind {
					case "signal":
						hasSignal = true
					case "computed_metric":
						hasComputed = true
					}
				}
				if !hasSignal || !hasComputed {
					t.Errorf("no-kind catalog missing a kind: signal=%v computed=%v", hasSignal, hasComputed)
				}
			},
		},
		{
			name:  "signal kind drops computed-only presets",
			query: "kind=signal",
			check: func(t *testing.T, presets []alertmsgcore.Preset) {
				if len(presets) == 0 {
					t.Fatal("expected signal presets")
				}
				for _, p := range presets {
					if p.Kind == "computed_metric" {
						t.Errorf("signal filter leaked computed preset %q", p.ID)
					}
				}
			},
		},
		{
			name:  "computed kind drops signal-only presets",
			query: "kind=computed_metric",
			check: func(t *testing.T, presets []alertmsgcore.Preset) {
				if len(presets) == 0 {
					t.Fatal("expected computed presets")
				}
				for _, p := range presets {
					if p.Kind == "signal" {
						t.Errorf("computed filter leaked signal preset %q", p.ID)
					}
				}
			},
		},
		{
			name:  "unknown kind returns no presets (none are universal)",
			query: "kind=bogus-kind",
			check: func(t *testing.T, presets []alertmsgcore.Preset) {
				if len(presets) != 0 {
					t.Errorf("unknown kind should yield 0 presets, got %d", len(presets))
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			url := "/alerts/message-presets"
			if tc.query != "" {
				url += "?" + tc.query
			}
			req := httptest.NewRequest(http.MethodGet, url, nil)
			rr := httptest.NewRecorder()

			NewAlertMessageHandler().MessagePresets(rr, req)

			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
			}
			assertJSONContentType(t, rr)

			// Response must be a JSON array.
			if b := strings.TrimSpace(rr.Body.String()); !strings.HasPrefix(b, "[") {
				t.Fatalf("expected JSON array body, got %q", b)
			}

			var presets []alertmsgcore.Preset
			if err := json.Unmarshal(rr.Body.Bytes(), &presets); err != nil {
				t.Fatalf("invalid JSON body: %v", err)
			}

			// Every preset the handler returns must carry the identifying
			// fields the frontend keys off (ID) — Template may be blank for
			// the "default"/"suppress" presets by design.
			for _, p := range presets {
				if strings.TrimSpace(p.ID) == "" {
					t.Errorf("preset with empty ID: %+v", p)
				}
			}

			tc.check(t, presets)
		})
	}
}

// TestMessagePresets_MatchesCore ties the handler output to the core
// Presets() contract so the endpoint can never silently diverge from the
// catalog the worker/rule-engine share.
func TestMessagePresets_MatchesCore(t *testing.T) {
	cases := []struct {
		name  string
		query string
		rule  *alertmodel.AlertRule
	}{
		{"no kind", "", nil},
		{"signal", "kind=signal", &alertmodel.AlertRule{Kind: "signal"}},
		{"computed", "kind=computed_metric", &alertmodel.AlertRule{Kind: "computed_metric"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			url := "/alerts/message-presets"
			if tc.query != "" {
				url += "?" + tc.query
			}
			req := httptest.NewRequest(http.MethodGet, url, nil)
			rr := httptest.NewRecorder()
			NewAlertMessageHandler().MessagePresets(rr, req)

			var got []alertmsgcore.Preset
			if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
				t.Fatalf("invalid JSON: %v", err)
			}
			want := alertmsgcore.Presets(tc.rule)
			if len(got) != len(want) {
				t.Fatalf("preset count = %d, want %d", len(got), len(want))
			}
			for i := range want {
				if got[i].ID != want[i].ID {
					t.Errorf("preset[%d].ID = %q, want %q", i, got[i].ID, want[i].ID)
				}
			}
		})
	}
}

// --- GET /alerts/message-placeholders --------------------------------

func TestMessagePlaceholders(t *testing.T) {
	cases := []struct {
		name     string
		query    string
		wantKeys []string
		omitKeys []string
		// wantGroups, when set, requires at least one placeholder in each group.
		wantGroups []string
	}{
		{
			name:       "no params surfaces the universal built-ins",
			query:      "",
			wantKeys:   []string{"VehicleName", "RuleName", "Severity", "Value", "Now", "SignalName"},
			omitKeys:   []string{"Min", "Max"}, // op is empty -> no range keys
			wantGroups: []string{"Built-in"},
		},
		{
			name:       "signal equality lists trigger + siblings + threshold",
			query:      "kind=signal&signal_name=Gear&op==",
			wantKeys:   []string{"Threshold", "SignalName", "Gear"},
			omitKeys:   []string{"Min", "Max"},
			wantGroups: []string{"Built-in", "Triggering Signal", "Related Signals"},
		},
		{
			name:     "signal between lists range keys not threshold",
			query:    "kind=signal&signal_name=Soc&op=between",
			wantKeys: []string{"Min", "Max", "SignalName"},
			omitKeys: []string{"Threshold"},
		},
		{
			name:       "computed metric lists metric built-ins + metric id",
			query:      "kind=computed_metric&metric_id=avg_speed&op=>",
			wantKeys:   []string{"MetricID", "MetricWindow", "MetricThreshold", "MetricValue", "MetricPrevValue", "MetricChangePct", "avg_speed"},
			wantGroups: []string{"Computed Metric"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			url := "/alerts/message-placeholders"
			if tc.query != "" {
				url += "?" + tc.query
			}
			req := httptest.NewRequest(http.MethodGet, url, nil)
			rr := httptest.NewRecorder()

			NewAlertMessageHandler().MessagePlaceholders(rr, req)

			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
			}
			assertJSONContentType(t, rr)

			var got []alertmsgcore.Placeholder
			if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
				t.Fatalf("invalid JSON body: %v", err)
			}
			if len(got) == 0 {
				t.Fatal("expected a non-empty placeholder catalog")
			}

			keys := map[string]bool{}
			groups := map[string]bool{}
			for _, p := range got {
				if strings.TrimSpace(p.Key) == "" {
					t.Errorf("placeholder with empty Key: %+v", p)
				}
				if strings.TrimSpace(p.Group) == "" {
					t.Errorf("placeholder %q has empty Group", p.Key)
				}
				keys[p.Key] = true
				groups[p.Group] = true
			}

			for _, k := range tc.wantKeys {
				if !keys[k] {
					t.Errorf("missing expected placeholder key %q", k)
				}
			}
			for _, k := range tc.omitKeys {
				if keys[k] {
					t.Errorf("unexpected placeholder key %q present", k)
				}
			}
			for _, g := range tc.wantGroups {
				if !groups[g] {
					t.Errorf("missing expected placeholder group %q", g)
				}
			}
		})
	}
}

// TestMessagePlaceholders_MatchesCore ties the handler output to the core
// Placeholders() contract for the shapes the editor actually sends.
func TestMessagePlaceholders_MatchesCore(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/alerts/message-placeholders?kind=signal&signal_name=Gear&op==", nil)
	rr := httptest.NewRecorder()
	NewAlertMessageHandler().MessagePlaceholders(rr, req)

	var got []alertmsgcore.Placeholder
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	want := alertmsgcore.Placeholders(&alertmodel.AlertRule{Kind: "signal", SignalName: "Gear", Op: "="})
	if len(got) != len(want) {
		t.Fatalf("placeholder count = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i].Key != want[i].Key || got[i].Group != want[i].Group {
			t.Errorf("placeholder[%d] = (%q,%q), want (%q,%q)",
				i, got[i].Key, got[i].Group, want[i].Key, want[i].Group)
		}
	}
}

// --- POST /alerts/message-preview ------------------------------------

func TestMessagePreview(t *testing.T) {
	cases := []struct {
		name      string
		body      string
		wantTitle string
		wantBody  string
	}{
		{
			name:      "empty body renders sample defaults",
			body:      "",
			wantTitle: "Sample Rule",
			wantBody:  "",
		},
		{
			name:      "signal template substitutes vehicle + hydrated value + threshold",
			body:      `{"name":"Battery Low","kind":"signal","signal_name":"Soc","op":"<","value_num":20,"vehicle_name":"Falcon","msg_template":"On {{VehicleName}}: {{SignalName}}={{Value}} < {{Threshold}}"}`,
			wantTitle: "Falcon — Battery Low",
			wantBody:  "On Falcon: Soc=18.5 < 20",
		},
		{
			name:      "signal default body hydrates below-threshold sample",
			body:      `{"name":"Low SoC","kind":"signal","signal_name":"Soc","op":"<","value_num":20}`,
			wantTitle: "Low SoC",
			wantBody:  "Soc 18.5 · threshold < 20",
		},
		{
			name:      "caller supplied signal value wins over hydration",
			body:      `{"name":"X","kind":"signal","signal_name":"Soc","op":"<","value_num":20,"signals":{"Soc":42}}`,
			wantTitle: "X",
			wantBody:  "Soc 42 · threshold < 20",
		},
		{
			name:      "computed metric injects sample metric builtins",
			body:      `{"name":"Fast","kind":"computed_metric","metric_id":"avg_speed","metric_window":"1h","metric_op":">","metric_threshold":80}`,
			wantTitle: "Fast",
			wantBody:  "Avg_speed 92.4 over 1h · threshold > 80",
		},
		{
			name:      "include_title false falls back to rule name for empty body",
			body:      `{"name":"Gear Reverse","kind":"signal","signal_name":"Gear","op":"=","value_text":"R","include_title":false}`,
			wantTitle: "Gear Reverse",
			wantBody:  "Gear Reverse",
		},
		{
			name:      "severity builtin is available to templates",
			body:      `{"name":"S","kind":"signal","signal_name":"Soc","op":"<","value_num":20,"severity":"critical","msg_template":"sev={{Severity}}"}`,
			wantTitle: "S",
			wantBody:  "sev=critical",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/alerts/message-preview", strings.NewReader(tc.body))
			rr := httptest.NewRecorder()

			NewAlertMessageHandler().MessagePreview(rr, req)

			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
			}
			assertJSONContentType(t, rr)

			var resp alertMessagePreviewResponse
			if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
				t.Fatalf("invalid JSON body: %v", err)
			}
			if resp.Title != tc.wantTitle {
				t.Errorf("Title = %q, want %q", resp.Title, tc.wantTitle)
			}
			if resp.Body != tc.wantBody {
				t.Errorf("Body = %q, want %q", resp.Body, tc.wantBody)
			}
		})
	}
}

// TestMessagePreview_NilBody covers the request the router synthesises for
// a bodyless POST (r.Body == http.NoBody), which must render defaults.
func TestMessagePreview_NilBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/alerts/message-preview", nil)
	rr := httptest.NewRecorder()

	NewAlertMessageHandler().MessagePreview(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var resp alertMessagePreviewResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if resp.Title != "Sample Rule" {
		t.Errorf("Title = %q, want %q", resp.Title, "Sample Rule")
	}
	if resp.Body != "" {
		t.Errorf("Body = %q, want empty", resp.Body)
	}
}

func TestMessagePreview_InvalidJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/alerts/message-preview", strings.NewReader("not-json{"))
	rr := httptest.NewRecorder()

	NewAlertMessageHandler().MessagePreview(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
	assertJSONContentType(t, rr)

	var errResp map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("invalid JSON error body: %v", err)
	}
	if !strings.HasPrefix(errResp["error"], "invalid JSON:") {
		t.Errorf("error = %q, want prefix %q", errResp["error"], "invalid JSON:")
	}
	if errResp["code"] != "BAD_REQUEST" {
		t.Errorf("code = %q, want BAD_REQUEST", errResp["code"])
	}
}

// TestMessagePreview_BodyReadError exercises the read-failure branch: a
// request body whose Read returns an error must yield a 400 with the
// "failed to read request body" message rather than a panic.
func TestMessagePreview_BodyReadError(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/alerts/message-preview", errReader{})
	rr := httptest.NewRecorder()

	NewAlertMessageHandler().MessagePreview(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
	assertJSONContentType(t, rr)

	var errResp map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("invalid JSON error body: %v", err)
	}
	if errResp["error"] != "failed to read request body" {
		t.Errorf("error = %q, want %q", errResp["error"], "failed to read request body")
	}
	if errResp["code"] != "BAD_REQUEST" {
		t.Errorf("code = %q, want BAD_REQUEST", errResp["code"])
	}
}

// TestMessagePreview_BodyTooLarge feeds a payload larger than the 1 MiB
// limit; the LimitReader truncates it mid-string, so the JSON no longer
// parses and the handler must reject it rather than choke.
func TestMessagePreview_BodyTooLarge(t *testing.T) {
	// 9-byte prefix + limit worth of 'a' + closing bytes. After the reader
	// stops at maxAlertRequestBodyBytes the string is unterminated.
	huge := `{"name":"` + strings.Repeat("a", maxAlertRequestBodyBytes) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/alerts/message-preview", strings.NewReader(huge))
	rr := httptest.NewRecorder()

	NewAlertMessageHandler().MessagePreview(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
}

// TestMessagePreview_LargeValidBodyAccepted confirms a valid body that
// sits under the cap is not spuriously rejected by the limit reader.
func TestMessagePreview_LargeValidBodyAccepted(t *testing.T) {
	tmpl := strings.Repeat("x", 900) // comfortably under the 1 KiB template cap and the 1 MiB body cap
	body := `{"name":"Big","kind":"signal","signal_name":"Soc","op":"<","value_num":20,"msg_template":"` + tmpl + `"}`
	req := httptest.NewRequest(http.MethodPost, "/alerts/message-preview", strings.NewReader(body))
	rr := httptest.NewRecorder()

	NewAlertMessageHandler().MessagePreview(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var resp alertMessagePreviewResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if resp.Body != tmpl {
		t.Errorf("Body = %q, want the literal template (no placeholders to substitute)", resp.Body)
	}
}

// --- previewRuleFromRequest (unexported) ------------------------------

func TestPreviewRuleFromRequest(t *testing.T) {
	cases := []struct {
		name  string
		req   *alertMessagePreviewRequest
		check func(t *testing.T, rule *alertmodel.AlertRule)
	}{
		{
			name: "empty request gets a sample name and title-on default",
			req:  &alertMessagePreviewRequest{},
			check: func(t *testing.T, rule *alertmodel.AlertRule) {
				if rule.Name != "Sample Rule" {
					t.Errorf("Name = %q, want Sample Rule", rule.Name)
				}
				if !rule.IncludeTitle {
					t.Error("IncludeTitle should default to true when nil")
				}
			},
		},
		{
			name: "explicit include_title=false is honoured",
			req:  &alertMessagePreviewRequest{Name: "R", IncludeTitle: bp(false)},
			check: func(t *testing.T, rule *alertmodel.AlertRule) {
				if rule.IncludeTitle {
					t.Error("IncludeTitle should be false when explicitly false")
				}
			},
		},
		{
			name: "explicit include_title=true is honoured",
			req:  &alertMessagePreviewRequest{Name: "R", IncludeTitle: bp(true)},
			check: func(t *testing.T, rule *alertmodel.AlertRule) {
				if !rule.IncludeTitle {
					t.Error("IncludeTitle should be true when explicitly true")
				}
			},
		},
		{
			name: "provided name is preserved",
			req:  &alertMessagePreviewRequest{Name: "My Rule"},
			check: func(t *testing.T, rule *alertmodel.AlertRule) {
				if rule.Name != "My Rule" {
					t.Errorf("Name = %q, want My Rule", rule.Name)
				}
			},
		},
		{
			name: "all fields map through verbatim",
			req: &alertMessagePreviewRequest{
				Name: "Full", Kind: "signal", SignalName: "Soc", Op: "between", Severity: "warn",
				ValueNum: fp(1), ValueText: sp("t"), ValueBool: bp(true), ValueMin: fp(2), ValueMax: fp(9),
				MetricID: sp("m"), MetricWindow: sp("1h"), MetricThreshold: fp(5), MetricOp: sp(">"),
				MsgTemplate: sp("tpl"),
			},
			check: func(t *testing.T, rule *alertmodel.AlertRule) {
				if rule.Kind != "signal" || rule.SignalName != "Soc" || rule.Op != "between" || rule.Severity != "warn" {
					t.Errorf("scalar fields not mapped: %+v", rule)
				}
				if rule.ValueNum == nil || *rule.ValueNum != 1 {
					t.Errorf("ValueNum not mapped: %v", rule.ValueNum)
				}
				if rule.ValueText == nil || *rule.ValueText != "t" {
					t.Errorf("ValueText not mapped: %v", rule.ValueText)
				}
				if rule.ValueBool == nil || *rule.ValueBool != true {
					t.Errorf("ValueBool not mapped: %v", rule.ValueBool)
				}
				if rule.ValueMin == nil || *rule.ValueMin != 2 || rule.ValueMax == nil || *rule.ValueMax != 9 {
					t.Errorf("Value range not mapped: min=%v max=%v", rule.ValueMin, rule.ValueMax)
				}
				if rule.MetricID == nil || *rule.MetricID != "m" || rule.MetricWindow == nil || *rule.MetricWindow != "1h" {
					t.Errorf("metric id/window not mapped: %+v", rule)
				}
				if rule.MetricThreshold == nil || *rule.MetricThreshold != 5 || rule.MetricOp == nil || *rule.MetricOp != ">" {
					t.Errorf("metric threshold/op not mapped: %+v", rule)
				}
				if rule.MsgTemplate == nil || *rule.MsgTemplate != "tpl" {
					t.Errorf("MsgTemplate not mapped: %v", rule.MsgTemplate)
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rule := previewRuleFromRequest(tc.req)
			if rule == nil {
				t.Fatal("previewRuleFromRequest returned nil")
			}
			tc.check(t, rule)
		})
	}
}

// --- hydrateSampleValue (unexported) ----------------------------------

func TestHydrateSampleValue(t *testing.T) {
	cases := []struct {
		name    string
		rule    *alertmodel.AlertRule
		signals map[string]any
		key     string
		wantLen int
		wantSet bool
		want    any
	}{
		{
			name:    "nil rule is a no-op",
			rule:    nil,
			signals: map[string]any{},
			wantLen: 0,
		},
		{
			name:    "empty signal name is a no-op",
			rule:    &alertmodel.AlertRule{SignalName: "", Op: "<", ValueNum: fp(20)},
			signals: map[string]any{},
			wantLen: 0,
		},
		{
			name:    "existing value is preserved",
			rule:    &alertmodel.AlertRule{SignalName: "Soc", Op: "<", ValueNum: fp(20)},
			signals: map[string]any{"Soc": 99.0},
			key:     "Soc", wantLen: 1, wantSet: true, want: 99.0,
		},
		{
			name:    "less-than numeric sits below threshold",
			rule:    &alertmodel.AlertRule{SignalName: "Soc", Op: "<", ValueNum: fp(20)},
			signals: map[string]any{},
			key:     "Soc", wantLen: 1, wantSet: true, want: 18.5,
		},
		{
			name:    "less-equal numeric sits below threshold",
			rule:    &alertmodel.AlertRule{SignalName: "Soc", Op: "<=", ValueNum: fp(20)},
			signals: map[string]any{},
			key:     "Soc", wantLen: 1, wantSet: true, want: 18.5,
		},
		{
			name:    "greater numeric sits above threshold",
			rule:    &alertmodel.AlertRule{SignalName: "Soc", Op: ">", ValueNum: fp(20)},
			signals: map[string]any{},
			key:     "Soc", wantLen: 1, wantSet: true, want: 21.5,
		},
		{
			name:    "greater-equal numeric sits above threshold",
			rule:    &alertmodel.AlertRule{SignalName: "Soc", Op: ">=", ValueNum: fp(20)},
			signals: map[string]any{},
			key:     "Soc", wantLen: 1, wantSet: true, want: 21.5,
		},
		{
			name:    "equality numeric uses the exact threshold",
			rule:    &alertmodel.AlertRule{SignalName: "Soc", Op: "=", ValueNum: fp(20)},
			signals: map[string]any{},
			key:     "Soc", wantLen: 1, wantSet: true, want: 20.0,
		},
		{
			name:    "not-equal numeric uses the exact threshold",
			rule:    &alertmodel.AlertRule{SignalName: "Soc", Op: "!=", ValueNum: fp(20)},
			signals: map[string]any{},
			key:     "Soc", wantLen: 1, wantSet: true, want: 20.0,
		},
		{
			name:    "equality text uses the configured text",
			rule:    &alertmodel.AlertRule{SignalName: "Gear", Op: "=", ValueText: sp("R")},
			signals: map[string]any{},
			key:     "Gear", wantLen: 1, wantSet: true, want: "R",
		},
		{
			name:    "equality bool uses the configured bool",
			rule:    &alertmodel.AlertRule{SignalName: "Locked", Op: "=", ValueBool: bp(true)},
			signals: map[string]any{},
			key:     "Locked", wantLen: 1, wantSet: true, want: true,
		},
		{
			name:    "between uses the midpoint",
			rule:    &alertmodel.AlertRule{SignalName: "Soc", Op: "between", ValueMin: fp(40), ValueMax: fp(80)},
			signals: map[string]any{},
			key:     "Soc", wantLen: 1, wantSet: true, want: 60.0,
		},
		{
			name:    "outside uses the midpoint",
			rule:    &alertmodel.AlertRule{SignalName: "Soc", Op: "outside", ValueMin: fp(20), ValueMax: fp(80)},
			signals: map[string]any{},
			key:     "Soc", wantLen: 1, wantSet: true, want: 50.0,
		},
		{
			name:    "between without bounds falls back to sample",
			rule:    &alertmodel.AlertRule{SignalName: "Soc", Op: "between"},
			signals: map[string]any{},
			key:     "Soc", wantLen: 1, wantSet: true, want: "sample",
		},
		{
			name:    "changed text uses the configured text",
			rule:    &alertmodel.AlertRule{SignalName: "Gear", Op: "changed", ValueText: sp("D")},
			signals: map[string]any{},
			key:     "Gear", wantLen: 1, wantSet: true, want: "D",
		},
		{
			name:    "changed bool uses the configured bool",
			rule:    &alertmodel.AlertRule{SignalName: "Locked", Op: "changed", ValueBool: bp(false)},
			signals: map[string]any{},
			key:     "Locked", wantLen: 1, wantSet: true, want: false,
		},
		{
			name:    "changed without values falls back to sample",
			rule:    &alertmodel.AlertRule{SignalName: "Gear", Op: "changed"},
			signals: map[string]any{},
			key:     "Gear", wantLen: 1, wantSet: true, want: "sample",
		},
		{
			name:    "unknown op falls back to sample",
			rule:    &alertmodel.AlertRule{SignalName: "Soc", Op: "weird-op"},
			signals: map[string]any{},
			key:     "Soc", wantLen: 1, wantSet: true, want: "sample",
		},
		{
			name:    "numeric op with no operands falls back to sample",
			rule:    &alertmodel.AlertRule{SignalName: "Soc", Op: "<"},
			signals: map[string]any{},
			key:     "Soc", wantLen: 1, wantSet: true, want: "sample",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			hydrateSampleValue(tc.rule, tc.signals)

			if len(tc.signals) != tc.wantLen {
				t.Fatalf("signals len = %d, want %d (%v)", len(tc.signals), tc.wantLen, tc.signals)
			}
			if !tc.wantSet {
				return
			}
			got, ok := tc.signals[tc.key]
			if !ok {
				t.Fatalf("signals[%q] not set", tc.key)
			}
			if got != tc.want {
				t.Errorf("signals[%q] = %#v, want %#v", tc.key, got, tc.want)
			}
		})
	}
}
