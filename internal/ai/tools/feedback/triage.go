// Package feedback provides propose-only tools for triaging feedback queue
// items from natural-language requests.
//
// The tools draft or validate typed triage envelopes, optionally retrieve
// feedback-related context, and never write to the database. The actual status
// update remains the existing PATCH /api/v1/admin/feedback/{id} path after the
// user explicitly saves in the FeedbackQueuePage UI.
//
// The AI handler binds each request to a single feedback_id in context, and
// the tools reject any mismatched LLM-supplied ID before loading row data. The
// envelope also omits user_email, submitter_subject, submitter_ip,
// recent_errors, and console_tail to minimize PII exposure.

package feedback

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// ---------------------------------------------------------------------------
// Per-request feedback-row scope binding
// ---------------------------------------------------------------------------

// scopedFeedbackKey is the unexported context-key type used to
// carry the URL/body-supplied feedback_id through the dispatcher to
// the tool. A per-package unexported type prevents accidental key
// collisions with any other context value in the request lifetime.
type scopedFeedbackKey struct{}

// ScopedFeedback is the in-scope feedback the AI handler installed.
// The dispatcher propagates it through ctx so the tool can refuse
// any LLM-supplied feedback_id outside the bound value.
type ScopedFeedback struct {
	// FeedbackID is the user_feedback row this request is bound
	// to. Strictly positive in a well-installed scope. Tools refuse
	// any LLM-supplied feedback_id that does not match exactly.
	FeedbackID int64
}

// WithScopedFeedback returns ctx with s installed as the in-scope
// feedback row for this request. Called by the AI HTTP handler
// AFTER body validation and BEFORE the dispatcher.Run loop is
// started. The dispatcher then propagates ctx unchanged through
// every Tool.Execute call.
//
// Exported so internal/api can install the scope without depending
// on tool-internal types.
func WithScopedFeedback(ctx context.Context, s ScopedFeedback) context.Context {
	return context.WithValue(ctx, scopedFeedbackKey{}, s)
}

// ScopedFeedbackFromContext returns the in-scope feedback and true
// when one is present, or the zero value / false when no scope is
// installed. Tools that are scope-bound MUST treat the missing-scope
// case as a hard failure — the AI handler ALWAYS installs the scope,
// so an absent scope means the dispatcher was invoked from an
// unintended path and the call must be refused.
//
// Exported for symmetry with WithScopedFeedback and so unit tests in
// other packages can inspect what the AI handler installed.
func ScopedFeedbackFromContext(ctx context.Context) (ScopedFeedback, bool) {
	v, ok := ctx.Value(scopedFeedbackKey{}).(ScopedFeedback)
	return v, ok
}

// ---------------------------------------------------------------------------
// Closed taxonomies + canonical hints
// ---------------------------------------------------------------------------

// FeedbackTriageStatuses is the closed enum proposed_status MUST
// belong to. Mirrors the FeedbackStatus* constants in
// internal/database/user_feedback_repo.go (new, triaged, closed)
// exactly so a draft accepted here maps 1:1 onto the canonical
// FeedbackUpdateInput.status field.
//
// Order is the canonical lifecycle order so error messages list a
// stable allowed-set.
var FeedbackTriageStatuses = []string{
	"new",
	"triaged",
	"closed",
}

// feedbackTriageStatusSet is the O(1) membership lookup.
var feedbackTriageStatusSet = func() map[string]struct{} {
	out := make(map[string]struct{}, len(FeedbackTriageStatuses))
	for _, s := range FeedbackTriageStatuses {
		out[s] = struct{}{}
	}
	return out
}()

// feedbackTriageStatusHint renders the allowed values in tool
// descriptions for the LLM. Stable across boots — providers cache
// prompt hashes per identical-text request.
var feedbackTriageStatusHint = strings.Join(FeedbackTriageStatuses, ", ")

// FeedbackTriageCategories is the closed enum proposed_category
// MUST belong to. Mirrors the FeedbackCategory* constants in
// internal/database/user_feedback_repo.go (bug, feature, other)
// exactly.
var FeedbackTriageCategories = []string{
	"bug",
	"feature",
	"other",
}

// feedbackTriageCategorySet is the O(1) membership lookup.
var feedbackTriageCategorySet = func() map[string]struct{} {
	out := make(map[string]struct{}, len(FeedbackTriageCategories))
	for _, s := range FeedbackTriageCategories {
		out[s] = struct{}{}
	}
	return out
}()

