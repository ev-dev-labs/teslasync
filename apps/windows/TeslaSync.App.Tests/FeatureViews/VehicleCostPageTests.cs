using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>VehicleCostPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/VehicleCostPage.tsx), the tolerant parsers (incl. the platform <c>{data:…}</c>
/// envelope), the view-model's four-state matrix (loading / empty / error / success) with the distinct HTTP-503
/// subsystem-unavailable branch (web <c>subsystemMissing</c>) and the window selector reload, and the
/// generated-client feed's request shaping (web <c>useVehicleCost(since, 100)</c>). The WinUI view is exercised by the
/// app build; its per-region visibility is driven entirely by the <see cref="VehicleCostDisplay"/> flags asserted here.
/// </summary>
public sealed class VehicleCostPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 24 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "admin.subsystem.unavailableTitle", "admin.vehicleCost.bytesSub", "admin.vehicleCost.colBytes",
        "admin.vehicleCost.colFailures", "admin.vehicleCost.colLastSeen", "admin.vehicleCost.colRate",
        "admin.vehicleCost.colRows", "admin.vehicleCost.colVehicle", "admin.vehicleCost.emptyMessage",
        "admin.vehicleCost.emptyTable", "admin.vehicleCost.emptyTitle", "admin.vehicleCost.failuresSub",
        "admin.vehicleCost.notConfigured", "admin.vehicleCost.pageTitle", "admin.vehicleCost.rateSub",
        "admin.vehicleCost.subtitle", "admin.vehicleCost.tableTitle", "admin.vehicleCost.totalBytes",
        "admin.vehicleCost.totalFailures", "admin.vehicleCost.totalRate", "admin.vehicleCost.totalRows",
        "admin.vehicleCost.unnamed", "admin.vehicleCost.windowLabel", "admin.vehicleCost.windowSub",
    ];

    private static VehicleCostRow SampleRow(
        long id = 1,
        string? name = "Model 3",
        long rows = 12345,
        long bytes = 2048,
        double rate = 42.5,
        long failures = 0,
        string? lastSeen = "2026-06-12T10:30:00Z") =>
        new(id, name, rows, bytes, rate, failures, lastSeen);

    private static VehicleCostTotals SampleTotals(
        long rows = 12345,
        long bytes = 1572864,
        double rate = 84.5,
        long failures = 3) =>
        new(rows, bytes, rate, failures);

    private static VehicleCostModel SuccessModel(
        IReadOnlyList<VehicleCostRow>? vehicles = null,
        VehicleCostTotals? totals = null,
        int windowDays = 30) => new(
        HasData: true,
        Vehicles: vehicles ?? [SampleRow()],
        Totals: totals ?? SampleTotals(),
        WindowDays: windowDays,
        Loading: false,
        HasError: false,
        ErrorDetail: null,
        SubsystemMissing: false);

    // ---- i18n key coverage (all 24 manifest strings) ------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = VehicleCostProjection.Project(SuccessModel(), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome strings (incl. the unnamed template + window labels) are resolved on every projection regardless of
        // data state; visibility is gated separately.
        _ = VehicleCostProjection.Project(VehicleCostModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = VehicleCostProjection.Project(VehicleCostModel.Initial, Localizer, Now);

        Assert.Equal(VehicleCostState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowSubsystemUnavailable);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_vehicles()
    {
        var model = SuccessModel(vehicles: [], totals: VehicleCostTotals.Empty);
        var display = VehicleCostProjection.Project(model, Localizer, Now);

        Assert.Equal(VehicleCostState.Empty, display.State);
        Assert.True(display.ShowContent);     // totals cards + window selector still render
        Assert.True(display.ShowEmptyState);  // the table area shows the empty state, never a blank box
        Assert.False(display.ShowTable);
        Assert.Equal("No vehicle cost data", display.EmptyTitle);
        Assert.Equal("No vehicles have ingested signals during this window.", display.EmptyMessage);
    }

    [Fact]
    public void State_error_subsystem_unavailable_is_the_503_banner()
    {
        var model = VehicleCostModel.Initial with { Loading = false, SubsystemMissing = true };
        var display = VehicleCostProjection.Project(model, Localizer, Now);

        Assert.Equal(VehicleCostState.Error, display.State);
        Assert.True(display.ShowSubsystemUnavailable);
        Assert.False(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Equal("Subsystem unavailable", display.SubsystemTitle);
        Assert.Equal(
            "The ingest-x-ray subsystem is not configured on this deployment. Vehicle cost reporting requires the signal_log hypertable to be populated.",
            display.SubsystemMessage);
    }

    [Fact]
    public void State_error_generic_failure_shows_retry()
    {
        var model = VehicleCostModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down" };
        var display = VehicleCostProjection.Project(model, Localizer, Now);

        Assert.Equal(VehicleCostState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowSubsystemUnavailable);
        Assert.False(display.ShowContent);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_when_vehicles_present()
    {
        var display = VehicleCostProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal(VehicleCostState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.True(display.ShowTable);
        Assert.False(display.ShowEmptyState);
        Assert.False(display.ShowError);
        Assert.False(display.ShowSubsystemUnavailable);
    }

    // ---- Panels: fleet-total stat cards --------------------------------------------

    [Fact]
    public void Totals_cards_project_labels_values_and_sublabels()
    {
        var totals = new VehicleCostTotals(TotalRows: 12345, TotalBytesEst: 1572864, TotalRatePerMinute24h: 84.5, TotalFailures24h: 3);
        var display = VehicleCostProjection.Project(SuccessModel(totals: totals, windowDays: 30), Localizer, Now);

        Assert.Equal("Total rows", display.TotalRowsLabel);
        Assert.Equal("12,345", display.TotalRowsValue);
        Assert.Equal("Window: 30d", display.TotalRowsSub);

        Assert.Equal("Total bytes (est.)", display.TotalBytesLabel);
        Assert.Equal("1.5 MB", display.TotalBytesValue);
        Assert.Equal("96 bytes/row average", display.TotalBytesSub);

        Assert.Equal("Rate (rows/min, 24h)", display.TotalRateLabel);
        Assert.Equal("84.5", display.TotalRateValue);
        Assert.Equal("Across all vehicles", display.TotalRateSub);

        Assert.Equal("DLQ failures (24h)", display.TotalFailuresLabel);
        Assert.Equal("3", display.TotalFailuresValue);
        Assert.Equal("Codec or writer rejections", display.TotalFailuresSub);
    }

    [Fact]
    public void Totals_window_sublabel_follows_selected_window()
    {
        var display = VehicleCostProjection.Project(SuccessModel(windowDays: 7), Localizer, Now);
        Assert.Equal("Window: 7d", display.TotalRowsSub);
    }

    // ---- Panel: per-vehicle breakdown (GlassPanel1) --------------------------------

    [Fact]
    public void Breakdown_panel_has_title_and_six_columns()
    {
        var display = VehicleCostProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal("Per-vehicle breakdown", display.TableTitle);
        Assert.Equal("Window", display.WindowLabel);

        Assert.Collection(
            display.Columns,
            c => AssertColumn(c, "vehicle", "Vehicle", numeric: false),
            c => AssertColumn(c, "rows", "Rows", numeric: true),
            c => AssertColumn(c, "bytes", "Bytes (est.)", numeric: true),
            c => AssertColumn(c, "rate", "Rate (rows/min, 24h)", numeric: true),
            c => AssertColumn(c, "failures", "DLQ (24h)", numeric: true),
            c => AssertColumn(c, "last", "Last seen", numeric: false));
    }

    [Fact]
    public void Table_rows_format_every_cell()
    {
        var row = SampleRow(id: 7, name: "Model Y", rows: 1234567, bytes: 2048, rate: 12.34, failures: 9, lastSeen: "2026-06-12T11:55:00Z");
        var display = VehicleCostProjection.Project(SuccessModel(vehicles: [row]), Localizer, Now);

        var projected = Assert.Single(display.Rows);
        Assert.Equal(7, projected.VehicleId);
        Assert.Equal("Model Y", projected.Vehicle);
        Assert.Equal("1,234,567", projected.Rows);
        Assert.Equal("2.0 KB", projected.Bytes);
        Assert.Equal("12.3", projected.Rate);
        Assert.Equal("9", projected.Failures);
        Assert.Equal("5m ago", projected.LastSeen);
    }

    [Fact]
    public void Table_row_uses_unnamed_fallback_when_display_name_missing()
    {
        var row = SampleRow(id: 42, name: null);
        var display = VehicleCostProjection.Project(SuccessModel(vehicles: [row]), Localizer, Now);

        Assert.Equal("Vehicle #42", Assert.Single(display.Rows).Vehicle);
    }

    [Fact]
    public void Empty_table_message_is_projected_for_the_data_table()
    {
        var display = VehicleCostProjection.Project(SuccessModel(), Localizer, Now);
        Assert.Equal("No vehicle cost data", display.EmptyTableMessage);
    }

    // ---- Window selector -----------------------------------------------------------

    [Fact]
    public void Window_selector_projects_four_options_with_the_selected_one_marked()
    {
        var display = VehicleCostProjection.Project(SuccessModel(windowDays: 7), Localizer, Now);

        Assert.Equal(7, display.SelectedWindowDays);
        Assert.Collection(
            display.WindowOptions,
            o => AssertWindow(o, 1, "Last 1 day", selected: false),
            o => AssertWindow(o, 7, "Last 7 days", selected: true),
            o => AssertWindow(o, 30, "Last 30 days", selected: false),
            o => AssertWindow(o, 90, "Last 90 days", selected: false));
    }

    // ---- Number / byte / relative formatting ---------------------------------------

    [Theory]
    [InlineData(0, "0")]
    [InlineData(5, "5")]
    [InlineData(12345, "12,345")]
    [InlineData(1234567, "1,234,567")]
    public void FormatCount_matches_web(long value, string expected) =>
        Assert.Equal(expected, VehicleCostProjection.FormatCount(value));

    [Theory]
    [InlineData(0.0, "0.0")]
    [InlineData(42.5, "42.5")]
    [InlineData(12.34, "12.3")]
    [InlineData(1234.5, "1,234.5")]
    public void FormatRate_matches_web(double value, string expected) =>
        Assert.Equal(expected, VehicleCostProjection.FormatRate(value));

    [Theory]
    [InlineData(0, "0 B")]
    [InlineData(512, "512 B")]
    [InlineData(1023, "1023 B")]
    [InlineData(1024, "1.0 KB")]
    [InlineData(1536, "1.5 KB")]
    [InlineData(1048576, "1.0 MB")]
    [InlineData(1572864, "1.5 MB")]
    [InlineData(1073741824, "1.0 GB")]
    public void FormatBytes_matches_web(long bytes, string expected) =>
        Assert.Equal(expected, VehicleCostProjection.FormatBytes(bytes));

    [Theory]
    [InlineData(null, "\u2014")]
    [InlineData("not-a-date", "\u2014")]
    [InlineData("2026-06-12T11:59:30Z", "just now")]
    [InlineData("2026-06-12T11:55:00Z", "5m ago")]
    [InlineData("2026-06-12T09:00:00Z", "3h ago")]
    [InlineData("2026-06-09T12:00:00Z", "3d ago")]
    public void FormatRelative_matches_web_tiers(string? raw, string expected) =>
        Assert.Equal(expected, VehicleCostProjection.FormatRelative(raw, Now));

    [Fact]
    public void FormatRelative_falls_back_to_absolute_date_beyond_a_week()
    {
        const string raw = "2026-06-01T12:00:00Z";
        var value = DateTimeOffset.Parse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
        var expected = DateTimeFormatting.Format(value, DateTimeVariant.Date, Now);

        Assert.Equal(expected, VehicleCostProjection.FormatRelative(raw, Now));
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Snapshot_parse_unwraps_the_data_envelope_and_reads_vehicles_and_totals()
    {
        using var doc = JsonDocument.Parse(
            "{\"data\":{\"vehicles\":[{\"vehicle_id\":3,\"display_name\":\"Roadster\",\"signal_row_count\":100," +
            "\"signal_bytes_est\":9600,\"ingest_rate_per_minute_24h\":1.5,\"dlq_failures_24h\":2," +
            "\"last_seen_at\":\"2026-06-12T10:00:00Z\"}]," +
            "\"totals\":{\"total_rows\":100,\"total_bytes_est\":9600,\"total_rate_per_minute_24h\":1.5,\"total_failures_24h\":2}}}");

        var snapshot = VehicleCostSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        var row = Assert.Single(snapshot.Vehicles);
        Assert.Equal(3, row.VehicleId);
        Assert.Equal("Roadster", row.DisplayName);
        Assert.Equal(100, row.SignalRowCount);
        Assert.Equal(9600, row.SignalBytesEst);
        Assert.Equal(1.5, row.IngestRatePerMinute24h);
        Assert.Equal(2, row.DlqFailures24h);
        Assert.Equal("2026-06-12T10:00:00Z", row.LastSeenAt);
        Assert.Equal(100, snapshot.Totals.TotalRows);
        Assert.Equal(9600, snapshot.Totals.TotalBytesEst);
        Assert.Equal(2, snapshot.Totals.TotalFailures24h);
    }

    [Fact]
    public void Snapshot_parse_reads_a_bare_unwrapped_object()
    {
        using var doc = JsonDocument.Parse("{\"vehicles\":[],\"totals\":{\"total_rows\":0}}");
        var snapshot = VehicleCostSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        Assert.Empty(snapshot.Vehicles);
        Assert.Equal(0, snapshot.Totals.TotalRows);
    }

    [Fact]
    public void Snapshot_parse_is_tolerant_of_missing_totals_and_partial_rows()
    {
        using var doc = JsonDocument.Parse("{\"data\":{\"vehicles\":[{\"vehicle_id\":5}]}}");
        var snapshot = VehicleCostSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        var row = Assert.Single(snapshot.Vehicles);
        Assert.Equal(5, row.VehicleId);
        Assert.Null(row.DisplayName);
        Assert.Equal(0, row.SignalRowCount);
        Assert.Equal(VehicleCostTotals.Empty, snapshot.Totals);
    }

    [Fact]
    public void Snapshot_parse_treats_non_object_as_no_data()
    {
        using var notObject = JsonDocument.Parse("null");
        Assert.False(VehicleCostSnapshot.FromJson(notObject.RootElement).HasData);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_vehicles_into_the_success_state()
    {
        var feed = new FakeFeed(new VehicleCostSnapshot(true, [SampleRow()], SampleTotals()));
        using var vm = new VehicleCostPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(VehicleCostState.Success, vm.State);
        Assert.True(vm.Display.ShowTable);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new VehicleCostPageViewModel(EmptyVehicleCostFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(VehicleCostState.Empty, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.True(vm.Display.ShowEmptyState);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_generic_error_state()
    {
        using var vm = new VehicleCostPageViewModel(new ThrowingFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(VehicleCostState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.False(vm.Display.ShowSubsystemUnavailable);
        Assert.Contains("Failed to load data", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_http_503_is_the_subsystem_unavailable_branch()
    {
        using var vm = new VehicleCostPageViewModel(new SubsystemMissingFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(VehicleCostState.Error, vm.State);
        Assert.True(vm.Display.ShowSubsystemUnavailable);
        Assert.False(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeFeed(new VehicleCostSnapshot(true, [SampleRow()], SampleTotals()));
        using var vm = new VehicleCostPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    [Fact]
    public async Task ViewModel_set_window_reloads_with_the_new_window_and_derived_since()
    {
        var feed = new FakeFeed(new VehicleCostSnapshot(true, [SampleRow()], SampleTotals()));
        using var vm = new VehicleCostPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        Assert.Equal(Now - TimeSpan.FromDays(30), feed.LastSince);

        await vm.SetWindowAsync(7);

        Assert.Equal(7, vm.WindowDays);
        Assert.Equal(2, feed.FetchCount);
        Assert.Equal(Now - TimeSpan.FromDays(7), feed.LastSince);
        Assert.Equal(VehicleCostProjection.RowLimit, feed.LastLimit);
    }

    [Fact]
    public async Task ViewModel_set_window_is_a_no_op_for_unchanged_or_unknown_windows()
    {
        var feed = new FakeFeed(new VehicleCostSnapshot(true, [SampleRow()], SampleTotals()));
        using var vm = new VehicleCostPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.SetWindowAsync(30);   // unchanged (default)
        await vm.SetWindowAsync(365);  // not an offered choice

        Assert.Equal(1, feed.FetchCount);
        Assert.Equal(30, vm.WindowDays);
    }

    // ---- Generated-client feed (web useVehicleCost) --------------------------------

    [Fact]
    public async Task ClientFeed_sends_the_observability_operation_with_limit_and_since()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"data\":{\"vehicles\":[],\"totals\":{\"total_rows\":0}}}"));
        var feed = new VehicleCostClientFeed(api);
        var since = new DateTimeOffset(2026, 5, 13, 17, 40, 56, 457, TimeSpan.Zero);

        var snapshot = await feed.FetchAsync(since, 100, default);

        Assert.True(snapshot.HasData);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_admin_observability_vehicle_cost", request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal("100", request.Query!["limit"]?.ToString());
        Assert.Equal("2026-05-13T17:40:56.457Z", request.Query!["since"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception_for_the_subsystem_branch()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("not configured", 503));
        var feed = new VehicleCostClientFeed(api);

        var ex = await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(Now, 100, default));
        Assert.Equal(503, ex.StatusCode);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new VehicleCostDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VehicleCostPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operation()
    {
        Assert.Equal("VehicleCost", VehicleCostRegistration.RouteName);
        Assert.Equal("get_api_v1_admin_observability_vehicle_cost", VehicleCostRegistration.Operation);
        Assert.Equal("Vehicle Ingest Cost", VehicleCostRegistration.Title(Localizer));
    }

    private static void AssertColumn(VehicleCostColumn column, string key, string header, bool numeric)
    {
        Assert.Equal(key, column.Key);
        Assert.Equal(header, column.Header);
        Assert.Equal(numeric, column.IsNumeric);
    }

    private static void AssertWindow(VehicleCostWindowOption option, int days, string label, bool selected)
    {
        Assert.Equal(days, option.Days);
        Assert.Equal(label, option.Label);
        Assert.Equal(selected, option.IsSelected);
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

    private sealed class FakeFeed : IVehicleCostFeed
    {
        private readonly VehicleCostSnapshot _snapshot;

        public FakeFeed(VehicleCostSnapshot snapshot) => _snapshot = snapshot;

        public int FetchCount { get; private set; }

        public DateTimeOffset LastSince { get; private set; }

        public int LastLimit { get; private set; }

        public Task<VehicleCostSnapshot> FetchAsync(DateTimeOffset since, int limit, CancellationToken cancellationToken)
        {
            FetchCount++;
            LastSince = since;
            LastLimit = limit;
            return Task.FromResult(_snapshot);
        }
    }

    private sealed class ThrowingFeed : IVehicleCostFeed
    {
        public Task<VehicleCostSnapshot> FetchAsync(DateTimeOffset since, int limit, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");
    }

    private sealed class SubsystemMissingFeed : IVehicleCostFeed
    {
        public Task<VehicleCostSnapshot> FetchAsync(DateTimeOffset since, int limit, CancellationToken cancellationToken) =>
            throw new ApiException("vehicle-cost subsystem not configured", 503);
    }
}
