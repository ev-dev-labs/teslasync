package dispatch

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider/azure"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

type chatOnlyAzure struct{ provider.Provider }

func (a chatOnlyAzure) Capabilities() provider.Capabilities {
	caps := a.Provider.Capabilities()
	caps.Streaming = false
	return caps
}

func TestAzureHelixDispatchRoundTrip(t *testing.T) {
	for _, responses := range []bool{false, true} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("responses=%v/stream=%v", responses, stream), func(t *testing.T) {
				model := "model-router"
				if responses {
					model = "gpt-chat-latest"
				}
				var turns, attempts atomic.Int32
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					attempts.Add(1)
					raw, err := io.ReadAll(r.Body)
					if err != nil {
						t.Error(err)
					}
					var body map[string]json.RawMessage
					if err := json.Unmarshal(raw, &body); err != nil {
						t.Error(err)
					}
					if string(body["model"]) != fmt.Sprintf("%q", model) {
						t.Errorf("wrong deployment: %s", body["model"])
					}
					if r.URL.Path == "/openai/v1/chat/completions" && responses {
						w.WriteHeader(http.StatusNotFound)
						_, _ = io.WriteString(w, `{"error":{"code":"DeploymentNotFound"}}`)
						return
					}
					want := "/openai/v1/chat/completions"
					if responses {
						want = "/openai/v1/responses"
					}
					if r.URL.Path != want {
						t.Errorf("path=%s want=%s", r.URL.Path, want)
					}
					turn := turns.Add(1)
					if turn == 2 {
						if !strings.Contains(string(raw), "call_ping") || !strings.Contains(string(raw), `\"pong\":\"ok\"`) {
							t.Errorf("dispatcher failed to replay tool result: %s", raw)
						}
					}
					if responses {
						if turn == 1 {
							_, _ = io.WriteString(w, `{"status":"completed","output":[{"type":"function_call","call_id":"call_ping","name":"ping","arguments":"{}"}]}`)
						} else {
							_, _ = io.WriteString(w, `{"status":"completed","output_text":"Verified pong","usage":{"input_tokens":8,"output_tokens":2}}`)
						}
					} else if stream {
						w.Header().Set("Content-Type", "text/event-stream")
						if turn == 1 {
							_, _ = io.WriteString(w, "data: "+`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_ping","type":"function","function":{"name":"ping","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}`+"\n\n")
						} else {
							_, _ = io.WriteString(w, "data: "+`{"choices":[{"delta":{"content":"Verified pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":2}}`+"\n\n")
						}
						_, _ = io.WriteString(w, "data: [DONE]\n\n")
					} else if turn == 1 {
						_, _ = io.WriteString(w, `{"choices":[{"message":{"role":"assistant","tool_calls":[{"id":"call_ping","type":"function","function":{"name":"ping","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}`)
					} else {
						_, _ = io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"Verified pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":2}}`)
					}
				}))
				defer srv.Close()
				a, err := azure.New(provider.ProviderConfig{
					BaseURL: srv.URL + "/openai/v1", Model: model, APIKey: "k",
					Flavor: provider.AzureFlavorFoundry, Deployment: "hidden-stale-deployment",
				}, azure.WithHTTPClient(srv.Client()))
				if err != nil {
					t.Fatal(err)
				}
				var p provider.Provider = a
				if !stream {
					p = chatOnlyAzure{a}
				}
				registry := tools.NewRegistry()
				registry.Register(&pingTool{})
				d := New(registry, p, nil, 3)
				w := NewCaptureWriter()
				err = d.Run(context.Background(), fakeStrategy{tools: []string{"ping"}}, strategy.StrategyInput{LastMessage: "ping"}, w)
				if err != nil {
					t.Fatal(err)
				}
				if !w.Done() || w.RunError() != nil || strings.Join(w.Deltas(), "") != "Verified pong" {
					t.Fatalf("done=%v error=%v deltas=%v", w.Done(), w.RunError(), w.Deltas())
				}
				if len(w.ToolCalls()) != 1 || len(w.ToolResults()["ping"]) != 1 || len(w.ToolErrors()) != 0 {
					t.Fatalf("calls=%v results=%v errors=%v", w.ToolCalls(), w.ToolResults(), w.ToolErrors())
				}
				finish, in, out := w.Completion()
				if finish != provider.FinishStop || in != 8 || out != 2 {
					t.Fatalf("completion=%s %d/%d", finish, in, out)
				}
				wantAttempts := int32(2)
				if responses {
					wantAttempts = 4
				}
				if turns.Load() != 2 || attempts.Load() != wantAttempts {
					t.Fatalf("turns=%d attempts=%d", turns.Load(), attempts.Load())
				}
			})
		}
	}
}
