using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the CurrencyInput surface's UI-thread-free logic — the registration metadata (slug,
/// automation ids, default precision, the i18n key + fallback behind the default accessible label), the
/// <see cref="CurrencyInputProps"/> normalisation, the pure <see cref="CurrencyInputDisplay"/> adapter (the formatted
/// value, the symbol adornment, the empty/value branch, the blank-aria-label fallback and the disabled/error flags),
/// the <see cref="CurrencyInputViewModel"/> state holder (initial buffer, free-typing without committing, the
/// blur/Enter commit + re-format, the parent re-sync gated on focus, the formatting-context change and subscription
/// cleanup) and the PII-safe diagnostics. Mirrors the web spec (web/src/components/forms/CurrencyInput.tsx) and uses
/// the shared <see cref="CurrencyMicro"/> helper for the expected formatting/parsing. The WinUI view
/// (shared-surfaces/CurrencyInput.cs) is exercised by the app build. Because the component reads no network data,
/// there is no loading / error / stale / offline state — the reproduced render branches are the populated value, the
/// empty field, the focused editing buffer and the disabled / error passthrough states.
/// </summary>
public sealed class CurrencyInputTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");
    private static readonly CultureInfo DeDe = CultureInfo.GetCultureInfo("de-DE");

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("CurrencyInput", CurrencyInputRegistration.Slug);

    [Fact]
    public void Root_and_symbol_automation_ids_are_the_native_stable_hooks()
    {
        Assert.Equal("currency-input", CurrencyInputRegistration.RootAutomationId);

        // web data-testid="currency-input-symbol".
        Assert.Equal("currency-input-symbol", CurrencyInputRegistration.SymbolAutomationId);
    }

    [Fact]
    public void Default_precision_matches_the_web_source() =>
        Assert.Equal(2, CurrencyInputRegistration.DefaultPrecision);

    [Fact]
    public void Default_aria_label_key_and_fallback_match_the_web_example()
    {
        // web JSDoc @example: t('settings.electricityCost', 'Electricity Cost (per kWh)').
        Assert.Equal("translation.settings.electricityCost", CurrencyInputRegistration.DefaultAriaLabelKey);
        Assert.Equal("Electricity Cost (per kWh)", CurrencyInputRegistration.DefaultAriaLabelFallback);
        Assert.Equal("Electricity Cost (per kWh)", CurrencyInputRegistration.ResolveDefaultAriaLabel(Localizer));
    }

    [Fact]
    public void Resolve_default_aria_label_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(() => CurrencyInputRegistration.ResolveDefaultAriaLabel(null!));

    // ── props normalisation ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Props_defaults_match_the_web_controlled_field()
    {
        var props = new CurrencyInputProps();

        Assert.Null(props.ValueMicro);
        Assert.Equal("USD", props.Currency);
        Assert.Equal(CultureInfo.CurrentCulture, props.Culture);
        Assert.Equal(2, props.Precision);
        Assert.Equal(string.Empty, props.AriaLabel);
        Assert.Null(props.Label);
        Assert.False(props.Disabled);
        Assert.False(props.HasError);
    }

    [Theory]
    [InlineData(-5, 0)]
    [InlineData(0, 0)]
    [InlineData(3, 3)]
    [InlineData(50, 20)]
    public void Props_clamp_precision_to_the_supported_range(int requested, int expected) =>
        Assert.Equal(expected, new CurrencyInputProps(precision: requested).Precision);

    [Fact]
    public void Props_normalise_null_culture_and_currency()
    {
        var props = new CurrencyInputProps(currency: null!, culture: null);

        Assert.Equal(CultureInfo.CurrentCulture, props.Culture);
        Assert.Equal(string.Empty, props.Currency);
    }

    // ── projection adapter (web derived values) ───────────────────────────────────────────────────────────

    [Fact]
    public void Projection_empty_value_shows_a_blank_field_with_the_symbol_affordance()
    {
        var props = new CurrencyInputProps(valueMicro: null, currency: "USD", culture: EnUs, ariaLabel: "Tariff");
        var display = CurrencyInputDisplay.Project(props, Localizer);

        Assert.Equal(CurrencyInputState.Empty, display.State);
        Assert.True(display.IsEmpty);
        Assert.False(display.HasValue);
        Assert.Equal(string.Empty, display.FormattedValue);
        Assert.Equal("$", display.Symbol);
        Assert.Equal("Tariff", display.AccessibleName);
        Assert.True(display.IsEnabled);
        Assert.False(display.HasError);
    }

    [Fact]
    public void Projection_populated_value_formats_with_the_currency_and_culture()
    {
        var props = new CurrencyInputProps(valueMicro: 1_500_000, currency: "USD", culture: EnUs, ariaLabel: "Tariff");
        var display = CurrencyInputDisplay.Project(props, Localizer);

        Assert.Equal(CurrencyInputState.Value, display.State);
        Assert.True(display.HasValue);
        Assert.Equal("$1.50", display.FormattedValue);
        Assert.Equal(CurrencyMicro.Format(1_500_000, "USD", EnUs, 2), display.FormattedValue);
        Assert.Equal("$", display.Symbol);
    }

    [Fact]
    public void Projection_respects_a_non_us_currency_and_culture()
    {
        var props = new CurrencyInputProps(valueMicro: 1_234_560_000, currency: "EUR", culture: DeDe, precision: 2, ariaLabel: "Tarif");
        var display = CurrencyInputDisplay.Project(props, Localizer);

        Assert.Equal("\u20AC1.234,56", display.FormattedValue);
        Assert.Equal("\u20AC", display.Symbol);
    }

    [Fact]
    public void Projection_respects_the_requested_precision()
    {
        var two = CurrencyInputDisplay.Project(new CurrencyInputProps(valueMicro: 1_234_560, currency: "USD", culture: EnUs, precision: 2), Localizer);
        var four = CurrencyInputDisplay.Project(new CurrencyInputProps(valueMicro: 1_234_560, currency: "USD", culture: EnUs, precision: 4), Localizer);

        Assert.Equal("$1.23", two.FormattedValue);
        Assert.Equal("$1.2346", four.FormattedValue);
    }

    [Fact]
    public void Projection_blank_aria_label_falls_back_to_the_i18n_default()
    {
        var props = new CurrencyInputProps(valueMicro: 1_500_000, currency: "USD", culture: EnUs, ariaLabel: "   ");
        var display = CurrencyInputDisplay.Project(props, Localizer);

        Assert.Equal("Electricity Cost (per kWh)", display.AccessibleName);
    }

    [Fact]
    public void Projection_trims_a_supplied_aria_label_and_visible_label()
    {
        var props = new CurrencyInputProps(valueMicro: null, currency: "USD", culture: EnUs, ariaLabel: "  Tariff  ", label: "  Electricity  ");
        var display = CurrencyInputDisplay.Project(props, Localizer);

        Assert.Equal("Tariff", display.AccessibleName);
        Assert.True(display.HasLabel);
        Assert.Equal("Electricity", display.Label);
    }

    [Fact]
    public void Projection_without_a_label_hides_the_header()
    {
        var display = CurrencyInputDisplay.Project(new CurrencyInputProps(ariaLabel: "Tariff", label: "   "), Localizer);

        Assert.False(display.HasLabel);
        Assert.Null(display.Label);
    }

    [Theory]
    [InlineData(false, false, true, false)]
    [InlineData(true, false, false, false)]
    [InlineData(false, true, true, true)]
    [InlineData(true, true, false, true)]
    public void Projection_snapshot_per_disabled_error_state(bool disabled, bool hasError, bool expectedEnabled, bool expectedError)
    {
        var props = new CurrencyInputProps(valueMicro: 1_500_000, currency: "USD", culture: EnUs, ariaLabel: "Tariff", disabled: disabled, hasError: hasError);
        var display = CurrencyInputDisplay.Project(props, Localizer);

        Assert.Equal(expectedEnabled, display.IsEnabled);
        Assert.Equal(expectedError, display.HasError);
    }

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var props = new CurrencyInputProps(valueMicro: 1_500_000, currency: "USD", culture: EnUs, ariaLabel: "Tariff");
        var a = CurrencyInputDisplay.Project(props, Localizer);
        var b = CurrencyInputDisplay.Project(props, Localizer);
        var different = CurrencyInputDisplay.Project(props with { ValueMicro = 2_000_000 }, Localizer);

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    [Fact]
    public void Projection_throws_for_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => CurrencyInputDisplay.Project(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => CurrencyInputDisplay.Project(new CurrencyInputProps(), null!));
    }

    // ── view-model: initial state ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("CurrencyInput", CurrencyInputViewModel.Slug);

    [Fact]
    public void ViewModel_seeds_the_buffer_from_the_formatted_source_value()
    {
        using var viewModel = NewViewModel(out _, valueMicro: 1_500_000);

        Assert.Equal("$1.50", viewModel.Text);
        Assert.Equal(CurrencyInputState.Value, viewModel.State);
        Assert.Equal("$", viewModel.Symbol);
        Assert.Equal("Tariff", viewModel.AccessibleName);
    }

    [Fact]
    public void ViewModel_empty_source_seeds_a_blank_buffer()
    {
        using var viewModel = NewViewModel(out _, valueMicro: null);

        Assert.Equal(string.Empty, viewModel.Text);
        Assert.True(viewModel.IsEmpty);
    }

    [Fact]
    public void ViewModel_throws_for_null_seams()
    {
        Assert.Throws<ArgumentNullException>(() => new CurrencyInputViewModel(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => new CurrencyInputViewModel(new CurrencyInputSource(), null!));
    }

    // ── view-model: free typing does not commit (web onChange just sets the buffer) ───────────────────────

    [Fact]
    public void ViewModel_set_text_updates_the_buffer_without_committing()
    {
        using var viewModel = NewViewModel(out _, valueMicro: null);
        var commits = new List<CurrencyInputCommit>();
        viewModel.ValueCommitted += (_, e) => commits.Add(e);

        viewModel.SetText("12.5");

        Assert.Equal("12.5", viewModel.Text);
        // Not parsed yet: the canonical value branch is unchanged until blur / Enter.
        Assert.Equal(CurrencyInputState.Empty, viewModel.State);
        Assert.Empty(commits);
    }

    [Fact]
    public void ViewModel_set_text_is_a_no_op_for_unchanged_text()
    {
        using var viewModel = NewViewModel(out _, valueMicro: 1_500_000);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.SetText("$1.50");

        Assert.Equal(0, changes);
    }

    // ── view-model: commit on blur / Enter (web handleBlur / handleKeyDown) ───────────────────────────────

    [Fact]
    public void ViewModel_blur_parses_the_buffer_and_raises_the_committed_value()
    {
        using var viewModel = NewViewModel(out _, valueMicro: null);
        var commits = new List<CurrencyInputCommit>();
        viewModel.ValueCommitted += (_, e) => commits.Add(e);

        viewModel.Focus();
        viewModel.SetText("$1.50");
        viewModel.Blur();

        Assert.Equal(1_500_000, Assert.Single(commits).ValueMicro);
        Assert.Equal("$1.50", viewModel.Text);
        Assert.Equal(CurrencyInputState.Value, viewModel.State);
        Assert.False(viewModel.IsFocused);
    }

    [Fact]
    public void ViewModel_blur_on_a_blank_buffer_commits_null_and_empties_the_field()
    {
        using var viewModel = NewViewModel(out _, valueMicro: 1_500_000);
        var commits = new List<CurrencyInputCommit>();
        viewModel.ValueCommitted += (_, e) => commits.Add(e);

        viewModel.Focus();
        viewModel.SetText("   ");
        viewModel.Blur();

        Assert.Null(Assert.Single(commits).ValueMicro);
        Assert.Equal(string.Empty, viewModel.Text);
        Assert.Equal(CurrencyInputState.Empty, viewModel.State);
    }

    [Fact]
    public void ViewModel_enter_commits_without_dropping_focus()
    {
        using var viewModel = NewViewModel(out _, valueMicro: null);
        var commits = new List<CurrencyInputCommit>();
        viewModel.ValueCommitted += (_, e) => commits.Add(e);

        viewModel.Focus();
        viewModel.SetText("2");
        viewModel.CommitFromEnter();

        Assert.Equal(2_000_000, Assert.Single(commits).ValueMicro);
        Assert.True(viewModel.IsFocused);
    }

    [Fact]
    public void ViewModel_commit_renormalises_the_visible_text_to_the_rounded_form()
    {
        using var viewModel = NewViewModel(out _, valueMicro: null);
        var commits = new List<CurrencyInputCommit>();
        viewModel.ValueCommitted += (_, e) => commits.Add(e);

        viewModel.Focus();
        viewModel.SetText("1.5001");
        viewModel.Blur();

        // web: onChange carries the full-precision micros, but the field re-formats to the rounded display.
        Assert.Equal(CurrencyMicro.Parse("1.5001", "USD", EnUs), Assert.Single(commits).ValueMicro);
        Assert.Equal("$1.50", viewModel.Text);
    }

    [Fact]
    public void ViewModel_commit_understands_accounting_parentheses_for_negatives()
    {
        using var viewModel = NewViewModel(out _, valueMicro: null);
        var commits = new List<CurrencyInputCommit>();
        viewModel.ValueCommitted += (_, e) => commits.Add(e);

        viewModel.SetText("($1.50)");
        viewModel.Blur();

        Assert.Equal(-1_500_000, Assert.Single(commits).ValueMicro);
    }

    [Fact]
    public void ViewModel_commit_understands_locale_group_separators()
    {
        using var viewModel = NewViewModel(out var source, valueMicro: null, currency: "EUR", culture: DeDe, ariaLabel: "Tarif");
        var commits = new List<CurrencyInputCommit>();
        viewModel.ValueCommitted += (_, e) => commits.Add(e);

        viewModel.SetText("1.234,56 \u20AC");
        viewModel.Blur();

        Assert.Equal(1_234_560_000, Assert.Single(commits).ValueMicro);
        Assert.Equal("\u20AC1.234,56", viewModel.Text);
        Assert.NotNull(source);
    }

    // ── view-model: re-sync from the parent (web useEffect, gated on focus) ───────────────────────────────

    [Fact]
    public void ViewModel_resyncs_the_buffer_when_the_source_value_changes_and_the_field_is_idle()
    {
        using var viewModel = NewViewModel(out var source, valueMicro: 1_500_000);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.SetValueMicro(2_000_000);

        Assert.Equal("$2.00", viewModel.Text);
        Assert.Equal(CurrencyInputState.Value, viewModel.State);
        Assert.Contains(nameof(CurrencyInputViewModel.Display), changed);
        Assert.Contains(nameof(CurrencyInputViewModel.Text), changed);
    }

    [Fact]
    public void ViewModel_does_not_clobber_in_progress_text_while_focused()
    {
        using var viewModel = NewViewModel(out var source, valueMicro: 1_500_000);

        viewModel.Focus();
        viewModel.SetText("typing");
        source.SetValueMicro(9_000_000);

        // The editing buffer is preserved, but the projected canonical display still tracks the new source value.
        Assert.Equal("typing", viewModel.Text);
        Assert.Equal("$9.00", viewModel.Display.FormattedValue);
    }

    [Fact]
    public void ViewModel_reformats_when_the_currency_context_changes_and_the_field_is_idle()
    {
        using var viewModel = NewViewModel(out var source, valueMicro: 1_500_000);
        Assert.Equal("$1.50", viewModel.Text);

        source.SetContext("EUR", DeDe, 2);

        Assert.Equal("\u20AC1,50", viewModel.Text);
        Assert.Equal("\u20AC", viewModel.Symbol);
    }

    [Fact]
    public void ViewModel_reflects_disabled_and_error_passthrough_flags()
    {
        using var viewModel = NewViewModel(out var source, valueMicro: 1_500_000);
        Assert.True(viewModel.IsEnabled);
        Assert.False(viewModel.HasError);

        source.SetDisabled(true);
        source.SetHasError(true);

        Assert.False(viewModel.IsEnabled);
        Assert.True(viewModel.HasError);
    }

    [Fact]
    public void ViewModel_source_change_does_not_raise_a_phantom_commit()
    {
        using var viewModel = NewViewModel(out var source, valueMicro: null);
        var commits = 0;
        viewModel.ValueCommitted += (_, _) => commits++;

        source.SetValueMicro(5_000_000);
        source.SetContext("EUR", DeDe);
        source.SetDisabled(true);

        Assert.Equal(0, commits);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_source()
    {
        var source = new CurrencyInputSource(new CurrencyInputProps(valueMicro: 1_500_000, currency: "USD", culture: EnUs, ariaLabel: "Tariff"));
        var viewModel = new CurrencyInputViewModel(source, Localizer);
        Assert.Equal("$1.50", viewModel.Text);

        viewModel.Dispose();
        source.SetValueMicro(7_000_000);

        // After dispose a late source change must not move the buffer or the projection.
        Assert.Equal("$1.50", viewModel.Text);
        Assert.Equal("$1.50", viewModel.Display.FormattedValue);
    }

    // ── source seam ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Source_set_value_micro_is_a_no_op_for_an_unchanged_value()
    {
        var source = new CurrencyInputSource(new CurrencyInputProps(valueMicro: 1_500_000));
        var changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetValueMicro(1_500_000);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void Source_set_props_null_falls_back_to_defaults()
    {
        var source = new CurrencyInputSource();
        source.SetProps(null!);

        Assert.NotNull(source.Props);
        Assert.Equal("USD", source.Props.Currency);
    }

    [Fact]
    public void Source_set_context_clamps_precision_and_normalises_culture()
    {
        var source = new CurrencyInputSource();
        source.SetContext("EUR", culture: null, precision: 99);

        Assert.Equal("EUR", source.Props.Currency);
        Assert.Equal(CultureInfo.CurrentCulture, source.Props.Culture);
        Assert.Equal(20, source.Props.Precision);
    }

    // ── accessibility: the field is always named ──────────────────────────────────────────────────────────

    [Fact]
    public void Accessible_name_is_never_empty()
    {
        using var withLabel = NewViewModel(out _, valueMicro: 1_500_000, ariaLabel: "Tariff");
        using var withoutLabel = NewViewModel(out _, valueMicro: null, ariaLabel: "   ");

        Assert.False(string.IsNullOrWhiteSpace(withLabel.AccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(withoutLabel.AccessibleName));
        Assert.Equal("Electricity Cost (per kWh)", withoutLabel.AccessibleName);
    }

    // ── diagnostics (view.opened, PII-safe — only the slug, never the value) ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CurrencyInputDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CurrencyInput", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new CurrencyInputDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_emit_only_the_operational_slug_line()
    {
        var lines = new List<string>();
        var diagnostics = new CurrencyInputDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
        Assert.EndsWith(CurrencyInputRegistration.Slug, line, StringComparison.Ordinal);
        // PII-safe: the line carries no value / micros / symbol.
        Assert.DoesNotContain("$", line, StringComparison.Ordinal);
    }

    private static CurrencyInputViewModel NewViewModel(
        out CurrencyInputSource source,
        long? valueMicro,
        string currency = "USD",
        CultureInfo? culture = null,
        string ariaLabel = "Tariff")
    {
        source = new CurrencyInputSource(
            new CurrencyInputProps(
                valueMicro: valueMicro,
                currency: currency,
                culture: culture ?? EnUs,
                ariaLabel: ariaLabel));
        return new CurrencyInputViewModel(source, Localizer);
    }
}
