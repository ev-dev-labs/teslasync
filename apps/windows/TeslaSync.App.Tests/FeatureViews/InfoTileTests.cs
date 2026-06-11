using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>InfoTile</c> feature surface's UI-thread-free logic — the boolean-to-Yes/No
/// resolution through the i18n facade (web <c>typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value</c>),
/// the number formatting (the React <c>String(value)</c> form, ungrouped, with the signed-zero and non-finite
/// guards), the verbatim text passthrough, the value tooltip (web <c>title={String(display)}</c>), the icon /
/// value-colour fallbacks, the sub-line visibility (web <c>sub &amp;&amp; …</c>), the composed Narrator name, the
/// PII-safe diagnostics and the registration metadata. Mirrors the web spec
/// (web/src/features/vehicles/components/telemetry-panels/InfoTile.tsx). The WinUI view itself
/// (feature-views\InfoTile\InfoTile.cs) is exercised by the app build.
/// </summary>
public sealed class InfoTileTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private const string DefaultColorKey = "TsColorTextPrimaryBrush";
    private const string InfoGlyph = "\uE946";

    private static InfoTileModel Model(
        string iconGlyph = "\uE9D9",
        string label = "Speed",
        InfoTileValue? value = null,
        string? colorBrushKey = null,
        string? sub = null) =>
        new(iconGlyph, label, value ?? InfoTileValue.FromText("42 mph"), colorBrushKey, sub);

    private static InfoTileDisplay Project(InfoTileModel model) => InfoTileProjection.Project(model, Localizer);

    // ── Value union → display string (web `typeof value === 'boolean' ? (value ? 'Yes':'No') : value`) ──

    [Fact]
    public void Text_value_renders_verbatim()
    {
        Assert.Equal("42 mph", Project(Model(value: InfoTileValue.FromText("42 mph"))).Value);
    }

    [Fact]
    public void Null_text_value_renders_as_empty()
    {
        Assert.Equal(string.Empty, Project(Model(value: InfoTileValue.FromText(null))).Value);
    }

    [Fact]
    public void Boolean_true_resolves_to_the_localized_yes_word()
    {
        Assert.Equal("Yes", Project(Model(value: InfoTileValue.FromBoolean(true))).Value);
    }

    [Fact]
    public void Boolean_false_resolves_to_the_localized_no_word()
    {
        Assert.Equal("No", Project(Model(value: InfoTileValue.FromBoolean(false))).Value);
    }

    [Fact]
    public void Boolean_true_resolves_through_the_common_yes_key()
    {
        var echo = new KeyEchoLocalizer();

        string resolved = InfoTileProjection.ResolveValue(InfoTileValue.FromBoolean(true), echo);

        Assert.Equal("[common.yes]", resolved);
        Assert.Contains(("common.yes", "Yes"), echo.Calls);
    }

    [Fact]
    public void Boolean_false_resolves_through_the_common_no_key()
    {
        var echo = new KeyEchoLocalizer();

        string resolved = InfoTileProjection.ResolveValue(InfoTileValue.FromBoolean(false), echo);

        Assert.Equal("[common.no]", resolved);
        Assert.Contains(("common.no", "No"), echo.Calls);
    }

    [Fact]
    public void Text_and_number_values_inject_no_localized_strings()
    {
        // Only the boolean shape touches the i18n facade — text / number render with no GetString call, so the
        // tile contributes no hardcoded English of its own for those shapes.
        var echo = new KeyEchoLocalizer();

        InfoTileProjection.ResolveValue(InfoTileValue.FromText("hi"), echo);
        InfoTileProjection.ResolveValue(InfoTileValue.FromNumber(5), echo);

        Assert.Empty(echo.Calls);
    }

    // ── Number formatting (web React `String(value)` — ungrouped, NOT Intl.NumberFormat) ─────────────────

    [Theory]
    [InlineData(42, "42")]
    [InlineData(0, "0")]
    [InlineData(100, "100")]
    [InlineData(42.5, "42.5")]
    [InlineData(3.14, "3.14")]
    [InlineData(0.5, "0.5")]
    [InlineData(-5, "-5")]
    [InlineData(-12.75, "-12.75")]
    [InlineData(1234567, "1234567")] // React renders the raw number — NO thousands grouping
    public void FormatNumber_matches_the_react_string_form(double value, string expected)
    {
        Assert.Equal(expected, InfoTileProjection.FormatNumber(value));
        Assert.Equal(expected, Project(Model(value: InfoTileValue.FromNumber(value))).Value);
    }

    [Fact]
    public void FormatNumber_collapses_signed_zero_like_string_of_negative_zero()
    {
        Assert.Equal("0", InfoTileProjection.FormatNumber(-0.0));
    }

    [Theory]
    [InlineData(double.NaN, "NaN")]
    [InlineData(double.PositiveInfinity, "Infinity")]
    [InlineData(double.NegativeInfinity, "-Infinity")]
    public void FormatNumber_uses_the_javascript_non_finite_tokens(double value, string expected)
    {
        Assert.Equal(expected, InfoTileProjection.FormatNumber(value));
    }

    // ── Value tooltip (web `title={String(display)}`) ────────────────────────────────────────────────────

    [Fact]
    public void Value_tooltip_is_the_rendered_value()
    {
        var d = Project(Model(value: InfoTileValue.FromNumber(88)));

        Assert.Equal("88", d.Value);
        Assert.Equal("88", d.ValueTooltip);
    }

    [Fact]
    public void Boolean_value_tooltip_is_the_resolved_word()
    {
        var d = Project(Model(value: InfoTileValue.FromBoolean(true)));

        Assert.Equal("Yes", d.ValueTooltip);
    }

    // ── Sub line (web `sub && <p>…</p>`) ─────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Sub_is_hidden_when_absent(string? sub)
    {
        var d = Project(Model(sub: sub));

        Assert.False(d.ShowSub);
        Assert.Equal(string.Empty, d.Sub);
    }

    [Fact]
    public void Sub_is_shown_when_present_and_passes_through_verbatim()
    {
        var d = Project(Model(sub: "since last charge"));

        Assert.True(d.ShowSub);
        Assert.Equal("since last charge", d.Sub);
    }

    // ── Value colour token (web `color ?? 'text-[var(--text-primary)]'`) ─────────────────────────────────

    [Fact]
    public void Color_defaults_to_the_primary_text_token()
    {
        Assert.Equal(DefaultColorKey, Project(Model(colorBrushKey: null)).ColorBrushKey);
        Assert.Equal(DefaultColorKey, Project(Model(colorBrushKey: string.Empty)).ColorBrushKey);
    }

    [Fact]
    public void Color_override_passes_through()
    {
        Assert.Equal("TsColorSuccessBrush", Project(Model(colorBrushKey: "TsColorSuccessBrush")).ColorBrushKey);
    }

    // ── Leading icon (web `icon`; native glyph with a neutral fallback) ──────────────────────────────────

    [Fact]
    public void Icon_glyph_passes_through()
    {
        Assert.Equal("\uE9D9", Project(Model(iconGlyph: "\uE9D9")).IconGlyph);
    }

    [Fact]
    public void Icon_glyph_falls_back_when_empty()
    {
        Assert.Equal(InfoGlyph, Project(Model(iconGlyph: string.Empty)).IconGlyph);
    }

    // ── Accessibility (Narrator name) ────────────────────────────────────────────────────────────────────

    [Fact]
    public void AutomationName_composes_label_and_value()
    {
        Assert.Equal("Speed: 42 mph", Project(Model(label: "Speed", value: InfoTileValue.FromText("42 mph"))).AutomationName);
    }

    [Fact]
    public void AutomationName_is_the_value_alone_when_unlabeled()
    {
        Assert.Equal("42 mph", Project(Model(label: string.Empty, value: InfoTileValue.FromText("42 mph"))).AutomationName);
    }

    [Fact]
    public void AutomationName_is_the_label_alone_when_value_is_empty()
    {
        Assert.Equal("Speed", Project(Model(label: "Speed", value: InfoTileValue.FromText(string.Empty))).AutomationName);
    }

    [Fact]
    public void AutomationName_appends_the_sub_line()
    {
        var d = Project(Model(label: "Range", value: InfoTileValue.FromNumber(245), sub: "EPA"));

        Assert.Equal("Range: 245, EPA", d.AutomationName);
    }

    // ── i18n: text / number values pass through verbatim (no hardcoded English) ──────────────────────────

    [Fact]
    public void Projection_passes_a_non_english_label_and_text_value_through_verbatim()
    {
        const string label = "速度";  // the parent already localized the caption
        const string value = "オン";   // a parent-supplied localized text value

        var d = Project(Model(label: label, value: InfoTileValue.FromText(value)));

        Assert.Equal(label, d.Label);
        Assert.Equal(value, d.Value);
        Assert.Equal($"{label}: {value}", d.AutomationName);
    }

    // ── Per-state "snapshots": every shape renders a complete, distinct display ──────────────────────────

    [Fact]
    public void Text_value_with_sub_and_color_renders_a_complete_display()
    {
        var d = Project(Model(
            iconGlyph: "\uE9D9",
            label: "Odometer",
            value: InfoTileValue.FromText("12,345 mi"),
            colorBrushKey: "TsColorSuccessBrush",
            sub: "lifetime"));

        Assert.Equal("Odometer", d.Label);
        Assert.Equal("\uE9D9", d.IconGlyph);
        Assert.Equal("12,345 mi", d.Value);
        Assert.Equal("12,345 mi", d.ValueTooltip);
        Assert.Equal("TsColorSuccessBrush", d.ColorBrushKey);
        Assert.True(d.ShowSub);
        Assert.Equal("lifetime", d.Sub);
        Assert.Equal("Odometer: 12,345 mi, lifetime", d.AutomationName);
    }

    [Fact]
    public void Number_value_renders_a_complete_display()
    {
        var d = Project(Model(label: "Cycles", value: InfoTileValue.FromNumber(1024), colorBrushKey: null, sub: null));

        Assert.Equal("1024", d.Value);
        Assert.Equal("1024", d.ValueTooltip);
        Assert.Equal(DefaultColorKey, d.ColorBrushKey);
        Assert.False(d.ShowSub);
        Assert.Equal(string.Empty, d.Sub);
        Assert.Equal("Cycles: 1024", d.AutomationName);
    }

    [Fact]
    public void Boolean_value_renders_a_complete_display()
    {
        var d = Project(Model(label: "Sentry", value: InfoTileValue.FromBoolean(true)));

        Assert.Equal("Yes", d.Value);
        Assert.Equal("Yes", d.ValueTooltip);
        Assert.Equal(DefaultColorKey, d.ColorBrushKey);
        Assert.False(d.ShowSub);
        Assert.Equal("Sentry: Yes", d.AutomationName);
    }

    // ── Value union factories ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void FromText_carries_the_text_shape()
    {
        var v = InfoTileValue.FromText("hello");

        Assert.Equal(InfoTileValueKind.Text, v.Kind);
        Assert.Equal("hello", v.TextValue);
    }

    [Fact]
    public void FromText_normalizes_null_to_empty()
    {
        Assert.Equal(string.Empty, InfoTileValue.FromText(null).TextValue);
    }

    [Fact]
    public void FromNumber_carries_the_number_shape()
    {
        var v = InfoTileValue.FromNumber(3.5);

        Assert.Equal(InfoTileValueKind.Number, v.Kind);
        Assert.Equal(3.5, v.NumberValue);
    }

    [Fact]
    public void FromBoolean_carries_the_boolean_shape()
    {
        var v = InfoTileValue.FromBoolean(true);

        Assert.Equal(InfoTileValueKind.Boolean, v.Kind);
        Assert.True(v.BooleanValue);
    }

    [Fact]
    public void Default_value_is_an_empty_text_value()
    {
        InfoTileValue v = default;

        Assert.Equal(InfoTileValueKind.Text, v.Kind);
        Assert.Equal(string.Empty, InfoTileProjection.ResolveValue(v, Localizer));
    }

    [Fact]
    public void Value_has_structural_equality()
    {
        Assert.Equal(InfoTileValue.FromNumber(7), InfoTileValue.FromNumber(7));
        Assert.NotEqual(InfoTileValue.FromNumber(7), InfoTileValue.FromText("7"));
    }

    // ── Model defaults ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Empty_model_is_an_unlabeled_empty_tile()
    {
        Assert.Equal(InfoTileRegistration.DefaultIconGlyph, InfoTileModel.Empty.IconGlyph);
        Assert.Equal(string.Empty, InfoTileModel.Empty.Label);
        Assert.Null(InfoTileModel.Empty.ColorBrushKey);
        Assert.Null(InfoTileModel.Empty.Sub);

        var d = InfoTileProjection.Project(InfoTileModel.Empty, Localizer);
        Assert.Equal(string.Empty, d.Value);
        Assert.Equal(InfoGlyph, d.IconGlyph);
        Assert.Equal(DefaultColorKey, d.ColorBrushKey);
        Assert.False(d.ShowSub);
        Assert.Equal(string.Empty, d.AutomationName);
    }

    // ── Null guards ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => InfoTileProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => InfoTileProjection.Project(Model(), null!));

    [Fact]
    public void ResolveValue_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => InfoTileProjection.ResolveValue(InfoTileValue.FromText("x"), null!));

    // ── Diagnostics (P1/S11): view.opened slug=InfoTile, PII-safe ────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new InfoTileDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=InfoTile", captured[0]);
        Assert.Equal("view.opened slug=InfoTile", captured[1]);
    }

    [Fact]
    public void Diagnostics_leaks_no_label_or_value()
    {
        var captured = new List<string>();
        var diagnostics = new InfoTileDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        // The only datum on the line is the static surface slug — never a label, value or sublabel.
        Assert.All(captured, line => Assert.Equal("view.opened slug=InfoTile", line));
    }

    // ── Registration metadata ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_slug_glyph_color_and_i18n_keys()
    {
        Assert.Equal("InfoTile", InfoTileRegistration.Slug);
        Assert.Equal(InfoGlyph, InfoTileRegistration.DefaultIconGlyph);
        Assert.Equal(DefaultColorKey, InfoTileRegistration.DefaultColorBrushKey);
        Assert.Equal("common.yes", InfoTileRegistration.YesKey);
        Assert.Equal("Yes", InfoTileRegistration.YesFallback);
        Assert.Equal("common.no", InfoTileRegistration.NoKey);
        Assert.Equal("No", InfoTileRegistration.NoFallback);
    }

    /// <summary>An <see cref="ILocalizer"/> that echoes the requested key (wrapped) and records every call,
    /// so a test can assert which keys the projection resolves.</summary>
    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public List<(string Key, string Fallback)> Calls { get; } = new();

        public string GetString(string key, string fallback)
        {
            Calls.Add((key, fallback));
            return $"[{key}]";
        }
    }
}