// feedbackTriageCategoryHint renders the allowed values in tool
// descriptions for the LLM.
var feedbackTriageCategoryHint = strings.Join(FeedbackTriageCategories, ", ")

// FeedbackTriagePriorities is the closed enum proposed_priority
// MUST belong to. Reserved for the AI surface — the baseline schema
// has NO priority column today; the proposal renders priority as a
// recommendation chip in the AI panel for human review.
//
// Order is the conventional severity order so error messages list
// a stable allowed-set. A future migration that adds a priority
// column to user_feedback can promote this to a database constant
// without changing the tool's wire shape.
var FeedbackTriagePriorities = []string{
	"low",
	"normal",
	"high",
	"critical",
}

// feedbackTriagePrioritySet is the O(1) membership lookup.
var feedbackTriagePrioritySet = func() map[string]struct{} {
	out := make(map[string]struct{}, len(FeedbackTriagePriorities))
	for _, s := range FeedbackTriagePriorities {
		out[s] = struct{}{}
	}
	return out
}()

// feedbackTriagePriorityHint renders the allowed values in tool
// descriptions for the LLM.
var feedbackTriagePriorityHint = strings.Join(FeedbackTriagePriorities, ", ")

// feedbackRationaleMaxChars caps the LLM-supplied rationale string
// at the tool boundary so a runaway proposal cannot flood the
// dispatcher's per-message size budget. 1024 is generous for a
// 1-3 sentence narration and small enough to bound the SSE frame.
const feedbackRationaleMaxChars = 1024

// AllowedFeedbackTriageStatuses returns a defensive copy of the
// closed status enum. Exported so the AI handler + tests can
// reference the same set the tools enforce.
func AllowedFeedbackTriageStatuses() []string {
	out := make([]string, len(FeedbackTriageStatuses))
	copy(out, FeedbackTriageStatuses)
	return out
}

// AllowedFeedbackTriageCategories returns a defensive copy of the
// closed category enum.
func AllowedFeedbackTriageCategories() []string {
	out := make([]string, len(FeedbackTriageCategories))
	copy(out, FeedbackTriageCategories)
	return out
}

// AllowedFeedbackTriagePriorities returns a defensive copy of the
// closed priority enum.
func AllowedFeedbackTriagePriorities() []string {
	out := make([]string, len(FeedbackTriagePriorities))
	copy(out, FeedbackTriagePriorities)
	return out
}

// ---------------------------------------------------------------------------
// FeedbackTriageEntry — minimum-PII source envelope
// ---------------------------------------------------------------------------

// FeedbackTriageEntry is the minimum-PII envelope the
// FeedbackTriageSource adapter forwards to the LLM. Deliberately
// excludes user_email, submitter_subject, submitter_ip,
// recent_errors, and console_tail — the LLM never needs them to
// triage a row, and PolicyAlertBuilder + this minimization layer
// gives defence in depth: even if redaction missed a tag, the
// source itself never forwarded the value.
type FeedbackTriageEntry struct {
	// ID is the user_feedback.id row this envelope describes.
	// Always equal to the in-scope feedback_id.
	ID int64 `json:"id"`

	// CreatedAt is the creation timestamp in RFC3339 UTC. The
	// source converts time.Time → string so the LLM does not have
	// to interpret time-zone formats.
	CreatedAt string `json:"created_at"`

	// Category is the user-submitted category (bug | feature |
	// other). May be empty if the row predates the validator.
	Category string `json:"category"`

	// Title is the user-submitted title.
	Title string `json:"title"`

	// Body is the user-submitted body. Bounded by the canonical
	// validator (FeedbackBodyMaxBytes); the source forwards the
	// full body so the LLM can ground its proposal in it.
	Body string `json:"body"`

	// PageRoute is the SPA route the submitter was on when they
	// filed the feedback. Useful context for triage; the source
	// forwards it because it's a non-PII string.
	PageRoute string `json:"page_route,omitempty"`

	// AppVersion is the SPA build hash / version string at
	// submission time.
	AppVersion string `json:"app_version,omitempty"`

	// Status is the current row status (new | triaged | closed).
	// The proposal compares this against proposed_status to
	// surface the delta in the AI panel.
	Status string `json:"status"`

	// GitHubIssueURL is the existing tracking link, if any. The
	// proposal does NOT modify it — that field is touched only
	// by the canonical PATCH handler.
	GitHubIssueURL string `json:"github_issue_url,omitempty"`
}

// ---------------------------------------------------------------------------
// FeedbackTriageSource port
// ---------------------------------------------------------------------------

