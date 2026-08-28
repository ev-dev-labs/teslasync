package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"
)

// ── `teslasync drain` — the Kubernetes preStop hook ──────────────────
//
// The drain listener binds to 127.0.0.1 so that nothing on the pod
// network can reach a one-way, pod-fatal endpoint. That rules out a
// preStop `httpGet`, which kubelet dials from OUTSIDE the container
// (against the pod IP), so the hook has to run INSIDE the container
// instead — `lifecycle.preStop.exec`.
//
// The runtime image is distroless (no shell, no curl, no wget), so the
// hook re-execs this same binary with a subcommand rather than shipping
// another one. `exec` takes an argv, not a shell command line, so no
// shell is required.
//
//	lifecycle:
//	  preStop:
//	    exec:
//	      command: ["/usr/local/bin/teslasync", "drain"]
//
// Exit codes: 0 drained, 1 failed. A non-zero preStop is logged by the
// kubelet as a FailedPreStopHook event and termination continues — which
// is the correct trade-off: we would rather lose the graceful drain than
// block a pod from ever terminating.

// drainRequestTimeout must exceed the endpoint-propagation delay the
// handler deliberately sleeps for (5s), or the hook would time out on
// its own success.
const drainRequestTimeout = 30 * time.Second

func drain() int {
	port := os.Getenv("TESLASYNC_DRAIN_PORT")
	if port == "" {
		port = "8090"
	}
	if _, err := strconv.Atoi(port); err != nil {
		fmt.Fprintf(os.Stderr, "drain: TESLASYNC_DRAIN_PORT=%q is not a port number\n", port)
		return 1
	}

	// 127.0.0.1 on purpose: this process runs inside the same network
	// namespace as the listener, and the listener is bound to loopback
	// so nothing outside the pod can reach it.
	url := "http://127.0.0.1:" + port + "/internal/flush"

	ctx, cancel := context.WithTimeout(context.Background(), drainRequestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "drain: build request: %v\n", err)
		return 1
	}
	resp, err := (&http.Client{Timeout: drainRequestTimeout}).Do(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "drain: %v\n", err)
		return 1
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "drain: %s returned %d: %s\n", url, resp.StatusCode, body)
		return 1
	}
	fmt.Printf("drain: %s\n", body)
	return 0
}
