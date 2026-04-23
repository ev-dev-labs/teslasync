package telemetry

import (
	"encoding/json"
	"os"
	"testing"
)

// TestFlattenAgainstSampleBatch loads testdata/sample_batch.json (a captured
// or synthetic Fleet Telemetry payload) and verifies the full flatten ->
// route pipeline produces zero unrouteable atomics.
func TestFlattenAgainstSampleBatch(t *testing.T) {
	raw, err := os.ReadFile("testdata/sample_batch.json")
	if err != nil {
		t.Skipf("no sample batch fixture (capture one in testdata/sample_batch.json): %v", err)
		return
	}
	var batch struct {
		Signals []struct {
			Name  string `json:"name"`
			Value any    `json:"value"`
		} `json:"signals"`
	}
	if err := json.Unmarshal(raw, &batch); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(batch.Signals) == 0 {
		t.Fatalf("sample batch has no signals")
	}

	var orphans []string
	compoundExpansions := map[string]int{}
	for _, s := range batch.Signals {
		atomics, err := Flatten(s.Name, s.Value)
		if err != nil {
			t.Errorf("flatten %s: %v", s.Name, err)
			continue
		}
		if len(atomics) > 1 || (len(atomics) == 1 && atomics[0].Name != s.Name) {
			compoundExpansions[s.Name] = len(atomics)
		}
		for _, a := range atomics {
			if _, hot := HotCatalog[a.Name]; hot {
				continue
			}
			if _, cold := KnownColdSignals[a.Name]; cold {
				continue
			}
			orphans = append(orphans, a.Name)
		}
	}
	if len(orphans) > 0 {
		t.Errorf("orphan atomics from real batch: %v", orphans)
	}
	if len(compoundExpansions) < 4 {
		t.Errorf("expected at least 4 compound expansions, got %d: %v", len(compoundExpansions), compoundExpansions)
	}
	t.Logf("compound expansions observed: %v", compoundExpansions)
}
