package ops

import (
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"
)

// ScorecardDefinitionPath is the canonical location of the OPS-13
// definition.
const ScorecardDefinitionPath = "ops/scorecard/dimensions.yaml"

// ScorecardOutputPath is where cmd/readiness-scorecard writes.
const ScorecardOutputPath = "docs/operations/production-readiness-scorecard.md"

// ScorecardDefinition is the parsed ops/scorecard/dimensions.yaml.
type ScorecardDefinition struct {
	Version      int                  `yaml:"version"`
	StatusValues []string             `yaml:"status_values"`
	Dimensions   []ScorecardDimension `yaml:"dimensions"`
}

// ScorecardDimension groups related criteria.
type ScorecardDimension struct {
	Title    string               `yaml:"title"`
	ID       string               `yaml:"id"`
	Question string               `yaml:"question"`
	Criteria []ScorecardCriterion `yaml:"criteria"`
}

// ScorecardCriterion is one checkable readiness statement.
type ScorecardCriterion struct {
	ID           string   `yaml:"id"`
	Statement    string   `yaml:"statement"`
	Evidence     []string `yaml:"evidence"`
	Gate         string   `yaml:"gate"`
	Verification string   `yaml:"verification"`
	// RequiresDeployedInfrastructure marks a criterion that needs a real
	// environment, real credentials, or an executed drill.
	RequiresDeployedInfrastructure bool `yaml:"requires_deployed_infrastructure"`
	// RequiresHumanReview marks a criterion whose assessment is a
	// judgement no command can make (e.g. "the guidelines are good").
	// CI can only confirm the artifact exists, so such criteria are
	// reported as unverifiable rather than inflating the score.
	RequiresHumanReview bool `yaml:"requires_human_review"`
}

// ManualVerification is the exact verification string a criterion must
// use when RequiresHumanReview is set. Pinning it keeps the two fields
// from drifting into a state where a manual check silently scores as
// automated.
const ManualVerification = "manual review"

// Criterion statuses.
const (
	StatusMet          = "met"
	StatusGap          = "gap"
	StatusUnverifiable = "unverifiable"
)

// CriterionResult is a derived (never hand-written) criterion outcome.
type CriterionResult struct {
	ID           string
	Statement    string
	Status       string
	Verification string
	Notes        []string
}

// DimensionResult aggregates the criteria of one dimension.
type DimensionResult struct {
	ID           string
	Title        string
	Question     string
	Criteria     []CriterionResult
	Met          int
	Gap          int
	Unverifiable int
}

// Score is the met/(met+gap) ratio as a percentage. Unverifiable
// criteria are excluded from the denominator and reported separately —
// counting them either way would be a claim we cannot support.
func (d DimensionResult) Score() float64 {
	den := d.Met + d.Gap
	if den == 0 {
		return 0
	}
	return float64(d.Met) / float64(den) * 100
}

// Scorecard is the whole derived result.
type Scorecard struct {
	GeneratedAt  time.Time
	Commit       string
	Dimensions   []DimensionResult
	Met          int
	Gap          int
	Unverifiable int
}

// Score is the overall met ratio across every verifiable criterion.
func (s Scorecard) Score() float64 {
	den := s.Met + s.Gap
	if den == 0 {
		return 0
	}
	return float64(s.Met) / float64(den) * 100
}

// LoadScorecardDefinition reads the OPS-13 definition.
func LoadScorecardDefinition(fsys fs.FS, path string) (*ScorecardDefinition, error) {
	var d ScorecardDefinition
	if err := loadYAML(fsys, path, &d); err != nil {
		return nil, err
	}
	return &d, nil
}

// requiredScorecardDimensions are the axes the readiness review must
// cover. Dropping one is a gate failure, not a silent narrowing.
var requiredScorecardDimensions = []string{
	"availability", "latency", "security", "accessibility", "recovery", "cost",
}

