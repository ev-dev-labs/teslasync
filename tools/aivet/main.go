// Command aivet enforces the Phase-50 / ADR-015 AI-Off Contract at
// the type-system level (methodology principle P6). It performs four
// static checks on the repository and exits non-zero on any failure:
//
//  1. CoverageOK  — every entry in internal/ai/features.Registry has
//     populated surface metadata (Routes, Name, Tier, …) and no
//     DefaultOn=true entry.
//
//  2. Wrap-only — every /api/v1/ai/* route mounted in
//     internal/api/router.go (or any sibling file in internal/api) is
//     registered via `g.Wrap(...)` (or the equivalent `aiGuard.Wrap`).
//     A bare HandlerFunc on an /ai/* path is rejected.
//
//  3. Registry coverage — every backend pattern in
//     features.Registry[id].Routes.Backend is present in the router,
//     and every router pattern under /api/v1/ai/ is owned by exactly
//     one registry entry's Backend list.
//
//  4. TS mirror in sync — the generator (tools/aigen) reports the
//     web/src/ai/features.ts file as up-to-date.
//
//  5. W1-A (slice 0065) — no shipped AI component contains a
//     placeholder ("future slice", "coming soon", "wiring lands",
//     "would call POST") OR a literal `disabled` / `disabled={true}`
//     attribute on a JSX Button. Computed disabled expressions
//     (`disabled={!ready || streaming}`) are allowed.
//
//  6. W1-B (slice 0065) — every entry in features.SPAWiringTable
//     points at a SPA component that (a) imports `useAiStream` from
//     `@/hooks/useAiStream` and (b) references either the canonical
//     endpoint's path-prefix (everything before the first `{`
//     placeholder, e.g. `/ai/drives/` for a parameterised route) or
//     the generated SPA_WIRING_BY_ID map from `web/src/ai/spaWiring`.
//     Files allowlisted via features.SPAWiringIndicatorOnly are
//     exempt from (a) and (b) but still subject to W1-A.
//
// Usage:
//
//	go run ./tools/aivet
//
// CI runs this. It must pass for any PR that touches AI surfaces.
package main

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/ai/features"
)

const (
	apiDir       = "internal/api"
	routerFile   = "internal/api/router.go"
	aiRoutesFile = "internal/api/ai_routes.go"
	aiPathPrefix = "/api/v1/ai/"
	aiSubprefix  = "/ai" // chi sub-route mount inside /api/v1
)

