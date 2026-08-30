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
// This tool is additive and is not wired into runtime binaries.
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

// frozenPackages enumerates packages whose .go file count must not grow
// between baseline and HEAD. Add a package here when it is declared frozen.
var frozenPackages = []string{
	"internal/api",
}

// forbiddenEdges enumerates layering violations the tool flags. Each entry
// is "<from-glob> -> <to-glob>" where globs are evaluated as path prefixes
// (trailing /* means "or any subpackage").
//
// Baseline files capture pre-existing violations at the moment a rule is
// added; only new violations fail the gate. Per-package ratchets in
// violations-allowlist.json keep legacy packages shrinking instead of growing.
var forbiddenEdges = []forbiddenEdge{
	// ----------------------------------------------------------------------
	// Baseline architecture rules
	// ----------------------------------------------------------------------

	// cmd binaries are entry points. The HTTP API composition root lives
	// in internal/app, so cmd packages must not import internal/api directly.
	{From: "cmd", FromAny: true, To: "internal/api"},

	// ----------------------------------------------------------------------
	// Clean Architecture DAG — domain layer (entities)
	// Domain knows nothing about adapters, persistence, transport, or even
	// its own ports. Ports live at the consumer service boundary.
	// ----------------------------------------------------------------------

	{From: "internal/domain", FromAny: true, To: "internal/adapter", ToAny: true},
	{From: "internal/domain", FromAny: true, To: "internal/database"},
	{From: "internal/domain", FromAny: true, To: "internal/models", ToAny: true},
	{From: "internal/domain", FromAny: true, To: "internal/port", ToAny: true},
	{From: "internal/domain", FromAny: true, To: "internal/handler", ToAny: true},
	{From: "internal/domain", FromAny: true, To: "internal/api"},
	{From: "internal/domain", FromAny: true, To: "internal/app", ToAny: true},

	// ----------------------------------------------------------------------
	// Clean Architecture DAG — port layer (interface contracts only)
	// Ports must depend only on domain types. No implementations.
	// ----------------------------------------------------------------------

	{From: "internal/port", FromAny: true, To: "internal/adapter", ToAny: true},
	{From: "internal/port", FromAny: true, To: "internal/database"},
	{From: "internal/port", FromAny: true, To: "internal/handler", ToAny: true},
	{From: "internal/port", FromAny: true, To: "internal/app", ToAny: true},
	{From: "internal/port", FromAny: true, To: "internal/api"},

	// ----------------------------------------------------------------------
	// Clean Architecture DAG — adapter layer (never reaches up)
	// Adapters implement ports. They depend on domain + infra SDKs only.
	// ----------------------------------------------------------------------

	{From: "internal/adapter", FromAny: true, To: "internal/handler", ToAny: true},
	{From: "internal/adapter", FromAny: true, To: "internal/app", ToAny: true},
	{From: "internal/adapter", FromAny: true, To: "internal/api"},

	// ----------------------------------------------------------------------
	// Clean Architecture DAG — app/*svc layer (use cases ≠ transport)
	// Use cases orchestrate domain + ports. They must not depend on HTTP
	// handlers or the legacy internal/api router. The composition root
	// (internal/app top-level) is the explicit carve-out — it is THE place
	// where transport, adapters, and svcs are wired together.
	// ----------------------------------------------------------------------

	{From: "internal/app", FromAny: true, To: "internal/handler", ToAny: true,
		ExceptFrom: []string{"internal/app"}},
	{From: "internal/app", FromAny: true, To: "internal/api",
		ExceptFrom: []string{"internal/app"}},

	// ----------------------------------------------------------------------
	// Clean Architecture DAG — handler layer (thin transport adapters)
	// Handlers parse HTTP, call svc, write response. They must not reach
	// into persistence, adapters, vendor SDKs, or infrastructure clients.
	// Everything goes through internal/app/*svc + ports.
	// ----------------------------------------------------------------------

	{From: "internal/handler", FromAny: true, To: "internal/database"},
	{From: "internal/handler", FromAny: true, To: "internal/adapter", ToAny: true},
	{From: "internal/handler", FromAny: true, To: "internal/tesla", ToAny: true},
	{From: "internal/handler", FromAny: true, To: "internal/mqtt", ToAny: true},
	{From: "internal/handler", FromAny: true, To: "internal/redis", ToAny: true},
	{From: "internal/handler", FromAny: true, To: "internal/geocoding", ToAny: true},

	// ----------------------------------------------------------------------
	// Clean Architecture DAG — models (persistence + transport DTOs)
	// internal/models is retained as a DTO leaf: it must not depend on
	// any other layer. Handlers, adapters, and services map to/from models.
	// ----------------------------------------------------------------------

	// FromAny:true ensures each internal/models/<sub> subpackage inherits
	// the DTO-leaf contract. Mirrors arch_test TestModelsImportsRestricted
	// and rules.go (Source: "internal/models/...").
	{From: "internal/models", FromAny: true, To: "internal/database"},
	{From: "internal/models", FromAny: true, To: "internal/adapter", ToAny: true},
	{From: "internal/models", FromAny: true, To: "internal/handler", ToAny: true},
	{From: "internal/models", FromAny: true, To: "internal/app", ToAny: true},
	{From: "internal/models", FromAny: true, To: "internal/api"},
}

