package ops

import (
	"fmt"
	"io"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// ── Rendered-manifest assertions (OPS-05 / OPS-09) ───────────────────
//
// Some invariants only exist after templating. Two of them bit us:
//
//  1. SELECTOR OVERLAP. A Deployment selector is a SUPERSET match: a pod
//     carrying every selector label is adopted even if it carries extra
//     ones. A canary pod labelled with the common selector labels plus
//     `teslasync.io/rollout: canary` was therefore still matched by the
//     stable Deployment — and by its HPA (which reads pod metrics
//     through that selector) and its PDB. The stable set would scale on
//     canary CPU and count canary pods toward minAvailable.
//
//  2. DRAIN EXPOSURE. The preStop endpoint is one-way and pod-fatal, so
//     no Service or Ingress may route to its port.
//
// VerifyHelmRender consumes `helm template` output so CI can assert both
// across the default / canary / autoscaling variants.

// k8sObject is the subset of a rendered manifest these checks need.
type k8sObject struct {
	Kind     string `yaml:"kind"`
	Metadata struct {
		Name   string            `yaml:"name"`
		Labels map[string]string `yaml:"labels"`
	} `yaml:"metadata"`
	Spec struct {
		// Deployment / PDB
		Selector *struct {
			MatchLabels map[string]string `yaml:"matchLabels"`
		} `yaml:"selector"`
		Template *struct {
			Metadata struct {
				Labels map[string]string `yaml:"labels"`
			} `yaml:"metadata"`
			Spec struct {
				TerminationGracePeriodSeconds *int `yaml:"terminationGracePeriodSeconds"`
				Containers                    []struct {
					Name  string `yaml:"name"`
					Ports []struct {
						Name          string `yaml:"name"`
						ContainerPort int    `yaml:"containerPort"`
					} `yaml:"ports"`
					Lifecycle *struct {
						PreStop *struct {
							HTTPGet *struct {
								Path string `yaml:"path"`
								Port any    `yaml:"port"`
							} `yaml:"httpGet"`
							Exec *struct {
								Command []string `yaml:"command"`
							} `yaml:"exec"`
						} `yaml:"preStop"`
					} `yaml:"lifecycle"`
				} `yaml:"containers"`
			} `yaml:"spec"`
		} `yaml:"template"`
		// Service
		ServiceSelector map[string]string `yaml:"-"`
		Ports           []struct {
			Port       int    `yaml:"port"`
			TargetPort any    `yaml:"targetPort"`
			Name       string `yaml:"name"`
		} `yaml:"ports"`
		ScaleTargetRef *struct {
			Kind string `yaml:"kind"`
			Name string `yaml:"name"`
		} `yaml:"scaleTargetRef"`
	} `yaml:"spec"`

	// serviceSelector is decoded separately because a Service's
	// spec.selector is a flat map while a Deployment's is a mapping with
	// matchLabels; one struct cannot express both.
	serviceSelector map[string]string
}

// RenderExpectations parameterises VerifyHelmRender.
type RenderExpectations struct {
	// DrainPort must not be published by any Service.
	DrainPort int
	// MinGracePeriodSeconds is the shutdown budget the API pods must be
	// given. Zero disables the check (e.g. for a web-only render).
	MinGracePeriodSeconds int
	// RolloutLabel discriminates stable from canary.
	RolloutLabel string
	// PreStopCommand is the exact exec argv the api pods must use.
	PreStopCommand string
	// ExpectCanary asserts at least one canary workload was rendered.
	ExpectCanary bool
}

// DefaultRenderExpectations mirrors the chart defaults.
func DefaultRenderExpectations() RenderExpectations {
	return RenderExpectations{
		DrainPort:             8090,
		MinGracePeriodSeconds: 80,
		RolloutLabel:          "teslasync.io/rollout",
		PreStopCommand:        "/usr/local/bin/teslasync drain",
	}
}

// decodeRender parses a multi-document `helm template` stream.
func decodeRender(r io.Reader) ([]k8sObject, error) {
	dec := yaml.NewDecoder(r)
	var out []k8sObject
	for {
		var node yaml.Node
		err := dec.Decode(&node)
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("decode rendered manifest: %w", err)
		}
		if node.Kind == 0 {
			continue
		}
		var obj k8sObject
		if err := node.Decode(&obj); err != nil {
			// Some rendered docs (e.g. raw ConfigMap data blocks) do not
			// fit the struct; they carry nothing this check inspects.
			continue
		}
		if obj.Kind == "" {
			continue
		}
		if obj.Kind == "Service" {
			var svc struct {
				Spec struct {
					Selector map[string]string `yaml:"selector"`
				} `yaml:"spec"`
			}
			if err := node.Decode(&svc); err == nil {
				obj.serviceSelector = svc.Spec.Selector
			}
		}
		out = append(out, obj)
	}
	return out, nil
}

