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
/// Headless verification of the BatteryGaugeWidget's UI-thread-free logic — the JSON parse adapter (the
/// useVehicleState normalisation), the battery-colour threshold helper, the value formatting, the projection
/// across the compact / standard footprints, the cache-then-network result mapper, the per-vehicle data source
/// (primary resolution + path-scoped request), the registry metadata, the diagnostics, and the state-holder
/// view-model's per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web
/// spec (web/src/features/dashboard/widgets/BatteryGaugeWidget.tsx).
/// </summary>
public sealed class BatteryGaugeWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter (web useVehicleState normalisation) -------------------------

    [Fact]
    public void FromResponse_reads_primary_state_object()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":7,"battery_level":80,"is_charging":true},"live":true}""");

        var state = VehicleGaugeState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(80, state!.BatteryLevel);
        Assert.True(state.IsCharging);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1}}""");

        var state = VehicleGaugeState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(0, state!.BatteryLevel);
        Assert.False(state.IsCharging);
    }

    [Fact]
    public void FromResponse_falls_back_to_position_and_top_level_charging()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle":{"id":5},"position":{"battery_level":33},"is_charging":true}""");

        var state = VehicleGaugeState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(33, state!.BatteryLevel);
        Assert.True(state.IsCharging);
    }

    [Fact]
    public void FromResponse_uses_plain_state_object_when_no_vehicle_or_position()
    {
        using var doc = JsonDocument.Parse("""{"state":{"battery_level":55,"is_charging":false}}""");

        var state = VehicleGaugeState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(55, state!.BatteryLevel);
        Assert.False(state.IsCharging);
    }

    [Fact]
    public void FromResponse_returns_null_when_no_state()
    {
        using var doc = JsonDocument.Parse("""{"live":true}""");
        Assert.Null(VehicleGaugeState.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(VehicleGaugeState.FromResponse(doc.RootElement));
    }

    // ---- Battery colour thresholds (web batteryColor) ------------------------------

    [Theory]
    [InlineData(100, StatusKind.Success)]
    [InlineData(51, StatusKind.Success)]
    [InlineData(50, StatusKind.Warning)]  // web: > 50, so 50 is amber
    [InlineData(21, StatusKind.Warning)]
    [InlineData(20, StatusKind.Danger)]   // web: > 20, so 20 is red
    [InlineData(0, StatusKind.Danger)]
    public void StatusFor_classifies_by_threshold(double level, StatusKind expected) =>
        Assert.Equal(expected, BatteryGaugeProjection.StatusFor(level));

    [Theory]
    [InlineData(StatusKind.Success, "TsColorSuccessBrush")]
    [InlineData(StatusKind.Warning, "TsColorWarningBrush")]
    [InlineData(StatusKind.Danger, "TsColorDangerBrush")]
    public void Status_maps_to_themed_status_brush(StatusKind status, string brushKey) =>
        Assert.Equal(brushKey, StatusResources.AccentBrushKey(status));

    [Fact]
    public void Threshold_constants_match_web()
    {
        Assert.Equal(50, BatteryGaugeProjection.HealthyThresholdPercent);
        Assert.Equal(20, BatteryGaugeProjection.WarningThresholdPercent);
        Assert.Equal(100, BatteryGaugeProjection.MaxPercent);
    }

    // ---- Value formatting (web RadialGauge fmtNumber) ------------------------------

    [Theory]
    [InlineData(80, "80")]       // integer -> 0 decimals
    [InlineData(100, "100")]
    [InlineData(0, "0")]
    [InlineData(80.5, "80.50")]  // non-integer -> 2 decimals (global precision)
    public void FormatValue_matches_web(double value, string expected) =>
        Assert.Equal(expected, BatteryGaugeProjection.FormatValue(value));

    [Theory]
    [InlineData(double.NaN, "0")]
    [InlineData(double.PositiveInfinity, "0")]
    public void FormatValue_coerces_non_finite_to_zero(double value, string expected) =>
        Assert.Equal(expected, BatteryGaugeProjection.FormatValue(value));

    // ---- Size / footprint flags (web isCompact / gauge diameter) -------------------

    [Theory]
    [InlineData(1, 1, true, 70)]    // compact 1x1 -> 70px gauge
    [InlineData(1, 2, false, 100)]  // default -> 100px gauge
    [InlineData(2, 1, false, 100)]
    [InlineData(2, 2, false, 100)]
    public void Size_flags_match_web(int cols, int rows, bool compact, double diameter)
    {
        var size = new BatteryGaugeSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(diameter, size.GaugeDiameter);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_standard_formats_value_and_colours_by_level()
    {
        var view = BatteryGaugeProjection.Project(new VehicleGaugeState(80, false), new BatteryGaugeSize(1, 2), Localizer);

        Assert.Equal(80, view.Value);
        Assert.Equal(100, view.Max);
        Assert.Equal("80", view.ValueText);
        Assert.Equal("%", view.Unit);
        Assert.Equal("Battery", view.Label);
        Assert.Equal(StatusKind.Success, view.Status);
        Assert.False(view.IsCompact);
        Assert.Equal(100, view.GaugeDiameter);
        Assert.False(view.ShowCharging);
        Assert.Equal("Battery 80%", view.GaugeAutomationName);
    }

    [Fact]
    public void Project_standard_charging_shows_indicator()
    {
        var view = BatteryGaugeProjection.Project(new VehicleGaugeState(80, true), new BatteryGaugeSize(1, 2), Localizer);

        Assert.True(view.IsCharging);
        Assert.True(view.ShowCharging);
        Assert.Equal("Charging", view.ChargingText);
    }

    [Fact]
    public void Project_compact_hides_charging_and_shrinks_gauge()
    {
        var view = BatteryGaugeProjection.Project(new VehicleGaugeState(80, true), new BatteryGaugeSize(1, 1), Localizer);

        Assert.True(view.IsCompact);
        Assert.Equal(70, view.GaugeDiameter);
        Assert.True(view.IsCharging);     // still charging
        Assert.False(view.ShowCharging);  // but compact never renders the child (web {!compact && children})
    }

    [Theory]
    [InlineData(15, StatusKind.Danger)]
    [InlineData(35, StatusKind.Warning)]
    [InlineData(90, StatusKind.Success)]
    public void Project_colours_value_by_level(double level, StatusKind expected)
    {
        var view = BatteryGaugeProjection.Project(new VehicleGaugeState(level, false), new BatteryGaugeSize(1, 2), Localizer);
        Assert.Equal(expected, view.Status);
    }

    [Fact]
    public void Project_clamps_value_into_zero_hundred()
    {
        var over = BatteryGaugeProjection.Project(new VehicleGaugeState(150, false), new BatteryGaugeSize(1, 2), Localizer);
        Assert.Equal(100, over.Value);
        Assert.Equal("100", over.ValueText);

        var under = BatteryGaugeProjection.Project(new VehicleGaugeState(-10, false), new BatteryGaugeSize(1, 2), Localizer);
        Assert.Equal(0, under.Value);
        Assert.Equal("0", under.ValueText);
    }

    [Fact]
    public void Project_fractional_value_uses_two_decimals()
    {
        var view = BatteryGaugeProjection.Project(new VehicleGaugeState(80.5, false), new BatteryGaugeSize(1, 2), Localizer);
        Assert.Equal("80.50", view.ValueText);
        Assert.Equal("Battery 80.50%", view.GaugeAutomationName);
    }

    [Fact]
    public void Project_has_non_empty_accessibility_name_containing_value()
    {
        var view = BatteryGaugeProjection.Project(new VehicleGaugeState(64, false), new BatteryGaugeSize(1, 2), Localizer);
        Assert.False(string.IsNullOrWhiteSpace(view.GaugeAutomationName));
        Assert.Contains(view.ValueText, view.GaugeAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.Label, view.GaugeAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"battery_level":62,"is_charging":true}}""");

        var cached = BatteryGaugeResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(62, cached.Value!.BatteryLevel);
        Assert.True(cached.Value.IsCharging);

        var offline = BatteryGaugeResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(62, offline.Value!.BatteryLevel);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"battery_level":40}}""");

        Assert.Equal(LoadStatus.Loaded, BatteryGaugeResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, BatteryGaugeResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, BatteryGaugeResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_stateless_loaded_body_to_empty()
    {
        // Web parity: a successful response with no `state` makes stateData?.state undefined -> the empty surface.
        using var doc = JsonDocument.Parse("""{"live":false}""");

        var mapped = BatteryGaugeResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleGaugeState>.Loading());
        await vm.LoadAsync();

        Assert.Equal(BatteryGaugeState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_gauge_display()
    {
        using var vm = NewViewModel(Loaded(new VehicleGaugeState(80, true)));
        await vm.LoadAsync();

        Assert.Equal(BatteryGaugeState.Loaded, vm.State);
        Assert.True(vm.HasState);
        Assert.NotNull(vm.Display);
        Assert.Equal(80, vm.Display!.Value);
        Assert.True(vm.Display.ShowCharging);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleGaugeState>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryGaugeState.Empty, vm.State);
        Assert.False(vm.HasState);
        Assert.Null(vm.Display);
        Assert.Equal("No battery data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleGaugeState>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(BatteryGaugeState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleGaugeState>.Cached(new VehicleGaugeState(55, false), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(BatteryGaugeState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasState);
        Assert.Equal(StatusKind.Success, vm.Display!.Status);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleGaugeState>.OfflineCached(
            new VehicleGaugeState(18, false), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(BatteryGaugeState.Offline, vm.State);
        Assert.True(vm.HasState);
        Assert.True(vm.IsStale);
        Assert.Equal(StatusKind.Danger, vm.Display!.Status); // 18% -> red
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleGaugeState>.Loading(),
            RepositoryResult<VehicleGaugeState>.Cached(new VehicleGaugeState(60, false), Now, stale: false),
            RepositoryResult<VehicleGaugeState>.Loaded(new VehicleGaugeState(72, false), Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryGaugeState.Loaded, vm.State);
        Assert.Equal("72", vm.Display!.ValueText);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(BatteryGaugeSize.Default, Loaded(new VehicleGaugeState(80, true)));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);
        Assert.True(vm.Display.ShowCharging);

        vm.Size = new BatteryGaugeSize(1, 1);
        Assert.True(vm.Display!.IsCompact);
        Assert.False(vm.Display.ShowCharging);
        Assert.Equal(70, vm.Display.GaugeDiameter);
        Assert.Equal(BatteryGaugeState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleGaugeState>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Battery Level", vm.Title);
        Assert.Equal("Battery", vm.GaugeLabel);
        Assert.Equal("No battery data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new VehicleGaugeState(80, false)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(BatteryGaugeViewModel.State), changed);
        Assert.Contains(nameof(BatteryGaugeViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("battery-gauge", BatteryGaugeRegistration.Id);
        Assert.Equal("battery", BatteryGaugeRegistration.Category);
        Assert.Equal("BatteryGaugeWidget", BatteryGaugeRegistration.Slug);
        Assert.Equal(new BatteryGaugeSize(1, 2), BatteryGaugeRegistration.DefaultSize);
        Assert.Equal(new BatteryGaugeSize(1, 2), BatteryGaugeRegistration.MinSize);
        Assert.Equal(new BatteryGaugeSize(2, 40), BatteryGaugeRegistration.MaxSize);
        Assert.Equal("Battery Level", BatteryGaugeRegistration.Name(Localizer));
        Assert.Contains("radial gauge", BatteryGaugeRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]    // min == default
    [InlineData(2, 40, true)]   // max
    [InlineData(2, 10, true)]   // inside
    [InlineData(3, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, BatteryGaugeRegistration.IsWithinBounds(new BatteryGaugeSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new BatteryGaugeSize(1, 2), BatteryGaugeRegistration.Clamp(new BatteryGaugeSize(0, 0)));
        Assert.Equal(new BatteryGaugeSize(2, 40), BatteryGaugeRegistration.Clamp(new BatteryGaugeSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new BatteryGaugeDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryGaugeWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new BatteryGaugeSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_state_by_path()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":7,"battery_level":80,"is_charging":true}}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryGaugeSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(80, terminal.Value!.BatteryLevel);
        Assert.True(terminal.Value.IsCharging);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_state", request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":42,"battery_level":50}}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryGaugeSource(
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
        var source = new BatteryGaugeSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<VehicleGaugeState>>> Drain(IBatteryGaugeSource source)
    {
        var list = new List<RepositoryResult<VehicleGaugeState>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<VehicleGaugeState> Loaded(VehicleGaugeState state) =>
        RepositoryResult<VehicleGaugeState>.Loaded(state, Now);

    private static BatteryGaugeViewModel NewViewModel(params RepositoryResult<VehicleGaugeState>[] emissions) =>
        NewViewModel(BatteryGaugeSize.Default, emissions);

    private static BatteryGaugeViewModel NewViewModel(
        BatteryGaugeSize size,
        params RepositoryResult<VehicleGaugeState>[] emissions) =>
        new(new FakeBatteryGaugeSource(emissions), Localizer, size);

    private sealed class FakeBatteryGaugeSource(params RepositoryResult<VehicleGaugeState>[] emissions) : IBatteryGaugeSource
    {
        public async IAsyncEnumerable<RepositoryResult<VehicleGaugeState>> StreamAsync(
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
