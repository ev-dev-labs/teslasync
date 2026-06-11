using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.ModalsDialogs;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;
// WidgetCategory is declared in both TeslaSync.App.FeatureViews (the WidgetCatalogEntry this test builds) and
// TeslaSync.App.ModalsDialogs (the WidgetCatalogueDialog catalogue). The surface under test pairs with the
// FeatureViews enum, so disambiguate to it (the collision surfaced once the test csproj was regenerated to
// include the newer WidgetCatalogueDialog sources).
using WidgetCategory = TeslaSync.App.FeatureViews.WidgetCategory;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the <c>WidgetSettingsModal</c> surface's UI-thread-free logic — the config JSON
/// adapter (snake_case + camelCase, null-tolerant, extra-key round-trip), the vehicles JSON adapter, the
/// category predicates (web <c>isVehicleWidget</c> / <c>isChartWidget</c>), the option projections + selection
/// derivations + config mutators, the state-holder view-model's per-state vehicle flow (loading / loaded / empty
/// / error / retry / stale / offline) and its save / cancel callbacks, the i18n key contract that doubles as the
/// Narrator-label source, the PII-safe diagnostics and the generated operation-id resolution. Mirrors the web
/// spec (web/src/features/dashboard/components/WidgetSettingsModal.tsx). The WinUI view itself
/// (WidgetSettingsModal.cs) is exercised by the app build.
/// </summary>
public sealed class WidgetSettingsModalTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    private static WidgetCatalogEntry Def(WidgetCategory category, string name = "Battery Level") =>
        new("battery-gauge", name, "Battery percentage with radial gauge", category, 1, 2);

    // ── Config adapter: persisted object → typed shape (snake_case + camelCase, extra-key round-trip) ────

    [Fact]
    public void Config_parses_camel_case_keys()
    {
        const string json = """{ "vehicleId": 7, "refreshRate": 30, "timeRange": "30d", "showTitle": false }""";
        WidgetConfig config = WidgetConfig.FromJson(JsonDocument.Parse(json).RootElement);

        Assert.Equal(7, config.VehicleId);
        Assert.Equal(30, config.RefreshRate);
        Assert.Equal("30d", config.TimeRange);
        Assert.False(config.ShowTitle);
        Assert.Null(config.ExtraJson);
    }

    [Fact]
    public void Config_parses_snake_case_keys()
    {
        const string json = """{ "vehicle_id": 3, "refresh_rate": 15, "time_range": "24h", "show_title": true }""";
        WidgetConfig config = WidgetConfig.FromJson(JsonDocument.Parse(json).RootElement);

        Assert.Equal(3, config.VehicleId);
        Assert.Equal(15, config.RefreshRate);
        Assert.Equal("24h", config.TimeRange);
        Assert.True(config.ShowTitle);
    }

    [Fact]
    public void Config_non_object_is_empty()
    {
        Assert.Equal(WidgetConfig.Empty, WidgetConfig.FromJson(JsonDocument.Parse("42").RootElement));
        Assert.Equal(WidgetConfig.Empty, WidgetConfig.FromJson(JsonDocument.Parse("[]").RootElement));
    }

    [Fact]
    public void Config_preserves_unowned_keys_verbatim()
    {
        const string json = """{ "vehicleId": 1, "chartType": "bar", "zoom": 4 }""";
        WidgetConfig config = WidgetConfig.FromJson(JsonDocument.Parse(json).RootElement);

        Assert.Equal(1, config.VehicleId);
        Assert.NotNull(config.ExtraJson);
        Assert.Contains("\"chartType\":\"bar\"", config.ExtraJson, StringComparison.Ordinal);
        Assert.Contains("\"zoom\":4", config.ExtraJson, StringComparison.Ordinal);
    }

    [Fact]
    public void Config_with_helpers_preserve_extras()
    {
        WidgetConfig config = WidgetConfig.FromJson(
            JsonDocument.Parse("""{ "chartType": "line" }""").RootElement);

        WidgetConfig next = config.WithVehicleId(9).WithRefreshRate(5).WithTimeRange("90d").WithShowTitle(false);

        Assert.Equal(9, next.VehicleId);
        Assert.Equal(5, next.RefreshRate);
        Assert.Equal("90d", next.TimeRange);
        Assert.False(next.ShowTitle);
        Assert.Equal(config.ExtraJson, next.ExtraJson);
        Assert.Contains("line", next.ExtraJson!, StringComparison.Ordinal);
    }

    // ── Vehicles adapter (web useVehicles data shaping) ─────────────────────────────────────────────────

    [Fact]
    public void ParseVehicles_reads_snake_and_camel_case()
    {
        const string json = """
            [ { "id": 1, "display_name": "Garage", "vin": "5YJ3E1EA1JF000111", "model": "model3" },
              { "id": 2, "displayName": "Road" } ]
            """;
        IReadOnlyList<VehicleOption> vehicles = WidgetSettingsProjection.ParseVehicles(
            JsonDocument.Parse(json).RootElement);

        Assert.Equal(2, vehicles.Count);
        Assert.Equal("Garage", vehicles[0].DisplayName);
        Assert.Equal("model3", vehicles[0].Model);
        Assert.Equal("Road", vehicles[1].DisplayName);
    }

    [Fact]
    public void ParseVehicles_skips_malformed_rows_and_tolerates_non_array()
    {
        const string json = """[ { "id": 5, "display_name": "ok" }, { "display_name": "no id" }, 42 ]""";
        IReadOnlyList<VehicleOption> vehicles = WidgetSettingsProjection.ParseVehicles(
            JsonDocument.Parse(json).RootElement);

        Assert.Single(vehicles);
        Assert.Equal(5, vehicles[0].Id);

        Assert.Empty(WidgetSettingsProjection.ParseVehicles(JsonDocument.Parse("{}").RootElement));
        Assert.Empty(WidgetSettingsProjection.ParseVehicles(JsonDocument.Parse("null").RootElement));
    }

    // ── Category predicates (web isVehicleWidget / isChartWidget) ───────────────────────────────────────

    [Theory]
    [InlineData(WidgetCategory.Vehicle, true)]
    [InlineData(WidgetCategory.Battery, true)]
    [InlineData(WidgetCategory.Charging, true)]
    [InlineData(WidgetCategory.Media, true)]
    [InlineData(WidgetCategory.System, false)]
    [InlineData(WidgetCategory.Analytics, false)]
    public void IsVehicleWidget_excludes_system_and_analytics(WidgetCategory category, bool expected) =>
        Assert.Equal(expected, WidgetSettingsProjection.IsVehicleWidget(category));

    [Theory]
    [InlineData(WidgetCategory.Driving, true)]
    [InlineData(WidgetCategory.Charging, true)]
    [InlineData(WidgetCategory.Analytics, true)]
    [InlineData(WidgetCategory.Battery, true)]
    [InlineData(WidgetCategory.Vehicle, false)]
    [InlineData(WidgetCategory.Media, false)]
    [InlineData(WidgetCategory.System, false)]
    public void IsChartWidget_matches_web_category_set(WidgetCategory category, bool expected) =>
        Assert.Equal(expected, WidgetSettingsProjection.IsChartWidget(category));

    // ── Option projections ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void VehicleOptions_lead_with_all_sentinel_then_each_vehicle()
    {
        var vehicles = new[]
        {
            new VehicleOption(1, "Garage Tesla"),
            new VehicleOption(2, null),
        };

        IReadOnlyList<WidgetSettingsOption> options = WidgetSettingsProjection.VehicleOptions(vehicles, Localizer);

        Assert.Equal(3, options.Count);
        Assert.Equal("all", options[0].Value);
        Assert.Equal("All Vehicles (first)", options[0].Label);
        Assert.Equal("1", options[1].Value);
        Assert.Equal("Garage Tesla", options[1].Label);
        Assert.Equal("2", options[2].Value);
        Assert.Equal("Vehicle 2", options[2].Label);
    }

    [Fact]
    public void RefreshOptions_match_web_values_and_labels()
    {
        IReadOnlyList<WidgetSettingsOption> options = WidgetSettingsProjection.RefreshOptions(Localizer);

        Assert.Equal(["default", "5", "15", "30", "60"], options.Select(o => o.Value).ToArray());
        Assert.Equal(
            ["Default", "5 seconds", "15 seconds", "30 seconds", "1 minute"],
            options.Select(o => o.Label).ToArray());
    }

    [Fact]
    public void TimeRangeOptions_match_web_values_and_labels()
    {
        IReadOnlyList<WidgetSettingsOption> options = WidgetSettingsProjection.TimeRangeOptions(Localizer);

        Assert.Equal(["24h", "7d", "30d", "90d"], options.Select(o => o.Value).ToArray());
        Assert.Equal(
            ["Last 24 hours", "Last 7 days", "Last 30 days", "Last 90 days"],
            options.Select(o => o.Label).ToArray());
    }

    // ── Selection derivations + mutators (web config-derived values / setConfig updates) ────────────────

    [Fact]
    public void Default_selections_match_web_fallbacks()
    {
        Assert.Equal("all", WidgetSettingsProjection.VehicleSelectionValue(WidgetConfig.Empty));
        Assert.Equal("default", WidgetSettingsProjection.RefreshSelectionValue(WidgetConfig.Empty));
        Assert.Equal("7d", WidgetSettingsProjection.TimeRangeSelectionValue(WidgetConfig.Empty));
        Assert.True(WidgetSettingsProjection.ShowTitleValue(WidgetConfig.Empty));
    }

    [Fact]
    public void ShowTitle_is_only_false_when_explicitly_false()
    {
        Assert.True(WidgetSettingsProjection.ShowTitleValue(WidgetConfig.Empty));
        Assert.True(WidgetSettingsProjection.ShowTitleValue(WidgetConfig.Empty.WithShowTitle(true)));
        Assert.False(WidgetSettingsProjection.ShowTitleValue(WidgetConfig.Empty.WithShowTitle(false)));
    }

    [Fact]
    public void Vehicle_selection_maps_all_to_null_and_numbers_to_id()
    {
        WidgetConfig scoped = WidgetSettingsProjection.WithVehicleSelection(WidgetConfig.Empty, "5");
        Assert.Equal(5, scoped.VehicleId);

        WidgetConfig cleared = WidgetSettingsProjection.WithVehicleSelection(scoped, "all");
        Assert.Null(cleared.VehicleId);
    }

    [Fact]
    public void Refresh_selection_maps_default_to_null_and_numbers_to_seconds()
    {
        WidgetConfig rated = WidgetSettingsProjection.WithRefreshSelection(WidgetConfig.Empty, "30");
        Assert.Equal(30, rated.RefreshRate);

        WidgetConfig cleared = WidgetSettingsProjection.WithRefreshSelection(rated, "default");
        Assert.Null(cleared.RefreshRate);
    }

    [Fact]
    public void TimeRange_selection_assigns_the_token()
    {
        WidgetConfig ranged = WidgetSettingsProjection.WithTimeRangeSelection(WidgetConfig.Empty, "90d");
        Assert.Equal("90d", ranged.TimeRange);
    }

    // ── View-model: conditional sections + default selections ───────────────────────────────────────────

    [Fact]
    public void ViewModel_shows_both_sections_for_chart_vehicle_widget()
    {
        using var vm = NewViewModel(Def(WidgetCategory.Battery));

        Assert.True(vm.ShowVehicleSection);
        Assert.True(vm.ShowTimeRangeSection);
        Assert.Equal("Battery Level Settings", vm.Title);
    }

    [Fact]
    public void ViewModel_hides_vehicle_and_range_for_system_widget()
    {
        using var vm = NewViewModel(Def(WidgetCategory.System, "Audit Log"));

        Assert.False(vm.ShowVehicleSection);
        Assert.False(vm.ShowTimeRangeSection);
    }

    [Fact]
    public void ViewModel_seeds_selections_from_initial_config()
    {
        WidgetConfig config = WidgetConfig.Empty.WithVehicleId(8).WithRefreshRate(15)
            .WithTimeRange("30d").WithShowTitle(false);
        using var vm = NewViewModel(Def(WidgetCategory.Driving), config);

        Assert.Equal("8", vm.SelectedVehicleValue);
        Assert.Equal("15", vm.SelectedRefreshValue);
        Assert.Equal("30d", vm.SelectedTimeRangeValue);
        Assert.False(vm.ShowTitle);
    }

    [Fact]
    public void ViewModel_selection_setters_update_config()
    {
        using var vm = NewViewModel(Def(WidgetCategory.Driving));

        vm.SelectedVehicleValue = "4";
        vm.SelectedRefreshValue = "60";
        vm.SelectedTimeRangeValue = "24h";
        vm.ShowTitle = false;

        Assert.Equal(4, vm.Config.VehicleId);
        Assert.Equal(60, vm.Config.RefreshRate);
        Assert.Equal("24h", vm.Config.TimeRange);
        Assert.False(vm.Config.ShowTitle);
    }

    // ── View-model: vehicle load state matrix (web useVehicles lifecycle) ───────────────────────────────

    [Fact]
    public async Task Vehicles_loaded_populates_options()
    {
        var source = new FakeVehicleSource();
        source.Results.Add(RepositoryResult<IReadOnlyList<VehicleOption>>.Loading());
        source.Results.Add(RepositoryResult<IReadOnlyList<VehicleOption>>.Loaded(
            [new VehicleOption(1, "A"), new VehicleOption(2, "B")], Now));
        using var vm = NewViewModel(Def(WidgetCategory.Vehicle), source: source);

        await vm.LoadVehiclesAsync();

        Assert.Equal(WidgetSettingsVehiclesState.Loaded, vm.VehiclesState);
        Assert.Equal(2, vm.Vehicles.Count);
        Assert.Equal(3, vm.VehicleOptions.Count);
    }

    [Fact]
    public async Task Vehicles_empty_state()
    {
        var source = new FakeVehicleSource();
        source.Results.Add(RepositoryResult<IReadOnlyList<VehicleOption>>.Loading());
        source.Results.Add(RepositoryResult<IReadOnlyList<VehicleOption>>.Empty(Now));
        using var vm = NewViewModel(Def(WidgetCategory.Vehicle), source: source);

        await vm.LoadVehiclesAsync();

        Assert.Equal(WidgetSettingsVehiclesState.Empty, vm.VehiclesState);
        Assert.True(vm.IsVehiclesEmpty);
        Assert.Single(vm.VehicleOptions);
    }

    [Fact]
    public async Task Vehicles_error_state_then_retry_reloads()
    {
        var source = new FakeVehicleSource();
        source.Results.Add(RepositoryResult<IReadOnlyList<VehicleOption>>.Failure(
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        using var vm = NewViewModel(Def(WidgetCategory.Vehicle), source: source);

        await vm.LoadVehiclesAsync();
        Assert.Equal(WidgetSettingsVehiclesState.Error, vm.VehiclesState);
        Assert.True(vm.HasVehiclesError);
        Assert.False(string.IsNullOrEmpty(vm.VehiclesErrorMessage));

        await vm.RetryVehiclesAsync();
        Assert.Equal(2, source.Calls);
    }

    [Fact]
    public async Task Vehicles_stale_keeps_cached_list()
    {
        var source = new FakeVehicleSource();
        source.Results.Add(RepositoryResult<IReadOnlyList<VehicleOption>>.Cached(
            [new VehicleOption(1, "Cached")], Now.AddHours(-1), stale: true));
        using var vm = NewViewModel(Def(WidgetCategory.Vehicle), source: source);

        await vm.LoadVehiclesAsync();

        Assert.Equal(WidgetSettingsVehiclesState.Stale, vm.VehiclesState);
        Assert.True(vm.IsVehiclesStale);
        Assert.Single(vm.Vehicles);
    }

    [Fact]
    public async Task Vehicles_offline_keeps_cached_list()
    {
        var source = new FakeVehicleSource();
        source.Results.Add(RepositoryResult<IReadOnlyList<VehicleOption>>.OfflineCached(
            [new VehicleOption(1, "Cached")], Now.AddMinutes(-30),
            new RepositoryError(RepositoryErrorKind.Network, "no net")));
        using var vm = NewViewModel(Def(WidgetCategory.Vehicle), source: source);

        await vm.LoadVehiclesAsync();

        Assert.Equal(WidgetSettingsVehiclesState.Offline, vm.VehiclesState);
        Assert.True(vm.IsVehiclesOffline);
        Assert.Single(vm.Vehicles);
        Assert.False(string.IsNullOrEmpty(vm.VehiclesErrorMessage));
    }

    [Fact]
    public async Task Vehicles_not_loaded_for_non_vehicle_widget()
    {
        var source = new FakeVehicleSource();
        source.Results.Add(RepositoryResult<IReadOnlyList<VehicleOption>>.Loaded(
            [new VehicleOption(1, "A")], Now));
        using var vm = NewViewModel(Def(WidgetCategory.System, "Audit Log"), source: source);

        await vm.LoadVehiclesAsync();

        Assert.Equal(0, source.Calls);
    }

    [Fact]
    public async Task StaticSource_emits_loaded_or_empty()
    {
        var loaded = new StaticWidgetSettingsVehicleSource([new VehicleOption(1, "A")], () => Now);
        var empty = new StaticWidgetSettingsVehicleSource(clock: () => Now);

        Assert.Equal(LoadStatus.Loaded, await FirstStatus(loaded));
        Assert.Equal(LoadStatus.Empty, await FirstStatus(empty));
    }

    // ── View-model: save / cancel callbacks (web onSave / onClose) ──────────────────────────────────────

    [Fact]
    public void Save_emits_config_and_closes()
    {
        using var vm = NewViewModel(Def(WidgetCategory.Driving));
        vm.SelectedVehicleValue = "3";
        WidgetConfig? saved = null;
        bool closed = false;
        vm.SettingsSaved += (_, config) => saved = config;
        vm.CloseRequested += (_, _) => closed = true;

        vm.Save();

        Assert.NotNull(saved);
        Assert.Equal(3, saved!.VehicleId);
        Assert.True(closed);
    }

    [Fact]
    public void Save_preserves_unowned_config_keys()
    {
        WidgetConfig config = WidgetConfig.FromJson(
            JsonDocument.Parse("""{ "vehicleId": 1, "chartType": "bar" }""").RootElement);
        using var vm = NewViewModel(Def(WidgetCategory.Battery), config);
        vm.SelectedRefreshValue = "30";
        WidgetConfig? saved = null;
        vm.SettingsSaved += (_, c) => saved = c;

        vm.Save();

        Assert.NotNull(saved);
        Assert.Equal(30, saved!.RefreshRate);
        Assert.Contains("chartType", saved.ExtraJson!, StringComparison.Ordinal);
    }

    [Fact]
    public void Cancel_closes_without_saving()
    {
        using var vm = NewViewModel(Def(WidgetCategory.Driving));
        bool saved = false;
        bool closed = false;
        vm.SettingsSaved += (_, _) => saved = true;
        vm.CloseRequested += (_, _) => closed = true;

        vm.RequestClose();

        Assert.False(saved);
        Assert.True(closed);
    }

    // ── Diagnostics (PII-safe view.opened + settings.saved) ─────────────────────────────────────────────

    [Fact]
    public void Diagnostics_emit_slugged_events()
    {
        var sink = new List<string>();
        var diagnostics = new WidgetSettingsModalDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordSettingsSaved();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.SettingsSaved);
        Assert.Contains("view.opened slug=WidgetSettingsModal", sink);
        Assert.Contains("settings.saved slug=WidgetSettingsModal", sink);
    }

    [Fact]
    public void Save_records_diagnostics()
    {
        var sink = new List<string>();
        var diagnostics = new WidgetSettingsModalDiagnostics(sink.Add);
        using var vm = new WidgetSettingsModalViewModel(
            Def(WidgetCategory.Driving), null, new FakeVehicleSource(), Localizer, diagnostics);

        vm.Save();

        Assert.Contains("settings.saved slug=WidgetSettingsModal", sink);
    }

    // ── i18n: every web key resolves through the facade ─────────────────────────────────────────────────

    [Fact]
    public void Registration_resolves_every_web_key_through_facade()
    {
        var recorder = new RecordingLocalizer();

        _ = WidgetSettingsRegistration.Title("W", recorder);
        _ = WidgetSettingsRegistration.VehicleLabel(recorder);
        _ = WidgetSettingsRegistration.AllVehiclesLabel(recorder);
        _ = WidgetSettingsRegistration.RefreshIntervalLabel(recorder);
        _ = WidgetSettingsRegistration.TimeRangeLabel(recorder);
        _ = WidgetSettingsRegistration.AppearanceLabel(recorder);
        _ = WidgetSettingsRegistration.ShowTitleLabel(recorder);
        _ = WidgetSettingsRegistration.CancelLabel(recorder);
        _ = WidgetSettingsRegistration.SaveLabel(recorder);
        _ = WidgetSettingsProjection.RefreshOptions(recorder);
        _ = WidgetSettingsProjection.TimeRangeOptions(recorder);

        Assert.Contains("dashboard.settings.title", recorder.Keys);
        Assert.Contains("dashboard.settings.vehicle", recorder.Keys);
        Assert.Contains("dashboard.settings.allVehicles", recorder.Keys);
        Assert.Contains("dashboard.settings.refreshInterval", recorder.Keys);
        Assert.Contains("dashboard.settings.default", recorder.Keys);
        Assert.Contains("dashboard.settings.5s", recorder.Keys);
        Assert.Contains("dashboard.settings.60s", recorder.Keys);
        Assert.Contains("dashboard.settings.timeRange", recorder.Keys);
        Assert.Contains("dashboard.settings.24h", recorder.Keys);
        Assert.Contains("dashboard.settings.90d", recorder.Keys);
        Assert.Contains("dashboard.settings.appearance", recorder.Keys);
        Assert.Contains("dashboard.settings.showTitle", recorder.Keys);
        Assert.Contains("common.cancel", recorder.Keys);
        Assert.Contains("common.save", recorder.Keys);
    }

    [Fact]
    public void Title_interpolates_widget_name()
    {
        Assert.Equal("Battery Level Settings", WidgetSettingsRegistration.Title("Battery Level", Localizer));
    }

    [Fact]
    public void Vehicle_state_labels_resolve_through_facade()
    {
        var recorder = new RecordingLocalizer();

        _ = WidgetSettingsRegistration.VehiclesLoadingLabel(recorder);
        _ = WidgetSettingsRegistration.VehiclesEmptyTitle(recorder);
        _ = WidgetSettingsRegistration.VehiclesEmptyMessage(recorder);
        _ = WidgetSettingsRegistration.VehiclesErrorTitle(recorder);
        _ = WidgetSettingsRegistration.RetryLabel(recorder);
        _ = WidgetSettingsRegistration.VehiclesStaleLabel(recorder);
        _ = WidgetSettingsRegistration.VehiclesOfflineLabel(recorder);

        Assert.Contains("dashboard.settings.vehiclesLoading", recorder.Keys);
        Assert.Contains("dashboard.settings.vehiclesEmptyTitle", recorder.Keys);
        Assert.Contains("dashboard.settings.vehiclesErrorTitle", recorder.Keys);
        Assert.Contains("dashboard.settings.retry", recorder.Keys);
        Assert.Contains("dashboard.settings.vehiclesStale", recorder.Keys);
        Assert.Contains("dashboard.settings.vehiclesOffline", recorder.Keys);
    }

    // ── Registration: slug + operation id resolves against the generated endpoint table ─────────────────

    [Fact]
    public void Registration_exposes_slug()
    {
        Assert.Equal("WidgetSettingsModal", WidgetSettingsRegistration.Slug);
        Assert.Equal("WidgetSettingsModal", WidgetSettingsModalViewModel.SurfaceId);
    }

    [Fact]
    public void Vehicles_operation_id_resolves_to_expected_path()
    {
        GeneratedApi.EndpointDescriptor? descriptor = GeneratedApi.ApiEndpoints.All
            .SingleOrDefault(e => e.OperationId == WidgetSettingsVehicleSource.VehiclesOperation);

        Assert.True(descriptor is not null, "Vehicles operation is not in the generated endpoint table.");
        Assert.Equal("/vehicles/", descriptor!.Path);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────

    private static WidgetSettingsModalViewModel NewViewModel(
        WidgetCatalogEntry def,
        WidgetConfig? config = null,
        IWidgetSettingsVehicleSource? source = null) =>
        new(def, config, source ?? new FakeVehicleSource(), Localizer);

    private static async Task<LoadStatus> FirstStatus(IWidgetSettingsVehicleSource source)
    {
        await foreach (RepositoryResult<IReadOnlyList<VehicleOption>> result in source.StreamVehiclesAsync())
        {
            return result.Status;
        }

        return LoadStatus.Error;
    }

    private sealed class FakeVehicleSource : IWidgetSettingsVehicleSource
    {
        public List<RepositoryResult<IReadOnlyList<VehicleOption>>> Results { get; } = new();

        public int Calls { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<VehicleOption>>> StreamVehiclesAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            Calls++;
            await Task.CompletedTask.ConfigureAwait(false);
            foreach (RepositoryResult<IReadOnlyList<VehicleOption>> result in Results)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
            }
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
