// Phase-50 / 0035 — A2 Inbox auto-categorization.
//
// inbox_auto_categorization.go ships TWO new propose-only tools:
//
//   - `draft_alert_categories` — accept an inbox scope
//     (vehicle_id?, severities?[], rule_ids?[], window_days?),
//     read the recent notification_logs window via the
//     InboxCategorizationSource port, bucket each row by a
//     deterministic signal_name -> category mapping, and return
//     a typed envelope { window_days, sample_size,
//     has_enough_history, categories: [{label, count,
//     sample_rule_ids}], total_in_window, status, source } the
//     frontend can render for human review.
//
//   - `validate_alert_category` — assert that one or more
//     proposed labels are members of the closed taxonomy
//     (battery, charging, climate, tire, security, connectivity,
//     maintenance, noise, other). Pure DTO transform; no IO.
//
// Both tools are PROPOSE-ONLY: they read existing
// notification_logs + alert_rules state and compose a typed DTO
// but do NOT touch the database write path. Notifications are
// never updated, archived, deleted, or re-classified; the
// "Apply" mechanism in the SPA copies the suggested rule_ids
// into the existing baseline filter URL state, not into a new
// write path. The dispatcher's deny-all confirm gate is
// therefore never reached in practice — defence in depth in
// case a future edit accidentally adds a write tool.
//
// Design constraints (from the slice prompt):
//
//   - "Route every mutation proposal through F4 tools and existing
//     typed DTO validation. The LLM never writes raw SQL and
//     never bypasses existing handlers." → the tools delegate to
//     the InboxCategorizationSource port (a narrow read-only
//     view of NotificationRepo + AlertRuleRepo). There is NO
//     write surface on the port.
//
//   - "the LLM never writes raw SQL" → every read happens
//     through the canonical repos via the port; the
//     signal_name -> category mapping is pure-functional Go.
//
//   - "no duplicate write paths" → there is no `apply_categories`
//     or `archive_by_category` tool. The frontend renders the
//     proposed category chips and the user clicks Apply, which
//     copies the suggested rule_ids into the existing
//     NotificationFilterBar URL state — same baseline write/state
//     path the user has always had.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ---------------------------------------------------------------------------
// Closed taxonomy.
// ---------------------------------------------------------------------------

// InboxCategoryLabels is the closed taxonomy the strategy is
// allowed to propose. EVERY label the LLM proposes MUST be a
// member of this exact list (validate_alert_category enforces
// this; the strategy's system prompt restates the list so the
// LLM never proposes a label the validator would reject).
//
// Order is alphabetical EXCEPT "other" is last — "other" is the
// fallback bucket for signals that don't map to a domain
// category (e.g. computed_metric rules whose metric_id we
// haven't classified yet). Putting it last in the visible
// chip list keeps the dominant signal categories at the front.
//
// Adding a new category requires:
//
//  1. extending this slice;
//  2. extending categoryForSignal below to map at least one
//     signal_name into it;
//  3. extending goldens.yaml so the eval harness exercises the
//     new bucket;
//  4. updating the strategy's system prompt + the closed-
//     taxonomy line in goldens.yaml so the LLM learns the new
//     label.
var InboxCategoryLabels = []string{
	"battery",
	"charging",
	"climate",
	"connectivity",
	"maintenance",
	"noise",
	"security",
	"tire",
	"other",
}

// inboxCategorySet is the same list as a set for O(1) validation
// in validate_alert_category. Built once at package init.
var inboxCategorySet = func() map[string]struct{} {
	m := make(map[string]struct{}, len(InboxCategoryLabels))
	for _, l := range InboxCategoryLabels {
		m[l] = struct{}{}
	}
	return m
}()