// selectorMatches reports whether every key/value in selector is present
// in labels — i.e. Kubernetes' superset match semantics.
func selectorMatches(selector, labels map[string]string) bool {
	if len(selector) == 0 {
		return false
	}
	for k, v := range selector {
		if labels[k] != v {
			return false
		}
	}
	return true
}

func sortedKeys(m map[string]string) string {
	parts := make([]string, 0, len(m))
	for k, v := range m {
		parts = append(parts, k+"="+v)
	}
	sort.Strings(parts)
	return strings.Join(parts, ",")
}

// VerifyHelmRender asserts the post-template invariants.
func VerifyHelmRender(r io.Reader, exp RenderExpectations) []Finding {
	const check = "helm-render"
	objs, err := decodeRender(r)
	if err != nil {
		return []Finding{errf(check, "render", "%v", err)}
	}
	if len(objs) == 0 {
		return []Finding{errf(check, "render", "no Kubernetes objects decoded; the render is empty or malformed")}
	}

	var out []Finding
	label := exp.RolloutLabel
	if label == "" {
		label = "teslasync.io/rollout"
	}

	type workload struct {
		name     string
		selector map[string]string
		labels   map[string]string
		tier     string
	}
	var deployments []workload
	canaryCount := 0

	for _, o := range objs {
		switch o.Kind {
		case "Deployment":
			if o.Spec.Selector == nil || o.Spec.Template == nil {
				continue
			}
			w := workload{
				name:     o.Metadata.Name,
				selector: o.Spec.Selector.MatchLabels,
				labels:   o.Spec.Template.Metadata.Labels,
				tier:     o.Spec.Template.Metadata.Labels[label],
			}
			deployments = append(deployments, w)
			if w.tier == "canary" {
				canaryCount++
			}
			out = append(out, verifyDeploymentPod(check, o, exp, label)...)

		case "Service":
			// A Service must NOT pin a rollout tier: replica-share
			// traffic splitting depends on it fronting both.
			if _, pinned := o.serviceSelector[label]; pinned {
				out = append(out, errf(check, o.Metadata.Name,
					"Service selector pins %s=%s; it must select BOTH tiers or the canary receives no traffic",
					label, o.serviceSelector[label]))
			}
			// …and it must never publish the drain port.
			for _, p := range o.Spec.Ports {
				if p.Port == exp.DrainPort || fmt.Sprint(p.TargetPort) == fmt.Sprint(exp.DrainPort) || fmt.Sprint(p.TargetPort) == "drain" {
					out = append(out, errf(check, o.Metadata.Name,
						"Service publishes the drain port (%v -> %v); the preStop endpoint is one-way and pod-fatal and must not be reachable through a Service",
						p.Port, p.TargetPort))
				}
			}

		case "PodDisruptionBudget":
			if o.Spec.Selector == nil {
				continue
			}
			if _, scoped := o.Spec.Selector.MatchLabels[label]; !scoped && canaryPresent(objs, label) {
				out = append(out, errf(check, o.Metadata.Name,
					"PodDisruptionBudget selector is not scoped to a rollout tier while a canary exists; it would count canary pods toward minAvailable"))
			}
		}
	}

	// Cross-check every stable/canary Deployment pair for selector
	// overlap in BOTH directions.
	for _, a := range deployments {
		for _, b := range deployments {
			if a.name == b.name {
				continue
			}
			if selectorMatches(a.selector, b.labels) {
				out = append(out, errf(check, a.name,
					"selector {%s} also matches the pods of %s {%s}; Kubernetes selectors are superset matches, so this Deployment (and its HPA/PDB) would adopt the other's pods",
					sortedKeys(a.selector), b.name, sortedKeys(b.labels)))
			}
		}
	}

	if exp.ExpectCanary && canaryCount == 0 {
		out = append(out, errf(check, "render", "expected a canary workload, none rendered"))
	}
	if !exp.ExpectCanary && canaryCount > 0 {
		out = append(out, errf(check, "render", "a canary workload rendered but none was expected"))
	}
	return out
}

