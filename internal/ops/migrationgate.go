package ops

import (
	"fmt"
	"io"
	"io/fs"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// ── Migration hook secret gate (OPS-03) ──────────────────────────────
//
// The database migration Job is a `pre-install,pre-upgrade` Helm hook
// that takes DATABASE_PASS from the runtime Secret through `envFrom`.
// Helm applies hooks BEFORE the release's ordinary manifests, so a
// Secret source rendered as an ordinary manifest does not exist when the
// hook Job is scheduled.
//
// The observed failure: with `externalSecrets.enabled=true`, a fresh
// install created the migration Job first. External Secrets Operator had
// not yet been told to fetch anything, the target Secret did not exist,
// and the Job's pod sat in CreateContainerConfigError until the hook
// timed out — with nothing in the output naming the cause.
//
// Hook weights alone are not a fix. Weights only order resources that
// are themselves hooks, and an ExternalSecret existing says nothing
// about whether ESO has reconciled it. The invariant this file enforces
// therefore has two halves:
//
//  1. ORDERING — if the chart renders the Secret source at all, it must
//     be a hook with a strictly lower weight than the migration Job.
//     A non-hook source is the defect itself.
//  2. READINESS — the Job must actually wait for the required keys to
//     materialise, because existing is not reconciled.
//
// A source the chart does not render (secrets.existingSecret, or a
// pre-provisioned Secret) is out of scope for (1): there is nothing to
// order. (2) is then optional, since the operator owns provisioning.

// migrationGateObject is the subset of a rendered manifest this check
// needs. It is decoded separately from k8sObject because hook semantics
// live in annotations and the Job's pod spec has a different shape from
// a Deployment's.
type migrationGateObject struct {
	Kind     string `yaml:"kind"`
	Metadata struct {
		Name        string            `yaml:"name"`
		Annotations map[string]string `yaml:"annotations"`
	} `yaml:"metadata"`
	Spec struct {
		Target *struct {
			Name string `yaml:"name"`
			// CreationPolicy decides whether ESO sets ownerReferences on
			// the target Secret. In hook mode the ExternalSecret is
			// deleted and recreated on every upgrade, so `Owner` would
			// garbage-collect the credentials with it.
			CreationPolicy string `yaml:"creationPolicy"`
			DeletionPolicy string `yaml:"deletionPolicy"`
		} `yaml:"target"`
		Template *struct {
			Spec struct {
				InitContainers []migrationGateContainer `yaml:"initContainers"`
				Containers     []migrationGateContainer `yaml:"containers"`
				Volumes        []struct {
					Name   string `yaml:"name"`
					Secret *struct {
						SecretName string `yaml:"secretName"`
						Optional   *bool  `yaml:"optional"`
					} `yaml:"secret"`
				} `yaml:"volumes"`
			} `yaml:"spec"`
		} `yaml:"template"`
	} `yaml:"spec"`
}

type migrationGateContainer struct {
	Name    string   `yaml:"name"`
	Command []string `yaml:"command"`
	EnvFrom []struct {
		SecretRef *struct {
			Name string `yaml:"name"`
		} `yaml:"secretRef"`
	} `yaml:"envFrom"`
	VolumeMounts []struct {
		Name string `yaml:"name"`
	} `yaml:"volumeMounts"`
}

func (o migrationGateObject) hookWeight() (int, bool) {
	raw, ok := o.Metadata.Annotations["helm.sh/hook"]
	if !ok || strings.TrimSpace(raw) == "" {
		return 0, false
	}
	weight, err := strconv.Atoi(strings.TrimSpace(o.Metadata.Annotations["helm.sh/hook-weight"]))
	if err != nil {
		// A hook with no weight defaults to 0.
		return 0, true
	}
	return weight, true
}

// secretNameProduced reports which Secret this object materialises, if
// any: a Secret produces itself, an ExternalSecret produces its target.
func (o migrationGateObject) secretNameProduced() string {
	switch o.Kind {
	case "Secret":
		return o.Metadata.Name
	case "ExternalSecret":
		if o.Spec.Target != nil && o.Spec.Target.Name != "" {
			return o.Spec.Target.Name
		}
		return o.Metadata.Name
	}
	return ""
}

// keepsResource reports whether the object carries Helm's keep policy.
//
// This is what makes converting a previously ORDINARY manifest into a
// hook survivable. Without it the conversion upgrade is a two-step
// self-destruct: `before-hook-creation` deletes and recreates the object
// during pre-upgrade, and then Helm's regular reconciliation finds it in
// the OLD release manifest but not the new one, puts it in
// `original.Difference(target)`, and deletes the object it just created.
//
// `kube.Client.Update` calls `info.Get()` and skips that deletion when
// the LIVE object carries the annotation, while `kube.Client.Delete` —
// the path hook delete policies use — never consults it. So the
// annotation protects the conversion without disabling
// `before-hook-creation`.
func (o migrationGateObject) keepsResource() bool {
	return o.Metadata.Annotations["helm.sh/resource-policy"] == "keep"
}

// hasGateMode reports whether the declared contract is one this checker
// understands.
func hasGateMode(mode string) bool {
	switch mode {
	case "hook", "require", "none":
		return true
	}
	return false
}

func decodeMigrationGate(source string) ([]migrationGateObject, error) {
	dec := yaml.NewDecoder(strings.NewReader(source))
	var out []migrationGateObject
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
		var obj migrationGateObject
		if err := node.Decode(&obj); err != nil || obj.Kind == "" {
			continue
		}
		out = append(out, obj)
	}
	return out, nil
}

