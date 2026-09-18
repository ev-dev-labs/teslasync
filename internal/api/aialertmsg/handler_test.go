package aialertmsg

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
)

type stubGuardSettings struct {
	mode string
	on   map[string]bool
}

func (s *stubGuardSettings) AIMode(_ context.Context) (string, error) {
	if s.mode == "" {
		return "off", nil
	}
	return s.mode, nil
}

func (s *stubGuardSettings) AIFeatureEnabled(_ context.Context, id string) (bool, error) {
	return s.on[id], nil
}

func TestAlertMessageTemplateAIOffReturns404(t *testing.T) {
	t.Parallel()

	g := guard.New(&stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"alert-message-template-suggestion": true},
	})

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		r.Route("/ai", func(r chi.Router) {
			r.Post("/alerts/message-template/draft", g.Wrap("alert-message-template-suggestion", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED", http.StatusInternalServerError)
			}))
		})
		r.Get("/alerts/message-presets", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[{"id":"manual","template":"{{VehicleName}}"}]`))
		})
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/message-template/draft", strings.NewReader(`{"kind":"signal","signal_name":"BrakePedal","op":"="}`))
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%q", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "GUARD_BYPASSED") {
		t.Fatal("guard bypassed")
	}

	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/alerts/message-presets", nil)
	router.ServeHTTP(recBaseline, reqBaseline)
	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline status=%d", recBaseline.Code)
	}
}

func TestNewHandlerPanicsOnNil(t *testing.T) {
	t.Parallel()
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	NewHandler(nil, nil, nil, "")
}

func TestParseRequest_RequiresDimensions(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		body string
		want string
	}{
		{"empty", `{}`, "kind must be"},
		{"signal no name", `{"kind":"signal","op":"="}`, "signal_name"},
		{"signal no op", `{"kind":"signal","signal_name":"BrakePedal"}`, "op is required"},
		{"metric no id", `{"kind":"computed_metric"}`, "metric_id"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tc.body))
			_, _, err := parseRequest(req)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err=%v want substring %q", err, tc.want)
			}
		})
	}
}

func TestParseRequest_OK(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"kind":"signal","signal_name":"BrakePedal","op":"="}`))
	got, raw, err := parseRequest(req)
	if err != nil {
		t.Fatal(err)
	}
	if got.SignalName != "BrakePedal" {
		t.Fatalf("got %+v", got)
	}
	if !strings.Contains(string(raw), "BrakePedal") {
		t.Fatalf("raw=%s", raw)
	}
}
