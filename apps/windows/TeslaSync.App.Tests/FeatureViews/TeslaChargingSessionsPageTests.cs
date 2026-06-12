using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Charging;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TeslaChargingSessionsPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/charging/pages/TeslaChargingSessionsPage.tsx), the tolerant parsers (incl. the platform
/// <c>{data:…}</c> envelope), the monthly-cost aggregation, the view-model's four-state matrix
/// (loading / empty / error / success) with the distinct HTTP-403 "business account required" refresh branch (web
/// <c>is403</c>), and the generated-client feed's request shaping (web <c>useTeslaChargingSessions</c> /
/// <c>useVehicles</c> / <c>useRefreshTeslaChargingSessions</c>). The WinUI view is exercised by the app build; its
/// per-region visibility is driven entirely by the <see cref="TeslaChargingSessionsDisplay"/> flags asserted here.
/// </summary>
public sealed class TeslaChargingSessionsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 32 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "table.bulkActions.exportCsv", "tesla_sessions.allVehicles", "tesla_sessions.businessNote",
        "tesla_sessions.businessOnly", "tesla_sessions.col.cost_decimal", "tesla_sessions.col.date",
        "tesla_sessions.col.duration", "tesla_sessions.col.energy", "tesla_sessions.col.location",
        "tesla_sessions.col.month", "tesla_sessions.col.peakPower", "tesla_sessions.col.rate",
        "tesla_sessions.col.total", "tesla_sessions.col.type", "tesla_sessions.col.vin",
        "tesla_sessions.lastSync", "tesla_sessions.map", "tesla_sessions.monthlyCost",
        "tesla_sessions.monthlyCost.aria", "tesla_sessions.noChartData", "tesla_sessions.noData",
        "tesla_sessions.noMapData", "tesla_sessions.refresh", "tesla_sessions.refreshing",
        "tesla_sessions.stats.avgCost", "tesla_sessions.stats.cost_decimal", "tesla_sessions.stats.energy",
        "tesla_sessions.stats.peakPower", "tesla_sessions.stats.sessions", "tesla_sessions.subtitle",
        "tesla_sessions.table", "tesla_sessions.title",
    ];

    private static TeslaChargingSession SampleSession(
        long id = 1,
        string? vin = "5YJ3E1EA1KF000123",
        string? site = "Tesla Supercharger - Mountain View",
        string? start = "2026-03-15T10:30:00Z",
        double? wh = 50000,
        double? peakKw = 150,
        double? durationS = 3661,
        string? type = "supercharger",
        double? cost = 12.5,
        double? rate = 0.25,
        double? lat = 37.4,
        double? lng = -122.1,
        string? fetched = "2026-06-12T09:00:00Z") =>
        new(id, vin, site, start, wh, peakKw, durationS, type, "USD", cost, rate, lat, lng, fetched);

    private static TeslaChargingSessionSummary SampleSummary(
        long sessions = 3,
        double? wh = 50000,
        double? cost = 123.45,
        double? avg = 0.234,
        double? peak = 250) =>
        new(sessions, wh, cost, avg, peak);

    private static TeslaChargingSessionsModel SuccessModel(
        IReadOnlyList<TeslaChargingSession>? sessions = null,
        TeslaChargingSessionSummary? summary = null,
        IReadOnlyList<TeslaChargingVehicle>? vehicles = null,
        string selectedVin = "",
        bool refreshPending = false,
        bool refreshForbidden = false) => new(
        HasData: true,
        Sessions: sessions ?? [SampleSession()],
        Summary: summary ?? SampleSummary(),
        Vehicles: vehicles ?? Array.Empty<TeslaChargingVehicle>(),
        SelectedVin: selectedVin,
        Loading: false,
        HasError: false,
        ErrorDetail: null,
        RefreshPending: refreshPending,
        RefreshForbidden: refreshForbidden,
        Units: UnitPref.Metric,
        CurrencySymbol: "$");

    // ---- i18n key coverage (all 32 manifest strings) ------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = TeslaChargingSessionsProjection.Project(SuccessModel(), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome strings are resolved on every projection regardless of data state; visibility is gated separately.
        _ = TeslaChargingSessionsProjection.Project(TeslaChargingSessionsModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = TeslaChargingSessionsProjection.Project(TeslaChargingSessionsModel.Initial, Localizer, Now);

        Assert.Equal(TeslaChargingSessionsState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_sessions()
    {
        var model = SuccessModel(sessions: [], summary: TeslaChargingSessionSummary.Empty);
        var display = TeslaChargingSessionsProjection.Project(model, Localizer, Now);

        Assert.Equal(TeslaChargingSessionsState.Empty, display.State);
        Assert.True(display.ShowContent);     // stat cards + controls still render
        Assert.False(display.ShowTable);      // the table area shows the empty state, never a blank box
        Assert.False(display.ShowChart);
        Assert.False(display.ShowMapPoints);
        Assert.Equal("No fleet charging sessions yet. Click \"Refresh from Tesla\" to import data.", display.NoDataMessage);
    }

    [Fact]
    public void State_error_when_query_failed()
    {
        var model = TeslaChargingSessionsModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down" };
        var display = TeslaChargingSessionsProjection.Project(model, Localizer, Now);

        Assert.Equal(TeslaChargingSessionsState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_when_sessions_present()
    {
        var display = TeslaChargingSessionsProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal(TeslaChargingSessionsState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.True(display.ShowTable);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    // ---- Panels: fleet-summary stat cards (Total-Sessions … Peak-Power) ------------

    [Fact]
    public void Stat_cards_project_labels_and_values()
    {
        var display = TeslaChargingSessionsProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal("Total Sessions", display.SessionsStatLabel);
        Assert.Equal("3", display.SessionsStatValue);

        Assert.Equal("Total Energy", display.EnergyStatLabel);
        Assert.Equal("50,000.0 Wh", display.EnergyStatValue);   // SI Wh at the metric display preference

        Assert.Equal("Total Cost", display.CostStatLabel);
        Assert.Equal("$123.45", display.CostStatValue);

        Assert.Equal("Avg Cost/kWh", display.AvgCostStatLabel);
        Assert.Equal("$0.234", display.AvgCostStatValue);

        Assert.Equal("Peak Power", display.PeakPowerStatLabel);
        Assert.Equal("250 kW", display.PeakPowerStatValue);
    }

    [Fact]
    public void Stat_card_values_fall_back_to_em_dash_when_null()
    {
        var summary = new TeslaChargingSessionSummary(0, null, null, null, null);
        var display = TeslaChargingSessionsProjection.Project(SuccessModel(summary: summary), Localizer, Now);

        Assert.Equal("0", display.SessionsStatValue);
        Assert.Equal("\u2014", display.EnergyStatValue);
        Assert.Equal("\u2014", display.CostStatValue);
        Assert.Equal("\u2014", display.AvgCostStatValue);
        Assert.Equal("\u2014", display.PeakPowerStatValue);
    }

    // ---- Chart: Monthly-Charging-Cost (ChartContainer + BarChart) ------------------

    [Fact]
    public void Monthly_cost_aggregates_by_month_and_sorts_ascending()
    {
        var sessions = new[]
        {
            SampleSession(id: 1, start: "2026-04-02T08:00:00Z", cost: 5),
            SampleSession(id: 2, start: "2026-03-15T10:00:00Z", cost: 10),
            SampleSession(id: 3, start: "2026-03-20T12:00:00Z", cost: 7),
        };

        var monthly = TeslaChargingSessionsProjection.BuildMonthlyCost(sessions);

        Assert.Collection(
            monthly,
            m => { Assert.Equal("2026-03", m.Month); Assert.Equal(17, m.Total); },
            m => { Assert.Equal("2026-04", m.Month); Assert.Equal(5, m.Total); });
    }

    [Fact]
    public void Chart_is_ready_with_one_series_when_sessions_have_cost()
    {
        var display = TeslaChargingSessionsProjection.Project(SuccessModel(), Localizer, Now);

        Assert.True(display.ShowChart);
        var series = Assert.Single(display.ChartSeries);
        Assert.Equal("Total ($)", series.Name);            // accessible-table value column header (col.total)
        Assert.Equal(ChartSeriesKind.Bar, series.Kind);
        Assert.NotEmpty(series.Points);
        Assert.Equal("Month", display.MonthColumnLabel);   // accessible-table X column header (col.month)
        Assert.Equal("Monthly Tesla charging cost bar chart", display.MonthlyCostAria);
    }

    [Fact]
    public void Chart_is_empty_with_no_cost_data()
    {
        var session = SampleSession(start: null, cost: null);
        var display = TeslaChargingSessionsProjection.Project(SuccessModel(sessions: [session]), Localizer, Now);

        Assert.False(display.ShowChart);
        Assert.Empty(display.ChartSeries);
        Assert.Equal("No cost data yet. Click \"Refresh from Tesla\" to sync.", display.NoChartDataMessage);
    }

    // ---- Panel: GlassPanel9 (session locations) ------------------------------------

    [Fact]
    public void Map_points_keep_only_geolocated_sessions()
    {
        var sessions = new[]
        {
            SampleSession(id: 1, lat: 37.4, lng: -122.1, site: "Mountain View"),
            SampleSession(id: 2, lat: null, lng: null),
        };

        var display = TeslaChargingSessionsProjection.Project(SuccessModel(sessions: sessions), Localizer, Now);

        Assert.True(display.ShowMapPoints);
        var point = Assert.Single(display.MapPoints);
        Assert.Equal("Mountain View", point.SiteName);
        Assert.Equal("37.4000, -122.1000", point.Coordinates);
    }

    [Fact]
    public void Map_empty_message_when_no_session_has_coordinates()
    {
        var session = SampleSession(lat: null, lng: null);
        var display = TeslaChargingSessionsProjection.Project(SuccessModel(sessions: [session]), Localizer, Now);

        Assert.False(display.ShowMapPoints);
        Assert.Empty(display.MapPoints);
        Assert.Equal("Session Locations", display.MapTitle);
        Assert.Equal("No location data available yet.", display.NoMapDataMessage);
    }

    // ---- Panel: GlassPanel10 (session table) ---------------------------------------

    [Fact]
    public void Table_has_the_nine_web_columns()
    {
        var display = TeslaChargingSessionsProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Collection(
            display.Columns,
            c => AssertColumn(c, "date", "Date", numeric: false),
            c => AssertColumn(c, "location", "Location", numeric: false),
            c => AssertColumn(c, "vin", "VIN", numeric: false),
            c => AssertColumn(c, "energy", "Energy (kWh)", numeric: true),
            c => AssertColumn(c, "peakPower", "Peak (kW)", numeric: true),
            c => AssertColumn(c, "duration", "Duration", numeric: false),
            c => AssertColumn(c, "cost", "Cost", numeric: true),
            c => AssertColumn(c, "rate", "Rate/kWh", numeric: true),
            c => AssertColumn(c, "type", "Type", numeric: false));
    }

    [Fact]
    public void Table_rows_format_every_cell()
    {
        var session = SampleSession(
            id: 7, vin: "5YJ3E1EA1KF000123", site: "Supercharger A", wh: 50000,
            peakKw: 150, durationS: 3661, type: "supercharger", cost: 12.5, rate: 0.25);
        var display = TeslaChargingSessionsProjection.Project(SuccessModel(sessions: [session]), Localizer, Now);

        var row = Assert.Single(display.Rows);
        Assert.Equal(7, row.SessionId);
        Assert.Equal("Supercharger A", row.Location);
        Assert.Equal("\u2026000123", row.Vin);
        Assert.Equal("50.0", row.Energy);     // SI Wh → kWh, one decimal (web convertEnergyFromSI(_, 'kWh'))
        Assert.Equal("150", row.PeakPower);
        Assert.Equal("1h 1m", row.Duration);
        Assert.Equal("$12.50", row.Cost);
        Assert.Equal("$0.250", row.Rate);
        Assert.Equal("SUPERCHARGER", row.Type);
        Assert.NotEqual("\u2014", row.Date);
    }

    [Fact]
    public void Table_row_nullable_cells_fall_back_to_em_dash()
    {
        var session = new TeslaChargingSession(9, null, null, null, null, null, null, null, null, null, null, null, null, null);
        var display = TeslaChargingSessionsProjection.Project(SuccessModel(sessions: [session]), Localizer, Now);

        var row = Assert.Single(display.Rows);
        Assert.Equal("\u2014", row.Location);
        Assert.Equal("\u2014", row.Vin);
        Assert.Equal("\u2014", row.Energy);
        Assert.Equal("\u2014", row.PeakPower);
        Assert.Equal("\u2014", row.Duration);
        Assert.Equal("\u2014", row.Cost);
        Assert.Equal("\u2014", row.Rate);
        Assert.Equal("\u2014", row.Type);
    }

    [Theory]
    [InlineData(null, "\u2014")]
    [InlineData(3661.0, "1h 1m")]
    [InlineData(1830.0, "30m")]
    [InlineData(45.0, "0m")]
    public void Duration_formats_match_web(double? seconds, string expected) =>
        Assert.Equal(expected, TeslaChargingSessionsProjection.FormatDurationSeconds(seconds));

    // ---- Panel: GlassPanel2 (controls bar) -----------------------------------------

    [Fact]
    public void Vehicle_options_lead_with_all_vehicles_then_each_vehicle()
    {
        var vehicles = new[]
        {
            new TeslaChargingVehicle("5YJ3E1EA1KF000123", "Model 3"),
            new TeslaChargingVehicle("7SAYGDEE9PF000456", "Model Y"),
        };
        var display = TeslaChargingSessionsProjection.Project(
            SuccessModel(vehicles: vehicles, selectedVin: "7SAYGDEE9PF000456"), Localizer, Now);

        Assert.Collection(
            display.VehicleOptions,
            o => { Assert.Equal("", o.Value); Assert.Equal("All Vehicles", o.Label); Assert.False(o.IsSelected); },
            o => { Assert.Equal("5YJ3E1EA1KF000123", o.Value); Assert.Equal("Model 3 (000123)", o.Label); Assert.False(o.IsSelected); },
            o => { Assert.Equal("7SAYGDEE9PF000456", o.Value); Assert.Equal("Model Y (000456)", o.Label); Assert.True(o.IsSelected); });
    }

    [Fact]
    public void Refresh_button_label_toggles_with_the_pending_flag()
    {
        var idle = TeslaChargingSessionsProjection.Project(SuccessModel(), Localizer, Now);
        var pending = TeslaChargingSessionsProjection.Project(SuccessModel(refreshPending: true), Localizer, Now);

        Assert.Equal("Refresh from Tesla", idle.RefreshButtonLabel);
        Assert.False(idle.RefreshPending);
        Assert.Equal("Syncing...", pending.RefreshButtonLabel);
        Assert.True(pending.RefreshPending);
    }

    [Fact]
    public void Business_only_note_shows_only_after_a_403_refresh()
    {
        var allowed = TeslaChargingSessionsProjection.Project(SuccessModel(), Localizer, Now);
        var forbidden = TeslaChargingSessionsProjection.Project(SuccessModel(refreshForbidden: true), Localizer, Now);

        Assert.False(allowed.ShowBusinessOnly);
        Assert.True(forbidden.ShowBusinessOnly);
        Assert.Equal("Business account required", forbidden.BusinessOnlyLabel);
    }

    [Fact]
    public void Last_sync_caption_shows_when_a_session_carries_a_fetched_at()
    {
        var withFetch = TeslaChargingSessionsProjection.Project(SuccessModel(), Localizer, Now);
        var withoutFetch = TeslaChargingSessionsProjection.Project(
            SuccessModel(sessions: [SampleSession(fetched: null)]), Localizer, Now);

        Assert.True(withFetch.ShowLastSync);
        Assert.StartsWith("Last synced:", withFetch.LastSyncText, StringComparison.Ordinal);
        Assert.False(withoutFetch.ShowLastSync);
    }

    [Fact]
    public void Info_banner_resolves_the_business_note()
    {
        var display = TeslaChargingSessionsProjection.Project(SuccessModel(), Localizer, Now);
        Assert.StartsWith("Fleet charging session data is only available", display.BusinessNote, StringComparison.Ordinal);
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Snapshot_parse_unwraps_the_data_envelope_and_reads_sessions_and_summary()
    {
        using var doc = JsonDocument.Parse(
            "{\"data\":{\"sessions\":[{\"session_id\":42,\"vin\":\"VIN1\",\"site_location_name\":\"Site\"," +
            "\"charge_start_datetime\":\"2026-03-01T00:00:00Z\",\"total_energy_added_wh\":12000," +
            "\"peak_power_kw\":120,\"charge_duration_s\":1800,\"charger_type\":\"supercharger\"," +
            "\"currency_code\":\"USD\",\"total_cost\":8.5,\"per_kwh_rate\":0.2,\"latitude\":1.5," +
            "\"longitude\":2.5,\"fetched_at\":\"2026-03-01T01:00:00Z\"}]," +
            "\"summary\":{\"total_sessions\":1,\"total_wh\":12000,\"total_cost\":8.5,\"avg_cost_per_kwh\":0.2,\"peak_power_kw\":120}}}");

        var snapshot = TeslaChargingSessionsSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        var session = Assert.Single(snapshot.Sessions);
        Assert.Equal(42, session.SessionId);
        Assert.Equal("VIN1", session.Vin);
        Assert.Equal("Site", session.SiteLocationName);
        Assert.Equal(12000, session.TotalEnergyAddedWh);
        Assert.Equal(120, session.PeakPowerKw);
        Assert.Equal(1.5, session.Latitude);
        Assert.Equal(1, snapshot.Summary.TotalSessions);
        Assert.Equal(8.5, snapshot.Summary.TotalCost);
    }

    [Fact]
    public void Snapshot_parse_reads_a_bare_unwrapped_object()
    {
        using var doc = JsonDocument.Parse("{\"sessions\":[],\"summary\":{\"total_sessions\":0}}");
        var snapshot = TeslaChargingSessionsSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        Assert.Empty(snapshot.Sessions);
        Assert.Equal(0, snapshot.Summary.TotalSessions);
    }

    [Fact]
    public void Snapshot_parse_is_tolerant_of_missing_summary_and_partial_rows()
    {
        using var doc = JsonDocument.Parse("{\"data\":{\"sessions\":[{\"session_id\":5}]}}");
        var snapshot = TeslaChargingSessionsSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        var session = Assert.Single(snapshot.Sessions);
        Assert.Equal(5, session.SessionId);
        Assert.Null(session.Vin);
        Assert.Null(session.TotalEnergyAddedWh);
        Assert.Equal(TeslaChargingSessionSummary.Empty, snapshot.Summary);
    }

    [Fact]
    public void Snapshot_parse_treats_non_object_as_no_data()
    {
        using var notObject = JsonDocument.Parse("null");
        Assert.False(TeslaChargingSessionsSnapshot.FromJson(notObject.RootElement).HasData);
    }

    [Fact]
    public void Vehicles_parse_from_a_bare_array_and_a_data_envelope()
    {
        using var bare = JsonDocument.Parse("[{\"vin\":\"V1\",\"display_name\":\"Three\"},{\"vin\":\"V2\",\"display_name\":\"Y\"}]");
        var fromBare = TeslaChargingVehicle.ListFromJson(bare.RootElement);
        Assert.Equal(2, fromBare.Count);
        Assert.Equal("V1", fromBare[0].Vin);
        Assert.Equal("Three", fromBare[0].DisplayName);

        using var enveloped = JsonDocument.Parse("{\"data\":[{\"vin\":\"V3\",\"display_name\":\"S\"}]}");
        var fromEnvelope = TeslaChargingVehicle.ListFromJson(enveloped.RootElement);
        Assert.Equal("V3", Assert.Single(fromEnvelope).Vin);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_sessions_into_the_success_state()
    {
        var feed = new FakeFeed(new TeslaChargingSessionsSnapshot(true, [SampleSession()], SampleSummary()));
        using var vm = new TeslaChargingSessionsPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(TeslaChargingSessionsState.Success, vm.State);
        Assert.True(vm.Display.ShowTable);
        Assert.False(vm.IsFetching);
        Assert.Equal(1, feed.SessionsFetchCount);
        Assert.Equal(1, feed.VehiclesFetchCount);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new TeslaChargingSessionsPageViewModel(EmptyTeslaChargingSessionsFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(TeslaChargingSessionsState.Empty, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.Display.ShowTable);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        var feed = new FakeFeed(TeslaChargingSessionsSnapshot.Empty, sessionsError: new InvalidOperationException("network down"));
        using var vm = new TeslaChargingSessionsPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(TeslaChargingSessionsState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.Contains("Failed to load data", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_set_vehicle_reloads_the_sessions_with_the_vin()
    {
        var feed = new FakeFeed(new TeslaChargingSessionsSnapshot(true, [SampleSession()], SampleSummary()));
        using var vm = new TeslaChargingSessionsPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.SetVehicleAsync("5YJ3E1EA1KF000123");

        Assert.Equal("5YJ3E1EA1KF000123", vm.SelectedVin);
        Assert.Equal(2, feed.SessionsFetchCount);
        Assert.Equal("5YJ3E1EA1KF000123", feed.LastSessionsVin);
    }

    [Fact]
    public async Task ViewModel_refresh_403_surfaces_the_business_only_note()
    {
        var feed = new FakeFeed(
            new TeslaChargingSessionsSnapshot(true, [SampleSession()], SampleSummary()),
            refreshError: new ApiException("personal account", 403));
        using var vm = new TeslaChargingSessionsPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.RefreshFromTeslaAsync();

        Assert.True(vm.Display.ShowBusinessOnly);
        Assert.False(vm.Display.RefreshPending);
        Assert.True(vm.Display.ShowTable);   // existing data is preserved across the failed refresh
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeFeed(new TeslaChargingSessionsSnapshot(true, [SampleSession()], SampleSummary()));
        using var vm = new TeslaChargingSessionsPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.RefreshFromTeslaAsync();

        Assert.Equal(1, feed.RefreshCount);
        Assert.Equal(TeslaChargingSessionsState.Success, vm.State);
    }

    // ---- Generated-client feed (web hooks) -----------------------------------------

    [Fact]
    public async Task ClientFeed_sessions_sends_the_operation_with_the_vin_query()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"sessions\":[],\"summary\":{\"total_sessions\":0}}"));
        var feed = new TeslaChargingSessionsClientFeed(api);

        var snapshot = await feed.FetchSessionsAsync("VIN9", default);

        Assert.True(snapshot.HasData);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_tesla_charging_sessions", request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal("VIN9", request.Query!["vin"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_sessions_omits_the_vin_query_for_all_vehicles()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"sessions\":[]}"));
        var feed = new TeslaChargingSessionsClientFeed(api);

        await feed.FetchSessionsAsync(null, default);

        Assert.Null(Assert.Single(api.Requests).Query);
    }

    [Fact]
    public async Task ClientFeed_vehicles_sends_the_vehicles_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"vin\":\"V1\",\"display_name\":\"Three\"}]"));
        var feed = new TeslaChargingSessionsClientFeed(api);

        var vehicles = await feed.FetchVehiclesAsync(default);

        Assert.Equal("V1", Assert.Single(vehicles).Vin);
        Assert.Equal("get_api_v1_vehicles", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_refresh_sends_the_refresh_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"sessions\":[],\"summary\":{\"total_sessions\":0}}"));
        var feed = new TeslaChargingSessionsClientFeed(api);

        await feed.RefreshAsync("VIN3", default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_tesla_charging_sessions_refresh", request.OperationId);
        Assert.Equal("VIN3", request.Query!["vin"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_the_api_exception_for_the_403_branch()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("business account required", 403));
        var feed = new TeslaChargingSessionsClientFeed(api);

        var ex = await Assert.ThrowsAsync<ApiException>(() => feed.RefreshAsync(null, default));
        Assert.Equal(403, ex.StatusCode);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_view_opened()
    {
        var diagnostics = new TeslaChargingSessionsDiagnostics();

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.OpenedCount);
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("TeslaChargingSessions", TeslaChargingSessionsRegistration.RouteName);
        Assert.Equal("/tesla-charging-sessions", TeslaChargingSessionsRegistration.WebRoute);
        Assert.Equal("get_api_v1_tesla_charging_sessions", TeslaChargingSessionsRegistration.SessionsOperation);
        Assert.Equal("post_api_v1_tesla_charging_sessions_refresh", TeslaChargingSessionsRegistration.RefreshOperation);
        Assert.Equal("get_api_v1_vehicles", TeslaChargingSessionsRegistration.VehiclesOperation);
    }

    private static void AssertColumn(TeslaChargingColumn column, string key, string header, bool numeric)
    {
        Assert.Equal(key, column.Key);
        Assert.Equal(header, column.Header);
        Assert.Equal(numeric, column.IsNumeric);
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

    private sealed class FakeFeed : ITeslaChargingSessionsFeed
    {
        private readonly TeslaChargingSessionsSnapshot _snapshot;
        private readonly IReadOnlyList<TeslaChargingVehicle> _vehicles;
        private readonly Exception? _sessionsError;
        private readonly Exception? _refreshError;

        public FakeFeed(
            TeslaChargingSessionsSnapshot snapshot,
            IReadOnlyList<TeslaChargingVehicle>? vehicles = null,
            Exception? sessionsError = null,
            Exception? refreshError = null)
        {
            _snapshot = snapshot;
            _vehicles = vehicles ?? [new TeslaChargingVehicle("5YJ3E1EA1KF000123", "Model 3")];
            _sessionsError = sessionsError;
            _refreshError = refreshError;
        }

        public int SessionsFetchCount { get; private set; }

        public int VehiclesFetchCount { get; private set; }

        public int RefreshCount { get; private set; }

        public string? LastSessionsVin { get; private set; }

        public Task<TeslaChargingSessionsSnapshot> FetchSessionsAsync(string? vin, CancellationToken cancellationToken)
        {
            SessionsFetchCount++;
            LastSessionsVin = vin;
            if (_sessionsError is not null)
            {
                throw _sessionsError;
            }

            return Task.FromResult(_snapshot);
        }

        public Task<IReadOnlyList<TeslaChargingVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
        {
            VehiclesFetchCount++;
            return Task.FromResult(_vehicles);
        }

        public Task<TeslaChargingSessionsSnapshot> RefreshAsync(string? vin, CancellationToken cancellationToken)
        {
            RefreshCount++;
            if (_refreshError is not null)
            {
                throw _refreshError;
            }

            return Task.FromResult(_snapshot);
        }
    }
}
