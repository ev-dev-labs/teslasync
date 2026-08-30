package ops

import (
	"strings"
	"testing"
)

// ── Review finding 9: selector overlap ───────────────────────────────
//
// These fixtures are trimmed `helm template` output. The overlapping
// variant is the state the chart used to produce; the disjoint variant
// is what it produces now.

const overlappingRender = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rel-api
  labels:
    app.kubernetes.io/component: api
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: teslasync
      app.kubernetes.io/instance: rel
      app.kubernetes.io/component: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: teslasync
        app.kubernetes.io/instance: rel
        app.kubernetes.io/component: api
    spec:
      terminationGracePeriodSeconds: 90
      containers:
        - name: teslasync
          ports:
            - name: http
              containerPort: 8080
          lifecycle:
            preStop:
              exec:
                command: ["/usr/local/bin/teslasync", "drain"]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rel-api-canary
  labels:
    app.kubernetes.io/component: api
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: teslasync
      app.kubernetes.io/instance: rel
      app.kubernetes.io/component: api
      teslasync.io/rollout: canary
  template:
    metadata:
      labels:
        app.kubernetes.io/name: teslasync
        app.kubernetes.io/instance: rel
        app.kubernetes.io/component: api
        teslasync.io/rollout: canary
    spec:
      terminationGracePeriodSeconds: 90
      containers:
        - name: teslasync
          ports:
            - name: http
              containerPort: 8080
          lifecycle:
            preStop:
              exec:
                command: ["/usr/local/bin/teslasync", "drain"]
---
apiVersion: v1
kind: Service
metadata:
  name: rel-api
spec:
  ports:
    - port: 8080
      targetPort: http
      name: http
  selector:
    app.kubernetes.io/name: teslasync
    app.kubernetes.io/instance: rel
    app.kubernetes.io/component: api
`

const disjointRender = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rel-api
  labels:
    app.kubernetes.io/component: api
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: teslasync
      app.kubernetes.io/instance: rel
      teslasync.io/rollout: stable
      app.kubernetes.io/component: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: teslasync
        app.kubernetes.io/instance: rel
        teslasync.io/rollout: stable
        app.kubernetes.io/component: api
    spec:
      terminationGracePeriodSeconds: 90
      containers:
        - name: teslasync
          ports:
            - name: http
              containerPort: 8080
          lifecycle:
            preStop:
              exec:
                command: ["/usr/local/bin/teslasync", "drain"]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rel-api-canary
  labels:
    app.kubernetes.io/component: api
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: teslasync
      app.kubernetes.io/instance: rel
      app.kubernetes.io/component: api
      teslasync.io/rollout: canary
  template:
    metadata:
      labels:
        app.kubernetes.io/name: teslasync
        app.kubernetes.io/instance: rel
        app.kubernetes.io/component: api
        teslasync.io/rollout: canary
    spec:
      terminationGracePeriodSeconds: 90
      containers:
        - name: teslasync
          ports:
            - name: http
              containerPort: 8080
          lifecycle:
            preStop:
              exec:
                command: ["/usr/local/bin/teslasync", "drain"]
---
apiVersion: v1
kind: Service
metadata:
  name: rel-api
spec:
  ports:
    - port: 8080
      targetPort: http
      name: http
  selector:
    app.kubernetes.io/name: teslasync
    app.kubernetes.io/instance: rel
    app.kubernetes.io/component: api
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: rel
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: teslasync
      app.kubernetes.io/instance: rel
      teslasync.io/rollout: stable
      app.kubernetes.io/component: api
`

func renderExp() RenderExpectations {
	exp := DefaultRenderExpectations()
	exp.ExpectCanary = true
	return exp
}

// TestVerifyHelmRender_CatchesSelectorOverlap is the negative control:
// without it, the checker could be passing vacuously.
func TestVerifyHelmRender_CatchesSelectorOverlap(t *testing.T) {
	res := &Result{}
	res.Add(VerifyHelmRender(strings.NewReader(overlappingRender), renderExp())...)

	if res.OK() {
		t.Fatal("the overlapping render was accepted; a stable Deployment whose selector also matches canary pods is exactly the defect this check exists for")
	}
	if !hasMessage(res.Findings, "also matches the pods of rel-api-canary") {
		t.Fatalf("overlap not reported: %+v", res.Findings)
	}
	if !hasMessage(res.Findings, "superset matches") {
		t.Fatalf("the finding does not explain the mechanism: %+v", res.Findings)
	}
}

