package main

import (
	"fmt"
	"os"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

var (
	fullSHA         = regexp.MustCompile(`^[a-f0-9]{40}$`)
	imageDigest     = regexp.MustCompile(`^%s@sha256:[a-f0-9]{64}$`)
	trivyVersion    = regexp.MustCompile(`^\d+\.\d+\.\d+$`)
	gitleaksVersion = regexp.MustCompile(`^v\d+\.\d+\.\d+$`)
)

type scalarRef struct {
	value   string
	comment string
	line    int
}

func main() {
	contents, err := os.ReadFile(".github/workflows/security.yml")
	if err != nil {
		fmt.Fprintf(os.Stderr, "read security workflow: %v\n", err)
		os.Exit(1)
	}
	if failures := workflowPinFailures(string(contents)); len(failures) > 0 {
		fmt.Fprintln(os.Stderr, strings.Join(failures, "\n"))
		os.Exit(1)
	}
	fmt.Println("security workflow supply-chain pins verified")
}

func workflowPinFailures(workflow string) []string {
	root, lines, err := parseWorkflow(workflow)
	if err != nil {
		return []string{fmt.Sprintf("parse security workflow YAML: %v", err)}
	}

	failures := make([]string, 0)
	for _, ref := range securityActionRefs(root, lines) {
		if strings.HasPrefix(ref.value, "./") {
			continue
		}
		_, sha, ok := strings.Cut(ref.value, "@")
		if !ok || !fullSHA.MatchString(sha) {
			failures = append(failures, fmt.Sprintf("third-party action is not SHA-pinned at line %d: %s", ref.line, ref.value))
		}
		if !versionComment(ref.comment) {
			failures = append(failures, fmt.Sprintf("third-party action is missing a version comment at line %d: %s", ref.line, ref.value))
		}
	}

	for _, scanner := range []struct {
		variable string
		image    string
		version  *regexp.Regexp
	}{
		{"TRIVY_IMAGE", "aquasec/trivy", trivyVersion},
		{"GITLEAKS_IMAGE", "zricethezav/gitleaks", gitleaksVersion},
	} {
		ref, ok := rootEnvRef(root, lines, scanner.variable)
		if !ok {
			failures = append(failures, fmt.Sprintf("%s is missing", scanner.variable))
			continue
		}
		pattern := regexp.MustCompile(fmt.Sprintf(imageDigest.String(), regexp.QuoteMeta(scanner.image)))
		if !pattern.MatchString(ref.value) {
			failures = append(failures, fmt.Sprintf("%s must use a digest-pinned %s image", scanner.variable, scanner.image))
		}
		if !scanner.version.MatchString(ref.comment) {
			failures = append(failures, fmt.Sprintf("%s has an invalid version comment %q", scanner.variable, ref.comment))
		}
	}
	return failures
}

func parseWorkflow(workflow string) (*yaml.Node, []string, error) {
	var root yaml.Node
	if err := yaml.Unmarshal([]byte(workflow), &root); err != nil {
		return nil, nil, err
	}
	return &root, strings.Split(workflow, "\n"), nil
}

func securityActionRefs(root *yaml.Node, lines []string) []scalarRef {
	jobs, ok := mappingValue(documentContent(root), "jobs")
	if !ok {
		return nil
	}
	security, ok := mappingValue(jobs, "security")
	if !ok {
		return nil
	}

	refs := make([]scalarRef, 0)
	if uses, ok := mappingValue(security, "uses"); ok && uses.Kind == yaml.ScalarNode {
		refs = append(refs, scalarReference(uses, lines))
	}
	steps, ok := mappingValue(security, "steps")
	if !ok || steps.Kind != yaml.SequenceNode {
		return refs
	}
	for _, step := range steps.Content {
		uses, ok := mappingValue(step, "uses")
		if ok && uses.Kind == yaml.ScalarNode {
			refs = append(refs, scalarReference(uses, lines))
		}
	}
	return refs
}

func rootEnvRef(root *yaml.Node, lines []string, variable string) (scalarRef, bool) {
	env, ok := mappingValue(documentContent(root), "env")
	if !ok {
		return scalarRef{}, false
	}
	value, ok := mappingValue(env, variable)
	if !ok || value.Kind != yaml.ScalarNode {
		return scalarRef{}, false
	}
	return scalarReference(value, lines), true
}

func scalarReference(node *yaml.Node, lines []string) scalarRef {
	comment := strings.TrimSpace(strings.TrimPrefix(node.LineComment, "#"))
	if comment == "" && node.Line > 0 && node.Line <= len(lines) {
		if _, after, found := strings.Cut(lines[node.Line-1], "#"); found {
			comment = strings.TrimSpace(after)
		}
	}
	return scalarRef{value: strings.TrimSpace(node.Value), comment: comment, line: node.Line}
}

func versionComment(comment string) bool {
	return regexp.MustCompile(`^v?\d`).MatchString(comment)
}

func documentContent(node *yaml.Node) *yaml.Node {
	if node != nil && node.Kind == yaml.DocumentNode && len(node.Content) == 1 {
		return node.Content[0]
	}
	return node
}

func mappingValue(node *yaml.Node, key string) (*yaml.Node, bool) {
	node = documentContent(node)
	if node == nil || node.Kind != yaml.MappingNode {
		return nil, false
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			return node.Content[i+1], true
		}
	}
	return nil, false
}