// CategoryForSignal returns the closed-taxonomy category for a
// given alert_rules.signal_name. Pure-functional, deterministic,
// no IO — exposed so the AI handler's source adapter can call
// it without round-tripping through the tool. The mapping is
// SUBSTRING-based so a slightly different signal name (e.g.
// "battery_level_pct" vs "battery_level") still buckets
// correctly without requiring a per-VIN catalog refresh.
//
// Empty string ⇒ "other". Unknown signal name ⇒ "other". This
// is intentional — the "other" bucket is the honest fallback
// when we cannot classify a signal.
func CategoryForSignal(signalName string) string {
	s := strings.ToLower(strings.TrimSpace(signalName))
	if s == "" {
		return "other"
	}
	switch {
	case strings.Contains(s, "battery"),
		strings.Contains(s, "soc"),
		strings.Contains(s, "range"),
		strings.Contains(s, "kwh"),
		strings.Contains(s, "wh"):
		return "battery"
	case strings.Contains(s, "charge"),
		strings.Contains(s, "charging"),
		strings.Contains(s, "supercharger"),
		strings.Contains(s, "amp"),
		strings.Contains(s, "volt"):
		return "charging"
	case strings.Contains(s, "climate"),
		strings.Contains(s, "cabin"),
		strings.Contains(s, "hvac"),
		strings.Contains(s, "temp"):
		return "climate"
	case strings.Contains(s, "tire"),
		strings.Contains(s, "tyre"),
		strings.Contains(s, "tpms"),
		strings.Contains(s, "psi"),
		strings.Contains(s, "kpa"):
		return "tire"
	case strings.Contains(s, "lock"),
		strings.Contains(s, "sentry"),
		strings.Contains(s, "alarm"),
		strings.Contains(s, "intrusion"),
		strings.Contains(s, "security"):
		return "security"
	case strings.Contains(s, "online"),
		strings.Contains(s, "offline"),
		strings.Contains(s, "wifi"),
		strings.Contains(s, "lte"),
		strings.Contains(s, "connect"):
		return "connectivity"
	case strings.Contains(s, "service"),
		strings.Contains(s, "wash"),
		strings.Contains(s, "tpms_warn"),
		strings.Contains(s, "soft_warn"),
		strings.Contains(s, "warning"):
		return "maintenance"
	case strings.Contains(s, "noise"),
		strings.Contains(s, "noisy"),
		strings.Contains(s, "rate"),
		strings.Contains(s, "throttle"):
		return "noise"
	default:
		return "other"
	}
}

// ---------------------------------------------------------------------------
// Typed envelope returned by draft_alert_categories.
// ---------------------------------------------------------------------------

// CategoryCount is one bucket of the per-category tally
// draft_alert_categories returns. Label is one of
// InboxCategoryLabels. Count is the number of notification_logs
// rows in the recent window whose alert_rule.signal_name
// (deterministically) maps to this category. SampleRuleIDs is
// up to maxSampleRuleIDs (5) distinct alert_rule.id values that
// contributed to Count — the SPA renders these as the suggested
// `rule_id` URL filter when the user clicks Apply.
//
// All fields are deterministic; the tool sorts categories by
// Count DESC then Label ASC so the LLM's narration is reproducible
// across calls with the same window.
type CategoryCount struct {
	Label          string  `json:"label"`
	Count          int     `json:"count"`
	SampleRuleIDs  []int64 `json:"sample_rule_ids"`
	SeveritiesSeen []string `json:"severities_seen,omitempty"`
}

// CategoryProposal is the typed envelope draft_alert_categories
// returns. Every field is grounded in either the canonical
// NotificationRepo.GetLogsFiltered read or the canonical
// AlertRuleRepo.GetByID read — the adapter does not invent state
// the canonical handlers don't already expose.
//
// HasEnoughHistory flips false when SampleSize < the port's
// MinRequiredEvents threshold; the LLM's system prompt requires
// the narrator to disclose that and refuse to invent a category
// breakdown in that case.
//
// Status is "ok" or "no_data":
//   - "ok"      — the recent window has at least one
//     notification_logs row; Categories may still be empty if
//     every row failed to map (unlikely; "other" catches
//     fallthroughs).
//   - "no_data" — the recent window is completely empty; the
//     narrator MUST say "no notifications in the last N days"
//     rather than invent any category breakdown.
type CategoryProposal struct {
	WindowDays        int             `json:"window_days"`
	MinRequiredEvents int             `json:"min_required_events"`
	SampleSize        int             `json:"sample_size"`
	HasEnoughHistory  bool            `json:"has_enough_history"`
	Categories        []CategoryCount `json:"categories"`
	TotalInWindow     int             `json:"total_in_window"`
	Status            string          `json:"status"`
	// Method names the deterministic bucketing strategy the
	// adapter used so the narrator can quote it honestly.
	// Today's adapter uses "deterministic substring match on
	// alert_rule.signal_name"; future adapters may add
	// embedding-based clustering, etc.
	Method string `json:"method"`
	// Source is the dispatcher-visible breadcrumb so the LLM's
	// follow-up prose can attribute the decision to the
	// canonical readers rather than its own reasoning.
	Source string `json:"source"`
}

