using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>FleetTelemetryCoveragePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx), the tolerant parsers, the client-side filter, the
/// view-model's data-state matrix (loading / empty / filter-empty / success / error), and the generated-client feed's
/// request shaping (web <c>useFleetTelemetryCoverage</c>). The WinUI view is exercised by the app build; its per-region
/// visibility is driven entirely by the <see cref="FleetTelemetryCoverageDisplay"/> flags asserted here.
/// </summary>
public sealed class FleetTelemetryCoveragePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 37 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "coverage.category.empty", "coverage.category.noMatch", "coverage.category.totalFields",
        "coverage.col.column", "coverage.col.destination", "coverage.col.dualWrite", "coverage.col.field",
        "coverage.col.subscribed", "coverage.destinations.empty", "coverage.destinations.help",
        "coverage.destinations.title", "coverage.dualWrite.yes", "coverage.empty", "coverage.error",
        "coverage.filter.placeholder", "coverage.filterEmpty", "coverage.legend.columnHelp",
        "coverage.legend.columnLabel", "coverage.legend.dualWriteHelp", "coverage.legend.dualWriteLabel",
        "coverage.legend.intro", "coverage.legend.subscribedHelp", "coverage.legend.subscribedLabel",
        "coverage.legend.title", "coverage.loading", "coverage.orphans.help", "coverage.orphans.title",
        "coverage.pageTitle", "coverage.refresh", "coverage.stat.categories", "coverage.stat.orphans",
        "coverage.stat.routedFields", "coverage.stat.routedNotSubscribed", "coverage.stat.subscribed",
        "coverage.subscribed.no", "coverage.subscribed.yes", "coverage.subtitle",
    ];

    private static FleetTelemetryCoverageSnapshot SampleSnapshot() => new(
        Categories:
        [
            new FleetTelemetryCategoryCoverage(
                Category: "Drive",
                TotalFields: 3,
                Destinations: new Dictionary<string, long>(StringComparer.Ordinal)
                {
                    ["drives"] = 2,
                    ["signal_log"] = 3,
                },
                Fields:
                [
                    new FleetTelemetryFieldCoverage("VehicleSpeed", "drives", "speed", AlsoSignalLog: true, Subscribed: true),
                    new FleetTelemetryFieldCoverage("Gear", "drives", "gear", AlsoSignalLog: false, Subscribed: true),
                    new FleetTelemetryFieldCoverage("Odometer", "signal_log", null, AlsoSignalLog: false, Subscribed: false),
                ]),
            new FleetTelemetryCategoryCoverage(
                Category: "Charge",
                TotalFields: 1,
                Destinations: new Dictionary<string, long>(StringComparer.Ordinal) { ["charging_sessions"] = 1 },
                Fields:
                [
                    new FleetTelemetryFieldCoverage("ACChargingPower", "charging_sessions", "power_w", AlsoSignalLog: false, Subscribed: true),
                ]),
        ],
        DestinationTotals: new Dictionary<string, long>(StringComparer.Ordinal)
        {
            ["signal_log"] = 4,
            ["drives"] = 2,
            ["charging_sessions"] = 1,
        },
        OrphanFields: ["GhostField"]);

    private static FleetTelemetryCoverageModel SuccessModel(string filter = "") => new(
        Snapshot: SampleSnapshot(),
        Loading: false,
        HasError: false,
        ErrorDetail: null,
        Filter: filter);

    // ---- i18n key coverage (all 37 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = FleetTelemetryCoverageProjection.Project(SuccessModel(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome strings are resolved on every projection regardless of data state (visibility is gated separately).
        _ = FleetTelemetryCoverageProjection.Project(FleetTelemetryCoverageModel.Initial, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Data states ---------------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = FleetTelemetryCoverageProjection.Project(FleetTelemetryCoverageModel.Initial, Localizer);

        Assert.Equal(FleetTelemetryCoverageState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowCategories);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_empty_when_no_categories()
    {
        var model = FleetTelemetryCoverageModel.Initial with { Loading = false };
        var display = FleetTelemetryCoverageProjection.Project(model, Localizer);

        Assert.Equal(FleetTelemetryCoverageState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowCategories);
        Assert.Equal(
            "No categories returned. The embedded routing.yaml may be empty or the loader failed silently.",
            display.EmptyText);
    }

    [Fact]
    public void State_empty_uses_filter_copy_when_nothing_matches()
    {
        var display = FleetTelemetryCoverageProjection.Project(SuccessModel("zzz-no-such-field"), Localizer);

        Assert.Equal(FleetTelemetryCoverageState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowCategories);
        Assert.Equal("No categories match the current filter.", display.EmptyText);
    }

    [Fact]
    public void State_error_when_query_failed()
    {
        var model = FleetTelemetryCoverageModel.Initial with { Loading = false, HasError = true, ErrorDetail = "boom" };
        var display = FleetTelemetryCoverageProjection.Project(model, Localizer);

        Assert.Equal(FleetTelemetryCoverageState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowCategories);
        Assert.Contains("Could not load Fleet Telemetry coverage", display.ErrorText, StringComparison.Ordinal);
        Assert.Contains("boom", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_categories_present()
    {
        var display = FleetTelemetryCoverageProjection.Project(SuccessModel(), Localizer);

        Assert.Equal(FleetTelemetryCoverageState.Success, display.State);
        Assert.True(display.ShowCategories);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
        Assert.Equal(2, display.Categories.Count);
    }

    // ---- Panel: summary stat tiles (web summarise) ---------------------------------

    [Fact]
    public void Summary_stats_count_categories_fields_and_subscriptions()
    {
        var display = FleetTelemetryCoverageProjection.Project(SuccessModel(), Localizer);

        Assert.Equal("2", display.StatCategoriesValue);
        Assert.Equal("4", display.StatRoutedFieldsValue);
        Assert.Equal("3", display.StatSubscribedValue);
        Assert.Equal("1", display.StatRoutedNotSubscribedValue);
        Assert.Equal("1", display.StatOrphansValue);

        Assert.Equal("Categories", display.StatCategoriesLabel);
        Assert.Equal("Routed fields", display.StatRoutedFieldsLabel);
        Assert.Equal("Subscribed", display.StatSubscribedLabel);
        Assert.Equal("Routed, not subscribed", display.StatRoutedNotSubscribedLabel);
        Assert.Equal("Orphan fields", display.StatOrphansLabel);
    }

    // ---- Panel: destination breakdown ----------------------------------------------

    [Fact]
    public void Destinations_sorted_descending_by_count()
    {
        var display = FleetTelemetryCoverageProjection.Project(SuccessModel(), Localizer);

        Assert.True(display.HasDestinations);
        Assert.Collection(
            display.DestinationChips,
            chip => Assert.Equal("signal_log: 4", chip.Label),
            chip => Assert.Equal("drives: 2", chip.Label),
            chip => Assert.Equal("charging_sessions: 1", chip.Label));
        Assert.All(display.DestinationChips, chip => Assert.Equal(StatusKind.Info, chip.Tone));
    }

    [Fact]
    public void Destinations_empty_when_none_reported()
    {
        var snapshot = SampleSnapshot() with { DestinationTotals = new Dictionary<string, long>(StringComparer.Ordinal) };
        var display = FleetTelemetryCoverageProjection.Project(SuccessModel() with { Snapshot = snapshot }, Localizer);

        Assert.False(display.HasDestinations);
        Assert.Empty(display.DestinationChips);
        Assert.Equal("No destinations reported.", display.DestinationsEmptyText);
    }

    // ---- Panel: per-category sections + per-field table ----------------------------

    [Fact]
    public void Category_caption_interpolates_the_total_fields_count()
    {
        var display = FleetTelemetryCoverageProjection.Project(SuccessModel(), Localizer);

        var drive = display.Categories[0];
        Assert.Equal("Drive", drive.Category);
        Assert.Equal("3 routed fields", drive.TotalFieldsCaption);
    }

    [Fact]
    public void Category_destination_chips_use_the_neutral_tone()
    {
        var display = FleetTelemetryCoverageProjection.Project(SuccessModel(), Localizer);

        var drive = display.Categories[0];
        Assert.Collection(
            drive.DestinationChips,
            chip => Assert.Equal("signal_log: 3", chip.Label),
            chip => Assert.Equal("drives: 2", chip.Label));
        Assert.All(drive.DestinationChips, chip => Assert.Equal(StatusKind.Neutral, chip.Tone));
    }

    [Fact]
    public void Field_rows_project_destination_column_dual_write_and_subscribed()
    {
        var display = FleetTelemetryCoverageProjection.Project(SuccessModel(), Localizer);
        var drive = display.Categories[0];

        var speed = drive.Fields[0];
        Assert.Equal("VehicleSpeed", speed.Field);
        Assert.Equal("drives", speed.Destination);
        Assert.True(speed.HasColumn);
        Assert.Equal("speed", speed.ColumnText);
        Assert.True(speed.AlsoSignalLog);
        Assert.Equal("signal_log", speed.DualWriteText);
        Assert.True(speed.Subscribed);
        Assert.Equal("yes", speed.SubscribedText);

        var odometer = drive.Fields[2];
        Assert.False(odometer.HasColumn);
        Assert.Equal(FleetTelemetryCoverageProjection.EmDash, odometer.ColumnText);
        Assert.False(odometer.AlsoSignalLog);
        Assert.False(odometer.Subscribed);
        Assert.Equal("no", odometer.SubscribedText);
    }

    [Fact]
    public void Filter_narrows_categories_and_their_fields()
    {
        // "gear" only matches the Drive category's Gear field — Charge drops out entirely.
        var display = FleetTelemetryCoverageProjection.Project(SuccessModel("gear"), Localizer);

        Assert.Equal(FleetTelemetryCoverageState.Success, display.State);
        var only = Assert.Single(display.Categories);
        Assert.Equal("Drive", only.Category);
        var field = Assert.Single(only.Fields);
        Assert.Equal("Gear", field.Field);
    }

    [Fact]
    public void Filter_shows_no_match_copy_when_category_name_matches_but_no_field_does()
    {
        // "charge" matches the Charge category name; none of its fields contain "charge", so the table shows no-match.
        var display = FleetTelemetryCoverageProjection.Project(SuccessModel("charge"), Localizer);

        var charge = Assert.Single(display.Categories);
        Assert.Equal("Charge", charge.Category);
        Assert.False(charge.HasFields);
        Assert.Empty(charge.Fields);
        Assert.Equal("No fields match the current filter.", charge.EmptyFieldsText);
    }

    [Fact]
    public void Unfiltered_empty_category_uses_the_category_empty_copy()
    {
        var snapshot = new FleetTelemetryCoverageSnapshot(
            Categories:
            [
                new FleetTelemetryCategoryCoverage(
                    "Empty",
                    0,
                    new Dictionary<string, long>(StringComparer.Ordinal),
                    Array.Empty<FleetTelemetryFieldCoverage>()),
            ],
            DestinationTotals: new Dictionary<string, long>(StringComparer.Ordinal),
            OrphanFields: Array.Empty<string>());

        var display = FleetTelemetryCoverageProjection.Project(SuccessModel() with { Snapshot = snapshot }, Localizer);

        var category = Assert.Single(display.Categories);
        Assert.False(category.HasFields);
        Assert.Equal("This category has no routed fields.", category.EmptyFieldsText);
    }

    // ---- Panel: orphan-fields warning ----------------------------------------------

    [Fact]
    public void Orphans_projected_and_panel_shown_when_present()
    {
        var display = FleetTelemetryCoverageProjection.Project(SuccessModel(), Localizer);

        Assert.True(display.ShowOrphans);
        Assert.Equal("GhostField", Assert.Single(display.Orphans));
        Assert.Equal("Orphan fields detected", display.OrphansTitle);
    }

    [Fact]
    public void Orphans_panel_hidden_when_none()
    {
        var snapshot = SampleSnapshot() with { OrphanFields = Array.Empty<string>() };
        var display = FleetTelemetryCoverageProjection.Project(SuccessModel() with { Snapshot = snapshot }, Localizer);

        Assert.False(display.ShowOrphans);
        Assert.Empty(display.Orphans);
        Assert.Equal("0", display.StatOrphansValue);
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Snapshot_parse_reads_categories_destinations_and_orphans()
    {
        using var doc = JsonDocument.Parse(
            "{\"categories\":[{\"category\":\"Drive\",\"total_fields\":2,\"destinations\":{\"drives\":2,\"signal_log\":1}," +
            "\"fields\":[{\"field\":\"VehicleSpeed\",\"destination\":\"drives\",\"column\":\"speed\",\"also_signal_log\":true,\"subscribed\":true}," +
            "{\"field\":\"Odometer\",\"destination\":\"signal_log\",\"column\":null,\"also_signal_log\":false,\"subscribed\":false}]}]," +
            "\"destination_totals\":{\"signal_log\":2,\"drives\":2},\"orphan_fields\":[\"GhostField\"]}");

        var snapshot = FleetTelemetryCoverageSnapshot.FromJson(doc.RootElement);

        var category = Assert.Single(snapshot.Categories);
        Assert.Equal("Drive", category.Category);
        Assert.Equal(2, category.TotalFields);
        Assert.Equal(2, category.Destinations["drives"]);
        Assert.Equal(2, category.Fields.Count);
        Assert.Null(category.Fields[1].Column);
        Assert.True(category.Fields[0].AlsoSignalLog);
        Assert.Equal(2, snapshot.DestinationTotals["signal_log"]);
        Assert.Equal("GhostField", Assert.Single(snapshot.OrphanFields));
    }

    [Fact]
    public void Snapshot_parse_defaults_absent_collections_to_empty()
    {
        using var empty = JsonDocument.Parse("{}");
        var snapshot = FleetTelemetryCoverageSnapshot.FromJson(empty.RootElement);

        Assert.Empty(snapshot.Categories);
        Assert.Empty(snapshot.DestinationTotals);
        Assert.Empty(snapshot.OrphanFields);

        using var notObject = JsonDocument.Parse("null");
        Assert.Same(FleetTelemetryCoverageSnapshot.Empty, FleetTelemetryCoverageSnapshot.FromJson(notObject.RootElement));
    }

    [Fact]
    public void Field_parse_is_tolerant_of_partial_objects()
    {
        using var partial = JsonDocument.Parse("{\"field\":\"Gear\"}");
        var field = FleetTelemetryFieldCoverage.FromJson(partial.RootElement);

        Assert.Equal("Gear", field.Field);
        Assert.Equal(string.Empty, field.Destination);
        Assert.Null(field.Column);
        Assert.False(field.AlsoSignalLog);
        Assert.False(field.Subscribed);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_snapshot_into_the_success_state()
    {
        var feed = new FakeFeed(SampleSnapshot());
        using var vm = new FleetTelemetryCoveragePageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(FleetTelemetryCoverageState.Success, vm.State);
        Assert.True(vm.Display.ShowCategories);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new FleetTelemetryCoveragePageViewModel(EmptyFleetTelemetryCoverageFeed.Instance, Localizer);

        await vm.LoadAsync();

        Assert.Equal(FleetTelemetryCoverageState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new FleetTelemetryCoveragePageViewModel(new ThrowingFeed(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(FleetTelemetryCoverageState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_set_filter_reprojects_without_refetching()
    {
        var feed = new FakeFeed(SampleSnapshot());
        using var vm = new FleetTelemetryCoveragePageViewModel(feed, Localizer);

        await vm.LoadAsync();
        vm.SetFilter("gear");

        Assert.Equal(1, feed.FetchCount);
        Assert.Equal("gear", vm.Filter);
        var only = Assert.Single(vm.Display.Categories);
        Assert.Equal("Drive", only.Category);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeFeed(SampleSnapshot());
        using var vm = new FleetTelemetryCoveragePageViewModel(feed, Localizer);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed (web useFleetTelemetryCoverage) ---------------------

    [Fact]
    public async Task ClientFeed_sends_the_coverage_operation_with_no_params()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"categories\":[],\"destination_totals\":{},\"orphan_fields\":[]}"));
        var feed = new FleetTelemetryCoverageClientFeed(api);

        var snapshot = await feed.FetchAsync(default);

        Assert.Empty(snapshot.Categories);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_tesla_fleet_telemetry_coverage", request.OperationId);
        Assert.Null(request.Query);
        Assert.Null(request.PathParams);
        Assert.Null(request.Body);
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("server error", 500));
        var feed = new FleetTelemetryCoverageClientFeed(api);

        var ex = await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
        Assert.Equal(500, ex.StatusCode);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new FleetTelemetryCoverageDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FleetTelemetryCoveragePage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operation()
    {
        Assert.Equal("FleetTelemetryCoverage", FleetTelemetryCoverageRegistration.RouteName);
        Assert.Equal("get_api_v1_tesla_fleet_telemetry_coverage", FleetTelemetryCoverageRegistration.Operation);
        Assert.Equal("Fleet Telemetry Coverage", FleetTelemetryCoverageRegistration.Title(Localizer));
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeFeed : IFleetTelemetryCoverageFeed
    {
        private readonly FleetTelemetryCoverageSnapshot _snapshot;

        public FakeFeed(FleetTelemetryCoverageSnapshot snapshot) => _snapshot = snapshot;

        public int FetchCount { get; private set; }

        public Task<FleetTelemetryCoverageSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(_snapshot);
        }
    }

    private sealed class ThrowingFeed : IFleetTelemetryCoverageFeed
    {
        public Task<FleetTelemetryCoverageSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("coverage load failed");
    }
}
