using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the ToolCard surface's UI-thread-free logic — the accent
/// token resolver (web <c>ICON_COLOR_MAP[color] ?? cyan</c>), the render-model
/// projection (title/description trimming, glyph default, per-state visibility flags,
/// Narrator name) and the PII-safe <c>view.opened</c> diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/devtools/ToolCard.tsx). ToolCard is a pure
/// presentational primitive: the web source has no data source and no
/// loading/error/stale/offline branches, so the reproduced content states are
/// populated-content and empty-content — both keep the header rendered (never a blank
/// box). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class ToolCardTests
{
    // ---- Accent resolver (web ICON_COLOR_MAP[color] ?? cyan) ------------------------

    [Theory]
    [InlineData("cyan", "TsColorAccentBrush")]
    [InlineData("green", "TsColorSuccessBrush")]
    [InlineData("purple", "TsChartPowerBrush")]
    [InlineData("amber", "TsColorWarningBrush")]
    [InlineData("red", "TsColorDangerBrush")]
    public void Accent_brushKey_maps_each_known_color(string color, string expected) =>
        Assert.Equal(expected, ToolCardAccent.BrushKey(color));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("teal")]
    [InlineData("not-a-color")]
    public void Accent_brushKey_falls_back_to_cyan_for_unknown(string? color)
    {
        Assert.Equal("TsColorAccentBrush", ToolCardAccent.BrushKey(color));
        Assert.Equal("cyan", ToolCardAccent.Resolve(color));
    }

    [Theory]
    [InlineData("CYAN", "cyan")]
    [InlineData("  Green  ", "green")]
    [InlineData("Purple", "purple")]
    public void Accent_resolve_is_case_and_whitespace_insensitive(string color, string expected) =>
        Assert.Equal(expected, ToolCardAccent.Resolve(color));

    [Fact]
    public void Accent_knownColors_match_web_map_order_and_membership()
    {
        Assert.Equal(new[] { "cyan", "green", "purple", "amber", "red" }, ToolCardAccent.KnownColors);
        Assert.All(ToolCardAccent.KnownColors, c => Assert.True(ToolCardAccent.IsKnown(c)));
        Assert.False(ToolCardAccent.IsKnown("magenta"));
    }

    // ---- Render-model projection (adapter: inputs -> render model) ------------------

    [Fact]
    public void Model_trims_title_and_description_and_resolves_accent()
    {
        var model = ToolCardModel.Create("  API Explorer  ", "  Call any endpoint  ", "\uE774", "green");

        Assert.Equal("API Explorer", model.Title);
        Assert.Equal("Call any endpoint", model.Description);
        Assert.True(model.HasTitle);
        Assert.True(model.HasDescription);
        Assert.Equal("\uE774", model.IconGlyph);
        Assert.Equal("green", model.AccentColor);
        Assert.Equal("TsColorSuccessBrush", model.AccentBrushKey);
    }

    [Fact]
    public void Model_uses_default_glyph_when_none_supplied()
    {
        Assert.Equal(ToolCardModel.DefaultGlyph, ToolCardModel.Create("VIN Decoder", "x", null, "cyan").IconGlyph);
        Assert.Equal(ToolCardModel.DefaultGlyph, ToolCardModel.Create("VIN Decoder", "x", "", "cyan").IconGlyph);
    }

    // ---- Content states (web has no data states; these are the real branches) -------

    [Fact]
    public void Model_populated_state_shows_title_and_description()
    {
        var model = ToolCardModel.Create("Webhooks", "Inspect delivery attempts", "\uE774", "amber");

        Assert.True(model.HasTitle);
        Assert.True(model.HasDescription);
    }

    [Fact]
    public void Model_empty_description_collapses_but_header_still_renders()
    {
        var model = ToolCardModel.Create("Webhooks", "   ", "\uE774", "amber");

        Assert.True(model.HasTitle);          // header (icon + title) always present -> never a blank box
        Assert.False(model.HasDescription);   // empty description collapses, matching the web slot
        Assert.Equal(string.Empty, model.Description);
    }

    [Fact]
    public void Model_unknown_accent_falls_back_to_cyan()
    {
        var model = ToolCardModel.Create("X", "y", "\uE774", "chartreuse");

        Assert.Equal("cyan", model.AccentColor);
        Assert.Equal("TsColorAccentBrush", model.AccentBrushKey);
    }

    // ---- Accessibility name composition --------------------------------------------

    [Fact]
    public void Model_accessibilityName_joins_title_and_description() =>
        Assert.Equal(
            "API Explorer. Call any endpoint",
            ToolCardModel.Create("API Explorer", "Call any endpoint", null, "cyan").AccessibilityName);

    [Fact]
    public void Model_accessibilityName_uses_single_field_when_other_is_empty()
    {
        Assert.Equal("Only Title", ToolCardModel.Create("Only Title", "", null, "cyan").AccessibilityName);
        Assert.Equal("Only Desc", ToolCardModel.Create("", "Only Desc", null, "cyan").AccessibilityName);
        Assert.Equal(string.Empty, ToolCardModel.Create("", "", null, "cyan").AccessibilityName);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ToolCardDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ToolCard", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_each_open_and_tolerates_a_null_sink()
    {
        var diagnostics = new ToolCardDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal("ToolCard", ToolCardDiagnostics.Slug);
    }
}
