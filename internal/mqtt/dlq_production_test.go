package mqtt

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

// =============================================================================
// Production wiring tests
//
// Verify the configured ClientOptions has AutoAckDisabled=true
// (and the rest of the manual-ack/persistence settings from Decision #2).
// paho.Client does NOT expose its options post-construction, so the test
// inspects the *ClientOptions returned by the package-private
// productionPipelineOptions helper directly. paho's ClientOptions exports the
// AutoAckDisabled / CleanSession / KeepAlive / etc. fields, so this is a
// genuine value assertion, not a regex grep.
//
// Connection failure is wrapped with the broker URL so triage
// from a log line alone identifies which broker the operator should inspect.
// We force a connection failure by pointing at a closed local TCP port so the
// test runs offline (no test broker required).
//
// testcontainers / in-memory paho test broker — neither is
// available in this repo's go.mod. The tests therefore skip the
// connect-success path and rely on the options-inspection seam in #5(a) to
// verify the manual-ack contract holds at the wire level, plus the
// connection-failure path in #5(b) for the disconnect/wrap behavior.
// =============================================================================

// TestProductionPipelineOptions_ManualAckContract pins the manual-ack and
// persistence settings. This catches a future refactor accidentally dropping
// SetAutoAckDisabled(true) — without manual ack the PipelineSubscriber cannot
// guarantee process-or-quarantine ordering before PUBACK.
func TestProductionPipelineOptions_ManualAckContract(t *testing.T) {
	opts := productionPipelineOptions("tcp://broker.example:1883", "teslasync-pipeline-1", "u", "p")

	if !opts.AutoAckDisabled {
		t.Errorf("AutoAckDisabled = false, want true (manual-ack contract requires terminal disposition before PUBACK)")
	}
	if opts.CleanSession {
		t.Errorf("CleanSession = true, want false (broker-side queue must persist across reconnects)")
	}
	// SetKeepAlive stores its argument as int64 seconds.
	if got, want := opts.KeepAlive, int64(30); got != want {
		t.Errorf("KeepAlive = %d, want %d (seconds)", got, want)
	}
	if got, want := opts.PingTimeout, 10*time.Second; got != want {
		t.Errorf("PingTimeout = %s, want %s", got, want)
	}
	if got, want := opts.ConnectTimeout, 30*time.Second; got != want {
		t.Errorf("ConnectTimeout = %s, want %s", got, want)
	}
	if got, want := opts.MaxReconnectInterval, 30*time.Second; got != want {
		t.Errorf("MaxReconnectInterval = %s, want %s", got, want)
	}
	if opts.Order {
		t.Errorf("Order = true (SetOrderMatters), want false (writers are idempotent — concurrent fan-out is intentional)")
	}
	if !opts.AutoReconnect {
		t.Errorf("AutoReconnect = false, want true (transport failures must reconnect and resume the persistent queue)")
	}
	if got, want := opts.ClientID, "teslasync-pipeline-1"; got != want {
		t.Errorf("ClientID = %q, want %q", got, want)
	}
	if got, want := opts.Username, "u"; got != want {
		t.Errorf("Username = %q, want %q", got, want)
	}
	if got, want := opts.Password, "p"; got != want {
		t.Errorf("Password = %q, want %q", got, want)
	}
	if len(opts.Servers) != 1 || opts.Servers[0].String() != "tcp://broker.example:1883" {
		t.Errorf("Servers = %v, want [tcp://broker.example:1883]", opts.Servers)
	}
}

// TestProductionPipelineOptions_OmitsCredentialsWhenUsernameEmpty mirrors the
// legacy NewClient behavior of skipping SetUsername when the configured
// username is empty (avoiding an explicit empty-string credential on the
// CONNECT packet). Documents that empty username + non-empty password is
// treated as anonymous, matching legacy semantics.
func TestProductionPipelineOptions_OmitsCredentialsWhenUsernameEmpty(t *testing.T) {
	opts := productionPipelineOptions("tcp://broker.example:1883", "id", "", "ignored-when-no-username")
	if opts.Username != "" {
		t.Errorf("Username = %q, want empty (anonymous)", opts.Username)
	}
	if opts.Password != "" {
		t.Errorf("Password = %q, want empty (anonymous)", opts.Password)
	}
}

