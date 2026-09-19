package azure

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

// Exercise both supplied portal surfaces and arbitrary deployment aliases.
// The same adapter must negotiate based on the server, not the model name.
func TestV1ToolRoundTrips(t *testing.T) {
	for _, model := range []string{"model-router", "gpt-chat-latest", "custom-production-deployment"} {
		for _, responses := range []bool{false, true} {
			for _, stream := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/responses=%v/stream=%v", model, responses, stream), func(t *testing.T) {
					var attempts atomic.Int32
					var turns atomic.Int32
					srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						attempts.Add(1)
						var body map[string]json.RawMessage
						if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
							t.Error(err)
						}
						if string(body["model"]) != fmt.Sprintf("%q", model) {
							t.Errorf("model=%s want %s", body["model"], model)
						}
						if r.URL.RawQuery != "" || r.Header.Get("api-key") != "k" {
							t.Errorf("query/auth: %s", r.URL.String())
						}
						if r.URL.Path == "/openai/v1/chat/completions" && responses {
							w.WriteHeader(http.StatusNotFound)
							_, _ = io.WriteString(w, `{"error":{"code":"DeploymentNotFound","message":"The API deployment for this resource does not exist."}}`)
							return
						}
						if r.URL.Path == "/openai/v1/responses" && !responses {
							// The model-router screenshot: Responses is unsupported.
							w.WriteHeader(http.StatusBadRequest)
							_, _ = io.WriteString(w, `{"error":{"message":"The requested operation is unsupported."}}`)
							t.Error("chat-capable deployment must never be sent to Responses")
							return
						}
						wantPath := "/openai/v1/chat/completions"
						historyKey, capKey := "messages", "max_completion_tokens"
						if responses {
							wantPath = "/openai/v1/responses"
							historyKey, capKey = "input", "max_output_tokens"
							if string(body["store"]) != "false" {
								t.Errorf("provider retention must be disabled: %s", body["store"])
							}
						}
						if r.URL.Path != wantPath || string(body[capKey]) != "73" {
							t.Errorf("path/budget: %s %s", r.URL.Path, body[capKey])
						}
						var tools []map[string]json.RawMessage
						if err := json.Unmarshal(body["tools"], &tools); err != nil || len(tools) != 1 {
							t.Errorf("tools=%s err=%v", body["tools"], err)
						}
						var history []map[string]json.RawMessage
						if err := json.Unmarshal(body[historyKey], &history); err != nil {
							t.Error(err)
						}
						turn := turns.Add(1)
						if turn == 2 {
							if len(history) != 3 {
								t.Errorf("history=%s", body[historyKey])
							} else if responses {
								if string(history[1]["type"]) != `"function_call"` ||
									string(history[1]["call_id"]) != `"call_1"` ||
									string(history[1]["arguments"]) != `"{\"q\":\"soc\"}"` ||
									string(history[2]["type"]) != `"function_call_output"` ||
									string(history[2]["call_id"]) != `"call_1"` ||
									string(history[2]["output"]) != `"{\"soc\":80}"` {
									t.Errorf("Responses replay=%s", body[historyKey])
								}
							} else if !strings.Contains(string(history[1]["tool_calls"]), `"call_1"`) ||
								string(history[2]["tool_call_id"]) != `"call_1"` ||
								string(history[2]["content"]) != `"{\"soc\":80}"` {
								t.Errorf("chat replay=%s", body[historyKey])
							}
						}
						if responses {
							if turn == 1 {
								_, _ = io.WriteString(w, `{"status":"completed","output":[{"type":"function_call","call_id":"call_1","name":"lookup","arguments":"{\"q\":\"soc\"}"}],"usage":{"input_tokens":4,"output_tokens":2}}`)
							} else {
								_, _ = io.WriteString(w, `{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"SOC 80%"}]}],"usage":{"input_tokens":9,"output_tokens":3}}`)
							}
						} else if stream {
							w.Header().Set("Content-Type", "text/event-stream")
							if turn == 1 {
								_, _ = io.WriteString(w, "data: "+`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\"q\":\"soc\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":4,"completion_tokens":2}}`+"\n\n")
							} else {
								_, _ = io.WriteString(w, "data: "+`{"choices":[{"delta":{"content":"SOC 80%"},"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":3}}`+"\n\n")
							}
							_, _ = io.WriteString(w, "data: [DONE]\n\n")
						} else if turn == 1 {
							_, _ = io.WriteString(w, `{"choices":[{"message":{"role":"assistant","tool_calls":[{"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\"q\":\"soc\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":4,"completion_tokens":2}}`)
						} else {
							_, _ = io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"SOC 80%"},"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":3}}`)
						}
					}))
					defer srv.Close()
					a, err := New(provider.ProviderConfig{BaseURL: srv.URL + "/openai/v1", Model: model,
						APIKey: "k"},
						WithHTTPClient(srv.Client()))
					if err != nil {
						t.Fatal(err)
					}
					req := provider.ChatRequest{
						Messages:  []provider.Message{{Role: provider.RoleUser, Content: "lookup SOC"}},
						Tools:     []provider.ToolSpec{{Name: "lookup", Parameters: json.RawMessage(`{"type":"object","properties":{"q":{"type":"string"}}}`)}},
						MaxTokens: 73,
					}
					first := completeTurn(t, a, req, stream)
					if first.FinishReason != provider.FinishToolCalls || len(first.ToolCalls) != 1 ||
						first.ToolCalls[0].ID != "call_1" || first.ToolCalls[0].Name != "lookup" ||
						string(first.ToolCalls[0].Arguments) != `{"q":"soc"}` ||
						first.InputTokens != 4 || first.OutputTokens != 2 {
						t.Fatalf("first=%+v", first)
					}
					req.Messages = append(req.Messages,
						provider.Message{Role: provider.RoleAssistant, ToolCalls: first.ToolCalls},
						provider.Message{Role: provider.RoleTool, ToolID: first.ToolCalls[0].ID, Content: `{"soc":80}`})
					last := completeTurn(t, a, req, stream)
					if last.Message.Content != "SOC 80%" || last.FinishReason != provider.FinishStop ||
						last.InputTokens != 9 || last.OutputTokens != 3 || len(last.ToolCalls) != 0 {
						t.Fatalf("last=%+v", last)
					}
					wantAttempts := int32(2)
					if responses {
						wantAttempts = 4
					}
					if attempts.Load() != wantAttempts {
						t.Fatalf("attempts=%d want %d", attempts.Load(), wantAttempts)
					}
				})
			}
		}
	}
}

func completeTurn(t *testing.T, a *Adapter, req provider.ChatRequest, stream bool) *provider.ChatResponse {
	t.Helper()
	if !stream {
		resp, err := a.Chat(context.Background(), req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}
	ch, err := a.Stream(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	resp := &provider.ChatResponse{}
	terminals := 0
	for c := range ch {
		if c.Err != nil {
			t.Fatal(c.Err)
		}
		if terminals != 0 {
			t.Fatal("chunk after terminal")
		}
		resp.Message.Content += c.Delta
		if c.ToolDelta != nil {
			resp.ToolCalls = append(resp.ToolCalls, *c.ToolDelta)
		}
		if c.Done {
			terminals++
			resp.FinishReason, resp.InputTokens, resp.OutputTokens = c.FinishReason, c.InputTokens, c.OutputTokens
		}
	}
	if terminals != 1 {
		t.Fatalf("terminals=%d", terminals)
	}
	return resp
}

func TestNegotiationErrors(t *testing.T) {
	tests := []struct {
		name     string
		status   int
		body     string
		fallback bool
	}{
		{"deployment", 404, `{"error":{"code":"DeploymentNotFound"}}`, true},
		{"not_found", 404, `{"error":{"code":"404","message":"Resource not found"}}`, true},
		{"unsupported_code", 400, `{"error":{"code":"OperationNotSupported"}}`, true},
		{"unsupported_message", 400, `{"error":{"message":"The requested operation is unsupported."}}`, true},
		{"auth", 401, `{"error":{"code":"OperationNotSupported"}}`, false},
		{"forbidden", 403, `{"error":{"code":"DeploymentNotFound"}}`, false},
		{"rate", 429, `{"error":{"code":"OperationNotSupported"}}`, false},
		{"server", 500, `{"error":{"code":"DeploymentNotFound"}}`, false},
		{"token_budget", 400, `{"error":{"code":"invalid_request_error","message":"max_tokens or model output limit was reached"}}`, false},
		{"unsupported_parameter", 400, `{"error":{"code":"unsupported_parameter","message":"Unsupported parameter: temperature"}}`, false},
		{"misleading_text", 400, `{"error":{"message":"DeploymentNotFound status 404 unsupported"}}`, false},
		{"html404", 404, `<html>DeploymentNotFound</html>`, false},
		{"auth404", 404, `{"error":{"code":"Unauthorized"}}`, false},
		{"malformed", 404, `{"error":`, false},
	}
	for _, tt := range tests {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream=%v", tt.name, stream), func(t *testing.T) {
				var hits atomic.Int32
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					n := hits.Add(1)
					if n == 1 {
						if r.URL.Path != "/openai/v1/chat/completions" {
							t.Errorf("first path=%s", r.URL.Path)
						}
						w.WriteHeader(tt.status)
						_, _ = io.WriteString(w, tt.body)
					} else {
						if r.URL.Path != "/openai/v1/responses" {
							t.Errorf("fallback path=%s", r.URL.Path)
						}
						w.WriteHeader(400)
						_, _ = io.WriteString(w, `{"error":{"message":"The requested operation is unsupported."}}`)
					}
				}))
				defer srv.Close()
				a, err := New(provider.ProviderConfig{BaseURL: srv.URL + "/openai/v1", Model: "any", APIKey: "k"})
				if err != nil {
					t.Fatal(err)
				}
				req := provider.ChatRequest{Messages: []provider.Message{{Role: provider.RoleUser, Content: "hi"}}}
				if stream {
					var ch <-chan provider.Chunk
					ch, err = a.Stream(context.Background(), req)
					if ch != nil {
						t.Fatal("failed fallback returned stream")
					}
				} else {
					_, err = a.Chat(context.Background(), req)
				}
				if !errors.Is(err, provider.ErrUpstream) || !strings.Contains(err.Error(), tt.body) {
					t.Fatalf("original error lost: %v", err)
				}
				want := int32(1)
				if tt.fallback {
					want = 2
					if !strings.Contains(err.Error(), "azure responses status 400") {
						t.Fatalf("fallback error lost: %v", err)
					}
				}
				if hits.Load() != want {
					t.Fatalf("attempts=%d want=%d", hits.Load(), want)
				}
			})
		}
	}
}

func TestResponsesUnsuccessfulResults(t *testing.T) {
	for _, body := range []string{
		`{"status":"failed","error":{"code":"server_error","message":"failed upstream"}}`,
		`{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output_text":"partial"}`,
		`{"status":"incomplete","incomplete_details":{"reason":"content_filter"}}`,
		`{"status":"cancelled"}`, `{"status":"queued"}`, `{"status":"in_progress"}`,
		`{"status":"completed","output":[{"type":"message","content":[{"type":"refusal","refusal":"refused"}]}]}`,
		`{"status":"completed","output":[{"type":"function_call","call_id":"call_1","name":"lookup","arguments":"{"}]}`,
		`{"status":"completed","output":[{"type":"function_call","name":"lookup","arguments":"{}"}]}`,
		`{"status":"completed"}`, `{}`, `not JSON`,
	} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream=%v", body, stream), func(t *testing.T) {
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if rejectChatOperation(w, r) {
						return
					}
					_, _ = io.WriteString(w, body)
				}))
				defer srv.Close()
				a, err := New(provider.ProviderConfig{BaseURL: srv.URL + "/openai/v1", Model: "any", APIKey: "k"})
				if err != nil {
					t.Fatal(err)
				}
				if stream {
					ch, streamErr := a.Stream(context.Background(), provider.ChatRequest{})
					if ch != nil || !errors.Is(streamErr, provider.ErrUpstream) {
						t.Fatalf("false success: ch=%v err=%v", ch, streamErr)
					}
				} else {
					resp, chatErr := a.Chat(context.Background(), provider.ChatRequest{})
					if resp != nil || !errors.Is(chatErr, provider.ErrUpstream) {
						t.Fatalf("false success: resp=%v err=%v", resp, chatErr)
					}
				}
			})
		}
	}
}

