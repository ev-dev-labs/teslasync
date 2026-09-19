package dispatch

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider/azure"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

type rejectingAzureWriter struct{ *CaptureWriter }

func (rejectingAzureWriter) WriteDelta(string) error { return errors.New("client disconnected") }

func TestAzureDispatchClosesAbandonedUpstreamStream(t *testing.T) {
	for _, cancelRequest := range []bool{false, true} {
		t.Run(map[bool]string{false: "writer_failure", true: "request_cancelled"}[cancelRequest], func(t *testing.T) {
			started, closed := make(chan struct{}), make(chan struct{})
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				w.WriteHeader(http.StatusOK)
				if !cancelRequest {
					_, _ = io.WriteString(w, "data:{\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n")
				}
				w.(http.Flusher).Flush()
				close(started)
				<-r.Context().Done()
				close(closed)
			}))
			defer srv.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			a, err := azure.New(provider.ProviderConfig{BaseURL: srv.URL, APIKey: "k", Model: "any"})
			if err != nil {
				t.Fatal(err)
			}
			d := New(tools.NewRegistry(), a, nil, 3)
			result := make(chan error, 1)
			go func() {
				_, _, err := d.completeTurn(ctx, provider.ChatRequest{}, rejectingAzureWriter{NewCaptureWriter()})
				result <- err
			}()
			select {
			case <-started:
			case <-time.After(3 * time.Second):
				t.Fatal("request did not start")
			}
			if cancelRequest {
				cancel()
			}
			select {
			case err := <-result:
				if err == nil || (cancelRequest && !errors.Is(err, context.Canceled)) {
					t.Fatalf("expected cancellation/client error: %v", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("dispatcher did not stop")
			}
			select {
			case <-closed:
			case <-time.After(3 * time.Second):
				t.Fatal("abandoned upstream stream remains open")
			}
		})
	}
}
