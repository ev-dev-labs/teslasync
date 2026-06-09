using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Driving Temperature Stats surface's UI-thread-free logic — the
/// <c>drive_analytics.temperature</c> JSON parse adapter (with the web <c>safe()</c> coercion), the
/// SI→display unit projection of the six inside/outside min/avg/max cells, the cache-then-network result
/// mapper, the repository source's request shape, the state-holder view-model's state matrix
/// (loading / loaded / empty / error / stale / offline), the registration metadata, the PII-safe
/// diagnostics, and the per-cell Narrator names. Mirrors the web spec
/// (web/src/features/analytics/components/analytics/DrivingTemperatureStats.tsx).
/// </summary>
public sealed class DrivingTemperatureStatsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // ---- Parse adapter (drive_analytics.temperature) -------------------------------

    [Fact]
    public void FromJson_reads_inside_and_outside_min_avg_max()
    {
        const string json = """
        {"drive_analytics":{"temperature":{
          "inside":{"min":20,"avg":22.5,"max":25,"median":22,"p95":24,"count":100},
          "outside":{"min":5,"avg":12.5,"max":30}}}}
        """;
        using var doc = JsonDocument.Parse(json);

        var snapshot = DrivingTemperatureSnapshot.FromJson(doc.RootElement);

        Assert.NotNull(snapshot.Inside);
        Assert.Equal(20, snapshot.Inside!.Min);
        Assert.Equal(22.5, snapshot.Inside.Avg);
        Assert.Equal(25, snapshot.Inside.Max);
        Assert.NotNull(snapshot.Outside);
        Assert.Equal(5, snapshot.Outside!.Min);
        Assert.Equal(12.5, snapshot.Outside.Avg);
        Assert.Equal(30, snapshot.Outside.Max);
        Assert.True(snapshot.HasData);
    }

    [Fact]
    public void FromJson_returns_empty_when_temperature_block_is_absent()
    {
        using var noTemp = JsonDocument.Parse("""{"drive_analytics":{"speed_stats":{"min":0}}}""");
        Assert.False(DrivingTemperatureSnapshot.FromJson(noTemp.RootElement).HasData);

        using var noDrive = JsonDocument.Parse("""{"total_vehicles":3}""");
        Assert.False(DrivingTemperatureSnapshot.FromJson(noDrive.RootElement).HasData);

        using var nonObject = JsonDocument.Parse("[]");
        Assert.False(DrivingTemperatureSnapshot.FromJson(nonObject.RootElement).HasData);
    }

    [Fact]
    public void FromJson_keeps_one_side_when_only_one_is_present()
    {
        using var doc = JsonDocument.Parse("""{"drive_analytics":{"temperature":{"outside":{"min":1,"avg":2,"max":3}}}}""");

        var snapshot = DrivingTemperatureSnapshot.FromJson(doc.RootElement);

        Assert.Null(snapshot.Inside);
        Assert.NotNull(snapshot.Outside);
        Assert.Equal(2, snapshot.Outside!.Avg);
        Assert.True(snapshot.HasData);
    }

    [Fact]
    public void FromJson_treats_a_present_but_empty_side_as_zeroes()
    {
        // web: insideTemp = {} is truthy → cells render with safe(undefined) === 0.
        using var doc = JsonDocument.Parse("""{"drive_analytics":{"temperature":{"inside":{}}}}""");

        var snapshot = DrivingTemperatureSnapshot.FromJson(doc.RootElement);

        Assert.NotNull(snapshot.Inside);
        Assert.Equal(0, snapshot.Inside!.Min);
        Assert.Equal(0, snapshot.Inside.Avg);
        Assert.Equal(0, snapshot.Inside.Max);
        Assert.Null(snapshot.Outside);
        Assert.True(snapshot.HasData);
    }

    [Fact]
    public void FromJson_safe_coerces_null_and_unparseable_values_to_zero()
    {
        using var doc = JsonDocument.Parse("""{"drive_analytics":{"temperature":{"inside":{"min":null,"avg":"bad","max":25}}}}""");

        var snapshot = DrivingTemperatureSnapshot.FromJson(doc.RootElement);

        Assert.Equal(0, snapshot.Inside!.Min);  // null  -> 0
        Assert.Equal(0, snapshot.Inside.Avg);   // "bad" -> 0
        Assert.Equal(25, snapshot.Inside.Max);  // 25
    }

    [Fact]
    public void FromJson_parses_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"drive_analytics":{"temperature":{"inside":{"min":"18.5","avg":"20","max":"23.1"}}}}""");

        var snapshot = DrivingTemperatureSnapshot.FromJson(doc.RootElement);

        Assert.Equal(18.5, snapshot.Inside!.Min);
        Assert.Equal(20, snapshot.Inside.Avg);
        Assert.Equal(23.1, snapshot.Inside.Max);
    }

    // ---- Projection (metric / imperial / em-dash / accents / a11y) -----------------

    [Fact]
    public void Project_metric_formats_six_cells_with_celsius()
    {
        var display = DrivingTemperatureStatsProjection.Project(
            Snapshot(Side(20, 22.5, 25), Side(5, 12.5, 30)), UnitPref.Metric, Localizer);

        Assert.True(display.HasData);
        Assert.Equal(6, display.Tiles.Count);

        Assert.Equal("Inside Min", display.Tiles[0].Label);
        Assert.Equal("20.0", display.Tiles[0].Value);
        Assert.Equal("\u00B0C", display.Tiles[0].Unit);

        Assert.Equal("Inside Avg", display.Tiles[1].Label);
        Assert.Equal("22.5", display.Tiles[1].Value);

        Assert.Equal("Inside Max", display.Tiles[2].Label);
        Assert.Equal("25.0", display.Tiles[2].Value);

        Assert.Equal("Outside Min", display.Tiles[3].Label);
        Assert.Equal("5.0", display.Tiles[3].Value);

        Assert.Equal("Outside Avg", display.Tiles[4].Label);
        Assert.Equal("12.5", display.Tiles[4].Value);

        Assert.Equal("Outside Max", display.Tiles[5].Label);
        Assert.Equal("30.0", display.Tiles[5].Value);
    }

    [Fact]
    public void Project_imperial_converts_celsius_to_fahrenheit()
    {
        var display = DrivingTemperatureStatsProjection.Project(
            Snapshot(Side(20, 22.5, 25), Side(0, 10, 20)), UnitPref.Imperial, Localizer);

        Assert.Equal("68.0", display.Tiles[0].Value);   // 20 °C  -> 68.0 °F
        Assert.Equal("72.5", display.Tiles[1].Value);   // 22.5   -> 72.5
        Assert.Equal("77.0", display.Tiles[2].Value);   // 25     -> 77.0
        Assert.Equal("32.0", display.Tiles[3].Value);   // 0      -> 32.0
        Assert.Equal("50.0", display.Tiles[4].Value);   // 10     -> 50.0
        Assert.Equal("68.0", display.Tiles[5].Value);   // 20     -> 68.0
        Assert.Equal("\u00B0F", display.Tiles[0].Unit);
    }

    [Fact]
    public void Project_renders_em_dash_for_an_absent_side()
    {
        // web: insideTemp ? value : '—' — only the outside cells carry values here.
        var display = DrivingTemperatureStatsProjection.Project(
            Snapshot(inside: null, outside: Side(1, 2, 3)), UnitPref.Metric, Localizer);

        Assert.Equal("\u2014", display.Tiles[0].Value);
        Assert.Equal("\u2014", display.Tiles[1].Value);
        Assert.Equal("\u2014", display.Tiles[2].Value);
        Assert.Equal("1.0", display.Tiles[3].Value);
        Assert.Equal("2.0", display.Tiles[4].Value);
        Assert.Equal("3.0", display.Tiles[5].Value);
        Assert.True(display.HasData);
    }

    [Fact]
    public void Project_assigns_cyan_green_amber_accents_per_metric()
    {
        var display = DrivingTemperatureStatsProjection.Project(
            Snapshot(Side(1, 2, 3), Side(4, 5, 6)), UnitPref.Metric, Localizer);

        // min -> info (cyan), avg -> success (green), max -> warning (amber), for both sides.
        Assert.Equal("TsColorInfoBrush", display.Tiles[0].AccentBrushKey);
        Assert.Equal("TsColorSuccessBrush", display.Tiles[1].AccentBrushKey);
        Assert.Equal("TsColorWarningBrush", display.Tiles[2].AccentBrushKey);
        Assert.Equal("TsColorInfoBrush", display.Tiles[3].AccentBrushKey);
        Assert.Equal("TsColorSuccessBrush", display.Tiles[4].AccentBrushKey);
        Assert.Equal("TsColorWarningBrush", display.Tiles[5].AccentBrushKey);
    }

    [Fact]
    public void Project_no_data_snapshot_reports_empty_display()
    {
        var display = DrivingTemperatureStatsProjection.Project(
            DrivingTemperatureSnapshot.Empty, UnitPref.Metric, Localizer);

        Assert.False(display.HasData);
    }

    [Fact]
    public void Project_cells_have_accessibility_names_with_label_value_and_unit()
    {
        var display = DrivingTemperatureStatsProjection.Project(
            Snapshot(Side(20, 22.5, 25), outside: null), UnitPref.Metric, Localizer);

        // Populated cell: label + value + unit are all present for Narrator.
        Assert.Equal("Inside Min: 20.0 \u00B0C", display.Tiles[0].AutomationName);
        Assert.Contains(display.Tiles[1].Label, display.Tiles[1].AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.Tiles[1].Value, display.Tiles[1].AutomationName, StringComparison.Ordinal);

        // Em-dash cell: still names the metric, without a misleading unit reading.
        Assert.Equal("Outside Min: \u2014", display.Tiles[3].AutomationName);

        foreach (var tile in display.Tiles)
        {
            Assert.False(string.IsNullOrWhiteSpace(tile.AutomationName));
        }
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"drive_analytics":{"temperature":{"inside":{"min":1,"avg":2,"max":3}}}}""");

        var cached = DrivingTemperatureStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(2, cached.Value!.Inside!.Avg);

        var offline = DrivingTemperatureStatsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.HasData);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"drive_analytics":{"temperature":{"inside":{"min":1,"avg":2,"max":3}}}}""");

        Assert.Equal(LoadStatus.Loaded, DrivingTemperatureStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, DrivingTemperatureStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, DrivingTemperatureStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new DrivingTemperatureStatsViewModel(new FakeSource(), Localizer);
        Assert.Equal(DrivingTemperatureState.Loading, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_six_cells()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Side(20, 22.5, 25), Side(5, 12.5, 30))));

        await vm.LoadAsync();

        Assert.Equal(DrivingTemperatureState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(6, vm.Display.Tiles.Count);
        Assert.Equal("20.0", vm.Display.Tiles[0].Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_temperature_renders_empty()
    {
        using var vm = NewViewModel(Loaded(DrivingTemperatureSnapshot.Empty));

        await vm.LoadAsync();

        Assert.Equal(DrivingTemperatureState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No temperature stats", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<DrivingTemperatureSnapshot>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(DrivingTemperatureState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<DrivingTemperatureSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(DrivingTemperatureState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<DrivingTemperatureSnapshot>.Cached(Snapshot(Side(1, 2, 3), null), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(DrivingTemperatureState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<DrivingTemperatureSnapshot>.OfflineCached(
            Snapshot(Side(1, 2, 3), null), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(DrivingTemperatureState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<DrivingTemperatureSnapshot>.Loading(),
            RepositoryResult<DrivingTemperatureSnapshot>.Cached(Snapshot(Side(10, 11, 12), null), Now, stale: false),
            RepositoryResult<DrivingTemperatureSnapshot>.Loaded(Snapshot(Side(20, 22.5, 25), null), Now));

        await vm.LoadAsync();

        Assert.Equal(DrivingTemperatureState.Loaded, vm.State);
        Assert.Equal("20.0", vm.Display.Tiles[0].Value);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_values()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Side(20, 22.5, 25), null)));
        await vm.LoadAsync();
        Assert.Equal("\u00B0C", vm.Display.Tiles[0].Unit);
        Assert.Equal("20.0", vm.Display.Tiles[0].Value);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("\u00B0F", vm.Display.Tiles[0].Unit);
        Assert.Equal("68.0", vm.Display.Tiles[0].Value);
        Assert.Equal(DrivingTemperatureState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Side(1, 2, 3), null)));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(DrivingTemperatureState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<DrivingTemperatureSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Temperature Stats", vm.Title);
        Assert.Equal("No temperature stats", vm.EmptyMessage);
        Assert.False(string.IsNullOrWhiteSpace(vm.LoadingLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RetryLabel));
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Side(1, 2, 3), null)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(DrivingTemperatureStatsViewModel.State), changed);
        Assert.Contains(nameof(DrivingTemperatureStatsViewModel.Display), changed);
    }

    // ---- Repository source request shape -------------------------------------------

    [Fact]
    public async Task Source_streams_and_targets_the_fleet_operation_with_the_default_window()
    {
        using var doc = JsonDocument.Parse(
            """{"drive_analytics":{"temperature":{"inside":{"min":1,"avg":2,"max":3}}}}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.True(emissions[^1].Value!.HasData);
        Assert.Equal(Operations.Analytics.Fleet, client.Requests[^1].OperationId);
        Assert.Equal(DrivingTemperatureStatsSource.DefaultDays, (int)client.Requests[^1].Query!["days"]!);
    }

    [Fact]
    public async Task Source_treats_a_non_object_body_as_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public void Source_requests_the_web_default_window() =>
        Assert.Equal(30, DrivingTemperatureStatsSource.DefaultDays);

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("driving-temperature-stats", DrivingTemperatureStatsRegistration.Id);
        Assert.Equal("DrivingTemperatureStats", DrivingTemperatureStatsRegistration.Slug);
        Assert.Equal("Temperature Stats", DrivingTemperatureStatsRegistration.Title(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DrivingTemperatureStatsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DrivingTemperatureStats", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static DrivingTemperatureSnapshot Snapshot(DrivingTemperatureSide? inside, DrivingTemperatureSide? outside) =>
        new(inside, outside);

    private static DrivingTemperatureSide Side(double min, double avg, double max) => new(min, avg, max);

    private static RepositoryResult<DrivingTemperatureSnapshot> Loaded(DrivingTemperatureSnapshot snapshot) =>
        RepositoryResult<DrivingTemperatureSnapshot>.Loaded(snapshot, Now);

    private static DrivingTemperatureStatsViewModel NewViewModel(
        params RepositoryResult<DrivingTemperatureSnapshot>[] emissions) =>
        new(new FakeSource(emissions), Localizer, UnitPref.Metric);

    private static DrivingTemperatureStatsSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new DrivingTemperatureStatsSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<DrivingTemperatureSnapshot>>> Collect(
        IAsyncEnumerable<RepositoryResult<DrivingTemperatureSnapshot>> stream)
    {
        var list = new List<RepositoryResult<DrivingTemperatureSnapshot>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<DrivingTemperatureSnapshot>[] emissions)
        : IDrivingTemperatureStatsSource
    {
        public async IAsyncEnumerable<RepositoryResult<DrivingTemperatureSnapshot>> StreamAsync(
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
}
