using System.Collections.Generic;
using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.InputSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>Input</c> shared surface's UI-thread-free logic — the id derivation
/// (<c>inputId = id || label?.toLowerCase().replace(/\s+/g,'-')</c>), the label / required-marker projection
/// (the composed <c>&lt;Label&gt;</c>), the help-affordance resolution (the composed <c>&lt;HelpIcon&gt;</c>,
/// gated behind the label), the input accessibility (aria-required / aria-invalid / aria-describedby), the
/// mutually-exclusive error / hint rows, the per-size layout metrics, the state holder's change notification,
/// the registration metadata and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (<c>web/src/components/ui/Input.tsx</c> plus <c>Label.tsx</c> / <c>HelpIcon.tsx</c>). The WinUI view itself
/// (Input.cs) is exercised by the app build.
/// </summary>
public sealed class InputTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static InputDisplay Project(InputModel model) => InputProjection.Project(model, Localizer);

    // ── registration (diagnostics slug) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("Input", InputRegistration.Slug);

    // ── size metrics (the web sizeClasses map) ───────────────────────────────────────────────────────────

    [Fact]
    public void Metrics_small_match_the_web_size_class()
    {
        InputMetrics m = InputMetrics.For(InputSize.Sm);

        // web `sm`: px-2 (8) py-1.5 (6) text-xs (12)
        Assert.Equal(8, m.PaddingLeft);
        Assert.Equal(6, m.PaddingTop);
        Assert.Equal(8, m.PaddingRight);
        Assert.Equal(6, m.PaddingBottom);
        Assert.Equal(12, m.FontSizeFallback);
    }

    [Fact]
    public void Metrics_medium_match_the_web_size_class()
    {
        InputMetrics m = InputMetrics.For(InputSize.Md);

        // web `md`: px-3 (12) py-2 (8) text-sm (14)
        Assert.Equal(12, m.PaddingLeft);
        Assert.Equal(8, m.PaddingTop);
        Assert.Equal(14, m.FontSizeFallback);
        Assert.Equal("TsTypeBodyFontSize", m.FontSizeTokenKey);
    }

    [Fact]
    public void Metrics_large_match_the_web_size_class()
    {
        InputMetrics m = InputMetrics.For(InputSize.Lg);

        // web `lg`: px-4 (16) py-2.5 (10) text-base (16)
        Assert.Equal(16, m.PaddingLeft);
        Assert.Equal(10, m.PaddingTop);
        Assert.Equal(16, m.FontSizeFallback);
    }

    [Fact]
    public void Metrics_auto_falls_back_to_the_medium_density_metrics()
    {
        // web `auto` follows the density utilities; the native density fallback is the md metrics.
        Assert.Equal(InputMetrics.For(InputSize.Md), InputMetrics.For(InputSize.Auto));
    }

    [Fact]
    public void Metrics_expose_the_web_adornment_reserve_and_inset_constants()
    {
        Assert.Equal(40, InputMetrics.IconReserve);   // web pl-10
        Assert.Equal(40, InputMetrics.SuffixReserve); // web pr-10
        Assert.Equal(12, InputMetrics.IconInset);     // web left-3
        Assert.Equal(12, InputMetrics.SuffixInset);   // web right-3
    }

    [Fact]
    public void Projection_carries_the_metrics_for_the_models_size() =>
        Assert.Equal(InputMetrics.For(InputSize.Lg), Project(new InputModel(label: "Big", size: InputSize.Lg)).Metrics);

    // ── id derivation: inputId = id || slug(label) (truthy-OR) ───────────────────────────────────────────

    [Fact]
    public void Slugify_lowercases_and_collapses_whitespace_runs_to_hyphens()
    {
        Assert.Equal("email-address", InputProjection.Slugify("Email Address"));
        Assert.Equal("a-b", InputProjection.Slugify("A   B"));
        Assert.Equal("-lead-trail-", InputProjection.Slugify("  Lead Trail "));
    }

    [Fact]
    public void Input_id_uses_the_caller_supplied_id() =>
        Assert.Equal("vin-field", Project(new InputModel(label: "VIN", id: "vin-field")).InputId);

    [Fact]
    public void Input_id_falls_back_to_the_label_slug_when_no_id() =>
        Assert.Equal("display-name", Project(new InputModel(label: "Display Name")).InputId);

    [Fact]
    public void Input_id_prefers_a_truthy_id_over_the_label_slug() =>
        Assert.Equal("explicit", Project(new InputModel(label: "Display Name", id: "explicit")).InputId);

    [Fact]
    public void Input_id_is_null_when_neither_id_nor_label_is_supplied() =>
        Assert.Null(Project(new InputModel()).InputId);

    [Fact]
    public void Input_id_uses_the_label_slug_when_id_is_blank()
    {
        // web `id || label?...`: an empty id is falsy, so the label slug is used.
        Assert.Equal("name", Project(new InputModel(label: "Name", id: string.Empty)).InputId);
    }

    // ── bare state (no label / hint / error / help) ──────────────────────────────────────────────────────

    [Fact]
    public void Bare_field_renders_no_label_help_error_or_hint()
    {
        InputDisplay d = Project(new InputModel(id: "x"));

        Assert.False(d.HasLabel);
        Assert.False(d.ShowRequiredMarker);
        Assert.False(d.ShowHelp);
        Assert.False(d.ShowError);
        Assert.False(d.ShowHint);
        Assert.False(d.Invalid);
        Assert.False(d.Required);
        Assert.Null(d.DescribedById);
        Assert.Null(d.ErrorId);
        Assert.Null(d.HintId);
    }

    // ── label + required marker (the composed <Label>) ───────────────────────────────────────────────────

    [Fact]
    public void Label_renders_and_is_the_fields_accessible_name()
    {
        InputDisplay d = Project(new InputModel(label: "Email"));

        Assert.True(d.HasLabel);
        Assert.Equal("Email", d.Label);
        Assert.Equal("Email", d.LabelAccessibleName);
        Assert.False(d.ShowRequiredMarker);
    }

    [Fact]
    public void Blank_label_renders_no_label_row()
    {
        InputDisplay d = Project(new InputModel(label: string.Empty, id: "x"));

        Assert.False(d.HasLabel);
        Assert.Equal(string.Empty, d.Label);
    }

    [Fact]
    public void Required_shows_the_marker_and_appends_the_localized_word_to_the_accessible_name()
    {
        InputDisplay d = Project(new InputModel(label: "Email", required: true));

        Assert.True(d.ShowRequiredMarker);
        Assert.Equal("required", d.RequiredWord);
        Assert.Equal("Email required", d.LabelAccessibleName);
        Assert.True(d.Required);
    }

    [Fact]
    public void Required_word_resolves_through_the_i18n_facade()
    {
        var keys = new List<string>();
        InputDisplay d = InputProjection.Project(new InputModel(label: "Email", required: true), new RecordingLocalizer(keys));

        Assert.Contains(InputProjection.RequiredWordKey, keys);
        Assert.Equal("required", d.RequiredWord);
        Assert.Equal("form.required", InputProjection.RequiredWordKey);
        Assert.Equal("required", InputProjection.RequiredWordFallback);
    }

    [Fact]
    public void Required_without_a_label_hides_the_marker_but_keeps_aria_required()
    {
        // No label → no label row (so no visible asterisk), but the field is still aria-required.
        InputDisplay d = Project(new InputModel(id: "x", required: true));

        Assert.False(d.HasLabel);
        Assert.False(d.ShowRequiredMarker);
        Assert.True(d.Required);
    }

    // ── help affordance (the composed <HelpIcon>, gated behind the label) ────────────────────────────────

    [Fact]
    public void Help_renders_inside_the_label_block_with_resolved_text_and_default_for()
    {
        InputDisplay d = Project(new InputModel(label: "VIN", id: "vin", help: new InputHelp(Content: "Vehicle id")));

        Assert.True(d.ShowHelp);
        Assert.Equal("Vehicle id", d.HelpText);
        // web for = help.for ?? inputId → accessible name "Help for vin"; help body id "vin-help".
        Assert.Equal("Help for vin", d.HelpAccessibleName);
        Assert.Equal("vin-help", d.HelpDescribedById);
    }

    [Fact]
    public void Help_is_suppressed_when_there_is_no_label()
    {
        // web nests {help && <HelpIcon/>} inside {label && (...)} — no label means no help affordance.
        InputDisplay d = Project(new InputModel(id: "x", help: new InputHelp(Content: "Some help")));

        Assert.False(d.ShowHelp);
        Assert.Equal(string.Empty, d.HelpAccessibleName);
    }

    [Fact]
    public void Help_is_suppressed_when_its_text_resolves_empty()
    {
        // web HelpIcon: `if (!text) return null` — an empty help string renders nothing.
        InputDisplay d = Project(new InputModel(label: "VIN", help: new InputHelp(Content: string.Empty)));

        Assert.False(d.ShowHelp);
        Assert.Null(d.HelpDescribedById);
    }

    [Fact]
    public void Help_prefers_the_i18n_key_over_the_content_fallback()
    {
        var keys = new List<string>();
        InputDisplay d = InputProjection.Project(
            new InputModel(label: "VIN", id: "vin", help: new InputHelp(I18nKey: "vin.help", Content: "fallback")),
            new RecordingLocalizer(keys));

        Assert.Contains("vin.help", keys);
        Assert.True(d.ShowHelp);
        Assert.Equal("fallback", d.HelpText); // RecordingLocalizer returns the fallback
    }

    [Fact]
    public void Help_for_defaults_to_the_input_id_but_can_be_overridden()
    {
        InputDisplay d = Project(new InputModel(
            label: "VIN",
            id: "vin",
            help: new InputHelp(Content: "h", For: "other-field")));

        Assert.Equal("Help for other-field", d.HelpAccessibleName);
        Assert.Equal("other-field-help", d.HelpDescribedById);
    }

    [Fact]
    public void Help_uses_the_generic_label_when_for_resolves_empty()
    {
        // help.for is an explicit empty string: `help.for ?? inputId` keeps "" (nullish), so the affordance
        // falls back to the generic web `help.tooltip.iconLabel` name and exposes no help body id.
        InputDisplay d = Project(new InputModel(label: "VIN", id: "vin", help: new InputHelp(Content: "h", For: string.Empty)));

        Assert.True(d.ShowHelp);
        Assert.Equal("More info", d.HelpAccessibleName);
        Assert.Null(d.HelpDescribedById);
    }

    [Fact]
    public void Help_explicit_aria_label_overrides_the_resolved_name()
    {
        InputDisplay d = Project(new InputModel(
            label: "VIN",
            id: "vin",
            help: new InputHelp(Content: "h", AriaLabel: "Custom label")));

        Assert.Equal("Custom label", d.HelpAccessibleName);
    }

    [Fact]
    public void Help_for_key_and_icon_label_key_match_the_web_strings()
    {
        Assert.Equal("a11y.helpFor", InputProjection.HelpForKey);
        Assert.Equal("Help for {0}", InputProjection.HelpForFallback);
        Assert.Equal("help.tooltip.iconLabel", InputProjection.IconLabelKey);
        Assert.Equal("More info", InputProjection.IconLabelFallback);
    }

    // ── error row + aria-invalid + aria-describedby (web error ? ...) ─────────────────────────────────────

    [Fact]
    public void Error_renders_the_alert_row_marks_invalid_and_describes_the_field()
    {
        InputDisplay d = Project(new InputModel(label: "Email", id: "email", error: "Required"));

        Assert.True(d.ShowError);
        Assert.Equal("Required", d.ErrorText);
        Assert.Equal("email-error", d.ErrorId);
        Assert.True(d.Invalid);
        Assert.Equal("email-error", d.DescribedById);
        Assert.False(d.ShowHint);
    }

    [Fact]
    public void Hint_renders_the_hint_row_and_describes_the_field_when_no_error()
    {
        InputDisplay d = Project(new InputModel(label: "Email", id: "email", hint: "We never share it"));

        Assert.True(d.ShowHint);
        Assert.Equal("We never share it", d.HintText);
        Assert.Equal("email-hint", d.HintId);
        Assert.Equal("email-hint", d.DescribedById);
        Assert.False(d.ShowError);
        Assert.False(d.Invalid);
    }

    [Fact]
    public void Error_takes_precedence_and_hides_the_hint()
    {
        // web: error ? <error/> : hint ? <hint/> : null — an error suppresses the hint and owns describedby.
        InputDisplay d = Project(new InputModel(label: "Email", id: "email", hint: "Helper", error: "Bad"));

        Assert.True(d.ShowError);
        Assert.Equal("email-error", d.DescribedById);
        Assert.False(d.ShowHint);
        Assert.Null(d.HintId);
        Assert.Null(d.HintText);
    }

    [Fact]
    public void Blank_error_is_treated_as_absent_and_keeps_the_hint()
    {
        InputDisplay d = Project(new InputModel(label: "Email", id: "email", hint: "Helper", error: string.Empty));

        Assert.False(d.ShowError);
        Assert.Null(d.ErrorId);
        Assert.True(d.ShowHint);
        Assert.Equal("email-hint", d.DescribedById);
    }

    [Fact]
    public void Blank_hint_is_treated_as_absent()
    {
        InputDisplay d = Project(new InputModel(label: "Email", id: "email", hint: string.Empty));

        Assert.False(d.ShowHint);
        Assert.Null(d.HintId);
        Assert.Null(d.DescribedById);
    }

    [Fact]
    public void No_error_or_hint_leaves_the_field_undescribed()
    {
        Assert.Null(Project(new InputModel(label: "Email", id: "email")).DescribedById);
    }

    // ── the web template-literal id when no id/label resolves (`${undefined}-error`) ─────────────────────

    [Fact]
    public void Absent_input_id_matches_the_web_template_literal_undefined()
    {
        // web `${inputId}-error` with an undefined inputId yields the literal "undefined-error"; the error id
        // and the field's describedby stay byte-identical to the web runtime and keep matching each other.
        InputDisplay d = Project(new InputModel(error: "Boom"));

        Assert.Null(d.InputId);
        Assert.Equal("undefined-error", d.ErrorId);
        Assert.Equal("undefined-error", d.DescribedById);
        Assert.Equal("undefined", InputProjection.MissingIdToken);
    }

    // ── prompt text / disabled passthrough (input attrs) ─────────────────────────────────────────────────

    [Fact]
    public void Prompt_text_is_normalised_blank_to_absent()
    {
        Assert.Null(new InputModel().PromptText);
        Assert.Null(new InputModel(label: "x", promptText: string.Empty).PromptText);
        Assert.Equal("you@example.com", new InputModel(label: "x", promptText: "you@example.com").PromptText);
    }

    [Fact]
    public void Disabled_flows_to_the_display()
    {
        Assert.True(Project(new InputModel(label: "x", disabled: true)).Disabled);
        Assert.False(Project(new InputModel(label: "x")).Disabled);
    }

    // ── view-model (state holder): projection + change notification ──────────────────────────────────────

    [Fact]
    public void ViewModel_defaults_to_the_empty_model()
    {
        var viewModel = new InputViewModel(Localizer);

        Assert.Same(InputModel.Empty, viewModel.Model);
        Assert.Null(viewModel.Display.InputId);
        Assert.False(viewModel.Display.HasLabel);
    }

    [Fact]
    public void ViewModel_projects_the_current_model()
    {
        var viewModel = new InputViewModel(Localizer, new InputModel(label: "Email", required: true));

        Assert.Equal("email", viewModel.Display.InputId);
        Assert.True(viewModel.Display.ShowRequiredMarker);
    }

    [Fact]
    public void ViewModel_raises_change_for_model_and_display_on_assignment()
    {
        var viewModel = new InputViewModel(Localizer, new InputModel(label: "Email"));
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Model = new InputModel(label: "Email", error: "Bad");

        Assert.Contains(nameof(InputViewModel.Model), changed);
        Assert.Contains(nameof(InputViewModel.Display), changed);
        Assert.True(viewModel.Display.Invalid);
    }

    [Fact]
    public void ViewModel_does_not_raise_for_an_equal_model()
    {
        var viewModel = new InputViewModel(Localizer, new InputModel(label: "Email"));
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        // InputModel is a record (value equality) — assigning an equal model is a no-op render.
        viewModel.Model = new InputModel(label: "Email");

        Assert.Empty(changed);
    }

    // ── diagnostics (view.opened, PII-safe — never the label / hint / error text) ─────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new InputDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=Input", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new InputDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<System.ArgumentNullException>(() => InputProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(() => InputProjection.Project(InputModel.Empty, null!));

    [Fact]
    public void Slugify_rejects_a_null_label() =>
        Assert.Throws<System.ArgumentNullException>(() => InputProjection.Slugify(null!));

    [Fact]
    public void ViewModel_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(() => new InputViewModel(null!));

    [Fact]
    public void ViewModel_rejects_a_null_model_assignment()
    {
        var viewModel = new InputViewModel(Localizer);
        Assert.Throws<System.ArgumentNullException>(() => viewModel.Model = null!);
    }

    /// <summary>An <see cref="ILocalizer"/> that records the keys it is asked for and returns the fallback.</summary>
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