// maxSampleRuleIDs caps SampleRuleIDs per category. The SPA
// renders these as the suggested URL filter; 5 is enough to
// give the user a meaningful pre-filter without flooding the
// URL with hundreds of ids. The cap is per-category so the
// total across the chip list stays bounded.
const maxSampleRuleIDs = 5

// inboxCategorizationDefaultMinEvents is the default minimum
// number of notification_logs rows required in the window
// before HasEnoughHistory flips true. Mirrors the
// alert-tuning-suggestions slice's threshold so both surfaces
// behave consistently when the user has just connected a
// vehicle.
const inboxCategorizationDefaultMinEvents = 10

// inboxCategorizationDefaultWindowDays is the default lookback
// window when the LLM does not specify window_days. 7 mirrors
// the canonical "recent" window used elsewhere in Phase-50.
const inboxCategorizationDefaultWindowDays = 7

// inboxCategorizationMaxWindowDays caps the lookback so a
// runaway LLM call cannot scan an unbounded notification_logs
// range.
const inboxCategorizationMaxWindowDays = 90

// ---------------------------------------------------------------------------
// Narrow ports.
// ---------------------------------------------------------------------------

// InboxCategorizationSource is the narrow port the
// draft_alert_categories tool delegates to. In production it is
// satisfied by *api.AIInboxCategorizationSource (which composes
// NotificationRepo.GetLogsFiltered + AlertRuleRepo.GetByID
// behind a single LoadCategoryCounts call); in tests we
// substitute deterministic fakes so the tool unit tests stay
// hermetic.
//
// The interface MUST stay read-only — adding a Save / Update
// method here would defeat the read-only contract that ADR-015
// §I3 + the slice prompt mandate.
type InboxCategorizationSource interface {
	// LoadCategoryCounts reads the notification_logs window
	// matching f, joins each row to its alert_rule.signal_name
	// (where present), buckets by CategoryForSignal, and
	// returns the per-category tally + sample rule_ids. The
	// returned slice MUST be sorted by Count DESC then Label
	// ASC so the LLM's narration is reproducible.
	//
	// totalInWindow is the unclamped row count the adapter
	// observed (so the LLM can say "23 of 47 are battery"
	// even when only the dominant category bucket is shown);
	// it MUST equal the sum of CategoryCount.Count across the
	// returned slice.
	//
	// minRequiredEvents is the deterministic threshold the
	// adapter used for the has_enough_history flag; the tool
	// echoes it back in the typed envelope so the LLM's
	// honest-method narration can quote the exact number.
	LoadCategoryCounts(
		ctx context.Context,
		f database.NotificationLogFilters,
	) (counts []CategoryCount, totalInWindow int, minRequiredEvents int, err error)
}

// ---------------------------------------------------------------------------
// Tool: draft_alert_categories.
// ---------------------------------------------------------------------------

