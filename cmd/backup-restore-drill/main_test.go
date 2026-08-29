package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/backuprestore"
)

type fakeRunner struct {
	result *backuprestore.Result
	err    error
	guard  string
	tables []string
}

func (f *fakeRunner) Run(_ context.Context, guard string, tables []string) (*backuprestore.Result, error) {
	f.guard = guard
	f.tables = append([]string(nil), tables...)
	return f.result, f.err
}

func TestRunRequiresAllConnectionInputs(t *testing.T) {
	var stdout, stderr bytes.Buffer
	exitCode := run(&stdout, &stderr, func(string) string { return "" })
	if exitCode != 1 {
		t.Fatalf("run() exit = %d, want 1", exitCode)
	}
	var result backuprestore.Result
	if err := json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &result); err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if result.Error == "" {
		t.Fatal("missing configuration failure was not emitted")
	}
}

func TestRunWithDepsEmitsSuccessfulResult(t *testing.T) {
	runner := &fakeRunner{result: &backuprestore.Result{OK: true, ArtifactRunID: 42}}
	var stdout bytes.Buffer
	exitCode := runWithDeps(
		context.Background(),
		runner,
		"guard",
		[]string{"vehicles"},
		&stdout,
	)
	if exitCode != 0 {
		t.Fatalf("runWithDeps() exit = %d, want 0", exitCode)
	}
	if runner.guard != "guard" || len(runner.tables) != 1 || runner.tables[0] != "vehicles" {
		t.Fatalf("runner inputs = %q, %v", runner.guard, runner.tables)
	}
	var result backuprestore.Result
	if err := json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &result); err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if !result.OK || result.ArtifactRunID != 42 {
		t.Fatalf("emitted result = %+v", result)
	}
}

func TestRunWithDepsFailsOnRunnerError(t *testing.T) {
	runner := &fakeRunner{
		result: &backuprestore.Result{Error: "restore failed"},
		err:    errors.New("restore failed"),
	}
	var stdout bytes.Buffer
	if exitCode := runWithDeps(context.Background(), runner, "guard", nil, &stdout); exitCode != 1 {
		t.Fatalf("runWithDeps() exit = %d, want 1", exitCode)
	}
	if stdout.Len() == 0 {
		t.Fatal("failure result was not emitted")
	}
}

func TestParseCriticalTables(t *testing.T) {
	defaults := parseCriticalTables("")
	if len(defaults) != 3 {
		t.Fatalf("default critical tables = %v", defaults)
	}
	got := parseCriticalTables(" vehicles, drives ,, ")
	if len(got) != 2 || got[0] != "vehicles" || got[1] != "drives" {
		t.Fatalf("parseCriticalTables() = %v", got)
	}
}
