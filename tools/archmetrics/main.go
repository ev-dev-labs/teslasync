// Command archmetrics snapshots TeslaSync architectural metrics into JSON
// and Markdown reports, and detects regressions against a committed baseline.
//
// Usage:
//
//	go run ./tools/archmetrics > tools/archmetrics/baseline.json
//	go run ./tools/archmetrics -report > tools/archmetrics/baseline.md
//	go run ./tools/archmetrics -compare tools/archmetrics/baseline.json
//
// -compare exits 1 if any metric regresses: a new file appears in a frozen
// package, a new layering violation surfaces, or doc.go coverage drops.
//
// Phase-47 / Prompt 01 — pure additive; never wired into a runtime binary.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

const modulePath = "github.com/ev-dev-labs/teslasync"

// frozenPackages enumerates packages whose .go file count must NOT grow
// between baseline and HEAD. Phase-47 prompts 06+ extend this list as
// each canonical package is declared frozen.
var frozenPackages = []string{
	"internal/api",
}

// forbiddenEdges enumerates layering violations the tool flags. Each entry
// is "<from-glob> -> <to-glob>" where globs are evaluated as path prefixes
// (trailing /* means "or any subpackage").
var forbiddenEdges = []forbiddenEdge{
	{From: "cmd/notification-worker", To: "internal/api"},
	{From: "cmd/automation-worker", To: "internal/api"},
	{From: "internal/domain", FromAny: true, To: "internal/adapter", ToAny: true},
	{From: "internal/domain", FromAny: true, To: "internal/database"},
	{From: "internal/handler/v1", To: "internal/database"},
}

type forbiddenEdge struct {
	From    string
	FromAny bool // true means From or any subpackage
	To      string
	ToAny   bool // true means To or any subpackage
}

func (e forbiddenEdge) Label() string {
	from, to := e.From, e.To
	if e.FromAny {
		from += "/*"
	}
	if e.ToAny {
		to += "/*"
	}
	return from + " -> " + to
}

func (e forbiddenEdge) matchesFrom(pkg string) bool {
	if pkg == e.From {
		return true
	}
	if e.FromAny && strings.HasPrefix(pkg, e.From+"/") {
		return true
	}
	return false
}

func (e forbiddenEdge) matchesTo(pkg string) bool {
	if pkg == e.To {
		return true
	}
	if e.ToAny && strings.HasPrefix(pkg, e.To+"/") {
		return true
	}
	return false
}

// PkgMetric is one row in the snapshot — one Go package directory.
type PkgMetric struct {
	Path      string   `json:"path"`            // repo-relative dir, forward slashes
	GoFiles   int      `json:"go_files"`        // .go files (excludes _test.go)
	TestFiles int      `json:"test_files"`      // _test.go files
	LOC       int      `json:"loc"`             // total non-blank lines across all .go files
	HasDocGo  bool     `json:"has_doc_go"`      // doc.go exists
	Layer     string   `json:"layer,omitempty"` // parsed from doc.go magic comment
	Imports   []string `json:"imports"`         // unique internal/* imports (repo-relative)
	Files     []string `json:"files"`           // sorted list of .go file basenames
}

// Snapshot is the full report — JSON-serialised to baseline.json.
type Snapshot struct {
	GeneratedAt    string         `json:"generated_at"`
	GoVersion      string         `json:"go_version"`
	CommitSHA      string         `json:"commit_sha"`
	Packages       []PkgMetric    `json:"packages"`
	CmdLOC         map[string]int `json:"cmd_loc"`
	ForbiddenEdges []string       `json:"forbidden_edges"`
	DocGoCoverage  float64        `json:"doc_go_coverage"`
}

func main() {
	report := flag.Bool("report", false, "emit Markdown report instead of JSON")
	compare := flag.String("compare", "", "compare against baseline JSON; non-zero exit on regression")
	flag.Parse()

	snap := collect()

	switch {
	case *report:
		emitMarkdown(os.Stdout, snap)
	case *compare != "":
		base, err := loadBaseline(*compare)
		if err != nil {
			fmt.Fprintln(os.Stderr, "load baseline:", err)
			os.Exit(2)
		}
		regressions := diff(base, snap)
		if len(regressions) > 0 {
			for _, r := range regressions {
				fmt.Fprintln(os.Stderr, "REGRESSION:", r)
			}
			os.Exit(1)
		}
		fmt.Println("OK: no architectural regression")
	default:
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(snap); err != nil {
			fmt.Fprintln(os.Stderr, "encode:", err)
			os.Exit(2)
		}
	}
}