type forbiddenEdge struct {
	From    string
	FromAny bool // true means From or any subpackage
	To      string
	ToAny   bool // true means To or any subpackage
	// ExceptFrom lists exact package paths exempted from the rule. Used
	// for legitimate composition-root carve-outs (e.g. internal/app top-
	// level wires internal/api, but internal/app/*svc subpackages must
	// not). Empty for the common case.
	ExceptFrom []string
}

func (e forbiddenEdge) Label() string {
	from, to := e.From, e.To
	if e.FromAny {
		from += "/*"
	}
	if e.ToAny {
		to += "/*"
	}
	s := from + " -> " + to
	if len(e.ExceptFrom) > 0 {
		s += " (except: " + strings.Join(e.ExceptFrom, ",") + ")"
	}
	return s
}

func (e forbiddenEdge) matchesFrom(pkg string) bool {
	for _, x := range e.ExceptFrom {
		if pkg == x {
			return false
		}
	}
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

// hotspotPlan declares the bounded-context restructure target for a
// currently flat hot-spot folder. It is report-only: emitted in Markdown
// so progress is visible, but never used to fail the gate until the
// subpackages exist on disk.
//
// The target list mirrors docs/architecture/migration/cluster-map.md and
// should be updated whenever the cluster map changes.
//
// Parent dir is interpreted as a glob-prefix matching every PkgMetric whose
// Path starts with Parent + "/" (or equals Parent for the parent package
// itself, which counts toward FileCountAtR0).
type hotspotPlan struct {
	Parent        string   // e.g. "internal/api"
	Owner         string   // workstream label that owns the split
	FileCountAtR0 int      // baseline .go/.ts/.tsx file count for this plan
	Targets       []string // intended subpackage / subdir names
	Shared        []string // shared-helper subpackages extracted alongside
	Notes         string   // optional commentary
}

// plannedSubpackages is the live snapshot of the restructure plan. Each
// entry corresponds to one flat-folder hot-spot. The Markdown report
// shows, per hot-spot, how many planned subpackages now exist on disk
// and how many flat-parent files remain.
var plannedSubpackages = []hotspotPlan{
	// ----------------------------------------------------------------------
	// Backend hot-spots
	// ----------------------------------------------------------------------
	{
		Parent:        "internal/models",
		Owner:         "R5",
		FileCountAtR0: 36,
		Targets: []string{
			"alert", "auth", "automation", "backup", "charging", "chatbot",
			"dashboard", "drive", "energy", "export", "geo", "notification",
			"security", "settings", "signal", "system", "telemetry", "tesla",
			"vehicle",
		},
		Notes: "19 subpkgs (R5.0 expanded from 12 after models.go classification: +auth, +backup, +chatbot, +energy, +export, +geo, +settings). models.go split into its targets; unused DerefFloat64/String/Bool helpers deleted per no-tech-debt mandate. Smallest-first execution; parent retains only doc.go after R5 completes.",
	},
	{
		Parent:        "internal/jobs",
		Owner:         "R6",
		FileCountAtR0: 23,
		Targets: []string{
			"embeddings", "indexers", "triage", "digests",
		},
		Notes: "4 subpkgs: embeddings (done R0.5), indexers (7 ai_*_indexer + tests), triage (alert+feedback), digests (weekly+yir).",
	},
	{
		Parent:        "internal/ai/tools",
		Owner:         "R6",
		FileCountAtR0: 109,
		Targets: []string{
			"alert", "automation", "battery", "charging", "diagnostics",
			"drive", "feedback", "forecast", "location", "nl", "safety",
			"share", "summary",
		},
		Notes: "13 subpkgs from R1 audit. Per ADR-015 amendment, pure file-move only. Registry/schema/builtins/tool/validate stay at parent.",
	},
	{
		Parent:        "internal/database",
		Owner:         "R4",
		FileCountAtR0: 143,
		Targets: []string{
			"achievement", "ai", "alert", "audit", "auth", "automation",
			"backup", "charging", "dashboard", "drive", "energy", "export",
			"feedback", "geo", "ingest", "notification", "onboarding",
			"settings", "signal", "system", "tesla", "vehicle",
		},
		Notes: "22 subpkgs from R1 audit. Touches many internal/api/* callers — accept R2 double-touch budget (no temp compat layer).",
	},
	{
		Parent:        "internal/handler/v1",
		Owner:         "R3",
		FileCountAtR0: 12,
		Targets: []string{
			"admin", "charging", "dashboard", "export", "gdpr",
			"trip", "user", "vehicle", "shared",
		},
		Notes: "9 subpkgs from R1 audit. Tiny but critical — defines destination shape (Mount(r,deps) pattern) for R2 to adopt 1:1.",
	},
	{
		Parent:        "internal/api",
		Owner:         "R2 (waves R2a-R2e)",
		FileCountAtR0: 434,
		Targets: []string{
			// Shared, system, admin-lite, and SSE handlers.
			"system", "health", "sse", "openapi", "devtools", "observability",
			// Read-only resource handlers.
			"analytics", "anomaly", "lifetime", "mileage", "sleep", "regen",
			"vampiredrain", "tco", "tempimpact", "speed", "routeeff",
			"signal", "dataquality", "fsm", "search", "diagnostic", "cost",
			// Core write handlers.
			"vehicle", "vehiclesys", "charging", "drive", "trip",
			"telemetry", "fleet", "energy", "teslaapi",
			// Cross-cutting handlers.
			"ai", "admin", "automation", "alert", "notification",
			"chatbot", "feedback", "data_repair", "dashboard", "saved_views",
			// Final cleanup handlers.
			"auth", "onboarding", "user", "settings", "share", "exports",
			"ingest", "geo", "safety", "bulk", "api_call_log", "audit",
			"maintenance", "software_update", "watch", "webhook", "webvitals",
		},
		Shared: []string{"httpx", "apiparams", "apitest", "middleware"},
		Notes:  "55 subpkgs + 4 shared infra from R1 audit. Largest cluster. Extracted in 5 waves (R2a-R2e). R2.0 prep extracts httpx/apiparams/apitest/middleware first. ai/ has 14 sub-subpkgs (see cluster-map.md).",
	},
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
	// FilesByPackage maps a repo-relative package path (e.g. "internal/api")
	// to the sorted list of production .go file basenames in that package
	// (excludes _test.go). arch_test uses this for the frozen-package
	// guard without rescanning Packages.
	FilesByPackage map[string][]string `json:"files_by_package"`
	// PhaseRProgress is report-only. For each planned hot-spot it records
	// current parent-dir file counts, created subpackages, and files still
	// living at the flat parent. The compare path never uses it for
	// regression detection; it only keeps progress visible in the snapshot.
	PhaseRProgress []HotspotProgress `json:"phase_r_progress,omitempty"`
}

// HotspotProgress is one report-only progress row for a hot-spot.
type HotspotProgress struct {
	Parent              string   `json:"parent"`
	Owner               string   `json:"owner"`
	FileCountAtR0       int      `json:"file_count_at_r0"`
	FlatParentGoFiles   int      `json:"flat_parent_go_files"`   // .go files at the flat parent now
	FlatParentTestFiles int      `json:"flat_parent_test_files"` // _test.go files at the flat parent now
	PlannedSubpkgs      int      `json:"planned_subpkgs"`
	ExistingSubpkgs     []string `json:"existing_subpkgs"`
	MissingSubpkgs      []string `json:"missing_subpkgs"`
	SharedSubpkgs       []string `json:"shared_subpkgs,omitempty"`
	Notes               string   `json:"notes,omitempty"`
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
		FilesByPackage: filesByPackage(out),
		PhaseRProgress: computePhaseRProgress(out),
	}
}