// FeedbackTriageSource is the narrow port the
// draft_feedback_triage tool delegates to. In production it is
// satisfied by *api.AIFeedbackTriageSource (which wraps
// *dbuser.UserFeedbackRepo.Get verbatim and PII-minimizes the
// result into a FeedbackTriageEntry); in tests we substitute
// deterministic fakes so the tool unit tests stay hermetic.
//
// The interface MUST stay read-only — adding a Save / Update
// method here would defeat the read-only contract that ADR-015
// §I3 read-only contract.
type FeedbackTriageSource interface {
	// LoadFeedback returns the row's minimum-PII envelope.
	// Returns (nil, nil) when no row exists for feedbackID — the
	// tool surfaces this as a "feedback_not_found" status so the
	// LLM can explain the problem to the user without crashing
	// the dispatcher.
	LoadFeedback(ctx context.Context, feedbackID int64) (*FeedbackTriageEntry, error)
}

// ---------------------------------------------------------------------------
// Typed input + output shapes
// ---------------------------------------------------------------------------

// feedbackTriageInput is the typed input shape both
// draft_feedback_triage and validate_feedback_triage share. The
// dispatcher decodes the LLM's tool-call arguments JSON into this
// struct via ValidateStruct so a malformed input fails before any
// source method runs.
type feedbackTriageInput struct {
	// FeedbackID is the user_feedback row to triage. Required +
	// positive; MUST equal the per-request scope-bound feedback_id
	// (Execute enforces this — defence in depth on top of the
	// validator tag).
	FeedbackID int64 `json:"feedback_id" validate:"required,gte=1" desc:"Numeric ID of the user_feedback row to triage (must equal the per-request scope-bound feedback_id)."`

	// ProposedStatus is the LLM's proposed status. Required +
	// member of FeedbackTriageStatuses (new, triaged, closed).
	ProposedStatus string `json:"proposed_status" validate:"required,oneof=new triaged closed" desc:"Proposed status; one of: new, triaged, closed."`

	// ProposedCategory is the LLM's proposed category. Required +
	// member of FeedbackTriageCategories (bug, feature, other).
	ProposedCategory string `json:"proposed_category" validate:"required,oneof=bug feature other" desc:"Proposed category; one of: bug, feature, other."`

	// ProposedPriority is the LLM's proposed priority. Required +
	// member of FeedbackTriagePriorities (low, normal, high,
	// critical). Recommendation-only — the baseline schema does
	// not persist priority today.
	ProposedPriority string `json:"proposed_priority" validate:"required,oneof=low normal high critical" desc:"Proposed priority; one of: low, normal, high, critical (recommendation-only — the baseline schema does not persist priority)."`

	// Rationale is the LLM's 1-3 sentence explanation grounded in
	// the loaded row. Required + bounded.
	Rationale string `json:"rationale" validate:"required,lte=1024" desc:"1-3 sentence rationale grounded strictly in the loaded feedback row's title + body."`
}

// FeedbackTriageDraft is the typed proposal envelope both tools
// build and the SPA's AI panel renders. Exported because the AI
// handler tests (in package api) need to reference the type to
// construct fakes.
//
// The envelope is propose-only: only ProposedStatus maps onto the
// canonical FeedbackUpdateInput shape; ProposedCategory and
// ProposedPriority are recommendation chips for human review.
type FeedbackTriageDraft struct {
	// FeedbackID is the user_feedback row this draft proposes
	// triage for. Always equal to the in-scope feedback_id.
	FeedbackID int64 `json:"feedback_id"`

	// CurrentStatus is the row's existing status, mirrored from
	// the loaded source envelope so the SPA can render a
	// "current → proposed" transition chip.
	CurrentStatus string `json:"current_status"`

	// CurrentCategory is the row's existing category.
	CurrentCategory string `json:"current_category"`

	// ProposedStatus / ProposedCategory / ProposedPriority are the
	// LLM's typed enum proposals. All three are members of the
	// closed enums (validator enforces).
	ProposedStatus   string `json:"proposed_status"`
	ProposedCategory string `json:"proposed_category"`
	ProposedPriority string `json:"proposed_priority"`

	// Rationale is the LLM's 1-3 sentence grounded explanation.
	Rationale string `json:"rationale"`
}