// collect walks cmd/, internal/, tools/ and builds a Snapshot.
func collect() Snapshot {
	roots := []string{"cmd", "internal", "tools"}
	pkgs := map[string]*PkgMetric{}

	for _, root := range roots {
		_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				name := d.Name()
				if name == "vendor" || name == "node_modules" || (strings.HasPrefix(name, ".") && name != ".") {
					return fs.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(path, ".go") {
				return nil
			}
			dir := filepath.Dir(path)
			rel := filepath.ToSlash(dir)
			pm, ok := pkgs[rel]
			if !ok {
				pm = &PkgMetric{Path: rel}
				pkgs[rel] = pm
			}
			base := filepath.Base(path)
			pm.Files = append(pm.Files, base)
			if strings.HasSuffix(base, "_test.go") {
				pm.TestFiles++
			} else {
				pm.GoFiles++
			}
			pm.LOC += countNonBlankLines(path)
			if base == "doc.go" {
				pm.HasDocGo = true
				if layer := parseLayerComment(path); layer != "" {
					pm.Layer = layer
				}
			}
			imps := parseImports(path)
			pm.Imports = mergeImports(pm.Imports, imps)
			return nil
		})
	}

	out := make([]PkgMetric, 0, len(pkgs))
	for _, p := range pkgs {
		sort.Strings(p.Files)
		sort.Strings(p.Imports)
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })

	cmdLOC := map[string]int{}
	if entries, err := os.ReadDir("cmd"); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			mainPath := filepath.Join("cmd", e.Name(), "main.go")
			if _, err := os.Stat(mainPath); err == nil {
				cmdLOC["cmd/"+e.Name()] = countNonBlankLines(mainPath)
			}
		}
	}

	edges := computeForbiddenEdges(out)

	docGoTotal, docGoYes := 0, 0
	for _, p := range out {
		if p.GoFiles == 0 {
			continue
		}
		docGoTotal++
		if p.HasDocGo {
			docGoYes++
		}
	}
	cov := 0.0
	if docGoTotal > 0 {
		cov = float64(docGoYes) / float64(docGoTotal)
	}

	return Snapshot{
		GeneratedAt:    time.Now().UTC().Format(time.RFC3339),
		GoVersion:      runtime.Version(),
		CommitSHA:      gitHead(),
		Packages:       out,
		CmdLOC:         cmdLOC,
		ForbiddenEdges: edges,
		DocGoCoverage:  cov,
	}
}

func gitHead() string {
	out, err := exec.Command("git", "rev-parse", "HEAD").Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(out))
}

func countNonBlankLines(path string) int {
	f, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1024*1024), 4*1024*1024)
	n := 0
	for sc.Scan() {
		if strings.TrimSpace(sc.Text()) != "" {
			n++
		}
	}
	return n
}

// parseLayerComment looks for `// Layer: <word>` in a doc.go file.
func parseLayerComment(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		t := strings.TrimSpace(line)
		if !strings.HasPrefix(t, "// Layer:") {
			continue
		}
		val := strings.TrimSpace(strings.TrimPrefix(t, "// Layer:"))
		switch val {
		case "domain", "port", "adapter", "app", "handler", "platform", "cmd-internal", "tool":
			return val
		default:
			return ""
		}
	}
	return ""
}

// parseImports returns repo-relative internal import paths from a .go file.
func parseImports(path string) []string {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
	if err != nil {
		return nil
	}
	prefix := modulePath + "/"
	var out []string
	for _, imp := range f.Imports {
		v := strings.Trim(imp.Path.Value, `"`)
		if !strings.HasPrefix(v, prefix) {
			continue
		}
		out = append(out, strings.TrimPrefix(v, prefix))
	}
	return out
}

func mergeImports(dst, src []string) []string {
	seen := map[string]bool{}
	for _, v := range dst {
		seen[v] = true
	}
	for _, v := range src {
		if !seen[v] {
			dst = append(dst, v)
			seen[v] = true
		}
	}
	return dst
}

func computeForbiddenEdges(pkgs []PkgMetric) []string {
	type pair struct{ from, to string }
	hit := map[pair]bool{}
	var out []string
	for _, p := range pkgs {
		for _, e := range forbiddenEdges {
			if !e.matchesFrom(p.Path) {
				continue
			}
			for _, imp := range p.Imports {
				if e.matchesTo(imp) {
					k := pair{p.Path, imp}
					if !hit[k] {
						hit[k] = true
						out = append(out, fmt.Sprintf("%s -> %s (rule: %s)", p.Path, imp, e.Label()))
					}
				}
			}
		}
	}
	sort.Strings(out)
	return out
}

func loadBaseline(path string) (Snapshot, error) {
	var s Snapshot
	data, err := os.ReadFile(path)
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal(data, &s); err != nil {
		return s, err
	}
	return s, nil
}