// computePhaseRProgress reports how many planned subpackages exist
// under each hot-spot parent and how many files still live at the flat
// parent. It is informational only and never fails the gate.
func computePhaseRProgress(pkgs []PkgMetric) []HotspotProgress {
	byPath := map[string]PkgMetric{}
	for _, p := range pkgs {
		byPath[p.Path] = p
	}
	out := make([]HotspotProgress, 0, len(plannedSubpackages))
	for _, hs := range plannedSubpackages {
		row := HotspotProgress{
			Parent:         hs.Parent,
			Owner:          hs.Owner,
			FileCountAtR0:  hs.FileCountAtR0,
			PlannedSubpkgs: len(hs.Targets),
			SharedSubpkgs:  hs.Shared,
			Notes:          hs.Notes,
		}
		if parent, ok := byPath[hs.Parent]; ok {
			row.FlatParentGoFiles = parent.GoFiles
			row.FlatParentTestFiles = parent.TestFiles
		}
		for _, t := range hs.Targets {
			if strings.HasPrefix(t, "_") || strings.HasPrefix(t, "matching") {
				// placeholder, not a concrete planned subpkg name yet
				continue
			}
			subpkgPath := hs.Parent + "/" + t
			if _, ok := byPath[subpkgPath]; ok {
				row.ExistingSubpkgs = append(row.ExistingSubpkgs, t)
			} else {
				row.MissingSubpkgs = append(row.MissingSubpkgs, t)
			}
		}
		out = append(out, row)
	}
	return out
}

