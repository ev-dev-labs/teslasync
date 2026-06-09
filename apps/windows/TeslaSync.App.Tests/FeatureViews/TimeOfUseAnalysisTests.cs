using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the TimeOfUseAnalysis surface's UI-thread-free logic — the charging-sessions JSON
/// parse adapter (started_at / cost_decimal / total_energy_added_wh), the hourly-bucket + time-of-use insight
/// projection (24 bars keyed by local hour, peak / mid / off-peak banding, cheapest / priciest / busiest hour,
/// off-peak share), the cache-then-network result mapper, the registration metadata, the diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline).
/// Mirrors the web spec (web/src/features/charging/components/cost-analysis/TimeOfUseAnalysis.tsx +
/// useCostAnalysisData.ts).
/// </summary>
public sealed class TimeOfUseAnalysisTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void Session_FromJson_reads_fields()
    {
        const string json = """
        { "started_at": "2024-01-15T14:30:00Z", "cost_decimal": 0.42, "total_energy_added_wh": 5000 }
        """;
        using var doc = JsonDocument.Parse(json);

        var session = TimeOfUseSession.FromJson(doc.RootElement);

        Assert.NotNull(session.StartedAt);
        Assert.Equal(0.42, session.Cost!.Value, 6);
        Assert.Equal(5000, session.EnergyWh, 6);
    }

    [Fact]
    public void Session_FromJson_tolerates_missing_fields_and_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{ "total_energy_added_wh": "1234.5" }""");

        var session = TimeOfUseSession.FromJson(doc.RootElement);

        Assert.Null(session.StartedAt);
        Assert.Null(session.Cost);
        Assert.Equal(1234.5, session.EnergyWh, 6);
    }

    [Fact]
    public void Report_FromJson_parses_array_and_tracks_has_data()
    {
        using var doc = JsonDocument.Parse("""
        [
          { "started_at": "2024-01-15T14:30:00Z", "cost_decimal": 0.30, "total_energy_added_wh": 1000 },
          { "started_at": "2024-01-15T02:30:00Z", "cost_decimal": 0.10, "total_energy_added_wh": 2000 }
        ]
        """);

        var report = TimeOfUseReport.FromJson(doc.RootElement);

        Assert.True(report.HasData);
        Assert.Equal(2, report.Sessions.Count);
    }

    [Fact]
    public void Report_FromJson_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{ "not": "an array" }""");
        var report = TimeOfUseReport.FromJson(doc.RootElement);

        Assert.False(report.HasData);
        Assert.Empty(report.Sessions);
    }

    [Fact]
    public void Report_FromJson_skips_non_object_rows()
    {
        using var doc = JsonDocument.Parse("""[ 1, "x", { "cost_decimal": 0.2 } ]""");
        var report = TimeOfUseReport.FromJson(doc.RootElement);

        Assert.Single(report.Sessions);
        Assert.Equal(0.2, report.Sessions[0].Cost!.Value, 6);
    }

    // ---- Classification (web inline peak / off-peak ternary) -----------------------

    [Theory]
    [InlineData(14, TouHourCategory.Peak)]
    [InlineData(19, TouHourCategory.Peak)]
    [InlineData(13, TouHourCategory.MidPeak)]
    [InlineData(20, TouHourCategory.MidPeak)]
    [InlineData(6, TouHourCategory.MidPeak)]
    [InlineData(22, TouHourCategory.OffPeak)]
    [InlineData(23, TouHourCategory.OffPeak)]
    [InlineData(0, TouHourCategory.OffPeak)]
    [InlineData(5, TouHourCategory.OffPeak)]
    public void Classify_bands_match_web(int hour, TouHourCategory expected)
    {
        Assert.Equal(expected, TimeOfUseAnalysisProjection.Classify(hour));
    }

    // ---- Projection: bars ----------------------------------------------------------

    [Fact]
    public void Project_builds_24_bars_when_sessions_present()
    {
        var view = TimeOfUseAnalysisProjection.Project(Report(Session(14, 0.30)), Localizer);

        Assert.True(view.HasData);
        Assert.True(view.HasHourlyBars);
        Assert.Equal(TimeOfUseAnalysisProjection.Hours, view.Bars.Count);
    }

    [Fact]
    public void Project_no_sessions_has_no_bars_or_insights()
    {
        var view = TimeOfUseAnalysisProjection.Project(TimeOfUseReport.Empty, Localizer);

        Assert.False(view.HasData);
        Assert.False(view.HasHourlyBars);
        Assert.Empty(view.Bars);
        Assert.False(view.HasInsights);
        Assert.Empty(view.Insights);
        Assert.False(string.IsNullOrWhiteSpace(view.EmptyMessage)); // never a blank box
    }

    [Fact]
    public void Project_buckets_sessions_by_local_hour()
    {
        var view = TimeOfUseAnalysisProjection.Project(
            Report(Session(14, 0.30), Session(14, 0.50), Session(2, 0.10)), Localizer);

        Assert.Equal(2, view.Bars[14].Sessions);
        Assert.Equal(1, view.Bars[2].Sessions);
        Assert.Equal(0, view.Bars[10].Sessions);
        Assert.Equal(0.40, view.Bars[14].AvgCost, 6); // (0.30 + 0.50) / 2
        Assert.Equal(0.10, view.Bars[2].AvgCost, 6);
    }

    [Fact]
    public void Project_bar_category_and_label()
    {
        var view = TimeOfUseAnalysisProjection.Project(Report(Session(14, 0.30)), Localizer);

        Assert.Equal(TouHourCategory.Peak, view.Bars[14].Category);
        Assert.Equal(TouHourCategory.OffPeak, view.Bars[2].Category);
        Assert.Equal(TouHourCategory.MidPeak, view.Bars[10].Category);
        Assert.Equal("14:00", view.Bars[14].Label);
        Assert.Equal("02:00", view.Bars[2].Label);
    }

    [Fact]
    public void Project_height_ratio_against_busiest_hour()
    {
        var view = TimeOfUseAnalysisProjection.Project(
            Report(Session(8, 0.2), Session(8, 0.2), Session(8, 0.2), Session(14, 0.3)), Localizer);

        Assert.Equal(1.0, view.Bars[8].HeightRatio, 6); // busiest -> full height
        Assert.Equal(1.0 / 3.0, view.Bars[14].HeightRatio, 6);
        Assert.Equal(0.0, view.Bars[0].HeightRatio, 6);
    }

    [Fact]
    public void Project_energy_converted_from_si_to_kwh()
    {
        var view = TimeOfUseAnalysisProjection.Project(Report(Session(10, 0.2, energyWh: 5000)), Localizer);
        Assert.Equal(5.0, view.Bars[10].EnergyKwh, 6); // 5000 Wh -> 5 kWh
    }

    [Fact]
    public void Project_null_cost_counts_as_zero()
    {
        var view = TimeOfUseAnalysisProjection.Project(
            Report(Session(9, cost: null), Session(9, cost: 0.20)), Localizer);

        Assert.Equal(2, view.Bars[9].Sessions);
        Assert.Equal(0.10, view.Bars[9].AvgCost, 6); // (0 + 0.20) / 2
    }

    // ---- Projection: insights ------------------------------------------------------

    [Fact]
    public void Project_insights_select_cheapest_priciest_busiest_and_offpeak()
    {
        // hour 2 (off-peak): 2 sessions @ 0.10 -> cheapest; hour 14 (peak): 1 @ 0.40 -> priciest;
        // hour 8 (mid): 3 @ 0.25 -> busiest. offPeak share = 2 / 6.
        var view = TimeOfUseAnalysisProjection.Project(
            Report(
                Session(2, 0.10), Session(2, 0.10),
                Session(14, 0.40),
                Session(8, 0.25), Session(8, 0.25), Session(8, 0.25)),
            Localizer);

        Assert.True(view.HasInsights);
        Assert.Equal(4, view.Insights.Count);

        var cheapest = view.Insights[0];
        Assert.Equal("Cheapest Hour", cheapest.Label);
        Assert.Equal("02:00", cheapest.Value);
        Assert.Equal(TouTone.Positive, cheapest.Tone);
        Assert.Contains("$0.100", cheapest.Caption);

        var priciest = view.Insights[1];
        Assert.Equal("Priciest Hour", priciest.Label);
        Assert.Equal("14:00", priciest.Value);
        Assert.Equal(TouTone.Negative, priciest.Tone);
        Assert.Contains("$0.400", priciest.Caption);

        var busiest = view.Insights[2];
        Assert.Equal("Busiest Hour", busiest.Label);
        Assert.Equal("08:00", busiest.Value);
        Assert.Equal(TouTone.Info, busiest.Tone);
        Assert.Contains("3", busiest.Caption);

        var offPeak = view.Insights[3];
        Assert.Equal("Off-Peak Charging", offPeak.Label);
        Assert.Equal("33.3%", offPeak.Value); // 2 / 6 = 33.33%
        Assert.Equal(TouTone.Positive, offPeak.Tone);
    }

    [Fact]
    public void Project_insight_ties_resolve_to_lowest_hour()
    {
        // Two hours share the cheapest avg cost; the web stable sort keeps the lowest hour.
        var view = TimeOfUseAnalysisProjection.Project(
            Report(Session(2, 0.10), Session(5, 0.10), Session(14, 0.40)), Localizer);

        Assert.Equal("02:00", view.Insights[0].Value); // cheapest -> lowest hour on tie
    }

    [Fact]
    public void Project_offpeak_share_uses_total_session_count()
    {
        // 3 off-peak (hours 2, 4, 23) of 4 total -> 75%.
        var view = TimeOfUseAnalysisProjection.Project(
            Report(Session(2, 0.1), Session(4, 0.1), Session(23, 0.1), Session(14, 0.5)), Localizer);

        Assert.Equal("75.0%", view.Insights[3].Value);
    }

    [Fact]
    public void Project_legend_has_three_bands()
    {
        var view = TimeOfUseAnalysisProjection.Project(Report(Session(10, 0.2)), Localizer);

        Assert.Equal(3, view.Legend.Count);
        Assert.Equal(TouHourCategory.Peak, view.Legend[0].Category);
        Assert.Equal(TouHourCategory.MidPeak, view.Legend[1].Category);
        Assert.Equal(TouHourCategory.OffPeak, view.Legend[2].Category);
    }

    // ---- i18n: every label resolves through its catalog key ------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var view = TimeOfUseAnalysisProjection.Project(Report(Session(2, 0.10), Session(8, 0.25)), echo);

        Assert.Equal("L:costAnalysis.tou.title", view.Title);
        Assert.Equal("L:costAnalysis.empty.title", view.EmptyMessage);
        Assert.Equal("L:costAnalysis.charts.noData", view.ChartEmptyMessage);
        Assert.Equal("L:costAnalysis.tou.insights", view.InsightsHeading);
        Assert.Equal("L:costAnalysis.tou.noInsights", view.NoInsightsMessage);
        Assert.Equal("L:costAnalysis.tou.sessions", view.SessionsLabel);
        Assert.Equal("L:costAnalysis.tou.peak", view.Legend[0].Label);
        Assert.Equal("L:costAnalysis.tou.midPeak", view.Legend[1].Label);
        Assert.Equal("L:costAnalysis.tou.offPeak", view.Legend[2].Label);
        Assert.Equal("L:costAnalysis.tou.cheapestHour", view.Insights[0].Label);
        Assert.Equal("L:costAnalysis.tou.priciestHour", view.Insights[1].Label);
        Assert.Equal("L:costAnalysis.tou.busiestHour", view.Insights[2].Label);
        Assert.Equal("L:costAnalysis.tou.offPeakRatio", view.Insights[3].Label);
        Assert.Contains("L:costAnalysis.tou.avgCost", view.Insights[0].Caption);
        Assert.Contains("L:costAnalysis.tou.perSession", view.Insights[0].Caption);
        Assert.Contains("L:charging.curve.sessions", view.Insights[2].Caption);
        Assert.Equal("L:costAnalysis.tou.offPeakDesc", view.Insights[3].Caption);
    }

    // ---- a11y: every bar and card carries a spoken label ---------------------------

    [Fact]
    public void Every_bar_and_card_carries_a_non_empty_automation_name()
    {
        var view = TimeOfUseAnalysisProjection.Project(
            Report(Session(2, 0.10), Session(14, 0.40), Session(8, 0.25)), Localizer);

        Assert.All(view.Bars, b => Assert.False(string.IsNullOrWhiteSpace(b.AutomationName)));
        Assert.All(view.Insights, c => Assert.False(string.IsNullOrWhiteSpace(c.AutomationName)));
        Assert.Contains("02:00", view.Bars[2].AutomationName);
        Assert.Contains("Cheapest Hour", view.Insights[0].AutomationName);
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_value()
    {
        using var doc = JsonDocument.Parse("""
        [ { "started_at": "2024-01-15T14:30:00Z", "cost_decimal": 0.3, "total_energy_added_wh": 1000 } ]
        """);

        var cached = TimeOfUseAnalysisResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.HasData);

        var offline = TimeOfUseAnalysisResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.HasData);
    }

    [Fact]
    public void Mapper_maps_loading_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loading, TimeOfUseAnalysisResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Empty, TimeOfUseAnalysisResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, TimeOfUseAnalysisResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<TimeOfUseReport>.Loading());
        await vm.LoadAsync();

        Assert.Equal(TimeOfUseAnalysisState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_content()
    {
        using var vm = NewViewModel(Loaded(Report(Session(14, 0.30))));
        await vm.LoadAsync();

        Assert.Equal(TimeOfUseAnalysisState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.Display.HasHourlyBars);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_sessions_renders_empty()
    {
        using var vm = NewViewModel(Loaded(TimeOfUseReport.Empty));
        await vm.LoadAsync();

        Assert.Equal(TimeOfUseAnalysisState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.Display.EmptyMessage)); // never a blank box
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<TimeOfUseReport>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(TimeOfUseAnalysisState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<TimeOfUseReport>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(TimeOfUseAnalysisState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<TimeOfUseReport>.Cached(
            Report(Session(14, 0.30)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(TimeOfUseAnalysisState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<TimeOfUseReport>.OfflineCached(
            Report(Session(14, 0.30)),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(TimeOfUseAnalysisState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<TimeOfUseReport>.Loading(),
            RepositoryResult<TimeOfUseReport>.Cached(Report(Session(2, 0.10)), Now, stale: false),
            RepositoryResult<TimeOfUseReport>.Loaded(Report(Session(14, 0.30)), Now));
        await vm.LoadAsync();

        Assert.Equal(TimeOfUseAnalysisState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<TimeOfUseReport>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Electricity Rate Analysis (Time-of-Use)", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Report(Session(14, 0.30))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(TimeOfUseAnalysisViewModel.State), changed);
        Assert.Contains(nameof(TimeOfUseAnalysisViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("time-of-use-analysis", TimeOfUseAnalysisRegistration.Id);
        Assert.Equal("charging", TimeOfUseAnalysisRegistration.Category);
        Assert.Equal("TimeOfUseAnalysis", TimeOfUseAnalysisRegistration.Slug);
        Assert.Equal("Electricity Rate Analysis (Time-of-Use)", TimeOfUseAnalysisRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TimeOfUseAnalysisDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TimeOfUseAnalysis", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    // A DateTimeOffset whose local-time hour is exactly <paramref name="hour"/> on any machine timezone — the
    // deterministic analogue of a charging session whose web new Date(started_at).getHours() == hour. Jan 15
    // avoids every DST transition so the local wall-clock hour round-trips cleanly.
    private static DateTimeOffset AtLocalHour(int hour) =>
        new(new DateTime(2024, 1, 15, hour, 30, 0, DateTimeKind.Local));

    private static TimeOfUseSession Session(int hour, double? cost, double energyWh = 0) =>
        new(AtLocalHour(hour), cost, energyWh);

    private static TimeOfUseReport Report(params TimeOfUseSession[] sessions) =>
        new(sessions);

    private static RepositoryResult<TimeOfUseReport> Loaded(TimeOfUseReport report) =>
        RepositoryResult<TimeOfUseReport>.Loaded(report, Now);

    private static TimeOfUseAnalysisViewModel NewViewModel(params RepositoryResult<TimeOfUseReport>[] emissions) =>
        new(new FakeTimeOfUseAnalysisSource(emissions), Localizer);

    private sealed class FakeTimeOfUseAnalysisSource(params RepositoryResult<TimeOfUseReport>[] emissions)
        : ITimeOfUseAnalysisSource
    {
        public async IAsyncEnumerable<RepositoryResult<TimeOfUseReport>> StreamAsync(
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