func canaryPresent(objs []k8sObject, label string) bool {
	for _, o := range objs {
		if o.Kind == "Deployment" && o.Spec.Template != nil && o.Spec.Template.Metadata.Labels[label] == "canary" {
			return true
		}
	}
	return false
}

// verifyDeploymentPod checks the pod-level drain and grace contract.
func verifyDeploymentPod(check string, o k8sObject, exp RenderExpectations, label string) []Finding {
	var out []Finding
	component := o.Metadata.Labels["app.kubernetes.io/component"]
	if component != "api" {
		return out
	}
	pod := o.Spec.Template.Spec

	if exp.MinGracePeriodSeconds > 0 {
		switch {
		case pod.TerminationGracePeriodSeconds == nil:
			out = append(out, errf(check, o.Metadata.Name,
				"no terminationGracePeriodSeconds; Kubernetes defaults to 30s, which cannot hold the %ds shutdown budget",
				exp.MinGracePeriodSeconds))
		case *pod.TerminationGracePeriodSeconds < exp.MinGracePeriodSeconds:
			out = append(out, errf(check, o.Metadata.Name,
				"terminationGracePeriodSeconds=%d is below the %ds shutdown budget; the kubelet would SIGKILL mid-drain",
				*pod.TerminationGracePeriodSeconds, exp.MinGracePeriodSeconds))
		}
	}

	for _, c := range pod.Containers {
		// The drain port must never be advertised as a containerPort:
		// the listener binds to loopback, so declaring it would both
		// misrepresent the contract and invite someone to publish it.
		for _, p := range c.Ports {
			if p.ContainerPort == exp.DrainPort || p.Name == "drain" {
				out = append(out, errf(check, o.Metadata.Name,
					"container %q declares containerPort %d (%q); the drain listener is loopback-only and must not be advertised",
					c.Name, p.ContainerPort, p.Name))
			}
		}

		if c.Lifecycle == nil || c.Lifecycle.PreStop == nil {
			continue
		}
		hook := c.Lifecycle.PreStop
		// An httpGet preStop is dialled by the kubelet from OUTSIDE the
		// container against the pod IP, so it cannot reach a loopback
		// listener — and making it reachable means a wildcard bind,
		// which is the exposure this design removed.
		if hook.HTTPGet != nil {
			out = append(out, errf(check, o.Metadata.Name,
				"container %q uses an httpGet preStop hook (%s); kubelet dials that from outside the container, so it only works with a network-exposed drain listener. Use exec.",
				c.Name, hook.HTTPGet.Path))
			continue
		}
		if hook.Exec == nil || len(hook.Exec.Command) == 0 {
			out = append(out, errf(check, o.Metadata.Name,
				"container %q has a preStop hook with no exec command", c.Name))
			continue
		}
		if exp.PreStopCommand != "" && strings.Join(hook.Exec.Command, " ") != exp.PreStopCommand {
			out = append(out, errf(check, o.Metadata.Name,
				"container %q preStop exec is %q, want %q",
				c.Name, strings.Join(hook.Exec.Command, " "), exp.PreStopCommand))
		}
	}
	return out
}