// ValidateScorecard checks the definition is well-formed: known gates,
// real evidence paths, stated verification, and full dimension coverage.
func ValidateScorecard(fsys fs.FS, d *ScorecardDefinition) []Finding {
	const check = "scorecard"
	var out []Finding

	if d.Version != 1 {
		out = append(out, errf(check, ScorecardDefinitionPath, "unsupported version %d (want 1)", d.Version))
	}
	wantStatuses := setOf(d.StatusValues)
	for _, s := range []string{StatusMet, StatusGap, StatusUnverifiable} {
		if !wantStatuses[s] {
			out = append(out, errf(check, "status_values", "missing status %q", s))
		}
	}

	seenDim := map[string]bool{}
	seenCrit := map[string]bool{}
	for _, dim := range d.Dimensions {
		if dim.ID == "" {
			out = append(out, errf(check, "dimensions[]", "dimension needs an id"))
			continue
		}
		if seenDim[dim.ID] {
			out = append(out, errf(check, dim.ID, "duplicate dimension id"))
		}
		seenDim[dim.ID] = true
		if strings.TrimSpace(dim.Title) == "" || strings.TrimSpace(dim.Question) == "" {
			out = append(out, errf(check, dim.ID, "title and question are required"))
		}
		if len(dim.Criteria) == 0 {
			out = append(out, errf(check, dim.ID, "dimension has no criteria"))
		}
		for _, c := range dim.Criteria {
			subject := dim.ID + "/" + c.ID
			if c.ID == "" {
				out = append(out, errf(check, dim.ID, "criterion needs an id"))
				continue
			}
			if seenCrit[c.ID] {
				out = append(out, errf(check, subject, "duplicate criterion id"))
			}
			seenCrit[c.ID] = true
			if strings.TrimSpace(c.Statement) == "" {
				out = append(out, errf(check, subject, "statement is required"))
			}
			if strings.TrimSpace(c.Verification) == "" {
				out = append(out, errf(check, subject, "verification is required"))
			}
			if len(c.Evidence) == 0 {
				out = append(out, errf(check, subject, "at least one evidence path is required"))
			}
			if c.Gate != "" {
				if _, ok := LookupCheck(c.Gate); !ok {
					out = append(out, errf(check, subject, "gate %q is not implemented by cmd/ops-gate (available: %v)", c.Gate, CheckNames()))
				}
			}
			if c.RequiresDeployedInfrastructure && c.Gate != "" {
				out = append(out, errf(check, subject, "a criterion that needs deployed infrastructure cannot also be proven by a static gate"))
			}
			if c.RequiresHumanReview && c.Gate != "" {
				out = append(out, errf(check, subject, "a criterion that needs human review cannot also be proven by a static gate"))
			}
			if c.RequiresHumanReview && c.RequiresDeployedInfrastructure {
				out = append(out, errf(check, subject, "pick one: requires_human_review or requires_deployed_infrastructure"))
			}
			// Keep the flag and the stated verification honest about
			// each other: a criterion whose verification is "manual
			// review" must be flagged, and vice versa, otherwise a
			// human judgement quietly counts as an automated pass.
			if c.RequiresHumanReview != (c.Verification == ManualVerification) {
				out = append(out, errf(check, subject,
					"requires_human_review is %t but verification is %q; a manual criterion must use verification: %q and set the flag",
					c.RequiresHumanReview, c.Verification, ManualVerification))
			}
		}
	}
	for _, must := range requiredScorecardDimensions {
		if !seenDim[must] {
			out = append(out, errf(check, ScorecardDefinitionPath, "missing mandatory dimension %q", must))
		}
	}
	return out
}

// GenerateScorecard derives every criterion status from the repository.
// Nothing is hand-asserted: a criterion is `met` only when all of its
// evidence resolves and its gate (if any) passes.
func GenerateScorecard(fsys fs.FS, d *ScorecardDefinition, commit string, now time.Time) *Scorecard {
	gateCache := map[string]bool{}
	gatePasses := func(name string) bool {
		if v, ok := gateCache[name]; ok {
			return v
		}
		c, ok := LookupCheck(name)
		if !ok {
			gateCache[name] = false
			return false
		}
		res := &Result{}
		res.Add(c.Run(fsys)...)
		gateCache[name] = res.OK()
		return gateCache[name]
	}

	card := &Scorecard{GeneratedAt: now, Commit: commit}
	for _, dim := range d.Dimensions {
		dr := DimensionResult{ID: dim.ID, Title: dim.Title, Question: dim.Question}
		for _, c := range dim.Criteria {
			cr := CriterionResult{ID: c.ID, Statement: c.Statement, Verification: c.Verification}

			missing := make([]string, 0)
			for _, ev := range c.Evidence {
				if !exists(fsys, ev) {
					missing = append(missing, ev)
				}
			}
			sort.Strings(missing)

			switch {
			case c.RequiresDeployedInfrastructure:
				cr.Status = StatusUnverifiable
				cr.Notes = append(cr.Notes, "needs a deployed environment or real credentials; CI cannot prove this either way")
			case len(missing) > 0:
				cr.Status = StatusGap
				cr.Notes = append(cr.Notes, "missing evidence: "+strings.Join(missing, ", "))
			case c.RequiresHumanReview:
				cr.Status = StatusUnverifiable
				cr.Notes = append(cr.Notes, "the artifact exists, but the assessment is a human judgement; CI cannot score it")
			case c.Gate != "" && !gatePasses(c.Gate):
				cr.Status = StatusGap
				cr.Notes = append(cr.Notes, fmt.Sprintf("gate %q currently fails", c.Gate))
			default:
				cr.Status = StatusMet
				if c.Gate != "" {
					cr.Notes = append(cr.Notes, fmt.Sprintf("gate %q passes", c.Gate))
				}
			}

			switch cr.Status {
			case StatusMet:
				dr.Met++
				card.Met++
			case StatusGap:
				dr.Gap++
				card.Gap++
			default:
				dr.Unverifiable++
				card.Unverifiable++
			}
			dr.Criteria = append(dr.Criteria, cr)
		}
		card.Dimensions = append(card.Dimensions, dr)
	}
	return card
}

