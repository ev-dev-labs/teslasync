package arch

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"golang.org/x/tools/go/packages"
)

const modulePath = "github.com/ev-dev-labs/teslasync"

type edge struct{ src, tgt string }

func TestForbiddenEdges(t *testing.T) {
	cfg := &packages.Config{
		Mode: packages.NeedName | packages.NeedImports | packages.NeedDeps,
		Dir:  "../..",
	}
	pkgs, err := packages.Load(cfg, "./...")
	if err != nil {
		t.Fatalf("packages.Load: %v", err)
	}

	violations := map[edge]string{}
	advisories := map[edge]string{}

	for _, p := range pkgs {
		src := strings.TrimPrefix(p.PkgPath, modulePath+"/")
		for tgt := range p.Imports {
			tgtRel := strings.TrimPrefix(tgt, modulePath+"/")
			if !strings.HasPrefix(tgtRel, "internal/") && !strings.HasPrefix(tgtRel, "cmd/") {
				continue
			}
			for _, rule := range ForbiddenEdges {
				if !matches(src, rule.Source) || !matches(tgtRel, rule.Target) {
					continue
				}
				if isException(src, tgtRel) {
					continue
				}
				if AdvisorySources[rule.Source] {
					advisories[edge{src, tgtRel}] = rule.Reason
				} else {
					violations[edge{src, tgtRel}] = rule.Reason
				}
			}
		}
	}

	for _, e := range sortedEdges(advisories) {
		t.Logf("ADVISORY (will fail in future prompt): %s -> %s :: %s", e.src, e.tgt, advisories[e])
	}

	if len(violations) == 0 {
		return
	}
	for _, e := range sortedEdges(violations) {
		t.Errorf("FORBIDDEN: %s -> %s :: %s", e.src, e.tgt, violations[e])
	}
}

func sortedEdges(m map[edge]string) []edge {
	keys := make([]edge, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].src != keys[j].src {
			return keys[i].src < keys[j].src
		}
		return keys[i].tgt < keys[j].tgt
	})
	return keys
}

func matches(pkg, pattern string) bool {
	if pattern == pkg {
		return true
	}
	if strings.HasSuffix(pattern, "/...") {
		prefix := strings.TrimSuffix(pattern, "/...")
		return pkg == prefix || strings.HasPrefix(pkg, prefix+"/")
	}
	return false
}

func isException(src, tgt string) bool {
	for _, e := range AllowedExceptions {
		if e.Source == src && e.Target == tgt {
			return true
		}
	}
	return false
}

// baselinePackage mirrors the JSON written by tools/archmetrics so we
// can read it without importing that command's internal types.
type baselinePackage struct {
	Path     string `json:"path"`
	GoFiles  int    `json:"go_files"`
	HasDocGo bool   `json:"has_doc_go"`
}

type baselineSnapshot struct {
	Packages      []baselinePackage `json:"packages"`
	DocGoCoverage float64           `json:"doc_go_coverage"`
}

func loadBaselineOrSkip(t *testing.T, path string) *baselineSnapshot {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var s baselineSnapshot
	if err := json.Unmarshal(data, &s); err != nil {
		t.Fatalf("decode baseline %s: %v", path, err)
	}
	return &s
}