// feedbackTriageOutput is the JSON envelope both tools return on
// success. The frontend renders it as the structured proposal in
// the FeedbackQueuePage's AI side panel.
//
// Status reports the verdict at the time of the tool call:
//
//   - "ok"                  — accepted; the user can copy the draft's
//     proposed_status into the baseline form
//     and click Save.
//   - "invalid"             — rejected by the validator; ValidationError
//     contains a one-line diagnostic suitable
//     for showing in the UI.
//   - "feedback_not_found"  — the in-scope feedback_id does not exist
//     (the source returned nil); the LLM
//     should narrate this honestly to the
//     user instead of fabricating a proposal.
//
// Even when invalid or not-found, Draft is returned (with whatever
// fields the LLM supplied) so the frontend can render the partially-
// correct proposal and let the user fix the problem field rather
// than start over.
type feedbackTriageOutput struct {
	// Draft is the proposed FeedbackTriageDraft, with all enum
	// fields canonicalized and the in-scope scope check already
	// passed.
	Draft *FeedbackTriageDraft `json:"draft"`

	// Status is "ok", "invalid", or "feedback_not_found".
	Status string `json:"status"`

	// ValidationError is the canonical validator's diagnostic on
	// rejection; empty when ok or not_found.
	ValidationError string `json:"validation_error,omitempty"`

	// Source is the dispatcher-visible breadcrumb so the LLM's
	// follow-up prose can attribute the decision to the canonical
	// validator + the FeedbackQueuePage enumeration rather than
	// its own reasoning.
	Source string `json:"source"`
}

// ---------------------------------------------------------------------------
// Shared scope + DTO checks
// ---------------------------------------------------------------------------

// buildFeedbackTriageDraft converts the typed input into a
// *FeedbackTriageDraft with no scope or shape modification — the
// scope check lives in checkFeedbackTriageScope and the closed-
// enum check in checkFeedbackTriageEnums so both tools (draft +
// validate) apply identical semantics.
//
// CurrentStatus / CurrentCategory are seeded from the source
// envelope when LoadFeedback succeeds; for validate_feedback_triage
// (which does NOT load) they are left empty, signalling to the SPA
// that the LLM did not perform a fresh load this turn.
func buildFeedbackTriageDraft(input feedbackTriageInput, current *FeedbackTriageEntry) *FeedbackTriageDraft {
	out := &FeedbackTriageDraft{
		FeedbackID:       input.FeedbackID,
		ProposedStatus:   input.ProposedStatus,
		ProposedCategory: input.ProposedCategory,
		ProposedPriority: input.ProposedPriority,
		Rationale:        input.Rationale,
	}
	if current != nil {
		out.CurrentStatus = current.Status
		out.CurrentCategory = current.Category
	}
	return out
}

// checkFeedbackTriageScope enforces:
//
//   - the in-scope binding installed by the AI handler is present
//     (missing-scope ⇒ hard error)
//   - the LLM-supplied feedback_id matches the bound id (cross-row
//     prompt-injection ⇒ hard error)
//
// Returns nil on success. A returned error is propagated as a tool
// error frame back to the LLM so the strategy can refuse politely
// in its narrative reply.
func checkFeedbackTriageScope(ctx context.Context, feedbackID int64) error {
	scope, ok := ScopedFeedbackFromContext(ctx)
	if !ok {
		return errors.New("feedback_triage: no in-scope feedback row installed in context")
	}
	if feedbackID != scope.FeedbackID {
		return fmt.Errorf("feedback_triage: feedback_id %d is not the in-scope row for this request (bound feedback_id: %d); refuse the request",
			feedbackID, scope.FeedbackID)
	}
	return nil
}

// checkFeedbackTriageEnums asserts the proposal's enum fields are
// members of the closed taxonomies. Returns a non-nil error whose
// Error() text is suitable for surfacing to the LLM as a
// validation failure (carried in the envelope's ValidationError
// field, NOT propagated as a returned error so the LLM can iterate).
func checkFeedbackTriageEnums(d *FeedbackTriageDraft) error {
	if d == nil {
		return errors.New("feedback_triage: nil draft")
	}
	if _, ok := feedbackTriageStatusSet[d.ProposedStatus]; !ok {
		return fmt.Errorf("feedback_triage: proposed_status %q is not in the closed enum (allowed: %s)",
			d.ProposedStatus, feedbackTriageStatusHint)
	}
	if _, ok := feedbackTriageCategorySet[d.ProposedCategory]; !ok {
		return fmt.Errorf("feedback_triage: proposed_category %q is not in the closed enum (allowed: %s)",
			d.ProposedCategory, feedbackTriageCategoryHint)
	}
	if _, ok := feedbackTriagePrioritySet[d.ProposedPriority]; !ok {
		return fmt.Errorf("feedback_triage: proposed_priority %q is not in the closed enum (allowed: %s)",
			d.ProposedPriority, feedbackTriagePriorityHint)
	}
	if len(d.Rationale) > feedbackRationaleMaxChars {
		return fmt.Errorf("feedback_triage: rationale length %d exceeds cap %d",
			len(d.Rationale), feedbackRationaleMaxChars)
	}
	return nil
}