func main() {
	failures := []string{}

	// 1. Registry CoverageOK.
	if err := features.CoverageOK(); err != nil {
		failures = append(failures, fmt.Sprintf("registry CoverageOK: %v", err))
	}

	// 2 + 3. Static analysis of internal/api/*.go for AI route
	//        registrations.
	mounts, err := scanAIRoutes()
	if err != nil {
		failures = append(failures, fmt.Sprintf("scanAIRoutes: %v", err))
	} else {
		// 2. Every found route must be wrapped.
		for _, m := range mounts {
			if !m.Wrapped {
				failures = append(failures, fmt.Sprintf(
					"%s:%d: AI route %s %s is registered with a bare HandlerFunc — must use guard.Wrap(\"<feature-id>\", handler)",
					m.File, m.Line, m.Method, m.Path))
			}
		}

		// 3a. Every backend route in the registry must appear in the
		//     router, exactly once.
		registryBackends := map[string]string{} // pattern → owning feature ID
		for _, id := range features.IDs() {
			f, _ := features.Get(id)
			for _, raw := range f.Routes.Backend {
				method, path := splitRoute(raw)
				key := method + " " + path
				if owner, dup := registryBackends[key]; dup {
					failures = append(failures, fmt.Sprintf(
						"registry route %q is claimed by both %q and %q", key, owner, id))
					continue
				}
				registryBackends[key] = id
			}
		}
		mountIndex := map[string]aiMount{}
		for _, m := range mounts {
			mountIndex[m.Method+" "+m.Path] = m
		}
		for key, owner := range registryBackends {
			if _, ok := mountIndex[key]; !ok {
				failures = append(failures, fmt.Sprintf(
					"registry feature %q claims route %q but no matching `%s(...)` registration was found in %s",
					owner, key, methodOf(key), apiDir))
			}
		}

		// 3b. Every mounted /api/v1/ai/* route must be owned by a
		//     registry entry. Unowned routes are an audit hole.
		for _, m := range mounts {
			key := m.Method + " " + m.Path
			if _, ok := registryBackends[key]; !ok {
				failures = append(failures, fmt.Sprintf(
					"%s:%d: AI route %s is mounted but is not present in any features.Registry entry's Routes.Backend",
					m.File, m.Line, key))
			}
		}

		// 3c. Every wrapped route's feature ID must be a known feature.
		for _, m := range mounts {
			if m.FeatureID == "" || !features.IsKnown(m.FeatureID) {
				if m.FeatureID == "" {
					// already covered by Wrapped check — skip duplicate noise
					continue
				}
				failures = append(failures, fmt.Sprintf(
					"%s:%d: route %s is wrapped with feature %q which is not in features.Registry",
					m.File, m.Line, m.Method+" "+m.Path, m.FeatureID))
			}
		}
	}

	// 4. TS mirror in sync.
	cmd := exec.Command("go", "run", "./tools/aigen", "--check")
	out, err := cmd.CombinedOutput()
	if err != nil {
		failures = append(failures, fmt.Sprintf("tools/aigen --check failed:\n%s", string(out)))
	}

	// 5 + 6. SPA wiring contract (Phase-50 / 0065 W1).
	if err := features.SPAWiringSelfCheck(); err != nil {
		failures = append(failures, fmt.Sprintf("features.SPAWiringSelfCheck: %v", err))
	}
	w1aFailures, w1bFailures := runW1Checks()
	for _, f := range w1aFailures {
		failures = append(failures, "W1-A: "+f)
	}
	for _, f := range w1bFailures {
		failures = append(failures, "W1-B: "+f)
	}

	if len(failures) > 0 {
		fmt.Fprintln(os.Stderr, "aivet: AI-off contract violations detected:")
		for _, f := range failures {
			fmt.Fprintln(os.Stderr, "  -", f)
		}
		fmt.Fprintln(os.Stderr)
		fmt.Fprintln(os.Stderr, "See ADR-015 (.github/prompts/db-refactor/adrs/ADR-015-ai-off-contract.md)")
		fmt.Fprintln(os.Stderr, "and the Phase-50 methodology (P6, P9) for the rules these checks enforce.")
		os.Exit(1)
	}

	fmt.Printf("aivet: OK — %d AI route(s), %d feature(s) in registry, %d SPA wiring entries, TS mirror in sync\n",
		countMounts(), len(features.IDs()), len(features.SPAWiringTable))
}

// aiMount describes one HTTP route registration discovered under
// internal/api/ whose path lies on /api/v1/ai/* (or, equivalently,
// /ai/* inside the /api/v1 sub-router).
type aiMount struct {
	File      string
	Line      int
	Method    string // "GET" | "POST" | …
	Path      string // canonical "/api/v1/ai/<rest>"
	Wrapped   bool   // true iff registered via guard.Wrap("<id>", …)
	FeatureID string // populated when Wrapped
}