// diff returns a list of human-readable regression descriptions.
func diff(base, cur Snapshot) []string {
	var regs []string

	baseByPath := map[string]PkgMetric{}
	for _, p := range base.Packages {
		baseByPath[p.Path] = p
	}
	curByPath := map[string]PkgMetric{}
	for _, p := range cur.Packages {
		curByPath[p.Path] = p
	}

	for _, fp := range frozenPackages {
		bp, hadBase := baseByPath[fp]
		cp, hadCur := curByPath[fp]
		if !hadCur {
			continue
		}
		if !hadBase {
			for _, f := range cp.Files {
				regs = append(regs, fmt.Sprintf("new file in %s/%s (frozen package)", fp, f))
			}
			continue
		}
		baseFiles := map[string]bool{}
		for _, f := range bp.Files {
			baseFiles[f] = true
		}
		for _, f := range cp.Files {
			if !baseFiles[f] {
				regs = append(regs, fmt.Sprintf("new file in %s/%s (frozen package)", fp, f))
			}
		}
	}

	baseEdges := map[string]bool{}
	for _, e := range base.ForbiddenEdges {
		baseEdges[e] = true
	}
	for _, e := range cur.ForbiddenEdges {
		if !baseEdges[e] {
			regs = append(regs, fmt.Sprintf("new layering violation: %s", e))
		}
	}

	if cur.DocGoCoverage+1e-9 < base.DocGoCoverage {
		regs = append(regs, fmt.Sprintf("doc.go coverage dropped: %.1f%% -> %.1f%%",
			base.DocGoCoverage*100, cur.DocGoCoverage*100))
	}

	sort.Strings(regs)
	return regs
}

func emitMarkdown(w *os.File, s Snapshot) {
	fmt.Fprintln(w, "# TeslaSync architecture metrics — baseline")
	fmt.Fprintln(w)
	fmt.Fprintf(w, "_Generated %s, Go %s, commit %s_\n\n", s.GeneratedAt, s.GoVersion, s.CommitSHA)

	fmt.Fprintln(w, "## Summary")
	fmt.Fprintln(w)
	fmt.Fprintf(w, "- Packages: %d\n", len(s.Packages))
	fmt.Fprintf(w, "- doc.go coverage: %.1f%%\n", s.DocGoCoverage*100)
	fmt.Fprintf(w, "- Forbidden edges detected: %d\n", len(s.ForbiddenEdges))
	totalLOC := 0
	for _, p := range s.Packages {
		totalLOC += p.LOC
	}
	fmt.Fprintf(w, "- Total non-blank LOC under cmd/+internal/+tools/: %d\n", totalLOC)
	fmt.Fprintln(w)

	fmt.Fprintln(w, "## cmd/* main.go LOC")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "| cmd | LOC |")
	fmt.Fprintln(w, "|---|---:|")
	cmdNames := make([]string, 0, len(s.CmdLOC))
	for k := range s.CmdLOC {
		cmdNames = append(cmdNames, k)
	}
	sort.Strings(cmdNames)
	for _, k := range cmdNames {
		fmt.Fprintf(w, "| %s/main.go | %d |\n", k, s.CmdLOC[k])
	}
	fmt.Fprintln(w)

	fmt.Fprintln(w, "## Forbidden edges")
	fmt.Fprintln(w)
	if len(s.ForbiddenEdges) == 0 {
		fmt.Fprintln(w, "_None._")
	} else {
		for _, e := range s.ForbiddenEdges {
			fmt.Fprintf(w, "- %s\n", e)
		}
	}
	fmt.Fprintln(w)

	fmt.Fprintln(w, "## Per-package metrics")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "| Package | .go | _test.go | LOC | doc.go | Layer |")
	fmt.Fprintln(w, "|---|---:|---:|---:|:---:|---|")
	for _, p := range s.Packages {
		doc := " "
		if p.HasDocGo {
			doc = "yes"
		}
		fmt.Fprintf(w, "| %s | %d | %d | %d | %s | %s |\n",
			p.Path, p.GoFiles, p.TestFiles, p.LOC, doc, p.Layer)
	}
	fmt.Fprintln(w)

	fmt.Fprintln(w, "## doc.go adoption")
	fmt.Fprintln(w)
	missing := []string{}
	for _, p := range s.Packages {
		if p.GoFiles == 0 {
			continue
		}
		if !p.HasDocGo {
			missing = append(missing, p.Path)
		}
	}
	fmt.Fprintf(w, "- Packages WITHOUT doc.go: %d\n", len(missing))
	if len(missing) > 0 {
		fmt.Fprintln(w)
		fmt.Fprintln(w, "<details><summary>List</summary>")
		fmt.Fprintln(w)
		for _, p := range missing {
			fmt.Fprintf(w, "- `%s`\n", p)
		}
		fmt.Fprintln(w)
		fmt.Fprintln(w, "</details>")
	}
}
