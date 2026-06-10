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
/// Headless verification of the RangeEstimateWidget's UI-thread-free logic — the JSON parse adapter (the
/// useVehicleState normalisation, shared with BatteryGauge / RangeBar), the SI-metres → display-unit
/// conversion + formatting of the rated / ideal range, the cache-then-network result mapper, the per-vehicle
/// data source (primary resolution + path-scoped request + contract id), the registry metadata, the
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error /
/// stale / offline + units reprojection). Unlike the range-bar surface, a zero-range state still renders the
/// readouts (the web gate is <c>state</c> truthiness, not a positive-range check). Mirrors the web spec
/// (web/src/features/dashboard/widgets/RangeEstimateWidget.tsx).
/// </summary>
public sealed class RangeEstimateWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    // 500 km / 520 km expressed in SI metres (the wire shape the widget consumes).
    private const double RatedMeters = 500_000;
    private const double IdealMeters = 520_000;

    private static RangeEstimateDisplay Project(RangeEstimateReading reading, UnitPref? units = null) =>
        RangeEstimateProjection.Project(reading, units ?? UnitPref.Metric, Localizer);

    // ---- Parse adapter (web useVehicleState normalisation) -------------------------

    [Fact]
    public void FromResponse_reads_primary_state_object()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":7,"rated_range":500000,"ideal_range":520000},"live":true}""");

        var reading = RangeEstimateReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(500000, reading!.RatedRange);
        Assert.Equal(520000, reading.IdealRange);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"rated_range":300000}}""");

        var reading = RangeEstimateReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(300000, reading!.RatedRange);
        Assert.Equal(0, reading.IdealRange);
    }

    [Fact]
    public void FromResponse_falls_back_to_position_snapshot()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle":{"id":5},"position":{"rated_range":400000,"ideal_range":420000}}""");

        var reading = RangeEstimateReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(400000, reading!.RatedRange);
        Assert.Equal(420000, reading.IdealRange);
    }

    [Fact]
    public void FromResponse_uses_plain_state_object_when_no_vehicle_or_position()
    {
        using var doc = JsonDocument.Parse("""{"state":{"rated_range":350000,"ideal_range":360000}}""");

        var reading = RangeEstimateReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(350000, reading!.RatedRange);
        Assert.Equal(360000, reading.IdealRange);
    }

    [Fact]
    public void FromResponse_parses_numeric_string_range()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"rated_range":"450000"}}""");

        Assert.Equal(450000, RangeEstimateReading.FromResponse(doc.RootElement)!.RatedRange);
    }

    [Fact]
    public void FromResponse_returns_null_when_no_state()
    {
        using var doc = JsonDocument.Parse("""{"live":true}""");
        Assert.Null(RangeEstimateReading.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(RangeEstimateReading.FromResponse(doc.RootElement));
    }

    // ---- Projection (web convertDistanceFromSI + fmtNumber) ------------------------

    [Fact]
    public void Project_metric_converts_and_formats()
    {
        var view = Project(new RangeEstimateReading(RatedMeters, IdealMeters));

        Assert.Equal("km", view.DistanceUnitLabel);
        Assert.Equal(500, view.RatedValue);
        Assert.Equal(520, view.IdealValue);
        Assert.Equal("500", view.RatedText);
        Assert.Equal("520", view.IdealText);
        Assert.Equal("500 km", view.RatedValueText);
        Assert.Equal("520 km", view.IdealValueText);
        Assert.Equal("Rated Range", view.RatedLabel);
        Assert.Equal("Ideal Range", view.IdealLabel);
    }

    [Fact]
    public void Project_imperial_converts_metres_to_miles()
    {
        var view = Project(new RangeEstimateReading(RatedMeters, IdealMeters), UnitPref.Imperial);

        Assert.Equal("mi", view.DistanceUnitLabel);
        Assert.Equal(311, Math.Round(view.RatedValue));  // 500000 m / 1609.344
        Assert.Equal(323, Math.Round(view.IdealValue));  // 520000 m / 1609.344
        Assert.Equal("311", view.RatedText);
        Assert.Equal("323", view.IdealText);
        Assert.Equal("311 mi", view.RatedValueText);
        Assert.Equal("323 mi", view.IdealValueText);
    }

    [Fact]
    public void Project_zero_range_still_renders_readouts()
    {
        // Web parity: the empty gate is `state ?` truthiness — a present state with zero range renders
        // "0 {unit}" readouts (unlike the range-bar surface, which hides at zero range).
        var view = Project(new RangeEstimateReading(0, 0));

        Assert.Equal("0", view.RatedText);
        Assert.Equal("0", view.IdealText);
        Assert.Equal("0 km", view.RatedValueText);
        Assert.Equal("0 km", view.IdealValueText);
    }

    [Fact]
    public void Project_non_finite_range_coerces_to_zero()
    {
        var view = Project(new RangeEstimateReading(double.NaN, double.PositiveInfinity));

        Assert.Equal(0, view.RatedValue);
        Assert.Equal(0, view.IdealValue);
        Assert.Equal("0", view.RatedText);
        Assert.Equal("0", view.IdealText);
    }

    [Fact]
    public void Project_large_range_uses_grouping()
    {
        // 1234 km should format with the en-US thousands separator (web fmtNumber grouping).
        var view = Project(new RangeEstimateReading(1_234_000, 0));
        Assert.Equal("1,234", view.RatedText);
        Assert.Equal("1,234 km", view.RatedValueText);
    }

    // ---- Accessibility (Narrator names) --------------------------------------------

    [Fact]
    public void Project_emits_non_empty_accessibility_names_containing_values()
    {
        var view = Project(new RangeEstimateReading(RatedMeters, IdealMeters));

        Assert.False(string.IsNullOrWhiteSpace(view.RatedAutomationName));
        Assert.False(string.IsNullOrWhiteSpace(view.IdealAutomationName));
        Assert.Contains(view.RatedLabel, view.RatedAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.RatedText, view.RatedAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.DistanceUnitLabel, view.RatedAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.IdealLabel, view.IdealAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.IdealText, view.IdealAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":1,"rated_range":500000,"ideal_range":520000}}""");

        var cached = RangeEstimateResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(500000, cached.Value!.RatedRange);

        var offline = RangeEstimateResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(520000, offline.Value!.IdealRange);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"rated_range":400000}}""");

        Assert.Equal(LoadStatus.Loaded, RangeEstimateResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, RangeEstimateResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, RangeEstimateResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_stateless_loaded_body_to_empty()
    {
        // Web parity: a successful response with no `state` makes stateData?.state undefined -> empty surface.
        using var doc = JsonDocument.Parse("""{"live":false}""");

        var mapped = RangeEstimateResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    [Fact]
    public void Mapper_preserves_zero_range_state()
    {
        // A present zero-range state is NOT collapsed to empty (the readouts render "0 {unit}").
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"rated_range":0,"ideal_range":0}}""");

        var mapped = RangeEstimateResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.NotNull(mapped.Value);
        Assert.Equal(0, mapped.Value!.RatedRange);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<RangeEstimateReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(RangeEstimateState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_readouts_display()
    {
        using var vm = NewViewModel(Loaded(new RangeEstimateReading(RatedMeters, IdealMeters)));
        await vm.LoadAsync();

        Assert.Equal(RangeEstimateState.Loaded, vm.State);
        Assert.True(vm.HasState);
        Assert.NotNull(vm.Display);
        Assert.Equal("500 km", vm.Display!.RatedValueText);
        Assert.Equal("520 km", vm.Display.IdealValueText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<RangeEstimateReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(RangeEstimateState.Empty, vm.State);
        Assert.False(vm.HasState);
        Assert.Null(vm.Display);
        Assert.Equal("No range data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_zero_range_state_renders_loaded_not_empty()
    {
        // Web parity: a present state with zero range still renders the readouts (not the empty surface).
        using var vm = NewViewModel(Loaded(new RangeEstimateReading(0, 0)));
        await vm.LoadAsync();

        Assert.Equal(RangeEstimateState.Loaded, vm.State);
        Assert.True(vm.HasState);
        Assert.NotNull(vm.Display);
        Assert.Equal("0 km", vm.Display!.RatedValueText);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<RangeEstimateReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(RangeEstimateState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<RangeEstimateReading>.Cached(new RangeEstimateReading(RatedMeters, IdealMeters), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(RangeEstimateState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasState);
        Assert.Equal("500 km", vm.Display!.RatedValueText);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<RangeEstimateReading>.OfflineCached(
            new RangeEstimateReading(RatedMeters, IdealMeters), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(RangeEstimateState.Offline, vm.State);
        Assert.True(vm.HasState);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<RangeEstimateReading>.Loading(),
            RepositoryResult<RangeEstimateReading>.Cached(new RangeEstimateReading(400_000, 410_000), Now, stale: false),
            RepositoryResult<RangeEstimateReading>.Loaded(new RangeEstimateReading(RatedMeters, IdealMeters), Now));
        await vm.LoadAsync();

        Assert.Equal(RangeEstimateState.Loaded, vm.State);
        Assert.Equal("500 km", vm.Display!.RatedValueText);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_display()
    {
        using var vm = NewViewModel(RangeEstimateSize.Default, UnitPref.Metric, Loaded(new RangeEstimateReading(RatedMeters, IdealMeters)));
        await vm.LoadAsync();
        Assert.Equal("km", vm.Display!.DistanceUnitLabel);
        Assert.Equal(500, vm.Display.RatedValue);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("mi", vm.Display!.DistanceUnitLabel);
        Assert.Equal(311, Math.Round(vm.Display.RatedValue));
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<RangeEstimateReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Range Estimate", vm.Title);
        Assert.Equal("No range data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new RangeEstimateReading(RatedMeters, IdealMeters)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(RangeEstimateViewModel.State), changed);
        Assert.Contains(nameof(RangeEstimateViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("range-estimate", RangeEstimateRegistration.Id);
        Assert.Equal("battery", RangeEstimateRegistration.Category);
        Assert.Equal("RangeEstimateWidget", RangeEstimateRegistration.Slug);
        Assert.Equal(new RangeEstimateSize(1, 2), RangeEstimateRegistration.DefaultSize);
        Assert.Equal(new RangeEstimateSize(1, 2), RangeEstimateRegistration.MinSize);
        Assert.Equal(new RangeEstimateSize(2, 40), RangeEstimateRegistration.MaxSize);
        Assert.Equal("Range Estimate", RangeEstimateRegistration.Name(Localizer));
        Assert.Equal("Rated, ideal, and estimated range", RangeEstimateRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(1, 2, true)]    // min / default
    [InlineData(2, 40, true)]   // max
    [InlineData(3, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, RangeEstimateRegistration.IsWithinBounds(new RangeEstimateSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new RangeEstimateSize(1, 2), RangeEstimateRegistration.Clamp(new RangeEstimateSize(0, 0)));
        Assert.Equal(new RangeEstimateSize(2, 40), RangeEstimateRegistration.Clamp(new RangeEstimateSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new RangeEstimateDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RangeEstimateWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new RangeEstimateSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_state_by_path()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":7,"rated_range":500000,"ideal_range":520000}}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new RangeEstimateSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(500000, terminal.Value!.RatedRange);
        Assert.Equal(520000, terminal.Value.IdealRange);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_state", request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":42,"rated_range":400000}}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new RangeEstimateSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal("42", request.PathParams!["vehicleID"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_stateless_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("""{"live":false}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new RangeEstimateSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public async Task Source_zero_range_state_is_preserved()
    {
        // The source preserves a zero-range state (web renders "0 {unit}" whenever a state is present).
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":3,"rated_range":0,"ideal_range":0}}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new RangeEstimateSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(0, terminal.Value!.RatedRange);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<RangeEstimateReading>>> Drain(IRangeEstimateSource source)
    {
        var list = new List<RepositoryResult<RangeEstimateReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<RangeEstimateReading> Loaded(RangeEstimateReading reading) =>
        RepositoryResult<RangeEstimateReading>.Loaded(reading, Now);

    private static RangeEstimateViewModel NewViewModel(params RepositoryResult<RangeEstimateReading>[] emissions) =>
        NewViewModel(RangeEstimateSize.Default, null, emissions);

    private static RangeEstimateViewModel NewViewModel(
        RangeEstimateSize size,
        UnitPref? units,
        params RepositoryResult<RangeEstimateReading>[] emissions) =>
        new(new FakeRangeEstimateSource(emissions), Localizer, size, units);

    private sealed class FakeRangeEstimateSource(params RepositoryResult<RangeEstimateReading>[] emissions) : IRangeEstimateSource
    {
        public async IAsyncEnumerable<RepositoryResult<RangeEstimateReading>> StreamAsync(
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
