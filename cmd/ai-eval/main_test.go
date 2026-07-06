package main

import (
	"bytes"
	"errors"
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// writeFile creates the parent directory tree for path and writes body.
func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// writePassingFeature lays down a feature directory whose single golden
// passes in fast mode: the canned reply's content contains the substring
// the golden's expect.answer_must_contain requires.
func writePassingFeature(t *testing.T, root, id string) {
	t.Helper()
	dir := filepath.Join(root, id)
	writeFile(t, filepath.Join(dir, "goldens.yaml"), "feature:\n"+
		"  id: "+id+"\n"+
		"  system: \"be helpful\"\n"+
		"goldens:\n"+
		"  - name: greet\n"+
		"    input:\n"+
		"      user_message: \"say hi\"\n"+
		"    expect:\n"+
		"      answer_must_contain: [\"hello\"]\n")
	writeFile(t, filepath.Join(dir, "canned", "greet.yaml"), "replies:\n"+
		"  - finish_reason: stop\n"+
		"    content: \"hello, friend\"\n")
}

// writeFailingFeature lays down a feature whose single golden fails: the
// canned content does NOT contain the required substring.
func writeFailingFeature(t *testing.T, root, id string) {
	t.Helper()
	dir := filepath.Join(root, id)
	writeFile(t, filepath.Join(dir, "goldens.yaml"), "feature:\n"+
		"  id: "+id+"\n"+
		"  system: \"be helpful\"\n"+
		"goldens:\n"+
		"  - name: bad\n"+
		"    input:\n"+
		"      user_message: \"hi\"\n"+
		"    expect:\n"+
		"      answer_must_contain: [\"zzz-absent-substring\"]\n")
	writeFile(t, filepath.Join(dir, "canned", "bad.yaml"), "replies:\n"+
		"  - finish_reason: stop\n"+
		"    content: \"a totally different answer\"\n")
}

// runCLI invokes run with the given args, capturing stdout and stderr.
func runCLI(args ...string) (stdout, stderr string, err error) {
	var out, errb bytes.Buffer
	err = run(args, &out, &errb)
	return out.String(), errb.String(), err
}

func TestRun_AllPass_DefaultMode(t *testing.T) {
	root := t.TempDir()
	writePassingFeature(t, root, "alpha")

	stdout, stderr, err := runCLI("--root", root)
	if err != nil {
		t.Fatalf("run: %v (stderr=%q)", err, stderr)
	}
	for _, want := range []string{"1 goldens, 1 pass, 0 fail", "alpha", "[PASS]"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("stdout missing %q\n---\n%s", want, stdout)
		}
	}
}

func TestRun_DefaultRootSelectsAllFeatures(t *testing.T) {
	root := t.TempDir()
	writePassingFeature(t, root, "alpha")
	writePassingFeature(t, root, "bravo")

	// No --feature and no --all: default selects every feature.
	stdout, _, err := runCLI("--root", root)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if !strings.Contains(stdout, "2 goldens, 2 pass, 0 fail") {
		t.Errorf("expected 2 passing goldens\n%s", stdout)
	}
	if !strings.Contains(stdout, "alpha") || !strings.Contains(stdout, "bravo") {
		t.Errorf("both features should appear\n%s", stdout)
	}
}

func TestRun_AllFlagRunsEverything(t *testing.T) {
	root := t.TempDir()
	writePassingFeature(t, root, "alpha")
	writePassingFeature(t, root, "bravo")

	stdout, _, err := runCLI("--root", root, "--all")
	if err != nil {
		t.Fatalf("run --all: %v", err)
	}
	if !strings.Contains(stdout, "2 goldens, 2 pass, 0 fail") {
		t.Errorf("expected all features to run\n%s", stdout)
	}
}

func TestRun_SingleFeatureSelection(t *testing.T) {
	root := t.TempDir()
	writePassingFeature(t, root, "alpha")
	writePassingFeature(t, root, "gamma")

	stdout, _, err := runCLI("--root", root, "--feature", "alpha")
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if !strings.Contains(stdout, "1 goldens, 1 pass, 0 fail") {
		t.Errorf("expected only 1 golden run\n%s", stdout)
	}
	if !strings.Contains(stdout, "alpha") {
		t.Errorf("selected feature alpha missing\n%s", stdout)
	}
	if strings.Contains(stdout, "gamma") {
		t.Errorf("unselected feature gamma should not appear\n%s", stdout)
	}
}