// TestNewProductionPipelineMQTT_RejectsEmptyArgs covers the three
// fail-fast guards before any network I/O.
func TestNewProductionPipelineMQTT_RejectsEmptyArgs(t *testing.T) {
	ctx := context.Background()
	log := zerolog.New(zerolog.NewTestWriter(t))

	cases := []struct {
		name         string
		brokerURL    string
		clientID     string
		dlqTopic     string
		wantContains string
	}{
		{"empty broker", "", "id", "tesla/dlq/test", "brokerURL must be non-empty"},
		{"whitespace broker", "   ", "id", "tesla/dlq/test", "brokerURL must be non-empty"},
		{"empty clientID", "tcp://broker:1883", "", "tesla/dlq/test", "clientID must be non-empty"},
		{"empty dlqTopic", "tcp://broker:1883", "id", "", "dlqTopic must be non-empty"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, dlq, err := NewProductionPipelineMQTT(ctx, tc.brokerURL, tc.clientID, "u", "p", tc.dlqTopic, log, nil, nil)
			if err == nil {
				t.Fatalf("err = nil, want non-nil")
			}
			if c != nil {
				t.Errorf("client = %v, want nil on validation failure", c)
			}
			if dlq != nil {
				t.Errorf("dlq = %v, want nil on validation failure", dlq)
			}
			if !strings.Contains(err.Error(), tc.wantContains) {
				t.Errorf("err = %q, want substring %q", err.Error(), tc.wantContains)
			}
		})
	}
}

// TestNewProductionPipelineMQTT_ConnectionFailureWrapped points at a closed
// local port to force connection refused, then asserts the returned error
// wraps the broker URL so an operator can identify
// which broker is unreachable from the log line alone. Also asserts that
// nothing leaks (returned client + dlq are nil). Runs offline — no real
// broker required.
func TestNewProductionPipelineMQTT_ConnectionFailureWrapped(t *testing.T) {
	// Bind to an ephemeral port and IMMEDIATELY close so the OS doesn't
	// reuse it for a stray socket. The address is now connect-refused.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()

	brokerURL := "tcp://" + addr

	// Bound the test wall-clock by passing a short ctx deadline. If paho
	// can't reach the broker in 5s the test fails fast rather than waiting
	// the full 30s default.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	log := zerolog.New(zerolog.NewTestWriter(t))
	c, dlq, err := NewProductionPipelineMQTT(ctx, brokerURL, "id", "", "", "tesla/dlq/test", log, nil, nil)

	if err == nil {
		// Defensive cleanup if paho somehow succeeded against the closed port.
		if c != nil {
			c.Disconnect(0)
		}
		t.Fatalf("err = nil, want connection failure against closed port %s", brokerURL)
	}
	if c != nil {
		t.Errorf("client = non-nil, want nil on connection failure (caller must not be expected to clean up)")
	}
	if dlq != nil {
		t.Errorf("dlq = non-nil, want nil on connection failure")
	}
	if !strings.Contains(err.Error(), brokerURL) {
		t.Errorf("err = %q, want substring %q (so triage logs show which broker)", err.Error(), brokerURL)
	}
	if !strings.Contains(err.Error(), "NewProductionPipelineMQTT") {
		t.Errorf("err = %q, want substring %q (so triage logs identify the call site)", err.Error(), "NewProductionPipelineMQTT")
	}
}

// TestNewProductionPipelineMQTT_ContextCancelledDuringConnect covers the
// shutdown-during-connect path. We cancel the ctx immediately
// so the select branches on ctx.Done() before token.Wait() has any chance
// to finish — the function MUST disconnect the client and return an error
// wrapping context.Canceled.
func TestNewProductionPipelineMQTT_ContextCancelledDuringConnect(t *testing.T) {
	// Use an unreachable address so the connect doesn't succeed before we
	// observe the cancel — TCP-blackhole IPs in the documentation range
	// (RFC 5737) won't route, so the dialer hangs.
	const brokerURL = "tcp://192.0.2.1:1883" // RFC 5737 TEST-NET-1

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel BEFORE the call so ctx.Done() is already closed

	log := zerolog.New(zerolog.NewTestWriter(t))
	c, dlq, err := NewProductionPipelineMQTT(ctx, brokerURL, "id", "", "", "tesla/dlq/test", log, nil, nil)

	if err == nil {
		if c != nil {
			c.Disconnect(0)
		}
		t.Fatalf("err = nil, want context.Canceled")
	}
	if c != nil {
		t.Errorf("client = non-nil, want nil on context cancellation")
	}
	if dlq != nil {
		t.Errorf("dlq = non-nil, want nil on context cancellation")
	}
	if !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
		// DeadlineExceeded is acceptable too: if a slow CI runner manages to
		// observe the deadline branch first the user-visible behaviour is
		// the same — the function bailed out without leaking.
		t.Errorf("err = %v, want errors.Is(_, context.Canceled)", err)
	}
	if !strings.Contains(err.Error(), brokerURL) {
		t.Errorf("err = %q, want substring %q", err.Error(), brokerURL)
	}
}
