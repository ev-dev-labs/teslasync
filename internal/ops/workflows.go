package ops

import (
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// WorkflowPolicyPath is the canonical location of the workflow-semantics
// policy.
const WorkflowPolicyPath = "ops/workflows/policy.yaml"

// WorkflowPolicy governs the CI workflows this repository owns.
//
// Two classes of defect motivated it, both of which a YAML linter and a
// human reviewer had already walked past:
//
//  1. Script injection. `run: … ${{ inputs.version }} …` splices an
//     attacker-influenced string straight into a shell that also holds
//     deployment secrets. The fix is always the same — pass it through
//     `env:` and reference `"$VERSION"` — and it is mechanically
//     checkable.
//
//  2. Implicit `success()`. A job with `needs:` and a custom `if:` still
//     carries an *implicit* `success()` on its dependencies. A rollback
//     job gated on `inputs.confirm == 'ROLLBACK'` and needing an
//     evaluator that deliberately exits non-zero for a rollback verdict
//     is therefore skipped precisely when it is needed.
type WorkflowPolicy struct {
	Version              int                       `yaml:"version"`
	Workflows            []string                  `yaml:"workflows"`
	UntrustedContexts    []string                  `yaml:"untrusted_contexts"`
	TrustedExpressions   []string                  `yaml:"trusted_expressions"`
	JobOutputContexts    []string                  `yaml:"job_output_contexts"`
	RequireStatusFunctio bool                      `yaml:"require_status_function_on_conditional_needs"`
	PublishGates         []PublishGatePolicy       `yaml:"publish_gates"`
	ArtifactPromotions   []ArtifactPromotionPolicy `yaml:"artifact_promotion"`
}

// ArtifactPromotionPolicy asserts that the bytes a release publishes are
// the exact bytes a scan assessed.
//
// The defect it exists to catch: `build-scan` built with
// `push: false, load: true` and scanned the result, then the `docker`
// job independently RE-BUILT the same Dockerfile with `push: true`.
// Ordering was correct and the gate passed, but two builds are not one
// artifact — an unpinned base tag (`FROM alpine:3.20`), an evicted cache
// entry, or any non-reproducible layer makes the published image differ
// from the assessed one. The cosign signature and the SLSA provenance
// would then describe bytes nobody scanned, which is worse than no
// attestation at all because it reads as assurance.
//
// The enforceable shape: build once, export a docker-archive, scan the
// archive, upload it, and have the publish job download and `crane push`
// that same archive — never invoking a build action at all.
type ArtifactPromotionPolicy struct {
	Workflow string `yaml:"workflow"`
	// ScanJob builds the artifact and must not push it anywhere.
	ScanJob string `yaml:"scan_job"`
	// PublishJobs promote the retained artifact and must not rebuild.
	PublishJobs []string `yaml:"publish_jobs"`
	// BuildActions are the `uses:` prefixes that produce an image.
	BuildActions []string `yaml:"build_actions"`
	// UploadAction / DownloadAction carry the artifact between jobs.
	UploadAction   string `yaml:"upload_action"`
	DownloadAction string `yaml:"download_action"`
	// ArtifactPrefix must appear in both the upload and the download
	// `with.name`, so the two halves provably refer to one artifact.
	ArtifactPrefix string `yaml:"artifact_prefix"`
	// IsolationTokens must all appear in the artifact name so parallel
	// matrix legs cannot collide (e.g. the image name and the version).
	IsolationTokens []string `yaml:"isolation_tokens"`
	// ContinuityMarker is the string the publish job must emit when it
	// compares the scanned digest to the pushed digest.
	ContinuityMarker string `yaml:"continuity_marker"`
	// PushCommands are the registry-mutating commands. Forbidden in the
	// scan job, required in a publish job.
	PushCommands []string `yaml:"push_commands"`
	Rationale    string   `yaml:"rationale"`
}

// PublishGatePolicy asserts that every job with a public, persistent
// side effect transitively depends on a gate job.
//
// The defect it exists to catch: the release workflow pushed :version
// AND :latest, signed, attested, and published the Helm chart — and only
// then ran the vulnerability report, which could block nothing but the
// release notes. A fixable CRITICAL still reached every consumer
// pulling :latest. A gate that runs after the thing it gates is
// decoration.
type PublishGatePolicy struct {
	Workflow string `yaml:"workflow"`
	// GateJob must appear in each publish job's transitive `needs`.
	GateJob string `yaml:"gate_job"`
	// PublishJobs are the jobs that create public or persistent
	// artifacts: image tags, chart versions, git tags, releases.
	PublishJobs []string `yaml:"publish_jobs"`
	Rationale   string   `yaml:"rationale"`
}

// statusFunctions are the GitHub Actions job-status check functions. The
// presence of any one of them makes the dependency semantics explicit.
var statusFunctions = []string{"always()", "success()", "failure()", "cancelled()"}

var expressionRe = regexp.MustCompile(`\$\{\{([^}]*)\}\}`)

// LoadWorkflowPolicy reads the workflow policy.
func LoadWorkflowPolicy(fsys fs.FS, path string) (*WorkflowPolicy, error) {
	var p WorkflowPolicy
	if err := loadYAML(fsys, path, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// workflowJob is the subset of a job the semantics checks need.
type workflowJob struct {
	Name      string
	If        string
	HasIf     bool
	Needs     []string
	Line      int
	RunBlocks []workflowRunBlock
	Steps     []workflowStep
}

// workflowRunBlock is one `run:` script plus the env keys in scope for
// it (step-level and job-level), so the checker can tell "interpolated
// into the script" from "passed safely through env".
type workflowRunBlock struct {
	Script string
	Line   int
	Step   string
}

// workflowStep is an action invocation. `run:`-only steps appear here
// too (with an empty Uses) so a checker can reason about ordering.
//
// The artifact-promotion gate needs `with:` because the whole question
// — "can the scan job push?" — lives in `with.push`, which the previous
// text-only parser could not see.
type workflowStep struct {
	Name string
	Uses string
	Run  string
	With map[string]string
	Line int
}

// usesAction reports whether the step invokes one of the given action
// prefixes, ignoring the `@sha` pin.
func (s workflowStep) usesAction(prefixes ...string) bool {
	if s.Uses == "" {
		return false
	}
	ref := s.Uses
	if i := strings.Index(ref, "@"); i >= 0 {
		ref = ref[:i]
	}
	for _, p := range prefixes {
		if ref == p || strings.HasPrefix(ref, p+"/") {
			return true
		}
	}
	return false
}

// truthy interprets an Actions `with:` value. Actions coerces the string
// "true" and the boolean true identically; everything else is false.
func truthy(v string) bool {
	return strings.EqualFold(strings.TrimSpace(v), "true")
}

// ParseWorkflowJobs extracts job-level semantics, every run block, and
// every step's `uses`/`with`.
func ParseWorkflowJobs(source string) ([]workflowJob, error) {
	var root yaml.Node
	if err := yaml.Unmarshal([]byte(source), &root); err != nil {
		return nil, err
	}
	jobsNode, ok := mapValue(&root, "jobs")
	if !ok || jobsNode.Kind != yaml.MappingNode {
		return nil, nil
	}

	var out []workflowJob
	for i := 0; i+1 < len(jobsNode.Content); i += 2 {
		nameNode, jobNode := jobsNode.Content[i], jobsNode.Content[i+1]
		job := workflowJob{Name: nameNode.Value, Line: nameNode.Line}

		if ifNode, ok := mapValue(jobNode, "if"); ok && ifNode.Kind == yaml.ScalarNode {
			job.If, job.HasIf = ifNode.Value, true
		}
		if needsNode, ok := mapValue(jobNode, "needs"); ok {
			switch needsNode.Kind {
			case yaml.ScalarNode:
				job.Needs = []string{needsNode.Value}
			case yaml.SequenceNode:
				for _, n := range needsNode.Content {
					job.Needs = append(job.Needs, n.Value)
				}
			}
		}
		if steps, ok := mapValue(jobNode, "steps"); ok && steps.Kind == yaml.SequenceNode {
			for _, step := range steps.Content {
				parsed := workflowStep{Line: step.Line}
				if n, ok := mapValue(step, "name"); ok && n.Kind == yaml.ScalarNode {
					parsed.Name = n.Value
				}
				if u, ok := mapValue(step, "uses"); ok && u.Kind == yaml.ScalarNode {
					parsed.Uses = u.Value
				}
				if w, ok := mapValue(step, "with"); ok && w.Kind == yaml.MappingNode {
					parsed.With = map[string]string{}
					for j := 0; j+1 < len(w.Content); j += 2 {
						parsed.With[w.Content[j].Value] = w.Content[j+1].Value
					}
				}
				if run, ok := mapValue(step, "run"); ok && run.Kind == yaml.ScalarNode {
					parsed.Run = run.Value
					job.RunBlocks = append(job.RunBlocks, workflowRunBlock{
						Script: run.Value,
						Line:   run.Line,
						Step:   parsed.Name,
					})
				}
				job.Steps = append(job.Steps, parsed)
			}
		}
		out = append(out, job)
	}
	return out, nil
}

func hasStatusFunction(expr string) bool {
	for _, fn := range statusFunctions {
		if strings.Contains(expr, fn) {
			return true
		}
	}
	return false
}

// isUntrusted reports whether an expression body touches a context an
// external or semi-trusted party can influence.
func (p *WorkflowPolicy) isUntrusted(expr string) (string, bool) {
	normalised := strings.ToLower(strings.Join(strings.Fields(expr), ""))
	for _, trusted := range p.TrustedExpressions {
		if normalised == strings.ToLower(strings.Join(strings.Fields(trusted), "")) {
			return "", false
		}
	}
	for _, ctx := range p.UntrustedContexts {
		if strings.Contains(normalised, strings.ToLower(ctx)) {
			return ctx, true
		}
	}
	return "", false
}

// isJobOutput reports whether an expression body reads a job or step
// output. These are not attacker-controlled the way `inputs.` is, but
// they are *data* — and data spliced into script text is re-parsed by
// the shell.
func (p *WorkflowPolicy) isJobOutput(expr string) (string, bool) {
	normalised := strings.ToLower(strings.Join(strings.Fields(expr), ""))
	for _, trusted := range p.TrustedExpressions {
		if normalised == strings.ToLower(strings.Join(strings.Fields(trusted), "")) {
			return "", false
		}
	}
	for _, ctx := range p.JobOutputContexts {
		if strings.HasPrefix(normalised, strings.ToLower(ctx)) {
			return ctx, true
		}
	}
	return "", false
}

// ValidateWorkflowSemantics runs both checks over one workflow.
func ValidateWorkflowSemantics(p *WorkflowPolicy, path, source string) []Finding {
	const check = "workflows"
	var out []Finding

	jobs, err := ParseWorkflowJobs(source)
	if err != nil {
		return []Finding{errf(check, path, "parse: %v", err)}
	}

	for _, job := range jobs {
		subject := fmt.Sprintf("%s:%s", path, job.Name)

		// ── Implicit success() on conditional, dependent jobs ────────
		if p.RequireStatusFunctio && job.HasIf && len(job.Needs) > 0 && !hasStatusFunction(job.If) {
			out = append(out, errf(check, subject,
				"job has `needs: %s` and a custom `if:` with no status function; GitHub then applies an IMPLICIT success(), so the job is skipped whenever a dependency fails — add always() or !cancelled() (and keep !cancelled() if a cancelled run must not proceed)",
				strings.Join(job.Needs, ", ")))
		}

		// ── Untrusted input interpolated into a shell script ─────────
		for _, block := range job.RunBlocks {
			label := block.Step
			if label == "" {
				label = fmt.Sprintf("line %d", block.Line)
			}
			for _, m := range expressionRe.FindAllStringSubmatch(block.Script, -1) {
				body := strings.TrimSpace(m[1])
				if ctx, bad := p.isUntrusted(body); bad {
					out = append(out, errf(check, subject,
						"step %q interpolates untrusted %s directly into a `run:` script (`${{ %s }}`); the script also holds secrets, so a crafted value executes as shell. Pass it through `env:` and reference a quoted \"$VAR\" instead",
						label, ctx, body))
					continue
				}
				// ── Job/step output spliced into script text ─────────
				//
				// Distinct failure mode from injection: nobody
				// attacks it, the DATA itself breaks. The release
				// notes interpolated a vulnerability summary whose
				// Markdown wrapped image names in BACKTICKS; bash
				// read them as command substitution, ran `api` as a
				// command, substituted an empty string, and exited
				// 0 — publishing a security table with blank image
				// cells and no failure anywhere.
				//
				// `set -euo pipefail` does not help: the
				// substitution "succeeded". Only env indirection
				// does, because bash never re-scans the result of a
				// parameter expansion.
				if ctx, bad := p.isJobOutput(body); bad {
					out = append(out, errf(check, subject,
						"step %q splices %s output `${{ %s }}` into `run:` script TEXT; the shell then re-parses that data — backticks, $(…) and ; in a generated summary become commands (a Markdown vulnerability table published blank image cells this way while exiting 0). Pass it through `env:` and expand \"$VAR\"; `set -euo pipefail` does not neutralise it",
						label, ctx, body))
				}
			}
		}
	}
	return out
}

// ValidateArtifactPromotion asserts scan-to-publish artifact continuity.
//
// Job ordering alone is not enough: the previous release workflow had
// perfect ordering and still published bytes that were never scanned,
// because the publish job rebuilt the image from source instead of
// promoting the assessed artifact.
func ValidateArtifactPromotion(p ArtifactPromotionPolicy, source string) []Finding {
	const check = "workflows"
	var out []Finding
	fail := func(subject, format string, args ...any) {
		out = append(out, errf(check, subject, format, args...))
	}

	parsed, err := ParseWorkflowJobs(source)
	if err != nil {
		return []Finding{errf(check, p.Workflow, "parse: %v", err)}
	}
	jobs := make(map[string]workflowJob, len(parsed))
	for _, j := range parsed {
		jobs[j.Name] = j
	}

	if len(p.BuildActions) == 0 {
		fail(p.Workflow, "artifact_promotion entry lists no build_actions; nothing would be recognised as a build")
		return out
	}
	if p.ContinuityMarker == "" {
		fail(p.Workflow, "artifact_promotion entry has no continuity_marker; the digest comparison would be unverifiable")
		return out
	}

	scan, ok := jobs[p.ScanJob]
	if !ok {
		fail(p.Workflow, "scan_job %q does not exist in the workflow", p.ScanJob)
		return out
	}
	scanSubject := p.Workflow + ":" + p.ScanJob

	// ── The scan job must build, and must not push ───────────────────
	var builds []workflowStep
	for _, s := range scan.Steps {
		if s.usesAction(p.BuildActions...) {
			builds = append(builds, s)
		}
	}
	if len(builds) == 0 {
		fail(scanSubject, "scan job invokes none of %s, so there is no artifact to promote", strings.Join(p.BuildActions, ", "))
	}
	for _, s := range builds {
		if truthy(s.With["push"]) {
			fail(scanSubject,
				"build step %q sets `with.push: %s` — the scan job would publish to the registry BEFORE the vulnerability verdict, which is the public side effect the gate exists to prevent",
				s.Name, s.With["push"])
		}
		if s.With["outputs"] == "" && !truthy(s.With["load"]) {
			fail(scanSubject,
				"build step %q neither exports an artifact (`with.outputs: type=docker,dest=…`) nor loads it; the scanned bytes would not be retainable and the publish job would have to rebuild",
				s.Name)
		}
	}
	for _, b := range scan.RunBlocks {
		for _, cmd := range p.PushCommands {
			if strings.Contains(b.Script, cmd) {
				fail(scanSubject, "scan step %q runs %q; the scan job must have no registry side effect", b.Step, cmd)
			}
		}
	}

	// ── The scan job must retain the exact artifact ──────────────────
	uploadedName := ""
	for _, s := range scan.Steps {
		if !s.usesAction(p.UploadAction) {
			continue
		}
		if strings.Contains(s.With["name"], p.ArtifactPrefix) {
			uploadedName = s.With["name"]
			if s.With["if-no-files-found"] != "error" {
				fail(scanSubject,
					"artifact upload %q does not set `if-no-files-found: error`; a missing archive would silently produce an empty artifact and the publish job would promote nothing",
					s.With["name"])
			}
		}
	}
	if uploadedName == "" {
		fail(scanSubject, "scan job uploads no artifact whose name contains %q, so the scanned bytes cannot reach the publish job", p.ArtifactPrefix)
	}
	for _, token := range p.IsolationTokens {
		if uploadedName != "" && !strings.Contains(uploadedName, token) {
			fail(scanSubject,
				"artifact name %q omits the isolation token %q; parallel matrix legs would collide and a publish job could promote another image's bytes",
				uploadedName, token)
		}
	}

	// ── Publish jobs must promote, not rebuild ───────────────────────
	for _, name := range p.PublishJobs {
		pub, ok := jobs[name]
		if !ok {
			fail(p.Workflow, "publish job %q does not exist in the workflow", name)
			continue
		}
		subject := p.Workflow + ":" + name

		for _, s := range pub.Steps {
			if s.usesAction(p.BuildActions...) {
				fail(subject,
					"publish step %q invokes %s — the publish job REBUILDS instead of promoting. Two builds are not one artifact: an unpinned base tag or an evicted cache entry makes the pushed image differ from the scanned one, and the signature then attests bytes nobody assessed",
					s.Name, s.Uses)
			}
		}

		downloaded := ""
		for _, s := range pub.Steps {
			if s.usesAction(p.DownloadAction) && strings.Contains(s.With["name"], p.ArtifactPrefix) {
				downloaded = s.With["name"]
			}
		}
		if downloaded == "" {
			fail(subject, "publish job downloads no artifact whose name contains %q; it cannot be promoting the scanned bytes", p.ArtifactPrefix)
		} else if uploadedName != "" && downloaded != uploadedName {
			fail(subject,
				"publish job downloads %q but the scan job uploaded %q; the names must match exactly or the promoted bytes are not the scanned bytes",
				downloaded, uploadedName)
		}

		joined := ""
		for _, b := range pub.RunBlocks {
			joined += b.Script + "\n"
		}
		if !strings.Contains(joined, p.ContinuityMarker) {
			fail(subject,
				"publish job never emits the continuity marker %q; without comparing the scanned digest to the pushed digest, artifact promotion is asserted rather than proven",
				p.ContinuityMarker)
		}
		pushed := false
		for _, cmd := range p.PushCommands {
			if strings.Contains(joined, cmd) {
				pushed = true
			}
		}
		if !pushed {
			fail(subject, "publish job runs none of %s, so nothing is actually promoted", strings.Join(p.PushCommands, ", "))
		}
	}
	return out
}

// transitiveNeeds returns the full dependency closure of a job.
func transitiveNeeds(jobs map[string]workflowJob, name string) map[string]bool {
	out := map[string]bool{}
	var walk func(string)
	walk = func(n string) {
		job, ok := jobs[n]
		if !ok {
			return
		}
		for _, dep := range job.Needs {
			if out[dep] {
				continue
			}
			out[dep] = true
			walk(dep)
		}
	}
	walk(name)
	return out
}

// ValidatePublishGate asserts every publish job depends — transitively —
// on the gate job.
func ValidatePublishGate(p PublishGatePolicy, source string) []Finding {
	const check = "workflows"
	var out []Finding

	parsed, err := ParseWorkflowJobs(source)
	if err != nil {
		return []Finding{errf(check, p.Workflow, "parse: %v", err)}
	}
	jobs := make(map[string]workflowJob, len(parsed))
	for _, j := range parsed {
		jobs[j.Name] = j
	}

	if p.GateJob == "" {
		out = append(out, errf(check, p.Workflow, "publish_gates entry has no gate_job"))
		return out
	}
	if _, ok := jobs[p.GateJob]; !ok {
		out = append(out, errf(check, p.Workflow, "gate job %q does not exist in the workflow", p.GateJob))
		return out
	}
	if len(p.PublishJobs) == 0 {
		out = append(out, errf(check, p.Workflow, "publish_gates entry lists no publish_jobs; the gate would guard nothing"))
	}

	for _, name := range p.PublishJobs {
		if _, ok := jobs[name]; !ok {
			out = append(out, errf(check, p.Workflow, "publish job %q does not exist in the workflow", name))
			continue
		}
		if name == p.GateJob {
			out = append(out, errf(check, p.Workflow, "job %q is listed as both the gate and a publish job", name))
			continue
		}
		closure := transitiveNeeds(jobs, name)
		if !closure[p.GateJob] {
			out = append(out, errf(check, p.Workflow+":"+name,
				"publish job %q can run WITHOUT %q completing — its transitive needs are {%s}. A vulnerability gate that runs after the push blocks nothing: the image, chart, or tag is already public. %s",
				name, p.GateJob, joinSorted(closure), p.Rationale))
		}
	}
	return out
}

func joinSorted(set map[string]bool) string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	if len(out) == 0 {
		return "none"
	}
	return strings.Join(out, ", ")
}

// ValidateWorkflows checks every governed workflow.
func ValidateWorkflows(fsys fs.FS, p *WorkflowPolicy) []Finding {
	const check = "workflows"
	var out []Finding

	if p.Version != 1 {
		out = append(out, errf(check, WorkflowPolicyPath, "unsupported policy version %d (want 1)", p.Version))
	}
	if len(p.Workflows) == 0 {
		out = append(out, errf(check, "workflows", "no workflow is governed by the semantics policy"))
	}
	if len(p.UntrustedContexts) == 0 {
		out = append(out, errf(check, "untrusted_contexts", "at least `inputs.` must be treated as untrusted"))
	}
	if len(p.JobOutputContexts) == 0 {
		out = append(out, errf(check, "job_output_contexts",
			"at least `needs.` must require env indirection — a Markdown vulnerability summary with backticks was re-parsed as command substitution and published blank image cells while exiting 0"))
	}
	if !p.RequireStatusFunctio {
		out = append(out, errf(check, "require_status_function_on_conditional_needs",
			"must stay true — an implicit success() on a conditional dependent job is how a confirmed rollback silently no-ops"))
	}

	for _, path := range p.Workflows {
		raw, err := fs.ReadFile(fsys, path)
		if err != nil {
			out = append(out, errf(check, path, "%v", err))
			continue
		}
		out = append(out, ValidateWorkflowSemantics(p, path, string(raw))...)
	}

	if len(p.PublishGates) == 0 {
		out = append(out, errf(check, "publish_gates",
			"at least the release workflow must declare which jobs create public artifacts and which job gates them"))
	}
	for _, pg := range p.PublishGates {
		raw, err := fs.ReadFile(fsys, pg.Workflow)
		if err != nil {
			out = append(out, errf(check, pg.Workflow, "%v", err))
			continue
		}
		out = append(out, ValidatePublishGate(pg, string(raw))...)
	}

	if len(p.ArtifactPromotions) == 0 {
		out = append(out, errf(check, "artifact_promotion",
			"the release workflow must declare scan-to-publish artifact continuity; job ordering alone permitted a publish job to rebuild and push bytes that were never scanned"))
	}
	for _, ap := range p.ArtifactPromotions {
		raw, err := fs.ReadFile(fsys, ap.Workflow)
		if err != nil {
			out = append(out, errf(check, ap.Workflow, "%v", err))
			continue
		}
		out = append(out, ValidateArtifactPromotion(ap, string(raw))...)
	}
	return out
}

// CheckWorkflows loads and validates the workflow-semantics policy.
func CheckWorkflows(fsys fs.FS) []Finding {
	p, err := LoadWorkflowPolicy(fsys, WorkflowPolicyPath)
	if err != nil {
		return []Finding{errf("workflows", WorkflowPolicyPath, "%v", err)}
	}
	return ValidateWorkflows(fsys, p)
}
