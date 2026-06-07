using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the ChargingOptimizerWidget's UI-thread-free logic — the JSON parse adapter
/// (nested <c>current_schedule</c> / <c>cost_analysis</c> / <c>recommendations</c> snake_case shape), the
/// projection (12-hour clock, target SOC, monthly savings, schedule-match badge, 24h rate timeline,
/// recommendation tips), the cache-then-network result mapper, the registry metadata, the diagnostics, the
/// repository source's vehicle resolution + request shape, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/ChargingOptimizerWidget.tsx + api/hooks/useCharging.ts +
/// types/charging.ts).
/// </summary>
public sealed class ChargingOptimizerWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string FullJson = """
    {
      "current_schedule": {
        "most_common_start_hour": 2,
        "most_common_day": "Mon",
        "avg_sessions_per_week": 4,
        "home_charging_pct": 90,
        "avg_charge_to_pct": 80
      },
      "cost_analysis": {
        "peak_hours": [17, 18, 19, 20],
        "offpeak_hours": [0, 1, 2, 3, 4],
        "peak_cost_per_kwh": 0.4,
        "offpeak_cost_per_kwh": 0.1,
        "sessions_during_peak_pct": 12,
        "potential_monthly_savings": 45
      },
      "battery_health_score": 95,
      "recommendations": [
        {"type":"shift","priority":"high","title":"Shift to off-peak","detail":"Start at 1 AM","estimated_savings":30},
        {"type":"soc","priority":"medium","title":"Lower target SOC","detail":"Charge to 80%"}
      ],
      "weekly_heatmap": []
    }
    """;

    private static ChargingOptimizerReport ParseFull()
    {
        using var doc = JsonDocument.Parse(FullJson);
        return ChargingOptimizerReport.FromJson(doc.RootElement);
    }

    private static ChargingOptimizerReport Report(
        int startHour = 2,
        double targetSoc = 80,
        double savings = 45,
        double peakPct = 12,
        int[]? peakHours = null,
        int[]? offpeakHours = null,
        params OptimizerRecommendation[] recommendations) =>
        new(
            HasData: true,
            OptimalStartHour: startHour,
            TargetSocPct: targetSoc,
            MonthlySavings: savings,
            PeakPct: peakPct,
            PeakHours: peakHours ?? new[] { 17, 18, 19, 20 },
            OffpeakHours: offpeakHours ?? new[] { 0, 1, 2, 3, 4 },
            Recommendations: recommendations);

    private static OptimizerRecommendation Rec(
        string priority = "high", string title = "Title", string detail = "Detail") =>
        new("type", priority, title, detail, null);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_nested_snake_case_fields()
    {
        var report = ParseFull();

        Assert.True(report.HasData);
        Assert.Equal(2, report.OptimalStartHour);
        Assert.Equal(80, report.TargetSocPct);
        Assert.Equal(45, report.MonthlySavings);
        Assert.Equal(12, report.PeakPct);
        Assert.Equal(new[] { 17, 18, 19, 20 }, report.PeakHours);
        Assert.Equal(new[] { 0, 1, 2, 3, 4 }, report.OffpeakHours);
        Assert.Equal(2, report.Recommendations.Count);
        Assert.Equal("Shift to off-peak", report.Recommendations[0].Title);
        Assert.Equal("high", report.Recommendations[0].Priority);
        Assert.Equal("Start at 1 AM", report.Recommendations[0].Detail);
        Assert.Equal(30, report.Recommendations[0].EstimatedSavings);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_nested_objects()
    {
        using var doc = JsonDocument.Parse("""{"battery_health_score": 90}""");

        var report = ChargingOptimizerReport.FromJson(doc.RootElement);

        Assert.True(report.HasData); // non-empty object -> web `!!data`
        Assert.Equal(0, report.OptimalStartHour);
        Assert.Equal(0, report.TargetSocPct);
        Assert.Equal(0, report.MonthlySavings);
        Assert.Equal(0, report.PeakPct);
        Assert.Empty(report.PeakHours);
        Assert.Empty(report.OffpeakHours);
        Assert.Empty(report.Recommendations);
    }

    [Fact]
    public void FromJson_empty_object_is_no_data()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.False(ChargingOptimizerReport.FromJson(doc.RootElement).HasData);
    }

    [Fact]
    public void FromJson_non_object_is_no_data()
    {
        using var doc = JsonDocument.Parse("42");
        Assert.False(ChargingOptimizerReport.FromJson(doc.RootElement).HasData);
    }

    [Fact]
    public void FromJson_recommendation_title_and_detail_fall_back_to_em_dash()
    {
        using var doc = JsonDocument.Parse("""{"recommendations":[{"priority":"low"}]}""");

        var report = ChargingOptimizerReport.FromJson(doc.RootElement);

        var rec = Assert.Single(report.Recommendations);
        Assert.Equal("\u2014", rec.Title);
        Assert.Equal("\u2014", rec.Detail);
        Assert.Equal("low", rec.Priority);
        Assert.Null(rec.EstimatedSavings);
    }

    [Fact]
    public void FromJson_skips_non_object_recommendation_items()
    {
        using var doc = JsonDocument.Parse("""{"recommendations":[1,"x",{"title":"Real"}]}""");

        var report = ChargingOptimizerReport.FromJson(doc.RootElement);

        var rec = Assert.Single(report.Recommendations);
        Assert.Equal("Real", rec.Title);
    }

    [Fact]
    public void FromJson_skips_out_of_range_and_non_numeric_hours()
    {
        using var doc = JsonDocument.Parse(
            """{"cost_analysis":{"peak_hours":[17,99,-1,"x",18]}}""");

        var report = ChargingOptimizerReport.FromJson(doc.RootElement);

        Assert.Equal(new[] { 17, 18 }, report.PeakHours);
    }

    // ---- formatHour (web 12-hour clock) --------------------------------------------

    [Theory]
    [InlineData(0, "12 AM")]
    [InlineData(24, "12 AM")]
    [InlineData(12, "12 PM")]
    [InlineData(1, "1 AM")]
    [InlineData(11, "11 AM")]
    [InlineData(13, "1 PM")]
    [InlineData(23, "11 PM")]
    public void FormatHour_matches_web(int hour, string expected) =>
        Assert.Equal(expected, ChargingOptimizerProjection.FormatHour(hour));

    // ---- Size / footprint flags (web isCompact / isWide) ---------------------------

    [Theory]
    [InlineData(1, 2, true, false)]   // compact
    [InlineData(2, 2, false, false)]  // standard (default)
    [InlineData(3, 4, false, false)]  // standard
    [InlineData(4, 40, false, true)]  // wide
    public void Size_flags_match_web(int cols, int rows, bool compact, bool wide)
    {
        var size = new ChargingOptimizerSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
    }

    // ---- Projection: metrics -------------------------------------------------------

    [Fact]
    public void Project_formats_the_three_metrics()
    {
        var display = ChargingOptimizerProjection.Project(Report(), new ChargingOptimizerSize(2, 2), Localizer);

        Assert.Equal("2 AM", display.OptimalStartText);
        Assert.Equal("2 AM", display.OptimalStartMetric.Value);
        Assert.Equal("Optimal start", display.OptimalStartMetric.Label);
        Assert.Equal("80%", display.TargetSocMetric.Value);
        Assert.Equal("Target SOC", display.TargetSocMetric.Label);
        Assert.Equal("$45", display.SavingsMetric.Value);
        Assert.Equal("Savings/mo", display.SavingsMetric.Label);
    }

    [Fact]
    public void Project_metric_icons_use_the_web_accent_colours()
    {
        var display = ChargingOptimizerProjection.Project(Report(), new ChargingOptimizerSize(2, 2), Localizer);

        Assert.Equal("TsColorSuccessBrush", display.OptimalStartMetric.AccentBrushKey); // emerald-400
        Assert.Equal("TsColorInfoBrush", display.TargetSocMetric.AccentBrushKey);        // blue-400
        Assert.Equal("TsColorWarningBrush", display.SavingsMetric.AccentBrushKey);       // amber-400
    }

    [Fact]
    public void Project_compact_short_strings()
    {
        var display = ChargingOptimizerProjection.Project(Report(), new ChargingOptimizerSize(1, 2), Localizer);

        Assert.True(display.IsCompact);
        Assert.Equal("SOC 80%", display.TargetSocShortText);
        Assert.Equal("$45/mo", display.SavingsShortText);
        Assert.True(display.ShowSavingsBadge);
    }

    [Fact]
    public void Project_hides_savings_badge_when_zero()
    {
        var display = ChargingOptimizerProjection.Project(
            Report(savings: 0), new ChargingOptimizerSize(1, 2), Localizer);

        Assert.False(display.ShowSavingsBadge);
    }

    [Fact]
    public void Project_compact_automation_name_carries_metrics()
    {
        var display = ChargingOptimizerProjection.Project(Report(), new ChargingOptimizerSize(1, 2), Localizer);

        Assert.Contains("2 AM", display.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("SOC 80%", display.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("$45/mo", display.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_automation_name_omits_savings_when_zero()
    {
        var display = ChargingOptimizerProjection.Project(
            Report(savings: 0), new ChargingOptimizerSize(1, 2), Localizer);

        Assert.DoesNotContain("/mo", display.CompactAutomationName, StringComparison.Ordinal);
    }

    // ---- Projection: schedule-match badge ------------------------------------------

    [Theory]
    [InlineData(12, true, "Optimized", StatusKind.Success)]
    [InlineData(29, true, "Optimized", StatusKind.Success)]
    [InlineData(30, false, "Can improve", StatusKind.Warning)]
    [InlineData(55, false, "Can improve", StatusKind.Warning)]
    public void Project_schedule_badge_matches_web_threshold(
        double peakPct, bool optimized, string badge, StatusKind status)
    {
        var display = ChargingOptimizerProjection.Project(
            Report(peakPct: peakPct), new ChargingOptimizerSize(2, 2), Localizer);

        Assert.Equal(optimized, display.ScheduleMatchesOptimal);
        Assert.Equal(badge, display.ScheduleBadgeText);
        Assert.Equal(status, display.ScheduleBadgeStatus);
        Assert.Equal($"Peak charging: {(int)peakPct}%", display.PeakUsageText);
    }

    // ---- Projection: recommendation tips -------------------------------------------

    [Fact]
    public void Project_maps_recommendations_to_tips()
    {
        var display = ChargingOptimizerProjection.Project(
            Report(recommendations: new[] { Rec(priority: "high", title: "T", detail: "D") }),
            new ChargingOptimizerSize(2, 2),
            Localizer);

        var tip = Assert.Single(display.Tips);
        Assert.Equal("0", tip.Id);
        Assert.Equal("T", tip.Title);
        Assert.Equal("D", tip.Description);
        Assert.True(tip.HasImpact);
        Assert.Equal("high", tip.ImpactLabel); // passthrough -> raw priority
        Assert.Equal(StatusKind.Success, tip.ImpactStatus);
        Assert.Equal(ChargingOptimizerProjection.SparklesGlyph, tip.Glyph);
        Assert.Equal("TsColorTextSecondaryBrush", tip.IconBrushKey);
    }

    [Theory]
    [InlineData("high", StatusKind.Success)]
    [InlineData("medium", StatusKind.Warning)]
    [InlineData("low", StatusKind.Neutral)]
    public void Project_tip_badge_uses_impact_colour(string priority, StatusKind expected)
    {
        var tip = Assert.Single(ChargingOptimizerProjection.Project(
            Report(recommendations: new[] { Rec(priority: priority) }),
            new ChargingOptimizerSize(2, 2),
            Localizer).Tips);

        Assert.Equal(expected, tip.ImpactStatus);
        Assert.True(tip.HasImpact);
    }

    [Fact]
    public void Project_tip_with_unknown_priority_has_no_badge()
    {
        var tip = Assert.Single(ChargingOptimizerProjection.Project(
            Report(recommendations: new[] { Rec(priority: "urgent") }),
            new ChargingOptimizerSize(2, 2),
            Localizer).Tips);

        Assert.False(tip.HasImpact);
        Assert.Equal(StatusKind.Neutral, tip.ImpactStatus);
    }

    [Fact]
    public void Project_tip_with_empty_priority_has_no_badge_or_label()
    {
        var tip = Assert.Single(ChargingOptimizerProjection.Project(
            Report(recommendations: new[] { Rec(priority: "") }),
            new ChargingOptimizerSize(2, 2),
            Localizer).Tips);

        Assert.False(tip.HasImpact);
        Assert.Equal(string.Empty, tip.ImpactLabel);
    }

    [Fact]
    public void Project_tips_have_non_empty_accessibility_names()
    {
        var tip = Assert.Single(ChargingOptimizerProjection.Project(
            Report(recommendations: new[] { Rec(priority: "high", title: "Shift", detail: "Detail") }),
            new ChargingOptimizerSize(2, 2),
            Localizer).Tips);

        Assert.False(string.IsNullOrWhiteSpace(tip.AutomationName));
        Assert.Contains("Shift", tip.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Detail", tip.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_keeps_all_tips_and_exposes_max_cap_by_layout()
    {
        var recs = new[] { Rec(), Rec(), Rec(), Rec(), Rec(), Rec() };

        var standard = ChargingOptimizerProjection.Project(Report(recommendations: recs), new ChargingOptimizerSize(2, 2), Localizer);
        var wide = ChargingOptimizerProjection.Project(Report(recommendations: recs), new ChargingOptimizerSize(4, 4), Localizer);

        Assert.Equal(6, standard.Tips.Count); // projection keeps all; the view caps
        Assert.Equal(ChargingOptimizerProjection.MaxStandardTips, standard.MaxTips);
        Assert.Equal(ChargingOptimizerProjection.MaxWideTips, wide.MaxTips);
        Assert.Equal(3, ChargingOptimizerProjection.MaxStandardTips);
        Assert.Equal(5, ChargingOptimizerProjection.MaxWideTips);
    }

    [Fact]
    public void Project_no_recommendations_message_resolves_through_i18n()
    {
        var display = ChargingOptimizerProjection.Project(Report(), new ChargingOptimizerSize(2, 2), Localizer);

        Assert.Empty(display.Tips);
        Assert.Equal("No recommendations", display.NoRecommendationsMessage);
    }

    // ---- Projection: 24h rate timeline ---------------------------------------------

    [Fact]
    public void Project_builds_24_hour_timeline_with_peak_offpeak_standard_bands()
    {
        var display = ChargingOptimizerProjection.Project(Report(), new ChargingOptimizerSize(4, 4), Localizer);

        Assert.Equal(24, display.Segments.Count);
        Assert.Equal(OptimizerRateKind.Offpeak, display.Segments[0].Kind);
        Assert.Equal(OptimizerRateKind.Peak, display.Segments[17].Kind);
        Assert.Equal(OptimizerRateKind.Standard, display.Segments[10].Kind);
    }

    [Fact]
    public void Project_timeline_marks_optimal_start_hour()
    {
        var display = ChargingOptimizerProjection.Project(
            Report(startHour: 2), new ChargingOptimizerSize(4, 4), Localizer);

        Assert.True(display.Segments[2].IsCurrentStart);
        Assert.False(display.Segments[3].IsCurrentStart);
    }

    [Fact]
    public void Project_timeline_peak_wins_over_offpeak_on_conflict()
    {
        var display = ChargingOptimizerProjection.Project(
            Report(peakHours: new[] { 5 }, offpeakHours: new[] { 5 }),
            new ChargingOptimizerSize(4, 4),
            Localizer);

        Assert.Equal(OptimizerRateKind.Peak, display.Segments[5].Kind);
    }

    [Fact]
    public void Project_timeline_labels_are_localized_and_composed()
    {
        var display = ChargingOptimizerProjection.Project(Report(), new ChargingOptimizerSize(4, 4), Localizer);

        Assert.Equal("12 AM \u2014 Off-peak", display.Segments[0].Label);
        Assert.Equal("5 PM \u2014 Peak", display.Segments[17].Label);
        Assert.Equal("10 AM \u2014 Standard", display.Segments[10].Label);
    }

    [Theory]
    [InlineData(OptimizerRateKind.Peak, "Peak")]
    [InlineData(OptimizerRateKind.Offpeak, "Off-peak")]
    [InlineData(OptimizerRateKind.Standard, "Standard")]
    public void KindWord_resolves_through_i18n(OptimizerRateKind kind, string expected) =>
        Assert.Equal(expected, ChargingOptimizerProjection.KindWord(kind, Localizer));

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(FullJson);

        var cached = ChargingOptimizerResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.HasData);
        Assert.Equal(2, cached.Value!.OptimalStartHour);

        var offline = ChargingOptimizerResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.HasData);
    }

    [Fact]
    public void Mapper_loaded_with_data_is_loaded()
    {
        using var doc = JsonDocument.Parse(FullJson);
        Assert.Equal(LoadStatus.Loaded, ChargingOptimizerResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);
    }

    [Fact]
    public void Mapper_loaded_without_data_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Equal(LoadStatus.Empty, ChargingOptimizerResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);
    }

    [Fact]
    public void Mapper_maps_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Empty, ChargingOptimizerResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, ChargingOptimizerResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingOptimizerReport>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ChargingOptimizerState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_metrics_and_tips()
    {
        using var vm = NewViewModel(Loaded(Report(recommendations: new[] { Rec() })));
        await vm.LoadAsync();

        Assert.Equal(ChargingOptimizerState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal("2 AM", vm.Display.OptimalStartText);
        Assert.Single(vm.Display.Tips);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_data_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingOptimizerReport>.Loaded(ChargingOptimizerReport.Empty, Now));
        await vm.LoadAsync();

        Assert.Equal(ChargingOptimizerState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No optimizer data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingOptimizerReport>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ChargingOptimizerState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingOptimizerReport>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ChargingOptimizerState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_content()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingOptimizerReport>.Cached(Report(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ChargingOptimizerState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_content_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingOptimizerReport>.OfflineCached(
            Report(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ChargingOptimizerState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingOptimizerReport>.Loading(),
            RepositoryResult<ChargingOptimizerReport>.Cached(Report(savings: 10), Now, stale: false),
            RepositoryResult<ChargingOptimizerReport>.Loaded(Report(savings: 99), Now));
        await vm.LoadAsync();

        Assert.Equal(ChargingOptimizerState.Loaded, vm.State);
        Assert.Equal("$99", vm.Display.SavingsMetric.Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new ChargingOptimizerSize(2, 2), Loaded(Report()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new ChargingOptimizerSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(ChargingOptimizerState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_size_change_to_wide_exposes_timeline()
    {
        using var vm = NewViewModel(new ChargingOptimizerSize(2, 2), Loaded(Report()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsWide);

        vm.Size = new ChargingOptimizerSize(4, 4);
        Assert.True(vm.Display.IsWide);
        Assert.Equal(24, vm.Display.Segments.Count);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingOptimizerReport>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Charging Optimizer", vm.Title);
        Assert.Equal("No optimizer data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Report()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ChargingOptimizerViewModel.State), changed);
        Assert.Contains(nameof(ChargingOptimizerViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("charging-optimizer", ChargingOptimizerRegistration.Id);
        Assert.Equal("charging", ChargingOptimizerRegistration.Category);
        Assert.Equal("ChargingOptimizerWidget", ChargingOptimizerRegistration.Slug);
        Assert.Equal(new ChargingOptimizerSize(2, 2), ChargingOptimizerRegistration.DefaultSize);
        Assert.Equal(new ChargingOptimizerSize(1, 2), ChargingOptimizerRegistration.MinSize);
        Assert.Equal(new ChargingOptimizerSize(4, 40), ChargingOptimizerRegistration.MaxSize);
        Assert.Equal("Charging Optimizer", ChargingOptimizerRegistration.Name(Localizer));
        Assert.Contains("schedule", ChargingOptimizerRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 2, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, ChargingOptimizerRegistration.IsWithinBounds(new ChargingOptimizerSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ChargingOptimizerSize(1, 2), ChargingOptimizerRegistration.Clamp(new ChargingOptimizerSize(0, 0)));
        Assert.Equal(new ChargingOptimizerSize(4, 40), ChargingOptimizerRegistration.Clamp(new ChargingOptimizerSize(9, 99)));
    }

    [Fact]
    public void RegistryId_is_exposed_on_the_view_type() =>
        Assert.Equal("charging-optimizer", ChargingOptimizerRegistration.Id);

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChargingOptimizerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargingOptimizerWidget", Assert.Single(lines));
    }

    // ---- Source: vehicle resolution + request shape --------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new ChargingOptimizerSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_optimizer()
    {
        using var doc = JsonDocument.Parse(FullJson);
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new ChargingOptimizerSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.HasData);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_analytics_charging_optimizer", request.OperationId);
        Assert.Equal("get_api_v1_analytics_charging_optimizer", ChargingOptimizerSource.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_and_empty_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new ChargingOptimizerSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new FakeCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<ChargingOptimizerReport>>> Drain(IChargingOptimizerSource source)
    {
        var list = new List<RepositoryResult<ChargingOptimizerReport>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<ChargingOptimizerReport> Loaded(ChargingOptimizerReport report) =>
        RepositoryResult<ChargingOptimizerReport>.Loaded(report, Now);

    private static ChargingOptimizerViewModel NewViewModel(params RepositoryResult<ChargingOptimizerReport>[] emissions) =>
        NewViewModel(ChargingOptimizerSize.Default, emissions);

    private static ChargingOptimizerViewModel NewViewModel(
        ChargingOptimizerSize size,
        params RepositoryResult<ChargingOptimizerReport>[] emissions) =>
        new(new FakeChargingOptimizerSource(emissions), Localizer, size);

    private sealed class FakeChargingOptimizerSource(params RepositoryResult<ChargingOptimizerReport>[] emissions) : IChargingOptimizerSource
    {
        public async IAsyncEnumerable<RepositoryResult<ChargingOptimizerReport>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class FakeWidgetVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
