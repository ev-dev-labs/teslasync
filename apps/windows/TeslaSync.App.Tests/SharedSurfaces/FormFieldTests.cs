using System.ComponentModel;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.FormFieldSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>FormField</c> shared surface's UI-thread-free logic — the id seam
/// (<see cref="IFieldIdProvider"/>, the native <c>useId</c>), the projection's id derivations
/// (<c>fieldId = htmlFor ?? autoId</c>, <c>errorId</c>, <c>hintId</c>), the mutually-exclusive error / hint
/// rows, the required marker's i18n-resolved accessible name, the state holder's stable cached id and
/// change notification, the registration metadata and the PII-safe diagnostics. Mirrors the web spec
/// one-for-one (<c>web/src/components/forms/FormField.tsx</c>). The WinUI view itself (FormField.cs) is
/// exercised by the app build.
/// </summary>
public sealed class FormFieldTests
{
    private const string AutoId = "auto-7";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static FormFieldDisplay Project(FormFieldModel model, string autoId = AutoId) =>
        FormFieldProjection.Project(model, Localizer, autoId);

    // ── registration (diagnostics slug) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("FormField", FormFieldRegistration.Slug);

    // ── id seam: useId analogue (the adapter) ────────────────────────────────────────────────────────────

    [Fact]
    public void Field_id_provider_yields_unique_ids()
    {
        var provider = new FieldIdProvider();

        string first = provider.NextId();
        string second = provider.NextId();

        Assert.NotEqual(first, second);
        Assert.StartsWith(FieldIdProvider.Prefix, first, System.StringComparison.Ordinal);
        Assert.StartsWith(FieldIdProvider.Prefix, second, System.StringComparison.Ordinal);
    }

    [Fact]
    public void Field_id_provider_shared_is_a_stable_singleton() =>
        Assert.Same(FieldIdProvider.Shared, FieldIdProvider.Shared);

    [Fact]
    public void Fixed_field_id_provider_returns_the_pinned_id()
    {
        var provider = new FixedFieldIdProvider("pinned-id");

        Assert.Equal("pinned-id", provider.NextId());
        Assert.Equal("pinned-id", provider.NextId());
    }

    // ── fieldId = htmlFor ?? autoId (nullish, not truthy) ────────────────────────────────────────────────

    [Fact]
    public void Field_id_falls_back_to_the_generated_id_when_no_html_for()
    {
        Assert.Equal(AutoId, Project(new FormFieldModel("Signal")).FieldId);
    }

    [Fact]
    public void Field_id_uses_the_caller_supplied_html_for()
    {
        Assert.Equal("signal-select", Project(new FormFieldModel("Signal", htmlFor: "signal-select")).FieldId);
    }

    [Fact]
    public void Field_id_preserves_an_explicit_empty_html_for()
    {
        // web uses `htmlFor ?? autoId` (nullish) — an explicit empty string is kept, not coalesced.
        Assert.Equal(string.Empty, Project(new FormFieldModel("Signal", htmlFor: string.Empty)).FieldId);
    }

    // ── bare branch: label + control only (no hint, no error) ────────────────────────────────────────────

    [Fact]
    public void Bare_field_shows_no_hint_or_error_row()
    {
        FormFieldDisplay d = Project(new FormFieldModel("Signal"));

        Assert.Equal("Signal", d.Label);
        Assert.False(d.ShowError);
        Assert.False(d.ShowHint);
        Assert.Null(d.ErrorId);
        Assert.Null(d.HintId);
        Assert.Null(d.ErrorText);
        Assert.Null(d.HintText);
    }

    // ── hint branch (web hint && !error) ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Hint_only_renders_the_hint_row_with_its_id()
    {
        FormFieldDisplay d = Project(new FormFieldModel("Signal", hint: "Pick a telemetry signal"));

        Assert.True(d.ShowHint);
        Assert.Equal("Pick a telemetry signal", d.HintText);
        Assert.Equal(AutoId + "-hint", d.HintId);
        Assert.False(d.ShowError);
        Assert.Null(d.ErrorId);
    }

    [Fact]
    public void Blank_hint_is_treated_as_absent()
    {
        FormFieldDisplay d = Project(new FormFieldModel("Signal", hint: string.Empty));

        Assert.False(d.ShowHint);
        Assert.Null(d.HintId);
        Assert.Null(d.HintText);
    }

    // ── error branch (web error ? ...) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Error_only_renders_the_error_row_with_its_id()
    {
        FormFieldDisplay d = Project(new FormFieldModel("Signal", error: "Signal is required"));

        Assert.True(d.ShowError);
        Assert.Equal("Signal is required", d.ErrorText);
        Assert.Equal(AutoId + "-error", d.ErrorId);
        Assert.False(d.ShowHint);
        Assert.Null(d.HintId);
    }

    [Fact]
    public void Error_takes_precedence_and_hides_the_hint()
    {
        // web: `error ? <error/> : hint ? <hint/> : null` — an error suppresses the hint entirely.
        FormFieldDisplay d = Project(new FormFieldModel("Signal", hint: "Pick a signal", error: "Required"));

        Assert.True(d.ShowError);
        Assert.Equal("Required", d.ErrorText);
        Assert.Equal(AutoId + "-error", d.ErrorId);

        Assert.False(d.ShowHint);
        Assert.Null(d.HintId);
        Assert.Null(d.HintText);
    }

