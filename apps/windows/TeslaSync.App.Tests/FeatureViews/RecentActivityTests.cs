using System;
using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Dashboard;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>RecentActivity</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / ready), the unified activity feed (drive + charge formatting, the SI distance /
/// energy conversion, the duration + SoC + currency strings, the time-sort + eight-row cap, the icon glyphs
/// and accent severities, and the friendly empty note), the reversed battery trend (each drive's end SoC,
/// the <c>?? 50</c> fallback, and the &gt;1-point gate), the four fleet stats (<c>fmtInt</c> drives /
/// sessions, the currency total, and the <c>× 0.42</c> CO₂ stat), the optional most-efficient block, the
/// i18n key resolution, the per-state accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/dashboard/components/RecentActivity.tsx). The WinUI view itself (RecentActivity.cs) is
/// exercised by the app build.
/// </summary>
public sealed class RecentActivityTests
{
    private const string ActivityGlyph = "\uE9D2";
    private const string DriveGlyph = "\uE804";
    private const string ChargeGlyph = "\uE945";
    private const string BatteryGlyph = "\uE83F";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Base = new(2026, 6, 1, 12, 0, 0, TimeSpan.Zero);

    private static RecentActivityDrive Drive(
        double distanceM = 1609.344,
        double durationS = 4980,
        double? startSoc = 80,
        double? endSoc = 60,
        int minutesAgo = 0) =>
        new(distanceM, durationS, startSoc, endSoc, Base.AddMinutes(-minutesAgo));

    private static RecentActivityCharge Charge(
        double energyWh = 8500,
        double? startSoc = 40,
        double? endSoc = 80,
        double? cost = 12.5,
        int minutesAgo = 0) =>
        new(energyWh, startSoc, endSoc, cost, Base.AddMinutes(-minutesAgo));

    private static RecentActivityModel Ready(
        IReadOnlyList<RecentActivityDrive>? drives = null,
        IReadOnlyList<RecentActivityCharge>? charges = null,
        RecentActivityAnalytics? analytics = null,
        DistanceUnit unit = DistanceUnit.Mi) =>
        new(false,
            drives ?? Array.Empty<RecentActivityDrive>(),
            charges ?? Array.Empty<RecentActivityCharge>(),
            analytics,
            unit);

    private static RecentActivityAnalytics Analytics(
        long drives = 42,
        long sessions = 7,
        double cost = 123.45,
        double energyKwh = 100,
        RecentActivityMostEfficient? mostEfficient = null) =>
        new(drives, sessions, cost, energyKwh, mostEfficient);

    private static RecentActivityDisplay Project(RecentActivityModel model, string? currency = null) =>
        RecentActivityProjection.Project(model, Localizer, currency);

    // ── Branch precedence: loading → ready (web data lifecycle) ────────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(RecentActivityState.Loading, Project(RecentActivityModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_present_data()
    {
        var model = new RecentActivityModel(true, new[] { Drive() }, new[] { Charge() }, Analytics(), DistanceUnit.Mi);

        Assert.Equal(RecentActivityState.Loading, Project(model).State);
    }

    [Fact]
    public void Ready_when_resolved() =>
        Assert.Equal(RecentActivityState.Ready, Project(RecentActivityModel.Empty).State);

    // ── Activity feed: drive + charge composition (web parity) ──────────────────────────────────────────

    [Fact]
    public void Drive_title_converts_distance_to_the_display_unit_at_one_decimal()
    {
        var display = Project(Ready(drives: new[] { Drive(distanceM: 1609.344) }, unit: DistanceUnit.Mi));

        Assert.Equal("1.0 mi drive", display.Items[0].Title);
    }

    [Fact]
    public void Drive_title_honours_a_kilometre_display_unit()
    {
        var display = Project(Ready(drives: new[] { Drive(distanceM: 5000) }, unit: DistanceUnit.Km));

        Assert.Equal("5.0 km drive", display.Items[0].Title);
    }

    [Fact]
    public void Drive_subtitle_is_duration_then_soc_span()
    {
        var display = Project(Ready(drives: new[] { Drive(durationS: 4980, startSoc: 80, endSoc: 60) }));

        Assert.Equal("1h 23m \u00B7 80% \u2192 60%", display.Items[0].Subtitle);
    }

    [Fact]
    public void Drive_subtitle_shows_a_question_mark_for_a_missing_soc()
    {
        var display = Project(Ready(drives: new[] { Drive(startSoc: null, endSoc: null) }));

        Assert.Equal("1h 23m \u00B7 ?% \u2192 ?%", display.Items[0].Subtitle);
    }

    [Fact]
    public void Charge_title_converts_energy_to_kwh_at_one_decimal()
    {
        var display = Project(Ready(charges: new[] { Charge(energyWh: 8500) }));

        Assert.Equal("8.5 kWh charged", display.Items[0].Title);
    }

    [Fact]
    public void Charge_subtitle_appends_the_cost_when_present()
    {
        var display = Project(Ready(charges: new[] { Charge(startSoc: 40, endSoc: 80, cost: 12.5) }));

        Assert.Equal("40% \u2192 80% \u00B7 $12.50", display.Items[0].Subtitle);
    }

    [Fact]
    public void Charge_subtitle_honours_a_custom_currency_symbol()
    {
        var display = Project(Ready(charges: new[] { Charge(cost: 12.5) }), currency: "\u20AC");

        Assert.EndsWith("\u20AC12.50", display.Items[0].Subtitle, StringComparison.Ordinal);
    }

    [Fact]
    public void Charge_subtitle_omits_the_cost_when_absent()
    {
        var display = Project(Ready(charges: new[] { Charge(startSoc: 40, endSoc: 80, cost: null) }));

        Assert.Equal("40% \u2192 80%", display.Items[0].Subtitle);
    }

    [Fact]
    public void Drive_and_charge_carry_their_web_glyphs_and_accent_severities()
    {
        var display = Project(Ready(
            drives: new[] { Drive(minutesAgo: 0) },
            charges: new[] { Charge(minutesAgo: 10) }));

        var drive = display.Items[0];
        var charge = display.Items[1];

        Assert.Equal(RecentActivityKind.Drive, drive.Kind);
        Assert.Equal(DriveGlyph, drive.Glyph);
        Assert.Equal("info", drive.Severity);

        Assert.Equal(RecentActivityKind.Charge, charge.Kind);
        Assert.Equal(ChargeGlyph, charge.Glyph);
        Assert.Equal("success", charge.Severity);
    }

    [Fact]
    public void Feed_is_sorted_newest_first()
    {
        var display = Project(Ready(
            drives: new[] { Drive(minutesAgo: 30) },
            charges: new[] { Charge(minutesAgo: 5) }));

        Assert.Equal(RecentActivityKind.Charge, display.Items[0].Kind); // 5 min ago is newer
        Assert.Equal(RecentActivityKind.Drive, display.Items[1].Kind);
    }

    [Fact]
    public void Feed_is_capped_at_eight_rows()
    {
        var drives = new List<RecentActivityDrive>();
        for (int i = 0; i < 12; i++)
        {
            drives.Add(Drive(minutesAgo: i));
        }

        var display = Project(Ready(drives: drives));

        Assert.Equal(8, display.Items.Count);
        Assert.True(display.HasActivity);
    }

    [Fact]
    public void Feed_is_empty_when_there_are_no_drives_or_charges()
    {
        var display = Project(RecentActivityModel.Empty);

        Assert.False(display.HasActivity);
        Assert.Empty(display.Items);
    }

    [Fact]
    public void Item_automation_name_carries_title_and_subtitle()
    {
        var display = Project(Ready(drives: new[] { Drive(distanceM: 1609.344, durationS: 4980, startSoc: 80, endSoc: 60) }));

        Assert.Equal("1.0 mi drive. 1h 23m \u00B7 80% \u2192 60%", display.Items[0].AutomationName);
    }

    [Fact]
    public void Non_finite_distance_and_energy_format_as_zero()
    {
        var display = Project(Ready(
            drives: new[] { Drive(distanceM: double.NaN, minutesAgo: 0) },
            charges: new[] { Charge(energyWh: double.PositiveInfinity, minutesAgo: 10) }));

        Assert.StartsWith("0.0 mi", display.Items[0].Title, StringComparison.Ordinal);
        Assert.StartsWith("0.0 kWh", display.Items[1].Title, StringComparison.Ordinal);
    }

    // ── Battery trend: each drive's end SoC, reversed, ?? 50 (web parity) ───────────────────────────────

    [Fact]
    public void Battery_trend_is_each_drives_end_soc_reversed()
    {
        var display = Project(Ready(drives: new[]
        {
            Drive(endSoc: 80, minutesAgo: 0),
            Drive(endSoc: 60, minutesAgo: 10),
            Drive(endSoc: 40, minutesAgo: 20),
        }));

        Assert.True(display.HasBatteryTrend);
        Assert.Equal(3, display.BatteryTrend.Count);
        Assert.Equal(40, display.BatteryTrend[0].Soc); // last drive collected, leftmost after reverse
        Assert.Equal(60, display.BatteryTrend[1].Soc);
        Assert.Equal(80, display.BatteryTrend[2].Soc);
    }

    [Fact]
    public void Battery_trend_substitutes_fifty_for_a_missing_end_soc()
    {
        var display = Project(Ready(drives: new[] { Drive(endSoc: null), Drive(endSoc: 70) }));

        Assert.Contains(display.BatteryTrend, p => p.Soc == RecentActivityProjection.DefaultTrendSoc);
        Assert.Contains(display.BatteryTrend, p => p.Soc == 70);
    }

    [Fact]
    public void Battery_trend_needs_more_than_one_point()
    {
        Assert.False(Project(Ready(drives: new[] { Drive() })).HasBatteryTrend);
        Assert.False(Project(RecentActivityModel.Empty).HasBatteryTrend);
        Assert.True(Project(Ready(drives: new[] { Drive(minutesAgo: 0), Drive(minutesAgo: 5) })).HasBatteryTrend);
    }

    [Fact]
    public void Battery_chart_summary_lists_every_point_then_falls_back_to_the_empty_note()
    {
        var withData = Project(Ready(drives: new[] { Drive(endSoc: 80, minutesAgo: 0), Drive(endSoc: 60, minutesAgo: 10) }));
        Assert.Equal("Battery Trend: 60%, 80%", withData.BatteryChartSummary);

        var empty = Project(RecentActivityModel.Empty);
        Assert.Equal("Battery Trend: Charge data will appear here", empty.BatteryChartSummary);
    }

    // ── Fleet performance: the four stats (web order + formatting) ──────────────────────────────────────

    [Fact]
    public void Stats_are_in_the_web_order_with_their_labels()
    {
        var stats = Project(Ready(analytics: Analytics())).Stats;

        Assert.Collection(
            stats,
            s => Assert.Equal("Total Drives (30d)", s.Label),
            s => Assert.Equal("Charge Sessions", s.Label),
            s => Assert.Equal("Total Cost", s.Label),
            s => Assert.Equal("CO\u2082 Saved", s.Label));
    }

    [Fact]
    public void Stat_values_use_the_web_formatting()
    {
        var stats = Project(Ready(analytics: Analytics(drives: 42, sessions: 7, cost: 123.45, energyKwh: 100))).Stats;

        Assert.Equal("42", stats[0].Value);
        Assert.Equal("7", stats[1].Value);
        Assert.Equal("$123.45", stats[2].Value);
        Assert.Equal("42 kg", stats[3].Value); // 100 kWh × 0.42
    }

    [Fact]
    public void Total_drives_uses_grouped_integer_formatting()
    {
        var stats = Project(Ready(analytics: Analytics(drives: 1234))).Stats;

        Assert.Equal("1,234", stats[0].Value);
    }

    [Fact]
    public void Stats_fall_back_to_zero_without_analytics()
    {
        var stats = Project(RecentActivityModel.Empty).Stats;

        Assert.Equal("0", stats[0].Value);
        Assert.Equal("0", stats[1].Value);
        Assert.Equal("$0.00", stats[2].Value);
        Assert.Equal("0 kg", stats[3].Value);
    }

    [Fact]
    public void Non_finite_analytics_values_format_as_zero()
    {
        var stats = Project(Ready(analytics: Analytics(cost: double.NaN, energyKwh: double.PositiveInfinity))).Stats;

        Assert.Equal("$0.00", stats[2].Value);
        Assert.Equal("0 kg", stats[3].Value);
    }

    [Fact]
    public void Total_cost_honours_a_custom_currency_symbol()
    {
        var stats = Project(Ready(analytics: Analytics(cost: 50)), currency: "\u20AC").Stats;

        Assert.Equal("\u20AC50.00", stats[2].Value);
    }

    // ── Most-efficient block (web optional render) ──────────────────────────────────────────────────────

    [Fact]
    public void Most_efficient_is_absent_without_a_vehicle()
    {
        var display = Project(Ready(analytics: Analytics(mostEfficient: null)));

        Assert.False(display.HasMostEfficient);
        Assert.Null(display.MostEfficient);
        Assert.Equal(string.Empty, display.MostEfficientValue);
    }

    [Fact]
    public void Most_efficient_renders_name_and_formatted_value()
    {
        var vehicle = new RecentActivityMostEfficient("Model 3", 250, "Wh/km");
        var display = Project(Ready(analytics: Analytics(mostEfficient: vehicle)));

        Assert.True(display.HasMostEfficient);
        Assert.Equal("Model 3", display.MostEfficient!.Name);
        Assert.Equal("250 Wh/km", display.MostEfficientValue);
    }

    [Fact]
    public void Most_efficient_value_rounds_to_an_integer()
    {
        var vehicle = new RecentActivityMostEfficient("Model Y", 248.6, "Wh/km");
        var display = Project(Ready(analytics: Analytics(mostEfficient: vehicle)));

        Assert.Equal("249 Wh/km", display.MostEfficientValue);
    }

    // ── Fixed copy / shared strings ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Headers_and_glyphs_resolve_from_the_facade()
    {
        var display = Project(Ready());

        Assert.Equal("Recent Activity", display.ActivityTitle);
        Assert.Equal("View all", display.ViewAllLabel);
        Assert.Equal("Battery Trend", display.BatteryTitle);
        Assert.Equal("Fleet Performance", display.PerfTitle);
        Assert.Equal("Most Efficient", display.MostEfficientLabel);

        Assert.Equal(ActivityGlyph, display.ActivityGlyph);
        Assert.Equal(BatteryGlyph, display.BatteryGlyph);
    }

    [Fact]
    public void Activity_empty_message_uses_the_dashboard_catalog_key() =>
        Assert.Equal("No activity yet. Start driving!", Project(RecentActivityModel.Empty).ActivityEmptyMessage);

    [Fact]
    public void Battery_empty_message_uses_the_dashboard_scoped_key() =>
        Assert.Equal("Charge data will appear here", Project(RecentActivityModel.Empty).BatteryEmptyMessage);

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(RecentActivityModel.Pending).LoadingLabel);

    // ── Accessibility: every state exposes a meaningful Narrator name ───────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name() =>
        Assert.All(
            new[]
            {
                Project(RecentActivityModel.Pending),
                Project(RecentActivityModel.Empty),
                Project(Ready(drives: new[] { Drive() }, analytics: Analytics())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));

    [Fact]
    public void Loading_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading", Project(RecentActivityModel.Pending).AutomationName);

    [Fact]
    public void Ready_automation_name_carries_the_titles_and_stats()
    {
        var vehicle = new RecentActivityMostEfficient("Model 3", 250, "Wh/km");
        var display = Project(Ready(
            drives: new[] { Drive() },
            analytics: Analytics(drives: 42, sessions: 7, cost: 123.45, energyKwh: 100, mostEfficient: vehicle)));

        Assert.StartsWith("Recent Activity", display.AutomationName);
        Assert.Contains("Battery Trend", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Fleet Performance", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Total Cost $123.45", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("CO\u2082 Saved 42 kg", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Most Efficient Model 3 250 Wh/km", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Stat_automation_name_carries_label_and_value()
    {
        var stats = Project(Ready(analytics: Analytics(drives: 42))).Stats;

        Assert.Equal("Total Drives (30d): 42", stats[0].AutomationName);
    }

    // ── Diagnostics (P1/S11): view.opened slug=RecentActivity, PII-safe ─────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new RecentActivityDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RecentActivity", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_activity_figures()
    {
        var captured = new List<string>();
        var diagnostics = new RecentActivityDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=RecentActivity", line);
        Assert.DoesNotContain('%', line);
        Assert.DoesNotContain('$', line);
        Assert.DoesNotContain("kWh", line, StringComparison.Ordinal);
        Assert.DoesNotContain("mi", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("RecentActivity", RecentActivityRegistration.Slug);

    // ── Argument validation ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => RecentActivityProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => RecentActivityProjection.Project(RecentActivityModel.Pending, null!));
}
