using System.Collections.Generic;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ChargingSection</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / ready), the four mini-stat formatters (<c>fmtInt</c> sessions,
/// <c>fmtNumber(_, 1) + " kWh"</c>, <c>fmtNumber(_, 1) + " kW"</c>, <c>formatCurrency(_, 2)</c>), the
/// week-over-week badge (success/warning variant + <c>pctChange</c> percentage or em-dash), the daily-energy
/// chart buckets + spoken summary, the accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/weekly-digest/ChargingSection.tsx). The WinUI view itself
/// (ChargingSection.cs) is exercised by the app build.
/// </summary>
public sealed class ChargingSectionTests
{
    private const string EmDash = "\u2014";
    private const string ZapGlyph = "\uE945";
    private const string ActivityGlyph = "\uE9D2";
    private const string CostGlyph = "\uE1D3";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static IReadOnlyList<ChargingSectionDailyEnergy> Days(params double[] energies)
    {
        string[] labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        var list = new List<ChargingSectionDailyEnergy>(energies.Length);
        for (int i = 0; i < energies.Length; i++)
        {
            list.Add(new ChargingSectionDailyEnergy(labels[i % labels.Length], energies[i]));
        }

        return list;
    }

    private static ChargingSectionModel Ready(
        long sessions = 12,
        double energy = 45,
        double rate = 11,
        double cost = 12.5,
        double prev = 40,
        IReadOnlyList<ChargingSectionDailyEnergy>? daily = null) =>
        new(false, sessions, energy, rate, cost, prev, daily ?? Days(5, 10, 8, 6, 9, 4, 3));

    private static ChargingSectionDisplay Project(ChargingSectionModel model, string? currency = null) =>
        ChargingSectionProjection.Project(model, Localizer, currency);

    // ── Branch precedence: loading → empty → ready (web data lifecycle) ───────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(ChargingSectionState.Loading, Project(ChargingSectionModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_present_data()
    {
        var display = Project(new ChargingSectionModel(true, 9, 30, 11, 8, 20, Days(5, 5)));

        Assert.Equal(ChargingSectionState.Loading, display.State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_activity() =>
        Assert.Equal(ChargingSectionState.Empty, Project(ChargingSectionModel.Empty).State);

    [Fact]
    public void Empty_when_sessions_energy_and_daily_are_all_zero()
    {
        var display = Project(new ChargingSectionModel(false, 0, 0, 0, 0, 0, Days(0, 0, 0, 0, 0, 0, 0)));

        Assert.Equal(ChargingSectionState.Empty, display.State);
    }

    [Fact]
    public void Ready_when_sessions_present()
    {
        var display = Project(Ready());

        Assert.Equal(ChargingSectionState.Ready, display.State);
        Assert.Equal(4, display.Stats.Count);
    }

    [Fact]
    public void Ready_when_energy_added_present_even_with_zero_sessions() =>
        Assert.Equal(
            ChargingSectionState.Ready,
            Project(new ChargingSectionModel(false, 0, 12.3, 0, 0, 0, [])).State);

    [Fact]
    public void Ready_when_only_a_daily_bucket_has_energy() =>
        Assert.Equal(
            ChargingSectionState.Ready,
            Project(new ChargingSectionModel(false, 0, 0, 0, 0, 0, Days(0, 0, 7.5, 0))).State);

    // ── Mini-stats: web order + formatting + glyphs ──────────────────────────────────────────────────

    [Fact]
    public void Stats_are_in_the_web_order_with_their_labels()
    {
        var stats = Project(Ready()).Stats;

        Assert.Collection(
            stats,
            s => Assert.Equal("Sessions", s.Label),
            s => Assert.Equal("Total Energy Added", s.Label),
            s => Assert.Equal("Avg Charge Rate", s.Label),
            s => Assert.Equal("Total Cost", s.Label));
    }

    [Fact]
    public void Sessions_value_uses_grouped_integer_formatting()
    {
        var stats = Project(Ready(sessions: 1234)).Stats;

        Assert.Equal("1,234", stats[0].Value);
    }

    [Fact]
    public void Total_energy_added_appends_the_kwh_suffix_at_one_decimal()
    {
        Assert.Equal("45.0 kWh", Project(Ready(energy: 45)).Stats[1].Value);
    }

    [Fact]
    public void Avg_charge_rate_appends_the_kw_suffix_at_one_decimal()
    {
        Assert.Equal("11.0 kW", Project(Ready(rate: 11)).Stats[2].Value);
    }

    [Fact]
    public void Total_cost_uses_the_default_currency_symbol_at_two_decimals()
    {
        Assert.Equal("$12.50", Project(Ready(cost: 12.5)).Stats[3].Value);
    }

    [Fact]
    public void Total_cost_honours_a_custom_currency_symbol()
    {
        Assert.Equal("\u20AC12.50", Project(Ready(cost: 12.5), currency: "\u20AC").Stats[3].Value);
    }

    [Fact]
    public void Energy_value_rounds_half_away_from_zero()
    {
        Assert.Equal("45.3 kWh", Project(Ready(energy: 45.25)).Stats[1].Value);
    }

    [Fact]
    public void Stat_glyphs_match_the_web_icons()
    {
        var stats = Project(Ready()).Stats;

        Assert.Equal(ZapGlyph, stats[0].Glyph);      // Sessions — web Zap
        Assert.Equal(ZapGlyph, stats[1].Glyph);      // Total Energy Added — web Zap
        Assert.Equal(ActivityGlyph, stats[2].Glyph); // Avg Charge Rate — web Activity
        Assert.Equal(CostGlyph, stats[3].Glyph);     // Total Cost — web Fuel → native money
    }

    [Fact]
    public void Stat_automation_name_carries_label_and_value()
    {
        var sessions = Project(Ready(sessions: 7)).Stats[0];

        Assert.Equal("Sessions: 7", sessions.AutomationName);
    }

    [Fact]
    public void Non_finite_metric_values_format_as_zero()
    {
        var stats = Project(Ready(energy: double.NaN, rate: double.PositiveInfinity, cost: double.NaN)).Stats;

        Assert.Equal("0.0 kWh", stats[1].Value);
        Assert.Equal("0.0 kW", stats[2].Value);
        Assert.Equal("$0.00", stats[3].Value);
    }

    // ── Week-over-week chip (web Badge) ──────────────────────────────────────────────────────────────

    [Fact]
    public void Week_over_week_is_success_when_energy_meets_or_beats_last_week()
    {
        Assert.Equal(StatusKind.Success, Project(Ready(energy: 45, prev: 40)).WeekOverWeekStatus);
        Assert.Equal(StatusKind.Success, Project(Ready(energy: 40, prev: 40)).WeekOverWeekStatus);
    }

    [Fact]
    public void Week_over_week_is_warning_when_energy_falls_short()
    {
        Assert.Equal(StatusKind.Warning, Project(Ready(energy: 30, prev: 40)).WeekOverWeekStatus);
    }

    [Fact]
    public void Week_over_week_text_is_the_signed_percentage_change()
    {
        Assert.Equal("12.5%", Project(Ready(energy: 45, prev: 40)).WeekOverWeekText);
        Assert.Equal("-25.0%", Project(Ready(energy: 30, prev: 40)).WeekOverWeekText);
    }

    [Fact]
    public void Week_over_week_text_is_an_em_dash_without_a_previous_baseline()
    {
        var display = Project(Ready(energy: 45, prev: 0));

        Assert.Equal(EmDash, display.WeekOverWeekText);
        Assert.Equal(StatusKind.Success, display.WeekOverWeekStatus); // 45 >= 0
    }

    [Fact]
    public void Week_over_week_automation_name_carries_label_and_text()
    {
        var display = Project(Ready(energy: 45, prev: 40));

        Assert.Equal("Energy vs. Last Week: 12.5%", display.WeekOverWeekAutomationName);
    }

    // ── Daily-energy chart buckets + spoken summary ──────────────────────────────────────────────────

    [Fact]
    public void Daily_energy_buckets_are_carried_through_for_the_chart()
    {
        var display = Project(Ready(daily: Days(5, 10, 8)));

        Assert.True(display.HasChart);
        Assert.Equal(3, display.DailyEnergy.Count);
        Assert.Equal("Tue", display.DailyEnergy[1].Day);
        Assert.Equal(10, display.DailyEnergy[1].Energy);
    }

    [Fact]
    public void Null_daily_source_yields_no_chart_buckets()
    {
        var display = Project(new ChargingSectionModel(false, 5, 20, 10, 5, 10, null!));

        Assert.False(display.HasChart);
        Assert.Empty(display.DailyEnergy);
    }

    [Fact]
    public void Non_finite_daily_energy_is_coerced_to_zero()
    {
        var display = Project(Ready(daily: Days(double.NaN, double.PositiveInfinity, 4)));

        Assert.Equal(0, display.DailyEnergy[0].Energy);
        Assert.Equal(0, display.DailyEnergy[1].Energy);
        Assert.Equal(4, display.DailyEnergy[2].Energy);
    }

    [Fact]
    public void Chart_summary_lists_every_bucket_at_one_decimal()
    {
        var display = Project(Ready(daily: Days(5, 10.5, 0)));

        Assert.Equal("Daily Energy Added (kWh): Mon 5.0, Tue 10.5, Wed 0.0", display.ChartSummary);
    }

    [Fact]
    public void Chart_summary_falls_back_to_the_title_when_there_are_no_buckets()
    {
        var display = Project(new ChargingSectionModel(false, 3, 9, 6, 4, 3, []));

        Assert.Equal("Daily Energy Added (kWh)", display.ChartSummary);
    }

    // ── Fixed copy / shared strings ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Title_and_chart_title_resolve_from_the_facade()
    {
        var display = Project(Ready());

        Assert.Equal("Charging", display.Title);
        Assert.Equal("Daily Energy Added (kWh)", display.ChartTitle);
        Assert.Equal("Energy Added", display.EnergySeriesLabel);
        Assert.Equal(ZapGlyph, display.TitleGlyph);
    }

    [Fact]
    public void Empty_message_uses_the_shared_chart_no_data_string() =>
        Assert.Equal("No data available", Project(ChargingSectionModel.Empty).EmptyMessage);

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(ChargingSectionModel.Pending).LoadingLabel);

    // ── Accessibility: every state exposes a meaningful Narrator name ─────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name() =>
        Assert.All(
            new[]
            {
                Project(ChargingSectionModel.Pending),
                Project(ChargingSectionModel.Empty),
                Project(Ready()),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));

    [Fact]
    public void Loading_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading", Project(ChargingSectionModel.Pending).AutomationName);

    [Fact]
    public void Empty_automation_name_is_the_empty_message() =>
        Assert.Equal("No data available", Project(ChargingSectionModel.Empty).AutomationName);

    [Fact]
    public void Ready_automation_name_carries_the_title_stats_and_week_chip()
    {
        var display = Project(Ready(sessions: 12, energy: 45, rate: 11, cost: 12.5, prev: 40));

        Assert.StartsWith("Charging", display.AutomationName);
        Assert.Contains("Sessions 12", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Total Energy Added 45.0 kWh", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Avg Charge Rate 11.0 kW", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Total Cost $12.50", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Energy vs. Last Week 12.5%", display.AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=ChargingSection, PII-safe ─────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new ChargingSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargingSection", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_charging_figures()
    {
        var captured = new List<string>();
        var diagnostics = new ChargingSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=ChargingSection", line);
        Assert.DoesNotContain('%', line);
        Assert.DoesNotContain('$', line);
        Assert.DoesNotContain("kWh", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("ChargingSection", ChargingSectionRegistration.Slug);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => ChargingSectionProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => ChargingSectionProjection.Project(ChargingSectionModel.Pending, null!));
}