    [Fact]
    public void Blank_error_is_treated_as_absent_and_keeps_the_hint()
    {
        FormFieldDisplay d = Project(new FormFieldModel("Signal", hint: "Pick a signal", error: string.Empty));

        Assert.False(d.ShowError);
        Assert.Null(d.ErrorId);
        Assert.True(d.ShowHint);
        Assert.Equal("Pick a signal", d.HintText);
    }

    // ── required marker + accessible name (web aria-label="required") ─────────────────────────────────────

    [Fact]
    public void Required_marker_is_hidden_by_default()
    {
        FormFieldDisplay d = Project(new FormFieldModel("Signal"));

        Assert.False(d.ShowRequired);
        Assert.Null(d.RequiredAutomationName);
    }

    [Fact]
    public void Required_marker_shows_with_the_localized_accessible_name()
    {
        FormFieldDisplay d = Project(new FormFieldModel("Signal", required: true));

        Assert.True(d.ShowRequired);
        Assert.Equal("required", d.RequiredAutomationName);
    }

    [Fact]
    public void Required_aria_resolves_through_the_i18n_facade()
    {
        var keys = new List<string>();
        ILocalizer recording = new RecordingLocalizer(keys);

        FormFieldDisplay d = FormFieldProjection.Project(new FormFieldModel("Signal", required: true), recording, AutoId);

        Assert.Equal(FormFieldProjection.RequiredAriaKey, Assert.Single(keys));
        Assert.Equal("required", d.RequiredAutomationName);
        Assert.Equal("required", FormFieldProjection.RequiredAriaFallback);
    }

    [Fact]
    public void Caller_supplied_label_is_passed_through_verbatim()
    {
        // label / hint / error are already-localized caller strings (web passes t(...) results), so they are
        // surfaced verbatim — only the required marker is keyed by this surface.
        FormFieldDisplay d = Project(new FormFieldModel("Drive efficiency", hint: "Higher is better"));

        Assert.Equal("Drive efficiency", d.Label);
        Assert.Equal("Higher is better", d.HintText);
    }

    // ── view-model (state holder): cached stable id + change notification ─────────────────────────────────

    [Fact]
    public void ViewModel_caches_the_generated_id_from_the_seam()
    {
        var viewModel = new FormFieldViewModel(Localizer, new FormFieldModel("Signal"), new FixedFieldIdProvider("vm-id"));

        Assert.Equal("vm-id", viewModel.AutoId);
        Assert.Equal("vm-id", viewModel.Display.FieldId);
    }

    [Fact]
    public void ViewModel_id_is_stable_across_model_changes()
    {
        var viewModel = new FormFieldViewModel(Localizer, new FormFieldModel("Signal"), new FixedFieldIdProvider("vm-id"));
        string before = viewModel.Display.FieldId;

        viewModel.Model = new FormFieldModel("Signal", error: "Boom");

        Assert.Equal(before, viewModel.Display.FieldId);
        Assert.Equal("vm-id-error", viewModel.Display.ErrorId);
    }

    [Fact]
    public void ViewModel_defaults_to_the_empty_model()
    {
        var viewModel = new FormFieldViewModel(Localizer, idProvider: new FixedFieldIdProvider("vm-id"));

        Assert.Same(FormFieldModel.Empty, viewModel.Model);
        Assert.Equal(string.Empty, viewModel.Display.Label);
    }

    [Fact]
    public void ViewModel_raises_change_for_model_and_display_on_assignment()
    {
        var viewModel = new FormFieldViewModel(Localizer, new FormFieldModel("Signal"), new FixedFieldIdProvider("vm-id"));
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Model = new FormFieldModel("Signal", required: true);

        Assert.Contains(nameof(FormFieldViewModel.Model), changed);
        Assert.Contains(nameof(FormFieldViewModel.Display), changed);
    }

    [Fact]
    public void ViewModel_does_not_raise_for_an_equal_model()
    {
        var viewModel = new FormFieldViewModel(Localizer, new FormFieldModel("Signal"), new FixedFieldIdProvider("vm-id"));
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        // FormFieldModel is a record (value equality) — assigning an equal model is a no-op render.
        viewModel.Model = new FormFieldModel("Signal");

        Assert.Empty(changed);
    }

    // ── diagnostics (view.opened, PII-safe — never the label / hint / error text) ─────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new FormFieldDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FormField", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new FormFieldDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Model_rejects_a_null_label() =>
        Assert.Throws<System.ArgumentNullException>(() => new FormFieldModel(null!));

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<System.ArgumentNullException>(() => FormFieldProjection.Project(null!, Localizer, AutoId));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(() => FormFieldProjection.Project(FormFieldModel.Empty, null!, AutoId));

    [Fact]
    public void Project_rejects_a_null_auto_id() =>
        Assert.Throws<System.ArgumentNullException>(() => FormFieldProjection.Project(FormFieldModel.Empty, Localizer, null!));

    [Fact]
    public void ViewModel_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(() => new FormFieldViewModel(null!));

    [Fact]
    public void Fixed_field_id_provider_rejects_a_null_id() =>
        Assert.Throws<System.ArgumentNullException>(() => new FixedFieldIdProvider(null!));

    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly List<string> _keys;

        public RecordingLocalizer(List<string> keys) => _keys = keys;

        public string GetString(string key, string fallback)
        {
            _keys.Add(key);
            return fallback;
        }
    }
}