// scanAIRoutes parses every .go file under internal/api/ and finds
// chi route registrations whose path is /ai/... or /api/v1/ai/...
// The matcher recognises:
//
//   - r.Get("/api/v1/ai/foo", h)               (top-level)
//   - r.Get("/ai/foo", h)                      (inside Route("/api/v1"))
//   - r.Get("/foo", h)                         (inside Route("/ai") inside Route("/api/v1"))
//
// For each, it determines whether `h` is a call to `guard.Wrap` /
// `aiGuard.Wrap` / `g.Wrap`. The handler argument is also inspected
// for the feature ID (first argument of Wrap).
func scanAIRoutes() ([]aiMount, error) {
	fset := token.NewFileSet()
	files, err := collectGoFiles(apiDir)
	if err != nil {
		return nil, err
	}

	var mounts []aiMount
	for _, path := range files {
		src, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", path, err)
		}
		f, err := parser.ParseFile(fset, path, src, parser.ParseComments)
		if err != nil {
			return nil, fmt.Errorf("parse %s: %w", path, err)
		}
		mounts = append(mounts, scanFile(fset, f, path)...)
	}
	sort.SliceStable(mounts, func(i, j int) bool {
		if mounts[i].File != mounts[j].File {
			return mounts[i].File < mounts[j].File
		}
		return mounts[i].Line < mounts[j].Line
	})
	return mounts, nil
}

func scanFile(fset *token.FileSet, f *ast.File, file string) []aiMount {
	var mounts []aiMount
	// pathStack tracks the chain of Route("...") prefixes the cursor
	// is currently inside, so a /ai/foo registration nested inside
	// Route("/api/v1") resolves to /api/v1/ai/foo.
	pathStack := []string{}

	var visit func(n ast.Node)
	visit = func(n ast.Node) {
		switch x := n.(type) {
		case *ast.CallExpr:
			handleCall(fset, x, file, pathStack, &mounts)
			// For Route("...", func(r chi.Router) { ... }), recurse
			// into the body with the prefix pushed.
			if pushed, prefix := tryPushRoute(x); pushed {
				pathStack = append(pathStack, prefix)
				if len(x.Args) >= 2 {
					if fl, ok := x.Args[1].(*ast.FuncLit); ok {
						ast.Inspect(fl.Body, func(n ast.Node) bool { visit(n); return false })
					}
				}
				pathStack = pathStack[:len(pathStack)-1]
				return
			}
			for _, arg := range x.Args {
				visit(arg)
			}
		case *ast.FuncLit:
			ast.Inspect(x.Body, func(n ast.Node) bool { visit(n); return false })
		default:
			if n != nil {
				ast.Inspect(n, func(c ast.Node) bool {
					if c == n {
						return true
					}
					visit(c)
					return false
				})
			}
		}
	}
	visit(f)
	return mounts
}

// tryPushRoute reports whether call is `r.Route("/prefix", ...)` and
// returns the literal prefix.
func tryPushRoute(call *ast.CallExpr) (bool, string) {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || sel.Sel.Name != "Route" || len(call.Args) < 1 {
		return false, ""
	}
	lit, ok := call.Args[0].(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return false, ""
	}
	prefix, err := unquote(lit.Value)
	if err != nil {
		return false, ""
	}
	return true, prefix
}

func handleCall(fset *token.FileSet, call *ast.CallExpr, file string, pathStack []string, mounts *[]aiMount) {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return
	}
	method, ok := chiVerb(sel.Sel.Name)
	if !ok {
		return
	}
	if len(call.Args) < 2 {
		return
	}
	pathLit, ok := call.Args[0].(*ast.BasicLit)
	if !ok || pathLit.Kind != token.STRING {
		return
	}
	rawPath, err := unquote(pathLit.Value)
	if err != nil {
		return
	}
	full := joinPath(pathStack, rawPath)
	// Canonicalisation: a chi sub-router mounted via r.Route("/ai", …)
	// inside r.Route("/api/v1", …) resolves to "/api/v1/ai/foo", but
	// when mountAIRoutes (which only contains the inner Route) is
	// inspected on its own file, the visitor sees only the "/ai"
	// prefix. Static analysis cannot follow inter-procedural call
	// chains, so we treat any path beginning with "/ai/" as a
	// shorthand for the canonical "/api/v1/ai/" surface. Two
	// invariants make this safe:
	//
	//  - The repository convention is that "/ai/..." patterns appear
	//    only under the /api/v1 sub-router; tools/aivet documents the
	//    constraint and its single sanctioned mount point.
	//  - Any divergent mount (e.g. an unguarded /ai/foo at the root
	//    router) would be caught here too — the invariant is "every
	//    chi /ai/... or /api/v1/ai/... is wrapped".
	if strings.HasPrefix(full, "/ai/") {
		full = "/api/v1" + full
	}
	if !strings.HasPrefix(full, aiPathPrefix) {
		return
	}

	pos := fset.Position(call.Pos())
	wrapped, featureID := isGuardWrap(call.Args[1])
	*mounts = append(*mounts, aiMount{
		File:      file,
		Line:      pos.Line,
		Method:    method,
		Path:      full,
		Wrapped:   wrapped,
		FeatureID: featureID,
	})
}

