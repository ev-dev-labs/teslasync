using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.BatteryDeltaSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>BatteryDelta</c> shared surface's UI-thread-free logic — the
/// <c>hasData</c> guard, the signed-delta / sign / magnitude derivation, the emerald-rise / amber-drop / muted
/// tone selection and its token brush mapping, the compact and pair label formatting (including the U+2212
/// minus sign, the U+2014 em dash and the U+2192 pair arrow, and the raw <c>${n}</c> number stringification),
/// the interpolated <c>battery.delta.aria</c> accessible name, the no-data <c>battery.delta.unknown</c> name,
/// the icon / variant passthrough, the registration metadata and the PII-safe diagnostics. Mirrors the web spec
/// one-for-one (<c>web/src/components/data-display/BatteryDelta.tsx</c>). The WinUI view itself
/// (BatteryDelta.cs) is exercised by the app build.
/// </summary>
public sealed class BatteryDeltaTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static BatteryDeltaDisplay Project(BatteryDeltaModel model) =>
        BatteryDeltaProjection.Project(model, Localizer);

    // ── registration (diagnostics slug + battery glyph) ──────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("BatteryDelta", BatteryDeltaRegistration.Slug);

    [Fact]
    public void Registration_uses_the_shared_battery_glyph() =>
        Assert.Equal("\uE83F", BatteryDeltaRegistration.BatteryGlyph);

    // ── no-data branch (web !hasData → muted em dash + 'battery.delta.unknown') ──────────────────────────

    [Fact]
    public void Both_missing_renders_the_unknown_dash()
    {
        BatteryDeltaDisplay d = Project(BatteryDeltaModel.Unknown);

        Assert.False(d.HasData);
        Assert.Equal("\u2014", d.VisibleText);
        Assert.Equal(BatteryDeltaTone.Neutral, d.Tone);
        Assert.Equal("TsColorTextMutedBrush", d.AccentBrushKey);
        Assert.Equal("Battery delta unknown", d.AutomationName);
    }

    [Fact]
    public void Missing_start_only_renders_the_unknown_dash()
    {
        BatteryDeltaDisplay d = Project(new BatteryDeltaModel(null, 80));

        Assert.False(d.HasData);
        Assert.Equal("\u2014", d.VisibleText);
        Assert.Equal("Battery delta unknown", d.AutomationName);
    }

    [Fact]
    public void Missing_end_only_renders_the_unknown_dash()
    {
        BatteryDeltaDisplay d = Project(new BatteryDeltaModel(80, null));

        Assert.False(d.HasData);
        Assert.Equal("\u2014", d.VisibleText);
    }

    [Theory]
    [InlineData(double.NaN, 80)]
    [InlineData(80, double.NaN)]
    [InlineData(double.PositiveInfinity, 80)]
    [InlineData(80, double.NegativeInfinity)]
    public void Non_finite_endpoints_render_the_unknown_dash(double start, double end)
    {
        BatteryDeltaDisplay d = Project(new BatteryDeltaModel(start, end));

        Assert.False(d.HasData);
        Assert.Equal("\u2014", d.VisibleText);
        Assert.Equal(BatteryDeltaTone.Neutral, d.Tone);
    }

    // ── data branch: compact label, sign, magnitude, tone ────────────────────────────────────────────────

    [Fact]
    public void Negative_delta_is_amber_with_a_minus_sign()
    {
        // web example: start=79 end=78 → "−1%" amber.
        BatteryDeltaDisplay d = Project(BatteryDeltaModel.Compact(79, 78));

        Assert.True(d.HasData);
        Assert.Equal("\u22121%", d.VisibleText);
        Assert.Equal(BatteryDeltaTone.Negative, d.Tone);
        Assert.Equal("TsColorWarningBrush", d.AccentBrushKey);
    }

    [Fact]
    public void Positive_delta_is_emerald_with_a_plus_sign()
    {
        // web example: start=20 end=80 → "+60%" emerald.
        BatteryDeltaDisplay d = Project(BatteryDeltaModel.Compact(20, 80));

        Assert.True(d.HasData);
        Assert.Equal("+60%", d.VisibleText);
        Assert.Equal(BatteryDeltaTone.Positive, d.Tone);
        Assert.Equal("TsColorSuccessBrush", d.AccentBrushKey);
    }

    [Fact]
    public void Zero_delta_is_muted_dash_but_keeps_a_descriptive_aria()
    {
        // web example: start=80 end=80 → "—" muted, but aria still describes the pair.
        BatteryDeltaDisplay d = Project(BatteryDeltaModel.Compact(80, 80));

        Assert.True(d.HasData);
        Assert.Equal("\u2014", d.VisibleText);
        Assert.Equal(BatteryDeltaTone.Neutral, d.Tone);
        Assert.Equal("TsColorTextMutedBrush", d.AccentBrushKey);
        Assert.Equal("Battery 80% to 80%", d.AutomationName);
    }

    [Fact]
    public void Compact_minus_sign_is_the_unicode_minus_not_a_hyphen()
    {
        BatteryDeltaDisplay d = Project(BatteryDeltaModel.Compact(50, 40));

        Assert.StartsWith("\u2212", d.VisibleText, System.StringComparison.Ordinal);
        Assert.DoesNotContain("-", d.VisibleText, System.StringComparison.Ordinal); // not the ASCII hyphen
        Assert.Equal("\u221210%", d.VisibleText);
    }

    [Fact]
    public void Magnitude_is_absolute_and_fractional_values_are_preserved()
    {
        Assert.Equal("+1.5%", Project(BatteryDeltaModel.Compact(10.5, 12)).VisibleText);
        Assert.Equal("\u22121.5%", Project(BatteryDeltaModel.Compact(12, 10.5)).VisibleText);
    }

    [Fact]
    public void Integers_render_without_a_decimal_point()
    {
        // Web embeds the raw number (${n}); 60 must stay "60", never "60.0".
        Assert.Equal("+60%", Project(BatteryDeltaModel.Compact(20, 80)).VisibleText);
    }

    // ── data branch: pair variant ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Pair_variant_renders_start_arrow_end()
    {
        BatteryDeltaDisplay d = Project(BatteryDeltaModel.Pair(79, 78));

        Assert.Equal("79% \u2192 78%", d.VisibleText);
        Assert.True(d.HasData);
    }

    [Fact]
    public void Pair_variant_keeps_the_signed_tone_even_though_the_text_is_unsigned()
    {
        // The pair text shows both endpoints, but the colour still tracks the direction of the change.
        Assert.Equal(BatteryDeltaTone.Negative, Project(BatteryDeltaModel.Pair(79, 78)).Tone);
        Assert.Equal(BatteryDeltaTone.Positive, Project(BatteryDeltaModel.Pair(20, 80)).Tone);
        Assert.Equal(BatteryDeltaTone.Neutral, Project(BatteryDeltaModel.Pair(80, 80)).Tone);
    }

    [Fact]
    public void Pair_arrow_is_the_unicode_rightwards_arrow_with_surrounding_spaces() =>
        Assert.Equal(" \u2192 ", BatteryDeltaProjection.PairArrow);

    // ── accessibility: aria-label always present, interpolated from the endpoints ────────────────────────

    [Fact]
    public void Data_branch_aria_interpolates_both_endpoints()
    {
        BatteryDeltaDisplay d = Project(BatteryDeltaModel.Compact(20, 80));

        Assert.Equal("Battery 20% to 80%", d.AutomationName);
        Assert.DoesNotContain("{{", d.AutomationName, System.StringComparison.Ordinal);
        Assert.DoesNotContain("}}", d.AutomationName, System.StringComparison.Ordinal);
    }

    [Fact]
    public void Aria_is_non_empty_in_every_branch()
    {
        Assert.False(string.IsNullOrWhiteSpace(Project(BatteryDeltaModel.Unknown).AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(Project(BatteryDeltaModel.Compact(20, 80)).AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(Project(BatteryDeltaModel.Pair(20, 80)).AutomationName));
    }

    // ── icon / variant passthrough ───────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Show_icon_flag_is_passed_through(bool showIcon)
    {
        Assert.Equal(showIcon, Project(BatteryDeltaModel.Compact(20, 80, showIcon)).ShowIcon);
        Assert.Equal(showIcon, Project(new BatteryDeltaModel(null, null, showIcon)).ShowIcon);
    }

    [Fact]
    public void Display_carries_the_battery_glyph_in_both_branches()
    {
        Assert.Equal("\uE83F", Project(BatteryDeltaModel.Unknown).IconGlyph);
        Assert.Equal("\uE83F", Project(BatteryDeltaModel.Compact(20, 80)).IconGlyph);
    }

    [Fact]
    public void Default_variant_is_compact()
    {
        // The default constructor variant must match the web default ('compact').
        BatteryDeltaModel model = BatteryDeltaModel.Compact(20, 80);

        Assert.Equal(BatteryDeltaVariant.Compact, model.Variant);
        Assert.Equal("+60%", Project(model).VisibleText);
    }

    // ── tone → brush mapping (the surface-specific convention: drop is amber, never red) ─────────────────

    [Theory]
    [InlineData(BatteryDeltaTone.Positive, "TsColorSuccessBrush")]
    [InlineData(BatteryDeltaTone.Negative, "TsColorWarningBrush")]
    [InlineData(BatteryDeltaTone.Neutral, "TsColorTextMutedBrush")]
    public void Accent_brush_key_maps_each_tone(BatteryDeltaTone tone, string expectedKey) =>
        Assert.Equal(expectedKey, BatteryDeltaProjection.AccentBrushKey(tone));

    [Theory]
    [InlineData(5, BatteryDeltaTone.Positive)]
    [InlineData(-5, BatteryDeltaTone.Negative)]
    [InlineData(0, BatteryDeltaTone.Neutral)]
    public void Tone_for_tracks_the_sign_of_the_delta(double delta, BatteryDeltaTone expected) =>
        Assert.Equal(expected, BatteryDeltaProjection.ToneFor(delta));

    // ── diagnostics (view.opened, PII-safe — never the state-of-charge values) ───────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new BatteryDeltaDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryDelta", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new BatteryDeltaDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<System.ArgumentNullException>(() => BatteryDeltaProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(() => BatteryDeltaProjection.Project(BatteryDeltaModel.Unknown, null!));
}