// TestBaselineHonoured cross-checks tools/archmetrics/baseline.json against
// the live tree: the count of internal/ packages must not drop, and the
// doc.go coverage of internal/ packages must not drop.
func TestBaselineHonoured(t *testing.T) {
	base := loadBaselineOrSkip(t, filepath.Join("..", "..", "tools", "archmetrics", "baseline.json"))
	if base == nil {
		t.Skip("no baseline file yet (phase-47/01 prerequisite)")
	}

	baseInternalPkgs := 0
	baseInternalDocGo := 0
	for _, p := range base.Packages {
		if !strings.HasPrefix(p.Path, "internal/") || p.GoFiles == 0 {
			continue
		}
		baseInternalPkgs++
		if p.HasDocGo {
			baseInternalDocGo++
		}
	}
	baseCov := 0.0
	if baseInternalPkgs > 0 {
		baseCov = float64(baseInternalDocGo) / float64(baseInternalPkgs)
	}

	curPkgs, curDocGo := walkInternal(t, filepath.Join("..", ".."))
	curCov := 0.0
	if curPkgs > 0 {
		curCov = float64(curDocGo) / float64(curPkgs)
	}

	if curPkgs < baseInternalPkgs {
		t.Errorf("internal/ package count dropped: baseline=%d, current=%d (did a package get deleted without refreshing the baseline?)",
			baseInternalPkgs, curPkgs)
	}
	if curCov+1e-9 < baseCov {
		t.Errorf("internal/ doc.go coverage dropped: baseline=%.1f%%, current=%.1f%% (did a doc.go get deleted without refreshing the baseline?)",
			baseCov*100, curCov*100)
	}
}

func walkInternal(t *testing.T, repoRoot string) (pkgs int, docGo int) {
	t.Helper()
	root := filepath.Join(repoRoot, "internal")
	seen := map[string]bool{}
	docGoSeen := map[string]bool{}
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		dir := filepath.ToSlash(filepath.Dir(path))
		base := filepath.Base(path)
		if !strings.HasSuffix(base, "_test.go") {
			seen[dir] = true
		}
		if base == "doc.go" {
			docGoSeen[dir] = true
		}
		return nil
	})
	for dir := range seen {
		pkgs++
		if docGoSeen[dir] {
			docGo++
		}
	}
	return pkgs, docGo
}

// TestEveryInternalPackageHasDocGoWithLayer enforces phase-47/03: every
// package under internal/, cmd/, or tools/ that ships at least one .go
// file MUST have a doc.go containing a `// Layer: <name>` declaration
// from the closed set { domain, port, adapter, app, handler, platform,
// cmd-internal, tool }. testdata/ trees are skipped (golden fixtures).
func TestEveryInternalPackageHasDocGoWithLayer(t *testing.T) {
	root := filepath.Join("..", "..")
	validLayers := map[string]bool{
		"domain": true, "port": true, "adapter": true,
		"app": true, "handler": true, "platform": true,
		"cmd-internal": true, "tool": true,
	}
	missing := []string{}
	bad := []string{}

	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(root, p)
		rel = filepath.ToSlash(rel)
		if !(strings.HasPrefix(rel, "internal/") || strings.HasPrefix(rel, "cmd/") || strings.HasPrefix(rel, "tools/")) {
			return nil
		}
		// skip testdata/ subtrees — they hold golden fixtures, not packages
		if strings.Contains(rel, "/testdata/") || strings.HasSuffix(rel, "/testdata") {
			return filepath.SkipDir
		}
		hasGo := false
		entries, _ := os.ReadDir(p)
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".go") {
				hasGo = true
				break
			}
		}
		if !hasGo {
			return nil
		}
		docPath := filepath.Join(p, "doc.go")
		body, err := os.ReadFile(docPath)
		if err != nil {
			missing = append(missing, rel)
			return nil
		}
		layer := parseLayer(string(body))
		if layer == "" {
			bad = append(bad, rel+" (missing // Layer: line)")
		} else if !validLayers[layer] {
			bad = append(bad, rel+" (invalid layer: "+layer+")")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	sort.Strings(missing)
	sort.Strings(bad)
	if len(missing) > 0 {
		t.Errorf("packages missing doc.go (%d):\n  %s", len(missing), strings.Join(missing, "\n  "))
	}
	if len(bad) > 0 {
		t.Errorf("packages with invalid doc.go (%d):\n  %s", len(bad), strings.Join(bad, "\n  "))
	}
}

var layerRE = regexp.MustCompile(`(?m)^// Layer:\s*([a-z\-]+)\s*$`)

func parseLayer(src string) string {
	m := layerRE.FindStringSubmatch(src)
	if len(m) != 2 {
		return ""
	}
	return m[1]
}