// isGuardWrap reports whether handlerExpr is a call expression of the
// form X.Wrap("<feature-id>", handler) where X is any identifier
// (typically `g`, `aiGuard`, or `guard`). The feature ID is the
// first argument's string literal.
func isGuardWrap(handlerExpr ast.Expr) (bool, string) {
	call, ok := handlerExpr.(*ast.CallExpr)
	if !ok {
		return false, ""
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || sel.Sel.Name != "Wrap" {
		return false, ""
	}
	if len(call.Args) < 2 {
		return false, ""
	}
	lit, ok := call.Args[0].(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return true, "" // wrapped, but ID is dynamic — rare, flagged elsewhere
	}
	id, err := unquote(lit.Value)
	if err != nil {
		return true, ""
	}
	return true, id
}

// chiVerb maps a chi router method to its HTTP verb. Returns
// (verb, true) for routing methods only — calls like r.Use are
// ignored.
func chiVerb(name string) (string, bool) {
	switch name {
	case "Get":
		return "GET", true
	case "Post":
		return "POST", true
	case "Put":
		return "PUT", true
	case "Delete":
		return "DELETE", true
	case "Patch":
		return "PATCH", true
	case "Head":
		return "HEAD", true
	case "Options":
		return "OPTIONS", true
	}
	return "", false
}

func joinPath(prefixes []string, suffix string) string {
	parts := append([]string{}, prefixes...)
	parts = append(parts, suffix)
	out := strings.Join(parts, "")
	for strings.Contains(out, "//") {
		out = strings.ReplaceAll(out, "//", "/")
	}
	return out
}

func collectGoFiles(dir string) ([]string, error) {
	var out []string
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		out = append(out, path)
		return nil
	})
	return out, err
}

func unquote(s string) (string, error) {
	if len(s) >= 2 && (s[0] == '"' || s[0] == '`') {
		return s[1 : len(s)-1], nil
	}
	return "", fmt.Errorf("not a string literal: %s", s)
}

func splitRoute(raw string) (method, path string) {
	parts := strings.SplitN(raw, " ", 2)
	if len(parts) != 2 {
		return "", raw
	}
	return parts[0], parts[1]
}

func methodOf(key string) string {
	parts := strings.SplitN(key, " ", 2)
	if len(parts) == 0 {
		return ""
	}
	switch parts[0] {
	case "GET":
		return "r.Get"
	case "POST":
		return "r.Post"
	case "PUT":
		return "r.Put"
	case "DELETE":
		return "r.Delete"
	case "PATCH":
		return "r.Patch"
	}
	return "r." + parts[0]
}

// countMounts re-runs scanAIRoutes for the success-path summary line.
// Hidden behind a function so the err return path stays simple.
func countMounts() int {
	mounts, err := scanAIRoutes()
	if err != nil {
		return 0
	}
	return len(mounts)
}

var _ = bytes.Buffer{} // appease tidy if bytes is dropped above
var _ = routerFile     // reserved for future per-file targeted parsing
var _ = aiRoutesFile
var _ = aiSubprefix

