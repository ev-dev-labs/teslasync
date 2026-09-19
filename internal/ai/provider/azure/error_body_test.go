package azure

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

func TestErrorBodyTransportFailureDoesNotNegotiate(t *testing.T) {
	for _, stream := range []bool{false, true} {
		var calls atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			w.Header().Set("Content-Length", "1000")
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"error":{"code":"DeploymentNotFound"}}`)
		}))
		a, err := New(provider.ProviderConfig{BaseURL: srv.URL, Model: "any", APIKey: "k"})
		if err != nil {
			t.Fatal(err)
		}
		if stream {
			_, err = a.Stream(context.Background(), provider.ChatRequest{})
		} else {
			_, err = a.Chat(context.Background(), provider.ChatRequest{})
		}
		srv.Close()
		if !errors.Is(err, io.ErrUnexpectedEOF) || calls.Load() != 1 {
			t.Fatalf("stream=%v calls=%d err=%v", stream, calls.Load(), err)
		}
	}
}