func TestVerifyHelmRender_AcceptsDisjointSelectors(t *testing.T) {
	res := &Result{}
	res.Add(VerifyHelmRender(strings.NewReader(disjointRender), renderExp())...)
	if !res.OK() {
		t.Fatalf("a correctly disjoint render was rejected: %+v", res.Errors())
	}
}

// TestVerifyHelmRender_ServiceMustSelectBothTiers: pinning the Service
// to `stable` would silently starve the canary of traffic, making the
// whole canary stage meaningless.
func TestVerifyHelmRender_ServiceMustSelectBothTiers(t *testing.T) {
	pinned := strings.Replace(disjointRender, `  selector:
    app.kubernetes.io/name: teslasync
    app.kubernetes.io/instance: rel
    app.kubernetes.io/component: api`, `  selector:
    app.kubernetes.io/name: teslasync
    app.kubernetes.io/instance: rel
    app.kubernetes.io/component: api
    teslasync.io/rollout: stable`, 1)

	res := &Result{}
	res.Add(VerifyHelmRender(strings.NewReader(pinned), renderExp())...)
	if !hasMessage(res.Findings, "must select BOTH tiers") {
		t.Fatalf("a tier-pinned Service was accepted: %+v", res.Findings)
	}
}

// TestVerifyHelmRender_ServiceMustNotPublishTheDrainPort is the
// review-finding-2 render-level assertion.
func TestVerifyHelmRender_ServiceMustNotPublishTheDrainPort(t *testing.T) {
	exposed := strings.Replace(disjointRender, `    - port: 8080
      targetPort: http
      name: http`, `    - port: 8080
      targetPort: http
      name: http
    - port: 8090
      targetPort: drain
      name: drain`, 1)

	res := &Result{}
	res.Add(VerifyHelmRender(strings.NewReader(exposed), renderExp())...)
	if !hasMessage(res.Findings, "Service publishes the drain port") {
		t.Fatalf("a Service publishing the drain port was accepted: %+v", res.Findings)
	}
}

// ── Grace period + preStop contract ──────────────────────────────────

func TestVerifyHelmRender_RejectsUndersizedGracePeriod(t *testing.T) {
	short := strings.ReplaceAll(disjointRender, "terminationGracePeriodSeconds: 90", "terminationGracePeriodSeconds: 30")
	res := &Result{}
	res.Add(VerifyHelmRender(strings.NewReader(short), renderExp())...)
	if !hasMessage(res.Findings, "below the 80s shutdown budget") {
		t.Fatalf("a 30s grace period was accepted: %+v", res.Findings)
	}
}

func TestVerifyHelmRender_RejectsMissingGracePeriod(t *testing.T) {
	none := strings.ReplaceAll(disjointRender, "      terminationGracePeriodSeconds: 90\n", "")
	res := &Result{}
	res.Add(VerifyHelmRender(strings.NewReader(none), renderExp())...)
	if !hasMessage(res.Findings, "Kubernetes defaults to 30s") {
		t.Fatalf("an absent grace period was accepted: %+v", res.Findings)
	}
}

// TestVerifyHelmRender_RejectsHTTPGetPreStop is the review-finding-4
// regression. The drain listener now binds to 127.0.0.1, and kubelet
// dials httpGet probes from OUTSIDE the container against the pod IP —
// so an httpGet hook can only work if the listener is exposed on the pod
// network, which is exactly the exposure that was removed.
func TestVerifyHelmRender_RejectsHTTPGetPreStop(t *testing.T) {
	httpGetHook := strings.ReplaceAll(disjointRender, `          lifecycle:
            preStop:
              exec:
                command: ["/usr/local/bin/teslasync", "drain"]`, `          lifecycle:
            preStop:
              httpGet:
                path: /internal/flush
                port: drain`)

	res := &Result{}
	res.Add(VerifyHelmRender(strings.NewReader(httpGetHook), renderExp())...)
	if !hasMessage(res.Findings, "kubelet dials that from outside the container") {
		t.Fatalf("an httpGet preStop hook was accepted: %+v", res.Findings)
	}
}

