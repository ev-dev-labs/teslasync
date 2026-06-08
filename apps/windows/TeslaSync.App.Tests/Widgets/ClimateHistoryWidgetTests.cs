using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the ClimateHistoryWidget's UI-thread-free logic — the JSON parse adapter
/// (the useClimateHistory read), the SI-Celsius → display-unit conversion, the chronological sort, the
/// timestamp-drop filter, the connectNulls gap handling across two series, the latest-value / hasData
/// projection, the result mapper, the per-vehicle data source (primary resolution + the query-scoped
/// climate read against <c>get_api_v1_climate</c>), the registry metadata, the diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline).
/// Mirrors the web spec (web/src/features/dashboard/widgets/ClimateHistoryWidget.tsx).
/// </summary>
public sealed class ClimateHistoryWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string T0 = "2026-06-06T10:00:00Z";
    private const string T1 = "2026-06-06T11:00:00Z";
    private const string T2 = "2026-06-06T12:00:00Z";

    private static ClimateHistorySample Sample(string? ts, double? inside, double? outside) =>
        new(ts, inside, outside);

    private static IReadOnlyList<ClimateHistorySample> Samples(params ClimateHistorySample[] rows) => rows;

    private static ClimateHistoryDisplay Project(
        IReadOnlyList<ClimateHistorySample> samples, int cols, int rows, UnitPref? units = null) =>
        ClimateHistoryProjection.Project(samples, new ClimateHistorySize(cols, rows), units ?? UnitPref.Metric, Localizer);

    // ---- Parse adapter (web useClimateHistory read) --------------------------------

    [Fact]
    public void FromJson_reads_timestamp_and_both_temperatures()
    {
        using var doc = JsonDocument.Parse(
            """{"created_at":"2026-06-06T12:00:00Z","timestamp":"2026-06-06T11:00:00Z","inside_temp":22,"outside_temp":15,"id":1}""");

        var sample = ClimateHistorySample.FromJson(doc.RootElement);

        // Web parity: created_at wins over timestamp (d.created_at ?? d.timestamp).
        Assert.Equal("2026-06-06T12:00:00Z", sample.TimestampRaw);
        Assert.Equal(22, sample.InsideTempC);
        Assert.Equal(15, sample.OutsideTempC);
    }

    [Fact]
    public void FromJson_falls_back_to_timestamp_when_created_at_absent_or_empty()
    {
        using var missing = JsonDocument.Parse("""{"timestamp":"2026-06-06T11:00:00Z","inside_temp":1}""");
        Assert.Equal("2026-06-06T11:00:00Z", ClimateHistorySample.FromJson(missing.RootElement).TimestampRaw);

        using var empty = JsonDocument.Parse("""{"created_at":"","timestamp":"2026-06-06T11:00:00Z"}""");
        Assert.Equal("2026-06-06T11:00:00Z", ClimateHistorySample.FromJson(empty.RootElement).TimestampRaw);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"created_at":"2026-06-06T10:00:00Z"}""");

        var sample = ClimateHistorySample.FromJson(doc.RootElement);

        Assert.Equal("2026-06-06T10:00:00Z", sample.TimestampRaw);
        Assert.Null(sample.InsideTempC);
        Assert.Null(sample.OutsideTempC);
    }

    [Fact]
    public void FromJson_treats_explicit_null_and_no_timestamp_as_null()
    {
        using var doc = JsonDocument.Parse("""{"inside_temp":null,"outside_temp":null}""");

        var sample = ClimateHistorySample.FromJson(doc.RootElement);

        // Web parity: insideTemp != null — a JSON null reads as "no value" → a gap.
        Assert.Null(sample.TimestampRaw);
        Assert.Null(sample.InsideTempC);
        Assert.Null(sample.OutsideTempC);
    }

    [Fact]
    public void FromJson_parses_numeric_string_temperatures()
    {
        using var doc = JsonDocument.Parse("""{"created_at":"t","inside_temp":"22.5","outside_temp":"15"}""");

        var sample = ClimateHistorySample.FromJson(doc.RootElement);

        Assert.Equal(22.5, sample.InsideTempC);
        Assert.Equal(15, sample.OutsideTempC);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse(
            """[{"created_at":"a","inside_temp":1}, 7, {"created_at":"b","inside_temp":2}]""");

        var list = ClimateHistorySample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].InsideTempC);
        Assert.Equal(2, list[1].InsideTempC);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"inside_temp":1}""");
        Assert.Empty(ClimateHistorySample.ParseList(doc.RootElement));
    }

    // ---- Projection: conversion / order --------------------------------------------

    [Fact]
    public void Project_sorts_chronologically_and_keeps_si_celsius_in_metric()
    {
        // Supplied out of order; the projection sorts by the timestamp string.
        var view = Project(Samples(Sample(T2, 22, 15), Sample(T0, 20, 10)), 2, 4);

        Assert.True(view.HasData);
        Assert.Equal(new[] { new ChartPoint(0, 20), new ChartPoint(1, 22) }, view.InsidePoints);
        Assert.Equal(new[] { new ChartPoint(0, 10), new ChartPoint(1, 15) }, view.OutsidePoints);
    }

    [Fact]
    public void Project_converts_to_fahrenheit_under_imperial()
    {
        // 20°C → 68°F, 0°C → 32°F.
        var view = Project(Samples(Sample(T0, 20, 0)), 2, 4, UnitPref.Imperial);

        Assert.Equal(new ChartPoint(0, 68), Assert.Single(view.InsidePoints));
        Assert.Equal(new ChartPoint(0, 32), Assert.Single(view.OutsidePoints));
        Assert.Equal("68", view.Stats[0].Value);
        Assert.Equal("\u00B0F", view.Stats[0].Unit);
    }

    [Fact]
    public void Project_drops_rows_without_a_timestamp()
    {
        var view = Project(Samples(Sample(T0, 20, 10), Sample(null, 99, 99), Sample("", 88, 88)), 2, 4);

        // Only the single timestamped row survives.
        Assert.Single(view.InsidePoints);
        Assert.Equal(new ChartPoint(0, 20), view.InsidePoints[0]);
    }

    // ---- Projection: connectNulls (gaps skipped, shared ordinal X) -----------------

    [Fact]
    public void Project_skips_null_points_per_series_on_a_shared_index()
    {
        // index 0: inside only, index 1: outside only, index 2: both.
        var view = Project(
            Samples(Sample(T0, 20, null), Sample(T1, null, 12), Sample(T2, 22, 14)),
            2, 4);

        Assert.Equal(new[] { new ChartPoint(0, 20), new ChartPoint(2, 22) }, view.InsidePoints);
        Assert.Equal(new[] { new ChartPoint(1, 12), new ChartPoint(2, 14) }, view.OutsidePoints);
    }

    // ---- Projection: hasData gate (web hasData = chartData.length > 0) --------------

    [Fact]
    public void Project_hasData_false_when_no_samples()
    {
        var view = Project(Samples(), 2, 4);

        Assert.False(view.HasData);
        Assert.Empty(view.Stats);
        Assert.Empty(view.InsidePoints);
        Assert.Empty(view.OutsidePoints);
    }

    [Fact]
    public void Project_hasData_false_when_no_row_has_a_timestamp()
    {
        var view = Project(Samples(Sample(null, 22, 15), Sample("", 21, 14)), 2, 4);

        Assert.False(view.HasData);
        Assert.Empty(view.Stats);
    }

    [Fact]
    public void Project_hasData_true_with_a_single_timestamped_row()
    {
        Assert.True(Project(Samples(Sample(T0, 22, 15)), 2, 4).HasData);
    }

    // ---- Projection: stats (latest value, em dash, rounding) -----------------------

    [Fact]
    public void Project_builds_cabin_and_outside_latest_stats()
    {
        var view = Project(Samples(Sample(T0, 20, 10), Sample(T1, 21, 12), Sample(T2, 23, 14)), 2, 4);

        Assert.Equal(2, view.Stats.Count);
        Assert.Equal("Cabin", view.Stats[0].Label);
        Assert.Equal("23", view.Stats[0].Value); // latest inside
        Assert.Equal("\u00B0C", view.Stats[0].Unit);
        Assert.Equal("Outside", view.Stats[1].Label);
        Assert.Equal("14", view.Stats[1].Value); // latest outside
    }

    [Fact]
    public void Project_latest_stat_rounds_to_integer()
    {
        var view = Project(Samples(Sample(T0, 21.6, 14.4)), 2, 4);

        Assert.Equal("22", view.Stats[0].Value);
        Assert.Equal("14", view.Stats[1].Value);
    }

    [Fact]
    public void Project_em_dashes_a_series_with_no_readings()
    {
        // Timestamped row but cabin temperature absent → Cabin stat shows the em dash, Outside shows a value.
        var view = Project(Samples(Sample(T0, null, 10)), 2, 4);

        Assert.True(view.HasData);
        Assert.Equal("\u2014", view.Stats[0].Value);
        Assert.Empty(view.InsidePoints);
        Assert.Equal("10", view.Stats[1].Value);
    }

    // ---- Projection: layout + series identity --------------------------------------

    [Fact]
    public void Project_compact_flag_tracks_single_column()
    {
        Assert.True(Project(Samples(Sample(T0, 20, 10)), 1, 4).IsCompact);
        Assert.False(Project(Samples(Sample(T0, 20, 10)), 2, 4).IsCompact);
    }

    [Fact]
    public void Project_series_names_are_localized()
    {
        var view = Project(Samples(Sample(T0, 20, 10)), 2, 4);

        Assert.Equal("Cabin", view.InsideSeriesName);
        Assert.Equal("Outside", view.OutsideSeriesName);
    }

    // ---- Accessibility (Narrator name) ---------------------------------------------

    [Fact]
    public void Project_compact_automation_name_combines_stats()
    {
        var view = Project(Samples(Sample(T0, 21, 15)), 1, 4);

        Assert.Equal("Cabin: 21\u00B0C, Outside: 15\u00B0C", view.CompactAutomationName);
    }

    [Fact]
    public void Project_automation_name_handles_em_dash_without_unit()
    {
        var view = Project(Samples(Sample(T0, null, 15)), 1, 4);

        Assert.Equal("Cabin: \u2014, Outside: 15\u00B0C", view.CompactAutomationName);
    }

    // ---- Result mapper (parse + preserve status) -----------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_rows()
    {
        using var doc = JsonDocument.Parse("""[{"created_at":"t","inside_temp":22,"outside_temp":15}]""");

        var cached = ClimateHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(22, Assert.Single(cached.Value!).InsideTempC);

        var offline = ClimateHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(15, Assert.Single(offline.Value!).OutsideTempC);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""[{"created_at":"t","inside_temp":1}]""");

        Assert.Equal(LoadStatus.Loaded, ClimateHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, ClimateHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, ClimateHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ClimateHistorySample>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ClimateHistoryState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_chart_display()
    {
        using var vm = NewViewModel(Loaded(Samples(Sample(T0, 20, 10), Sample(T1, 22, 14))));
        await vm.LoadAsync();

        Assert.Equal(ClimateHistoryState.Loaded, vm.State);
        Assert.True(vm.Display.HasData);
        Assert.Equal(2, vm.Display.InsidePoints.Count);
        Assert.Equal("22", vm.Display.Stats[0].Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ClimateHistorySample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ClimateHistoryState.Empty, vm.State);
        Assert.False(vm.Display.HasData);
        Assert.Equal("No climate history", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_untimestamped_rows_render_empty()
    {
        // Web parity: WidgetChartSummary isEmpty — a populated list with no chartable row → empty surface.
        using var vm = NewViewModel(Loaded(Samples(Sample(null, 22, 15))));
        await vm.LoadAsync();

        Assert.Equal(ClimateHistoryState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<ClimateHistorySample>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ClimateHistoryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<ClimateHistorySample>>.Cached(Samples(Sample(T0, 20, 10)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ClimateHistoryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ClimateHistorySample>>.OfflineCached(
            Samples(Sample(T0, 20, 10)), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ClimateHistoryState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<ClimateHistorySample>>.Loading(),
            RepositoryResult<IReadOnlyList<ClimateHistorySample>>.Cached(Samples(Sample(T0, 18, 9)), Now, stale: false),
            RepositoryResult<IReadOnlyList<ClimateHistorySample>>.Loaded(Samples(Sample(T0, 20, 10), Sample(T1, 22, 14)), Now));
        await vm.LoadAsync();

        Assert.Equal(ClimateHistoryState.Loaded, vm.State);
        Assert.Equal("22", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_temperatures()
    {
        using var vm = NewViewModel(Loaded(Samples(Sample(T0, 22, 15))));
        await vm.LoadAsync();
        Assert.Equal("22", vm.Display.Stats[0].Value);
        Assert.Equal("\u00B0C", vm.Display.Stats[0].Unit);

        vm.Units = UnitPref.Imperial; // 22°C → 71.6°F → "72"
        Assert.Equal("72", vm.Display.Stats[0].Value);
        Assert.Equal("\u00B0F", vm.Display.Stats[0].Unit);
        Assert.Equal(ClimateHistoryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new ClimateHistorySize(2, 4), Loaded(Samples(Sample(T0, 20, 10))));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new ClimateHistorySize(1, 4);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(ClimateHistoryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ClimateHistorySample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Climate History", vm.Title);
        Assert.Equal("No climate history", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Samples(Sample(T0, 20, 10), Sample(T1, 22, 14))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ClimateHistoryViewModel.State), changed);
        Assert.Contains(nameof(ClimateHistoryViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("climate-history", ClimateHistoryRegistration.Id);
        Assert.Equal("climate", ClimateHistoryRegistration.Category);
        Assert.Equal("ClimateHistoryWidget", ClimateHistoryRegistration.Slug);
        Assert.Equal(new ClimateHistorySize(2, 4), ClimateHistoryRegistration.DefaultSize);
        Assert.Equal(new ClimateHistorySize(2, 4), ClimateHistoryRegistration.MinSize);
        Assert.Equal(new ClimateHistorySize(4, 40), ClimateHistoryRegistration.MaxSize);
        Assert.Equal("Climate History", ClimateHistoryRegistration.Name(Localizer));
        Assert.Equal("Inside vs outside temperature chart over time", ClimateHistoryRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(2, 4, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(3, 10, true)]   // inside
    [InlineData(1, 4, false)]   // below min cols
    [InlineData(5, 40, false)]  // above max cols
    [InlineData(2, 3, false)]   // below min rows
    [InlineData(2, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, ClimateHistoryRegistration.IsWithinBounds(new ClimateHistorySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ClimateHistorySize(2, 4), ClimateHistoryRegistration.Clamp(new ClimateHistorySize(0, 0)));
        Assert.Equal(new ClimateHistorySize(4, 40), ClimateHistoryRegistration.Clamp(new ClimateHistorySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ClimateHistoryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ClimateHistoryWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public void Source_operation_resolves_against_generated_endpoint_table()
    {
        // The inlined operation id must be a real generated endpoint (GET /api/v1/climate).
        Assert.Contains(GeneratedApi.ApiEndpoints.All, e => e.OperationId == "get_api_v1_climate");
    }

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new ClimateHistorySource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_climate()
    {
        using var doc = JsonDocument.Parse(
            """[{"created_at":"2026-06-06T11:00:00Z","inside_temp":22,"outside_temp":15},{"created_at":"2026-06-06T12:00:00Z","inside_temp":23,"outside_temp":16}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new ClimateHistorySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(2, terminal.Value!.Count);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_climate", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.True(request.PathParams is null || request.PathParams.Count == 0);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""[{"created_at":"t","inside_temp":20,"outside_temp":10}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new ClimateHistorySource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(42L, Convert.ToInt64(api.Requests[^1].Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_array_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new ClimateHistorySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<ClimateHistorySample>>>> Drain(IClimateHistorySource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<ClimateHistorySample>>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<IReadOnlyList<ClimateHistorySample>> Loaded(IReadOnlyList<ClimateHistorySample> samples) =>
        RepositoryResult<IReadOnlyList<ClimateHistorySample>>.Loaded(samples, Now);

    private static ClimateHistoryViewModel NewViewModel(params RepositoryResult<IReadOnlyList<ClimateHistorySample>>[] emissions) =>
        NewViewModel(ClimateHistorySize.Default, emissions);

    private static ClimateHistoryViewModel NewViewModel(
        ClimateHistorySize size,
        params RepositoryResult<IReadOnlyList<ClimateHistorySample>>[] emissions) =>
        new(new FakeClimateHistorySource(emissions), Localizer, size);

    private sealed class FakeClimateHistorySource(params RepositoryResult<IReadOnlyList<ClimateHistorySample>>[] emissions) : IClimateHistorySource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ClimateHistorySample>>> StreamAsync(
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
