using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.WidgetPrimitives;
using Xunit;

namespace TeslaSync.App.Tests.WidgetPrimitives;

/// <summary>
/// Headless verification of the <c>WidgetTipCards</c> primitive's UI-thread-free logic — the visible-cap
/// resolution (<c>maxTips ?? (compact ? 1 : 3)</c>), the slice/projection adapter, the impact → badge
/// tint + label mapping (the web <c>impactBadgeMap</c>), the empty-state branch (web
/// <c>visible.length === 0</c>), the per-card Narrator automation name, and the PII-safe
/// <c>view.opened</c> diagnostics. Mirrors the web spec
/// (web/src/features/dashboard/widgets/shared/WidgetTipCards.tsx); the WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class WidgetTipCardsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static TipItem Tip(
        string id = "1",
        string title = "Title",
        string description = "Description",
        TipImpact? impact = null,
        string? impactLabel = null,
        string? glyph = null) =>
        new(id, title, description, impact, impactLabel, glyph);

    private static IReadOnlyList<TipItem> Many(int count)
    {
        var list = new List<TipItem>(count);
        for (int i = 1; i <= count; i++)
        {
            string n = i.ToString(CultureInfo.InvariantCulture);
            list.Add(Tip(id: n, title: "T" + n, description: "D" + n));
        }

        return list;
    }

    // ---- Visible-cap resolution (web `limit = maxTips ?? (compact ? 1 : 3)`) -------------------

    [Theory]
    [InlineData(null, false, 3)]
    [InlineData(null, true, 1)]
    [InlineData(5, false, 5)]
    [InlineData(2, true, 2)]
    [InlineData(0, false, 0)]
    public void ResolveLimit_matches_web_default(int? maxTips, bool compact, int expected) =>
        Assert.Equal(expected, WidgetTipCardsProjection.ResolveLimit(maxTips, compact));

    [Fact]
    public void Project_caps_standard_layout_to_three()
    {
        var display = WidgetTipCardsProjection.Project(Many(10), Localizer);

        Assert.False(display.IsEmpty);
        Assert.Equal(3, display.Cards.Count);
        Assert.Equal(new[] { "1", "2", "3" }, display.Cards.Select(c => c.Id).ToArray());
    }

    [Fact]
    public void Project_caps_compact_layout_to_one()
    {
        var display = WidgetTipCardsProjection.Project(Many(10), Localizer, compact: true);

        Assert.Single(display.Cards);
        Assert.Equal("1", display.Cards[0].Id);
        Assert.True(display.Cards[0].Compact);
    }

    [Fact]
    public void Project_honours_explicit_maxTips_over_compact_default()
    {
        var display = WidgetTipCardsProjection.Project(Many(10), Localizer, maxTips: 2, compact: true);

        Assert.Equal(2, display.Cards.Count);
    }

    [Fact]
    public void Project_returns_all_when_fewer_than_limit()
    {
        var display = WidgetTipCardsProjection.Project(Many(2), Localizer);

        Assert.Equal(2, display.Cards.Count);
    }

    // ---- Empty-state branch (web `visible.length === 0`) --------------------------------------

    [Fact]
    public void Project_is_empty_for_no_tips_and_uses_localized_default()
    {
        var display = WidgetTipCardsProjection.Project(Array.Empty<TipItem>(), Localizer);

        Assert.True(display.IsEmpty);
        Assert.Empty(display.Cards);
        Assert.Equal(WidgetTipCardsProjection.EmptyMessageFallback, display.EmptyMessage);
    }

    [Fact]
    public void Project_is_empty_for_null_tips()
    {
        var display = WidgetTipCardsProjection.Project(null, Localizer);

        Assert.True(display.IsEmpty);
        Assert.Empty(display.Cards);
    }

    [Fact]
    public void Project_is_empty_when_maxTips_is_zero()
    {
        var display = WidgetTipCardsProjection.Project(Many(5), Localizer, maxTips: 0);

        Assert.True(display.IsEmpty);
        Assert.Empty(display.Cards);
    }

    [Fact]
    public void Project_empty_message_override_wins_over_localized_default()
    {
        var display = WidgetTipCardsProjection.Project(
            Array.Empty<TipItem>(), Localizer, emptyMessage: "Nothing to coach");

        Assert.Equal("Nothing to coach", display.EmptyMessage);
    }

    [Fact]
    public void Project_resolves_empty_message_through_localizer_key()
    {
        var localizer = new KeyEchoLocalizer();

        var display = WidgetTipCardsProjection.Project(Array.Empty<TipItem>(), localizer);

        Assert.Equal("[widget.tipCards.empty]", display.EmptyMessage);
        Assert.Contains("widget.tipCards.empty", localizer.Keys);
    }

    // ---- Impact mapping (web `impactBadgeMap`) ------------------------------------------------

    [Theory]
    [InlineData(TipImpact.High, StatusKind.Success)]
    [InlineData(TipImpact.Medium, StatusKind.Warning)]
    [InlineData(TipImpact.Low, StatusKind.Neutral)]
    public void ImpactStatus_matches_web_impactBadgeMap(TipImpact impact, StatusKind expected) =>
        Assert.Equal(expected, WidgetTipCardsProjection.ImpactStatus(impact));

    [Theory]
    [InlineData(TipImpact.High, "high")]
    [InlineData(TipImpact.Medium, "medium")]
    [InlineData(TipImpact.Low, "low")]
    public void ImpactToken_is_lower_case_wire_token(TipImpact impact, string expected) =>
        Assert.Equal(expected, WidgetTipCardsProjection.ImpactToken(impact));

    [Fact]
    public void Project_card_without_impact_has_no_chip()
    {
        var display = WidgetTipCardsProjection.Project(new[] { Tip(impact: null) }, Localizer);

        var card = Assert.Single(display.Cards);
        Assert.False(card.HasImpact);
        Assert.Equal(string.Empty, card.ImpactLabel);
        Assert.Equal(StatusKind.Neutral, card.ImpactStatus);
    }

    [Fact]
    public void Project_card_with_impact_resolves_label_via_localizer_token()
    {
        var localizer = new KeyEchoLocalizer();

        var display = WidgetTipCardsProjection.Project(new[] { Tip(impact: TipImpact.High) }, localizer);

        var card = Assert.Single(display.Cards);
        Assert.True(card.HasImpact);
        Assert.Equal(StatusKind.Success, card.ImpactStatus);
        Assert.Equal("[widget.tipCards.impact.high]", card.ImpactLabel);
    }

    [Fact]
    public void Project_card_impact_label_override_wins()
    {
        var display = WidgetTipCardsProjection.Project(
            new[] { Tip(impact: TipImpact.Medium, impactLabel: "Save 12%") }, Localizer);

        var card = Assert.Single(display.Cards);
        Assert.Equal("Save 12%", card.ImpactLabel);
        Assert.Equal(StatusKind.Warning, card.ImpactStatus);
    }

    // ---- Field passthrough --------------------------------------------------------------------

    [Fact]
    public void Project_passes_through_glyph_title_description_and_compact()
    {
        var display = WidgetTipCardsProjection.Project(
            new[] { Tip(title: "Lift off throttle", description: "Coast more", glyph: "\uE945") },
            Localizer,
            compact: true);

        var card = Assert.Single(display.Cards);
        Assert.Equal("\uE945", card.Glyph);
        Assert.Equal("Lift off throttle", card.Title);
        Assert.Equal("Coast more", card.Description);
        Assert.True(card.Compact);
    }

    // ---- Accessibility / Narrator names -------------------------------------------------------

    [Fact]
    public void Project_card_automation_name_includes_impact_title_and_description()
    {
        var display = WidgetTipCardsProjection.Project(
            new[] { Tip(title: "Slow down", description: "You braked hard", impact: TipImpact.High, impactLabel: "High") },
            Localizer);

        var card = Assert.Single(display.Cards);
        Assert.Equal("High: Slow down. You braked hard", card.AutomationName);
    }

    [Fact]
    public void Project_card_automation_name_without_impact_is_title_and_description()
    {
        var display = WidgetTipCardsProjection.Project(
            new[] { Tip(title: "Slow down", description: "You braked hard") },
            Localizer);

        var card = Assert.Single(display.Cards);
        Assert.Equal("Slow down. You braked hard", card.AutomationName);
    }

    [Fact]
    public void Project_card_automation_name_omits_empty_description()
    {
        var display = WidgetTipCardsProjection.Project(
            new[] { Tip(title: "Slow down", description: string.Empty) },
            Localizer);

        var card = Assert.Single(display.Cards);
        Assert.Equal("Slow down", card.AutomationName);
    }

    // ---- Diagnostics (P1/S11 `view.opened`) ---------------------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_surface_slug()
    {
        var events = new List<string>();
        var diagnostics = new WidgetTipCardsDiagnostics(events.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WidgetTipCards", Assert.Single(events));
    }

    [Fact]
    public void Diagnostics_slug_constant_is_surface_name()
    {
        Assert.Equal("WidgetTipCards", WidgetTipCardsProjection.Slug);
    }

    [Fact]
    public void Diagnostics_does_not_throw_without_a_sink()
    {
        var diagnostics = new WidgetTipCardsDiagnostics();

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return "[" + key + "]";
        }
    }
}
