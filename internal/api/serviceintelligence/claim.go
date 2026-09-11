package serviceintelligence

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// Claim-draft limits: the ticket stays scannable for a service advisor.
const (
	maxClaimComms    = 3
	maxClaimSymptoms = 5
	maxClaimEvidence = 6
	maxIssueChars    = 500
)

// ClaimCoverage is one applicable warranty line in the draft.
type ClaimCoverage struct {
	Name          string `json:"name"`
	Status        string `json:"status"`
	DaysRemaining int    `json:"days_remaining"`
}

// ClaimDraft is a ready-to-paste service ticket assembled from the
// owner's issue description, live warranty countdown, matched
// manufacturer communications, ranked symptoms, and evidence.
type ClaimDraft struct {
	Subject    string          `json:"subject"`
	Issue      string          `json:"issue"`
	Vehicle    string          `json:"vehicle"`
	Coverages  []ClaimCoverage `json:"coverages"`
	Comms      []string        `json:"communications"`
	Symptoms   []string        `json:"symptoms"`
	Evidence   []string        `json:"evidence"`
	Ask        string          `json:"ask"`
	Body       string          `json:"body"`
	Disclaimer string          `json:"disclaimer"`
}

// BuildClaimDraft assembles the draft. Pure: no I/O, deterministic.
// Empty issue yields a template ticket the owner completes by hand.
func BuildClaimDraft(issue string, outlook *WarrantyOutlook, resp *Response) ClaimDraft {
	issue = strings.TrimSpace(issue)
	if len(issue) > maxIssueChars {
		issue = issue[:maxIssueChars]
	}
	d := ClaimDraft{
		Issue:     issue,
		Coverages: []ClaimCoverage{},
		Comms:     []string{},
		Symptoms:  []string{},
		Evidence:  []string{},
		Disclaimer: "Auto-drafted by TeslaSync from your vehicle data. Verify coverage " +
			"with Tesla before your appointment — terms vary by region and trim.",
	}
	if outlook != nil {
		d.Vehicle = fmt.Sprintf("%s (%d)", outlook.Model, outlook.ModelYear)
		for _, c := range outlook.Coverages {
			d.Coverages = append(d.Coverages, ClaimCoverage{
				Name: c.Name, Status: c.Status, DaysRemaining: c.DaysRemaining,
			})
		}
	}
	if resp != nil {
		d.Comms = topComms(resp.Communications)
		d.Symptoms = topSymptoms(resp.RankedSymptoms)
		d.Evidence = topEvidence(resp.Evidence.Items)
		if d.Vehicle == "" && resp.VehicleContext.Model != "" {
			d.Vehicle = fmt.Sprintf("%s %s (%d)",
				resp.VehicleContext.Make, resp.VehicleContext.Model, resp.VehicleContext.ModelYear)
		}
	}
	if issue == "" {
		d.Subject = "Service request — issue description needed"
	} else {
		d.Subject = "Service request: " + firstSentence(issue)
	}
	d.Ask = buildAsk(d.Coverages, len(d.Comms) > 0)
	d.Body = renderClaimBody(d)
	return d
}

func topComms(comms []CommunicationFinding) []string {
	sorted := append([]CommunicationFinding(nil), comms...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Confidence > sorted[j].Confidence })
	out := []string{}
	for _, c := range sorted {
		if len(out) >= maxClaimComms {
			break
		}
		line := fmt.Sprintf("TSB %s (%s): %s", c.CommunicationNumber, c.Component, oneLine(c.Summary))
		if c.SourceDocumentURL != "" {
			line += " — " + c.SourceDocumentURL
		}
		out = append(out, line)
	}
	return out
}

func topSymptoms(symptoms []SymptomMatch) []string {
	sorted := append([]SymptomMatch(nil), symptoms...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Score > sorted[j].Score })
	out := []string{}
	for _, s := range sorted {
		if len(out) >= maxClaimSymptoms {
			break
		}
		ts := s.ObservedAt.Format("2006-01-02")
		out = append(out, fmt.Sprintf("%s on %s (%s, observed %s)", s.Signal, s.Component, s.Severity, ts))
	}
	return out
}

