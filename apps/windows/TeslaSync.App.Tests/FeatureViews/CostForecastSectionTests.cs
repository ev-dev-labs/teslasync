using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the CostForecastSection's UI-thread-free logic — the cost-forecast JSON parse
/// adapter (historical + forecast with the 95% confidence bounds), the projection (the forecast composed
/// chart's three series, the cost-per-kWh trend line, the web gating, the ordinal month axis, the i18n keys
/// and the accessibility labels), the cache-then-network result mapper, the registration metadata, the
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error /
/// stale / offline). Mirrors the web spec
/// (web/src/features/charging/components/cost-analysis/CostForecastSection.tsx).
/// </summary>
public sealed class CostForecastSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_historical_and_forecast_fields()
    {
        const string json = """
        {
          "historical": [
            { "month": "Jan", "cost": 120.5, "kwh": 300, "sessions": 8, "cost_per_kwh": 0.14 }
          ],
          "forecast": [
            { "month": "Jul", "cost": 130, "cost_low": 110, "cost_high": 150, "kwh": 310 }
          ]
        }
        """;
        using var doc = JsonDocument.Parse(json);

        var data = CostForecastSectionData.FromJson(doc.RootElement);

        Assert.Single(data.Historical);
        Assert.Equal("Jan", data.Historical[0].Month);
        Assert.Equal(120.5, data.Historical[0].Cost);
        Assert.Equal(0.14, data.Historical[0].CostPerKwh);

        Assert.Single(data.Forecast);
        Assert.Equal("Jul", data.Forecast[0].Month);
        Assert.Equal(130, data.Forecast[0].Cost);
        Assert.Equal(110, data.Forecast[0].CostLow);
        Assert.Equal(150, data.Forecast[0].CostHigh);
    }

    [Fact]
    public void FromJson_defaults_confidence_bounds_to_cost_when_absent()
    {
        using var doc = JsonDocument.Parse("""{ "forecast": [ { "month": "Jul", "cost": 130 } ] }""");

        var data = CostForecastSectionData.FromJson(doc.RootElement);

        Assert.Equal(130, data.Forecast[0].CostLow);
        Assert.Equal(130, data.Forecast[0].CostHigh);
    }

    [Fact]
    public void FromJson_tolerates_numeric_strings_and_missing_month()
    {
        using var doc = JsonDocument.Parse("""{ "historical": [ { "cost": "90.25", "cost_per_kwh": "0.2" } ] }""");

        var data = CostForecastSectionData.FromJson(doc.RootElement);

        Assert.Single(data.Historical);
        Assert.Equal("\u2014", data.Historical[0].Month);
        Assert.Equal(90.25, data.Historical[0].Cost);
        Assert.Equal(0.2, data.Historical[0].CostPerKwh);
        Assert.Empty(data.Forecast);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var data = CostForecastSectionData.FromJson(doc.RootElement);
        Assert.Empty(data.Historical);
        Assert.Empty(data.Forecast);
    }

    // ---- Projection: gating (web hasForecast / hasCostPerKwhTrend) ------------------

    [Fact]
    public void Project_gates_forecast_chart_on_three_history_and_a_forecast()
    {
        var enough = Project(Data(History(3), Forecast(1)));
        Assert.True(enough.HasForecastChart);

        var tooFewHistory = Project(Data(History(2), Forecast(1)));
        Assert.False(tooFewHistory.HasForecastChart);

        var noForecast = Project(Data(History(5), Forecast(0)));
        Assert.False(noForecast.HasForecastChart);
    }

    [Fact]
    public void Project_gates_trend_chart_on_more_than_one_history_month()
    {
        Assert.True(Project(Data(History(2), Forecast(0))).HasTrendChart);
        Assert.False(Project(Data(History(1), Forecast(0))).HasTrendChart);
    }

    // ---- Projection: forecast composed series --------------------------------------

    [Fact]
    public void Project_builds_three_forecast_series_in_order()
    {
        var view = Project(Data(History(3), Forecast(2)));

        Assert.Equal(3, view.ForecastSeries.Count);

        // Order (background-to-foreground): 95% Confidence area, Actual Cost area, Projected Cost line.
        Assert.Equal("95% Confidence", view.ForecastSeries[0].Name);
        Assert.Equal(ChartSeriesKind.Area, view.ForecastSeries[0].Kind);
        Assert.Equal(2, view.ForecastSeries[0].Points.Count);

        Assert.Equal("Actual Cost", view.ForecastSeries[1].Name);
        Assert.Equal(ChartSeriesKind.Area, view.ForecastSeries[1].Kind);
        Assert.Equal(3, view.ForecastSeries[1].Points.Count);

        Assert.Equal("Projected Cost", view.ForecastSeries[2].Name);
        Assert.Equal(ChartSeriesKind.Line, view.ForecastSeries[2].Kind);
        Assert.Equal(2, view.ForecastSeries[2].Points.Count);
    }

    [Fact]
    public void Project_confidence_series_uses_the_upper_bound()
    {
        var data = new CostForecastSectionData(
            History(3),
            new[] { new CostForecastProjectionPoint("Jul", 130, 110, 150) });

        var view = Project(data);

        // Confidence envelope = cost_high (web ci_band upper bound).
        Assert.Equal(150, view.ForecastSeries[0].Points[0].Y);
        // Projected line = cost.
        Assert.Equal(130, view.ForecastSeries[2].Points[0].Y);
    }

    [Fact]
    public void Project_forecast_x_is_ordinal_historical_then_forecast()
    {
        var view = Project(Data(History(3), Forecast(2)));

        // Actual covers historical indices 0..2; forecast starts at the historical count.
        Assert.Equal(0, view.ForecastSeries[1].Points[0].X);
        Assert.Equal(2, view.ForecastSeries[1].Points[2].X);
        Assert.Equal(3, view.ForecastSeries[2].Points[0].X);
        Assert.Equal(4, view.ForecastSeries[2].Points[1].X);
    }

    [Fact]
    public void Project_forecast_points_carry_the_month_label()
    {
        var data = new CostForecastSectionData(
            new[] { new CostForecastHistoryPoint("Jan", 100, 0.1), new CostForecastHistoryPoint("Feb", 100, 0.1), new CostForecastHistoryPoint("Mar", 100, 0.1) },
            new[] { new CostForecastProjectionPoint("Apr", 120, 110, 130) });

        var view = Project(data);

        Assert.Equal("Jan", view.ForecastSeries[1].Points[0].Label);
        Assert.Equal("Apr", view.ForecastSeries[2].Points[0].Label);
        Assert.Equal(new[] { "Jan", "Feb", "Mar", "Apr" }, view.ForecastMonths);
    }

    // ---- Projection: cost-per-kWh trend --------------------------------------------

    [Fact]
    public void Project_trend_series_uses_cost_per_kwh()
    {
        var data = new CostForecastSectionData(
            new[]
            {
                new CostForecastHistoryPoint("Jan", 100, 0.12),
                new CostForecastHistoryPoint("Feb", 110, 0.15),
            },
            Array.Empty<CostForecastProjectionPoint>());

        var view = Project(data);

        Assert.True(view.HasTrendChart);
        Assert.Single(view.TrendSeries);
        Assert.Equal("$/kWh", view.TrendSeries[0].Name);
        Assert.Equal(ChartSeriesKind.Line, view.TrendSeries[0].Kind);
        Assert.Equal(2, view.TrendSeries[0].Decimals);
        Assert.Equal(2, view.TrendSeries[0].Points.Count);
        Assert.Equal(0.12, view.TrendSeries[0].Points[0].Y);
        Assert.Equal(0.15, view.TrendSeries[0].Points[1].Y);
        Assert.Equal(new[] { "Jan", "Feb" }, view.TrendMonths);
    }

    [Fact]
    public void Project_series_carry_a_currency_unit()
    {
        var view = CostForecastSectionProjection.Project(Data(History(3), Forecast(1)), "€", Localizer);

        Assert.All(view.ForecastSeries, s => Assert.Equal("€", s.Unit));
        Assert.All(view.TrendSeries, s => Assert.Equal("€", s.Unit));
    }

    [Fact]
    public void Project_empty_has_no_chartable_panels()
    {
        var view = Project(CostForecastSectionData.Empty);

        Assert.False(view.HasData);
        Assert.False(view.HasForecastChart);
        Assert.False(view.HasTrendChart);
        Assert.Empty(view.ForecastSeries);
        Assert.Empty(view.TrendSeries);
        // Even empty, the panels keep their friendly messages (never a blank box).
        Assert.False(string.IsNullOrWhiteSpace(view.ForecastEmptyMessage));
        Assert.False(string.IsNullOrWhiteSpace(view.TrendEmptyMessage));
    }

    // ---- i18n: every label resolves through its catalog key -------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var view = CostForecastSectionProjection.Project(Data(History(3), Forecast(2)), "$", echo);

        Assert.Equal("L:costAnalysis.forecast.title", view.ForecastTitle);
        Assert.Equal("L:costAnalysis.forecast.needData", view.ForecastEmptyMessage);
        Assert.Equal("L:costAnalysis.forecast.costPerKwhTrend", view.TrendTitle);
        Assert.Equal("L:costAnalysis.forecast.needTrendData", view.TrendEmptyMessage);
        Assert.Equal("L:costAnalysis.forecast.title", view.AutomationName);

        Assert.Equal("L:costAnalysis.forecast.confidence", view.ForecastSeries[0].Name);
        Assert.Equal("L:costAnalysis.forecast.actual", view.ForecastSeries[1].Name);
        Assert.Equal("L:costAnalysis.forecast.projected", view.ForecastSeries[2].Name);
        Assert.Equal("L:costAnalysis.forecast.costPerKwh", view.TrendSeries[0].Name);
    }

    // ---- a11y: every plotted series carries a spoken label --------------------------

    [Fact]
    public void Every_series_carries_a_non_empty_name()
    {
        var view = Project(Data(History(4), Forecast(3)));

        Assert.All(view.ForecastSeries, s => Assert.False(string.IsNullOrWhiteSpace(s.Name)));
        Assert.All(view.TrendSeries, s => Assert.False(string.IsNullOrWhiteSpace(s.Name)));
        Assert.False(string.IsNullOrWhiteSpace(view.AutomationName));
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_value()
    {
        using var doc = JsonDocument.Parse("""{ "historical": [ { "month": "Jan", "cost": 100, "cost_per_kwh": 0.1 } ], "forecast": [] }""");

        var cached = CostForecastSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!.Historical);

        var offline = CostForecastSectionResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!.Historical);
    }

    [Fact]
    public void Mapper_maps_loading_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loading, CostForecastSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Empty, CostForecastSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, CostForecastSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<CostForecastSectionData>.Loading());
        await vm.LoadAsync();

        Assert.Equal(CostForecastSectionState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_chartable_panels()
    {
        using var vm = NewViewModel(Loaded(Data(History(3), Forecast(1))));
        await vm.LoadAsync();

        Assert.Equal(CostForecastSectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.Display.HasForecastChart);
        Assert.True(vm.Display.HasTrendChart);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_with_only_trend_is_loaded()
    {
        using var vm = NewViewModel(Loaded(Data(History(2), Forecast(0))));
        await vm.LoadAsync();

        Assert.Equal(CostForecastSectionState.Loaded, vm.State);
        Assert.False(vm.Display.HasForecastChart);
        Assert.True(vm.Display.HasTrendChart);
    }

    [Fact]
    public async Task ViewModel_loaded_too_thin_renders_empty()
    {
        using var vm = NewViewModel(Loaded(Data(History(1), Forecast(0))));
        await vm.LoadAsync();

        Assert.Equal(CostForecastSectionState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.Display.ForecastEmptyMessage));
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<CostForecastSectionData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(CostForecastSectionState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<CostForecastSectionData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(CostForecastSectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<CostForecastSectionData>.Cached(
            Data(History(3), Forecast(1)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(CostForecastSectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<CostForecastSectionData>.OfflineCached(
            Data(History(3), Forecast(1)),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(CostForecastSectionState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<CostForecastSectionData>.Loading(),
            RepositoryResult<CostForecastSectionData>.Cached(Data(History(3), Forecast(1)), Now, stale: false),
            RepositoryResult<CostForecastSectionData>.Loaded(Data(History(4), Forecast(2)), Now));
        await vm.LoadAsync();

        Assert.Equal(CostForecastSectionState.Loaded, vm.State);
        Assert.Equal(3, vm.Display.ForecastSeries.Count);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<CostForecastSectionData>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Cost Forecast", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Data(History(3), Forecast(1))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(CostForecastSectionViewModel.State), changed);
        Assert.Contains(nameof(CostForecastSectionViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("cost-forecast-section", CostForecastSectionRegistration.Id);
        Assert.Equal("charging", CostForecastSectionRegistration.Category);
        Assert.Equal("CostForecastSection", CostForecastSectionRegistration.Slug);
        Assert.Equal(6, CostForecastSectionRegistration.Months);
        Assert.Equal("Cost Forecast", CostForecastSectionRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CostForecastSectionDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CostForecastSection", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CostForecastSectionDisplay Project(CostForecastSectionData data) =>
        CostForecastSectionProjection.Project(data, "$", Localizer);

    private static CostForecastHistoryPoint[] History(int count)
    {
        var list = new CostForecastHistoryPoint[count];
        for (int i = 0; i < count; i++)
        {
            list[i] = new CostForecastHistoryPoint($"H{i}", 100 + i, 0.1 + (i * 0.01));
        }

        return list;
    }

    private static CostForecastProjectionPoint[] Forecast(int count)
    {
        var list = new CostForecastProjectionPoint[count];
        for (int i = 0; i < count; i++)
        {
            double cost = 120 + i;
            list[i] = new CostForecastProjectionPoint($"F{i}", cost, cost - 10, cost + 10);
        }

        return list;
    }

    private static CostForecastSectionData Data(CostForecastHistoryPoint[] historical, CostForecastProjectionPoint[] forecast) =>
        new(historical, forecast);

    private static RepositoryResult<CostForecastSectionData> Loaded(CostForecastSectionData data) =>
        RepositoryResult<CostForecastSectionData>.Loaded(data, Now);

    private static CostForecastSectionViewModel NewViewModel(params RepositoryResult<CostForecastSectionData>[] emissions) =>
        new(new FakeCostForecastSectionSource(emissions), Localizer, "$");

    private sealed class FakeCostForecastSectionSource(params RepositoryResult<CostForecastSectionData>[] emissions) : ICostForecastSectionSource
    {
        public async IAsyncEnumerable<RepositoryResult<CostForecastSectionData>> StreamAsync(
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