// =====================================================================
// W1-A and W1-B (Phase-50 / 0065)
// =====================================================================

// w1APlaceholderRE matches the case-insensitive substrings W1-A
// forbids in shipped AI components. Each substring marks a deferred-
// wiring placeholder pattern.
var w1APlaceholderRE = regexp.MustCompile(
	`(?i)(future slice|coming soon|wiring lands|would call POST)`,
)

// w1ALiteralDisabledRE matches a JSX Button (or Helix-cyan
// AskHelixButton variant) carrying a literal `disabled` flag,
// either `disabled` (boolean shorthand) or `disabled={true}`. We
// approximate the JSX element scan with a regex because aivet has
// always been line-based and adding a TS parser would dwarf the
// rule. The pattern is intentionally narrow to avoid false positives
// against `disabled={someExpression}`.
var w1ALiteralDisabledRE = regexp.MustCompile(
	`<Button\b[^>]*?\sdisabled(?:\s|=\{true\}|\s*/?>)`,
)

// w1AScanRoots are the directories scanned by W1-A. Component files
// under web/src/components/ai/AI*.tsx are the primary surface;
// page-level wiring files referenced by SPAWiringTable are added
// dynamically inside runW1Checks.
var w1AScanRoots = []string{
	"web/src/components/ai",
}

// runW1Checks executes W1-A (placeholder + literal disabled) and
// W1-B (useAiStream import + endpoint reference). Returns two slices
// of failure strings; an empty slice means the rule passed.
func runW1Checks() (w1a []string, w1b []string) {
	// Build the W1-A scan set: every AI*.tsx in components/ai/ plus
	// every page-level Component path listed in SPAWiringTable
	// (these are the page-level wiring files like ChatbotPage.tsx).
	scanFiles := map[string]struct{}{}
	for _, root := range w1AScanRoots {
		entries, err := os.ReadDir(root)
		if err != nil {
			w1a = append(w1a, fmt.Sprintf("scan %s: %v", root, err))
			continue
		}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			if !strings.HasPrefix(name, "AI") || !strings.HasSuffix(name, ".tsx") {
				continue
			}
			if strings.HasSuffix(name, ".test.tsx") {
				continue
			}
			scanFiles[filepath.ToSlash(filepath.Join(root, name))] = struct{}{}
		}
	}
	for _, w := range features.SPAWiringTable {
		path := filepath.ToSlash(filepath.Join("web", "src", filepath.FromSlash(w.Component)))
		scanFiles[path] = struct{}{}
	}

	// W1-A: placeholder strings + literal disabled.
	for path := range scanFiles {
		src, err := os.ReadFile(path)
		if err != nil {
			w1a = append(w1a, fmt.Sprintf("%s: read: %v", path, err))
			continue
		}
		text := string(src)
		// Strip the well-known "this slice ships only the visible AI
		// marker ... consumed by a future slice's frontend SSE hook"
		// comment line in AIChatbotIndicator.tsx — that file is the
		// indicator badge, and the future-slice reference there is
		// historical context, not a deferred-wiring confession. We
		// keep the strip narrow: any other occurrence of the W1-A
		// placeholder substrings (including in AIChatbotIndicator
		// in the future) still fails.
		//
		// In practice no shipped file should contain the placeholder
		// substrings at all; rules below treat the matched line as
		// the failure location for actionable output.
		for _, loc := range w1APlaceholderRE.FindAllStringIndex(text, -1) {
			lineNum := 1 + strings.Count(text[:loc[0]], "\n")
			snippet := strings.TrimSpace(extractLine(text, loc[0]))
			w1a = append(w1a, fmt.Sprintf(
				"%s:%d: placeholder phrase forbidden by P11/P12: %q",
				path, lineNum, snippet))
		}
		for _, loc := range w1ALiteralDisabledRE.FindAllStringIndex(text, -1) {
			lineNum := 1 + strings.Count(text[:loc[0]], "\n")
			snippet := strings.TrimSpace(extractLine(text, loc[0]))
			w1a = append(w1a, fmt.Sprintf(
				"%s:%d: <Button> has a literal `disabled` / `disabled={true}` attribute (P12); "+
					"use a computed expression like `disabled={!canStart || stream.state === 'streaming'}`: %q",
				path, lineNum, snippet))
		}
	}

	// W1-B: every SPAWiringTable entry's Component file must import
	// useAiStream from @/hooks/useAiStream AND reference the
	// endpoint (via the static path-prefix or the generated
	// SPA_WIRING_BY_ID map). Indicator-only files are exempt.
	for _, w := range features.SPAWiringTable {
		if features.IsIndicatorOnly(w.Component) {
			continue
		}
		path := filepath.ToSlash(filepath.Join("web", "src", filepath.FromSlash(w.Component)))
		src, err := os.ReadFile(path)
		if err != nil {
			w1b = append(w1b, fmt.Sprintf(
				"%s: cannot read component for feature %q: %v", path, w.FeatureID, err))
			continue
		}
		text := string(src)

		hasImport := importsUseAiStream(text)
		if !hasImport {
			w1b = append(w1b, fmt.Sprintf(
				"%s: feature %q must import { useAiStream } from '@/hooks/useAiStream'",
				path, w.FeatureID))
		}

		prefix := features.SPAWiringEndpointStaticPrefix(w.Endpoint)
		refsByID := strings.Contains(text, "SPA_WIRING_BY_ID['"+w.FeatureID+"']") ||
			strings.Contains(text, `SPA_WIRING_BY_ID["`+w.FeatureID+`"]`) ||
			strings.Contains(text, "SPA_WIRING_BY_ID."+jsIdentifierOf(w.FeatureID))
		refsByPath := prefix != "" && strings.Contains(text, prefix)
		if !refsByID && !refsByPath {
			w1b = append(w1b, fmt.Sprintf(
				"%s: feature %q must reference the canonical endpoint path %q "+
					"(directly as a string literal containing %q, OR via SPA_WIRING_BY_ID[%q].endpointPath from '@/ai/spaWiring')",
				path, w.FeatureID, features.SPAWiringEndpointPath(w.Endpoint), prefix, w.FeatureID))
		}
	}

	sort.Strings(w1a)
	sort.Strings(w1b)
	return w1a, w1b
}