// filesByPackage builds the per-package production .go file index used
// by arch_test's TestFrozenPackagesNoNewFiles. _test.go files are
// excluded so adding a new test for an existing source file does not
// trigger the frozen-package rule.
func filesByPackage(pkgs []PkgMetric) map[string][]string {
	out := make(map[string][]string, len(pkgs))
	for _, p := range pkgs {
		out[p.Path] = productionGoFiles(p.Files)
	}
	return out
}

func productionGoFiles(files []string) []string {
	production := make([]string, 0, len(files))
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		production = append(production, f)
	}
	sort.Strings(production)
	return production
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
			for _, f := range productionGoFiles(cp.Files) {
				regs = append(regs, fmt.Sprintf("new file in %s/%s (frozen package)", fp, f))
			}
			continue
		}
		baseFiles := map[string]bool{}
		for _, f := range productionGoFiles(bp.Files) {
			baseFiles[f] = true
		}
		for _, f := range productionGoFiles(cp.Files) {
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

	// Legacy-shrink-only ratchet: each violations-allowlist.json entry
	// caps the .go file count for a flat-parent legacy package. Counts
	// can only decrease as files move into subpackages. Missing allowlist
	// files are skipped so the tool stays usable during rollout.
	if al, err := loadViolationsAllowlist("tools/archmetrics/violations-allowlist.json"); err == nil {
		curHotspots := flatParentGoCounts(cur)
		for _, entry := range al.Packages {
			n, ok := curHotspots[entry.Path]
			if !ok {
				continue
			}
			if n > entry.MaxFiles {
				regs = append(regs, fmt.Sprintf(
					"legacy package %s grew above ratchet: %d > %d max_files (owner: %s). Either DELETE the new file or carve it into a subpackage; updating max_files upward is NEVER acceptable.",
					entry.Path, n, entry.MaxFiles, entry.Owner,
				))
			}
		}
	}

	sort.Strings(regs)
	return regs
}

