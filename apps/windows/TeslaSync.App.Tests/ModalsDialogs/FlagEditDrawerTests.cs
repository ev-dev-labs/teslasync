using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the FlagEditDrawer surface's UI-thread-free logic — the value-parse / default-seed /
/// key + reason validity / save-gate projection (the web <c>defaultValueJson</c> + <c>parsed</c> memo +
/// <c>keyValid</c> / <c>reasonValid</c> / <c>canSave</c>), the i18n key + fallback contract that doubles as the
/// Narrator-label source, the state-holder view-model's per-state flows (create vs edit, the value
/// required / invalid / valid branches, the save gate, the in-flight saving state, save + close routing, and the
/// reopen re-seed), and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/feature-flags/FlagEditDrawer.tsx). The WinUI view itself
/// (FlagEditDrawer.cs) is exercised by the app build.
/// </summary>
public sealed class FlagEditDrawerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static FeatureFlagEntry Entry(string key, string json) => FeatureFlagEntry.FromJson(key, json);

    private static FlagEditDrawerViewModel NewViewModel(FlagEditDrawerDiagnostics? diagnostics = null) =>
        new(Localizer, diagnostics);

    // ── Projection: default value seed (web defaultValueJson) ────────────────────────────────────────────

    [Fact]
    public void DefaultValueJson_is_empty_for_create_mode() =>
        Assert.Equal(string.Empty, FlagEditDrawerProjection.DefaultValueJson(null));

    [Fact]
    public void DefaultValueJson_pretty_prints_the_entry_value()
    {
        string seed = FlagEditDrawerProjection.DefaultValueJson(Entry("feature.x", "{\"enabled\":true}"));

        Assert.Contains("\"enabled\": true", seed, StringComparison.Ordinal); // post-colon space => pretty-printed
        Assert.Contains("\n", seed, StringComparison.Ordinal);                  // multi-line => indented
        Assert.Contains("  ", seed, StringComparison.Ordinal);                  // two-space indent
        Assert.True(FlagEditDrawerProjection.ParseValue(seed, Localizer).Ok);   // round-trips back to valid JSON
    }

    // ── Projection: value parse (web parsed memo) ────────────────────────────────────────────────────────

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\n\t ")]
    public void ParseValue_treats_blank_as_value_required(string raw)
    {
        var parse = FlagEditDrawerProjection.ParseValue(raw, Localizer);

        Assert.False(parse.Ok);
        Assert.Equal("Value is required.", parse.Error);
    }

    [Theory]
    [InlineData("{bad")]
    [InlineData("{\"a\": }")]
    [InlineData("not json")]
    [InlineData("{\"a\":1} trailing")]
    public void ParseValue_reports_invalid_json_with_a_message(string raw)
    {
        var parse = FlagEditDrawerProjection.ParseValue(raw, Localizer);

        Assert.False(parse.Ok);
        Assert.NotNull(parse.Error);
        Assert.StartsWith("Invalid JSON:", parse.Error!, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("{\"enabled\":true}", JsonValueKind.Object)]
    [InlineData("[1,2,3]", JsonValueKind.Array)]
    [InlineData("42", JsonValueKind.Number)]
    [InlineData("true", JsonValueKind.True)]
    [InlineData("null", JsonValueKind.Null)]
    [InlineData("\"hello\"", JsonValueKind.String)]
    public void ParseValue_accepts_any_json_value(string raw, JsonValueKind kind)
    {
        var parse = FlagEditDrawerProjection.ParseValue(raw, Localizer);

        Assert.True(parse.Ok);
        Assert.Null(parse.Error);
        Assert.Equal(kind, parse.Value.ValueKind);
    }

    // ── Projection: field validity + save gate (web keyValid / reasonValid / canSave) ────────────────────

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("feature.x", true)]
    [InlineData("  feature.x  ", true)]
    public void IsKeyValid_requires_a_non_blank_key(string? key, bool valid) =>
        Assert.Equal(valid, FlagEditDrawerProjection.IsKeyValid(key));

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("rotate secret", true)]
    public void IsReasonValid_requires_a_non_blank_reason(string? reason, bool valid) =>
        Assert.Equal(valid, FlagEditDrawerProjection.IsReasonValid(reason));

    [Fact]
    public void CanSave_requires_value_ok_key_reason_and_not_saving()
    {
        Assert.True(FlagEditDrawerProjection.CanSave(true, "k", "r", false));
        Assert.False(FlagEditDrawerProjection.CanSave(false, "k", "r", false)); // bad value
        Assert.False(FlagEditDrawerProjection.CanSave(true, " ", "r", false));  // empty key
        Assert.False(FlagEditDrawerProjection.CanSave(true, "k", " ", false));  // empty reason
        Assert.False(FlagEditDrawerProjection.CanSave(true, "k", "r", true));   // saving in flight
    }

    // ── Registration: slug + i18n fallbacks (Narrator-label source) ──────────────────────────────────────

    [Fact]
    public void Slug_matches_the_surface_name() =>
        Assert.Equal("FlagEditDrawer", FlagEditDrawerRegistration.Slug);

    [Fact]
    public void Registration_resolves_every_web_label_fallback()
    {
        Assert.Equal("Create flag", FlagEditDrawerRegistration.CreateTitle(Localizer));
        Assert.Equal("Edit flag \"feature.dlq.replay_enabled\"",
            FlagEditDrawerRegistration.EditTitle(Localizer, "feature.dlq.replay_enabled"));
        Assert.Equal("Save flag", FlagEditDrawerRegistration.SaveLabel(Localizer));
        Assert.Equal("Cancel", FlagEditDrawerRegistration.CancelLabel(Localizer));
        Assert.Equal("Flag key", FlagEditDrawerRegistration.KeyLabel(Localizer));
        Assert.Equal("feature.dlq.replay_enabled", FlagEditDrawerRegistration.KeyPrompt(Localizer));
        Assert.Equal(
            "Flag keys are immutable once created. Delete + re-create to rename.",
            FlagEditDrawerRegistration.KeyImmutableNote(Localizer));
        Assert.Equal("Value (JSON)", FlagEditDrawerRegistration.ValueLabel(Localizer));
        Assert.Equal("Reason", FlagEditDrawerRegistration.ReasonLabel(Localizer));
        Assert.Equal("Why this change? (logged in audit)", FlagEditDrawerRegistration.ReasonPrompt(Localizer));
        Assert.Equal("Value is required.", FlagEditDrawerRegistration.ValueEmptyError(Localizer));
        Assert.Equal("Invalid JSON: boom", FlagEditDrawerRegistration.ValueInvalidError(Localizer, "boom"));
    }

    [Fact]
    public void ValuePrompt_mirrors_the_web_json_example() =>
        Assert.Equal("{\n  \"enabled\": true\n}", FlagEditDrawerRegistration.ValuePrompt);

    // ── View-model: initial (closed) state ───────────────────────────────────────────────────────────────

    [Fact]
    public void Initial_state_is_a_closed_create_form()
    {
        var vm = NewViewModel();

        Assert.False(vm.IsOpen);
        Assert.False(vm.Editing);
        Assert.Equal(string.Empty, vm.KeyInput);
        Assert.Equal(string.Empty, vm.ValueInput);
        Assert.Equal(string.Empty, vm.Reason);
        Assert.False(vm.Saving);
        Assert.True(vm.KeyEditable);
        Assert.False(vm.ShowKeyImmutableNote);
        Assert.True(vm.CancelEnabled);
        Assert.False(vm.CanSave);
        Assert.Equal("Create flag", vm.Title);
    }

    // ── View-model: create mode (web initial === null) ───────────────────────────────────────────────────

    [Fact]
    public void Open_null_enters_create_mode_with_a_blank_required_form()
    {
        var vm = NewViewModel();

        vm.Open(null);

        Assert.True(vm.IsOpen);
        Assert.False(vm.Editing);
        Assert.Equal(string.Empty, vm.KeyInput);
        Assert.Equal(string.Empty, vm.ValueInput);
        Assert.Equal(string.Empty, vm.Reason);
        Assert.True(vm.KeyEditable);
        Assert.False(vm.ShowKeyImmutableNote);
        Assert.Equal("Create flag", vm.Title);
        Assert.True(vm.HasValueError);
        Assert.Equal("Value is required.", vm.ValueError);
        Assert.False(vm.CanSave);
    }

    // ── View-model: edit mode (web initial !== null) ─────────────────────────────────────────────────────

    [Fact]
    public void Open_entry_enters_edit_mode_with_a_seeded_locked_key()
    {
        var vm = NewViewModel();

        vm.Open(Entry("feature.dlq.replay_enabled", "{\"enabled\":true}"));

        Assert.True(vm.IsOpen);
        Assert.True(vm.Editing);
        Assert.Equal("feature.dlq.replay_enabled", vm.KeyInput);
        Assert.False(vm.KeyEditable);
        Assert.True(vm.ShowKeyImmutableNote);
        Assert.Equal("Edit flag \"feature.dlq.replay_enabled\"", vm.Title);
        Assert.Contains("\"enabled\": true", vm.ValueInput, StringComparison.Ordinal);
        Assert.True(vm.ValueValid);
        Assert.False(vm.HasValueError);
        Assert.True(vm.KeyValid);
        Assert.False(vm.ReasonValid);
        Assert.False(vm.CanSave); // reason still required
    }

    [Fact]
    public void Edit_mode_becomes_savable_once_a_reason_is_entered()
    {
        var vm = NewViewModel();
        vm.Open(Entry("feature.x", "{\"enabled\":true}"));

        vm.Reason = "rotate the kill switch";

        Assert.True(vm.ReasonValid);
        Assert.True(vm.CanSave);
    }

    // ── View-model: value parse branches ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Empty_value_blocks_save_and_shows_the_required_helper()
    {
        var vm = NewViewModel();
        vm.Open(null);
        vm.KeyInput = "feature.x";
        vm.Reason = "why";

        Assert.True(vm.HasValueError);
        Assert.Equal("Value is required.", vm.ValueError);
        Assert.False(vm.CanSave);
    }

    [Fact]
    public void Invalid_value_blocks_save_and_shows_the_parse_helper()
    {
        var vm = NewViewModel();
        vm.Open(null);
        vm.KeyInput = "feature.x";
        vm.Reason = "why";
        vm.ValueInput = "{not valid";

        Assert.True(vm.HasValueError);
        Assert.StartsWith("Invalid JSON:", vm.ValueError!, StringComparison.Ordinal);
        Assert.False(vm.ValueValid);
        Assert.False(vm.CanSave);
    }

    [Fact]
    public void Valid_value_with_key_and_reason_enables_save()
    {
        var vm = NewViewModel();
        vm.Open(null);
        vm.KeyInput = "feature.x";
        vm.ValueInput = "123";
        vm.Reason = "why";

        Assert.True(vm.ValueValid);
        Assert.False(vm.HasValueError);
        Assert.True(vm.CanSave);
    }

    // ── View-model: in-flight (saving) state ─────────────────────────────────────────────────────────────

    [Fact]
    public void Saving_disables_save_and_cancel()
    {
        var vm = NewViewModel();
        vm.Open(null);
        vm.KeyInput = "feature.x";
        vm.ValueInput = "true";
        vm.Reason = "why";
        Assert.True(vm.CanSave);

        vm.Saving = true;

        Assert.False(vm.CanSave);
        Assert.False(vm.CancelEnabled);
    }

    // ── View-model: save routing (web onSave) ────────────────────────────────────────────────────────────

    [Fact]
    public void RequestSave_emits_the_trimmed_payload_and_parsed_value()
    {
        var vm = NewViewModel();
        vm.Open(null);
        vm.KeyInput = "  feature.x  ";
        vm.ValueInput = "{\"enabled\":false,\"pct\":25}";
        vm.Reason = "  staged rollout  ";

        FlagEditSaveRequest? captured = null;
        vm.SaveRequested += (_, req) => captured = req;

        vm.RequestSave();

        Assert.NotNull(captured);
        Assert.Equal("feature.x", captured!.Key);
        Assert.Equal("staged rollout", captured.Reason);
        Assert.Equal("{\"enabled\":false,\"pct\":25}", captured.ValueJson);
    }

    [Fact]
    public void RequestSave_is_a_noop_when_the_gate_is_closed()
    {
        var vm = NewViewModel();
        vm.Open(null); // blank => cannot save
        bool raised = false;
        vm.SaveRequested += (_, _) => raised = true;

        vm.RequestSave();

        Assert.False(raised);
    }

    [Fact]
    public void RequestSave_is_a_noop_while_saving()
    {
        var vm = NewViewModel();
        vm.Open(null);
        vm.KeyInput = "feature.x";
        vm.ValueInput = "true";
        vm.Reason = "why";
        vm.Saving = true;
        bool raised = false;
        vm.SaveRequested += (_, _) => raised = true;

        vm.RequestSave();

        Assert.False(raised);
    }

    // ── View-model: close routing (web onClose) ──────────────────────────────────────────────────────────

    [Fact]
    public void RequestClose_closes_and_raises()
    {
        var vm = NewViewModel();
        vm.Open(null);
        bool closed = false;
        vm.CloseRequested += (_, _) => closed = true;

        vm.RequestClose();

        Assert.False(vm.IsOpen);
        Assert.True(closed);
    }

    // ── View-model: reopen re-seed (web reset effect on [open, initial]) ─────────────────────────────────

    [Fact]
    public void Reopen_reseeds_the_form_for_the_new_flag()
    {
        var vm = NewViewModel();
        vm.Open(Entry("feature.a", "{\"a\":1}"));
        vm.Reason = "first";

        vm.Open(null);

        Assert.False(vm.Editing);
        Assert.Equal(string.Empty, vm.KeyInput);
        Assert.Equal(string.Empty, vm.ValueInput);
        Assert.Equal(string.Empty, vm.Reason);
        Assert.Equal("Create flag", vm.Title);
    }

    [Fact]
    public void Reopen_for_an_entry_clears_a_prior_create_drafts()
    {
        var vm = NewViewModel();
        vm.Open(null);
        vm.KeyInput = "draft.key";
        vm.ValueInput = "{\"draft\":true}";
        vm.Reason = "draft reason";

        vm.Open(Entry("feature.b", "[1,2]"));

        Assert.True(vm.Editing);
        Assert.Equal("feature.b", vm.KeyInput);
        Assert.Contains("1", vm.ValueInput, StringComparison.Ordinal);
        Assert.Equal(string.Empty, vm.Reason);
    }

    // ── View-model: change notifications ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Editing_value_raises_the_dependent_property_changes()
    {
        var vm = NewViewModel();
        vm.Open(null);
        vm.KeyInput = "feature.x";
        vm.Reason = "why";
        var changed = new List<string>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName ?? string.Empty);

        vm.ValueInput = "true";

        Assert.Contains(nameof(FlagEditDrawerViewModel.CanSave), changed);
        Assert.Contains(nameof(FlagEditDrawerViewModel.ValueError), changed);
        Assert.Contains(nameof(FlagEditDrawerViewModel.HasValueError), changed);
    }

    // ── Accessibility: every interactive label resolves to non-empty Narrator text ───────────────────────

    [Fact]
    public void Every_interactive_label_is_present()
    {
        var vm = NewViewModel();
        vm.Open(null);

        Assert.False(string.IsNullOrWhiteSpace(vm.Title));
        Assert.False(string.IsNullOrWhiteSpace(vm.KeyLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.KeyPrompt));
        Assert.False(string.IsNullOrWhiteSpace(vm.ValueLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.ValuePrompt));
        Assert.False(string.IsNullOrWhiteSpace(vm.ReasonLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.ReasonPrompt));
        Assert.False(string.IsNullOrWhiteSpace(vm.CancelLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.SaveLabel));
    }

    // ── Diagnostics: PII-safe view.opened (P1/S11) ───────────────────────────────────────────────────────

    [Fact]
    public void Open_records_a_pii_safe_view_opened_event()
    {
        var lines = new List<string>();
        var diagnostics = new FlagEditDrawerDiagnostics(lines.Add);
        var vm = NewViewModel(diagnostics);

        vm.Open(Entry("feature.secret", "{\"enabled\":true}"));

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FlagEditDrawer", Assert.Single(lines));
        Assert.DoesNotContain("feature.secret", lines[0], StringComparison.Ordinal); // no key leak
    }
}
