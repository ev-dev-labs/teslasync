package arch

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
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
	Path     string   `json:"path"`
	GoFiles  int      `json:"go_files"`
	HasDocGo bool     `json:"has_doc_go"`
	Files    []string `json:"files"`
}

type baselineSnapshot struct {
	Packages       []baselinePackage   `json:"packages"`
	DocGoCoverage  float64             `json:"doc_go_coverage"`
	FilesByPackage map[string][]string `json:"files_by_package"`
}

// goFilesIn returns the production-source .go files (no _test.go) that
// the baseline records for the given package path. The lookup prefers
// the explicit FilesByPackage map populated by phase-47/06; for older
// baselines without that field it falls back to scanning Packages.
func (s *baselineSnapshot) goFilesIn(pkg string) []string {
	if files, ok := s.FilesByPackage[pkg]; ok {
		return files
	}
	for _, p := range s.Packages {
		if p.Path != pkg {
			continue
		}
		out := make([]string, 0, len(p.Files))
		for _, f := range p.Files {
			if !strings.HasSuffix(f, "_test.go") {
				out = append(out, f)
			}
		}
		return out
	}
	return nil
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

// TestFrozenPackagesNoNewFiles enforces ADR-009 (phase-47/06): packages
// listed in FrozenPackages must not gain new production .go files
// relative to tools/archmetrics/baseline.json. _test.go files for
// existing source files are exempt — tests must live in the same Go
// package as the code under test.
//
// To intentionally add a file:
//  1. Get explicit reviewer approval citing why handler/v1 is unsuitable.
//  2. Add the file.
//  3. Refresh the baseline (`go run ./tools/archmetrics > tools/archmetrics/baseline.json`).
//  4. Commit the baseline alongside the new file.
//  5. Reference the ADR-009 Exceptions block in the PR description.
func TestFrozenPackagesNoNewFiles(t *testing.T) {
	baseline := loadBaselineOrSkip(t, filepath.Join("..", "..", "tools", "archmetrics", "baseline.json"))
	if baseline == nil {
		t.Skip("no baseline file (phase-47/01 prerequisite)")
	}
	for _, frozen := range FrozenPackages {
		live := liveProductionGoFiles(t, filepath.Join("..", "..", frozen))
		base := stringSet(baseline.goFilesIn(frozen))
		var added []string
		for _, f := range live {
			if !base[f] {
				added = append(added, f)
			}
		}
		sort.Strings(added)
		if len(added) > 0 {
			t.Errorf("FROZEN PACKAGE %s has %d new file(s) not in baseline:\n  %s\n  → ADR-009 forbids new files here. Add the new endpoint to internal/handler/v1 OR refresh tools/archmetrics/baseline.json if this is an intentional exception.",
				frozen, len(added), strings.Join(added, "\n  "))
		}
	}
}

func liveProductionGoFiles(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read frozen package dir %s: %v", dir, err)
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") {
			continue
		}
		if strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		out = append(out, e.Name())
	}
	sort.Strings(out)
	return out
}

func stringSet(values []string) map[string]bool {
	out := make(map[string]bool, len(values))
	for _, v := range values {
		out[v] = true
	}
	return out
}

// TestDomainPurity enforces ADR-006 (phase-47/07): packages under
// internal/domain/* may import only stdlib and other internal/domain/*
// subpackages (including the parent internal/domain package).
// Persistence (internal/database, internal/adapter/*), transport
// (internal/api, internal/handler/*), use cases (internal/app/*), and
// ports (internal/port/*) are forbidden imports.
func TestDomainPurity(t *testing.T) {
	cfg := &packages.Config{
		Mode: packages.NeedName | packages.NeedImports,
		Dir:  filepath.Join("..", ".."),
	}
	pkgs, err := packages.Load(cfg, "./internal/domain/...")
	if err != nil {
		t.Fatalf("packages.Load: %v", err)
	}
	if len(pkgs) == 0 {
		t.Fatal("packages.Load returned no packages for ./internal/domain/...")
	}

	type violation struct {
		pkg, dep string
	}
	var bad []violation
	for _, p := range pkgs {
		for tgt := range p.Imports {
			rel := strings.TrimPrefix(tgt, modulePath+"/")
			if !strings.HasPrefix(rel, "internal/") {
				continue
			}
			if rel == "internal/domain" {
				continue
			}
			if strings.HasPrefix(rel, "internal/domain/") {
				continue
			}
			bad = append(bad, violation{pkg: p.PkgPath, dep: tgt})
		}
	}

	sort.Slice(bad, func(i, j int) bool {
		if bad[i].pkg != bad[j].pkg {
			return bad[i].pkg < bad[j].pkg
		}
		return bad[i].dep < bad[j].dep
	})
	for _, v := range bad {
		t.Errorf("DOMAIN PURITY (ADR-006): %s imports %s — only stdlib + internal/domain/* allowed",
			v.pkg, v.dep)
	}
}

