using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SummaryHeroCards</c> feature surface's UI-thread-free logic — the loading-vs-ready
/// branch projection, the five always-present tiles plus the optional fun-fact tile, the web <c>trendFor</c> change
/// (flat "0%", signed percentage and the <c>invertPositive</c> desirability flip for the energy / cost metrics),
/// the <c>fmtNumber</c> / <c>fmtInt</c> / <c>formatCurrency</c> readouts, the Segoe Fluent glyph + web-colour
/// mapping, the localized copy resolved through the exact web keys, the composed Narrator names and the PII-safe
/// diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/weekly-digest/SummaryHeroCards.tsx). The WinUI view itself
/// (feature-views\SummaryHeroCards.cs) is exercised by the app build.
/// </summary>
public sealed class SummaryHeroCardsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static SummaryHeroMetrics Metrics(
        double totalDistance = 120,
        double prevDistance = 100,
        long totalDrives = 42,
        long prevDriveCount = 40,
        double energyUsed = 50,
        double prevEnergy = 60,
        double chargingCost = 10,
        double prevChargingCost = 8,
        double co2Saved = 21,
        double prevCo2 = 20) =>
        new(totalDistance, prevDistance, totalDrives, prevDriveCount, energyUsed, prevEnergy,
            chargingCost, prevChargingCost, co2Saved, prevCo2);

    private static readonly SummaryHeroFunFact FunFact = new("Paris", "London", "2.5");

    private static SummaryHeroCardsDisplay Project(
        SummaryHeroMetrics? metrics = null,
        SummaryHeroFunFact? funFact = null,
        SummaryHeroFormatting? formatting = null,
        ILocalizer? localizer = null) =>
        SummaryHeroCardsProjection.Project(
            SummaryHeroCardsModel.ForMetrics(metrics ?? Metrics(), funFact, formatting),
            localizer ?? Localizer);

    // ── Branch precedence: loading → ready (parent fetch gate) ────────────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_pending()
    {
        var display = SummaryHeroCardsProjection.Project(SummaryHeroCardsModel.Pending, Localizer);

        Assert.Equal(SummaryHeroCardsState.Loading, display.State);
        Assert.Empty(display.Cards);
    }

    [Fact]
    public void Loading_takes_precedence_over_present_metrics()
    {
        var model = SummaryHeroCardsModel.ForMetrics(Metrics()) with { Loading = true };

        var display = SummaryHeroCardsProjection.Project(model, Localizer);

        Assert.Equal(SummaryHeroCardsState.Loading, display.State);
        Assert.Empty(display.Cards);
    }

    [Fact]
    public void Ready_when_metrics_resolved() =>
        Assert.Equal(SummaryHeroCardsState.Ready, Project().State);

    [Fact]
    public void Ready_renders_the_localized_week_summary_title() =>
        Assert.Equal("Week Summary", Project().WeekSummaryTitle);

    [Fact]
    public void Loading_still_resolves_the_week_summary_title() =>
        // The static chrome title is always available, even before the metrics resolve.
        Assert.Equal("Week Summary", SummaryHeroCardsProjection.Project(SummaryHeroCardsModel.Pending, Localizer).WeekSummaryTitle);

    // ── Card composition: five always-present tiles, sixth gated on the fun fact ──────────────────────────

    [Fact]
    public void Ready_renders_exactly_five_tiles_without_a_fun_fact() =>
        Assert.Equal(5, Project().Cards.Count);

    [Fact]
    public void Ready_renders_six_tiles_with_a_fun_fact() =>
        Assert.Equal(6, Project(funFact: FunFact).Cards.Count);

    [Fact]
    public void Tiles_render_in_the_web_order()
    {
        var cards = Project(funFact: FunFact).Cards;

        Assert.Collection(
            cards,
            c => Assert.Equal("Total Distance", c.Label),
            c => Assert.Equal("Total Drives", c.Label),
            c => Assert.Equal("Energy Used", c.Label),
            c => Assert.Equal("Charging Cost", c.Label),
            c => Assert.Equal("CO\u2082 Saved", c.Label),
            c => Assert.Equal("Fun Fact", c.Label));
    }

    [Fact]
    public void Each_tile_maps_to_the_web_color()
    {
        var cards = Project(funFact: FunFact).Cards;

        Assert.Equal(HighlightColor.Cyan, cards[0].Color);
        Assert.Equal(HighlightColor.Green, cards[1].Color);
        Assert.Equal(HighlightColor.Purple, cards[2].Color);
        Assert.Equal(HighlightColor.Amber, cards[3].Color);
        Assert.Equal(HighlightColor.Green, cards[4].Color);
        Assert.Equal(HighlightColor.Cyan, cards[5].Color);
    }

    [Fact]
    public void Each_tile_carries_a_non_empty_icon_glyph() =>
        Assert.All(Project(funFact: FunFact).Cards, c => Assert.False(string.IsNullOrEmpty(c.IconGlyph)));

    // ── Readouts: fmtNumber + unit suffix, fmtInt, formatCurrency ─────────────────────────────────────────

    [Fact]
    public void Distance_tile_renders_one_decimal_with_kilometre_suffix() =>
        Assert.Equal("120.0 km", Project().Cards[0].Value);

    [Fact]
    public void Drives_tile_renders_a_grouped_integer()
    {
        var value = Project(Metrics(totalDrives: 1234)).Cards[1].Value;

        Assert.Equal("1,234", value);
    }

    [Fact]
    public void Energy_tile_renders_one_decimal_with_kilowatt_hour_suffix() =>
        Assert.Equal("50.0 kWh", Project().Cards[2].Value);

    [Fact]
    public void Cost_tile_prefixes_the_currency_symbol_and_two_decimals() =>
        Assert.Equal("$10.00", Project().Cards[3].Value);

    [Fact]
    public void Cost_tile_honours_a_custom_currency_symbol() =>
        Assert.Equal("\u20ac10.00", Project(formatting: new SummaryHeroFormatting("\u20ac")).Cards[3].Value);

    [Fact]
    public void Cost_tile_falls_back_to_the_dollar_symbol_when_blank() =>
        Assert.Equal("$10.00", Project(formatting: new SummaryHeroFormatting("  ")).Cards[3].Value);

    [Fact]
    public void Co2_tile_renders_one_decimal_with_kilogram_suffix() =>
        Assert.Equal("21.0 kg", Project().Cards[4].Value);

    // ── Trend: flat, signed percentage and the invertPositive desirability flip ───────────────────────────

    [Fact]
    public void Distance_increase_is_a_positive_up_trend()
    {
        var card = Project(Metrics(totalDistance: 120, prevDistance: 100)).Cards[0];

        Assert.Equal("+20.0%", card.ChangeValue);
        Assert.True(card.ChangePositive);
    }

    [Fact]
    public void Unchanged_metric_renders_a_flat_zero_percent_positive()
    {
        var card = Project(Metrics(totalDistance: 100, prevDistance: 100)).Cards[0];

        Assert.Equal("0%", card.ChangeValue);
        Assert.True(card.ChangePositive);
    }

    [Fact]
    public void Energy_decrease_is_favourable_under_invert_positive()
    {
        // Lower energy is better — a drop reads as a positive (good) change with a signed negative percentage.
        var card = Project(Metrics(energyUsed: 50, prevEnergy: 60)).Cards[2];

        Assert.Equal("-16.7%", card.ChangeValue);
        Assert.True(card.ChangePositive);
    }

    [Fact]
    public void Cost_increase_is_unfavourable_under_invert_positive()
    {
        // Higher cost is worse — a rise reads as a negative (bad) change despite the "+" sign.
        var card = Project(Metrics(chargingCost: 10, prevChargingCost: 8)).Cards[3];

        Assert.Equal("+25.0%", card.ChangeValue);
        Assert.False(card.ChangePositive);
    }

    [Fact]
    public void Fun_fact_tile_has_no_change_caption() =>
        Assert.Null(Project(funFact: FunFact).Cards[5].ChangeValue);

    // ── pctChange parity (web helpers.ts) ─────────────────────────────────────────────────────────────────

    [Fact]
    public void PctChange_zero_previous_is_full_increase_when_current_positive() =>
        Assert.Equal(100, SummaryHeroCardsProjection.PctChange(5, 0));

    [Fact]
    public void PctChange_zero_previous_is_zero_when_current_not_positive() =>
        Assert.Equal(0, SummaryHeroCardsProjection.PctChange(0, 0));

    [Fact]
    public void PctChange_uses_absolute_previous_in_the_denominator() =>
        // (4 − (−2)) / |−2| * 100 = 300.
        Assert.Equal(300, SummaryHeroCardsProjection.PctChange(4, -2));

    // ── Fun fact: value + caption parity ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Fun_fact_value_appends_the_multiplication_sign() =>
        Assert.Equal("2.5\u00d7", Project(funFact: FunFact).Cards[5].Value);

    [Fact]
    public void Fun_fact_subtitle_interpolates_times_from_and_to() =>
        Assert.Equal("\u2248 2.5\u00d7 Paris \u2192 London", Project(funFact: FunFact).Cards[5].Subtitle);

    [Fact]
    public void No_fun_fact_drops_the_sixth_tile() =>
        Assert.DoesNotContain(Project().Cards, c => c.Label == "Fun Fact");

    // ── i18n: the projection feeds the web/source keys to the facade ─────────────────────────────────────

    [Fact]
    public void Projection_resolves_every_label_through_the_documented_keys()
    {
        var display = SummaryHeroCardsProjection.Project(
            SummaryHeroCardsModel.ForMetrics(Metrics(), FunFact), new KeyEchoLocalizer());

        Assert.Equal("analytics.weeklyDigest.weekSummary", display.WeekSummaryTitle);
        Assert.Equal("analytics.weeklyDigest.totalDistance", display.Cards[0].Label);
        Assert.Equal("analytics.weeklyDigest.totalDrives", display.Cards[1].Label);
        Assert.Equal("analytics.weeklyDigest.energyUsed", display.Cards[2].Label);
        Assert.Equal("analytics.weeklyDigest.chargingCost", display.Cards[3].Label);
        Assert.Equal("analytics.weeklyDigest.co2Saved", display.Cards[4].Label);
        Assert.Equal("analytics.weeklyDigest.funFact", display.Cards[5].Label);
        Assert.Equal("common.loading", display.LoadingLabel);
    }

    [Fact]
    public void Fun_fact_caption_resolves_through_its_key()
    {
        var display = SummaryHeroCardsProjection.Project(
            SummaryHeroCardsModel.ForMetrics(Metrics(), FunFact), new KeyEchoLocalizer());

        // Under KeyEcho the template is the bare key (no format slots), proving the caption is keyed, not a literal.
        Assert.Equal("analytics.weeklyDigest.funFactDesc", display.Cards[5].Subtitle);
    }

    // ── Accessibility: the surface exposes a meaningful Narrator name in every state ──────────────────────

    [Fact]
    public void Ready_surface_automation_name_opens_with_the_title_and_first_tile()
    {
        var name = Project(funFact: FunFact).AutomationName;

        Assert.StartsWith("Week Summary. Total Distance. 120.0 km. +20.0%", name);
    }

    [Fact]
    public void Ready_surface_automation_name_includes_the_fun_fact()
    {
        var name = Project(funFact: FunFact).AutomationName;

        Assert.Contains("Fun Fact", name);
        Assert.Contains("2.5\u00d7", name);
    }

    [Fact]
    public void Loading_surface_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading...", SummaryHeroCardsProjection.Project(SummaryHeroCardsModel.Pending, Localizer).AutomationName);

    [Fact]
    public void Every_state_exposes_a_non_empty_surface_automation_name()
    {
        Assert.All(
            new[] { SummaryHeroCardsProjection.Project(SummaryHeroCardsModel.Pending, Localizer), Project(funFact: FunFact) },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    // ── Diagnostics (P1/S11): view.opened slug=SummaryHeroCards, PII-safe ────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new SummaryHeroCardsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SummaryHeroCards", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_fleet_figures()
    {
        var captured = new List<string>();
        var diagnostics = new SummaryHeroCardsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=SummaryHeroCards", line);
        Assert.DoesNotContain("km", line, StringComparison.Ordinal);
        Assert.DoesNotContain("$", line, StringComparison.Ordinal);
        Assert.DoesNotContain("kWh", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("SummaryHeroCards", SummaryHeroCardsRegistration.Slug);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => SummaryHeroCardsProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => SummaryHeroCardsProjection.Project(SummaryHeroCardsModel.Pending, null!));

    [Fact]
    public void ForMetrics_rejects_null_metrics() =>
        Assert.Throws<ArgumentNullException>(() => SummaryHeroCardsModel.ForMetrics(null!));

    /// <summary>
    /// An <see cref="ILocalizer"/> that echoes the requested key (ignoring the fallback), proving the projection
    /// feeds the documented i18n keys — not ad-hoc English literals — into the facade.
    /// </summary>
    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key;
    }
}