// alertCategoriesDraftInput is the typed input shape the
// dispatcher decodes the LLM's tool-call arguments JSON into.
// Validation failures bounce as Tool.Validate errors before any
// port method runs.
//
// Filter fields are all OPTIONAL — when absent the tool defaults
// to the entire inbox over the last
// inboxCategorizationDefaultWindowDays days. The AI handler is
// responsible for clamping vehicle_id to the caller's actual
// scope BEFORE invoking the tool.
type alertCategoriesDraftInput struct {
	// VehicleID restricts the recent window to a single
	// vehicle. Optional — when absent the tool returns the
	// per-category counts across every vehicle the caller
	// owns (the AI handler is responsible for ownership
	// scoping; this tool just trusts the filter).
	VehicleID *int64 `json:"vehicle_id,omitempty" validate:"omitempty,gte=1" desc:"Optional vehicle ID to restrict the inbox window to. Omit to span all vehicles in scope."`

	// WindowDays is the lookback in days. Defaults to 7 when
	// nil. Capped at inboxCategorizationMaxWindowDays so a
	// runaway LLM call cannot scan an unbounded range.
	WindowDays *int `json:"window_days,omitempty" validate:"omitempty,gte=1,lte=90" desc:"Lookback window in days (1-90). Omit for default 7."`

	// Severities optionally restricts the tally to a subset
	// of severity tiers. Empty / nil ⇒ no severity filter.
	Severities []string `json:"severities,omitempty" validate:"omitempty,dive,oneof=info warn critical" desc:"Optional severity filter (info|warn|critical). Omit for all severities."`

	// RuleIDs optionally restricts the tally to a subset of
	// alert rule IDs. Empty / nil ⇒ no rule filter.
	RuleIDs []int64 `json:"rule_ids,omitempty" validate:"omitempty,dive,gte=1" desc:"Optional alert rule ID filter. Omit for all rules in scope."`

	// Rationale is an optional one-line explanation the LLM
	// may supply for the user. Bounded.
	Rationale string `json:"rationale,omitempty" validate:"omitempty,lte=512" desc:"Optional human-readable rationale for the categorization request."`
}

// allowedCategoriesHint is the description suffix the tool
// description surfaces to the LLM so it picks canonical
// taxonomy labels instead of hallucinating them. Sorted to keep
// the description deterministic across boots.
var allowedCategoriesHint = func() string {
	labels := make([]string, len(InboxCategoryLabels))
	copy(labels, InboxCategoryLabels)
	sort.Strings(labels)
	return strings.Join(labels, ", ")
}()

// draftAlertCategories is the propose-only tool that builds a
// per-category tally + sample rule_ids envelope for the
// InboxBody AI panel to render. It is the FIRST tool the LLM is
// expected to call (per the strategy's system prompt).
//
// Execution is a read: the InboxCategorizationSource port
// performs the notification_logs + alert_rules reads against
// the canonical repos. There is no DB write; no SQL beyond
// what the port's adapter issues. The dispatcher's deny-all
// confirm gate is bypassed because Mutates() returns false.
type draftAlertCategories struct {
	source InboxCategorizationSource
}