func topEvidence(items []EvidenceItem) []string {
	out := []string{}
	for _, e := range items {
		if len(out) >= maxClaimEvidence {
			break
		}
		line := fmt.Sprintf("%s: %s", e.Title, oneLine(e.Summary))
		if e.SourceDocumentURL != nil && *e.SourceDocumentURL != "" {
			line += " — " + *e.SourceDocumentURL
		}
		out = append(out, line)
	}
	return out
}

func buildAsk(coverages []ClaimCoverage, hasComms bool) string {
	active := []string{}
	for _, c := range coverages {
		if c.Status != "expired" {
			active = append(active, fmt.Sprintf("%s (%d days left)", c.Name, c.DaysRemaining))
		}
	}
	var b strings.Builder
	b.WriteString("Please diagnose the issue above")
	if len(active) > 0 {
		b.WriteString(" under " + strings.Join(active, " / "))
	} else {
		b.WriteString("; all Tesla coverages appear expired, so please quote out-of-warranty repair")
	}
	if hasComms {
		b.WriteString(", checking the listed manufacturer communications for an applicable bulletin fix")
	}
	b.WriteString(".")
	return b.String()
}

func renderClaimBody(d ClaimDraft) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Subject: %s\n\n", d.Subject)
	if d.Vehicle != "" {
		fmt.Fprintf(&b, "Vehicle: %s\n\n", d.Vehicle)
	}
	if d.Issue != "" {
		fmt.Fprintf(&b, "Issue:\n%s\n\n", d.Issue)
	}
	if len(d.Coverages) > 0 {
		b.WriteString("Warranty status:\n")
		for _, c := range d.Coverages {
			fmt.Fprintf(&b, "- %s: %s (%d days remaining)\n", c.Name, c.Status, c.DaysRemaining)
		}
		b.WriteString("\n")
	}
	writeList := func(title string, items []string) {
		if len(items) == 0 {
			return
		}
		fmt.Fprintf(&b, "%s:\n", title)
		for _, it := range items {
			fmt.Fprintf(&b, "- %s\n", it)
		}
		b.WriteString("\n")
	}
	writeList("Related manufacturer communications", d.Comms)
	writeList("Observed symptoms", d.Symptoms)
	writeList("Supporting evidence", d.Evidence)
	fmt.Fprintf(&b, "Requested action:\n%s\n\n%s\n", d.Ask, d.Disclaimer)
	return b.String()
}

func firstSentence(s string) string {
	for i, r := range s {
		if r == '.' || r == '!' || r == '?' || r == '\n' {
			return strings.TrimSpace(s[:i])
		}
	}
	return s
}

func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// ClaimDraftHandler serves GET
// /service-intelligence/vehicles/{vehicleID}/claim-draft?issue=&odometer_km=.
func (h *Handler) ClaimDraftHandler(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "service_intelligence.claim_draft")
	defer span.End()
	r = r.WithContext(ctx)

	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}
	odometerKm := -1.0
	if s := r.URL.Query().Get("odometer_km"); s != "" {
		v, err := strconv.ParseFloat(s, 64)
		if err != nil || v < 0 || math.IsNaN(v) {
			httpx.WriteError(w, http.StatusBadRequest, "odometer_km must be a non-negative number")
			return
		}
		odometerKm = v
	}

	resp, err := h.service.Get(ctx, vehicleID, false)
	if err != nil {
		h.writeServiceError(w, ctx, span, vehicleID, err)
		return
	}
	outlook, err := h.service.Warranty(ctx, vehicleID, odometerKm)
	if err != nil {
		h.writeServiceError(w, ctx, span, vehicleID, err)
		return
	}

	draft := BuildClaimDraft(r.URL.Query().Get("issue"), outlook, resp)
	w.Header().Set("Cache-Control", endpointCacheControl)
	httpx.WriteJSON(w, http.StatusOK, draft)
}