func TestRun_GoldenFailureReturnsExitCode1(t *testing.T) {
	root := t.TempDir()
	writeFailingFeature(t, root, "beta")

	stdout, _, err := runCLI("--root", root)
	if err == nil {
		t.Fatal("expected error for failing golden")
	}
	var ee *exitErr
	if !errors.As(err, &ee) {
		t.Fatalf("want *exitErr, got %T: %v", err, err)
	}
	if ee.code != 1 {
		t.Errorf("exit code = %d, want 1", ee.code)
	}
	if !strings.Contains(err.Error(), "goldens failed") {
		t.Errorf("err = %q, want mention of failed goldens", err.Error())
	}
	if !strings.Contains(stdout, "[FAIL]") {
		t.Errorf("report should show FAIL detail\n%s", stdout)
	}
}

func TestRun_MixedPassFailStillExitCode1(t *testing.T) {
	root := t.TempDir()
	writePassingFeature(t, root, "alpha")
	writeFailingFeature(t, root, "beta")

	stdout, _, err := runCLI("--root", root)
	var ee *exitErr
	if !errors.As(err, &ee) || ee.code != 1 {
		t.Fatalf("want *exitErr code 1, got %v", err)
	}
	if !strings.Contains(stdout, "2 goldens, 1 pass, 1 fail") {
		t.Errorf("summary mismatch\n%s", stdout)
	}
}

func TestRun_FeatureNotFound(t *testing.T) {
	root := t.TempDir()
	writePassingFeature(t, root, "alpha")

	_, _, err := runCLI("--root", root, "--feature", "does-not-exist")
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("err = %v, want 'not found'", err)
	}
	// A selection error is a plain error (CLI/IO), NOT an exitErr, so
	// main() maps it to exit code 2.
	var ee *exitErr
	if errors.As(err, &ee) {
		t.Errorf("feature-not-found should be a plain error, got *exitErr")
	}
}

func TestRun_AllAndFeatureMutuallyExclusive(t *testing.T) {
	_, _, err := runCLI("--all", "--feature", "x")
	if err == nil || !strings.Contains(err.Error(), "mutually exclusive") {
		t.Fatalf("err = %v, want 'mutually exclusive'", err)
	}
}

func TestRun_NoGoldensFound(t *testing.T) {
	root := t.TempDir() // empty directory, no goldens.yaml
	_, _, err := runCLI("--root", root)
	if err == nil || !strings.Contains(err.Error(), "no goldens.yaml files found") {
		t.Fatalf("err = %v, want 'no goldens.yaml files found'", err)
	}
}

func TestRun_LoadErrorOnInvalidGoldens(t *testing.T) {
	root := t.TempDir()
	// Empty feature.id fails GoldenSet.Validate → LoadAllGoldens errors →
	// run wraps it as "load goldens: ...".
	writeFile(t, filepath.Join(root, "bad", "goldens.yaml"),
		"feature:\n  id: \"\"\ngoldens: []\n")

	_, _, err := runCLI("--root", root)
	if err == nil || !strings.Contains(err.Error(), "load goldens") {
		t.Fatalf("err = %v, want 'load goldens'", err)
	}
}

func TestRun_JudgeModeProviderNotWired(t *testing.T) {
	root := t.TempDir()
	writePassingFeature(t, root, "alpha")

	_, _, err := runCLI("--root", root, "--judge")
	if err == nil || !strings.Contains(err.Error(), "judge provider") {
		t.Fatalf("err = %v, want 'judge provider'", err)
	}
	// Provider-wiring failure is a plain error (exit 2), not an exitErr.
	var ee *exitErr
	if errors.As(err, &ee) {
		t.Errorf("judge-provider failure should be a plain error, got *exitErr")
	}
}

func TestRun_OutputWritesJUnit(t *testing.T) {
	root := t.TempDir()
	writePassingFeature(t, root, "alpha")
	out := filepath.Join(t.TempDir(), "junit.xml")

	_, _, err := runCLI("--root", root, "--output", out)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	data, rerr := os.ReadFile(out)
	if rerr != nil {
		t.Fatalf("read junit: %v", rerr)
	}
	xml := string(data)
	for _, want := range []string{"<?xml", "<testsuites", "name=\"alpha\"", "greet"} {
		if !strings.Contains(xml, want) {
			t.Errorf("junit missing %q\n%s", want, xml)
		}
	}
}

