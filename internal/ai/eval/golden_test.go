package eval

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

const sampleGoldensYAML = `feature:
  id: chatbot-llm
  system: "be helpful"
  tools:
    - query_battery_status
    - create_alert
  mutating_tools:
    - create_alert
goldens:
  - name: range_question
    input:
      user_message: "How far can I drive?"
    expect:
      answer_must_contain: ["miles"]
  - name: refusal
    input:
      user_message: "Send unsafe command"
    expect:
      must_not_call_tools: ["create_alert"]
      answer_must_not_contain: ["okay"]
`

func TestLoadGoldenSet_HappyPath(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	p := filepath.Join(dir, "goldens.yaml")
	writeFile(t, p, sampleGoldensYAML)

	s, err := LoadGoldenSet(p)
	if err != nil {
		t.Fatalf("LoadGoldenSet: %v", err)
	}
	if s.Feature.ID != "chatbot-llm" {
		t.Errorf("Feature.ID = %q", s.Feature.ID)
	}
	if len(s.Goldens) != 2 {
		t.Fatalf("Goldens = %d", len(s.Goldens))
	}
	if s.Path == "" {
		t.Errorf("Path not set")
	}
	if !strings.HasSuffix(s.CannedDir(), filepath.Join(dir, "canned")) && !strings.HasSuffix(s.CannedDir(), "canned") {
		t.Errorf("CannedDir = %q", s.CannedDir())
	}
}

func TestValidate_RejectsEmptyFeatureID(t *testing.T) {
	t.Parallel()
	s := &GoldenSet{
		Goldens: []Golden{{Name: "g", Input: GoldenInput{UserMessage: "x"}}},
	}
	if err := s.Validate(); err == nil || !strings.Contains(err.Error(), "feature.id") {
		t.Errorf("Validate err = %v", err)
	}
}

func TestValidate_RejectsBadFeatureID(t *testing.T) {
	t.Parallel()
	s := &GoldenSet{
		Feature: FeatureSpec{ID: "Bad ID"},
		Goldens: []Golden{{Name: "g", Input: GoldenInput{UserMessage: "x"}}},
	}
	if err := s.Validate(); err == nil || !strings.Contains(err.Error(), "[a-z0-9_-]+") {
		t.Errorf("Validate err = %v", err)
	}
}

func TestValidate_RejectsEmptyGoldens(t *testing.T) {
	t.Parallel()
	s := &GoldenSet{Feature: FeatureSpec{ID: "x"}}
	if err := s.Validate(); err == nil || !strings.Contains(err.Error(), "empty") {
		t.Errorf("Validate err = %v", err)
	}
}

func TestValidate_RejectsDuplicateGoldenName(t *testing.T) {
	t.Parallel()
	s := &GoldenSet{
		Feature: FeatureSpec{ID: "x"},
		Goldens: []Golden{
			{Name: "g", Input: GoldenInput{UserMessage: "a"}},
			{Name: "g", Input: GoldenInput{UserMessage: "b"}},
		},
	}
	if err := s.Validate(); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Errorf("Validate err = %v", err)
	}
}

func TestValidate_RejectsBadGoldenName(t *testing.T) {
	t.Parallel()
	for _, name := range []string{"", ".hidden", "has/slash", "weird space"} {
		s := &GoldenSet{
			Feature: FeatureSpec{ID: "x"},
			Goldens: []Golden{{Name: name, Input: GoldenInput{UserMessage: "u"}}},
		}
		if err := s.Validate(); err == nil {
			t.Errorf("name %q expected error", name)
		}
	}
}

func TestValidate_RejectsMutatingNotInTools(t *testing.T) {
	t.Parallel()
	s := &GoldenSet{
		Feature: FeatureSpec{ID: "x", Tools: []string{"a"}, MutatingTools: []string{"b"}},
		Goldens: []Golden{{Name: "g", Input: GoldenInput{UserMessage: "u"}}},
	}
	if err := s.Validate(); err == nil || !strings.Contains(err.Error(), "mutating_tools") {
		t.Errorf("Validate err = %v", err)
	}
}

func TestValidate_RejectsBadJudgeThreshold(t *testing.T) {
	t.Parallel()
	for _, n := range []int{-1, 6, 99} {
		s := &GoldenSet{
			Feature: FeatureSpec{ID: "x"},
			Goldens: []Golden{{
				Name:  "g",
				Input: GoldenInput{UserMessage: "u"},
				Expect: Expectations{
					JudgeRubric:        "score it",
					JudgePassThreshold: n,
				},
			}},
		}
		if err := s.Validate(); err == nil {
			t.Errorf("threshold %d expected error", n)
		}
	}
}

func TestValidate_AcceptsUnderscoreFeatureID(t *testing.T) {
	t.Parallel()
	s := &GoldenSet{
		Feature: FeatureSpec{ID: "__usage__"},
		Goldens: []Golden{{Name: "g", Input: GoldenInput{UserMessage: "u"}}},
	}
	if err := s.Validate(); err != nil {
		t.Errorf("Validate err = %v", err)
	}
}

func TestLoadAllGoldens_FindsEveryFile(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "feat-a", "goldens.yaml"), strings.ReplaceAll(sampleGoldensYAML, "chatbot-llm", "feat-a"))
	writeFile(t, filepath.Join(root, "feat-b", "goldens.yaml"), strings.ReplaceAll(sampleGoldensYAML, "chatbot-llm", "feat-b"))
	writeFile(t, filepath.Join(root, "ignored.yaml"), "noise")

	sets, err := LoadAllGoldens(root)
	if err != nil {
		t.Fatalf("LoadAllGoldens: %v", err)
	}
	if len(sets) != 2 {
		t.Fatalf("len = %d, want 2", len(sets))
	}
	for _, want := range []string{"feat-a", "feat-b"} {
		if _, ok := sets[want]; !ok {
			t.Errorf("missing %s", want)
		}
	}
}

func TestLoadAllGoldens_RejectsDuplicateFeatureID(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "x", "goldens.yaml"), sampleGoldensYAML)
	writeFile(t, filepath.Join(root, "y", "goldens.yaml"), sampleGoldensYAML)

	_, err := LoadAllGoldens(root)
	if err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Errorf("err = %v", err)
	}
}

func TestCannedFilePath_RelativeToGoldens(t *testing.T) {
	t.Parallel()
	s := &GoldenSet{Path: "/abs/feat/goldens.yaml"}
	got := s.CannedFilePath("g1")
	want := filepath.Join("/abs/feat/canned", "g1.yaml")
	if got != want {
		t.Errorf("CannedFilePath = %q, want %q", got, want)
	}
}