// orNone renders an empty policy value readably in a finding.
func orNone(v string) string {
	if strings.TrimSpace(v) == "" {
		return "<unset>"
	}
	return v
}

// joinConsumed renders the Secret names the migration reads.
func joinConsumed(set map[string]bool) string {
	names := make([]string, 0, len(set))
	for name := range set {
		names = append(names, name)
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}

// ── Lifecycle procedure registry (Issue A) ───────────────────────────
//
// Helm tracks hook resources and ordinary manifests separately and
// offers no supported in-place transition between them. Converting a
// secret source into a hook, rolling back across that boundary, or
// leaving hook mode each leave the release manifest and the live cluster
// disagreeing about who manages the credentials.
//
// That is a property of Helm, not something a template can fix, so it is
// carried as an explicit operator procedure — and pinned here so the
// warning cannot quietly rot. Documentation that only exists because
// nobody has deleted it yet is not a control.

// requiredLifecycleProcedures are the procedure ids that must stay
// registered. Removing one from the manifest fails the gate rather than
// silently dropping the warning.
var requiredLifecycleProcedures = []string{"migration-gate-lifecycle"}

// LifecycleProcedure is one operation that a bare Helm command performs
// incorrectly, together with the contract its runbook must keep.
type LifecycleProcedure struct {
	ID    string `yaml:"id"`
	Title string `yaml:"title"`
	Why   string `yaml:"why"`
	// Runbook is the operator document.
	Runbook string `yaml:"runbook"`
	// RequiredSections are headings the runbook must contain, each with
	// real content.
	RequiredSections []string `yaml:"required_sections"`
	// RequiredCommands are the exact commands an operator must be given.
	// A procedure that describes the hazard without the remedy is not
	// actionable at 3am.
	RequiredCommands []string `yaml:"required_commands"`
	// RequiredWarnings are the specific claims that must not be softened
	// or deleted — including the ones that say what the fix does NOT do.
	RequiredWarnings []string `yaml:"required_warnings"`
	// CrossLinks are generic docs that would send an operator down the
	// dangerous path unless they point here.
	CrossLinks []LifecycleCrossLink `yaml:"cross_links"`
}

// LifecycleCrossLink pins a reference from generic documentation.
type LifecycleCrossLink struct {
	Path string `yaml:"path"`
	// Section narrows the requirement to one heading, so a link buried
	// elsewhere in a long README does not satisfy it.
	Section       string `yaml:"section"`
	MustReference string `yaml:"must_reference"`
}

// normaliseNewlines makes the documentation contract independent of the
// checkout's line endings.
func normaliseNewlines(s string) string {
	return strings.ReplaceAll(s, "\r\n", "\n")
}

// collapseWhitespace folds every run of whitespace into a single space.
//
// Command and warning tokens are matched against this form so that
// re-wrapping a Markdown paragraph, or re-indenting a shell snippet,
// cannot silently break the contract. The claim is pinned; its layout is
// not.
func collapseWhitespace(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// validateLifecycleProcedures enforces the registry.
func validateLifecycleProcedures(fsys fs.FS, m *RunbookManifest) []Finding {
	const check = "runbooks"
	var out []Finding

	seen := map[string]bool{}
	for _, p := range m.LifecycleProcedures {
		subject := "lifecycle_procedures[" + p.ID + "]"
		if p.ID == "" {
			out = append(out, errf(check, "lifecycle_procedures[]", "procedure needs an id"))
			continue
		}
		if seen[p.ID] {
			out = append(out, errf(check, subject, "duplicate procedure id"))
		}
		seen[p.ID] = true
		if strings.TrimSpace(p.Title) == "" {
			out = append(out, errf(check, subject, "title is required"))
		}
		if strings.TrimSpace(p.Why) == "" {
			out = append(out, errf(check, subject,
				"why is required — a procedure whose reason is undocumented gets optimised away by the next reader"))
		}
		if p.Runbook == "" {
			out = append(out, errf(check, subject, "runbook path is required"))
			continue
		}
		raw, err := fs.ReadFile(fsys, p.Runbook)
		if err != nil {
			out = append(out, errf(check, subject, "runbook %s: %v", p.Runbook, err))
			continue
		}
		// Normalised so the contract holds on a Windows checkout too; a
		// CRLF working tree must not be able to "break" a warning.
		body := normaliseNewlines(string(raw))

		if len(p.RequiredSections) == 0 {
			out = append(out, errf(check, subject, "required_sections must pin at least one heading"))
		}
		for _, section := range p.RequiredSections {
			idx := strings.Index(body, section+"\n")
			if idx < 0 {
				out = append(out, errf(check, subject, "%s is missing the %q section", p.Runbook, section))
				continue
			}
			rest := body[idx+len(section):]
			if next := strings.Index(rest, "\n## "); next >= 0 {
				rest = rest[:next]
			}
			if len(strings.TrimSpace(rest)) < 120 {
				out = append(out, errf(check, subject,
					"%s section %q is a stub; a lifecycle procedure with no steps is a warning pretending to be a runbook",
					p.Runbook, section))
			}
		}

		if len(p.RequiredCommands) == 0 {
			out = append(out, errf(check, subject,
				"required_commands must pin the remedy — describing the hazard without the commands is not actionable"))
		}
		flat := collapseWhitespace(body)
		for _, cmd := range p.RequiredCommands {
			if !strings.Contains(flat, collapseWhitespace(cmd)) {
				out = append(out, errf(check, subject,
					"%s no longer contains the required command %q; the procedure has drifted from the registry",
					p.Runbook, collapseWhitespace(cmd)))
			}
		}
		for _, warning := range p.RequiredWarnings {
			if !strings.Contains(flat, collapseWhitespace(warning)) {
				out = append(out, errf(check, subject,
					"%s no longer states %q. That warning is load-bearing: it is the difference between an operator "+
						"following the procedure and one running a bare Helm command that destroys the secret source",
					p.Runbook, collapseWhitespace(warning)))
			}
		}

		for _, link := range p.CrossLinks {
			raw, err := fs.ReadFile(fsys, link.Path)
			if err != nil {
				out = append(out, errf(check, subject, "cross-linked file %s: %v", link.Path, err))
				continue
			}
			scope := normaliseNewlines(string(raw))
			if link.Section != "" {
				idx := strings.Index(scope, link.Section+"\n")
				if idx < 0 {
					out = append(out, errf(check, subject,
						"%s no longer has the %q section, so the dangerous-guidance cross-link cannot be verified",
						link.Path, link.Section))
					continue
				}
				scope = scope[idx:]
				if next := strings.Index(scope[len(link.Section):], "\n## "); next >= 0 {
					scope = scope[:len(link.Section)+next]
				}
			}
			if !strings.Contains(collapseWhitespace(scope), collapseWhitespace(link.MustReference)) {
				where := link.Path
				if link.Section != "" {
					where = link.Path + " " + link.Section
				}
				out = append(out, errf(check, subject,
					"%s does not reference %s. Generic rollback/upgrade guidance that omits the link sends an operator "+
						"straight into the hook/ordinary manifest boundary with a bare Helm command",
					where, link.MustReference))
			}
		}
	}

	for _, id := range requiredLifecycleProcedures {
		if !seen[id] {
			out = append(out, errf(check, RunbookManifestPath,
				"missing mandatory lifecycle procedure %q — Helm's hook/ordinary boundary has not gone away, so the "+
					"procedure may not be deregistered", id))
		}
	}
	return out
}

// VerifyMigrationGate asserts the ordering and readiness invariants over
// a `helm template` render.
func VerifyMigrationGate(render string) []Finding {
	const check = "helm-render"
	var out []Finding

	objs, err := decodeMigrationGate(render)
	if err != nil {
		return []Finding{errf(check, "migration-gate", "%v", err)}
	}

	var job *migrationGateObject
	for i := range objs {
		o := objs[i]
		if o.Kind == "Job" && strings.Contains(o.Metadata.Name, "-migrate-") {
			job = &objs[i]
			break
		}
	}
	if job == nil {
		return []Finding{errf(check, "migration-gate",
			"no migration Job was rendered; the pre-install/pre-upgrade schema hook is missing")}
	}

	jobWeight, isHook := job.hookWeight()
	if !isHook {
		out = append(out, errf(check, "migration-gate",
			"migration Job %q is not a Helm hook, so migrations would run alongside the new pods instead of before them",
			job.Metadata.Name))
	}
	// The declared contract. Without it the check cannot tell a
	// deliberate `require` (source applied by a GitOps controller outside
	// this release, Secret pre-provisioned) from the ordering defect.
	mode := strings.TrimSpace(job.Metadata.Annotations["teslasync.io/migration-gate"])
	if mode == "" {
		out = append(out, errf(check, "migration-gate",
			"migration Job %q does not record `teslasync.io/migration-gate`; the secret-ordering contract is "+
				"unauditable after render", job.Metadata.Name))
		mode = "hook"
	}
	if !hasGateMode(mode) {
		out = append(out, errf(check, "migration-gate",
			"migration Job %q declares migration gate mode %q, which is not one of hook, require, none",
			job.Metadata.Name, mode))
	}
	if job.Spec.Template == nil {
		return append(out, errf(check, "migration-gate", "migration Job %q has no pod template", job.Metadata.Name))
	}

	// Which Secret does the migration actually consume?
	consumed := map[string]bool{}
	for _, container := range job.Spec.Template.Spec.Containers {
		for _, ref := range container.EnvFrom {
			if ref.SecretRef != nil && ref.SecretRef.Name != "" {
				consumed[ref.SecretRef.Name] = true
			}
		}
	}
	if len(consumed) == 0 {
		return append(out, errf(check, "migration-gate",
			"migration Job %q consumes no Secret; the credential contract this check exists for is gone",
			job.Metadata.Name))
	}

	// ── 1. Ordering and lifecycle ────────────────────────────────────
	//
	// Only meaningful when the chart renders the secret source itself.
	// In `require` mode the source must NOT be rendered here at all: an
	// ordinary manifest cannot be applied until every pre-install hook
	// has finished, so a chart-rendered source under `require`
	// guarantees a fresh-install timeout by construction.
	rendersSource := false
	for _, o := range objs {
		produced := o.secretNameProduced()
		if produced == "" || !consumed[produced] {
			continue
		}
		rendersSource = true
		weight, sourceIsHook := o.hookWeight()

		if mode == "require" {
			out = append(out, errf(check, "migration-gate",
				"migration gate mode is `require`, which means the Secret is provisioned OUTSIDE this release, but "+
					"%s %q produces Secret %q inside it. Helm cannot apply an ordinary manifest until the pre-install "+
					"hooks have finished, so the migration Job would wait the full timeout on every fresh install. Use "+
					"`hook` so the chart orders the source ahead of the migration, or move the source out of the release",
				o.Kind, o.Metadata.Name, produced))
			continue
		}

		if !sourceIsHook {
			finding := errf(check, "migration-gate",
				"%s %q produces Secret %q, which the pre-install/pre-upgrade migration Job reads via envFrom, "+
					"but it is rendered as an ORDINARY manifest. Helm applies hooks before ordinary manifests, so on a "+
					"fresh install the Secret does not exist when the Job is scheduled and the pod fails with "+
					"CreateContainerConfigError. Render it as a hook at a lower weight (migrationGate.mode=hook) or "+
					"provision it outside the release (migrationGate.mode=require)",
				o.Kind, o.Metadata.Name, produced)
			if mode == "none" {
				// `none` is the documented escape hatch, so this must not
				// block a render — but it must never be silent either.
				finding.Severity = SeverityAdvisory
				finding.Message = "migrationGate.mode=none was chosen explicitly: " + finding.Message
			}
			out = append(out, finding)
			continue
		}

		if isHook && weight >= jobWeight {
			out = append(out, errf(check, "migration-gate",
				"%s %q (hook weight %d) produces Secret %q but does not sort before the migration Job (hook weight %d); "+
					"equal or higher weights give Helm no ordering guarantee",
				o.Kind, o.Metadata.Name, weight, produced, jobWeight))
		}

		// ── Conversion safety ────────────────────────────────────────
		if !o.keepsResource() {
			out = append(out, errf(check, "migration-gate",
				"%s %q is a hook but carries no `helm.sh/resource-policy: keep`. Upgrading a release where it was an "+
					"ORDINARY manifest then destroys it: `before-hook-creation` recreates it during pre-upgrade, and "+
					"Helm's regular reconciliation finds it in the old release manifest but not the new one and deletes "+
					"the object it just created. `kube.Client.Update` skips that deletion only when the live object "+
					"carries the annotation; hook deletion ignores it, so `before-hook-creation` still works",
				o.Kind, o.Metadata.Name))
		}

		// ── Target-Secret continuity across the hook recreate ────────
		if o.Kind == "ExternalSecret" {
			policy := ""
			if o.Spec.Target != nil {
				policy = o.Spec.Target.CreationPolicy
			}
			if policy != "Orphan" {
				out = append(out, errf(check, "migration-gate",
					"ExternalSecret %q is a hook with `before-hook-creation` and `creationPolicy: %s`. ESO sets "+
						"`.metadata.ownerReferences` on the target Secret for every policy except Orphan, so deleting "+
						"the ExternalSecret on each upgrade makes Kubernetes garbage-collect the credentials out from "+
						"under every running pod. `deletionPolicy: %s` does NOT prevent this — it only governs what "+
						"happens when data fields are deleted from the provider. Use `creationPolicy: Orphan`",
					o.Metadata.Name, orNone(policy), orNone(o.Spec.Target.DeletionPolicy)))
			}
		}
	}

	// ── 2. Readiness ─────────────────────────────────────────────────
	//
	// Ordering only guarantees the source object exists. For an
	// ExternalSecret, ESO still has to reach the provider and write the
	// target. The Job must wait for the data, not for the object.
	var waiter *migrationGateContainer
	for i := range job.Spec.Template.Spec.InitContainers {
		if job.Spec.Template.Spec.InitContainers[i].Name == "wait-for-runtime-secret" {
			waiter = &job.Spec.Template.Spec.InitContainers[i]
			break
		}
	}
	if waiter == nil {
		if mode != "none" {
			out = append(out, errf(check, "migration-gate",
				"migration Job %q declares migration gate mode %q but has no `wait-for-runtime-secret` "+
					"initContainer. Hook ordering alone is not enough: an ExternalSecret existing says nothing about "+
					"whether External Secrets Operator has reconciled it, so the migration can still start against a "+
					"Secret with no data",
				job.Metadata.Name, mode))
		}
		return out
	}

	// `hook` promises the chart orders the source; if nothing renders it,
	// the promise is empty.
	if mode == "hook" && !rendersSource {
		out = append(out, errf(check, "migration-gate",
			"migration gate mode is `hook`, but no rendered object produces Secret %s. Hook mode can only order a "+
				"source this chart renders; with a pre-provisioned Secret the correct contract is `require`",
			joinConsumed(consumed)))
	}

	script := strings.Join(waiter.Command, "\n")
	if !strings.Contains(script, "TIMEOUT_SECONDS") {
		out = append(out, errf(check, "migration-gate",
			"the `wait-for-runtime-secret` initContainer has no timeout; an unreconciled Secret would hang the "+
				"release until Helm's own timeout with no diagnostic"))
	}
	if !strings.Contains(script, "externalsecret") {
		out = append(out, errf(check, "migration-gate",
			"the wait failure message does not tell the operator to inspect the ExternalSecret status; "+
				"a bare timeout does not distinguish a slow provider from a misconfigured SecretStore"))
	}

	// The Secret must be mounted optional, or the pod cannot even be
	// created before the Secret exists — reintroducing the opaque
	// CreateContainerConfigError this gate replaces.
	mounted := map[string]bool{}
	for _, mount := range waiter.VolumeMounts {
		mounted[mount.Name] = true
	}
	found := false
	for _, volume := range job.Spec.Template.Spec.Volumes {
		if !mounted[volume.Name] || volume.Secret == nil {
			continue
		}
		if !consumed[volume.Secret.SecretName] {
			continue
		}
		found = true
		if volume.Secret.Optional == nil || !*volume.Secret.Optional {
			out = append(out, errf(check, "migration-gate",
				"volume %q mounts Secret %q without `optional: true`; the pod would be unschedulable until the "+
					"Secret exists, which is the opaque failure the wait replaces",
				volume.Name, volume.Secret.SecretName))
		}
	}
	if !found {
		out = append(out, errf(check, "migration-gate",
			"the `wait-for-runtime-secret` initContainer does not mount the Secret the migration consumes, so it "+
				"cannot be observing the right thing"))
	}
	return out
}
