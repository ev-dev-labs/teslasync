using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
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
/// Headless verification of the ChargeHistoryWidget's UI-thread-free logic — the JSON parse adapter
/// (charging-session energy), the kWh conversion / chronological-reverse / 10-session-cap / stats
/// projection across the compact and standard footprints (including the web <c>hasData = chartData.length
/// &gt; 1</c> gate), the cache-then-network result mapper, the per-vehicle data source (primary resolution
/// + query-scoped request), the registry metadata, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/ChargeHistoryWidget.tsx + api/hooks/useVehicles.ts).
/// </summary>
public sealed class ChargeHistoryWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    // Sessions are supplied newest-first (the backend orders started_at DESC) so the projection's reverse
    // produces a chronological chart.
    private static IReadOnlyList<ChargeHistorySession> Sessions(params double[] wh)
    {
        var list = new List<ChargeHistorySession>(wh.Length);
        foreach (double w in wh)
        {
            list.Add(new ChargeHistorySession(w));
        }

        return list;
    }

    private static ChargeHistoryDisplay Project(IReadOnlyList<ChargeHistorySession> sessions, int cols, int rows) =>
        ChargeHistoryProjection.Project(sessions, new ChargeHistorySize(cols, rows), Localizer);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_total_energy_added_wh()
    {
        using var doc = JsonDocument.Parse("""{"total_energy_added_wh":12345.6}""");

        var session = ChargeHistorySession.FromJson(doc.RootElement);

        Assert.Equal(12345.6, session.EnergyAddedWh);
    }

    [Fact]
    public void FromJson_defaults_missing_energy_to_zero()
    {
        using var doc = JsonDocument.Parse("""{"id":7}""");

        var session = ChargeHistorySession.FromJson(doc.RootElement);

        Assert.Equal(0, session.EnergyAddedWh);
    }

    [Fact]
    public void FromJson_parses_numeric_string_energy()
    {
        using var doc = JsonDocument.Parse("""{"total_energy_added_wh":"9000"}""");

        var session = ChargeHistorySession.FromJson(doc.RootElement);

        Assert.Equal(9000, session.EnergyAddedWh);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse(
            """[{"total_energy_added_wh":1000}, 7, {"total_energy_added_wh":2000}]""");

        var list = ChargeHistorySession.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1000, list[0].EnergyAddedWh);
        Assert.Equal(2000, list[1].EnergyAddedWh);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"total_energy_added_wh":1000}""");
        Assert.Empty(ChargeHistorySession.ParseList(doc.RootElement));
    }

    // ---- Projection: conversion / order / cap --------------------------------------

    [Fact]
    public void Project_converts_watt_hours_to_kwh()
    {
        var view = Project(Sessions(12000, 8000), 2, 4);

        // 12000 wh -> 12 kWh, 8000 wh -> 8 kWh; reversed into chronological order.
        Assert.Equal(new[] { 8.0, 12.0 }, view.ChartEnergies);
    }

    [Fact]
    public void Project_reverses_newest_first_into_chronological_order()
    {
        // Newest-first input s0=10k, s1=20k, s2=30k -> chronological [s2, s1, s0] = [30, 20, 10] kWh.
        var view = Project(Sessions(10000, 20000, 30000), 2, 4);

        Assert.Equal(new[] { 30.0, 20.0, 10.0 }, view.ChartEnergies);
    }

    [Fact]
    public void Project_caps_at_ten_most_recent_sessions()
    {
        // Twelve sessions newest-first (1000..12000 wh). Web limit=10 keeps the first ten (1000..10000),
        // dropping the two oldest (11000, 12000).
        var whs = new double[12];
        for (int i = 0; i < 12; i++)
        {
            whs[i] = (i + 1) * 1000.0;
        }

        var view = Project(Sessions(whs), 2, 4);

        Assert.Equal(10, view.ChartEnergies.Count);
        Assert.DoesNotContain(11.0, view.ChartEnergies);
        Assert.DoesNotContain(12.0, view.ChartEnergies);

        // Total of the kept ten (1..10 kWh) = 55; mean = 5.5.
        Assert.Equal("55.0", view.Stats[0].Value);
        Assert.Equal("5.5", view.Stats[1].Value);
    }

    // ---- Projection: hasData gate (web hasData = chartData.length > 1) --------------

    [Fact]
    public void Project_hasData_false_when_no_sessions()
    {
        var view = Project(Sessions(), 2, 4);

        Assert.False(view.HasData);
        Assert.Empty(view.Stats);
        Assert.Empty(view.ChartEnergies);
    }

    [Fact]
    public void Project_hasData_false_with_single_session()
    {
        var view = Project(Sessions(12000), 2, 4);

        Assert.False(view.HasData);
        Assert.Empty(view.Stats);
        Assert.Single(view.ChartEnergies);
    }

    [Fact]
    public void Project_hasData_true_with_two_sessions()
    {
        Assert.True(Project(Sessions(12000, 8000), 2, 4).HasData);
    }

    // ---- Projection: stats ---------------------------------------------------------

    [Fact]
    public void Project_builds_total_and_avg_stats_in_kwh()
    {
        var view = Project(Sessions(12000, 8000), 2, 4);

        Assert.Equal(2, view.Stats.Count);

        Assert.Equal("Total", view.Stats[0].Label);
        Assert.Equal("20.0", view.Stats[0].Value);
        Assert.Equal("kWh", view.Stats[0].Unit);
        Assert.Equal("Total: 20.0 kWh", view.Stats[0].AutomationName);

        Assert.Equal("Avg", view.Stats[1].Label);
        Assert.Equal("10.0", view.Stats[1].Value);
        Assert.Equal("kWh", view.Stats[1].Unit);
        Assert.Equal("Avg: 10.0 kWh", view.Stats[1].AutomationName);
    }

    [Fact]
    public void Project_chart_series_name_is_the_energy_unit()
    {
        Assert.Equal("kWh", Project(Sessions(12000, 8000), 2, 4).ChartSeriesName);
    }

    // ---- Projection: compact (web isCompact = size.cols <= 1) ----------------------

    [Fact]
    public void Project_compact_keys_off_columns_only()
    {
        Assert.True(Project(Sessions(12000, 8000), 1, 4).IsCompact);
        Assert.False(Project(Sessions(12000, 8000), 2, 4).IsCompact);

        // Web parity: a single row does NOT make it compact — only a single column does.
        Assert.False(Project(Sessions(12000, 8000), 2, 1).IsCompact);
    }

    [Fact]
    public void Project_compact_automation_name_lists_stats()
    {
        var view = Project(Sessions(12000, 8000), 1, 4);

        Assert.True(view.IsCompact);
        Assert.Contains("Total: 20.0 kWh", view.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("Avg: 10.0 kWh", view.CompactAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(
            """[{"total_energy_added_wh":12000},{"total_energy_added_wh":8000}]""");

        var cached = ChargeHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(2, cached.Value!.Count);

        var offline = ChargeHistoryResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(2, offline.Value!.Count);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""[{"total_energy_added_wh":1000}]""");

        Assert.Equal(LoadStatus.Loaded, ChargeHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, ChargeHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, ChargeHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ChargeHistorySession>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ChargeHistoryState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_projection()
    {
        using var vm = NewViewModel(Loaded(Sessions(12000, 8000)));
        await vm.LoadAsync();

        Assert.Equal(ChargeHistoryState.Loaded, vm.State);
        Assert.True(vm.Display.HasData);
        Assert.Equal(2, vm.Display.Stats.Count);
        Assert.Equal(new[] { 8.0, 12.0 }, vm.Display.ChartEnergies);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_with_single_session_renders_empty_via_hasData_gate()
    {
        // Web parity: a resolved list with fewer than two sessions hits the WidgetChartSummary isEmpty gate.
        using var vm = NewViewModel(Loaded(Sessions(12000)));
        await vm.LoadAsync();

        Assert.Equal(ChargeHistoryState.Empty, vm.State);
        Assert.Equal("No charge sessions yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ChargeHistorySession>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ChargeHistoryState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<ChargeHistorySession>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ChargeHistoryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<ChargeHistorySession>>.Cached(Sessions(12000, 8000), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ChargeHistoryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ChargeHistorySession>>.OfflineCached(
            Sessions(12000, 8000), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ChargeHistoryState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<ChargeHistorySession>>.Loading(),
            RepositoryResult<IReadOnlyList<ChargeHistorySession>>.Cached(Sessions(4000, 2000), Now, stale: false),
            RepositoryResult<IReadOnlyList<ChargeHistorySession>>.Loaded(Sessions(12000, 8000), Now));
        await vm.LoadAsync();

        Assert.Equal(ChargeHistoryState.Loaded, vm.State);
        Assert.Equal("20.0", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new ChargeHistorySize(2, 4), Loaded(Sessions(12000, 8000)));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new ChargeHistorySize(1, 4);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(ChargeHistoryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ChargeHistorySession>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Charge History", vm.Title);
        Assert.Equal("No charge sessions yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sessions(12000, 8000)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ChargeHistoryViewModel.State), changed);
        Assert.Contains(nameof(ChargeHistoryViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("charge-history", ChargeHistoryRegistration.Id);
        Assert.Equal("charging", ChargeHistoryRegistration.Category);
        Assert.Equal("ChargeHistoryWidget", ChargeHistoryRegistration.Slug);
        Assert.Equal(new ChargeHistorySize(2, 4), ChargeHistoryRegistration.DefaultSize);
        Assert.Equal(new ChargeHistorySize(2, 2), ChargeHistoryRegistration.MinSize);
        Assert.Equal(new ChargeHistorySize(4, 40), ChargeHistoryRegistration.MaxSize);
        Assert.Equal("Charge History", ChargeHistoryRegistration.Name(Localizer));
        Assert.Equal("Recent charging sessions chart", ChargeHistoryRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(2, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(2, 4, true)]   // default
    [InlineData(1, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 1, false)]  // below min rows
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, ChargeHistoryRegistration.IsWithinBounds(new ChargeHistorySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ChargeHistorySize(2, 2), ChargeHistoryRegistration.Clamp(new ChargeHistorySize(0, 0)));
        Assert.Equal(new ChargeHistorySize(4, 40), ChargeHistoryRegistration.Clamp(new ChargeHistorySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChargeHistoryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargeHistoryWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new ChargeHistorySource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_by_query()
    {
        using var doc = JsonDocument.Parse(
            """[{"total_energy_added_wh":12000},{"total_energy_added_wh":8000}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new ChargeHistorySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(2, terminal.Value!.Count);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_charging_sessions", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""[{"total_energy_added_wh":1000},{"total_energy_added_wh":2000}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new ChargeHistorySource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_array_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new ChargeHistorySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<ChargeHistorySession>>>> Drain(IChargeHistorySource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<ChargeHistorySession>>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<IReadOnlyList<ChargeHistorySession>> Loaded(IReadOnlyList<ChargeHistorySession> sessions) =>
        RepositoryResult<IReadOnlyList<ChargeHistorySession>>.Loaded(sessions, Now);

    private static ChargeHistoryViewModel NewViewModel(params RepositoryResult<IReadOnlyList<ChargeHistorySession>>[] emissions) =>
        NewViewModel(ChargeHistorySize.Default, emissions);

    private static ChargeHistoryViewModel NewViewModel(
        ChargeHistorySize size,
        params RepositoryResult<IReadOnlyList<ChargeHistorySession>>[] emissions) =>
        new(new FakeChargeHistorySource(emissions), Localizer, size);

    private sealed class FakeChargeHistorySource(params RepositoryResult<IReadOnlyList<ChargeHistorySession>>[] emissions) : IChargeHistorySource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ChargeHistorySession>>> StreamAsync(
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