// RenderScorecard turns a Scorecard into the generated markdown document.
func RenderScorecard(card *Scorecard) string {
	var b strings.Builder
	b.WriteString("# Production readiness scorecard\n\n")
	b.WriteString("<!-- GENERATED FILE — DO NOT EDIT BY HAND.\n")
	b.WriteString("     Source of truth: ops/scorecard/dimensions.yaml\n")
	b.WriteString("     Regenerate with: go run ./cmd/readiness-scorecard -write -->\n\n")
	fmt.Fprintf(&b, "Generated: %s\n\n", card.GeneratedAt.UTC().Format(time.RFC3339))
	if card.Commit != "" {
		fmt.Fprintf(&b, "Commit: `%s`\n\n", card.Commit)
	}

	b.WriteString("## How to read this\n\n")
	b.WriteString("Every status below is **derived**, never asserted:\n\n")
	b.WriteString("| Status | Meaning |\n|---|---|\n")
	b.WriteString("| `met` | Every evidence path exists and the associated static gate passes. |\n")
	b.WriteString("| `gap` | Evidence is missing or the gate fails. |\n")
	b.WriteString("| `unverifiable` | The criterion needs a deployed environment, real credentials, or a human judgement. CI cannot prove it either way, so it is **excluded from the score** and listed explicitly rather than counted as met. |\n\n")
	fmt.Fprintf(&b, "Score is `met / (met + gap)`. Overall: **%.0f%%** (%d met, %d gap, %d unverifiable).\n\n",
		card.Score(), card.Met, card.Gap, card.Unverifiable)

	b.WriteString("## Summary\n\n")
	b.WriteString("| Dimension | Score | Met | Gap | Unverifiable |\n|---|---:|---:|---:|---:|\n")
	for _, d := range card.Dimensions {
		fmt.Fprintf(&b, "| %s | %.0f%% | %d | %d | %d |\n", d.Title, d.Score(), d.Met, d.Gap, d.Unverifiable)
	}
	b.WriteString("\n")

	for _, d := range card.Dimensions {
		fmt.Fprintf(&b, "## %s\n\n", d.Title)
		fmt.Fprintf(&b, "> %s\n\n", d.Question)
		b.WriteString("| Criterion | Status | Verification | Notes |\n|---|---|---|---|\n")
		for _, c := range d.Criteria {
			notes := strings.Join(c.Notes, "; ")
			if notes == "" {
				notes = "—"
			}
			fmt.Fprintf(&b, "| %s<br/><sub>`%s`</sub> | `%s` | `%s` | %s |\n",
				escapePipes(c.Statement), c.ID, c.Status, escapePipes(c.Verification), escapePipes(notes))
		}
		b.WriteString("\n")
	}

	gaps := make([]string, 0)
	unverifiable := make([]string, 0)
	for _, d := range card.Dimensions {
		for _, c := range d.Criteria {
			switch c.Status {
			case StatusGap:
				gaps = append(gaps, fmt.Sprintf("- **%s** (%s) — %s", c.ID, d.Title, strings.Join(c.Notes, "; ")))
			case StatusUnverifiable:
				unverifiable = append(unverifiable, fmt.Sprintf("- **%s** (%s) — %s — run: `%s`", c.ID, d.Title, c.Statement, c.Verification))
			}
		}
	}
	b.WriteString("## Open gaps\n\n")
	if len(gaps) == 0 {
		b.WriteString("None.\n\n")
	} else {
		b.WriteString(strings.Join(gaps, "\n") + "\n\n")
	}
	b.WriteString("## Not machine-verifiable\n\n")
	if len(unverifiable) == 0 {
		b.WriteString("None.\n")
	} else {
		b.WriteString("These are **not** claimed as done by CI. Each needs a real environment, a real drill, or a human assessment:\n\n")
		b.WriteString(strings.Join(unverifiable, "\n") + "\n")
	}
	return b.String()
}

func escapePipes(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "|", "\\|"), "\n", " ")
}

// CheckScorecard loads and validates the OPS-13 definition.
func CheckScorecard(fsys fs.FS) []Finding {
	d, err := LoadScorecardDefinition(fsys, ScorecardDefinitionPath)
	if err != nil {
		return []Finding{errf("scorecard", ScorecardDefinitionPath, "%v", err)}
	}
	return ValidateScorecard(fsys, d)
}