// TestModelsHaveStructTags enforces ADR-006 (phase-47/07): every
// exported field of every exported struct under internal/models/*.go
// (excluding *_test.go) must carry at least one struct tag containing
// `db:` or `json:`. Embedded fields (no field names) and fields whose
// names are all unexported are skipped.
func TestModelsHaveStructTags(t *testing.T) {
	dir := filepath.Join("..", "models")
	fset := token.NewFileSet()

	type miss struct {
		file, typ, field string
	}
	var misses []miss

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		base := filepath.Base(path)
		if !strings.HasSuffix(base, ".go") || strings.HasSuffix(base, "_test.go") {
			return nil
		}
		f, perr := parser.ParseFile(fset, path, nil, parser.ParseComments)
		if perr != nil {
			return perr
		}
		ast.Inspect(f, func(n ast.Node) bool {
			ts, ok := n.(*ast.TypeSpec)
			if !ok {
				return true
			}
			if !ts.Name.IsExported() {
				return true
			}
			st, ok := ts.Type.(*ast.StructType)
			if !ok {
				return true
			}
			if st.Fields == nil {
				return true
			}
			for _, field := range st.Fields.List {
				if len(field.Names) == 0 {
					continue
				}
				anyExported := false
				for _, fn := range field.Names {
					if fn.IsExported() {
						anyExported = true
						break
					}
				}
				if !anyExported {
					continue
				}
				if field.Tag == nil {
					misses = append(misses, miss{file: path, typ: ts.Name.Name, field: field.Names[0].Name})
					continue
				}
				tagVal := field.Tag.Value
				if !strings.Contains(tagVal, "db:") && !strings.Contains(tagVal, "json:") {
					misses = append(misses, miss{file: path, typ: ts.Name.Name, field: field.Names[0].Name})
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("walk %s: %v", dir, err)
	}

	sort.Slice(misses, func(i, j int) bool {
		if misses[i].file != misses[j].file {
			return misses[i].file < misses[j].file
		}
		if misses[i].typ != misses[j].typ {
			return misses[i].typ < misses[j].typ
		}
		return misses[i].field < misses[j].field
	})
	for _, m := range misses {
		t.Errorf("MODELS TAGS (ADR-006): %s: type %s field %s missing struct tag (db: or json: required)",
			m.file, m.typ, m.field)
	}
}

// TestModelsImportsRestricted enforces ADR-006 (phase-47/07): packages
// under internal/models AND all bounded-context subpackages
// internal/models/<sub> may NOT import internal/database,
// internal/adapter/*, internal/api, internal/handler/*,
// internal/app/*, or internal/port/*. Imports of stdlib and
// internal/domain/* (for ToDomain helpers) are explicitly allowed.
//
// Phase-R5.0 (2026-05-28): widened load path from "./internal/models"
// to "./internal/models/..." so newly-created bounded-context
// subpackages inherit the DTO-leaf contract automatically.
func TestModelsImportsRestricted(t *testing.T) {
	cfg := &packages.Config{
		Mode: packages.NeedName | packages.NeedImports,
		Dir:  filepath.Join("..", ".."),
	}
	pkgs, err := packages.Load(cfg, "./internal/models/...")
	if err != nil {
		t.Fatalf("packages.Load: %v", err)
	}
	if len(pkgs) == 0 {
		t.Fatal("packages.Load returned no packages for ./internal/models/...")
	}

	type violation struct {
		pkg, dep string
	}
	var bad []violation
	for _, p := range pkgs {
		for tgt := range p.Imports {
			rel := strings.TrimPrefix(tgt, modulePath+"/")
			if !strings.HasPrefix(rel, "internal/") {
				continue
			}
			for _, forbidden := range ModelsForbiddenImports {
				if rel == forbidden || strings.HasPrefix(rel, forbidden+"/") {
					bad = append(bad, violation{pkg: p.PkgPath, dep: tgt})
					break
				}
			}
		}
	}

	sort.Slice(bad, func(i, j int) bool {
		if bad[i].pkg != bad[j].pkg {
			return bad[i].pkg < bad[j].pkg
		}
		return bad[i].dep < bad[j].dep
	})
	for _, v := range bad {
		t.Errorf("MODELS IMPORTS (ADR-006): %s imports forbidden %s", v.pkg, v.dep)
	}
}

// TestPlatformSubpackagesGated enforces ADR-007 (phase-47/08): the
// directories directly under internal/platform/ must match the closed
// set in AllowedPlatformSubpackages. Adding a new subpackage requires
// an ADR-007 amendment AND updating AllowedPlatformSubpackages in the
// same commit.
func TestPlatformSubpackagesGated(t *testing.T) {
	root := filepath.Join("..", "..", "internal", "platform")
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("readdir %s: %v", root, err)
	}
	allowed := stringSet(AllowedPlatformSubpackages)
	var unauthorised []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if !allowed[e.Name()] {
			unauthorised = append(unauthorised, e.Name())
		}
	}
	sort.Strings(unauthorised)
	for _, name := range unauthorised {
		t.Errorf("UNAUTHORISED PLATFORM SUBPACKAGE (ADR-007): internal/platform/%s — add to internal/arch/rules.go::AllowedPlatformSubpackages with an ADR-007 amendment, or move to a specific layer (internal/domain, internal/adapter, internal/handler, internal/app, internal/port)", name)
	}
}

// TestPortPurity enforces the phase-47/09 hexagonal contract for ports:
// every package under internal/port/* may import only stdlib, the
// parent internal/port package, sibling internal/port/* packages, and
// internal/domain/* (entity types appearing in port signatures).
// Adapters, persistence, transport, app services, platform, models —
// all forbidden.
func TestPortPurity(t *testing.T) {
	cfg := &packages.Config{
		Mode: packages.NeedName | packages.NeedImports,
		Dir:  filepath.Join("..", ".."),
	}
	pkgs, err := packages.Load(cfg, "./internal/port/...")
	if err != nil {
		t.Fatalf("packages.Load: %v", err)
	}
	if len(pkgs) == 0 {
		t.Fatal("packages.Load returned no packages for ./internal/port/...")
	}

	type violation struct {
		pkg, dep string
	}
	var bad []violation
	for _, p := range pkgs {
		for tgt := range p.Imports {
			rel := strings.TrimPrefix(tgt, modulePath+"/")
			if !strings.HasPrefix(rel, "internal/") {
				continue
			}
			if isAllowedInternalImport(rel, PortAllowedInternalImports) {
				continue
			}
			if isException(strings.TrimPrefix(p.PkgPath, modulePath+"/"), rel) {
				continue
			}
			bad = append(bad, violation{pkg: p.PkgPath, dep: tgt})
		}
	}

	sort.Slice(bad, func(i, j int) bool {
		if bad[i].pkg != bad[j].pkg {
			return bad[i].pkg < bad[j].pkg
		}
		return bad[i].dep < bad[j].dep
	})
	for _, v := range bad {
		t.Errorf("PORT PURITY (phase-47/09): %s imports %s — only stdlib + internal/domain/* + internal/port/* allowed",
			v.pkg, v.dep)
	}
}

// TestAdapterPurity enforces the phase-47/09 hexagonal contract for
// adapters: no package under internal/adapter/* may import any of the
// prefixes in AdapterForbiddenImports (internal/api, internal/handler/*,
// internal/app/*). Adapters live at the bottom of the dependency stack
// and must depend only on the abstractions (ports), entities (domain),
// scan targets (models), platform utilities, and 3rd-party drivers.
// Cross-layer wiring belongs in cmd/ and internal/app, never here.
func TestAdapterPurity(t *testing.T) {
	cfg := &packages.Config{
		Mode: packages.NeedName | packages.NeedImports,
		Dir:  filepath.Join("..", ".."),
	}
	pkgs, err := packages.Load(cfg, "./internal/adapter/...")
	if err != nil {
		t.Fatalf("packages.Load: %v", err)
	}
	if len(pkgs) == 0 {
		t.Fatal("packages.Load returned no packages for ./internal/adapter/...")
	}

	type violation struct {
		pkg, dep string
	}
	var bad []violation
	for _, p := range pkgs {
		for tgt := range p.Imports {
			rel := strings.TrimPrefix(tgt, modulePath+"/")
			if !strings.HasPrefix(rel, "internal/") {
				continue
			}
			if !isOnDenyList(rel, AdapterForbiddenImports) {
				continue
			}
			if isException(strings.TrimPrefix(p.PkgPath, modulePath+"/"), rel) {
				continue
			}
			bad = append(bad, violation{pkg: p.PkgPath, dep: tgt})
		}
	}

	sort.Slice(bad, func(i, j int) bool {
		if bad[i].pkg != bad[j].pkg {
			return bad[i].pkg < bad[j].pkg
		}
		return bad[i].dep < bad[j].dep
	})
	for _, v := range bad {
		t.Errorf("ADAPTER PURITY (phase-47/09): %s imports forbidden %s — adapters must not depend on transport, app, or handler layers",
			v.pkg, v.dep)
	}
}

// TestHandlerV1Thinness enforces the phase-47/10 contract: files under
// internal/handler/v1 MUST NOT import internal/database,
// internal/platform/database, internal/adapter/*, internal/models, or
// internal/api. Handlers stay thin — they decode requests, call
// internal/app/<name>svc use cases, and encode DTOs from
// internal/handler/dto.
//
// internal/api is FROZEN per ADR-009 and explicitly exempt from this
// rule; its existing handlers freely query the database until each one
// migrates to internal/handler/v1.
func TestHandlerV1Thinness(t *testing.T) {
	cfg := &packages.Config{
		Mode: packages.NeedName | packages.NeedImports,
		Dir:  filepath.Join("..", ".."),
	}
	pkgs, err := packages.Load(cfg, "./internal/handler/v1/...")
	if err != nil {
		t.Fatalf("packages.Load: %v", err)
	}
	if len(pkgs) == 0 {
		t.Fatal("packages.Load returned no packages for ./internal/handler/v1/...")
	}

	type violation struct {
		pkg, dep, hint string
	}
	var bad []violation
	for _, p := range pkgs {
		src := strings.TrimPrefix(p.PkgPath, modulePath+"/")
		for tgt := range p.Imports {
			rel := strings.TrimPrefix(tgt, modulePath+"/")
			if !strings.HasPrefix(rel, "internal/") {
				continue
			}
			if !isOnDenyList(rel, HandlerV1ForbiddenImports) {
				continue
			}
			if isException(src, rel) {
				continue
			}
			bad = append(bad, violation{pkg: p.PkgPath, dep: tgt, hint: thinnessHint(rel)})
		}
	}

	sort.Slice(bad, func(i, j int) bool {
		if bad[i].pkg != bad[j].pkg {
			return bad[i].pkg < bad[j].pkg
		}
		return bad[i].dep < bad[j].dep
	})
	for _, v := range bad {
		t.Errorf("HANDLER THINNESS (phase-47/10): %s imports forbidden %s — %s",
			v.pkg, v.dep, v.hint)
	}
}

func thinnessHint(forbidden string) string {
	switch {
	case forbidden == "internal/database" || forbidden == "internal/platform/database":
		return "call internal/app/<name>svc instead"
	case strings.HasPrefix(forbidden, "internal/adapter"):
		return "depend on internal/port/* interfaces instead, wire concrete adapter in cmd or internal/app"
	case forbidden == "internal/models":
		return "use internal/handler/dto for transport DTOs (ADR-006)"
	case forbidden == "internal/api":
		return "internal/api is FROZEN per ADR-009; the new home is internal/handler/v1"
	default:
		return "see phase-47/10 prompt for the thin-handler contract"
	}
}

// isAllowedInternalImport returns true when rel matches the parent
// prefix exactly OR rel is rooted under "<prefix>/" for any prefix in
// the allow list.
func isAllowedInternalImport(rel string, allowed []string) bool {
	for _, prefix := range allowed {
		if rel == prefix || strings.HasPrefix(rel, prefix+"/") {
			return true
		}
	}
	return false
}

// isOnDenyList returns true when rel matches any deny-list prefix
// either exactly or as a parent ("<prefix>/...").
func isOnDenyList(rel string, deny []string) bool {
	for _, prefix := range deny {
		if rel == prefix || strings.HasPrefix(rel, prefix+"/") {
			return true
		}
	}
	return false
}
