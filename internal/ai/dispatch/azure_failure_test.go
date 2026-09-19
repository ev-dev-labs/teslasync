package dispatch

import (
	"context"
	"errors"
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

func TestAzureDispatchDoesNotReplayFinalProtocolFailures(t *testing.T) {
	for _, protocol := range []string{provider.FoundryProtocolAuto, provider.FoundryProtocolChat, provider.FoundryProtocolResponses} {
		for _, status := range []int{400, 401, 403, 404, 429, 500} {
			t.Run(fmt.Sprintf("%s/%d", protocol, status), func(t *testing.T) {
				var attempts atomic.Int32
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					attempts.Add(1)
					w.WriteHeader(status)
					_, _ = io.WriteString(w, `{"error":{"code":"DeploymentNotFound","message":"test failure"}}`)
				}))
				defer srv.Close()
				a, err := azure.New(provider.ProviderConfig{BaseURL: srv.URL, Model: "any", APIKey: "k", APIProtocol: protocol})
				if err != nil {
					t.Fatal(err)
				}
				d := New(tools.NewRegistry(), a, nil, 3)
				w := NewCaptureWriter()
				err = d.Run(context.Background(), fakeStrategy{}, strategy.StrategyInput{LastMessage: "hi"}, w)
				if err == nil {
					t.Fatal("failed provider returned success")
				}
				wantAttempts := int32(1)
				if protocol == provider.FoundryProtocolAuto && status == 404 {
					wantAttempts = 2
					if !strings.Contains(err.Error(), "azure stream status 404") || !strings.Contains(err.Error(), "azure responses status 404") {
						t.Fatalf("lost operation errors: %v", err)
					}
				}
				if !errors.Is(err, provider.ErrUpstream) || attempts.Load() != wantAttempts || w.RunError() == nil {
					t.Fatalf("attempts=%d want=%d err=%v", attempts.Load(), wantAttempts, err)
				}
			})
		}
	}
}
