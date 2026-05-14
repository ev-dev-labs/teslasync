package eval

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func sampleResults() []Result {
	return []Result{
		{FeatureID: "feat-a", GoldenName: "g1", Pass: true, Duration: 100 * time.Millisecond, Answer: "ans1"},
		{FeatureID: "feat-a", GoldenName: "g2", Pass: false, Reasons: []string{"missing tool"}, Duration: 50 * time.Millisecond},
		{FeatureID: "feat-b", GoldenName: "g3", Pass: true, JudgeScore: 5, JudgeReason: "great", Duration: 200 * time.Millisecond},
	}
}

func TestSummarizeResults_Counts(t *testing.T) {
	t.Parallel()
	sum := SummarizeResults(sampleResults())
	if sum.Total != 3 || sum.Pass != 2 || sum.Fail != 1 {
		t.Errorf("Total/Pass/Fail = %d/%d/%d", sum.Total, sum.Pass, sum.Fail)
	}
	if sum.PassRate < 0.66 || sum.PassRate > 0.67 {
		t.Errorf("PassRate = %f", sum.PassRate)
	}
	if len(sum.ByFeature) != 2 {
		t.Errorf("ByFeature = %d", len(sum.ByFeature))
	}
	if sum.ByFeature["feat-a"].Pass != 1 || sum.ByFeature["feat-a"].Fail != 1 {
		t.Errorf("feat-a = %+v", sum.ByFeature["feat-a"])
	}
}

func TestWriteTextReport_IncludesAllResults(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	if err := WriteTextReport(&buf, sampleResults()); err != nil {
		t.Fatalf("WriteTextReport: %v", err)
	}
	out := buf.String()
	for _, want := range []string{"3 goldens", "feat-a", "feat-b", "g1", "g2", "g3", "PASS", "FAIL", "missing tool", "judge score=5"} {
		if !strings.Contains(out, want) {
			t.Errorf("text report missing %q. Got:\n%s", want, out)
		}
	}
}

func TestWriteJUnitReport_ProducesValidXML(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	if err := WriteJUnitReport(&buf, sampleResults()); err != nil {
		t.Fatalf("WriteJUnitReport: %v", err)
	}
	out := buf.String()
	for _, want := range []string{
		`<?xml`, `<testsuites`, `<testsuite name="feat-a"`, `<testsuite name="feat-b"`,
		`<testcase`, `<failure`, "missing tool", `tests="3"`, `failures="1"`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("junit report missing %q. Got:\n%s", want, out)
		}
	}
}

func TestSummarizeResults_EmptyInput(t *testing.T) {
	t.Parallel()
	sum := SummarizeResults(nil)
	if sum.Total != 0 || sum.PassRate != 0 {
		t.Errorf("empty: %+v", sum)
	}
}
