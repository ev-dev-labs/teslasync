using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the AddAnnotationPopover modal-dialog surface's UI-thread-free logic — the
/// category wire mapping, the <c>toDateInputValue</c> / <c>toIsoTimestamp</c> date normalisers + date-input
/// validation, the category-option / label-validation / occurred-at / draft projections, the state-holder
/// view-model's per-branch flows (idle / label-gated submit / fixed-date add / editable-date add /
/// empty-label no-op / unresolved-date no-op / cancel-and-reset, plus the add + close contract that mirrors
/// <c>onAdd</c> + <c>onCancel</c>), the i18n key + fallback contract that doubles as the Narrator-label
/// source, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/charts/AddAnnotationPopover.tsx + web/src/types/annotations.ts). The WinUI view itself
/// (AddAnnotationPopover.cs) is exercised by the app build.
/// </summary>
public sealed class AddAnnotationPopoverTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Wire mapping (web AnnotationCategory union) ──────────────────────────────────────────────────────

    [Theory]
    [InlineData(AnnotationCategory.Milestone, "milestone")]
    [InlineData(AnnotationCategory.Maintenance, "maintenance")]
    [InlineData(AnnotationCategory.Trip, "trip")]
    [InlineData(AnnotationCategory.Issue, "issue")]
    [InlineData(AnnotationCategory.Upgrade, "upgrade")]
    [InlineData(AnnotationCategory.Custom, "custom")]
    public void Category_round_trips_through_wire(AnnotationCategory category, string wire)
    {
        Assert.Equal(wire, AnnotationCategories.ToWire(category));
        Assert.True(AnnotationCategories.TryFromWire(wire, out var parsed));
        Assert.Equal(category, parsed);
    }

    [Fact]
    public void Wire_from_unknown_token_is_false_and_defaults_to_milestone()
    {
        Assert.False(AnnotationCategories.TryFromWire("nope", out var category));
        Assert.Equal(AnnotationCategory.Milestone, category);
        Assert.False(AnnotationCategories.TryFromWire(null, out var fromNull));
        Assert.Equal(AnnotationCategory.Milestone, fromNull);
    }

    // ── Projection: date normalisers (web toDateInputValue / toIsoTimestamp) ─────────────────────────────

    [Theory]
    [InlineData("2024-03-15T10:30:00Z", "2024-03-15")]
    [InlineData("2024-03-15T23:30:00Z", "2024-03-15")]
    [InlineData("2024-03-15", "2024-03-15")]
    [InlineData("", "")]
    [InlineData("not-a-date", "")]
    public void ToDateInputValue_normalises_to_yyyy_mm_dd(string input, string expected) =>
        Assert.Equal(expected, AddAnnotationProjection.ToDateInputValue(input));

    [Fact]
    public void ToDateInputValue_of_null_is_empty() =>
        Assert.Equal(string.Empty, AddAnnotationProjection.ToDateInputValue(null));

    [Theory]
    [InlineData("2024-03-15", "2024-03-15T00:00:00Z")]
    [InlineData("", "")]
    [InlineData("2024-3-5", "")]
    [InlineData("garbage", "")]
    public void ToIsoTimestamp_pins_a_date_to_utc_midnight(string input, string expected) =>
        Assert.Equal(expected, AddAnnotationProjection.ToIsoTimestamp(input));

    [Theory]
    [InlineData("2024-03-15", true)]
    [InlineData("2024-3-5", false)]
    [InlineData("", false)]
    [InlineData("2024-03-15T00:00:00Z", false)]
    public void IsDateInputValue_matches_the_date_input_shape(string input, bool valid) =>
        Assert.Equal(valid, AddAnnotationProjection.IsDateInputValue(input));

    [Fact]
    public void Date_normalisers_round_trip() =>
        Assert.Equal(
            "2024-03-15",
            AddAnnotationProjection.ToDateInputValue(AddAnnotationProjection.ToIsoTimestamp("2024-03-15")));

    // ── Projection: label validation (web label.trim()) ─────────────────────────────────────────────────

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("x", true)]
    [InlineData("  Battery replaced  ", true)]
    public void IsLabelValid_requires_a_non_empty_trimmed_label(string? label, bool valid) =>
        Assert.Equal(valid, AddAnnotationProjection.IsLabelValid(label));

    [Fact]
    public void NormalizeLabel_trims() =>
        Assert.Equal("hi", AddAnnotationProjection.NormalizeLabel("  hi  "));

    // ── Projection: category options (web CATEGORY_OPTIONS + ANNOTATION_COLORS) ──────────────────────────

    [Fact]
    public void CategoryOptions_are_the_six_values_in_web_order_with_labels()
    {
        var options = AddAnnotationProjection.CategoryOptions(Localizer);

        Assert.Equal(
            [
                AnnotationCategory.Milestone,
                AnnotationCategory.Maintenance,
                AnnotationCategory.Trip,
                AnnotationCategory.Issue,
                AnnotationCategory.Upgrade,
                AnnotationCategory.Custom,
            ],
            options.Select(o => o.Value).ToArray());
        Assert.Equal(
            ["Milestone", "Maintenance", "Trip", "Issue", "Upgrade", "Custom"],
            options.Select(o => o.Label).ToArray());
    }

    [Fact]
    public void CategoryOptions_carry_the_web_annotation_colors()
    {
        var options = AddAnnotationProjection.CategoryOptions(Localizer);

        Assert.Equal(
            ["#3b82f6", "#f59e0b", "#22c55e", "#ef4444", "#a855f7", "#94a3b8"],
            options.Select(o => o.Color).ToArray());
    }

    [Fact]
    public void CategoryOptions_carry_distinct_non_empty_glyphs()
    {
        var glyphs = AddAnnotationProjection.CategoryOptions(Localizer).Select(o => o.Glyph).ToArray();

        Assert.All(glyphs, g => Assert.False(string.IsNullOrWhiteSpace(g)));
        Assert.Equal(glyphs.Length, glyphs.Distinct().Count());
    }

    // ── Projection: occurred-at resolution (web editableDate ternary) ────────────────────────────────────

    [Fact]
    public void ResolveOccurredAt_uses_the_timestamp_when_the_date_is_fixed() =>
        Assert.Equal(
            "2024-01-01T00:00:00Z",
            AddAnnotationProjection.ResolveOccurredAt(false, "ignored", "2024-01-01T00:00:00Z"));

    [Fact]
    public void ResolveOccurredAt_uses_the_edited_date_when_editable() =>
        Assert.Equal(
            "2024-03-15T00:00:00Z",
            AddAnnotationProjection.ResolveOccurredAt(true, "2024-03-15", "ignored"));

    [Theory]
    [InlineData("")]
    [InlineData("bad")]
    public void ResolveOccurredAt_is_empty_for_a_missing_or_malformed_editable_date(string editedDate) =>
        Assert.Equal(string.Empty, AddAnnotationProjection.ResolveOccurredAt(true, editedDate, "2024-01-01T00:00:00Z"));

    // ── Projection: draft assembly (web onAdd arguments) ─────────────────────────────────────────────────

    [Fact]
    public void BuildDraft_trims_label_keeps_description_and_passes_occurred_at()
    {
        var draft = AddAnnotationProjection.BuildDraft(
            "  Battery replaced  ", AnnotationCategory.Maintenance, "  Swapped the HV pack  ", "2024-01-01T00:00:00Z");

        Assert.Equal("Battery replaced", draft.Label);
        Assert.Equal(AnnotationCategory.Maintenance, draft.Category);
        Assert.Equal("Swapped the HV pack", draft.Description);
        Assert.Equal("2024-01-01T00:00:00Z", draft.OccurredAt);
    }

    [Theory]
    [InlineData("   ")]
    [InlineData("")]
    [InlineData(null)]
    public void BuildDraft_omits_a_blank_description(string? description)
    {
        var draft = AddAnnotationProjection.BuildDraft("x", AnnotationCategory.Milestone, description, "ts");

        Assert.Null(draft.Description);
    }

    // ── View-model: initial (idle) state ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Initial_state_matches_web_defaults()
    {
        var vm = new AddAnnotationPopoverViewModel("2024-03-15T10:00:00Z", editableDate: false, Localizer);

        Assert.Equal(AnnotationCategory.Milestone, vm.Category);
        Assert.False(vm.CanSubmit);
        Assert.Equal(6, vm.CategoryOptions.Count);
        Assert.False(vm.EditableDate);
        Assert.Equal("2024-03-15T10:00:00Z", vm.Timestamp);
        Assert.Equal(50, AddAnnotationRegistration.LabelMaxLength);
        Assert.Equal(200, AddAnnotationRegistration.DescriptionMaxLength);
        Assert.Equal("AddAnnotationPopover", AddAnnotationRegistration.Slug);
    }

    [Fact]
    public void Editable_date_seeds_the_edited_date_from_the_timestamp()
    {
        var vm = new AddAnnotationPopoverViewModel("2024-03-15T10:00:00Z", editableDate: true, Localizer);

        Assert.True(vm.EditableDate);
        Assert.Equal("2024-03-15", vm.EditedDate);
    }

    // ── View-model: label-gated submit affordance (web disabled={!label.trim()}) ─────────────────────────

    [Fact]
    public void CanSubmit_tracks_the_trimmed_label_and_raises_change()
    {
        var vm = new AddAnnotationPopoverViewModel("ts", editableDate: false, Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Label = "Battery replaced";
        Assert.True(vm.CanSubmit);
        Assert.Contains(nameof(AddAnnotationPopoverViewModel.CanSubmit), changed);

        vm.Label = "   ";
        Assert.False(vm.CanSubmit);
    }

    // ── View-model: add (fixed date) → submit + reset ────────────────────────────────────────────────────

    [Fact]
    public void Submit_with_fixed_date_emits_the_draft_records_and_resets()
    {
        var diag = new AddAnnotationDiagnostics();
        var vm = new AddAnnotationPopoverViewModel("2024-01-01T00:00:00Z", editableDate: false, Localizer, diag);
        var drafts = new List<AnnotationDraft>();
        int closes = 0;
        vm.AnnotationSubmitted += (_, d) => drafts.Add(d);
        vm.CloseRequested += (_, _) => closes++;
        vm.Label = "  Battery replaced  ";
        vm.Category = AnnotationCategory.Maintenance;
        vm.Description = "  Swapped the HV pack  ";

        bool added = vm.Submit();

        Assert.True(added);
        var draft = Assert.Single(drafts);
        Assert.Equal("Battery replaced", draft.Label);
        Assert.Equal(AnnotationCategory.Maintenance, draft.Category);
        Assert.Equal("Swapped the HV pack", draft.Description);
        Assert.Equal("2024-01-01T00:00:00Z", draft.OccurredAt);
        Assert.Equal(1, diag.AnnotationsAdded);
        Assert.Equal(0, closes); // an add is not a cancel
        // Fields reset (web handleSubmit) — label/category/description, not the date.
        Assert.Equal(string.Empty, vm.Label);
        Assert.Equal(AnnotationCategory.Milestone, vm.Category);
        Assert.Equal(string.Empty, vm.Description);
        Assert.False(vm.CanSubmit);
    }

    // ── View-model: add (editable date) pins the picked day to UTC midnight ──────────────────────────────

    [Fact]
    public void Submit_with_editable_date_uses_the_edited_day()
    {
        var vm = new AddAnnotationPopoverViewModel("2024-03-15T10:00:00Z", editableDate: true, Localizer);
        AnnotationDraft? captured = null;
        vm.AnnotationSubmitted += (_, d) => captured = d;
        vm.Label = "Road trip start";
        vm.EditedDate = "2024-04-20";

        bool added = vm.Submit();

        Assert.True(added);
        Assert.NotNull(captured);
        Assert.Equal("2024-04-20T00:00:00Z", captured!.OccurredAt);
    }

    // ── View-model: empty-label no-op (web if (!label.trim()) return) ────────────────────────────────────

    [Fact]
    public void Submit_with_empty_label_is_a_no_op()
    {
        var diag = new AddAnnotationDiagnostics();
        var vm = new AddAnnotationPopoverViewModel("ts", editableDate: false, Localizer, diag);
        int adds = 0;
        vm.AnnotationSubmitted += (_, _) => adds++;
        vm.Label = "   ";

        bool added = vm.Submit();

        Assert.False(added);
        Assert.Equal(0, adds);
        Assert.Equal(0, diag.AnnotationsAdded);
    }

    // ── View-model: unresolved-date no-op (web if (!occurredAt) return) ──────────────────────────────────

    [Theory]
    [InlineData("")]
    [InlineData("not-a-real-date")]
    public void Submit_with_editable_but_unresolved_date_is_a_no_op(string editedDate)
    {
        var vm = new AddAnnotationPopoverViewModel("ts", editableDate: true, Localizer);
        int adds = 0;
        vm.AnnotationSubmitted += (_, _) => adds++;
        vm.Label = "Has a label";
        vm.EditedDate = editedDate;

        bool added = vm.Submit();

        Assert.False(added);
        Assert.Equal(0, adds);
    }

    // ── View-model: cancel / close (web handleClose → onCancel) ──────────────────────────────────────────

    [Fact]
    public void RequestClose_raises_close_and_resets_fields()
    {
        var vm = new AddAnnotationPopoverViewModel("ts", editableDate: false, Localizer);
        int closes = 0;
        vm.CloseRequested += (_, _) => closes++;
        vm.Label = "Half-typed";
        vm.Category = AnnotationCategory.Issue;
        vm.Description = "draft";

        vm.RequestClose();

        Assert.Equal(1, closes);
        Assert.Equal(string.Empty, vm.Label);
        Assert.Equal(AnnotationCategory.Milestone, vm.Category);
        Assert.Equal(string.Empty, vm.Description);
    }

    // ── Diagnostics (PII-safe, P1/S11) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void NotifyOpened_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diag = new AddAnnotationDiagnostics(lines.Add);
        var vm = new AddAnnotationPopoverViewModel("ts", editableDate: false, Localizer, diag);

        vm.NotifyOpened();

        Assert.Equal(1, diag.ViewsOpened);
        Assert.Equal("view.opened slug=AddAnnotationPopover", Assert.Single(lines));
    }

    [Fact]
    public void RecordAnnotationAdded_emits_slug_without_content()
    {
        var lines = new List<string>();
        var diag = new AddAnnotationDiagnostics(lines.Add);

        diag.RecordAnnotationAdded();

        Assert.Equal(1, diag.AnnotationsAdded);
        Assert.Equal("annotation.added slug=AddAnnotationPopover", Assert.Single(lines));
    }

    // ── i18n key + fallback contract (the Narrator-label source) ─────────────────────────────────────────

    [Fact]
    public void Every_label_routes_through_an_annotation_or_common_key()
    {
        var recorder = new RecordingLocalizer();

        ReadAllLabels(recorder);

        Assert.NotEmpty(recorder.Keys);
        Assert.All(
            recorder.Keys,
            key => Assert.True(
                key.StartsWith("annotation.", StringComparison.Ordinal) ||
                key.StartsWith("common.", StringComparison.Ordinal),
                $"key '{key}' is not under annotation.* / common.*"));
    }

    [Fact]
    public void English_fallbacks_match_the_web_literals()
    {
        Assert.Equal("Add Annotation", AddAnnotationRegistration.AddTitle(Localizer));
        Assert.Equal("Date", AddAnnotationRegistration.DateLabel(Localizer));
        Assert.Equal("Label", AddAnnotationRegistration.LabelLabel(Localizer));
        Assert.Equal("e.g., Battery replaced", AddAnnotationRegistration.LabelPrompt(Localizer));
        Assert.Equal("Category", AddAnnotationRegistration.CategoryLabel(Localizer));
        Assert.Equal("Description", AddAnnotationRegistration.DescriptionLabel(Localizer));
        Assert.Equal("Optional description...", AddAnnotationRegistration.DescriptionPrompt(Localizer));
        Assert.Equal("Add Annotation", AddAnnotationRegistration.AddLabel(Localizer));
        Assert.Equal("Cancel", AddAnnotationRegistration.CancelLabel(Localizer));
        Assert.Equal("Milestone", AddAnnotationRegistration.CategoryLabelFor(AnnotationCategory.Milestone, Localizer));
        Assert.Equal("Maintenance", AddAnnotationRegistration.CategoryLabelFor(AnnotationCategory.Maintenance, Localizer));
        Assert.Equal("Trip", AddAnnotationRegistration.CategoryLabelFor(AnnotationCategory.Trip, Localizer));
        Assert.Equal("Issue", AddAnnotationRegistration.CategoryLabelFor(AnnotationCategory.Issue, Localizer));
        Assert.Equal("Upgrade", AddAnnotationRegistration.CategoryLabelFor(AnnotationCategory.Upgrade, Localizer));
        Assert.Equal("Custom", AddAnnotationRegistration.CategoryLabelFor(AnnotationCategory.Custom, Localizer));
    }

    private static void ReadAllLabels(ILocalizer localizer)
    {
        var vm = new AddAnnotationPopoverViewModel("2024-03-15T00:00:00Z", editableDate: true, localizer);
        _ = vm.Title;
        _ = vm.DateLabel;
        _ = vm.LabelLabel;
        _ = vm.LabelPrompt;
        _ = vm.CategoryLabel;
        _ = vm.DescriptionLabel;
        _ = vm.DescriptionPrompt;
        _ = vm.AddLabel;
        _ = vm.CancelLabel;
        _ = vm.CategoryOptions; // resolves every category label
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
