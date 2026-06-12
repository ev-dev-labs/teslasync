using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the UnitInput surface's UI-thread-free logic — the registration metadata (slug,
/// automation ids, default precision, the i18n key + fallback behind the default accessible label), the
/// <see cref="UnitInputSettings"/> normalisation, the pure <see cref="UnitFieldFormat"/> parse / format /
/// symbol helper (the 1:1 port of web/src/lib/unitInput.ts: canonical-to-display formatting with grouping
/// off, locale-aware + suffix-tolerant parsing, the strict escape, the percent / currency branches and the
/// per-unit symbols), the <see cref="UnitInputDisplay"/> adapter (the formatted value, the symbol adornment,
/// the empty/value branch, the aria =&gt; label =&gt; default name chain and the disabled/error flags), the
/// <see cref="UnitInputViewModel"/> state holder (initial buffer, free-typing without committing, the
/// blur/Enter commit + re-format, the parent re-sync gated on focus, the settings / unit change and
/// subscription cleanup) and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/forms/UnitInput.tsx). The WinUI view (shared-surfaces/UnitInput.cs) is exercised by
/// the app build. Because the component reads no network data, there is no loading / error / stale / offline
/// state — the reproduced render branches are the populated value, the empty field, the focused editing
/// buffer and the disabled / error passthrough states.
/// </summary>
public sealed class UnitInputTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");
    private static readonly CultureInfo DeDe = CultureInfo.GetCultureInfo("de-DE");

    private static readonly UnitInputSettings MilesEnUs = new(
        UnitInputLength.Miles, UnitInputTemperature.Celsius, "$", 2, EnUs);

    private static readonly UnitInputSettings KmEnUs = new(
        UnitInputLength.Kilometers, UnitInputTemperature.Celsius, "$", 2, EnUs);

    private static readonly UnitInputSettings FahrenheitEnUs = new(
        UnitInputLength.Miles, UnitInputTemperature.Fahrenheit, "$", 2, EnUs);

    private static readonly UnitInputSettings KmDeDe = new(
        UnitInputLength.Kilometers, UnitInputTemperature.Celsius, "\u20AC", 2, DeDe);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("UnitInput", UnitInputRegistration.Slug);

    [Fact]
    public void Root_and_symbol_automation_ids_are_the_native_stable_hooks()
    {
        Assert.Equal("unit-input", UnitInputRegistration.RootAutomationId);

        // web data-testid="unit-input-symbol".
        Assert.Equal("unit-input-symbol", UnitInputRegistration.SymbolAutomationId);
    }

    [Fact]
    public void Default_precision_matches_the_web_source() =>
        Assert.Equal(2, UnitInputRegistration.DefaultPrecision);

    [Fact]
    public void Default_aria_label_key_and_fallback_match_the_web_example()
    {
        // web JSDoc @example: t('chargePlanner.batteryCapacity', 'Battery Capacity').
        Assert.Equal("translation.chargePlanner.batteryCapacity", UnitInputRegistration.DefaultAriaLabelKey);
        Assert.Equal("Battery Capacity", UnitInputRegistration.DefaultAriaLabelFallback);
        Assert.Equal("Battery Capacity", UnitInputRegistration.ResolveDefaultAriaLabel(Localizer));
    }

    [Fact]
    public void Resolve_default_aria_label_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(() => UnitInputRegistration.ResolveDefaultAriaLabel(null!));

    // ── settings normalisation ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Settings_defaults_match_the_web_canonical()
    {
        var settings = new UnitInputSettings();

        Assert.Equal(UnitInputLength.Miles, settings.Length);
        Assert.Equal(UnitInputTemperature.Celsius, settings.Temperature);
        Assert.Equal("$", settings.CurrencySymbol);
        Assert.Equal(2, settings.DecimalPrecision);
        Assert.Equal(EnUs, settings.Culture);
    }

    [Theory]
    [InlineData(-5, 0)]
    [InlineData(0, 0)]
    [InlineData(3, 3)]
    [InlineData(99, 15)]
    public void Settings_clamp_precision_to_the_supported_range(int requested, int expected) =>
        Assert.Equal(expected, new UnitInputSettings(decimalPrecision: requested).DecimalPrecision);

    [Fact]
    public void Settings_normalise_null_currency_and_culture()
    {
        var settings = new UnitInputSettings(currencySymbol: null!, culture: null);

        Assert.Equal("$", settings.CurrencySymbol);
        Assert.Equal(EnUs, settings.Culture);
    }

    [Fact]
    public void Settings_from_maps_the_raw_web_appsettings_fields()
    {
        var settings = UnitInputSettings.From("km", "F", "\u20AC", 3, "de-DE");

        Assert.Equal(UnitInputLength.Kilometers, settings.Length);
        Assert.Equal(UnitInputTemperature.Fahrenheit, settings.Temperature);
        Assert.Equal("\u20AC", settings.CurrencySymbol);
        Assert.Equal(3, settings.DecimalPrecision);
        Assert.Equal(DeDe, settings.Culture);
    }

    [Fact]
    public void Settings_from_falls_back_for_blank_and_unknown_fields()
    {
        var settings = UnitInputSettings.From(unitOfLength: null, unitOfTemp: null, currencySymbol: null, decimalPrecision: null, locale: null);

        // web: unit_of_length !== 'km' => miles; unit_of_temp !== 'F' => Celsius; decimal_precision ?? 2;
        // resolveLocale('') => 'en-US'.
        Assert.Equal(UnitInputLength.Miles, settings.Length);
        Assert.Equal(UnitInputTemperature.Celsius, settings.Temperature);
        Assert.Equal("$", settings.CurrencySymbol);
        Assert.Equal(2, settings.DecimalPrecision);
        Assert.Equal(EnUs, settings.Culture);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Settings_resolve_culture_falls_back_to_en_us_for_a_blank_locale(string locale) =>
        // web resolveLocale falls back to en-US only for a blank / whitespace tag; a non-blank tag is passed
        // through (the platform culture lookup is lenient), so only blanks are asserted here.
        Assert.Equal(EnUs, UnitInputSettings.ResolveCulture(locale));

    // ── format helper (web formatForUnit) ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Format_null_and_non_finite_values_render_blank()
    {
        Assert.Equal(string.Empty, UnitFieldFormat.Format(null, UnitInputKind.Distance, MilesEnUs));
        Assert.Equal(string.Empty, UnitFieldFormat.Format(double.NaN, UnitInputKind.Distance, MilesEnUs));
        Assert.Equal(string.Empty, UnitFieldFormat.Format(double.PositiveInfinity, UnitInputKind.Speed, MilesEnUs));
    }

    [Fact]
    public void Format_distance_and_speed_use_the_canonical_when_miles()
    {
        Assert.Equal("60", UnitFieldFormat.Format(60, UnitInputKind.Distance, MilesEnUs));
        Assert.Equal("65", UnitFieldFormat.Format(65, UnitInputKind.Speed, MilesEnUs));
    }

    [Fact]
    public void Format_distance_and_speed_convert_to_kilometres()
    {
        // 1 mile = 1.609344 km; 100 mph = 160.9344 km/h. Rounded to the 2-digit default.
        Assert.Equal("1.61", UnitFieldFormat.Format(1, UnitInputKind.Distance, KmEnUs));
        Assert.Equal("160.93", UnitFieldFormat.Format(100, UnitInputKind.Speed, KmEnUs));
    }

    [Fact]
    public void Format_temperature_converts_to_fahrenheit()
    {
        Assert.Equal("20", UnitFieldFormat.Format(20, UnitInputKind.Temperature, MilesEnUs));
        Assert.Equal("68", UnitFieldFormat.Format(20, UnitInputKind.Temperature, FahrenheitEnUs));
        Assert.Equal("32", UnitFieldFormat.Format(0, UnitInputKind.Temperature, FahrenheitEnUs));
    }

    [Fact]
    public void Format_energy_percent_and_currency_have_no_per_user_conversion()
    {
        Assert.Equal("75", UnitFieldFormat.Format(75, UnitInputKind.Energy, KmEnUs));
        Assert.Equal("80", UnitFieldFormat.Format(80, UnitInputKind.Percent, KmEnUs));
        // Currency formats the number only; the symbol is the separate adornment.
        Assert.Equal("1.5", UnitFieldFormat.Format(1.5, UnitInputKind.Currency, MilesEnUs));
    }

    [Fact]
    public void Format_omits_group_separators()
    {
        // web useGrouping: false — a thousands value renders without a separator.
        Assert.Equal("1234.5", UnitFieldFormat.Format(1234.5, UnitInputKind.Distance, MilesEnUs));
    }

    [Fact]
    public void Format_respects_the_settings_precision_and_trims_trailing_zeros()
    {
        var p4 = MilesEnUs with { DecimalPrecision = 4 };
        var p0 = MilesEnUs with { DecimalPrecision = 0 };

        Assert.Equal("1.2345", UnitFieldFormat.Format(1.2345, UnitInputKind.Distance, p4));
        Assert.Equal("1.23", UnitFieldFormat.Format(1.2345, UnitInputKind.Distance, MilesEnUs));
        Assert.Equal("1", UnitFieldFormat.Format(1.2345, UnitInputKind.Distance, p0));
    }

    [Fact]
    public void Format_uses_the_culture_decimal_separator()
    {
        // de-DE uses a comma decimal separator (1 mile => 1.609344 km => "1,61").
        Assert.Equal("1,61", UnitFieldFormat.Format(1, UnitInputKind.Distance, KmDeDe));
    }

    [Fact]
    public void Format_rounds_half_away_from_zero_like_intl()
    {
        var p1 = MilesEnUs with { DecimalPrecision = 1 };
        Assert.Equal("0.3", UnitFieldFormat.Format(0.25, UnitInputKind.Distance, p1));
    }

    // ── symbol helper (web unitSymbol) ────────────────────────────────────────────────────────────────────

    [Fact]
    public void Symbol_matches_the_web_per_unit_and_preference()
    {
        Assert.Equal("mi", UnitFieldFormat.Symbol(UnitInputKind.Distance, MilesEnUs));
        Assert.Equal("km", UnitFieldFormat.Symbol(UnitInputKind.Distance, KmEnUs));
        Assert.Equal("mph", UnitFieldFormat.Symbol(UnitInputKind.Speed, MilesEnUs));
        Assert.Equal("km/h", UnitFieldFormat.Symbol(UnitInputKind.Speed, KmEnUs));
        Assert.Equal("\u00B0C", UnitFieldFormat.Symbol(UnitInputKind.Temperature, MilesEnUs));
        Assert.Equal("\u00B0F", UnitFieldFormat.Symbol(UnitInputKind.Temperature, FahrenheitEnUs));
        Assert.Equal("kWh", UnitFieldFormat.Symbol(UnitInputKind.Energy, MilesEnUs));
        Assert.Equal("%", UnitFieldFormat.Symbol(UnitInputKind.Percent, MilesEnUs));
        Assert.Equal("\u20AC", UnitFieldFormat.Symbol(UnitInputKind.Currency, KmDeDe));
    }

    [Fact]
    public void Symbol_currency_falls_back_to_dollar_when_blank()
    {
        var blank = MilesEnUs with { CurrencySymbol = "   " };
        Assert.Equal("$", UnitFieldFormat.Symbol(UnitInputKind.Currency, blank));
    }

    // ── parse helper (web parseForUnit) ───────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("abc")]
    [InlineData("--")]
    public void Parse_blank_or_unparseable_returns_null(string text) =>
        Assert.Null(UnitFieldFormat.Parse(text, UnitInputKind.Distance, MilesEnUs, strict: false));

    [Fact]
    public void Parse_plain_number_returns_the_canonical()
    {
        Assert.Equal(60, UnitFieldFormat.Parse("60", UnitInputKind.Distance, MilesEnUs, strict: false));
    }

    [Theory]
    [InlineData("60 mph")]
    [InlineData("60mph")]
    [InlineData("60 MPH")]
    public void Parse_tolerates_a_trailing_unit_suffix(string text)
    {
        Assert.Equal(60, UnitFieldFormat.Parse(text, UnitInputKind.Speed, MilesEnUs, strict: false));
    }

    [Fact]
    public void Parse_strips_energy_and_distance_suffixes()
    {
        Assert.Equal(75, UnitFieldFormat.Parse("75 kWh", UnitInputKind.Energy, MilesEnUs, strict: false));
        Assert.Equal(5, UnitFieldFormat.Parse("5 mi", UnitInputKind.Distance, MilesEnUs, strict: false));
        // "5 km" in a km-preference parses to the mile canonical: 5 / 1.609344 = 3.106856 mi.
        Assert.Equal(3.106856, UnitFieldFormat.Parse("5 km", UnitInputKind.Distance, KmEnUs, strict: false)!.Value, 6);
    }

    [Fact]
    public void Parse_speed_in_kilometres_converts_back_to_the_mph_canonical()
    {
        // 100 km/h => 100 / 1.609344 = 62.1371... mph canonical.
        double? mph = UnitFieldFormat.Parse("100 km/h", UnitInputKind.Speed, KmEnUs, strict: false);
        Assert.NotNull(mph);
        Assert.Equal(62.137119, mph!.Value, 5);
    }

    [Fact]
    public void Parse_temperature_strips_the_degree_suffix_and_converts()
    {
        Assert.Equal(20, UnitFieldFormat.Parse("20\u00B0C", UnitInputKind.Temperature, MilesEnUs, strict: false));
        // 68°F => (68 - 32) * 5/9 = 20 °C canonical.
        Assert.Equal(20, UnitFieldFormat.Parse("68\u00B0F", UnitInputKind.Temperature, FahrenheitEnUs, strict: false)!.Value, 6);
    }

    [Fact]
    public void Parse_percent_strips_the_trailing_sign()
    {
        Assert.Equal(80, UnitFieldFormat.Parse("80%", UnitInputKind.Percent, MilesEnUs, strict: false));
        Assert.Equal(80, UnitFieldFormat.Parse("80 %", UnitInputKind.Percent, MilesEnUs, strict: false));
    }

    [Fact]
    public void Parse_currency_strips_the_leading_symbol()
    {
        Assert.Equal(1.5, UnitFieldFormat.Parse("$1.50", UnitInputKind.Currency, MilesEnUs, strict: false));
    }

    [Fact]
    public void Parse_currency_understands_accounting_parentheses_for_negatives()
    {
        Assert.Equal(-1.5, UnitFieldFormat.Parse("($1.50)", UnitInputKind.Currency, MilesEnUs, strict: false));
    }

    [Fact]
    public void Parse_understands_locale_group_and_decimal_separators()
    {
        // de-DE: group ".", decimal "," => 1.234,56 == 1234.56.
        Assert.Equal(1234.56, UnitFieldFormat.Parse("1.234,56 kWh", UnitInputKind.Energy, KmDeDe, strict: false));
    }

    [Fact]
    public void Parse_en_us_group_separator_is_dropped()
    {
        Assert.Equal(1234.5, UnitFieldFormat.Parse("1,234.5", UnitInputKind.Distance, MilesEnUs, strict: false));
    }

    [Fact]
    public void Parse_strict_bypasses_locale_separator_handling()
    {
        // web strict => Number(raw): a grouped string is NaN; a plain decimal parses.
        Assert.Null(UnitFieldFormat.Parse("1,234.5", UnitInputKind.Distance, MilesEnUs, strict: true));
        Assert.Equal(1234.5, UnitFieldFormat.Parse("1234.5", UnitInputKind.Distance, MilesEnUs, strict: true));
    }

    // ── projection adapter (web derived values) ───────────────────────────────────────────────────────────

    [Fact]
    public void Projection_empty_value_shows_a_blank_field_with_the_symbol_affordance()
    {
        var props = new UnitInputProps(value: null, unit: UnitInputKind.Energy, settings: MilesEnUs, ariaLabel: "Capacity");
        var display = UnitInputDisplay.Project(props, Localizer);

        Assert.Equal(UnitInputState.Empty, display.State);
        Assert.True(display.IsEmpty);
        Assert.False(display.HasValue);
        Assert.Equal(string.Empty, display.FormattedValue);
        Assert.Equal("kWh", display.Symbol);
        Assert.Equal("Capacity", display.AccessibleName);
        Assert.True(display.IsEnabled);
        Assert.False(display.HasError);
    }

    [Fact]
    public void Projection_populated_value_formats_with_the_unit_and_settings()
    {
        var props = new UnitInputProps(value: 1, unit: UnitInputKind.Distance, settings: KmEnUs, ariaLabel: "Range");
        var display = UnitInputDisplay.Project(props, Localizer);

        Assert.Equal(UnitInputState.Value, display.State);
        Assert.True(display.HasValue);
        Assert.Equal("1.61", display.FormattedValue);
        Assert.Equal(UnitFieldFormat.Format(1, UnitInputKind.Distance, KmEnUs), display.FormattedValue);
        Assert.Equal("km", display.Symbol);
    }

    [Fact]
    public void Projection_non_finite_value_is_treated_as_empty()
    {
        var display = UnitInputDisplay.Project(new UnitInputProps(value: double.NaN, unit: UnitInputKind.Distance, settings: MilesEnUs, ariaLabel: "Range"), Localizer);

        Assert.Equal(UnitInputState.Empty, display.State);
        Assert.Equal(string.Empty, display.FormattedValue);
    }

    [Fact]
    public void Projection_accessible_name_prefers_the_aria_label()
    {
        var display = UnitInputDisplay.Project(new UnitInputProps(value: 75, unit: UnitInputKind.Energy, settings: MilesEnUs, ariaLabel: "  Range  ", label: "Battery"), Localizer);

        Assert.Equal("Range", display.AccessibleName);
        Assert.True(display.HasLabel);
        Assert.Equal("Battery", display.Label);
    }

    [Fact]
    public void Projection_accessible_name_falls_back_to_the_visible_label()
    {
        // web passes the visible label through; with no explicit aria label it names the field.
        var display = UnitInputDisplay.Project(new UnitInputProps(value: 75, unit: UnitInputKind.Energy, settings: MilesEnUs, ariaLabel: "   ", label: "Battery Capacity"), Localizer);

        Assert.Equal("Battery Capacity", display.AccessibleName);
        Assert.Equal("Battery Capacity", display.Label);
    }

    [Fact]
    public void Projection_accessible_name_falls_back_to_the_i18n_default()
    {
        var display = UnitInputDisplay.Project(new UnitInputProps(value: 75, unit: UnitInputKind.Energy, settings: MilesEnUs, ariaLabel: "   ", label: "   "), Localizer);

        Assert.Equal("Battery Capacity", display.AccessibleName);
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
        var props = new UnitInputProps(value: 60, unit: UnitInputKind.Speed, settings: MilesEnUs, ariaLabel: "Speed", disabled: disabled, hasError: hasError);
        var display = UnitInputDisplay.Project(props, Localizer);

        Assert.Equal(expectedEnabled, display.IsEnabled);
        Assert.Equal(expectedError, display.HasError);
    }

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var props = new UnitInputProps(value: 60, unit: UnitInputKind.Speed, settings: MilesEnUs, ariaLabel: "Speed");
        var a = UnitInputDisplay.Project(props, Localizer);
        var b = UnitInputDisplay.Project(props, Localizer);
        var different = UnitInputDisplay.Project(props with { Value = 80 }, Localizer);

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    [Fact]
    public void Projection_throws_for_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => UnitInputDisplay.Project(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => UnitInputDisplay.Project(new UnitInputProps(), null!));
    }

    // ── view-model: initial state ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("UnitInput", UnitInputViewModel.Slug);

    [Fact]
    public void ViewModel_seeds_the_buffer_from_the_formatted_source_value()
    {
        using var viewModel = NewViewModel(out _, value: 60, unit: UnitInputKind.Speed);

        Assert.Equal("60", viewModel.Text);
        Assert.Equal(UnitInputState.Value, viewModel.State);
        Assert.Equal("mph", viewModel.Symbol);
        Assert.Equal("Capacity", viewModel.AccessibleName);
    }

    [Fact]
    public void ViewModel_empty_source_seeds_a_blank_buffer()
    {
        using var viewModel = NewViewModel(out _, value: null);

        Assert.Equal(string.Empty, viewModel.Text);
        Assert.True(viewModel.IsEmpty);
    }

    [Fact]
    public void ViewModel_throws_for_null_seams()
    {
        Assert.Throws<ArgumentNullException>(() => new UnitInputViewModel(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => new UnitInputViewModel(new UnitInputSource(), null!));
    }

    // ── view-model: free typing does not commit (web onChange just sets the buffer) ───────────────────────

    [Fact]
    public void ViewModel_set_text_updates_the_buffer_without_committing()
    {
        using var viewModel = NewViewModel(out _, value: null);
        var commits = new List<UnitInputCommit>();
        viewModel.ValueCommitted += (_, e) => commits.Add(e);

        viewModel.SetText("60");

        Assert.Equal("60", viewModel.Text);
        // Not parsed yet: the canonical value branch is unchanged until blur / Enter.
        Assert.Equal(UnitInputState.Empty, viewModel.State);
        Assert.Empty(commits);
    }

    [Fact]
    public void ViewModel_set_text_is_a_no_op_for_unchanged_text()
    {
        using var viewModel = NewViewModel(out _, value: 60, unit: UnitInputKind.Speed);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.SetText("60");

        Assert.Equal(0, changes);
    }

    // ── view-model: commit on blur / Enter (web handleBlur / handleKeyDown) ───────────────────────────────

    [Fact]
    public void ViewModel_blur_parses_the_buffer_and_raises_the_committed_value()
    {
        using var viewModel = NewViewModel(out _, value: null, unit: UnitInputKind.Speed);
        var commits = new List<UnitInputCommit>();
        viewModel.ValueCommitted += (_, e) => commits.Add(e);

        viewModel.Focus();
        viewModel.SetText("65 mph");
        viewModel.Blur();

        Assert.Equal(65, Assert.Single(commits).Value);
        Assert.Equal("65", viewModel.Text);
        Assert.Equal(UnitInputState.Value, viewModel.State);
        Assert.False(viewModel.IsFocused);
    }

    [Fact]
    public void ViewModel_blur_on_a_blank_buffer_commits_null_and_empties_the_field()
    {
        using var viewModel = NewViewModel(out _, value: 60, unit: UnitInputKind.Speed);
        var commits = new List<UnitInputCommit>();
        viewModel.ValueCommitted += (_, e) => commits.Add(e);

        viewModel.Focus();
        viewModel.SetText("   ");
        viewModel.Blur();

        Assert.Null(Assert.Single(commits).Value);
        Assert.Equal(string.Empty, viewModel.Text);
        Assert.Equal(UnitInputState.Empty, viewModel.State);
    }

    [Fact]
    public void ViewModel_enter_commits_without_dropping_focus()
    {
        using var viewModel = NewViewModel(out _, value: null, unit: UnitInputKind.Distance);
        var commits = new List<UnitInputCommit>();
        viewModel.ValueCommitted += (_, e) => commits.Add(e);

        viewModel.Focus();
        viewModel.SetText("42");
        viewModel.CommitFromEnter();

        Assert.Equal(42, Assert.Single(commits).Value);
        Assert.True(viewModel.IsFocused);
    }

    [Fact]
    public void ViewModel_commit_renormalises_the_visible_text_to_the_rounded_form()
    {
        using var viewModel = NewViewModel(out _, value: null, unit: UnitInputKind.Distance);
        var commits = new List<UnitInputCommit>();
        viewModel.ValueCommitted += (_, e) => commits.Add(e);

        viewModel.Focus();
        viewModel.SetText("60.0001");
        viewModel.Blur();

        // web: onChange carries the full-precision canonical, but the field re-formats to the rounded display.
        Assert.Equal(60.0001, Assert.Single(commits).Value!.Value, 4);
        Assert.Equal("60", viewModel.Text);
    }

    // ── view-model: re-sync from the parent (web useEffect, gated on focus) ───────────────────────────────

    [Fact]
    public void ViewModel_resyncs_the_buffer_when_the_source_value_changes_and_the_field_is_idle()
    {
        using var viewModel = NewViewModel(out var source, value: 60, unit: UnitInputKind.Speed);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.SetValue(80);

        Assert.Equal("80", viewModel.Text);
        Assert.Equal(UnitInputState.Value, viewModel.State);
        Assert.Contains(nameof(UnitInputViewModel.Display), changed);
        Assert.Contains(nameof(UnitInputViewModel.Text), changed);
    }

    [Fact]
    public void ViewModel_does_not_clobber_in_progress_text_while_focused()
    {
        using var viewModel = NewViewModel(out var source, value: 60, unit: UnitInputKind.Speed);

        viewModel.Focus();
        viewModel.SetText("typing");
        source.SetValue(90);

        // The editing buffer is preserved, but the projected canonical display still tracks the new value.
        Assert.Equal("typing", viewModel.Text);
        Assert.Equal("90", viewModel.Display.FormattedValue);
    }

    [Fact]
    public void ViewModel_reformats_when_the_settings_change_and_the_field_is_idle()
    {
        using var viewModel = NewViewModel(out var source, value: 1, unit: UnitInputKind.Distance, settings: MilesEnUs);
        Assert.Equal("1", viewModel.Text);
        Assert.Equal("mi", viewModel.Symbol);

        source.SetSettings(KmEnUs);

        Assert.Equal("1.61", viewModel.Text);
        Assert.Equal("km", viewModel.Symbol);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_unit_changes()
    {
        using var viewModel = NewViewModel(out var source, value: 60, unit: UnitInputKind.Speed, settings: MilesEnUs);
        Assert.Equal("mph", viewModel.Symbol);

        source.SetUnit(UnitInputKind.Distance);

        Assert.Equal("mi", viewModel.Symbol);
        Assert.Equal("60", viewModel.Text);
    }

    [Fact]
    public void ViewModel_reflects_disabled_and_error_passthrough_flags()
    {
        using var viewModel = NewViewModel(out var source, value: 60, unit: UnitInputKind.Speed);
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
        using var viewModel = NewViewModel(out var source, value: null, unit: UnitInputKind.Distance);
        var commits = 0;
        viewModel.ValueCommitted += (_, _) => commits++;

        source.SetValue(5);
        source.SetSettings(KmEnUs);
        source.SetUnit(UnitInputKind.Speed);
        source.SetDisabled(true);

        Assert.Equal(0, commits);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_source()
    {
        var source = new UnitInputSource(new UnitInputProps(value: 60, unit: UnitInputKind.Speed, settings: MilesEnUs, ariaLabel: "Speed"));
        var viewModel = new UnitInputViewModel(source, Localizer);
        Assert.Equal("60", viewModel.Text);

        viewModel.Dispose();
        source.SetValue(99);

        // After dispose a late source change must not move the buffer or the projection.
        Assert.Equal("60", viewModel.Text);
        Assert.Equal("60", viewModel.Display.FormattedValue);
    }

    // ── source seam ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Source_set_value_is_a_no_op_for_an_unchanged_value()
    {
        var source = new UnitInputSource(new UnitInputProps(value: 60));
        var changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetValue(60);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void Source_set_props_null_falls_back_to_defaults()
    {
        var source = new UnitInputSource();
        source.SetProps(null!);

        Assert.NotNull(source.Props);
        Assert.Equal(UnitInputKind.Distance, source.Props.Unit);
        Assert.NotNull(source.Props.Settings);
    }

    [Fact]
    public void Source_set_settings_null_falls_back_to_defaults()
    {
        var source = new UnitInputSource();
        source.SetSettings(null!);

        Assert.NotNull(source.Props.Settings);
        Assert.Equal("$", source.Props.Settings.CurrencySymbol);
    }

    [Fact]
    public void Source_set_unit_is_a_no_op_for_an_unchanged_unit()
    {
        var source = new UnitInputSource(new UnitInputProps(unit: UnitInputKind.Energy));
        var changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetUnit(UnitInputKind.Energy);

        Assert.Equal(0, changes);
    }

    // ── accessibility: the field is always named ──────────────────────────────────────────────────────────

    [Fact]
    public void Accessible_name_is_never_empty()
    {
        using var withAria = NewViewModel(out _, value: 60, unit: UnitInputKind.Speed, ariaLabel: "Speed");
        using var withDefault = NewViewModel(out _, value: null, unit: UnitInputKind.Energy, ariaLabel: "   ");

        Assert.False(string.IsNullOrWhiteSpace(withAria.AccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(withDefault.AccessibleName));
        Assert.Equal("Battery Capacity", withDefault.AccessibleName);
    }

    // ── diagnostics (view.opened, PII-safe — only the slug, never the value) ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new UnitInputDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=UnitInput", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new UnitInputDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_emit_only_the_operational_slug_line()
    {
        var lines = new List<string>();
        var diagnostics = new UnitInputDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
        Assert.EndsWith(UnitInputRegistration.Slug, line, StringComparison.Ordinal);
        // PII-safe: the line carries no typed value.
        Assert.DoesNotContain("60", line, StringComparison.Ordinal);
    }

    private static UnitInputViewModel NewViewModel(
        out UnitInputSource source,
        double? value,
        UnitInputKind unit = UnitInputKind.Distance,
        UnitInputSettings? settings = null,
        string ariaLabel = "Capacity")
    {
        source = new UnitInputSource(
            new UnitInputProps(
                value: value,
                unit: unit,
                settings: settings ?? MilesEnUs,
                ariaLabel: ariaLabel));
        return new UnitInputViewModel(source, Localizer);
    }
}
