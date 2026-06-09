using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
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
/// Headless verification of the RangeBarWidget's UI-thread-free logic — the JSON parse adapter (the
/// useVehicleState normalisation, shared with BatteryGauge), the SI-metres → display-unit conversion of the
/// rated / ideal / max range, the bar sub-labels, the EPA-variance line, the compact readout across the
/// compact / standard footprints (including the web <c>hasData = state != null &amp;&amp; (rated &gt; 0 ||
/// ideal &gt; 0)</c> gate), the cache-then-network result mapper, the per-vehicle data source (primary
/// resolution + path-scoped request + contract id), the registry metadata, the diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline +
/// size/units reprojection). Mirrors the web spec
/// (web/src/features/dashboard/widgets/RangeBarWidget.tsx).
/// </summary>
public sealed class RangeBarWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    // 500 km / 520 km expressed in SI metres (the wire shape the widget consumes).
    private const double RatedMeters = 500_000;
    private const double IdealMeters = 520_000;

    private static RangeBarDisplay Project(VehicleRangeState state, int cols, int rows, UnitPref? units = null) =>
        RangeBarProjection.Project(state, new RangeBarSize(cols, rows), units ?? UnitPref.Metric, Localizer);

    // ---- Parse adapter (web useVehicleState normalisation) -------------------------

    [Fact]
    public void FromResponse_reads_primary_state_object()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":7,"rated_range":500000,"ideal_range":520000},"live":true}""");

        var state = VehicleRangeState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(500000, state!.RatedRange);
        Assert.Equal(520000, state.IdealRange);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"rated_range":300000}}""");

        var state = VehicleRangeState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(300000, state!.RatedRange);
        Assert.Equal(0, state.IdealRange);
    }

    [Fact]
    public void FromResponse_falls_back_to_position_snapshot()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle":{"id":5},"position":{"rated_range":400000,"ideal_range":420000}}""");

        var state = VehicleRangeState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(400000, state!.RatedRange);
        Assert.Equal(420000, state.IdealRange);
    }

    [Fact]
    public void FromResponse_uses_plain_state_object_when_no_vehicle_or_position()
    {
        using var doc = JsonDocument.Parse("""{"state":{"rated_range":350000,"ideal_range":360000}}""");

        var state = VehicleRangeState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(350000, state!.RatedRange);
        Assert.Equal(360000, state.IdealRange);
    }

    [Fact]
    public void FromResponse_parses_numeric_string_range()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"rated_range":"450000"}}""");

        Assert.Equal(450000, VehicleRangeState.FromResponse(doc.RootElement)!.RatedRange);
    }

    [Fact]
    public void FromResponse_returns_null_when_no_state()
    {
        using var doc = JsonDocument.Parse("""{"live":true}""");
        Assert.Null(VehicleRangeState.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(VehicleRangeState.FromResponse(doc.RootElement));
    }

    // ---- Size / footprint flags (web isCompact) ------------------------------------

    [Theory]
    [InlineData(1, 1, true)]   // compact 1x1
    [InlineData(1, 2, false)]  // min size
    [InlineData(2, 2, false)]  // default
    [InlineData(4, 40, false)] // max
    public void Size_compact_flag_matches_web(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new RangeBarSize(cols, rows).IsCompact);

    // ---- Projection (web convertDistanceFromSI + MetricBar) ------------------------

    [Fact]
    public void Project_standard_metric_converts_and_formats()
    {
        var view = Project(new VehicleRangeState(RatedMeters, IdealMeters), 2, 2);

        Assert.True(view.HasData);
        Assert.False(view.IsCompact);
        Assert.Equal("km", view.DistanceUnitLabel);
        Assert.Equal(500, view.RatedValue);
        Assert.Equal(520, view.IdealValue);
        Assert.Equal(520, view.MaxValue);   // web Math.max(rated, ideal, 1)
        Assert.Equal("500", view.RatedText);
        Assert.Equal("520", view.IdealText);
        Assert.Equal("500 km", view.RatedSublabel);
        Assert.Equal("520 km", view.IdealSublabel);
        Assert.Equal("Rated Range", view.RatedLabel);
        Assert.Equal("Ideal Range", view.IdealLabel);
    }

    [Fact]
    public void Project_uses_brand_brushes_for_each_bar()
    {
        var view = Project(new VehicleRangeState(RatedMeters, IdealMeters), 2, 2);

        Assert.Equal("TsColorAccentBrush", view.RatedBrushKey);  // web #22d3ee cyan
        Assert.Equal("TsChartPowerBrush", view.IdealBrushKey);   // web #a78bfa violet
    }

    [Fact]
    public void Project_imperial_converts_metres_to_miles()
    {
        var view = Project(new VehicleRangeState(RatedMeters, IdealMeters), 2, 2, UnitPref.Imperial);

        Assert.Equal("mi", view.DistanceUnitLabel);
        Assert.Equal(311, Math.Round(view.RatedValue));  // 500000 m / 1609.344
        Assert.Equal(323, Math.Round(view.IdealValue));  // 520000 m / 1609.344
        Assert.Equal("311", view.RatedText);
        Assert.Equal("323", view.IdealText);
        Assert.Equal("311 mi", view.RatedSublabel);
    }

    [Fact]
    public void Project_epa_variance_positive_when_ideal_exceeds_rated()
    {
        var view = Project(new VehicleRangeState(RatedMeters, IdealMeters), 2, 2);

        Assert.True(view.ShowEpa);
        Assert.Equal("+4.0%", view.EpaValueText);  // (520000 - 500000) / 500000 * 100
        Assert.Equal("EPA variance", view.EpaLabel);
    }

    [Fact]
    public void Project_epa_variance_negative_keeps_minus_without_plus()
    {
        var view = Project(new VehicleRangeState(RatedMeters, 480_000), 2, 2);

        Assert.True(view.ShowEpa);
        Assert.Equal("-4.0%", view.EpaValueText);  // ideal < rated -> no '+' prefix
    }

    [Fact]
    public void Project_epa_hidden_when_either_range_is_zero()
    {
        Assert.False(Project(new VehicleRangeState(RatedMeters, 0), 2, 2).ShowEpa);
        Assert.False(Project(new VehicleRangeState(0, IdealMeters), 2, 2).ShowEpa);
    }

    [Theory]
    [InlineData(0, 0, false)]            // both zero -> empty
    [InlineData(500000, 0, true)]        // rated only -> data
    [InlineData(0, 520000, true)]        // ideal only -> data
    [InlineData(500000, 520000, true)]   // both -> data
    public void Project_hasData_matches_web_gate(double rated, double ideal, bool hasData) =>
        Assert.Equal(hasData, Project(new VehicleRangeState(rated, ideal), 2, 2).HasData);

    [Fact]
    public void Project_max_value_floors_at_one_metre()
    {
        // Web Math.max(rated, ideal, 1): with both ranges zero the denominator floors at 1 m so the bar
        // fraction never divides by zero (1 m -> 0.001 km in display units).
        var view = Project(new VehicleRangeState(0, 0), 2, 2);
        Assert.True(view.MaxValue > 0);
        Assert.False(view.HasData);
    }

    [Fact]
    public void Project_compact_builds_rated_readout()
    {
        var view = Project(new VehicleRangeState(RatedMeters, IdealMeters), 1, 1);

        Assert.True(view.IsCompact);
        Assert.Equal("500", view.CompactValueText);
        Assert.Equal("km rated", view.CompactCaption);
    }

    [Fact]
    public void Project_non_finite_range_coerces_to_zero()
    {
        var view = Project(new VehicleRangeState(double.NaN, double.PositiveInfinity), 2, 2);
        Assert.False(view.HasData);
        Assert.Equal(0, view.RatedValue);
        Assert.Equal(0, view.IdealValue);
    }

    // ---- EPA variance formatter ----------------------------------------------------

    [Theory]
    [InlineData(500000, 520000, "+4.0%")]
    [InlineData(500000, 500000, "+0.0%")]
    [InlineData(500000, 480000, "-4.0%")]
    public void FormatEpaVariance_matches_web(double rated, double ideal, string expected) =>
        Assert.Equal(expected, RangeBarProjection.FormatEpaVariance(rated, ideal));

    [Fact]
    public void FormatEpaVariance_zero_rated_is_empty()
    {
        Assert.Equal(string.Empty, RangeBarProjection.FormatEpaVariance(0, 500000));
    }

    // ---- Accessibility (Narrator names) --------------------------------------------

    [Fact]
    public void Project_emits_non_empty_accessibility_names_containing_values()
    {
        var view = Project(new VehicleRangeState(RatedMeters, IdealMeters), 2, 2);

        Assert.False(string.IsNullOrWhiteSpace(view.RatedAutomationName));
        Assert.False(string.IsNullOrWhiteSpace(view.IdealAutomationName));
        Assert.False(string.IsNullOrWhiteSpace(view.EpaAutomationName));
        Assert.Contains(view.RatedText, view.RatedAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.DistanceUnitLabel, view.RatedAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.RatedLabel, view.RatedAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.EpaValueText, view.EpaAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_accessibility_name_includes_value_and_unit()
    {
        var view = Project(new VehicleRangeState(RatedMeters, IdealMeters), 1, 1);

        Assert.False(string.IsNullOrWhiteSpace(view.CompactAutomationName));
        Assert.Contains(view.CompactValueText, view.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.DistanceUnitLabel, view.CompactAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":1,"rated_range":500000,"ideal_range":520000}}""");

        var cached = RangeBarResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(500000, cached.Value!.RatedRange);

        var offline = RangeBarResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(520000, offline.Value!.IdealRange);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"rated_range":400000}}""");

        Assert.Equal(LoadStatus.Loaded, RangeBarResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, RangeBarResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, RangeBarResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_stateless_loaded_body_to_empty()
    {
        // Web parity: a successful response with no `state` makes stateData?.state undefined -> empty surface.
        using var doc = JsonDocument.Parse("""{"live":false}""");

        var mapped = RangeBarResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleRangeState>.Loading());
        await vm.LoadAsync();

        Assert.Equal(RangeBarState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_bars_display()
    {
        using var vm = NewViewModel(Loaded(new VehicleRangeState(RatedMeters, IdealMeters)));
        await vm.LoadAsync();

        Assert.Equal(RangeBarState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal(500, vm.Display!.RatedValue);
        Assert.True(vm.Display.ShowEpa);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleRangeState>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(RangeBarState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No range data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_zero_range_state_gates_to_empty()
    {
        // Web parity: state present but rated == ideal == 0 -> hasData false -> empty surface.
        using var vm = NewViewModel(Loaded(new VehicleRangeState(0, 0)));
        await vm.LoadAsync();

        Assert.Equal(RangeBarState.Empty, vm.State);
        Assert.Null(vm.Display);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleRangeState>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(RangeBarState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleRangeState>.Cached(new VehicleRangeState(RatedMeters, IdealMeters), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(RangeBarState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.Equal(500, vm.Display!.RatedValue);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleRangeState>.OfflineCached(
            new VehicleRangeState(RatedMeters, IdealMeters), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(RangeBarState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleRangeState>.Loading(),
            RepositoryResult<VehicleRangeState>.Cached(new VehicleRangeState(400_000, 410_000), Now, stale: false),
            RepositoryResult<VehicleRangeState>.Loaded(new VehicleRangeState(RatedMeters, IdealMeters), Now));
        await vm.LoadAsync();

        Assert.Equal(RangeBarState.Loaded, vm.State);
        Assert.Equal("500", vm.Display!.RatedText);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(RangeBarSize.Default, null, Loaded(new VehicleRangeState(RatedMeters, IdealMeters)));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);

        vm.Size = new RangeBarSize(1, 1);
        Assert.True(vm.Display!.IsCompact);
        Assert.Equal("500", vm.Display.CompactValueText);
        Assert.Equal(RangeBarState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_display()
    {
        using var vm = NewViewModel(RangeBarSize.Default, UnitPref.Metric, Loaded(new VehicleRangeState(RatedMeters, IdealMeters)));
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
        using var vm = NewViewModel(RepositoryResult<VehicleRangeState>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Range", vm.Title);
        Assert.Equal("No range data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new VehicleRangeState(RatedMeters, IdealMeters)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(RangeBarViewModel.State), changed);
        Assert.Contains(nameof(RangeBarViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("range-bar", RangeBarRegistration.Id);
        Assert.Equal("battery", RangeBarRegistration.Category);
        Assert.Equal("RangeBarWidget", RangeBarRegistration.Slug);
        Assert.Equal(new RangeBarSize(2, 2), RangeBarRegistration.DefaultSize);
        Assert.Equal(new RangeBarSize(1, 2), RangeBarRegistration.MinSize);
        Assert.Equal(new RangeBarSize(4, 40), RangeBarRegistration.MaxSize);
        Assert.Equal("Range Bar", RangeBarRegistration.Name(Localizer));
        Assert.Contains("EPA comparison", RangeBarRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(2, 2, true)]    // default
    [InlineData(4, 40, true)]   // max
    [InlineData(5, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, RangeBarRegistration.IsWithinBounds(new RangeBarSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new RangeBarSize(1, 2), RangeBarRegistration.Clamp(new RangeBarSize(0, 0)));
        Assert.Equal(new RangeBarSize(4, 40), RangeBarRegistration.Clamp(new RangeBarSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new RangeBarDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RangeBarWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new RangeBarSource(
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
        var source = new RangeBarSource(
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
        var source = new RangeBarSource(
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
        var source = new RangeBarSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public async Task Source_zero_range_state_is_not_collapsed_by_the_source()
    {
        // The source preserves a zero-range state (the empty gate is the view-model's job, not the source's).
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":3,"rated_range":0,"ideal_range":0}}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new RangeBarSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(0, terminal.Value!.RatedRange);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<VehicleRangeState>>> Drain(IRangeBarSource source)
    {
        var list = new List<RepositoryResult<VehicleRangeState>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<VehicleRangeState> Loaded(VehicleRangeState state) =>
        RepositoryResult<VehicleRangeState>.Loaded(state, Now);

    private static RangeBarViewModel NewViewModel(params RepositoryResult<VehicleRangeState>[] emissions) =>
        NewViewModel(RangeBarSize.Default, null, emissions);

    private static RangeBarViewModel NewViewModel(
        RangeBarSize size,
        UnitPref? units,
        params RepositoryResult<VehicleRangeState>[] emissions) =>
        new(new FakeRangeBarSource(emissions), Localizer, size, units);

    private sealed class FakeRangeBarSource(params RepositoryResult<VehicleRangeState>[] emissions) : IRangeBarSource
    {
        public async IAsyncEnumerable<RepositoryResult<VehicleRangeState>> StreamAsync(
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