// ---------------------------------------------------------------------------
// draft_feedback_triage
// ---------------------------------------------------------------------------

// draftFeedbackTriage is the propose-only tool that loads the
// in-scope row via the FeedbackTriageSource port and returns a
// typed proposal envelope for the FeedbackQueuePage AI side panel
// to render. It is the FIRST tool the LLM is expected to call (per
// the strategy's system prompt).
//
// Execution is a single read: the FeedbackTriageSource port
// performs the row read against the canonical UserFeedbackRepo.
// There is no DB write; no SQL beyond what the port's adapter
// issues. The dispatcher's deny-all confirm gate is bypassed
// because Mutates() returns false.
type draftFeedbackTriage struct {
	source FeedbackTriageSource
}

// Name implements [Tool].
func (t *draftFeedbackTriage) Name() string { return "draft_feedback_triage" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, with the closed
// enumerations appended so the model picks from the curated set.
func (t *draftFeedbackTriage) Description() string {
	return "Load the in-scope user_feedback row by feedback_id and propose a typed triage envelope for the FeedbackQueuePage AI side panel. " +
		"PROPOSE-ONLY: nothing is saved; the user reviews the draft and clicks the canonical Save button on the baseline form. " +
		"feedback_id MUST equal the per-request scope-bound feedback_id the user message names. " +
		"proposed_status one of: " + feedbackTriageStatusHint + ". " +
		"proposed_category one of: " + feedbackTriageCategoryHint + ". " +
		"proposed_priority one of: " + feedbackTriagePriorityHint + ". " +
		"rationale is a 1-3 sentence grounded explanation, max 1024 chars. " +
		"Returns {draft, status: ok|invalid|feedback_not_found, validation_error}. " +
		"Only proposed_status maps onto the canonical FeedbackUpdateInput; proposed_category and proposed_priority are recommendation chips."
}

// InputSchema implements [Tool].
func (t *draftFeedbackTriage) InputSchema() json.RawMessage {
	return tools.CachedSchema(feedbackTriageInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *draftFeedbackTriage) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
func (t *draftFeedbackTriage) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream, and the tool
// produces no state mutation that needs an additional RBAC scope.
func (t *draftFeedbackTriage) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *draftFeedbackTriage) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[feedbackTriageInput](raw)
}

