package aisettingsvalidate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider/azure"
)

func TestAzureNegotiationErrorPreservesBothFailures(t *testing.T) {
	chatErr := fmt.Errorf("%w: azure chat status 404: DeploymentNotFound", provider.ErrUpstream)
	responsesErr := fmt.Errorf("%w: azure responses status 401: invalid key", provider.ErrUpstream)
	code, message := classifyCloudProbeError(context.Background(), errors.Join(chatErr, responsesErr))
	if code != validateConfigCodeUnauthorized || !strings.Contains(message, chatErr.Error()) ||
		!strings.Contains(message, responsesErr.Error()) {
		t.Fatalf("code=%s message=%s", code, message)
	}
}

func TestAzureValidationAndHelixUseSameIdentity(t *testing.T) {
	for _, tc := range []struct {
		name, protocol, override, want string
	}{
		{"auto", "auto", "", "visible-model"},
		{"chat", "chat_completions", "", "visible-model"},
		{"responses", "responses", "", "visible-model"},
		{"edited_identity", "responses", `,"model":"edited-deployment"`, "edited-deployment"},
		{"edited_protocol", "chat_completions", `,"api_protocol":"responses"`, "visible-model"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var mu sync.Mutex
			var identities []string
			var budgets []int
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body struct {
					Model               string `json:"model"`
					MaxTokens           int    `json:"max_tokens"`
					MaxCompletionTokens int    `json:"max_completion_tokens"`
					MaxOutputTokens     int    `json:"max_output_tokens"`
					Stream              bool   `json:"stream"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				wantPath := "/openai/v1/chat/completions"
				if tc.protocol == "responses" || tc.name == "edited_protocol" {
					wantPath = "/openai/v1/responses"
				}
				if r.URL.Path != wantPath || r.URL.RawQuery != "" {
					t.Errorf("path=%s want=%s", r.URL.String(), wantPath)
				}
				identity := body.Model
				cap := body.MaxTokens + body.MaxCompletionTokens + body.MaxOutputTokens
				mu.Lock()
				identities = append(identities, identity)
				budgets = append(budgets, cap)
				mu.Unlock()
				if wantPath == "/openai/v1/responses" {
					_, _ = io.WriteString(w, `{"status":"completed","output_text":"OK"}`)
				} else if body.Stream {
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = io.WriteString(w, "data: "+`{"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}`+"\n\ndata: [DONE]\n\n")
				} else {
					_, _ = io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"OK"},"finish_reason":"stop"}]}`)
				}
			}))
			defer srv.Close()
			saved := map[string]any{
				"default": "azure",
				"azure": map[string]any{
					"base_url": srv.URL + "/openai/v1", "api_key": "k", "model": "visible-model",
					"api_protocol": tc.protocol,
				},
			}
			var live provider.Provider
			h := newTestValidateHandler(saved, "azure", func(cfg provider.ProviderConfig) (provider.Provider, error) {
				a, err := azure.New(cfg, azure.WithHTTPClient(srv.Client()))
				live = a
				return a, err
			})
			rec := httptest.NewRecorder()
			h(rec, httptest.NewRequest(http.MethodPost, "/api/v1/settings/ai/validate-config",
				bytes.NewBufferString(`{"mode":"cloud","provider":"azure"`+tc.override+`}`)))
			if rec.Code != http.StatusOK {
				t.Fatalf("validation: %d %s", rec.Code, rec.Body.String())
			}
			var result validateConfigResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.ProbedModel != tc.want {
				t.Fatalf("reported=%s want=%s", result.ProbedModel, tc.want)
			}
			req := provider.ChatRequest{Messages: []provider.Message{{Role: provider.RoleUser, Content: "hello"}}, MaxTokens: 17}
			if _, err := live.Chat(context.Background(), req); err != nil {
				t.Fatal(err)
			}
			ch, err := live.Stream(context.Background(), req)
			if err != nil {
				t.Fatal(err)
			}
			var done int
			for c := range ch {
				if c.Err != nil {
					t.Fatal(c.Err)
				}
				if c.Done {
					done++
				}
			}
			if done != 1 {
				t.Fatalf("terminal count=%d", done)
			}
			mu.Lock()
			defer mu.Unlock()
			if len(identities) != 3 || identities[0] != tc.want || identities[1] != tc.want || identities[2] != tc.want {
				t.Fatalf("validation/Chat/Stream identities=%v want=%s", identities, tc.want)
			}
			if budgets[0] != validateConfigAzureProbeTokens || budgets[1] != 17 || budgets[2] != 17 {
				t.Fatalf("validation/Chat/Stream budgets=%v", budgets)
			}
		})
	}
}