func TestRun_OutputCreateError(t *testing.T) {
	root := t.TempDir()
	writePassingFeature(t, root, "alpha")
	// Parent directory does not exist → os.Create fails.
	badOut := filepath.Join(root, "no-such-dir", "junit.xml")

	_, _, err := runCLI("--root", root, "--output", badOut)
	if err == nil || !strings.Contains(err.Error(), "create") {
		t.Fatalf("err = %v, want 'create'", err)
	}
}

func TestRun_JUnitSuitesSortedByFeature(t *testing.T) {
	root := t.TempDir()
	// Deliberately create in non-sorted order to prove the report sorts.
	writePassingFeature(t, root, "bravo")
	writePassingFeature(t, root, "alpha")
	out := filepath.Join(t.TempDir(), "junit.xml")

	stdout, _, err := runCLI("--root", root, "--output", out)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if !strings.Contains(stdout, "2 goldens, 2 pass, 0 fail") {
		t.Errorf("summary mismatch\n%s", stdout)
	}
	data, _ := os.ReadFile(out)
	xml := string(data)
	ia := strings.Index(xml, "name=\"alpha\"")
	ib := strings.Index(xml, "name=\"bravo\"")
	if ia < 0 || ib < 0 {
		t.Fatalf("both suites must be present: alpha@%d bravo@%d\n%s", ia, ib, xml)
	}
	if ia > ib {
		t.Errorf("suites not sorted: alpha@%d should precede bravo@%d", ia, ib)
	}
}

func TestRun_RecordModeIsUnimplemented(t *testing.T) {
	root := t.TempDir()
	writePassingFeature(t, root, "alpha")

	stdout, _, err := runCLI("--root", root, "--record")
	var ee *exitErr
	if !errors.As(err, &ee) || ee.code != 1 {
		t.Fatalf("want *exitErr code 1, got %v", err)
	}
	if !strings.Contains(stdout, "record mode") {
		t.Errorf("stdout should explain record mode is unimplemented\n%s", stdout)
	}
}

func TestRun_FlagParseError(t *testing.T) {
	_, stderr, err := runCLI("--nonexistent-flag")
	if err == nil {
		t.Fatal("expected flag parse error")
	}
	if !strings.Contains(stderr, "nonexistent-flag") && !strings.Contains(stderr, "flag") {
		t.Errorf("stderr should report the bad flag, got %q", stderr)
	}
}

func TestRun_HelpFlagReturnsErrHelp(t *testing.T) {
	_, _, err := runCLI("-h")
	if !errors.Is(err, flag.ErrHelp) {
		t.Fatalf("err = %v, want flag.ErrHelp", err)
	}
}

// failWriter always fails, simulating a broken stdout (e.g. a closed pipe
// or full disk) so the report-writing error path is exercised.
type failWriter struct{}

func (failWriter) Write([]byte) (int, error) { return 0, errors.New("simulated write failure") }

func TestRun_TextReportWriteError(t *testing.T) {
	root := t.TempDir()
	writePassingFeature(t, root, "alpha")

	var errb bytes.Buffer
	err := run([]string{"--root", root}, failWriter{}, &errb)
	if err == nil || !strings.Contains(err.Error(), "write text report") {
		t.Fatalf("err = %v, want 'write text report'", err)
	}
}

func TestSortStrings(t *testing.T) {
	tests := []struct {
		name string
		in   []string
		want []string
	}{
		{"nil", nil, nil},
		{"empty", []string{}, []string{}},
		{"single", []string{"x"}, []string{"x"}},
		{"already sorted", []string{"a", "b", "c"}, []string{"a", "b", "c"}},
		{"reverse", []string{"c", "b", "a"}, []string{"a", "b", "c"}},
		{"duplicates", []string{"b", "a", "b"}, []string{"a", "b", "b"}},
		{"ascii case order", []string{"B", "a", "A"}, []string{"A", "B", "a"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := append([]string(nil), tt.in...)
			sortStrings(got)
			if len(got) != len(tt.want) {
				t.Fatalf("len = %d, want %d (%v)", len(got), len(tt.want), got)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("got %v, want %v", got, tt.want)
					break
				}
			}
		})
	}
}

func TestSortedKeys(t *testing.T) {
	// int-valued map exercises the generic instantiation once.
	m := map[string]int{"c": 3, "a": 1, "b": 2}
	if got := sortedKeys(m); !reflect.DeepEqual(got, []string{"a", "b", "c"}) {
		t.Errorf("sortedKeys(int) = %v, want [a b c]", got)
	}
	// bool-valued map exercises a second instantiation of the generic.
	m2 := map[string]bool{"z": true, "a": false, "m": true}
	if got := sortedKeys(m2); !reflect.DeepEqual(got, []string{"a", "m", "z"}) {
		t.Errorf("sortedKeys(bool) = %v, want [a m z]", got)
	}
	// Empty map yields an empty (len 0) slice.
	if got := sortedKeys(map[string]int{}); len(got) != 0 {
		t.Errorf("sortedKeys(empty) = %v, want empty", got)
	}
}