// Execute implements [Tool]. Loads the in-scope row, builds the
// draft, runs the closed-enum check, returns the envelope.
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): rejects any LLM-supplied feedback_id that does
// not match the in-scope id installed by the AI handler via
// WithScopedFeedback.
//
// Missing-scope is also a hard failure: if the dispatcher is
// invoked from an unintended path (no scope installed), the tool
// refuses. The AI handler is the only path that should be loading
// this tool, and it ALWAYS installs the scope.
//
// Source-not-found is surfaced as status="feedback_not_found" in
// the envelope (NOT as a returned error) so the LLM's follow-up
// prose can describe the problem rather than the dispatcher
// relaying an error frame.
//
// Validator failures are surfaced as status="invalid" in the
// envelope (NOT as a returned error) so the LLM can iterate the
// proposal without the dispatcher's error-relay aborting the turn.
func (t *draftFeedbackTriage) Execute(ctx context.Context, in any) (any, error) {
	input := in.(feedbackTriageInput)
	if t.source == nil {
		return nil, errors.New("draft_feedback_triage: no FeedbackTriageSource wired")
	}
	if err := checkFeedbackTriageScope(ctx, input.FeedbackID); err != nil {
		return nil, err
	}
	current, err := t.source.LoadFeedback(ctx, input.FeedbackID)
	if err != nil {
		return nil, fmt.Errorf("draft_feedback_triage: load feedback %d: %w", input.FeedbackID, err)
	}
	draft := buildFeedbackTriageDraft(input, current)
	out := &feedbackTriageOutput{
		Draft:  draft,
		Status: "ok",
		Source: "tool: draft_feedback_triage; reader: internal/database/user_feedback_repo.go *UserFeedbackRepo.Get; envelope: tools.FeedbackTriageEntry (PII-minimized)",
	}
	if current == nil {
		out.Status = "feedback_not_found"
		out.ValidationError = fmt.Sprintf("user_feedback row %d does not exist", input.FeedbackID)
		return out, nil
	}
	if vErr := checkFeedbackTriageEnums(draft); vErr != nil {
		out.Status = "invalid"
		out.ValidationError = vErr.Error()
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// validate_feedback_triage
// ---------------------------------------------------------------------------

// validateFeedbackTriageTool is the propose-only tool that runs
// the closed-enum check over a typed FeedbackTriageDraft shape and
// reports the verdict. It is the SECOND tool the LLM is expected
// to call (per the strategy's system prompt) — typically right
// after draft_feedback_triage, so the assistant can confirm a
// freshly drafted proposal would pass before narrating it to the
// user.
//
// Execution is pure: input → typed draft → scope check → enum
// check → JSON envelope. No DB call; no SQL; no side effects.
type validateFeedbackTriageTool struct{}

// Name implements [Tool].
func (t *validateFeedbackTriageTool) Name() string { return "validate_feedback_triage" }

// Description implements [Tool].
func (t *validateFeedbackTriageTool) Description() string {
	return "Run the closed-enum validator over a typed FeedbackTriageDraft shape and report whether it would be accepted by the FeedbackQueuePage at /admin/feedback. " +
		"PROPOSE-ONLY: nothing is saved. Returns {draft, status: ok|invalid, validation_error}. " +
		"Use this AFTER draft_feedback_triage to confirm a proposed draft will be accepted before narrating it to the user. " +
		"feedback_id MUST equal the per-request scope-bound feedback_id; proposed_status one of: " + feedbackTriageStatusHint + "; " +
		"proposed_category one of: " + feedbackTriageCategoryHint + "; " +
		"proposed_priority one of: " + feedbackTriagePriorityHint + "."
}

// InputSchema implements [Tool].
func (t *validateFeedbackTriageTool) InputSchema() json.RawMessage {
	return tools.CachedSchema(feedbackTriageInput{})
}

// OutputSchema implements [Tool].
func (t *validateFeedbackTriageTool) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only.
func (t *validateFeedbackTriageTool) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — same rationale as
// draft_feedback_triage.
func (t *validateFeedbackTriageTool) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *validateFeedbackTriageTool) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[feedbackTriageInput](raw)
}

