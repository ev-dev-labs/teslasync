using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the OptimizerSection's UI-thread-free logic — the charging-optimizer JSON parse
/// adapter (current_schedule + cost_analysis + battery_health_score + recommendations + weekly_heatmap), the
/// projection (savings-banner gate, habit rows, battery-friendly score band + caption, cost rows + per-value
/// tones, reused heatmap, recommendation cards), the cache-then-network result mapper, the registration
/// metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded /
/// empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/charging/components/charging-list/OptimizerSection.tsx).
/// </summary>
public sealed class OptimizerSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    private const string FullJson = """
    {
      "current_schedule": {
        "most_common_start_hour": 23,
        "most_common_day": "Monday",
        "avg_sessions_per_week": 7.5,
        "home_charging_pct": 80,
        "avg_charge_to_pct": 90
      },
      "cost_analysis": {
        "peak_hours": [16, 17, 18],
        "offpeak_hours": [0, 1, 2],
        "peak_cost_per_kwh": 0.42,
        "offpeak_cost_per_kwh": 0.12,
        "sessions_during_peak_pct": 40,
        "potential_monthly_savings": 12
      },
      "battery_health_score": 82,
      "recommendations": [
        { "type": "shift", "priority": "high", "title": "Shift to off-peak", "detail": "Charge after midnight", "estimated_savings": 15 }
      ],
      "weekly_heatmap": [
        { "day": 1, "hour": 14, "sessions": 3, "avg_cost_per_kwh": 0.3 }
      ]
    }
    """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void Recommendation_FromJson_reads_fields()
    {
        using var doc = JsonDocument.Parse("""
        { "type": "shift", "priority": "high", "title": "Shift", "detail": "Charge late", "estimated_savings": 15 }
        """);

        var rec = OptimizerSectionRecommendation.FromJson(doc.RootElement);

        Assert.Equal("shift", rec.Type);
        Assert.Equal("high", rec.Priority);
        Assert.Equal("Shift", rec.Title);
        Assert.Equal("Charge late", rec.Detail);
        Assert.Equal(15, rec.EstimatedSavings);
    }

    [Fact]
    public void Recommendation_FromJson_falls_back_to_em_dash_for_missing_text()
    {
        using var doc = JsonDocument.Parse("""{ "priority": "low" }""");

        var rec = OptimizerSectionRecommendation.FromJson(doc.RootElement);

        Assert.Equal("\u2014", rec.Title);
        Assert.Equal("\u2014", rec.Detail);
        Assert.Null(rec.EstimatedSavings);
    }

    [Fact]
    public void Report_FromJson_reads_every_slice()
    {
        using var doc = JsonDocument.Parse(FullJson);

        var report = OptimizerSectionReport.FromJson(doc.RootElement);

        Assert.True(report.HasData);
        Assert.Equal(7.5, report.Schedule.AvgSessionsPerWeek, 6);
        Assert.Equal(80, report.Schedule.HomeChargingPct, 6);
        Assert.Equal(90, report.Schedule.AvgChargeToPct, 6);
        Assert.Equal(23, report.Schedule.MostCommonStartHour);
        Assert.Equal("Monday", report.Schedule.MostCommonDay);
        Assert.Equal(0.42, report.Cost.PeakCostPerKwh, 6);
        Assert.Equal(0.12, report.Cost.OffpeakCostPerKwh, 6);
        Assert.Equal(40, report.Cost.SessionsDuringPeakPct, 6);
        Assert.Equal(12, report.Cost.PotentialMonthlySavings, 6);
        Assert.Equal(new[] { 16, 17, 18 }, report.Cost.PeakHours);
        Assert.Equal(new[] { 0, 1, 2 }, report.Cost.OffpeakHours);
        Assert.Equal(82, report.BatteryHealthScore, 6);
        Assert.Single(report.Recommendations);
        Assert.Equal("high", report.Recommendations[0].Priority);
        // Heatmap slice reuses the sibling CostHeatmapReport (weekly_heatmap + peak rate).
        Assert.True(report.Heatmap.HasData);
        Assert.Single(report.Heatmap.Entries);
        Assert.Equal(0.42, report.Heatmap.PeakCostPerKwh, 6);
    }

    [Fact]
    public void Report_FromJson_tolerates_missing_fields_and_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""
        { "current_schedule": { "avg_sessions_per_week": "3" }, "battery_health_score": "55" }
        """);

        var report = OptimizerSectionReport.FromJson(doc.RootElement);

        Assert.True(report.HasData);
        Assert.Equal(3, report.Schedule.AvgSessionsPerWeek, 6);
        Assert.Equal(0, report.Schedule.HomeChargingPct, 6);
        Assert.Equal(string.Empty, report.Schedule.MostCommonDay);
        Assert.Equal(55, report.BatteryHealthScore, 6);
        Assert.Empty(report.Recommendations);
        Assert.False(report.Heatmap.HasData);
    }

    [Fact]
    public void Report_FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[ 1, 2, 3 ]");
        var report = OptimizerSectionReport.FromJson(doc.RootElement);

        Assert.False(report.HasData);
        Assert.Empty(report.Recommendations);
    }

    [Fact]
    public void Report_FromJson_empty_object_has_no_data()
    {
        using var doc = JsonDocument.Parse("{}");
        var report = OptimizerSectionReport.FromJson(doc.RootElement);

        Assert.False(report.HasData);
    }

    // ---- Projection: savings banner ------------------------------------------------

    [Fact]
    public void Project_savings_banner_shown_above_threshold_and_substitutes_amount()
    {
        var view = OptimizerSectionProjection.Project(Report(savings: 12), Localizer);

        Assert.True(view.ShowSavingsBanner);
        Assert.Contains("$12", view.SavingsBannerTitle, StringComparison.Ordinal);
        Assert.False(string.IsNullOrWhiteSpace(view.SavingsBannerMessage));
    }

    [Theory]
    [InlineData(5, false)] // web: strictly > 5
    [InlineData(0, false)]
    [InlineData(6, true)]
    public void Project_savings_banner_gate_matches_web(double savings, bool shown)
    {
        var view = OptimizerSectionProjection.Project(Report(savings: savings), Localizer);
        Assert.Equal(shown, view.ShowSavingsBanner);
    }

    // ---- Projection: habit rows ----------------------------------------------------

    [Fact]
    public void Project_habit_rows_are_formatted()
    {
        var view = OptimizerSectionProjection.Project(Report(), Localizer);

        Assert.Equal(5, view.HabitRows.Count);
        Assert.Equal("Sessions/week", view.HabitRows[0].Label);
        Assert.Equal("7.5", view.HabitRows[0].Value);
        Assert.Equal("80%", view.HabitRows[1].Value);
        Assert.Equal("90%", view.HabitRows[2].Value);
        Assert.Equal("23:00", view.HabitRows[3].Value);
        Assert.Equal("Monday", view.HabitRows[4].Value);
        Assert.All(view.HabitRows, r => Assert.Equal(OptimizerValueTone.Primary, r.Tone));
    }

    [Fact]
    public void Project_habit_common_day_falls_back_to_em_dash()
    {
        var report = Report() with { Schedule = new OptimizerSectionSchedule(1, 1, 1, 1, string.Empty) };
        var view = OptimizerSectionProjection.Project(report, Localizer);

        Assert.Equal("\u2014", view.HabitRows[4].Value);
    }

    // ---- Projection: battery-friendly score band ----------------------------------

    [Theory]
    [InlineData(80, "charging.optimizer.scoreGood", StatusKind.Success)]
    [InlineData(75, "charging.optimizer.scoreGood", StatusKind.Success)]
    [InlineData(60, "charging.optimizer.scoreFair", StatusKind.Warning)]
    [InlineData(50, "charging.optimizer.scoreFair", StatusKind.Warning)]
    [InlineData(40, "charging.optimizer.scorePoor", StatusKind.Danger)]
    public void Project_battery_score_band(double score, string captionKey, StatusKind status)
    {
        var echo = new KeyEchoLocalizer();
        var view = OptimizerSectionProjection.Project(Report(score: score), echo);

        Assert.Equal(score, view.BatteryHealthScore, 6);
        Assert.Equal("L:" + captionKey, view.BatteryScoreCaption);
        Assert.Equal(status, view.BatteryScoreStatus);
    }

    // ---- Projection: cost rows + per-value tones ----------------------------------

    [Fact]
    public void Project_cost_rows_are_formatted_with_web_tones()
    {
        var view = OptimizerSectionProjection.Project(Report(), Localizer);

        Assert.Equal(5, view.CostRows.Count);
        Assert.Equal("$0.420/kWh", view.CostRows[0].Value);
        Assert.Equal(OptimizerValueTone.Danger, view.CostRows[0].Tone); // peak rate
        Assert.Equal("$0.120/kWh", view.CostRows[1].Value);
        Assert.Equal(OptimizerValueTone.Success, view.CostRows[1].Tone); // off-peak rate
        Assert.Equal("40%", view.CostRows[2].Value);
        Assert.Equal(OptimizerValueTone.Danger, view.CostRows[2].Tone); // peak share > 30
        Assert.Equal("16:00, 17:00, 18:00", view.CostRows[3].Value);
        Assert.Equal(OptimizerValueTone.Muted, view.CostRows[3].Tone);
        Assert.Equal("0:00, 1:00, 2:00", view.CostRows[4].Value);
        Assert.Equal(OptimizerValueTone.Muted, view.CostRows[4].Tone);
    }

    [Fact]
    public void Project_peak_share_in_threshold_is_success_toned()
    {
        var report = Report() with
        {
            Cost = new OptimizerSectionCost(0.42, 0.12, 20, 12, new[] { 16 }, new[] { 1 }),
        };
        var view = OptimizerSectionProjection.Project(report, Localizer);

        Assert.Equal(OptimizerValueTone.Success, view.CostRows[2].Tone); // 20 <= 30
    }

    [Fact]
    public void Project_empty_hour_lists_render_em_dash()
    {
        var report = Report() with
        {
            Cost = new OptimizerSectionCost(0.42, 0.12, 40, 12, Array.Empty<int>(), Array.Empty<int>()),
        };
        var view = OptimizerSectionProjection.Project(report, Localizer);

        Assert.Equal("\u2014", view.CostRows[3].Value);
        Assert.Equal("\u2014", view.CostRows[4].Value);
    }

    // ---- Projection: heatmap reuse -------------------------------------------------

    [Fact]
    public void Project_heatmap_reuses_cost_heatmap_projection_when_present()
    {
        var view = OptimizerSectionProjection.Project(Report(), Localizer);

        Assert.True(view.ShowHeatmap);
        Assert.Equal(CostHeatmapProjection.Days, view.Heatmap.Rows.Count);
        Assert.All(view.Heatmap.Rows, r => Assert.Equal(CostHeatmapProjection.Hours, r.Cells.Count));
    }

    [Fact]
    public void Project_heatmap_hidden_when_no_weekly_entries()
    {
        var report = Report() with { Heatmap = CostHeatmapReport.Empty };
        var view = OptimizerSectionProjection.Project(report, Localizer);

        Assert.False(view.ShowHeatmap);
    }

    // ---- Projection: recommendations ----------------------------------------------

    [Fact]
    public void Project_recommendation_card_carries_status_savings_and_automation()
    {
        var view = OptimizerSectionProjection.Project(
            Report(12, 82, Rec("high", "Shift to off-peak", "Charge after midnight", 15)), Localizer);

        Assert.True(view.HasRecommendations);
        var rec = Assert.Single(view.Recommendations);
        Assert.Equal("Shift to off-peak", rec.Title);
        Assert.Equal(StatusKind.Danger, rec.Status);
        Assert.True(rec.ShowSavings);
        Assert.Equal("~$15/mo", rec.SavingsLabel);
        Assert.Contains("Shift to off-peak", rec.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Charge after midnight", rec.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_recommendation_without_savings_hides_chip()
    {
        var view = OptimizerSectionProjection.Project(Report(12, 82, Rec("low", "Tip", "Detail", null)), Localizer);

        var rec = Assert.Single(view.Recommendations);
        Assert.False(rec.ShowSavings);
        Assert.Equal(string.Empty, rec.SavingsLabel);
        Assert.Equal(StatusKind.Success, rec.Status); // low -> success
    }

    [Fact]
    public void Project_no_recommendations_renders_friendly_message()
    {
        var view = OptimizerSectionProjection.Project(Report(), Localizer);

        Assert.False(view.HasRecommendations);
        Assert.Empty(view.Recommendations);
        Assert.False(string.IsNullOrWhiteSpace(view.NoRecommendationsMessage)); // never a blank box
    }

    [Theory]
    [InlineData("high", StatusKind.Danger)]
    [InlineData("medium", StatusKind.Warning)]
    [InlineData("low", StatusKind.Success)]
    [InlineData("", StatusKind.Success)]
    public void RecommendationStatus_maps_web_priority_colours(string priority, StatusKind expected)
    {
        Assert.Equal(expected, OptimizerSectionProjection.RecommendationStatus(priority));
    }

    // ---- i18n: every label resolves through its catalog key ------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var view = OptimizerSectionProjection.Project(Report(savings: 12), echo);

        Assert.StartsWith("L:charging.optimizer.savingsBanner", view.SavingsBannerTitle, StringComparison.Ordinal);
        Assert.Equal("L:charging.optimizer.savingsDetail", view.SavingsBannerMessage);
        Assert.Equal("L:charging.optimizer.habits", view.HabitsTitle);
        Assert.Equal("L:charging.optimizer.sessionsWeek", view.HabitRows[0].Label);
        Assert.Equal("L:charging.optimizer.homePct", view.HabitRows[1].Label);
        Assert.Equal("L:charging.optimizer.avgTarget", view.HabitRows[2].Label);
        Assert.Equal("L:charging.optimizer.commonHour", view.HabitRows[3].Label);
        Assert.Equal("L:charging.optimizer.commonDay", view.HabitRows[4].Label);
        Assert.Equal("L:charging.optimizer.batteryScore", view.BatteryScoreTitle);
        Assert.Equal("L:charging.optimizer.costAnalysis", view.CostAnalysisTitle);
        Assert.Equal("L:charging.optimizer.peakRate", view.CostRows[0].Label);
        Assert.Equal("L:charging.optimizer.offpeakRate", view.CostRows[1].Label);
        Assert.Equal("L:charging.optimizer.peakSessions", view.CostRows[2].Label);
        Assert.Equal("L:charging.optimizer.peakHours", view.CostRows[3].Label);
        Assert.Equal("L:charging.optimizer.offpeakHours", view.CostRows[4].Label);
        Assert.Equal("L:charging.optimizer.recommendations", view.RecommendationsTitle);
        Assert.Equal("L:charging.optimizer.noRecs", view.NoRecommendationsMessage);
    }

    // ---- a11y: every row/recommendation carries a spoken label ---------------------

    [Fact]
    public void Recommendation_automation_names_are_non_empty()
    {
        var view = OptimizerSectionProjection.Project(
            Report(12, 82, Rec("high", "A", "B", 5), Rec("low", "C", "D", null)), Localizer);

        Assert.All(view.Recommendations, r => Assert.False(string.IsNullOrWhiteSpace(r.AutomationName)));
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_value()
    {
        using var doc = JsonDocument.Parse(FullJson);

        var cached = OptimizerSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.HasData);

        var offline = OptimizerSectionResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.HasData);
    }

    [Fact]
    public void Mapper_maps_loading_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loading, OptimizerSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Empty, OptimizerSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, OptimizerSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_loaded_with_no_body_to_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        var mapped = OptimizerSectionResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status); // web !data parity
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<OptimizerSectionReport>.Loading());
        await vm.LoadAsync();

        Assert.Equal(OptimizerSectionState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_content()
    {
        using var vm = NewViewModel(Loaded(Report(savings: 12)));
        await vm.LoadAsync();

        Assert.Equal(OptimizerSectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.Display.ShowSavingsBanner);
        Assert.Equal(5, vm.Display.HabitRows.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_body_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<OptimizerSectionReport>.Loaded(OptimizerSectionReport.Empty, Now));
        await vm.LoadAsync();

        Assert.Equal(OptimizerSectionState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage)); // never a blank box
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<OptimizerSectionReport>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(OptimizerSectionState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<OptimizerSectionReport>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(OptimizerSectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_content()
    {
        using var vm = NewViewModel(RepositoryResult<OptimizerSectionReport>.Cached(Report(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(OptimizerSectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_content_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<OptimizerSectionReport>.OfflineCached(
            Report(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(OptimizerSectionState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<OptimizerSectionReport>.Loading(),
            RepositoryResult<OptimizerSectionReport>.Cached(Report(), Now, stale: false),
            RepositoryResult<OptimizerSectionReport>.Loaded(Report(savings: 20), Now));
        await vm.LoadAsync();

        Assert.Equal(OptimizerSectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<OptimizerSectionReport>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Charging Optimizer", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Report()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(OptimizerSectionViewModel.State), changed);
        Assert.Contains(nameof(OptimizerSectionViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("optimizer-section", OptimizerSectionRegistration.Id);
        Assert.Equal("charging", OptimizerSectionRegistration.Category);
        Assert.Equal("OptimizerSection", OptimizerSectionRegistration.Slug);
        Assert.Equal("Charging Optimizer", OptimizerSectionRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new OptimizerSectionDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=OptimizerSection", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static OptimizerSectionRecommendation Rec(string priority, string title, string detail, double? savings) =>
        new("type", priority, title, detail, savings);

    private static OptimizerSectionReport Report(double savings = 12, double score = 82, params OptimizerSectionRecommendation[] recs) =>
        new(
            HasData: true,
            Schedule: new OptimizerSectionSchedule(7.5, 80, 90, 23, "Monday"),
            Cost: new OptimizerSectionCost(0.42, 0.12, 40, savings, new[] { 16, 17, 18 }, new[] { 0, 1, 2 }),
            BatteryHealthScore: score,
            Recommendations: recs,
            Heatmap: new CostHeatmapReport(new[] { new CostHeatmapEntry(1, 14, 3, 0.3) }, 0.42));

    private static RepositoryResult<OptimizerSectionReport> Loaded(OptimizerSectionReport report) =>
        RepositoryResult<OptimizerSectionReport>.Loaded(report, Now);

    private static OptimizerSectionViewModel NewViewModel(params RepositoryResult<OptimizerSectionReport>[] emissions) =>
        new(new FakeOptimizerSectionSource(emissions), Localizer);

    private sealed class FakeOptimizerSectionSource(params RepositoryResult<OptimizerSectionReport>[] emissions)
        : IOptimizerSectionSource
    {
        public async IAsyncEnumerable<RepositoryResult<OptimizerSectionReport>> StreamAsync(
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

    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
