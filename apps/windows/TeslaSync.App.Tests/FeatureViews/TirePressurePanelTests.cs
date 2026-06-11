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
/// Headless verification of the live-telemetry Tire-Pressure panel's UI-thread-free logic — the latest-snapshot
/// JSON parse adapter (the four corner pressures), the SI Pascals → kilopascals → display conversion, the
/// per-corner safe / soft / critical band status mapping (web <c>getColor</c> / <c>getBorder</c>), the overall
/// <c>allGood</c> / <c>anyBad</c> summary-chip selection, the cache-then-network result mapper, the
/// vehicle-resolving data source (explicit vehicle, primary-vehicle resolution, disabled-when-no-vehicle
/// short-circuit), the registry metadata, the PII-safe diagnostics, the Narrator automation names and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline + unit
/// re-projection). Mirrors the web spec
/// (web/src/features/vehicles/components/telemetry-panels/TirePressurePanel.tsx + helpers.ts).
/// </summary>
public sealed class TirePressurePanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // 1 psi = 6.894757 kPa (NIST SP 811) — the same display constant the converter uses.
    private const double KpaPerPsi = 6.894757;
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

    [Fact]
    public void FromJson_reads_numeric_string_corner()
    {
        using var doc = JsonDocument.Parse("""{"front_left":"241300"}""");
        Assert.Equal(241300, TirePressureReading.FromJson(doc.RootElement).FrontLeftPa);
    }

    [Fact]
    public void FromJson_non_object_yields_all_null()
    {
        using var doc = JsonDocument.Parse("null");

        var reading = TirePressureReading.FromJson(doc.RootElement);

        Assert.Null(reading.FrontLeftPa);
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
        Assert.Equal("290.0 kPa", CornerByKey(display, "fl").Value);
        Assert.Equal("305.0 kPa", CornerByKey(display, "rr").Value);
    }

    [Fact]
    public void Project_converts_to_psi_in_imperial()
    {
        var fl = CornerByKey(Project(HealthySnapshot, UnitPref.Imperial), "fl");

        Assert.Equal(UnitFormatters.FormatPressure(290, UnitPref.Imperial), fl.Value);
        Assert.EndsWith("psi", fl.Value, StringComparison.Ordinal);

        // 290 kPa → ~42.06 psi → "42.1 psi" at one decimal.
        string expected = (290.0 / KpaPerPsi).ToString("0.0", CultureInfo.InvariantCulture);
        Assert.Contains(expected, fl.Value, StringComparison.Ordinal);
    }

    // ---- Projection: corner order + null tiles -------------------------------------

    [Fact]
    public void Project_lists_all_four_corners_in_web_order()
    {
        var keys = Project(HealthySnapshot).Corners.Select(c => c.Key).ToArray();
        Assert.Equal(new[] { "fl", "fr", "rl", "rr" }, keys);
    }

    [Fact]
    public void Project_localizes_corner_labels_in_web_order()
    {
        var labels = Project(HealthySnapshot).Corners.Select(c => c.Label).ToArray();
        Assert.Equal(new[] { "FL", "FR", "RL", "RR" }, labels);
    }

    [Fact]
    public void Project_null_corner_shows_em_dash_and_neutral_status()
    {
        var display = Project("""{"front_left":290000,"front_right":295000,"rear_left":300000}""");

        var rr = CornerByKey(display, "rr");
        Assert.Equal(EmDash, rr.Value);
        Assert.Equal(StatusKind.Neutral, rr.Status);
    }

    // ---- Projection: per-corner status bands ---------------------------------------

    [Theory]
    [InlineData(290000, StatusKind.Success)] // inside soft band
    [InlineData(241300, StatusKind.Success)] // exactly the low-warning bound
    [InlineData(310300, StatusKind.Success)] // exactly the high-warning bound
    [InlineData(220000, StatusKind.Warning)] // soft-low (between critical-low and warning-low)
    [InlineData(330000, StatusKind.Warning)] // soft-high (between warning-high and critical-high)
    [InlineData(200000, StatusKind.Danger)]  // below critical-low
    [InlineData(350000, StatusKind.Danger)]  // above critical-high
    public void Project_maps_corner_pressure_to_status_band(double pa, StatusKind expected)
    {
        var display = Project(
            string.Create(CultureInfo.InvariantCulture, $$"""{"front_left":{{pa}}}"""));
        Assert.Equal(expected, CornerByKey(display, "fl").Status);
    }

    [Fact]
    public void Thresholds_corner_status_treats_null_as_neutral()
    {
        Assert.Equal(StatusKind.Neutral, TirePressurePanelThresholds.CornerStatus(null));
    }

    // ---- Projection: summary chip (allGood / anyBad) -------------------------------

    [Fact]
    public void Project_summary_all_in_band_is_all_normal_success()
    {
        var summary = Project(HealthySnapshot).Summary;

        Assert.NotNull(summary);
        Assert.Equal(StatusKind.Success, summary!.Status);
        Assert.Equal("All Normal", summary.Label);
        Assert.Equal(TirePressurePanelProjection.AllNormalGlyph, summary.Glyph);
    }

    [Fact]
    public void Project_summary_any_critical_is_attention_needed_danger()
    {
        var summary = Project(
            """{"front_left":200000,"front_right":295000,"rear_left":300000,"rear_right":305000}""").Summary;

        Assert.NotNull(summary);
        Assert.Equal(StatusKind.Danger, summary!.Status);
        Assert.Equal("Attention Needed", summary.Label);
        Assert.Equal(TirePressurePanelProjection.AttentionGlyph, summary.Glyph);
    }

    [Fact]
    public void Project_summary_soft_band_without_critical_is_check_pressure_warning()
    {
        // FL is soft-low (not all-good) but no corner is critical → amber "Check Pressure".
        var summary = Project(
            """{"front_left":220000,"front_right":295000,"rear_left":300000,"rear_right":305000}""").Summary;

        Assert.NotNull(summary);
        Assert.Equal(StatusKind.Warning, summary!.Status);
        Assert.Equal("Check Pressure", summary.Label);
        Assert.Equal(TirePressurePanelProjection.CheckGlyph, summary.Glyph);
    }

    [Fact]
    public void Project_summary_all_null_is_check_pressure_warning()
    {
        // A present snapshot with no corner readings is still content (web truthy tireData) → amber chip.
        var summary = Project("""{"id":1,"vehicle_id":7}""").Summary;

        Assert.NotNull(summary);
        Assert.Equal(StatusKind.Warning, summary!.Status);
        Assert.Equal("Check Pressure", summary.Label);
    }

    // ---- Projection: empty ---------------------------------------------------------

    [Fact]
    public void Project_empty_reports_no_data_and_no_corners()
    {
        var display = TirePressurePanelProjection.Empty(Localizer);

        Assert.False(display.HasData);
        Assert.Empty(display.Corners);
        Assert.Null(display.Summary);
        Assert.Equal("No tire pressure data available", display.EmptyMessage);
    }

    // ---- Accessibility -------------------------------------------------------------

    [Fact]
    public void Project_corners_and_summary_carry_narrator_automation_names()
    {
        var display = Project(HealthySnapshot);

        Assert.All(display.Corners, c =>
        {
            Assert.False(string.IsNullOrWhiteSpace(c.AutomationName));
            Assert.Contains(c.Value, c.AutomationName, StringComparison.Ordinal);
        });
        Assert.False(string.IsNullOrWhiteSpace(display.Summary!.AutomationName));
    }

    [Fact]
    public void Project_corner_automation_name_uses_full_corner_label()
    {
        var fl = CornerByKey(Project(HealthySnapshot), "fl");
        Assert.StartsWith("Front Left", fl.AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(HealthySnapshot);
        var cached = RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true);

        var mapped = TirePressurePanelResultMapper.Map(cached);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Equal(290000, mapped.Value!.FrontLeftPa);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(HealthySnapshot);

        Assert.Equal(LoadStatus.Loaded, TirePressurePanelResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement.Clone(), Now)).Status);

        Assert.Equal(LoadStatus.Empty, TirePressurePanelResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        var failure = TirePressurePanelResultMapper.Map(
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

        var mapped = TirePressurePanelResultMapper.Map(offline);

        Assert.Equal(LoadStatus.Offline, mapped.Status);
        Assert.Equal(290000, mapped.Value!.FrontLeftPa);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new TirePressurePanelViewModel(new FakeSource(), Localizer);
        Assert.Equal(TirePressurePanelState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_content()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Loaded(Reading(), Now));

        await vm.LoadAsync();

        Assert.Equal(TirePressurePanelState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Corners.Count);
    }

    [Fact]
    public async Task ViewModel_explicit_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(TirePressurePanelState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No tire pressure data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(TirePressurePanelState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_content()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Cached(Reading(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(TirePressurePanelState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_content_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(TirePressurePanelState.Offline, vm.State);
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

        Assert.Equal(TirePressurePanelState.Loaded, vm.State);
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
        Assert.Equal(TirePressurePanelState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_changing_units_reprojects_into_imperial()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Loaded(Reading(), Now));
        await vm.LoadAsync();
        Assert.EndsWith("kPa", CornerByKey(vm.Display, "fl").Value, StringComparison.Ordinal);

        vm.Units = UnitPref.Imperial;

        Assert.EndsWith("psi", CornerByKey(vm.Display, "fl").Value, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Loaded(Reading(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(TirePressurePanelViewModel.State), changed);
        Assert.Contains(nameof(TirePressurePanelViewModel.Display), changed);
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
        var source = new TirePressurePanelSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(290000, emissions[^1].Value!.FrontLeftPa);

        var request = Assert.Single(api.Requests);
        Assert.Equal(TirePressurePanelSource.LatestOperation, request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_skips_primary_resolution()
    {
        using var snapshot = JsonDocument.Parse(HealthySnapshot);
        var api = new FakeApiClient().ReturnsValue(snapshot.RootElement.Clone());
        var source = new TirePressurePanelSource(
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
        var source = new TirePressurePanelSource(new FakeVehicleSource(null), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_null_snapshot_yields_empty()
    {
        using var snapshot = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(snapshot.RootElement.Clone());
        var source = new TirePressurePanelSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), vehicleId: 5);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Contract-drift guard ------------------------------------------------------

    [Fact]
    public void LatestOperation_resolves_against_the_generated_endpoint_table()
    {
        var descriptor = GeneratedApi.ApiEndpoints.All.SingleOrDefault(
            e => e.OperationId == TirePressurePanelSource.LatestOperation);

        Assert.True(descriptor is not null, "Operation is not in the generated endpoint table.");
        Assert.Equal(GeneratedApi.HttpMethod.Get, descriptor!.Method);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("tire-pressure-panel", TirePressurePanelRegistration.Id);
        Assert.Equal("TirePressurePanel", TirePressurePanelRegistration.Slug);
        Assert.Equal("Tire Pressure", TirePressurePanelRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TirePressurePanelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TirePressurePanel", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static TirePressurePanelDisplay Project(string json) => Project(json, UnitPref.Metric);

    private static TirePressurePanelDisplay Project(string json, UnitPref units)
    {
        using var doc = JsonDocument.Parse(json);
        var reading = TirePressureReading.FromJson(doc.RootElement);
        return TirePressurePanelProjection.Project(reading, units, Localizer);
    }

    private static TirePressureReading Reading() => new(290000, 295000, 300000, 305000);

    private static TirePressurePanelCorner CornerByKey(TirePressurePanelDisplay display, string key) =>
        Assert.Single(display.Corners, c => c.Key == key);

    private static TirePressurePanelViewModel NewViewModel(
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
        : ITirePressurePanelSource
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