// TestVerifyHelmRender_RejectsAdvertisedDrainPort: a loopback-only
// listener must not be declared as a containerPort — doing so both
// misrepresents the contract and invites someone to publish it.
func TestVerifyHelmRender_RejectsAdvertisedDrainPort(t *testing.T) {
	advertised := strings.ReplaceAll(disjointRender, `          ports:
            - name: http
              containerPort: 8080`, `          ports:
            - name: http
              containerPort: 8080
            - name: drain
              containerPort: 8090`)

	res := &Result{}
	res.Add(VerifyHelmRender(strings.NewReader(advertised), renderExp())...)
	if !hasMessage(res.Findings, "loopback-only and must not be advertised") {
		t.Fatalf("an advertised drain containerPort was accepted: %+v", res.Findings)
	}
}

// TestVerifyHelmRender_RejectsWrongPreStopCommand catches a hook that
// execs something other than the drain subcommand.
func TestVerifyHelmRender_RejectsWrongPreStopCommand(t *testing.T) {
	wrong := strings.ReplaceAll(disjointRender,
		`command: ["/usr/local/bin/teslasync", "drain"]`,
		`command: ["/bin/sh", "-c", "sleep 5"]`)

	res := &Result{}
	res.Add(VerifyHelmRender(strings.NewReader(wrong), renderExp())...)
	if !hasMessage(res.Findings, "preStop exec is") {
		t.Fatalf("a wrong preStop command was accepted: %+v", res.Findings)
	}
}

// ── PDB scoping ──────────────────────────────────────────────────────

func TestVerifyHelmRender_RejectsUnscopedPDBWhenCanaryExists(t *testing.T) {
	unscoped := strings.Replace(disjointRender, `  selector:
    matchLabels:
      app.kubernetes.io/name: teslasync
      app.kubernetes.io/instance: rel
      teslasync.io/rollout: stable
      app.kubernetes.io/component: api
`, `  selector:
    matchLabels:
      app.kubernetes.io/name: teslasync
      app.kubernetes.io/instance: rel
      app.kubernetes.io/component: api
`, 1)
	// The replace above hits the Deployment first; do it on the PDB by
	// operating on the tail of the document instead.
	idx := strings.Index(disjointRender, "kind: PodDisruptionBudget")
	pdbUnscoped := disjointRender[:idx] + strings.ReplaceAll(disjointRender[idx:], "      teslasync.io/rollout: stable\n", "")
	_ = unscoped

	res := &Result{}
	res.Add(VerifyHelmRender(strings.NewReader(pdbUnscoped), renderExp())...)
	if !hasMessage(res.Findings, "count canary pods toward minAvailable") {
		t.Fatalf("an unscoped PDB was accepted while a canary exists: %+v", res.Findings)
	}
}

// ── Expectation plumbing ─────────────────────────────────────────────

func TestVerifyHelmRender_CanaryExpectationIsTwoWay(t *testing.T) {
	exp := DefaultRenderExpectations()
	exp.ExpectCanary = true
	res := &Result{}
	res.Add(VerifyHelmRender(strings.NewReader(stableOnlyRender), exp)...)
	if !hasMessage(res.Findings, "expected a canary workload") {
		t.Fatalf("a missing canary was accepted: %+v", res.Findings)
	}

	exp.ExpectCanary = false
	res = &Result{}
	res.Add(VerifyHelmRender(strings.NewReader(disjointRender), exp)...)
	if !hasMessage(res.Findings, "canary workload rendered but none was expected") {
		t.Fatalf("an unexpected canary was accepted: %+v", res.Findings)
	}
}

func TestVerifyHelmRender_RejectsEmptyRender(t *testing.T) {
	res := &Result{}
	res.Add(VerifyHelmRender(strings.NewReader("# just a comment\n"), DefaultRenderExpectations())...)
	if res.OK() {
		t.Fatal("an empty render must not pass; it would make every assertion vacuous")
	}
}

var stableOnlyRender = disjointRender[:strings.Index(disjointRender, "---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: rel-api-canary")] +
	disjointRender[strings.Index(disjointRender, "---\napiVersion: v1\nkind: Service"):]

func TestSelectorMatches(t *testing.T) {
	labels := map[string]string{"a": "1", "b": "2", "c": "3"}
	if !selectorMatches(map[string]string{"a": "1", "b": "2"}, labels) {
		t.Error("a subset selector must match (Kubernetes superset semantics)")
	}
	if selectorMatches(map[string]string{"a": "1", "z": "9"}, labels) {
		t.Error("a selector with an unmatched key must not match")
	}
	if selectorMatches(map[string]string{}, labels) {
		t.Error("an empty selector must not be treated as matching everything")
	}
}