// violationsAllowlist mirrors the JSON file at
// tools/archmetrics/violations-allowlist.json. See file for semantics.
type violationsAllowlist struct {
	Packages []violationsAllowlistEntry `json:"packages"`
}

type violationsAllowlistEntry struct {
	Path     string `json:"path"`
	MaxFiles int    `json:"max_files"`
	Owner    string `json:"owner"`
	Notes    string `json:"notes,omitempty"`
}

// loadViolationsAllowlist reads the per-legacy-package ratchet file.
// Missing file is NOT an error — returns ErrNotExist so callers can
// silently skip the ratchet check during transitional rollout.
func loadViolationsAllowlist(path string) (violationsAllowlist, error) {
	var al violationsAllowlist
	data, err := os.ReadFile(path)
	if err != nil {
		return al, err
	}
	if err := json.Unmarshal(data, &al); err != nil {
		return al, fmt.Errorf("parse %s: %w", path, err)
	}
	return al, nil
}

// flatParentGoCounts returns the production .go file count at each flat
// parent package, matching PkgMetric.GoFiles and the Markdown report's
// PhaseRProgress.FlatParentGoFiles value.
func flatParentGoCounts(s Snapshot) map[string]int {
	out := map[string]int{}
	for _, p := range s.Packages {
		out[p.Path] = p.GoFiles
	}
	return out
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

	if len(s.PhaseRProgress) > 0 {
		fmt.Fprintln(w)
		fmt.Fprintln(w, "## Phase R — bounded-context restructure progress (REPORT-ONLY)")
		fmt.Fprintln(w)
		fmt.Fprintln(w, "_Per ADR-011 (`docs/architecture/adr/011-bounded-context-subpackages.md`). "+
			"This section is informational only — it never fails the gate. The DAG flip to enforced "+
			"per-subpkg rules happens in Phase R13._")
		fmt.Fprintln(w)
		fmt.Fprintln(w, "| Hot-spot | Owner | Files@R0 | Flat parent now (.go / _test.go) | Planned | Existing | Missing |")
		fmt.Fprintln(w, "|---|---|---:|---|---:|---:|---:|")
		for _, r := range s.PhaseRProgress {
			fmt.Fprintf(w, "| `%s` | %s | %d | %d / %d | %d | %d | %d |\n",
				r.Parent, r.Owner, r.FileCountAtR0,
				r.FlatParentGoFiles, r.FlatParentTestFiles,
				r.PlannedSubpkgs, len(r.ExistingSubpkgs), len(r.MissingSubpkgs))
		}
		fmt.Fprintln(w)
		for _, r := range s.PhaseRProgress {
			if len(r.ExistingSubpkgs) == 0 && len(r.MissingSubpkgs) == 0 {
				continue
			}
			fmt.Fprintf(w, "### `%s` detail\n\n", r.Parent)
			if r.Notes != "" {
				fmt.Fprintf(w, "> %s\n\n", r.Notes)
			}
			if len(r.ExistingSubpkgs) > 0 {
				fmt.Fprintln(w, "**Existing subpackages on disk:**")
				for _, t := range r.ExistingSubpkgs {
					fmt.Fprintf(w, "- `%s/%s`\n", r.Parent, t)
				}
				fmt.Fprintln(w)
			}
			if len(r.MissingSubpkgs) > 0 {
				fmt.Fprintln(w, "**Planned but not yet on disk:**")
				for _, t := range r.MissingSubpkgs {
					fmt.Fprintf(w, "- `%s/%s`\n", r.Parent, t)
				}
				fmt.Fprintln(w)
			}
			if len(r.SharedSubpkgs) > 0 {
				fmt.Fprintln(w, "**Shared-helper subpackages (extracted in prep sub-phase):**")
				for _, t := range r.SharedSubpkgs {
					fmt.Fprintf(w, "- `%s/%s`\n", r.Parent, t)
				}
				fmt.Fprintln(w)
			}
		}
	}
}
