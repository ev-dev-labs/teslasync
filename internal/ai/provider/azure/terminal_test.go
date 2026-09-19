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
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

func TestChatRejectsInvalidCompletions(t *testing.T) {
	for _, body := range []string{
		`{}`, `{"choices":[]}`,
		`{"choices":[{"message":{"content":"partial"}}]}`,
		`{"choices":[{"message":{"content":"partial"},"finish_reason":"unknown"}]}`,
		`{"choices":[{"message":{"content":""},"finish_reason":"stop"}]}`,
		`{"choices":[{"message":{"refusal":"refused"},"finish_reason":"stop"}]}`,
		`{"choices":[{"message":{},"finish_reason":"tool_calls"}]}`,
		`{"choices":[{"message":{"tool_calls":[{"id":"c","function":{"name":"lookup","arguments":"{"}}]},"finish_reason":"tool_calls"}]}`,
		`{"choices":[{"message":{"tool_calls":[{"id":"c","function":{"name":"lookup","arguments":"null"}}]},"finish_reason":"tool_calls"}]}`,
		`{"choices":[{"message":{"tool_calls":[{"id":"c","function":{"name":"lookup","arguments":"{}"}}]},"finish_reason":"stop"}]}`,
	} {
		t.Run(body, func(t *testing.T) {
			var wire azureChatResponse
			if err := json.Unmarshal([]byte(body), &wire); err != nil {
				t.Fatal(err)
			}
			out, err := wire.toChatResponse()
			if out != nil || !errors.Is(err, provider.ErrUpstream) {
				t.Fatalf("false success: out=%+v err=%v", out, err)
			}
		})
	}
}

func TestStreamRejectsIncompleteAndInvalidTerminals(t *testing.T) {
	for _, frames := range []string{
		"",
		"data:[DONE]\n\n",
		"data:{\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
		"data:{\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\ndata:[DONE]\n\n",
		"data:{\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
		"data:{\"choices\":[{\"delta\":{\"refusal\":\"refused\"},\"finish_reason\":\"stop\"}]}\n\n",
		"data:{\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n",
		"data:" + `{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"lookup","arguments":"{"}}]},"finish_reason":"tool_calls"}]}` + "\n\n",
	} {
		t.Run(frames, func(t *testing.T) {
			ch := make(chan provider.Chunk, 8)
			go relayStream(context.Background(), io.NopCloser(strings.NewReader(frames)), ch)
			terminalErrors, done := 0, 0
			for chunk := range ch {
				if terminalErrors != 0 {
					t.Fatal("chunk after terminal error")
				}
				if chunk.Err != nil {
					terminalErrors++
				}
				if chunk.Done {
					done++
				}
				if chunk.ToolDelta != nil {
					t.Fatal("invalid tool emitted")
				}
			}
			if terminalErrors != 1 || done != 0 {
				t.Fatalf("errors=%d done=%d", terminalErrors, done)
			}
		})
	}
}

func TestStreamPreservesTruncatedToolFinishReason(t *testing.T) {
	for _, finish := range []string{provider.FinishLength, provider.FinishContentFilter} {
		frames := `data:{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"lookup","arguments":"{"}}]},"finish_reason":"` + finish + `"}]}` + "\n\n"
		ch := make(chan provider.Chunk, 8)
		go relayStream(context.Background(), io.NopCloser(strings.NewReader(frames)), ch)
		done := 0
		for chunk := range ch {
			if chunk.Err != nil || chunk.ToolDelta != nil || !chunk.Done || chunk.FinishReason != finish {
				t.Fatalf("finish=%s chunk=%+v", finish, chunk)
			}
			done++
		}
		if done != 1 {
			t.Fatalf("terminals=%d", done)
		}
	}
}

func TestProtocolCancellationPreservesErrorAndClosesStreams(t *testing.T) {
	for _, protocol := range []string{provider.FoundryProtocolAuto, provider.FoundryProtocolChat, provider.FoundryProtocolResponses} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream=%v", protocol, stream), func(t *testing.T) {
				started := make(chan struct{})
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusOK)
					w.(http.Flusher).Flush()
					close(started)
					<-r.Context().Done()
				}))
				defer srv.Close()
				a, err := New(provider.ProviderConfig{BaseURL: srv.URL, Model: "any", APIKey: "k", APIProtocol: protocol})
				if err != nil {
					t.Fatal(err)
				}
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				result := make(chan error, 1)
				go func() {
					if !stream {
						_, callErr := a.Chat(ctx, provider.ChatRequest{})
						result <- callErr
						return
					}
					ch, callErr := a.Stream(ctx, provider.ChatRequest{})
					if callErr != nil {
						result <- callErr
						return
					}
					for chunk := range ch {
						if chunk.Done || chunk.ToolDelta != nil {
							result <- fmt.Errorf("success/tool after cancellation: %+v", chunk)
							return
						}
					}
					result <- ctx.Err()
				}()
				select {
				case <-started:
				case <-time.After(3 * time.Second):
					t.Fatal("request did not start")
				}
				cancel()
				select {
				case err := <-result:
					if !errors.Is(err, context.Canceled) {
						t.Fatalf("cancellation identity lost: %v", err)
					}
				case <-time.After(3 * time.Second):
					t.Fatal("cancellation did not stop request")
				}
			})
		}
	}
}

func TestBufferedStreamDoesNotEmitAfterCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for chunk := range chatResponseAsStream(ctx, &provider.ChatResponse{Message: provider.Message{Content: "not delivered"}}) {
		t.Fatalf("chunk after cancellation: %+v", chunk)
	}
}

func TestResponsesRejectsBlockedIncompleteAndInvalidToolItems(t *testing.T) {
	for _, body := range []string{
		`{"status":"completed","output_text":"blocked","content_filters":[{"blocked":true}]}`,
		`{"status":"completed","output":[{"type":"message","status":"incomplete","content":[{"type":"output_text","text":"partial"}]}]}`,
		`{"status":"completed","output":[{"type":"function_call","status":"in_progress","call_id":"c","name":"lookup","arguments":"{}"}]}`,
		`{"status":"completed","output":[{"type":"function_call","call_id":"c","name":"lookup","arguments":"null"}]}`,
		`{"status":"completed","output":[{"type":"function_call","call_id":"c","name":"lookup","arguments":"{}"},{"type":"function_call","call_id":"c","name":"lookup","arguments":"{}"}]}`,
	} {
		if out, err := decodeResponses([]byte(body)); out != nil || !errors.Is(err, provider.ErrUpstream) {
			t.Fatalf("false success: body=%s out=%+v err=%v", body, out, err)
		}
	}
}
