using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the EnergyStatsWidget's UI-thread-free logic — the JSON parse adapter, the
/// chartData / stats / toEfficiencyDisplay projection and the compact big number across the compact /
/// standard / wide footprints and metric / imperial units, the cache-then-network result mapper, the
/// per-vehicle data source (primary resolution + path/query-scoped request), the registry metadata, the
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error /
/// stale / offline) including the web <c>hasData = !!data</c> gate. Mirrors the web spec
/// (web/src/features/dashboard/widgets/EnergyStatsWidget.tsx + api/hooks/useEnergy.ts + hooks/useUnits.ts).
/// </summary>
public sealed class EnergyStatsWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static EnergyStatsData Sample() => new(
        TotalEnergyUsedWh: 42500,
        TotalEnergyChargedWh: 50000,
        TotalWh: 95000,
        TotalCost: 123.456,
        AvgEfficiencyWhPerM: 0.15,
        Co2SavedKg: 12.34,
        DailyBreakdown: new[]
        {
            new EnergyStatsDailyEntry("2026-05-20", 12000),
            new EnergyStatsDailyEntry("2026-05-21", 15000),
        });

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromResponse_reads_snake_case_fields()
    {
        const string json = """
        {"total_energy_used_wh":42500,"total_energy_charged_wh":50000,"total_wh":95000,
         "total_cost":123.456,"total_distance_m":300000,"avg_efficiency_wh_per_m":0.15,
         "co2_saved_kg":12.34,
         "daily_breakdown":[{"date":"2026-05-20","energy_wh":12000},{"date":"2026-05-21","energy_wh":15000}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var data = EnergyStatsData.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Equal(42500, data!.TotalEnergyUsedWh);
        Assert.Equal(50000, data.TotalEnergyChargedWh);
        Assert.Equal(95000, data.TotalWh);
        Assert.Equal(123.456, data.TotalCost);
        Assert.Equal(0.15, data.AvgEfficiencyWhPerM);
        Assert.Equal(12.34, data.Co2SavedKg);
        Assert.Equal(2, data.DailyBreakdown.Count);
        Assert.Equal("2026-05-20", data.DailyBreakdown[0].Date);
        Assert.Equal(12000, data.DailyBreakdown[0].EnergyWh);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"total_wh":1000}""");

        var data = EnergyStatsData.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Equal(1000, data!.TotalWh);
        Assert.Equal(0, data.TotalEnergyUsedWh);
        Assert.Equal(0, data.TotalEnergyChargedWh);
        Assert.Equal(0, data.TotalCost);
        Assert.Equal(0, data.AvgEfficiencyWhPerM);
        Assert.Equal(0, data.Co2SavedKg);
        Assert.Empty(data.DailyBreakdown);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("7")]
    [InlineData("[1,2,3]")]
    [InlineData("\"x\"")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(EnergyStatsData.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_skips_non_object_daily_entries()
    {
        using var doc = JsonDocument.Parse(
            """{"daily_breakdown":[{"date":"a","energy_wh":1},7,"x",{"date":"b","energy_wh":2}]}""");

        var data = EnergyStatsData.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Equal(2, data!.DailyBreakdown.Count);
        Assert.Equal("b", data.DailyBreakdown[1].Date);
    }

    // ---- Projection: stats (metric, standard) --------------------------------------

    [Fact]
    public void Project_builds_standard_stats_metric()
    {
        var view = EnergyStatsProjection.Project(Sample(), new EnergyStatsSize(2, 4), UnitPref.Metric, Localizer);

        Assert.False(view.IsCompact);
        Assert.False(view.IsWide);
        Assert.False(view.IsEmpty);
        Assert.Equal(2, view.StatColumns);
        Assert.Equal(4, view.Stats.Count);

        Assert.Equal("Total Used", view.Stats[0].Label);
        Assert.Equal("42.5 kWh", view.Stats[0].Value);
        Assert.Null(view.Stats[0].Unit);

        Assert.Equal("Total Charged", view.Stats[1].Label);
        Assert.Equal("50.0 kWh", view.Stats[1].Value);

        Assert.Equal("Avg Efficiency", view.Stats[2].Label);
        Assert.Equal("150.0", view.Stats[2].Value);
        Assert.Equal("Wh/km", view.Stats[2].Unit);

        Assert.Equal("CO\u2082 Saved", view.Stats[3].Label);
        Assert.Equal("12.3", view.Stats[3].Value);
        Assert.Equal("kg", view.Stats[3].Unit);
    }

    [Fact]
    public void Project_wide_adds_cost_and_net_energy()
    {
        var view = EnergyStatsProjection.Project(Sample(), new EnergyStatsSize(4, 4), UnitPref.Metric, Localizer);

        Assert.True(view.IsWide);
        Assert.Equal(3, view.StatColumns);
        Assert.Equal(6, view.Stats.Count);

        Assert.Equal("Total Cost", view.Stats[4].Label);
        Assert.Equal("123.46", view.Stats[4].Value);
        Assert.Equal("$", view.Stats[4].Unit);

        Assert.Equal("Net Energy", view.Stats[5].Label);
        // charged 50000 − used 42500 = 7500 Wh → 7.5 kWh.
        Assert.Equal("7.5 kWh", view.Stats[5].Value);
        Assert.Null(view.Stats[5].Unit);
    }

    [Fact]
    public void Project_converts_efficiency_to_miles_when_imperial()
    {
        var view = EnergyStatsProjection.Project(Sample(), new EnergyStatsSize(2, 4), UnitPref.Imperial, Localizer);

        // 0.15 Wh/m × 1609.344 = 241.4016 → 241.4 Wh/mi.
        Assert.Equal("Wh/mi", view.Stats[2].Unit);
        Assert.Equal("241.4", view.Stats[2].Value);
    }

    [Fact]
    public void Project_builds_chart_points_from_daily_breakdown()
    {
        var view = EnergyStatsProjection.Project(Sample(), new EnergyStatsSize(2, 4), UnitPref.Metric, Localizer);

        Assert.True(view.HasChartData);
        Assert.Equal(2, view.ChartPoints.Count);
        Assert.Equal("2026-05-20", view.ChartPoints[0].Date);
        Assert.Equal("May 20", view.ChartPoints[0].Label);
        Assert.Equal(12000, view.ChartPoints[0].EnergyWh);
        Assert.Equal(15000, view.ChartPoints[1].EnergyWh);
        Assert.Equal("Daily Usage", view.ChartSeriesName);
        Assert.Equal("Energy (kWh)", view.ChartAccessibleName);
    }

    [Fact]
    public void Project_compact_exposes_big_number_in_kwh()
    {
        var view = EnergyStatsProjection.Project(Sample(), new EnergyStatsSize(1, 2), UnitPref.Metric, Localizer);

        Assert.True(view.IsCompact);
        // 95000 Wh / 1000 = 95 kWh.
        Assert.Equal(95, view.CompactValueKwh);
        Assert.Equal("95", view.CompactValueText);
        Assert.Equal("kWh", view.CompactUnitLabel);
        Assert.Equal("95 kWh", view.CompactAutomationName);
    }

    [Fact]
    public void Project_without_chart_data_marks_no_chart_but_keeps_stats()
    {
        var data = Sample() with { DailyBreakdown = Array.Empty<EnergyStatsDailyEntry>() };

        var view = EnergyStatsProjection.Project(data, new EnergyStatsSize(2, 4), UnitPref.Metric, Localizer);

        Assert.False(view.IsEmpty);
        Assert.False(view.HasChartData);
        Assert.Empty(view.ChartPoints);
        Assert.Equal(4, view.Stats.Count);
    }

    [Fact]
    public void Project_null_data_is_empty_with_no_stats()
    {
        var view = EnergyStatsProjection.Project(null, new EnergyStatsSize(2, 4), UnitPref.Metric, Localizer);

        Assert.True(view.IsEmpty);
        Assert.Empty(view.Stats);
        Assert.Empty(view.ChartPoints);
        Assert.False(view.HasChartData);
    }

    [Fact]
    public void Project_stats_carry_narrator_names()
    {
        var view = EnergyStatsProjection.Project(Sample(), new EnergyStatsSize(4, 4), UnitPref.Metric, Localizer);

        foreach (var stat in view.Stats)
        {
            Assert.False(string.IsNullOrWhiteSpace(stat.AutomationName));
            Assert.Contains(stat.Label, stat.AutomationName, StringComparison.Ordinal);
            Assert.Contains(stat.Value, stat.AutomationName, StringComparison.Ordinal);
        }

        Assert.Equal("Total Used: 42.5 kWh", view.Stats[0].AutomationName);
        Assert.Equal("Avg Efficiency: 150.0 Wh/km", view.Stats[2].AutomationName);
        Assert.Equal("CO\u2082 Saved: 12.3 kg", view.Stats[3].AutomationName);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"total_wh":95000}""");

        var cached = EnergyStatsResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(95000, cached.Value!.TotalWh);

        var offline = EnergyStatsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(95000, offline.Value!.TotalWh);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"total_wh":1}""");

        Assert.Equal(LoadStatus.Loaded, EnergyStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, EnergyStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, EnergyStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<EnergyStatsData>.Loading());
        await vm.LoadAsync();

        Assert.Equal(EnergyStatsState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_projection()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(EnergyStatsState.Loaded, vm.State);
        Assert.Equal(4, vm.Display.Stats.Count);
        Assert.Equal(2, vm.Display.ChartPoints.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_present_but_zeroed_summary_is_loaded_not_empty()
    {
        // Web parity: hasData = !!data — a present (even all-zero) summary renders content, not the empty state.
        var zero = new EnergyStatsData(0, 0, 0, 0, 0, 0, Array.Empty<EnergyStatsDailyEntry>());
        using var vm = NewViewModel(Loaded(zero));
        await vm.LoadAsync();

        Assert.Equal(EnergyStatsState.Loaded, vm.State);
        Assert.False(vm.Display.HasChartData);
        Assert.Equal(4, vm.Display.Stats.Count);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<EnergyStatsData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(EnergyStatsState.Empty, vm.State);
        Assert.True(vm.Display.IsEmpty);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<EnergyStatsData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(EnergyStatsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<EnergyStatsData>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(EnergyStatsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.Equal(4, vm.Display.Stats.Count);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<EnergyStatsData>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(EnergyStatsState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<EnergyStatsData>.Loading(),
            RepositoryResult<EnergyStatsData>.Cached(Sample(), Now, stale: false),
            RepositoryResult<EnergyStatsData>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(EnergyStatsState.Loaded, vm.State);
        Assert.Equal("42.5 kWh", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new EnergyStatsSize(2, 4), Loaded(Sample()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new EnergyStatsSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(EnergyStatsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_efficiency_unit()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        Assert.Equal("Wh/km", vm.Display.Stats[2].Unit);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("Wh/mi", vm.Display.Stats[2].Unit);
        Assert.Equal(EnergyStatsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<EnergyStatsData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Energy Stats", vm.Title);
        Assert.Equal("No energy data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(EnergyStatsViewModel.State), changed);
        Assert.Contains(nameof(EnergyStatsViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("energy-stats", EnergyStatsRegistration.Id);
        Assert.Equal("energy", EnergyStatsRegistration.Category);
        Assert.Equal("EnergyStatsWidget", EnergyStatsRegistration.Slug);
        Assert.Equal(new EnergyStatsSize(2, 4), EnergyStatsRegistration.DefaultSize);
        Assert.Equal(new EnergyStatsSize(1, 2), EnergyStatsRegistration.MinSize);
        Assert.Equal(new EnergyStatsSize(4, 40), EnergyStatsRegistration.MaxSize);
        Assert.Equal("Energy Stats", EnergyStatsRegistration.Name(Localizer));
        Assert.Contains("daily usage chart", EnergyStatsRegistration.Description(Localizer), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(2, 4, true)]   // default
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 1, false)]  // below min rows
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, EnergyStatsRegistration.IsWithinBounds(new EnergyStatsSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new EnergyStatsSize(1, 2), EnergyStatsRegistration.Clamp(new EnergyStatsSize(0, 0)));
        Assert.Equal(new EnergyStatsSize(4, 40), EnergyStatsRegistration.Clamp(new EnergyStatsSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new EnergyStatsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EnergyStatsWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new EnergyStatsSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_by_path_and_query()
    {
        using var doc = JsonDocument.Parse("""{"total_wh":95000}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new EnergyStatsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(95000, results[^1].Value!.TotalWh);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_energy", request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
        Assert.Equal(30, Convert.ToInt32(request.Query!["days"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"total_wh":1}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new EnergyStatsSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal("42", request.PathParams!["vehicleID"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_non_object_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new EnergyStatsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public async Task Source_present_object_body_loads()
    {
        // Web parity: a present object (even an empty one) is hasData = true, not the empty surface.
        using var doc = JsonDocument.Parse("{}");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new EnergyStatsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 5 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.NotNull(results[^1].Value);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<EnergyStatsData>>> Drain(IEnergyStatsSource source)
    {
        var list = new List<RepositoryResult<EnergyStatsData>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<EnergyStatsData> Loaded(EnergyStatsData data) =>
        RepositoryResult<EnergyStatsData>.Loaded(data, Now);

    private static EnergyStatsViewModel NewViewModel(params RepositoryResult<EnergyStatsData>[] emissions) =>
        NewViewModel(EnergyStatsSize.Default, emissions);

    private static EnergyStatsViewModel NewViewModel(
        EnergyStatsSize size,
        params RepositoryResult<EnergyStatsData>[] emissions) =>
        new(new FakeEnergyStatsSource(emissions), Localizer, size, UnitPref.Metric);

    private sealed class FakeEnergyStatsSource(params RepositoryResult<EnergyStatsData>[] emissions) : IEnergyStatsSource
    {
        public async IAsyncEnumerable<RepositoryResult<EnergyStatsData>> StreamAsync(
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
