package eval

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// LoadGoldenSet loads and validates one goldens.yaml file.
// The returned [GoldenSet] has [GoldenSet.Path] set.
func LoadGoldenSet(path string) (*GoldenSet, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("eval: read goldens file %s: %w", path, err)
	}
	var s GoldenSet
	if err := yaml.Unmarshal(raw, &s); err != nil {
		return nil, fmt.Errorf("eval: parse goldens file %s: %w", path, err)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("eval: abs path %s: %w", path, err)
	}
	s.Path = abs
	if err := s.Validate(); err != nil {
		return nil, fmt.Errorf("eval: validate %s: %w", path, err)
	}
	return &s, nil
}

// LoadAllGoldens loads every goldens.yaml under rootDir into a map keyed by FeatureSpec.ID.
// Discovery order is deterministic.
//
// rootDir is typically `internal/ai/strategies` (the harness scans
// every feature directory under it).
func LoadAllGoldens(rootDir string) (map[string]*GoldenSet, error) {
	out := map[string]*GoldenSet{}
	var paths []string
	err := filepath.WalkDir(rootDir, func(p string, d os.DirEntry, werr error) error {
		if werr != nil {
			return werr
		}
		if d.IsDir() {
			return nil
		}
		if filepath.Base(p) == "goldens.yaml" {
			paths = append(paths, p)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("eval: walk %s: %w", rootDir, err)
	}
	sort.Strings(paths)
	for _, p := range paths {
		set, err := LoadGoldenSet(p)
		if err != nil {
			return nil, err
		}
		if existing, dup := out[set.Feature.ID]; dup {
			return nil, fmt.Errorf("eval: duplicate feature ID %q across goldens files: %s and %s",
				set.Feature.ID, existing.Path, set.Path)
		}
		out[set.Feature.ID] = set
	}
	return out, nil
}

// Validate applies the schema checks shared by the runner and tools/eval-schema-check,
// so CLI and harness errors stay identical.
//
// Rules enforced:
//
//   - feature.id is non-empty kebab-case ([a-z0-9_-]+) — we accept
//     '_' so the special "__usage__" id is loadable.
//   - goldens is non-empty.
//   - every golden has a non-empty name.
//   - golden names are unique within the set.
//   - golden names are file-name safe (no '/', no leading '.').
//   - every golden has a non-empty input.user_message.
//   - mutating_tools is a subset of tools.
//   - judge_pass_threshold (when set) is in [1,5].
func (s *GoldenSet) Validate() error {
	if s.Feature.ID == "" {
		return fmt.Errorf("feature.id is required")
	}
	if !validKebab(s.Feature.ID) {
		return fmt.Errorf("feature.id %q must match [a-z0-9_-]+", s.Feature.ID)
	}
	if len(s.Goldens) == 0 {
		return fmt.Errorf("goldens list is empty (a feature with no goldens cannot regress)")
	}

	toolSet := map[string]struct{}{}
	for _, t := range s.Feature.Tools {
		toolSet[t] = struct{}{}
	}
	for _, mt := range s.Feature.MutatingTools {
		if _, ok := toolSet[mt]; !ok {
			return fmt.Errorf("feature.mutating_tools entry %q not in feature.tools", mt)
		}
	}

	seen := map[string]struct{}{}
	for i, g := range s.Goldens {
		if g.Name == "" {
			return fmt.Errorf("goldens[%d].name is required", i)
		}
		if !validName(g.Name) {
			return fmt.Errorf("goldens[%d].name %q must match [A-Za-z0-9_-]+ (file-name safe)", i, g.Name)
		}
		if _, dup := seen[g.Name]; dup {
			return fmt.Errorf("goldens[%d].name %q duplicates an earlier entry", i, g.Name)
		}
		seen[g.Name] = struct{}{}
		if strings.TrimSpace(g.Input.UserMessage) == "" {
			return fmt.Errorf("goldens[%d] (%s): input.user_message is required", i, g.Name)
		}
		if g.Expect.JudgePassThreshold != 0 {
			if g.Expect.JudgePassThreshold < 1 || g.Expect.JudgePassThreshold > 5 {
				return fmt.Errorf("goldens[%d] (%s): judge_pass_threshold %d not in [1,5]",
					i, g.Name, g.Expect.JudgePassThreshold)
			}
		}
	}
	return nil
}

// validKebab accepts kebab/snake mixed lower-case identifiers plus
// the special "__usage__" feature id.
func validKebab(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= '0' && r <= '9':
		case r == '-':
		case r == '_':
		default:
			return false
		}
	}
	return true
}

// validName accepts file-name-safe identifiers for goldens. We allow
// a slightly wider charset than feature ids (capital letters allowed)
// because golden names show up in human-facing reports.
func validName(s string) bool {
	if s == "" {
		return false
	}
	if s[0] == '.' {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '-' || r == '_':
		default:
			return false
		}
	}
	return true
}

// defaultCannedDir resolves the canned-reply directory for a goldens
// file path: `<dirname>/canned`.
func defaultCannedDir(goldensPath string) string {
	return filepath.Join(filepath.Dir(goldensPath), "canned")
}

// CannedFilePath returns the canonical canned-reply file path for a
// golden inside this set. Used by both the runner and the CLI's
// recording mode.
func (s *GoldenSet) CannedFilePath(goldenName string) string {
	return filepath.Join(s.CannedDir(), goldenName+".yaml")
}
