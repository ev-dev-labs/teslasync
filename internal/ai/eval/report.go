package eval

import (
	"encoding/xml"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"
)

// SummarizeResults groups results by feature and computes pass/fail
// totals + the overall pass rate. Used by [WriteTextReport] and
// [WriteJUnitReport].
type Summary struct {
	Total       int
	Pass        int
	Fail        int
	PassRate    float64 // 0.0–1.0
	ByFeature   map[string]FeatureSummary
	OverallTime time.Duration
}

// FeatureSummary is the per-feature breakdown.
type FeatureSummary struct {
	Total int
	Pass  int
	Fail  int
}

// SummarizeResults collapses a flat result slice into a Summary.
func SummarizeResults(rs []Result) Summary {
	s := Summary{
		ByFeature: map[string]FeatureSummary{},
	}
	for _, r := range rs {
		s.Total++
		fs := s.ByFeature[r.FeatureID]
		fs.Total++
		if r.Pass {
			s.Pass++
			fs.Pass++
		} else {
			s.Fail++
			fs.Fail++
		}
		s.ByFeature[r.FeatureID] = fs
		s.OverallTime += r.Duration
	}
	if s.Total > 0 {
		s.PassRate = float64(s.Pass) / float64(s.Total)
	}
	return s
}

// WriteTextReport writes a human-readable summary + per-result table
// to w. Used by the CLI's default output mode.
func WriteTextReport(w io.Writer, results []Result) error {
	sum := SummarizeResults(results)
	if _, err := fmt.Fprintf(w, "AI eval results: %d goldens, %d pass, %d fail (%.1f%% pass rate, %s elapsed)\n",
		sum.Total, sum.Pass, sum.Fail, sum.PassRate*100, sum.OverallTime); err != nil {
		return err
	}

	featureIDs := make([]string, 0, len(sum.ByFeature))
	for id := range sum.ByFeature {
		featureIDs = append(featureIDs, id)
	}
	sort.Strings(featureIDs)
	if _, err := fmt.Fprintln(w, "\nBy feature:"); err != nil {
		return err
	}
	for _, id := range featureIDs {
		fs := sum.ByFeature[id]
		if _, err := fmt.Fprintf(w, "  %-30s %d/%d pass\n", id, fs.Pass, fs.Total); err != nil {
			return err
		}
	}

	if _, err := fmt.Fprintln(w, "\nDetails:"); err != nil {
		return err
	}
	for _, r := range results {
		status := "PASS"
		if !r.Pass {
			status = "FAIL"
		}
		if _, err := fmt.Fprintf(w, "  [%s] %s/%s (%s)\n", status, r.FeatureID, r.GoldenName, r.Duration); err != nil {
			return err
		}
		if r.JudgeScore > 0 {
			if _, err := fmt.Fprintf(w, "         judge score=%d reason=%q\n", r.JudgeScore, r.JudgeReason); err != nil {
				return err
			}
		}
		for _, reason := range r.Reasons {
			if _, err := fmt.Fprintf(w, "         - %s\n", reason); err != nil {
				return err
			}
		}
	}
	return nil
}

// junitTestSuites is the JUnit XML root element.
type junitTestSuites struct {
	XMLName  xml.Name         `xml:"testsuites"`
	Name     string           `xml:"name,attr"`
	Tests    int              `xml:"tests,attr"`
	Failures int              `xml:"failures,attr"`
	Time     float64          `xml:"time,attr"`
	Suites   []junitTestSuite `xml:"testsuite"`
}

type junitTestSuite struct {
	Name     string          `xml:"name,attr"`
	Tests    int             `xml:"tests,attr"`
	Failures int             `xml:"failures,attr"`
	Time     float64         `xml:"time,attr"`
	Cases    []junitTestCase `xml:"testcase"`
}

type junitTestCase struct {
	Classname string        `xml:"classname,attr"`
	Name      string        `xml:"name,attr"`
	Time      float64       `xml:"time,attr"`
	Failure   *junitFailure `xml:"failure,omitempty"`
	SystemOut string        `xml:"system-out,omitempty"`
}

type junitFailure struct {
	Message string `xml:"message,attr"`
	Type    string `xml:"type,attr"`
	Body    string `xml:",chardata"`
}

// WriteJUnitReport writes a JUnit XML report to w. Used by the CLI's
// `--output junit.xml` mode for CI consumption.
func WriteJUnitReport(w io.Writer, results []Result) error {
	sum := SummarizeResults(results)
	suites := map[string]*junitTestSuite{}
	order := []string{}
	for _, r := range results {
		s, ok := suites[r.FeatureID]
		if !ok {
			s = &junitTestSuite{Name: r.FeatureID}
			suites[r.FeatureID] = s
			order = append(order, r.FeatureID)
		}
		s.Tests++
		s.Time += r.Duration.Seconds()
		tc := junitTestCase{
			Classname: r.FeatureID,
			Name:      r.GoldenName,
			Time:      r.Duration.Seconds(),
		}
		if !r.Pass {
			s.Failures++
			tc.Failure = &junitFailure{
				Message: strings.Join(r.Reasons, " | "),
				Type:    "AssertionFailed",
				Body:    strings.Join(r.Reasons, "\n"),
			}
		}
		if r.Answer != "" {
			tc.SystemOut = r.Answer
		}
		s.Cases = append(s.Cases, tc)
	}
	sort.Strings(order)
	root := junitTestSuites{
		Name:     "ai-eval",
		Tests:    sum.Total,
		Failures: sum.Fail,
		Time:     sum.OverallTime.Seconds(),
	}
	for _, id := range order {
		root.Suites = append(root.Suites, *suites[id])
	}
	if _, err := io.WriteString(w, xml.Header); err != nil {
		return err
	}
	enc := xml.NewEncoder(w)
	enc.Indent("", "  ")
	if err := enc.Encode(root); err != nil {
		return err
	}
	if _, err := io.WriteString(w, "\n"); err != nil {
		return err
	}
	return nil
}
