package ops

import (
	"fmt"
	"io/fs"
	"regexp"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// SupplyChainPolicyPath is the canonical location of the OPS-08 policy.
const SupplyChainPolicyPath = "ops/release/supply-chain.yaml"

// SupplyChainPolicy is the parsed ops/release/supply-chain.yaml.
type SupplyChainPolicy struct {
	Version                 int                   `yaml:"version"`
	PinnedWorkflows         []PinnedWorkflow      `yaml:"pinned_workflows"`
	GovernedImageLocations  []string              `yaml:"governed_image_locations"`
	FirstPartyPrefixes      []string              `yaml:"first_party_prefixes"`
	RequireVersionComment   bool                  `yaml:"require_version_comment"`
	DigestPinnedImages      bool                  `yaml:"digest_pinned_images"`
	RequiredReleaseSteps    []RequiredReleaseStep `yaml:"required_release_steps"`
	RequiredReleaseCommands []RequiredReleaseCmd  `yaml:"required_release_commands"`
	VulnerabilityPolicy     VulnerabilityPolicy   `yaml:"vulnerability_policy"`
	RequiredAttestations    []RequiredAttestation `yaml:"required_attestations"`
}

// PinnedWorkflow names a workflow whose action refs must be immutable.
type PinnedWorkflow struct {
	Path string   `yaml:"path"`
	Jobs []string `yaml:"jobs"`
}

// RequiredReleaseStep is an action that must appear in release.yml.
type RequiredReleaseStep struct {
	ID           string `yaml:"id"`
	ActionPrefix string `yaml:"action_prefix"`
	Purpose      string `yaml:"purpose"`
}

// RequiredReleaseCmd is a shell fragment that must appear in release.yml.
type RequiredReleaseCmd struct {
	ID       string `yaml:"id"`
	Contains string `yaml:"contains"`
	Purpose  string `yaml:"purpose"`
}

// VulnerabilityPolicy is the per-release scan policy.
type VulnerabilityPolicy struct {
	FailOn        []string        `yaml:"fail_on"`
	Report        []string        `yaml:"report"`
	IgnoreUnfixed bool            `yaml:"ignore_unfixed"`
	Exceptions    []VulnException `yaml:"exceptions"`
}

// VulnException is a time-boxed acknowledgement of a finding.
type VulnException struct {
	ID      string `yaml:"id"`
	Reason  string `yaml:"reason"`
	Expires string `yaml:"expires"`
}

// RequiredAttestation is an artifact a consumer must be able to verify.
type RequiredAttestation struct {
	Type   string `yaml:"type"`
	Verify string `yaml:"verify"`
}

// workflowRef is one `uses:` scalar plus its trailing version comment.
type workflowRef struct {
	Value   string
	Comment string
	Line    int
	Job     string
}

var (
	actionSHARe      = regexp.MustCompile(`^[a-f0-9]{40}$`)
	digestRe         = regexp.MustCompile(`@sha256:[a-f0-9]{64}$`)
	versionCommentRe = regexp.MustCompile(`^v?\d`)
)

// LoadSupplyChainPolicy reads the OPS-08 policy.
func LoadSupplyChainPolicy(fsys fs.FS, path string) (*SupplyChainPolicy, error) {
	var p SupplyChainPolicy
	if err := loadYAML(fsys, path, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func docContent(n *yaml.Node) *yaml.Node {
	if n != nil && n.Kind == yaml.DocumentNode && len(n.Content) == 1 {
		return n.Content[0]
	}
	return n
}

func mapValue(n *yaml.Node, key string) (*yaml.Node, bool) {
	n = docContent(n)
	if n == nil || n.Kind != yaml.MappingNode {
		return nil, false
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key {
			return n.Content[i+1], true
		}
	}
	return nil, false
}

func scalarRefFrom(node *yaml.Node, lines []string, job string) workflowRef {
	comment := strings.TrimSpace(strings.TrimPrefix(node.LineComment, "#"))
	if comment == "" && node.Line > 0 && node.Line <= len(lines) {
		if _, after, found := strings.Cut(lines[node.Line-1], "#"); found {
			comment = strings.TrimSpace(after)
		}
	}
	return workflowRef{Value: strings.TrimSpace(node.Value), Comment: comment, Line: node.Line, Job: job}
}

// WorkflowSurface is everything the supply-chain gate inspects in one
// workflow file.
type WorkflowSurface struct {
	Path      string
	Refs      []workflowRef
	RunBlocks []string
	// Images covers EVERY location a workflow can name a container it
	// pulls: root/job `env:` values, `jobs.*.container.image`,
	// `jobs.*.services.*.image`, and step `with:` inputs whose key ends
	// in `image` or `image-ref`. The first implementation only looked at
	// root `env:`, so a mutable `image: timescale/timescaledb-ha:pg17`
	// on a service container passed the "digest pinned" gate untouched.
	Images    []workflowRef
	KnownJobs map[string]bool
}

// imageInputKey reports whether a step `with:` input names a container
// image. Actions are inconsistent here (`image`, `image-ref`,
// `docker-image`), so match on the suffix rather than an allowlist.
func imageInputKey(key string) bool {
	k := strings.ToLower(key)
	return k == "image" || k == "image-ref" || strings.HasSuffix(k, "-image") || strings.HasSuffix(k, "-image-ref")
}

// looksLikeImageRef filters out values that are plainly not container
// references: workflow expressions (whose digest cannot exist until the
// build produces it), shell variables, and bare words with no registry
// path separator or tag.
func looksLikeImageRef(v string) bool {
	if v == "" || strings.Contains(v, "${{") || strings.HasPrefix(v, "$") {
		return false
	}
	return strings.Contains(v, "/") || strings.Contains(v, ":") || strings.Contains(v, "@")
}

// collectImageRefs walks a mapping node for image-bearing keys.
func collectImageRefs(node *yaml.Node, lines []string, label string) []workflowRef {
	var out []workflowRef
	node = docContent(node)
	if node == nil || node.Kind != yaml.MappingNode {
		return out
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		key, value := node.Content[i].Value, node.Content[i+1]
		if value.Kind != yaml.ScalarNode || !looksLikeImageRef(value.Value) {
			continue
		}
		if !imageInputKey(key) && !strings.HasSuffix(strings.ToUpper(key), "_IMAGE") && strings.ToUpper(key) != "IMAGE" {
			continue
		}
		ref := scalarRefFrom(value, lines, "")
		ref.Job = label + "." + key
		out = append(out, ref)
	}
	return out
}

// ParseWorkflowSurface extracts the action refs, run blocks, and every
// governed container image reference from a workflow.
func ParseWorkflowSurface(path, source string, jobs []string) (*WorkflowSurface, error) {
	var root yaml.Node
	if err := yaml.Unmarshal([]byte(source), &root); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	lines := strings.Split(source, "\n")
	surface := &WorkflowSurface{Path: path, KnownJobs: map[string]bool{}}

	// Root `env:` — scanner/tool images shared across jobs.
	if env, ok := mapValue(&root, "env"); ok && env.Kind == yaml.MappingNode {
		for i := 0; i+1 < len(env.Content); i += 2 {
			v := env.Content[i+1]
			if v.Kind != yaml.ScalarNode || !strings.Contains(v.Value, "/") {
				continue
			}
			// `${{ … }}` values are computed destination names for images
			// this workflow BUILDS and pushes. They cannot be
			// digest-pinned — the digest does not exist until the build
			// produces it. Only literal references, i.e. images this
			// workflow PULLS, are in scope for the immutability rule.
			if !looksLikeImageRef(v.Value) {
				continue
			}
			ref := scalarRefFrom(v, lines, "")
			ref.Job = "env." + env.Content[i].Value
			surface.Images = append(surface.Images, ref)
		}
	}

	jobsNode, ok := mapValue(&root, "jobs")
	if !ok || jobsNode.Kind != yaml.MappingNode {
		return surface, nil
	}
	want := setOf(jobs)
	for i := 0; i+1 < len(jobsNode.Content); i += 2 {
		name := jobsNode.Content[i].Value
		surface.KnownJobs[name] = true
		if len(want) > 0 && !want[name] {
			continue
		}
		job := jobsNode.Content[i+1]
		if uses, ok := mapValue(job, "uses"); ok && uses.Kind == yaml.ScalarNode {
			surface.Refs = append(surface.Refs, scalarRefFrom(uses, lines, name))
		}

		// Job-level `env:` may also carry a pulled image.
		if env, ok := mapValue(job, "env"); ok {
			surface.Images = append(surface.Images, collectImageRefs(env, lines, "jobs."+name+".env")...)
		}

		// `jobs.<id>.container` — scalar shorthand or a mapping.
		if container, ok := mapValue(job, "container"); ok {
			switch container.Kind {
			case yaml.ScalarNode:
				if looksLikeImageRef(container.Value) {
					ref := scalarRefFrom(container, lines, name)
					ref.Job = "jobs." + name + ".container"
					surface.Images = append(surface.Images, ref)
				}
			case yaml.MappingNode:
				surface.Images = append(surface.Images, collectImageRefs(container, lines, "jobs."+name+".container")...)
			}
		}

		// `jobs.<id>.services.<svc>.image` — the location that let a
		// mutable `timescale/timescaledb-ha:pg17` through unnoticed.
		if services, ok := mapValue(job, "services"); ok && services.Kind == yaml.MappingNode {
			for j := 0; j+1 < len(services.Content); j += 2 {
				svcName := services.Content[j].Value
				surface.Images = append(surface.Images,
					collectImageRefs(services.Content[j+1], lines, "jobs."+name+".services."+svcName)...)
			}
		}

		steps, ok := mapValue(job, "steps")
		if !ok || steps.Kind != yaml.SequenceNode {
			continue
		}
		for _, step := range steps.Content {
			if uses, ok := mapValue(step, "uses"); ok && uses.Kind == yaml.ScalarNode {
				surface.Refs = append(surface.Refs, scalarRefFrom(uses, lines, name))
			}
			if run, ok := mapValue(step, "run"); ok && run.Kind == yaml.ScalarNode {
				surface.RunBlocks = append(surface.RunBlocks, run.Value)
			}
			// Step `with:` image inputs, e.g. aquasecurity/trivy-action's
			// `image-ref`.
			if with, ok := mapValue(step, "with"); ok {
				surface.Images = append(surface.Images, collectImageRefs(with, lines, "jobs."+name+".steps.with")...)
			}
		}
	}
	return surface, nil
}

func (p *SupplyChainPolicy) firstParty(ref string) bool {
	for _, prefix := range p.FirstPartyPrefixes {
		if strings.HasPrefix(ref, prefix) {
			return true
		}
	}
	return false
}

// ValidateSupplyChainWorkflow checks one workflow surface against the policy.
func (p *SupplyChainPolicy) ValidateSupplyChainWorkflow(s *WorkflowSurface, declaredJobs []string) []Finding {
	const check = "supply-chain"
	var out []Finding

	for _, job := range declaredJobs {
		if !s.KnownJobs[job] {
			out = append(out, errf(check, s.Path, "policy references job %q which does not exist in the workflow", job))
		}
	}
	for _, ref := range s.Refs {
		if p.firstParty(ref.Value) {
			continue
		}
		subject := fmt.Sprintf("%s:%d", s.Path, ref.Line)
		_, sha, ok := strings.Cut(ref.Value, "@")
		if !ok || !actionSHARe.MatchString(sha) {
			out = append(out, errf(check, subject, "action %q is not pinned to a full 40-character commit SHA — a moved tag would silently change the release build", ref.Value))
		}
		if p.RequireVersionComment && !versionCommentRe.MatchString(ref.Comment) {
			out = append(out, errf(check, subject, "action %q has no trailing version comment (e.g. `# v4.2.2`), so the pin is unreviewable", ref.Value))
		}
	}
	if p.DigestPinnedImages {
		for _, img := range s.Images {
			if !digestRe.MatchString(img.Value) {
				out = append(out, errf(check, fmt.Sprintf("%s:%d", s.Path, img.Line),
					"%s = %q is not digest-pinned (@sha256:…); a moved tag would silently change what this workflow runs", img.Job, img.Value))
			}
		}
	}
	return out
}

// ValidateSupplyChain runs the whole OPS-08 policy.
func ValidateSupplyChain(fsys fs.FS, p *SupplyChainPolicy, now time.Time) []Finding {
	const check = "supply-chain"
	var out []Finding

	if p.Version != 1 {
		out = append(out, errf(check, SupplyChainPolicyPath, "unsupported policy version %d (want 1)", p.Version))
	}
	if !p.RequireVersionComment {
		out = append(out, errf(check, "require_version_comment", "must stay true — an unlabelled SHA pin cannot be reviewed or bumped safely"))
	}
	if !p.DigestPinnedImages {
		out = append(out, errf(check, "digest_pinned_images", "must stay true — a floating scanner tag can silently change results"))
	}
	if len(p.PinnedWorkflows) == 0 {
		out = append(out, errf(check, "pinned_workflows", "no workflow is covered by the immutability policy"))
	}

	var releaseSurface *WorkflowSurface
	for _, w := range p.PinnedWorkflows {
		raw, err := fs.ReadFile(fsys, w.Path)
		if err != nil {
			out = append(out, errf(check, w.Path, "%v", err))
			continue
		}
		surface, err := ParseWorkflowSurface(w.Path, string(raw), w.Jobs)
		if err != nil {
			out = append(out, errf(check, w.Path, "%v", err))
			continue
		}
		out = append(out, p.ValidateSupplyChainWorkflow(surface, w.Jobs)...)
		if strings.HasSuffix(w.Path, "release.yml") {
			releaseSurface = surface
		}
	}

	if releaseSurface == nil {
		out = append(out, errf(check, SupplyChainPolicyPath, "no release workflow covered by pinned_workflows"))
	} else {
		for _, step := range p.RequiredReleaseSteps {
			found := false
			for _, ref := range releaseSurface.Refs {
				if strings.HasPrefix(ref.Value, step.ActionPrefix) {
					found = true
					break
				}
			}
			if !found {
				out = append(out, errf(check, releaseSurface.Path, "required release step %q (%s) is missing: no step uses %s", step.ID, step.Purpose, step.ActionPrefix))
			}
		}
		joined := strings.Join(releaseSurface.RunBlocks, "\n")
		for _, cmd := range p.RequiredReleaseCommands {
			if !strings.Contains(joined, cmd.Contains) {
				out = append(out, errf(check, releaseSurface.Path, "required release command %q (%s) is missing: no run block contains %q", cmd.ID, cmd.Purpose, cmd.Contains))
			}
		}
	}

	if len(p.VulnerabilityPolicy.FailOn) == 0 {
		out = append(out, errf(check, "vulnerability_policy.fail_on", "a scan that can never fail is decoration"))
	}
	reportSet := setOf(p.VulnerabilityPolicy.Report)
	for _, sev := range p.VulnerabilityPolicy.FailOn {
		if !reportSet[sev] {
			out = append(out, errf(check, "vulnerability_policy", "severity %q fails the build but is not in the reported set", sev))
		}
	}
	for _, e := range p.VulnerabilityPolicy.Exceptions {
		subject := "vulnerability_policy.exceptions[" + e.ID + "]"
		if e.ID == "" || strings.TrimSpace(e.Reason) == "" {
			out = append(out, errf(check, "vulnerability_policy.exceptions[]", "every exception needs an id and a reason"))
			continue
		}
		expiry, err := time.Parse("2006-01-02", e.Expires)
		if err != nil {
			out = append(out, errf(check, subject, "expires %q must be an ISO date — exceptions must not be permanent", e.Expires))
			continue
		}
		if expiry.Before(now) {
			out = append(out, errf(check, subject, "exception expired on %s; re-review it or fix the finding", e.Expires))
		}
	}

	if len(p.RequiredAttestations) == 0 {
		out = append(out, errf(check, "required_attestations", "at least signature + SBOM + provenance must be required"))
	}
	attested := map[string]bool{}
	for _, a := range p.RequiredAttestations {
		if strings.TrimSpace(a.Verify) == "" {
			out = append(out, errf(check, "required_attestations["+a.Type+"]", "verify command is required so consumers can actually check it"))
		}
		attested[a.Type] = true
	}
	for _, must := range []string{"signature", "cyclonedx", "slsaprovenance"} {
		if !attested[must] {
			out = append(out, errf(check, "required_attestations", "missing mandatory attestation type %q", must))
		}
	}
	return out
}

// CheckSupplyChain loads and validates the OPS-08 policy.
func CheckSupplyChain(fsys fs.FS) []Finding {
	p, err := LoadSupplyChainPolicy(fsys, SupplyChainPolicyPath)
	if err != nil {
		return []Finding{errf("supply-chain", SupplyChainPolicyPath, "%v", err)}
	}
	return ValidateSupplyChain(fsys, p, time.Now())
}