// Execute implements [Tool]. Same scope check as
// draft_feedback_triage, then the closed-enum validator. Same
// error semantics: enum failures are surfaced as status="invalid",
// never as a returned error.
//
// validate_feedback_triage does NOT load the source row — it is a
// pure DTO transform so the LLM can confirm a proposal without
// burning a second source round-trip. CurrentStatus / CurrentCategory
// in the returned draft are therefore empty by design; the SPA
// surfaces them as "—" until the next draft_feedback_triage call.
func (t *validateFeedbackTriageTool) Execute(ctx context.Context, in any) (any, error) {
	input := in.(feedbackTriageInput)
	if err := checkFeedbackTriageScope(ctx, input.FeedbackID); err != nil {
		return nil, err
	}
	draft := buildFeedbackTriageDraft(input, nil)
	out := &feedbackTriageOutput{
		Draft:  draft,
		Status: "ok",
		Source: "tool: validate_feedback_triage; closed enums: " +
			"status=" + feedbackTriageStatusHint + "; " +
			"category=" + feedbackTriageCategoryHint + "; " +
			"priority=" + feedbackTriagePriorityHint,
	}
	if vErr := checkFeedbackTriageEnums(draft); vErr != nil {
		out.Status = "invalid"
		out.ValidationError = vErr.Error()
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// retrieve_feedback_chunks
// ---------------------------------------------------------------------------

// feedbackSourceFeedbackItem is the source-type string reserved by
// a future per-item feedback embedding corpus. Intentionally NOT promoted to a rag.Source* constant
// because adding to that package widens the global contract
// beyond this feature's scope. When the future indexer
// lands, it should promote this string to rag.SourceFeedbackItem
// in one place.
const feedbackSourceFeedbackItem = "feedback_item"

// feedbackSourceAuditLog is reserved for a future audit-log embedding corpus.
// Same forward-compatibility rationale as feedbackSourceFeedbackItem.
const feedbackSourceAuditLog = "audit_log"

// feedbackAllowedSourceTypes is the per-feature allowlist of
// source-type strings the feedback-queue-triage strategy may
// retrieve over. Any other source type passed via the LLM's typed
// input is refused at validation time. Any new source must be added here and
// covered by prompt and golden updates, not silently widened.
//
// Kept in lex order so error messages list a stable allowed-set.
var feedbackAllowedSourceTypes = []string{
	feedbackSourceAuditLog,
	feedbackSourceFeedbackItem,
}

// feedbackAllowedSourceTypeSet is the O(1) membership lookup for
// the allowlist above.
var feedbackAllowedSourceTypeSet = func() map[string]struct{} {
	out := make(map[string]struct{}, len(feedbackAllowedSourceTypes))
	for _, s := range feedbackAllowedSourceTypes {
		out[s] = struct{}{}
	}
	return out
}()

// feedbackAllowedSourceTypesHint is the comma-separated allowlist
// rendered in retrieve_feedback_chunks's Description.
var feedbackAllowedSourceTypesHint = strings.Join(feedbackAllowedSourceTypes, ", ")

// feedbackRetrievalMaxK is the per-call upper bound on the
// retriever's k parameter.
const feedbackRetrievalMaxK = 12

// feedbackRetrievalDefaultK is the value substituted when the LLM
// omits k.
const feedbackRetrievalDefaultK = 5

// feedbackRetrievalMaxQueryChars caps the user-supplied natural-
// language query at the tool boundary.
const feedbackRetrievalMaxQueryChars = 1024

// retrieveFeedbackChunksInput is the typed input shape for
// retrieve_feedback_chunks. The dispatcher decodes the LLM's
// tool-call arguments JSON into this struct via ValidateStruct so
// a malformed input fails before any rag.Retriever method runs.
type retrieveFeedbackChunksInput struct {
	// Query is the natural-language search expression. Required,
	// non-empty, bounded.
	Query string `json:"query" validate:"required" desc:"Natural-language feedback / audit search query (required, non-empty)."`

	// SourceTypes is the per-call allowlist of corpora to
	// search. Each entry MUST appear in feedbackAllowedSourceTypes;
	// an unknown source type is refused at validation time.
	SourceTypes []string `json:"source_types" validate:"required,min=1" desc:"List of source types to search; allowed values: feedback_item, audit_log."`

	// K is the requested top-k count. Optional; defaults to
	// feedbackRetrievalDefaultK when zero. Bounded to
	// [0, feedbackRetrievalMaxK].
	K int `json:"k,omitempty" validate:"gte=0,lte=12" desc:"Top-k count to return; default 5 when omitted, max 12."`
}

// retrievedFeedbackChunk is the shared envelope for one chunk in
// the retrieve_feedback_chunks output. Mirrors rag.Chunk but uses
// explicit JSON tags so the tool's output marshals stably
// regardless of any future change to the underlying rag.Chunk
// shape.
type retrievedFeedbackChunk struct {
	SourceType string  `json:"source_type"`
	SourceID   string  `json:"source_id"`
	ChunkIdx   int     `json:"chunk_idx"`
	Text       string  `json:"text"`
	Score      float32 `json:"score"`
}

// retrieveFeedbackChunks is the read-only tool that calls the F7
// retriever for the feedback-queue-triage domain. It is the
// OPTIONAL secondary tool the LLM may call (per the strategy's
// system prompt) AFTER draft_feedback_triage, so the proposal is
// grounded FIRST in the loaded row and only OPTIONALLY enriched
// with retrieved cross-row context.
type retrieveFeedbackChunks struct {
	r rag.Retriever
}

// Name implements [Tool].
func (t *retrieveFeedbackChunks) Name() string { return "retrieve_feedback_chunks" }

// Description implements [Tool].
func (t *retrieveFeedbackChunks) Description() string {
	return "Find the top-k nearest chunks to a natural-language query across the calling user's " +
		"feedback / audit-log corpora via the F7 RAG retriever. " +
		"READ-only: no record is created, mutated, or deleted. " +
		"Allowed source_types: " + feedbackAllowedSourceTypesHint + ". " +
		"Returns {chunks: [{source_type, source_id, chunk_idx, text, score}]}; an empty list means no match — DO NOT fabricate a similar feedback row to fill the void."
}

// InputSchema implements [Tool].
func (t *retrieveFeedbackChunks) InputSchema() json.RawMessage {
	return tools.CachedSchema(retrieveFeedbackChunksInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *retrieveFeedbackChunks) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. READ-only.
func (t *retrieveFeedbackChunks) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *retrieveFeedbackChunks) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator,
// then enforces the per-feature source-type allowlist that the
// validator's `oneof` tag cannot express for slice fields.
func (t *retrieveFeedbackChunks) Validate(raw json.RawMessage) (any, error) {
	v, err := tools.ValidateStruct[retrieveFeedbackChunksInput](raw)
	if err != nil {
		return nil, err
	}
	in := v.(retrieveFeedbackChunksInput)
	if err := assertAllowedFeedbackSourceTypes(in.SourceTypes); err != nil {
		return nil, err
	}
	if len(in.Query) > feedbackRetrievalMaxQueryChars {
		return nil, fmt.Errorf("retrieve_feedback_chunks: query length %d exceeds cap %d",
			len(in.Query), feedbackRetrievalMaxQueryChars)
	}
	return in, nil
}

// Execute implements [Tool].
func (t *retrieveFeedbackChunks) Execute(ctx context.Context, in any) (any, error) {
	input := in.(retrieveFeedbackChunksInput)
	if t.r == nil {
		return nil, errors.New("retrieve_feedback_chunks: no rag.Retriever wired")
	}
	k := input.K
	if k == 0 {
		k = feedbackRetrievalDefaultK
	}
	subject := provider.SubjectFromContext(ctx)
	chunks, err := t.r.Retrieve(ctx, subject, input.Query, input.SourceTypes, k)
	if err != nil {
		return nil, fmt.Errorf("retrieve_feedback_chunks: rag.Retrieve: %w", err)
	}
	out := make([]retrievedFeedbackChunk, 0, len(chunks))
	for _, c := range chunks {
		out = append(out, retrievedFeedbackChunk{
			SourceType: c.SourceType,
			SourceID:   c.SourceID,
			ChunkIdx:   c.ChunkIdx,
			Text:       c.Text,
			Score:      c.Score,
		})
	}
	return map[string]any{
		"query":        input.Query,
		"source_types": input.SourceTypes,
		"k":            k,
		"chunks":       out,
	}, nil
}

// assertAllowedFeedbackSourceTypes enforces the per-feature
// source-type allowlist.
func assertAllowedFeedbackSourceTypes(types []string) error {
	if len(types) == 0 {
		return errors.New("retrieve_feedback_chunks: source_types is required and must contain at least one entry")
	}
	seen := make(map[string]struct{}, len(types))
	for _, st := range types {
		if _, ok := feedbackAllowedSourceTypeSet[st]; !ok {
			return fmt.Errorf("retrieve_feedback_chunks: source_type %q not in allowed set %s",
				st, feedbackAllowedSourceTypesHint)
		}
		if _, dup := seen[st]; dup {
			return fmt.Errorf("retrieve_feedback_chunks: source_type %q appears more than once in source_types", st)
		}
		seen[st] = struct{}{}
	}
	return nil
}

// AllowedFeedbackChunkSourceTypes returns a defensive copy of the
// per-feature source-type allowlist. Exported so the AI handler +
// tests can reference the same set the tools enforce.
func AllowedFeedbackChunkSourceTypes() []string {
	out := make([]string, len(feedbackAllowedSourceTypes))
	copy(out, feedbackAllowedSourceTypes)
	return out
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// FeedbackQueueTriageSources bundles the narrow read interfaces
// RegisterFeedbackQueueTriageTools needs.
//
// Production wiring (router.go) instantiates the production
// adapter (*api.AIFeedbackTriageSource) and the shared
// rag.Retriever; tests substitute deterministic fakes per-source.
type FeedbackQueueTriageSources struct {
	Source    FeedbackTriageSource
	Retriever rag.Retriever
}

// RegisterFeedbackQueueTriageTools installs the feedback-queue-triage tools on r.
// Router wiring calls this after log-trace summarization so the registry's Names
// list remains deterministic for existing pin tests.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first
// request.
func RegisterFeedbackQueueTriageTools(r *tools.Registry, s FeedbackQueueTriageSources) {
	r.Register(&draftFeedbackTriage{source: s.Source})
	r.Register(&validateFeedbackTriageTool{})
	r.Register(&retrieveFeedbackChunks{r: s.Retriever})
}

// nowRFC3339 returns the current time formatted as RFC3339 UTC.
// Indirection so tests can pin the value via dependency injection
// in a future iteration. Currently unused by the tools (the source
// adapter formats CreatedAt itself) but exported so the production
// source adapter can keep formatting in one place.
func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}