func TestResponsesEmptyInputNotFabricated(t *testing.T) {
	body, err := encodeResponsesRequest(provider.ChatRequest{}, "any")
	if err != nil {
		t.Fatal(err)
	}

	var decoded responsesCreate
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Input) != 0 || strings.Contains(string(body), "ping") || decoded.Store {
		t.Fatalf("fabricated input or retained response: %s", body)
	}
}

type failingTransport struct{ calls atomic.Int32 }

func (f *failingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	f.calls.Add(1)
	return nil, errors.New("transport failure mentioning status 404 DeploymentNotFound")
}

func TestTransportFailureNeverNegotiates(t *testing.T) {
	for _, stream := range []bool{false, true} {
		transport := &failingTransport{}
		a, err := New(provider.ProviderConfig{BaseURL: "https://example.test/openai/v1", APIKey: "k", Model: "any"},
			WithHTTPClient(&http.Client{Transport: transport}))
		if err != nil {
			t.Fatal(err)
		}
		if stream {
			_, err = a.Stream(context.Background(), provider.ChatRequest{})
		} else {
			_, err = a.Chat(context.Background(), provider.ChatRequest{})
		}
		if !errors.Is(err, provider.ErrUpstream) || transport.calls.Load() != 1 {
			t.Fatalf("stream=%v err=%v calls=%d", stream, err, transport.calls.Load())
		}
	}
}
