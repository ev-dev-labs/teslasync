using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Telemetry;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SignalGapDetectorPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/telemetry/pages/SignalGapDetectorPage.tsx plus the <c>SignalCatalogPanel</c> it wraps): the
/// page's loading / no-vehicle / error / catalog states, the catalog's loading / empty / error / success states, the
/// staleness categorisation and freshness formatting, the search / filter / sort pipeline, the summary counts, the
/// tolerant vehicle / live-signal parsers, the view-model's state machine, and the generated-client feed's request
/// shaping (web <c>useSelectedVehicle</c> + <c>useSignalGaps</c>). The WinUI view is exercised by the app build; its
/// per-region visibility is driven entirely by the <see cref="SignalGapDetectorDisplay"/> flags asserted here.
/// </summary>
public sealed class SignalGapDetectorPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 18, 0, 0, TimeSpan.Zero);

    // The four i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "signalGap.noVehicle",
        "signalGap.noVehicleDesc",
        "signalGap.subtitle",
        "signalGap.title",
    ];

    private static SignalGapLiveEntry Entry(string name, string? value, DateTimeOffset? ts) => new(name, value, ts);

    private static SignalGapDetectorModel Model(
        long? selected = 7,
        IReadOnlyList<SignalGapDetectorVehicle>? vehicles = null,
        IReadOnlyList<SignalGapLiveEntry>? signals = null,
        SignalGapCatalogState catalogState = SignalGapCatalogState.Success,
        string search = "",
        SignalGapFilterMode filter = SignalGapFilterMode.All,
        SignalGapSortMode sort = SignalGapSortMode.Staleness,
        bool loading = false,
        bool hasError = false,
        string? errorDetail = null,
        DateTimeOffset? lastRefreshed = null) =>
        new(
            Vehicles: vehicles ?? [new SignalGapDetectorVehicle(7, "Model 3")],
            SelectedVehicleId: selected,
            CatalogState: catalogState,
            Signals: signals ?? Array.Empty<SignalGapLiveEntry>(),
            Search: search,
            FilterMode: filter,
            SortMode: sort,
            Loading: loading,
            HasError: hasError,
            ErrorDetail: errorDetail,
            LastRefreshed: lastRefreshed);

    private static IReadOnlyList<SignalGapLiveEntry> ThreeBandSignals() =>
    [
        Entry("Speed", "42", Now.AddSeconds(-10)),    // active band + active category
        Entry("Battery", "80", Now.AddSeconds(-600)), // stale band + stale category
        Entry("Gear", null, null),                    // never band + never category
    ];

    // ---- Projection: page data-state matrix ----------------------------------------

    [Fact]
    public void Projection_loading_is_the_loading_state()
    {
        var display = SignalGapDetectorProjection.Project(Model(loading: true), Localizer, Now);

        Assert.Equal(SignalGapDetectorState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowCatalog);
        Assert.False(display.ShowNoVehicle);
    }

    [Fact]
    public void Projection_no_vehicle_is_the_empty_state()
    {
        var display = SignalGapDetectorProjection.Project(
            Model(selected: null, vehicles: Array.Empty<SignalGapDetectorVehicle>()), Localizer, Now);

        Assert.Equal(SignalGapDetectorState.Empty, display.State);
        Assert.True(display.ShowNoVehicle);
        Assert.False(display.ShowCatalog);
        Assert.Equal("Select a vehicle to begin", display.NoVehicleTitle);
        Assert.Equal(
            "Pick a vehicle from the picker above to inspect its signal freshness.",
            display.NoVehicleMessage);
    }

    [Fact]
    public void Projection_fleet_failure_is_the_error_state()
    {
        var display = SignalGapDetectorProjection.Project(Model(hasError: true, errorDetail: "boom"), Localizer, Now);

        Assert.Equal(SignalGapDetectorState.Error, display.State);
        Assert.True(display.HasError);
        Assert.False(display.ShowCatalog);
        Assert.Contains("Failed to load data", display.ErrorBannerText, StringComparison.Ordinal);
        Assert.Contains("boom", display.ErrorBannerText, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_with_vehicle_shows_the_catalog_and_header_copy()
    {
        var display = SignalGapDetectorProjection.Project(Model(signals: ThreeBandSignals()), Localizer, Now);

        Assert.Equal(SignalGapDetectorState.Catalog, display.State);
        Assert.True(display.ShowCatalog);
        Assert.True(display.ShowTable);
        Assert.Equal("Signal Gap Detector", display.Title);
        Assert.Equal("Identify signals that have stopped arriving or have gaps", display.Subtitle);
        Assert.Equal("Refreshes every 5s", display.RefreshIntervalText);
        Assert.Equal(5, display.Columns.Count);
        Assert.Equal(3, display.FilterOptions.Count);
        Assert.Equal(3, display.SortOptions.Count);
    }

    // ---- Projection: catalog inner-state matrix ------------------------------------

    [Fact]
    public void Projection_catalog_loading_shows_the_skeleton()
    {
        var display = SignalGapDetectorProjection.Project(
            Model(catalogState: SignalGapCatalogState.Loading), Localizer, Now);

        Assert.True(display.ShowCatalogLoading);
        Assert.False(display.ShowTable);
        Assert.False(display.ShowCatalogEmpty);
        Assert.False(display.ShowCatalogError);
    }

    [Fact]
    public void Projection_catalog_empty_shows_the_no_data_state()
    {
        var display = SignalGapDetectorProjection.Project(
            Model(catalogState: SignalGapCatalogState.Empty, signals: Array.Empty<SignalGapLiveEntry>()), Localizer, Now);

        Assert.True(display.ShowCatalogEmpty);
        Assert.False(display.ShowTable);
        Assert.Equal("No signal data available", display.CatalogEmptyText);
    }

    [Fact]
    public void Projection_catalog_error_shows_the_error_state()
    {
        var display = SignalGapDetectorProjection.Project(
            Model(catalogState: SignalGapCatalogState.Error, errorDetail: "down"), Localizer, Now);

        Assert.True(display.ShowCatalogError);
        Assert.False(display.ShowTable);
        Assert.Contains("down", display.CatalogErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_search_with_no_match_keeps_the_table_with_an_empty_message()
    {
        var display = SignalGapDetectorProjection.Project(
            Model(signals: ThreeBandSignals(), search: "no-such-signal"), Localizer, Now);

        // The full catalog is non-empty so the table is still shown, but no rows survive the filter.
        Assert.True(display.ShowTable);
        Assert.Empty(display.Rows);
        Assert.Equal("No signals match current filters", display.TableEmptyMessage);
    }

    // ---- Projection: summary counts + freshness ------------------------------------

    [Fact]
    public void Projection_summary_counts_match_the_categories()
    {
        var display = SignalGapDetectorProjection.Project(Model(signals: ThreeBandSignals()), Localizer, Now);

        Assert.Equal(4, display.Stats.Count);
        Assert.Equal("3", display.Stats[0].Value); // total
        Assert.Equal("1", display.Stats[1].Value); // active
        Assert.Equal("1", display.Stats[2].Value); // stale
        Assert.Equal("1", display.Stats[3].Value); // never
        Assert.Equal(3, display.TotalRows);
    }

    [Fact]
    public void Projection_rows_carry_the_band_label_value_and_time_since()
    {
        var display = SignalGapDetectorProjection.Project(Model(signals: ThreeBandSignals()), Localizer, Now);

        var speed = display.Rows.Single(r => r.Signal == "Speed");
        Assert.Equal("Active", speed.Status);
        Assert.Equal("42", speed.Value);
        Assert.Equal("10s ago", speed.TimeSince);

        var gear = display.Rows.Single(r => r.Signal == "Gear");
        Assert.Equal("Never received", gear.Status);
        Assert.Equal("\u2014", gear.Value);
        Assert.Equal("\u2014", gear.TimeSince); // never received → em-dash
    }

    [Theory]
    [InlineData(10, "10s ago")]
    [InlineData(120, "2m ago")]
    [InlineData(3700, "1h 2m ago")]
    public void FormatStaleness_matches_the_web_tiers(double seconds, string expected) =>
        Assert.Equal(expected, SignalGapDetectorProjection.FormatStaleness(seconds));

    [Fact]
    public void FormatStaleness_never_received_is_the_em_dash() =>
        Assert.Equal("\u2014", SignalGapDetectorProjection.FormatStaleness(double.PositiveInfinity));

    [Fact]
    public void CategoryOf_and_BandOf_follow_the_web_thresholds()
    {
        Assert.Equal(SignalGapCategory.Never, SignalGapDetectorProjection.CategoryOf(null, double.PositiveInfinity));
        Assert.Equal(SignalGapBand.Never, SignalGapDetectorProjection.BandOf(null, double.PositiveInfinity));

        Assert.Equal(SignalGapBand.Active, SignalGapDetectorProjection.BandOf(Now, 10));
        Assert.Equal(SignalGapCategory.Active, SignalGapDetectorProjection.CategoryOf(Now, 10));

        Assert.Equal(SignalGapBand.Aging, SignalGapDetectorProjection.BandOf(Now, 120));
        Assert.Equal(SignalGapCategory.Active, SignalGapDetectorProjection.CategoryOf(Now, 120));

        Assert.Equal(SignalGapBand.Stale, SignalGapDetectorProjection.BandOf(Now, 600));
        Assert.Equal(SignalGapCategory.Stale, SignalGapDetectorProjection.CategoryOf(Now, 600));
    }

    // ---- Projection: filter + sort -------------------------------------------------

    [Fact]
    public void Projection_filter_stale_keeps_only_stale_and_never()
    {
        var display = SignalGapDetectorProjection.Project(
            Model(signals: ThreeBandSignals(), filter: SignalGapFilterMode.Stale), Localizer, Now);

        Assert.Equal(2, display.Rows.Count);
        Assert.DoesNotContain(display.Rows, r => r.Signal == "Speed");
    }

    [Fact]
    public void Projection_filter_active_keeps_only_active()
    {
        var display = SignalGapDetectorProjection.Project(
            Model(signals: ThreeBandSignals(), filter: SignalGapFilterMode.Active), Localizer, Now);

        var row = Assert.Single(display.Rows);
        Assert.Equal("Speed", row.Signal);
    }

    [Fact]
    public void Projection_sort_alpha_orders_by_name()
    {
        var display = SignalGapDetectorProjection.Project(
            Model(signals: ThreeBandSignals(), sort: SignalGapSortMode.Alpha), Localizer, Now);

        Assert.Equal(new[] { "Battery", "Gear", "Speed" }, display.Rows.Select(r => r.Signal).ToArray());
    }

    [Fact]
    public void Projection_sort_staleness_puts_never_received_first()
    {
        var display = SignalGapDetectorProjection.Project(
            Model(signals: ThreeBandSignals(), sort: SignalGapSortMode.Staleness), Localizer, Now);

        Assert.Equal("Gear", display.Rows[0].Signal); // Infinity staleness sorts first
    }

    [Fact]
    public void Projection_search_filters_by_name_case_insensitively()
    {
        var display = SignalGapDetectorProjection.Project(
            Model(signals: ThreeBandSignals(), search: "bat"), Localizer, Now);

        var row = Assert.Single(display.Rows);
        Assert.Equal("Battery", row.Signal);
    }

    // ---- Parsers -------------------------------------------------------------------

    [Fact]
    public void ParseList_reads_id_and_display_name()
    {
        using var doc = JsonDocument.Parse("[{\"id\":3,\"display_name\":\"Model Y\"},{\"id\":4}]");

        var vehicles = SignalGapDetectorVehicle.ParseList(doc.RootElement);

        Assert.Equal(2, vehicles.Count);
        Assert.Equal("Model Y", vehicles[0].Label);
        Assert.Equal("Vehicle 4", vehicles[1].Label);
    }

    [Fact]
    public void ParseLive_reads_value_and_timestamp_pairs()
    {
        using var doc = JsonDocument.Parse(
            "{\"signals\":{" +
            "\"Speed\":{\"value\":42,\"timestamp\":\"2026-06-12T17:59:50Z\"}," +
            "\"Gear\":{\"value\":\"D\",\"timestamp\":null}," +
            "\"Empty\":{\"value\":null}}}");

        var signals = SignalGapLiveEntry.ParseLive(doc.RootElement);

        Assert.Equal(3, signals.Count);
        var speed = signals.Single(s => s.Name == "Speed");
        Assert.Equal("42", speed.Value);
        Assert.NotNull(speed.Timestamp);
        Assert.Equal("D", signals.Single(s => s.Name == "Gear").Value);
        Assert.Null(signals.Single(s => s.Name == "Gear").Timestamp);
        Assert.Null(signals.Single(s => s.Name == "Empty").Value);
    }

    [Fact]
    public void ParseLive_tolerates_a_bare_value_and_a_missing_signals_envelope()
    {
        using var bare = JsonDocument.Parse("{\"signals\":{\"Count\":5}}");
        var signals = SignalGapLiveEntry.ParseLive(bare.RootElement);
        Assert.Equal("5", Assert.Single(signals).Value);
        Assert.Null(signals[0].Timestamp);

        using var missing = JsonDocument.Parse("{}");
        Assert.Empty(SignalGapLiveEntry.ParseLive(missing.RootElement));
    }

    // ---- View-model state machine --------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new SignalGapDetectorPageViewModel(EmptySignalGapDetectorFeed.Instance, Localizer, () => Now);

        Assert.Equal(SignalGapDetectorState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loads_into_catalog_and_selects_the_first_vehicle()
    {
        var feed = new FakeSignalGapDetectorFeed(
            [new SignalGapDetectorVehicle(42, "Model S")],
            ThreeBandSignals());
        using var vm = new SignalGapDetectorPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SignalGapDetectorState.Catalog, vm.State);
        Assert.Equal(42L, vm.SelectedVehicleId);
        Assert.Equal(42L, feed.LastLiveVehicleId);
        Assert.Equal(SignalGapCatalogState.Success, vm.CatalogState);
        Assert.True(vm.Display.ShowTable);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_no_vehicle_empty_state()
    {
        using var vm = new SignalGapDetectorPageViewModel(EmptySignalGapDetectorFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SignalGapDetectorState.Empty, vm.State);
        Assert.Null(vm.SelectedVehicleId);
        Assert.True(vm.Display.ShowNoVehicle);
    }

    [Fact]
    public async Task ViewModel_live_failure_is_the_catalog_error_state()
    {
        var feed = new ThrowingLiveFeed([new SignalGapDetectorVehicle(1, "A")]);
        using var vm = new SignalGapDetectorPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SignalGapDetectorState.Catalog, vm.State);
        Assert.Equal(SignalGapCatalogState.Error, vm.CatalogState);
        Assert.True(vm.Display.ShowCatalogError);
    }

    [Fact]
    public async Task ViewModel_fleet_failure_is_the_error_state()
    {
        var feed = new ThrowingVehiclesFeed();
        using var vm = new SignalGapDetectorPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SignalGapDetectorState.Error, vm.State);
        Assert.True(vm.Display.HasError);
    }

    [Fact]
    public async Task ViewModel_empty_live_snapshot_is_the_catalog_empty_state()
    {
        var feed = new FakeSignalGapDetectorFeed([new SignalGapDetectorVehicle(1, "A")], Array.Empty<SignalGapLiveEntry>());
        using var vm = new SignalGapDetectorPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SignalGapCatalogState.Empty, vm.CatalogState);
        Assert.True(vm.Display.ShowCatalogEmpty);
    }

    [Fact]
    public async Task ViewModel_select_vehicle_reloads_the_live_signals()
    {
        var feed = new FakeSignalGapDetectorFeed(
            [new SignalGapDetectorVehicle(1, "A"), new SignalGapDetectorVehicle(2, "B")],
            ThreeBandSignals());
        using var vm = new SignalGapDetectorPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.SelectVehicleAsync(2);

        Assert.Equal(2L, vm.SelectedVehicleId);
        Assert.Equal(2L, feed.LastLiveVehicleId);
        Assert.Equal(2, feed.LiveFetches); // initial load + select
    }

    [Fact]
    public async Task ViewModel_refresh_refetches_the_selected_vehicle()
    {
        var feed = new FakeSignalGapDetectorFeed([new SignalGapDetectorVehicle(9, "A")], ThreeBandSignals());
        using var vm = new SignalGapDetectorPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.RefreshAsync();

        Assert.Equal(2, feed.LiveFetches);
        Assert.Equal(9L, feed.LastLiveVehicleId);
    }

    [Fact]
    public async Task ViewModel_search_filter_sort_are_client_side_and_do_not_refetch()
    {
        var feed = new FakeSignalGapDetectorFeed([new SignalGapDetectorVehicle(1, "A")], ThreeBandSignals());
        using var vm = new SignalGapDetectorPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        vm.SetSearch("bat");
        vm.SetFilterMode(SignalGapFilterMode.Active);
        vm.SetSortMode(SignalGapSortMode.Alpha);

        Assert.Equal(1, feed.LiveFetches); // no extra fetch
        Assert.Equal("bat", vm.Search);
        Assert.Equal(SignalGapFilterMode.Active, vm.FilterMode);
        Assert.Equal(SignalGapSortMode.Alpha, vm.SortMode);
    }

    // ---- Generated-client feed -----------------------------------------------------

    [Fact]
    public async Task ClientFeed_vehicles_sends_the_list_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"display_name\":\"Model 3\"}]"));
        var feed = new SignalGapDetectorClientFeed(api);

        var vehicles = await feed.FetchVehiclesAsync(default);

        Assert.Single(vehicles);
        Assert.Equal("get_api_v1_vehicles", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_live_sends_the_vehicle_path()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"signals\":{\"Speed\":{\"value\":42,\"timestamp\":\"2026-06-12T17:59:50Z\"}}}"));
        var feed = new SignalGapDetectorClientFeed(api);

        var signals = await feed.FetchLiveSignalsAsync(7, default);

        Assert.Single(signals);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_signals_vehicleID_live", request.OperationId);
        Assert.NotNull(request.PathParams);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new SignalGapDetectorClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchVehiclesAsync(default));
    }

    // ---- Diagnostics + registration + i18n -----------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new SignalGapDetectorDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SignalGapDetectorPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("SignalGapDetector", SignalGapDetectorRegistration.RouteName);
        Assert.Equal("SignalGapDetectorPage", SignalGapDetectorRegistration.Slug);
        Assert.Equal("get_api_v1_vehicles", SignalGapDetectorRegistration.VehiclesOperation);
        Assert.Equal("get_api_v1_signals_vehicleID_live", SignalGapDetectorRegistration.LiveOperation);
        Assert.Equal("Signal Gap Detector", SignalGapDetectorRegistration.Title(Localizer));
        Assert.Equal("Identify signals that have stopped arriving or have gaps", SignalGapDetectorRegistration.Subtitle(Localizer));
        Assert.Equal("Signal Gaps", SignalGapDetectorRegistration.PageTitle(Localizer));
    }

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        SignalGapDetectorProjection.Project(
            Model(selected: null, vehicles: Array.Empty<SignalGapDetectorVehicle>()), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeSignalGapDetectorFeed : ISignalGapDetectorFeed
    {
        private readonly IReadOnlyList<SignalGapDetectorVehicle> _vehicles;
        private readonly IReadOnlyList<SignalGapLiveEntry> _signals;

        public FakeSignalGapDetectorFeed(
            IReadOnlyList<SignalGapDetectorVehicle> vehicles,
            IReadOnlyList<SignalGapLiveEntry> signals)
        {
            _vehicles = vehicles;
            _signals = signals;
        }

        public int LiveFetches { get; private set; }

        public long? LastLiveVehicleId { get; private set; }

        public Task<IReadOnlyList<SignalGapDetectorVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(_vehicles);
        }

        public Task<IReadOnlyList<SignalGapLiveEntry>> FetchLiveSignalsAsync(long vehicleId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            LiveFetches++;
            LastLiveVehicleId = vehicleId;
            return Task.FromResult(_signals);
        }
    }

    private sealed class ThrowingLiveFeed : ISignalGapDetectorFeed
    {
        private readonly IReadOnlyList<SignalGapDetectorVehicle> _vehicles;

        public ThrowingLiveFeed(IReadOnlyList<SignalGapDetectorVehicle> vehicles) => _vehicles = vehicles;

        public Task<IReadOnlyList<SignalGapDetectorVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(_vehicles);

        public Task<IReadOnlyList<SignalGapLiveEntry>> FetchLiveSignalsAsync(long vehicleId, CancellationToken cancellationToken) =>
            throw new ApiException("live down", 503);
    }

    private sealed class ThrowingVehiclesFeed : ISignalGapDetectorFeed
    {
        public Task<IReadOnlyList<SignalGapDetectorVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            throw new ApiException("fleet down", 500);

        public Task<IReadOnlyList<SignalGapLiveEntry>> FetchLiveSignalsAsync(long vehicleId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<SignalGapLiveEntry>>(Array.Empty<SignalGapLiveEntry>());
    }
}
