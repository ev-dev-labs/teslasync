using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the vehicle-detail Tire-Pressure section's UI-thread-free logic — the latest-snapshot
/// JSON parse adapter (the four corner pressures), the SI Pascals → kilopascals → display conversion, the
/// per-corner safe / soft / critical band badge variant (web <c>tirePressureVariant</c>) and Normal / Low /
/// Critical / No Data badge text, the cache-then-network result mapper, the vehicle-resolving data source
/// (explicit vehicle, primary-vehicle resolution, disabled-when-no-vehicle short-circuit), the registry
/// metadata, the PII-safe diagnostics, the Narrator automation names and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline + unit re-projection). Mirrors the web spec
/// (web/src/features/vehicles/components/vehicle-detail/TirePressureSection.tsx + helpers.ts).
/// </summary>
public sealed class TirePressureSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string EmDash = "\u2014";

    // A healthy snapshot: every corner inside the soft band (≈ 290–305 kPa / ≈ 42–44 psi).
    private const string HealthySnapshot =
        """{"id":1,"vehicle_id":7,"front_left":290000,"front_right":295000,"rear_left":300000,"rear_right":305000,"created_at":"2026-06-06T11:59:00Z"}""";

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_every_corner_field()
    {
        using var doc = JsonDocument.Parse(HealthySnapshot);

        var reading = TirePressureReading.FromJson(doc.RootElement);

        Assert.Equal(290000, reading.FrontLeftPa);
        Assert.Equal(295000, reading.FrontRightPa);
        Assert.Equal(300000, reading.RearLeftPa);
        Assert.Equal(305000, reading.RearRightPa);
    }

    [Fact]
    public void FromJson_tolerates_missing_corners()
    {
        using var doc = JsonDocument.Parse("""{"front_left":288000}""");

        var reading = TirePressureReading.FromJson(doc.RootElement);

        Assert.Equal(288000, reading.FrontLeftPa);
        Assert.Null(reading.FrontRightPa);
        Assert.Null(reading.RearLeftPa);
        Assert.Null(reading.RearRightPa);
    }

    // ---- Projection: chrome + i18n -------------------------------------------------

    [Fact]
    public void Project_exposes_localized_chrome()
    {
        var display = Project(HealthySnapshot);

        Assert.True(display.HasData);
        Assert.Equal("Tire Pressure", display.Title);
        Assert.Equal("Tire pressure for each wheel", display.PanelAutomationName);
        Assert.Equal("No tire pressure data available", display.EmptyMessage);
    }

    // ---- Projection: SI Pascals → kPa → display ------------------------------------

    [Fact]
    public void Project_divides_pascals_to_kilopascals_in_metric()
    {
        var display = Project(HealthySnapshot);

        // 290000 Pa / 1000 = 290 kPa (metric is identity), formatted with one decimal + unit.
        Assert.Equal("290.0 kPa", TileByKey(display, "fl").Value);
        Assert.Equal("305.0 kPa", TileByKey(display, "rr").Value);
    }

    [Fact]
    public void Project_converts_to_psi_in_imperial()
    {
        var fl = TileByKey(Project(HealthySnapshot, UnitPref.Imperial), "fl");

        Assert.Equal(UnitFormatters.FormatPressure(290, UnitPref.Imperial), fl.Value);
        Assert.EndsWith("psi", fl.Value, StringComparison.Ordinal);
    }

    // ---- Projection: tile order + null tiles ---------------------------------------

    [Fact]
    public void Project_lists_all_four_corners_in_web_order()
    {
        var keys = Project(HealthySnapshot).Tiles.Select(t => t.Key).ToArray();
        Assert.Equal(new[] { "fl", "fr", "rl", "rr" }, keys);
    }

    [Fact]
    public void Project_localizes_full_corner_labels_in_web_order()
    {
        var labels = Project(HealthySnapshot).Tiles.Select(t => t.Label).ToArray();
        Assert.Equal(new[] { "Front Left", "Front Right", "Rear Left", "Rear Right" }, labels);
    }

    [Fact]
    public void Project_null_corner_shows_em_dash_value_and_no_data_badge()
    {
        var display = Project("""{"front_left":290000,"front_right":295000,"rear_left":300000}""");

        var rr = TileByKey(display, "rr");
        Assert.Equal(EmDash, rr.Value);
        Assert.Equal(StatusKind.Neutral, rr.BadgeStatus);
        Assert.Equal("No Data", rr.BadgeLabel);
    }

    // ---- Projection: per-corner badge bands (variant + text) -----------------------

    [Theory]
    [InlineData(290000, StatusKind.Success, "Normal")] // inside soft band
    [InlineData(241300, StatusKind.Success, "Normal")] // exactly the low-warning bound
    [InlineData(310300, StatusKind.Success, "Normal")] // exactly the high-warning bound
    [InlineData(220000, StatusKind.Warning, "Low")]    // soft-low (between critical-low and warning-low)
    [InlineData(330000, StatusKind.Warning, "Low")]    // soft-high (between warning-high and critical-high)
    [InlineData(206800, StatusKind.Warning, "Low")]    // exactly the critical-low bound
    [InlineData(344700, StatusKind.Warning, "Low")]    // exactly the critical-high bound
    [InlineData(200000, StatusKind.Danger, "Critical")] // below critical-low
    [InlineData(350000, StatusKind.Danger, "Critical")] // above critical-high
    public void Project_maps_corner_pressure_to_badge_band(double pa, StatusKind expectedStatus, string expectedBadge)
    {
        var fl = TileByKey(
            Project(string.Create(CultureInfo.InvariantCulture, $$"""{"front_left":{{pa}}}""")), "fl");

        Assert.Equal(expectedStatus, fl.BadgeStatus);
        Assert.Equal(expectedBadge, fl.BadgeLabel);
    }

    [Fact]
    public void Thresholds_variant_treats_null_as_neutral()
    {
        Assert.Equal(StatusKind.Neutral, TirePressureSectionThresholds.Variant(null));
    }

    [Fact]
    public void BadgeFor_maps_each_variant_to_its_web_text()
    {
        Assert.Equal("Normal", TirePressureSectionProjection.BadgeFor(StatusKind.Success).Fallback);
        Assert.Equal("Low", TirePressureSectionProjection.BadgeFor(StatusKind.Warning).Fallback);
        Assert.Equal("Critical", TirePressureSectionProjection.BadgeFor(StatusKind.Danger).Fallback);
        Assert.Equal("No Data", TirePressureSectionProjection.BadgeFor(StatusKind.Neutral).Fallback);
    }

    // ---- Projection: empty ---------------------------------------------------------

    [Fact]
    public void Project_empty_reports_no_data_and_no_tiles()
    {
        var display = TirePressureSectionProjection.Empty(Localizer);

        Assert.False(display.HasData);
        Assert.Empty(display.Tiles);
        Assert.Equal("No tire pressure data available", display.EmptyMessage);
    }

    [Fact]
    public void Project_present_snapshot_with_all_null_corners_is_still_content()
    {
        // Web parity: a truthy `tireData` object always renders the grid, even when every corner is null.
        var display = Project("""{"id":1,"vehicle_id":7}""");

        Assert.True(display.HasData);
        Assert.Equal(4, display.Tiles.Count);
        Assert.All(display.Tiles, t =>
        {
            Assert.Equal(EmDash, t.Value);
            Assert.Equal("No Data", t.BadgeLabel);
        });
    }

    // ---- Accessibility -------------------------------------------------------------

    [Fact]
    public void Project_tiles_carry_narrator_automation_names()
    {
        var display = Project(HealthySnapshot);

        Assert.All(display.Tiles, t =>
        {
            Assert.False(string.IsNullOrWhiteSpace(t.AutomationName));
            Assert.Contains(t.Value, t.AutomationName, StringComparison.Ordinal);
            Assert.Contains(t.BadgeLabel, t.AutomationName, StringComparison.Ordinal);
        });
    }

    [Fact]
    public void Project_tile_automation_name_starts_with_full_corner_label()
    {
        var fl = TileByKey(Project(HealthySnapshot), "fl");
        Assert.StartsWith("Front Left", fl.AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(HealthySnapshot);
        var cached = RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true);

        var mapped = TirePressureSectionResultMapper.Map(cached);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Equal(290000, mapped.Value!.FrontLeftPa);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(HealthySnapshot);

        Assert.Equal(LoadStatus.Loaded, TirePressureSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement.Clone(), Now)).Status);

        Assert.Equal(LoadStatus.Empty, TirePressureSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        var failure = TirePressureSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
        Assert.Equal(RepositoryErrorKind.Server, failure.Error!.Kind);
    }

    [Fact]
    public void Mapper_offline_preserves_cached_snapshot()
    {
        using var doc = JsonDocument.Parse(HealthySnapshot);
        var offline = RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement.Clone(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline"));

        var mapped = TirePressureSectionResultMapper.Map(offline);

        Assert.Equal(LoadStatus.Offline, mapped.Status);
        Assert.Equal(290000, mapped.Value!.FrontLeftPa);
    }

    [Fact]
    public void Mapper_non_object_payload_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var loaded = RepositoryResult<JsonElement>.Loaded(doc.RootElement.Clone(), Now);

        Assert.Equal(LoadStatus.Empty, TirePressureSectionResultMapper.Map(loaded).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new TirePressureSectionViewModel(new FakeSource(), Localizer);
        Assert.Equal(TirePressureSectionState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_content()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Loaded(Reading(), Now));

        await vm.LoadAsync();

        Assert.Equal(TirePressureSectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Tiles.Count);
    }

    [Fact]
    public async Task ViewModel_explicit_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(TirePressureSectionState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No tire pressure data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(TirePressureSectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_content()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Cached(Reading(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(TirePressureSectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_content_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(TirePressureSectionState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<TirePressureReading>.Loading(),
            RepositoryResult<TirePressureReading>.Cached(Reading(), Now, stale: false),
            RepositoryResult<TirePressureReading>.Loaded(Reading(), Now));

        await vm.LoadAsync();

        Assert.Equal(TirePressureSectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Loaded(Reading(), Now));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(TirePressureSectionState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_changing_units_reprojects_into_imperial()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Loaded(Reading(), Now));
        await vm.LoadAsync();
        Assert.EndsWith("kPa", TileByKey(vm.Display, "fl").Value, StringComparison.Ordinal);

        vm.Units = UnitPref.Imperial;

        Assert.EndsWith("psi", TileByKey(vm.Display, "fl").Value, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Loaded(Reading(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(TirePressureSectionViewModel.State), changed);
        Assert.Contains(nameof(TirePressureSectionViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Tire Pressure", vm.Title);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
        Assert.False(string.IsNullOrWhiteSpace(vm.LoadingLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RetryLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorTitle));
        Assert.False(string.IsNullOrWhiteSpace(vm.RefreshLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.StaleChip));
        Assert.False(string.IsNullOrWhiteSpace(vm.OfflineChip));
    }

    // ---- Repository source ---------------------------------------------------------

    [Fact]
    public async Task Source_resolves_primary_then_reads_latest_snapshot()
    {
        using var snapshot = JsonDocument.Parse(HealthySnapshot);
        var api = new FakeApiClient().ReturnsValue(snapshot.RootElement.Clone());
        var source = new TirePressureSectionSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(290000, emissions[^1].Value!.FrontLeftPa);

        var request = Assert.Single(api.Requests);
        Assert.Equal(TirePressureSectionSource.LatestOperation, request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_skips_primary_resolution()
    {
        using var snapshot = JsonDocument.Parse(HealthySnapshot);
        var api = new FakeApiClient().ReturnsValue(snapshot.RootElement.Clone());
        var source = new TirePressureSectionSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), vehicleId: 42);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_without_a_vehicle_short_circuits_to_empty_without_calling_the_api()
    {
        var api = new FakeApiClient();
        var source = new TirePressureSectionSource(new FakeVehicleSource(null), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_null_snapshot_yields_empty()
    {
        using var snapshot = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(snapshot.RootElement.Clone());
        var source = new TirePressureSectionSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), vehicleId: 5);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Contract-drift guard ------------------------------------------------------

    [Fact]
    public void LatestOperation_resolves_against_the_generated_endpoint_table()
    {
        var descriptor = GeneratedApi.ApiEndpoints.All.SingleOrDefault(
            e => e.OperationId == TirePressureSectionSource.LatestOperation);

        Assert.True(descriptor is not null, "Operation is not in the generated endpoint table.");
        Assert.Equal(GeneratedApi.HttpMethod.Get, descriptor!.Method);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("tire-pressure-section", TirePressureSectionRegistration.Id);
        Assert.Equal("TirePressureSection", TirePressureSectionRegistration.Slug);
        Assert.Equal("Tire Pressure", TirePressureSectionRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TirePressureSectionDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TirePressureSection", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static TirePressureSectionDisplay Project(string json) => Project(json, UnitPref.Metric);

    private static TirePressureSectionDisplay Project(string json, UnitPref units)
    {
        using var doc = JsonDocument.Parse(json);
        var reading = TirePressureReading.FromJson(doc.RootElement);
        return TirePressureSectionProjection.Project(reading, units, Localizer);
    }

    private static TirePressureReading Reading() => new(290000, 295000, 300000, 305000);

    private static TirePressureSectionTile TileByKey(TirePressureSectionDisplay display, string key) =>
        Assert.Single(display.Tiles, t => t.Key == key);

    private static TirePressureSectionViewModel NewViewModel(
        params RepositoryResult<TirePressureReading>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ApiClientOptions NewOptions() => new() { BaseAddress = new Uri("http://localhost") };

    private static async Task<IReadOnlyList<RepositoryResult<TirePressureReading>>> Collect(
        IAsyncEnumerable<RepositoryResult<TirePressureReading>> stream)
    {
        var list = new List<RepositoryResult<TirePressureReading>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<TirePressureReading>[] emissions)
        : ITirePressureSectionSource
    {
        public async IAsyncEnumerable<RepositoryResult<TirePressureReading>> StreamAsync(
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

    private sealed class FakeVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