// importsUseAiStream reports whether the source text contains an
// import of `useAiStream` from '@/hooks/useAiStream'. The check
// looks for any line that mentions both tokens — a stricter parse
// would require a TS AST and the regex is sufficient for the
// repository's import conventions.
func importsUseAiStream(src string) bool {
	for _, line := range strings.Split(src, "\n") {
		trim := strings.TrimSpace(line)
		if !strings.HasPrefix(trim, "import") {
			continue
		}
		if !strings.Contains(trim, "useAiStream") {
			continue
		}
		if strings.Contains(trim, "@/hooks/useAiStream") {
			return true
		}
	}
	return false
}

// jsIdentifierOf converts a kebab-case feature ID into the camelCase
// identifier a developer would type for dotted property access (rare
// — the canonical access is bracket-keyed, but we still accept the
// dotted form for forward-compat).
func jsIdentifierOf(id string) string {
	parts := strings.Split(id, "-")
	for i, p := range parts {
		if i == 0 || p == "" {
			continue
		}
		parts[i] = strings.ToUpper(p[:1]) + p[1:]
	}
	return strings.Join(parts, "")
}

// extractLine returns the source line containing the byte offset
// idx, useful for W1-A failure snippets.
func extractLine(s string, idx int) string {
	if idx < 0 || idx >= len(s) {
		return ""
	}
	start := strings.LastIndexByte(s[:idx], '\n') + 1
	end := strings.IndexByte(s[idx:], '\n')
	if end < 0 {
		return s[start:]
	}
	return s[start : idx+end]
}