func TestBuildJudgeProvider(t *testing.T) {
	p, err := buildJudgeProvider()
	if err == nil {
		t.Fatal("expected error: judge provider is deferred/not wired")
	}
	if p != nil {
		t.Errorf("provider = %v, want nil", p)
	}
	if !strings.Contains(err.Error(), "JUDGE_PROVIDER") {
		t.Errorf("err = %q, want mention of JUDGE_PROVIDER knob", err.Error())
	}
}

func TestExitErr(t *testing.T) {
	e := &exitErr{code: 7, msg: "boom"}
	if e.Error() != "boom" {
		t.Errorf("Error() = %q, want boom", e.Error())
	}
	// exitErr must be discoverable via errors.As so main() can read .code.
	var target *exitErr
	if !errors.As(error(e), &target) {
		t.Fatal("errors.As failed to match *exitErr")
	}
	if target.code != 7 {
		t.Errorf("code = %d, want 7", target.code)
	}
	// A plain error must NOT match, so main() maps it to exit code 2.
	if errors.As(errors.New("plain"), &target) {
		t.Error("plain error unexpectedly matched *exitErr")
	}
}

// argSep separates CLI args passed to the re-exec'd child through an env
// var. Using the ASCII unit-separator avoids any collision with file
// paths (which may contain spaces, backslashes, or colons on Windows).
const argSep = "\x1f"

// TestProcessExitCodes verifies main()'s documented exit-code contract
// (0 = all pass, 1 = at least one golden failed, 2 = CLI/IO error) by
// re-executing the test binary as a subprocess. This is the canonical
// way to test a Go entry point that calls os.Exit: the child runs only
// this test, detects the env sentinel, rebuilds argv, and calls main();
// the parent asserts on the child's process exit code.
func TestProcessExitCodes(t *testing.T) {
	if os.Getenv("AI_EVAL_TEST_MAIN") == "1" {
		// Child role: rebuild argv and hand control to main(), which
		// terminates the process via os.Exit for the fail paths.
		args := []string{"ai-eval"}
		if extra := os.Getenv("AI_EVAL_TEST_ARGS"); extra != "" {
			args = append(args, strings.Split(extra, argSep)...)
		}
		os.Args = args
		main()
		return
	}

	cases := []struct {
		name     string
		setup    func(t *testing.T) []string
		wantCode int
	}{
		{
			name: "all pass exits 0",
			setup: func(t *testing.T) []string {
				root := t.TempDir()
				writePassingFeature(t, root, "alpha")
				return []string{"--root", root}
			},
			wantCode: 0,
		},
		{
			name: "failing golden exits 1",
			setup: func(t *testing.T) []string {
				root := t.TempDir()
				writeFailingFeature(t, root, "beta")
				return []string{"--root", root}
			},
			wantCode: 1,
		},
		{
			name: "no goldens exits 2",
			setup: func(t *testing.T) []string {
				return []string{"--root", t.TempDir()}
			},
			wantCode: 2,
		},
		{
			name: "bad flag exits 2",
			setup: func(t *testing.T) []string {
				return []string{"--nonexistent-flag"}
			},
			wantCode: 2,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			args := tc.setup(t)
			cmd := exec.Command(os.Args[0], "-test.run=^TestProcessExitCodes$")
			cmd.Env = append(os.Environ(),
				"AI_EVAL_TEST_MAIN=1",
				"AI_EVAL_TEST_ARGS="+strings.Join(args, argSep),
			)
			var out, errb bytes.Buffer
			cmd.Stdout = &out
			cmd.Stderr = &errb
			runErr := cmd.Run()

			gotCode := 0
			if runErr != nil {
				var ee *exec.ExitError
				if !errors.As(runErr, &ee) {
					t.Fatalf("subprocess did not exit cleanly: %v\nstderr: %s", runErr, errb.String())
				}
				gotCode = ee.ExitCode()
			}
			if gotCode != tc.wantCode {
				t.Errorf("exit code = %d, want %d\nstdout: %s\nstderr: %s",
					gotCode, tc.wantCode, out.String(), errb.String())
			}
		})
	}
}
