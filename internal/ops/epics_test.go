package ops

import (
	"strings"
	"testing"
	"testing/fstest"
)

func validEpic() Epic {
	return Epic{
		ID:      "OPS-01",
		Title:   "Something",
		Status:  EpicStatusImplemented,
		Owner:   EpicOwner{Role: "release-engineering", GitHub: "@octocat"},
		Summary: "A summary.",
		Acceptance: []Acceptance{{
			ID:           "OPS-01-A1",
			Statement:    "It works.",
			Evidence:     []string{"present.txt"},
			Verification: "go test ./...",
		}},
		Artifacts: []string{"present.txt"},
	}
}

// fullRegister builds OPS-01…OPS-13 from a template so a test only has
// to describe the one epic it is mutating.
func fullRegister(mutate func(*Epic)) *EpicsManifest {
	m := &EpicsManifest{Version: 1, Program: "test"}
	for i := 1; i <= RequiredEpicCount; i++ {
		e := validEpic()
		e.ID = idFor(i)
		e.Acceptance[0].ID = e.ID + "-A1"
		if i == 1 && mutate != nil {
			mutate(&e)
		}
		m.Epics = append(m.Epics, e)
	}
	return m
}

func idFor(n int) string {
	if n < 10 {
		return "OPS-0" + string(rune('0'+n))
	}
	return "OPS-1" + string(rune('0'+n-10))
}

func epicsFS() fstest.MapFS {
	return fstest.MapFS{"present.txt": &fstest.MapFile{Data: []byte("x")}}
}

func TestValidateEpics_AcceptsACompleteRegister(t *testing.T) {
	if f := ValidateEpics(epicsFS(), fullRegister(nil)); len(f) != 0 {
		t.Fatalf("unexpected findings: %+v", f)
	}
}

func TestValidateEpics_RequiresEveryEpic(t *testing.T) {
	m := fullRegister(nil)
	m.Epics = m.Epics[:5]
	findings := ValidateEpics(epicsFS(), m)
	if !hasMessage(findings, "missing accepted epics") {
		t.Fatalf("incomplete register accepted: %+v", findings)
	}
}

func TestValidateEpics_RejectsIncompleteEntries(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Epic)
		want   string
	}{
		{"no owner role", func(e *Epic) { e.Owner.Role = "" }, "owner.role is required"},
		{"bad owner handle", func(e *Epic) { e.Owner.GitHub = "octocat" }, "must be a GitHub handle"},
		{"no summary", func(e *Epic) { e.Summary = "" }, "summary is required"},
		{"bad status", func(e *Epic) { e.Status = "done" }, "status \"done\" must be one of"},
		{"no acceptance", func(e *Epic) { e.Acceptance = nil }, "at least one acceptance criterion"},
		{"acceptance without verification", func(e *Epic) { e.Acceptance[0].Verification = "" }, "verification is required"},
		{"acceptance without evidence", func(e *Epic) { e.Acceptance[0].Evidence = nil }, "at least one evidence path"},
		{"dangling evidence", func(e *Epic) { e.Acceptance[0].Evidence = []string{"nope.txt"} }, "does not exist"},
		{"dangling artifact", func(e *Epic) { e.Artifacts = []string{"nope.txt"} }, "artifact nope.txt does not exist"},
		{"bad acceptance id", func(e *Epic) { e.Acceptance[0].ID = "A1" }, "acceptance id"},
		{"unknown dependency", func(e *Epic) { e.DependsOn = []string{"OPS-99"} }, "depends_on references unknown epic"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			findings := ValidateEpics(epicsFS(), fullRegister(tt.mutate))
			if !hasMessage(findings, tt.want) {
				t.Fatalf("want a finding containing %q, got %+v", tt.want, findings)
			}
		})
	}
}

// TestValidateEpics_StatusHonesty is the point of the whole register:
// an epic whose acceptance needs a deployed environment must not be able
// to claim `implemented`.
func TestValidateEpics_StatusHonesty(t *testing.T) {
	t.Run("infra criterion cannot be implemented", func(t *testing.T) {
		findings := ValidateEpics(epicsFS(), fullRegister(func(e *Epic) {
			e.Status = EpicStatusImplemented
			e.Acceptance[0].RequiresDeployedInfrastructure = true
		}))
		if !hasMessage(findings, "use `implemented-pending-infrastructure`") {
			t.Fatalf("overstated status accepted: %+v", findings)
		}
	})

	t.Run("pending-infra requires an infra criterion", func(t *testing.T) {
		findings := ValidateEpics(epicsFS(), fullRegister(func(e *Epic) {
			e.Status = EpicStatusPendingInfra
		}))
		if !hasMessage(findings, "but no acceptance criterion requires deployed infrastructure") {
			t.Fatalf("understated status accepted: %+v", findings)
		}
	})

	t.Run("infra criterion with pending-infra status is fine", func(t *testing.T) {
		findings := ValidateEpics(epicsFS(), fullRegister(func(e *Epic) {
			e.Status = EpicStatusPendingInfra
			e.Acceptance[0].RequiresDeployedInfrastructure = true
		}))
		if len(findings) != 0 {
			t.Fatalf("unexpected findings: %+v", findings)
		}
	})
}

func TestValidateEpics_RejectsDuplicates(t *testing.T) {
	m := fullRegister(nil)
	m.Epics = append(m.Epics, m.Epics[0])
	findings := ValidateEpics(epicsFS(), m)
	if !hasMessage(findings, "duplicate epic id") {
		t.Fatalf("duplicate accepted: %+v", findings)
	}
}

// TestRealEpicsRegisterIsHonest asserts against the committed register:
// every epic with an infrastructure-dependent criterion is marked
// pending, and the counts are what the report claims.
func TestRealEpicsRegisterIsHonest(t *testing.T) {
	fsys := repoFSForTest(t)
	m, err := LoadEpics(fsys, EpicsManifestPath)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(m.Epics) != RequiredEpicCount {
		t.Fatalf("register has %d epics, want %d", len(m.Epics), RequiredEpicCount)
	}
	for _, e := range m.Epics {
		needsInfra := false
		for _, a := range e.Acceptance {
			if a.RequiresDeployedInfrastructure {
				needsInfra = true
			}
		}
		switch {
		case needsInfra && e.Status != EpicStatusPendingInfra:
			t.Errorf("%s has an infrastructure-dependent criterion but status %q", e.ID, e.Status)
		case !needsInfra && e.Status == EpicStatusPendingInfra:
			t.Errorf("%s claims pending-infrastructure without an infrastructure-dependent criterion", e.ID)
		}
		if !strings.HasPrefix(e.Owner.GitHub, "@") {
			t.Errorf("%s has no GitHub owner", e.ID)
		}
	}
}
