// Package mileageterm evaluates a recorded vehicle distance allowance.
package mileageterm

import (
	"math"
	"sort"
	"time"
)

const (
	MaxSamples    = 4096
	MaxOdometerM  = 10_000_000_000
	maxDrivingMps = 80
	maxPaceMps    = 1_000_000.0 / (24 * 60 * 60)
	minSpan       = 28 * 24 * time.Hour
	maxGap        = 21 * 24 * time.Hour
	maxAge        = 7 * 24 * time.Hour
)

type Term struct {
	Start, End time.Time
	OpeningM   float64
	AllowanceM float64
	MinimumM   float64
}

func (t Term) Valid() bool {
	return t.Start.Year() >= 2000 && t.End.Year() < 2200 &&
		t.End.Sub(t.Start) >= minSpan && t.End.Sub(t.Start) <= 10*366*24*time.Hour &&
		t.OpeningM >= 0 && t.OpeningM <= MaxOdometerM &&
		t.AllowanceM >= 1000 && t.AllowanceM <= 10_000_000 &&
		t.MinimumM >= 100 && t.MinimumM <= t.AllowanceM
}

type Observation struct {
	At        time.Time
	OdometerM float64
}

type Projection struct {
	EvidenceFrom   time.Time `json:"evidence_from"`
	ObservedAt     time.Time `json:"observed_at"`
	ObservedDays   int       `json:"observed_days"`
	UsedM          float64   `json:"used_m"`
	AllowedToDateM float64   `json:"allowed_to_date_m"`
	LowerM         float64   `json:"lower_m"`
	UpperM         float64   `json:"upper_m"`
}

type Outcome string

const (
	NotActionable        Outcome = "not_actionable"
	InsufficientEvidence Outcome = "insufficient_evidence"
	ConflictingEvidence  Outcome = "conflicting_evidence"
	NotMaterial          Outcome = "not_material"
	OffPace              Outcome = "off_pace"
)

func Project(term Term, observations []Observation, through, now time.Time) (*Projection, Outcome) {
	if !term.Valid() || through.After(now) || through.Sub(term.Start) < minSpan || term.End.Sub(now) <= maxAge {
		return nil, NotActionable
	}
	if len(observations) < 8 || len(observations) > MaxSamples {
		return nil, InsufficientEvidence
	}
	samples := append([]Observation(nil), observations...)
	sort.Slice(samples, func(i, j int) bool { return samples[i].At.Before(samples[j].At) })
	first, last := samples[0], samples[len(samples)-1]
	if last.At.Sub(first.At) < minSpan || through.Sub(last.At) > maxAge {
		return nil, InsufficientEvidence
	}
	loc := term.Start.Location()
	days := 1
	previous := Observation{At: term.Start, OdometerM: term.OpeningM}
	for i, current := range samples {
		duration := current.At.Sub(previous.At)
		distance := current.OdometerM - previous.OdometerM
		if !(current.OdometerM > 0 && current.OdometerM <= MaxOdometerM) || !current.At.Before(through) ||
			duration < 0 || distance < 0 || distance > maxDrivingMps*duration.Seconds() {
			return nil, ConflictingEvidence
		}
		if i > 0 {
			if duration > maxGap {
				return nil, InsufficientEvidence
			}
			if dayOf(current.At.In(loc)) != dayOf(previous.At.In(loc)) {
				days++
			}
		}
		previous = current
	}
	if days < 8 {
		return nil, InsufficientEvidence
	}

	middle := samples[sort.Search(len(samples), func(i int) bool {
		return !samples[i].At.Before(first.At.Add(last.At.Sub(first.At) / 2))
	})]
	early, late := middle.At.Sub(first.At), last.At.Sub(middle.At)
	if early < 10*24*time.Hour || late < 10*24*time.Hour {
		return nil, InsufficientEvidence
	}
	used := last.OdometerM - term.OpeningM
	termPace := used / last.At.Sub(term.Start).Seconds()
	earlyPace := (middle.OdometerM - first.OdometerM) / early.Seconds()
	latePace := (last.OdometerM - middle.OdometerM) / late.Seconds()
	// This is a range of plausible paces, not a statistical confidence interval.
	lower, upper := min(termPace*.8, earlyPace, latePace), max(termPace*1.2, earlyPace, latePace)
	if upper > maxPaceMps {
		return nil, ConflictingEvidence
	}
	elapsed, remaining := last.At.Sub(term.Start), term.End.Sub(last.At)
	p := &Projection{EvidenceFrom: first.At, ObservedAt: last.At, ObservedDays: days, UsedM: used,
		AllowedToDateM: term.AllowanceM * elapsed.Seconds() / term.End.Sub(term.Start).Seconds(),
		LowerM:         math.Max(used, math.Floor(used+lower*remaining.Seconds())),
		UpperM:         math.Ceil(used + upper*remaining.Seconds())}
	if p.LowerM-term.AllowanceM < term.MinimumM {
		return nil, NotMaterial
	}
	return p, OffPace
}

func dayOf(at time.Time) int {
	return 366*at.Year() + at.YearDay()
}