// Name implements [Tool].
func (t *draftAlertCategories) Name() string { return "draft_alert_categories" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, with the canonical
// taxonomy appended so the model picks from the curated set.
func (t *draftAlertCategories) Description() string {
	return "Compute a deterministic per-category tally of recent notifications for an inbox scope. " +
		"PROPOSE-ONLY: notifications are NOT modified; the user clicks Apply in the UI to copy the suggested rule_ids into the existing NotificationFilterBar URL state. " +
		"Returns {window_days, sample_size, has_enough_history, categories: [{label, count, sample_rule_ids}], total_in_window, status: ok|no_data, method, source}. " +
		"Closed taxonomy labels: " + allowedCategoriesHint + ". " +
		"Filter fields are optional — omit to span all vehicles in scope over the last 7 days. " +
		"NEVER propose archiving, deleting, marking-read, or re-classifying notifications; this tool only DRAFTS the suggested filter."
}

// InputSchema implements [Tool].
func (t *draftAlertCategories) InputSchema() json.RawMessage {
	return cachedSchema(alertCategoriesDraftInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *draftAlertCategories) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
// The tool reads + composes a DTO but does NOT touch the
// database. The actual Apply flow happens AFTER the user
// clicks the chip in the UI; the SPA copies the suggested
// rule_ids into the existing NotificationFilterBar URL state.
func (t *draftAlertCategories) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream, and the tool
// produces no state mutation that needs an additional RBAC
// scope.
func (t *draftAlertCategories) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared
// validator, then runs explicit pointer-aware range checks for
// the optional numeric fields. The shared validator's gte/lte
// rules can't reach through *int / *int64 pointers (it falls
// through the numeric switch when v.Kind() is reflect.Ptr), so
// each optional numeric pointer field gets a manual range
// check here. Mirrors the alert-tuning-suggestions slice's
// pattern.
func (t *draftAlertCategories) Validate(raw json.RawMessage) (any, error) {
	parsed, err := ValidateStruct[alertCategoriesDraftInput](raw)
	if err != nil {
		return nil, err
	}
	in := parsed.(alertCategoriesDraftInput)
	if in.VehicleID != nil {
		v := *in.VehicleID
		if v < 1 {
			return nil, &ValidationError{Field: "vehicle_id", Rule: "gte=1", Msg: "must be ≥ 1"}
		}
	}
	if in.WindowDays != nil {
		v := *in.WindowDays
		if v < 1 {
			return nil, &ValidationError{Field: "window_days", Rule: "gte=1", Msg: "must be ≥ 1"}
		}
		if v > inboxCategorizationMaxWindowDays {
			return nil, &ValidationError{Field: "window_days", Rule: "lte=90", Msg: "must be ≤ 90"}
		}
	}
	return parsed, nil
}

// Execute implements [Tool]. Composes the
// NotificationLogFilters from the input, runs the canonical
// per-category tally, and returns the envelope. Never returns
// an error from the validator path — empty windows surface as
// status="no_data" in the envelope so the LLM's follow-up
// prose can describe the situation rather than the dispatcher
// relaying an error frame.
//
// A nil source is a wiring bug detected at boot via constructor
// panic; this function only nil-checks defensively for tests
// that instantiate the tool directly.
func (t *draftAlertCategories) Execute(ctx context.Context, in any) (any, error) {
	input := in.(alertCategoriesDraftInput)
	if t.source == nil {
		return nil, errors.New("draft_alert_categories: no InboxCategorizationSource wired")
	}

	windowDays := inboxCategorizationDefaultWindowDays
	if input.WindowDays != nil && *input.WindowDays >= 1 && *input.WindowDays <= inboxCategorizationMaxWindowDays {
		windowDays = *input.WindowDays
	}

	now := time.Now().UTC()
	from := now.Add(-time.Duration(windowDays) * 24 * time.Hour)

	filters := database.NotificationLogFilters{
		From:       from,
		To:         now,
		Severities: append([]string(nil), input.Severities...),
		RuleIDs:    append([]int64(nil), input.RuleIDs...),
		// 1000 is the repo's hard cap; the adapter clamps to
		// it. We intentionally do NOT page here — the LLM
		// surface needs a single deterministic snapshot, not
		// a streamed scan.
		Limit: 1000,
	}
	if input.VehicleID != nil {
		filters.VehicleIDs = []int64{*input.VehicleID}
	}

	counts, totalInWindow, minRequired, err := t.source.LoadCategoryCounts(ctx, filters)
	if err != nil {
		return nil, err
	}

	if minRequired <= 0 {
		minRequired = inboxCategorizationDefaultMinEvents
	}

	status := "ok"
	if totalInWindow == 0 {
		status = "no_data"
	}

	out := &CategoryProposal{
		WindowDays:        windowDays,
		MinRequiredEvents: minRequired,
		SampleSize:        totalInWindow,
		HasEnoughHistory:  totalInWindow >= minRequired,
		Categories:        counts,
		TotalInWindow:     totalInWindow,
		Status:            status,
		Method:            "deterministic substring match on alert_rule.signal_name",
		Source:            "reader: internal/database/notification_repo.go NotificationRepo.GetLogsFiltered + internal/database/alert_repo.go AlertRuleRepo.GetByID (signal_name -> category mapping in internal/ai/tools/inbox_auto_categorization.go CategoryForSignal)",
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Tool: validate_alert_category.
// ---------------------------------------------------------------------------

// alertCategoryValidateInput is the typed input shape the
// dispatcher decodes the LLM's tool-call arguments JSON into.
// The LLM may pass a single label (most common — call once per
// proposed label) or a batch (less common — convenience for the
// dispatcher to validate the entire proposed list in one
// round-trip).
type alertCategoryValidateInput struct {
	// Label is the single label to validate. Optional —
	// omit when using Labels.
	Label string `json:"label,omitempty" validate:"omitempty,gte=1,lte=64" desc:"Single label to validate. Omit when using labels."`

	// Labels is the optional batch of labels to validate.
	// Either Label or Labels MUST be non-empty after
	// trimming; the validator surfaces an InvalidLabels
	// entry for any rejected member of the batch.
	Labels []string `json:"labels,omitempty" validate:"omitempty,dive,gte=1,lte=64" desc:"Optional batch of labels to validate."`
}

// alertCategoryValidateOutput is the typed envelope
// validate_alert_category returns. OK is true iff every
// supplied label is in the closed taxonomy. InvalidLabels
// echoes back any rejected labels so the LLM can self-correct
// without a second tool call.
type alertCategoryValidateOutput struct {
	OK                bool     `json:"ok"`
	InvalidLabels     []string `json:"invalid_labels,omitempty"`
	AllowedTaxonomy   []string `json:"allowed_taxonomy"`
	Source            string   `json:"source"`
}

// validateAlertCategory is the propose-only tool that asserts
// whether one or more labels are members of the closed
// taxonomy. Pure-functional; no IO. Called by the LLM after
// draft_alert_categories returns its proposed labels so any
// label accepted here is byte-equivalent to a label drawn from
// InboxCategoryLabels.
type validateAlertCategory struct{}

// Name implements [Tool].
func (t *validateAlertCategory) Name() string { return "validate_alert_category" }

// Description implements [Tool].
func (t *validateAlertCategory) Description() string {
	return "Validate one or more proposed inbox category labels against the closed taxonomy. " +
		"PROPOSE-ONLY: this tool returns {ok, invalid_labels, allowed_taxonomy, source}; it does NOT save or apply labels. " +
		"Closed taxonomy: " + allowedCategoriesHint + ". " +
		"Either pass `label` (single) or `labels` (batch); at least one must be non-empty after trimming."
}

// InputSchema implements [Tool].
func (t *validateAlertCategory) InputSchema() json.RawMessage {
	return cachedSchema(alertCategoryValidateInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form.
func (t *validateAlertCategory) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only.
func (t *validateAlertCategory) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *validateAlertCategory) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator
// then enforces the "at least one of label/labels" cross-field
// constraint that the per-field tags can't express.
func (t *validateAlertCategory) Validate(raw json.RawMessage) (any, error) {
	parsed, err := ValidateStruct[alertCategoryValidateInput](raw)
	if err != nil {
		return nil, err
	}
	in := parsed.(alertCategoryValidateInput)
	if strings.TrimSpace(in.Label) == "" && len(in.Labels) == 0 {
		return nil, &ValidationError{Field: "label", Rule: "required_without=Labels", Msg: "either `label` or `labels` must be non-empty"}
	}
	return parsed, nil
}

// Execute implements [Tool]. Loops through the supplied label
// (and/or batch) and returns the typed envelope. Never returns
// an error — invalid labels surface in InvalidLabels so the
// LLM can self-correct without a second tool call.
func (t *validateAlertCategory) Execute(_ context.Context, in any) (any, error) {
	input := in.(alertCategoryValidateInput)
	out := &alertCategoryValidateOutput{
		OK:              true,
		AllowedTaxonomy: append([]string(nil), InboxCategoryLabels...),
		Source:          "validator: internal/ai/tools/inbox_auto_categorization.go inboxCategorySet",
	}

	check := func(raw string) {
		s := strings.ToLower(strings.TrimSpace(raw))
		if s == "" {
			return
		}
		if _, ok := inboxCategorySet[s]; !ok {
			out.OK = false
			out.InvalidLabels = append(out.InvalidLabels, raw)
		}
	}

	check(input.Label)
	for _, l := range input.Labels {
		check(l)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Helper: bucketing
// ---------------------------------------------------------------------------

// BucketByCategory is a pure-functional helper the production
// adapter (api.AIInboxCategorizationSource) uses to convert a
// raw notification_logs slice (already joined to its rule's
// signal_name via a per-row lookup or the alert_rules table)
// into the sorted CategoryCount slice the tool returns.
//
// signalLookup maps an alert_rule.id to its signal_name. Rows
// whose AlertID is nil OR whose alert_id is missing from the
// lookup bucket into "other".
//
// The result is sorted by Count DESC then Label ASC so the
// LLM's narration is reproducible across calls with the same
// input. SampleRuleIDs per category are sorted ASC + capped at
// maxSampleRuleIDs.
//
// Pulled out of the production adapter so the tool unit tests
// can exercise the bucketing semantics independently of the
// repo IO.
func BucketByCategory(rows []*models.NotificationLog, signalLookup map[int64]string) []CategoryCount {
	type bucket struct {
		count   int
		ruleSet map[int64]struct{}
		sevSet  map[string]struct{}
	}
	buckets := make(map[string]*bucket, len(InboxCategoryLabels))
	for _, l := range InboxCategoryLabels {
		buckets[l] = &bucket{
			ruleSet: make(map[int64]struct{}),
			sevSet:  make(map[string]struct{}),
		}
	}

	for _, row := range rows {
		if row == nil {
			continue
		}
		signal := ""
		if row.AlertID != nil {
			if s, ok := signalLookup[*row.AlertID]; ok {
				signal = s
			}
		}
		category := CategoryForSignal(signal)
		b, ok := buckets[category]
		if !ok {
			b = buckets["other"]
		}
		b.count++
		if row.AlertID != nil {
			b.ruleSet[*row.AlertID] = struct{}{}
		}
		if sev := strings.TrimSpace(row.Severity); sev != "" {
			b.sevSet[sev] = struct{}{}
		}
	}

	out := make([]CategoryCount, 0, len(InboxCategoryLabels))
	for _, label := range InboxCategoryLabels {
		b := buckets[label]
		if b.count == 0 {
			continue
		}
		ids := make([]int64, 0, len(b.ruleSet))
		for id := range b.ruleSet {
			ids = append(ids, id)
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		if len(ids) > maxSampleRuleIDs {
			ids = ids[:maxSampleRuleIDs]
		}
		sevs := make([]string, 0, len(b.sevSet))
		for s := range b.sevSet {
			sevs = append(sevs, s)
		}
		sort.Strings(sevs)
		out = append(out, CategoryCount{
			Label:          label,
			Count:          b.count,
			SampleRuleIDs:  ids,
			SeveritiesSeen: sevs,
		})
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Label < out[j].Label
	})
	return out
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// InboxAutoCategorizationSources bundles the narrow port
// RegisterInboxAutoCategorizationTools needs. Mirrors
// [AlertTuningSuggestionsSources] /
// [TirePressureTrendReasoningSources].
//
// Production wiring (router.go) instantiates the production
// adapter (*api.AIInboxCategorizationSource); tests substitute
// deterministic fakes.
type InboxAutoCategorizationSources struct {
	Source InboxCategorizationSource
}

// RegisterInboxAutoCategorizationTools installs the
// inbox-auto-categorization slice's tools on r. Called from
// router.go AFTER RegisterAlertTuningSuggestionsTools so the
// alphabetical Names list grows deterministically without
// disturbing earlier registrations.
//
// Panics on duplicate registration (Registry.Register panics) —
// a second call is a wiring bug detected at boot, not at first
// request.
//
// Note: this function registers BOTH new tools
// (`draft_alert_categories` + `validate_alert_category`); both
// are NEW for this slice. Future inbox-related slices may
// REUSE `validate_alert_category` from this registration.
func RegisterInboxAutoCategorizationTools(r *Registry, s InboxAutoCategorizationSources) {
	r.Register(&draftAlertCategories{source: s.Source})
	r.Register(&validateAlertCategory{})
}
