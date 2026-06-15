using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DiskForecastPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/DiskForecastPage.tsx), the tolerant parsers, the view-model's four-state matrix
/// (loading / empty / error / success) with the distinct HTTP-503 subsystem-unavailable branch (web
/// <c>subsystemMissing</c>), and the generated-client feed's request shaping (web <c>useDiskForecast</c>). The WinUI
/// view is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="DiskForecastDisplay"/> flags asserted here.
/// </summary>
public sealed class DiskForecastPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 23 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "admin.diskForecast.chunkCount", "admin.diskForecast.colDays", "admin.diskForecast.colGrowth",
        "admin.diskForecast.colSeverity", "admin.diskForecast.colSplit", "admin.diskForecast.colTable",
        "admin.diskForecast.colTotal", "admin.diskForecast.compressedSuffix", "admin.diskForecast.emptyMessage",
        "admin.diskForecast.emptyTable", "admin.diskForecast.emptyTitle", "admin.diskForecast.fleetCompressed",
        "admin.diskForecast.fleetGrowth", "admin.diskForecast.fleetTotal", "admin.diskForecast.fleetUncompressed",
        "admin.diskForecast.growthSub", "admin.diskForecast.notConfigured", "admin.diskForecast.pageTitle",
        "admin.diskForecast.percentSub", "admin.diskForecast.subtitle", "admin.diskForecast.tableCount",
        "admin.diskForecast.tableTitle", "admin.subsystem.unavailableTitle",
    ];

    private const long Gib = 1024L * 1024L * 1024L;

    private static HypertableSize SampleRow(
        string name = "signal_log",
        long total = 5L * Gib,
        long uncompressed = 4L * Gib,
        long compressed = 1L * Gib,
        long chunks = 42,
        double growth = 1L * Gib,
        long? days = 30,
        string severity = "warn") => new(
        HypertableName: name,
        TotalBytes: total,
        UncompressedBytes: uncompressed,
        CompressedBytes: compressed,
        ChunkCount: chunks,
        GrowthBytesPerDay: growth,
        EstDaysToQuota: days,
        Severity: severity);

    private static DiskForecastModel SuccessModel(params HypertableSize[] rows) => new(
        Rows: rows.Length == 0 ? new[] { SampleRow() } : rows,
        Loading: false,
        HasError: false,
        ErrorDetail: null,
        SubsystemMissing: false);

    // ---- i18n key coverage (all 23 manifest strings) ------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = DiskForecastProjection.Project(SuccessModel(), recorder);

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
        _ = DiskForecastProjection.Project(DiskForecastModel.Initial, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = DiskForecastProjection.Project(DiskForecastModel.Initial, Localizer);

        Assert.Equal(DiskForecastState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowStats);
        Assert.False(display.ShowTablePanel);
        Assert.False(display.ShowError);
        Assert.False(display.ShowSubsystemUnavailable);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_rows()
    {
        var model = DiskForecastModel.Initial with { Loading = false };
        var display = DiskForecastProjection.Project(model, Localizer);

        Assert.Equal(DiskForecastState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.True(display.ShowTablePanel);
        Assert.False(display.ShowTable);
        Assert.False(display.ShowStats);
        Assert.False(display.ShowError);
        Assert.False(display.ShowSubsystemUnavailable);
        Assert.Equal("No hypertables", display.EmptyTitle);
        Assert.Equal(
            "No hypertables found in this database. The disk forecast surfaces TimescaleDB hypertables only.",
            display.EmptyMessage);
    }

    [Fact]
    public void State_error_subsystem_unavailable_is_the_503_banner()
    {
        var model = DiskForecastModel.Initial with { Loading = false, SubsystemMissing = true };
        var display = DiskForecastProjection.Project(model, Localizer);

        Assert.Equal(DiskForecastState.Error, display.State);
        Assert.True(display.ShowSubsystemUnavailable);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowStats);
        Assert.False(display.ShowTablePanel);
        Assert.Equal("Subsystem unavailable", display.SubsystemTitle);
        Assert.Equal(
            "TimescaleDB hypertable metrics are unavailable on this deployment. This page requires TimescaleDB to be installed and accessible.",
            display.SubsystemMessage);
    }

    [Fact]
    public void State_error_generic_failure_shows_retry()
    {
        var model = DiskForecastModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down" };
        var display = DiskForecastProjection.Project(model, Localizer);

        Assert.Equal(DiskForecastState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowSubsystemUnavailable);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowStats);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_when_rows_present()
    {
        var display = DiskForecastProjection.Project(SuccessModel(), Localizer);

        Assert.Equal(DiskForecastState.Success, display.State);
        Assert.True(display.ShowStats);
        Assert.True(display.ShowTablePanel);
        Assert.True(display.ShowTable);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowSubsystemUnavailable);
    }

    // ---- Panels: fleet-totals stat grid (4 StatCards) ------------------------------

    [Fact]
    public void Stats_total_card_sums_bytes_and_counts_hypertables()
    {
        var display = DiskForecastProjection.Project(
            SuccessModel(SampleRow(name: "a"), SampleRow(name: "b")),
            Localizer);

        Assert.Equal("Total disk", display.TotalCard.Label);
        Assert.Equal("10.0 GB", display.TotalCard.Value);
        Assert.Equal("2 hypertables", display.TotalCard.Sublabel);
    }

    [Fact]
    public void Stats_uncompressed_and_compressed_cards_show_percent_of_total()
    {
        var display = DiskForecastProjection.Project(SuccessModel(), Localizer);

        Assert.Equal("Uncompressed", display.UncompressedCard.Label);
        Assert.Equal("4.0 GB", display.UncompressedCard.Value);
        Assert.Equal("80.0% of total", display.UncompressedCard.Sublabel);

        Assert.Equal("Compressed", display.CompressedCard.Label);
        Assert.Equal("1.0 GB", display.CompressedCard.Value);
        Assert.Equal("20.0% of total", display.CompressedCard.Sublabel);
    }

    [Fact]
    public void Stats_growth_card_appends_per_day_suffix()
    {
        var display = DiskForecastProjection.Project(SuccessModel(), Localizer);

        Assert.Equal("Growth (per day)", display.GrowthCard.Label);
        Assert.Equal("1.0 GB/d", display.GrowthCard.Value);
        Assert.Equal("Sum across all hypertables", display.GrowthCard.Sublabel);
    }

    [Fact]
    public void Stats_percent_falls_back_to_em_dash_when_total_is_zero()
    {
        var zero = SampleRow(total: 0, uncompressed: 0, compressed: 0, growth: 0, days: null);
        var display = DiskForecastProjection.Project(SuccessModel(zero), Localizer);

        Assert.Equal(DiskForecastProjection.EmDash, display.UncompressedCard.Sublabel);
        Assert.Equal(DiskForecastProjection.EmDash, display.CompressedCard.Sublabel);
    }

    // ---- Panel: hypertables table (GlassPanel 5) -----------------------------------

    [Fact]
    public void Table_headers_use_the_web_column_labels()
    {
        var display = DiskForecastProjection.Project(SuccessModel(), Localizer);

        Assert.Equal("Hypertable", display.ColTable);
        Assert.Equal("Total", display.ColTotal);
        Assert.Equal("Uncompressed / compressed", display.ColSplit);
        Assert.Equal("Growth (per day)", display.ColGrowth);
        Assert.Equal("Days to quota", display.ColDays);
        Assert.Equal("Severity", display.ColSeverity);
        Assert.Equal("Hypertables", display.TableTitle);
    }

    [Fact]
    public void Table_row_projects_every_cell()
    {
        var display = DiskForecastProjection.Project(SuccessModel(), Localizer);

        var row = Assert.Single(display.Rows);
        Assert.Equal("signal_log", row.HypertableName);
        Assert.Equal("42 chunks", row.ChunkCountText);
        Assert.Equal("5.0 GB", row.TotalText);
        Assert.Equal("4.0 GB", row.UncompressedText);
        Assert.Equal("1.0 GB compressed", row.CompressedText);
        Assert.Equal("1.0 GB/d", row.GrowthText);
        Assert.Equal("30.00", row.DaysText);
        Assert.Equal("Warn", row.SeverityLabel);
        Assert.Equal(StatusKind.Warning, row.SeverityVariant);
    }

    [Fact]
    public void Table_days_falls_back_to_em_dash_when_null()
    {
        var display = DiskForecastProjection.Project(SuccessModel(SampleRow(days: null)), Localizer);

        Assert.Equal(DiskForecastProjection.EmDash, Assert.Single(display.Rows).DaysText);
    }

    [Theory]
    [InlineData("ok", "OK", StatusKind.Success)]
    [InlineData("warn", "Warn", StatusKind.Warning)]
    [InlineData("critical", "Critical", StatusKind.Danger)]
    [InlineData("unknown", "\u2014", StatusKind.Neutral)]
    [InlineData("", "\u2014", StatusKind.Neutral)]
    public void Table_severity_maps_label_and_variant(string severity, string expectedLabel, StatusKind expectedVariant)
    {
        var display = DiskForecastProjection.Project(SuccessModel(SampleRow(severity: severity)), Localizer);

        var row = Assert.Single(display.Rows);
        Assert.Equal(expectedLabel, row.SeverityLabel);
        Assert.Equal(expectedVariant, row.SeverityVariant);
    }

    // ---- formatBytes parity --------------------------------------------------------

    [Theory]
    [InlineData(0, "0 B")]
    [InlineData(512, "512 B")]
    [InlineData(1024, "1.0 KB")]
    [InlineData(1536, "1.5 KB")]
    [InlineData(1048576, "1.0 MB")]
    [InlineData(1073741824, "1.0 GB")]
    [InlineData(5368709120, "5.0 GB")]
    public void FormatBytes_matches_web(long bytes, string expected) =>
        Assert.Equal(expected, DiskForecastProjection.FormatBytes(bytes));

    [Fact]
    public void FormatBytes_sub_kib_prints_fractional_growth_verbatim() =>
        Assert.Equal("512.5 B", DiskForecastProjection.FormatBytes(512.5));

    [Fact]
    public void FormatDays_uses_grouping_at_two_decimals() =>
        Assert.Equal("1,234.00", DiskForecastProjection.FormatDays(1234));

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Snapshot_parse_reads_every_hypertable_field()
    {
        using var doc = JsonDocument.Parse(
            "{\"hypertables\":[{\"hypertable_name\":\"signal_log\",\"total_bytes\":5368709120," +
            "\"uncompressed_bytes\":4294967296,\"compressed_bytes\":1073741824,\"chunk_count\":42," +
            "\"growth_bytes_per_day\":1073741824,\"est_days_to_quota\":30,\"severity\":\"warn\"}]}");

        var snapshot = DiskForecastSnapshot.FromJson(doc.RootElement);

        var row = Assert.Single(snapshot.Hypertables);
        Assert.Equal("signal_log", row.HypertableName);
        Assert.Equal(5368709120L, row.TotalBytes);
        Assert.Equal(4294967296L, row.UncompressedBytes);
        Assert.Equal(1073741824L, row.CompressedBytes);
        Assert.Equal(42L, row.ChunkCount);
        Assert.Equal(1073741824.0, row.GrowthBytesPerDay);
        Assert.Equal(30L, row.EstDaysToQuota);
        Assert.Equal("warn", row.Severity);
    }

    [Fact]
    public void Snapshot_parse_is_tolerant_of_partial_rows_and_null_days()
    {
        using var doc = JsonDocument.Parse(
            "{\"hypertables\":[{\"hypertable_name\":\"positions\",\"total_bytes\":2048,\"est_days_to_quota\":null}]}");

        var row = Assert.Single(DiskForecastSnapshot.FromJson(doc.RootElement).Hypertables);
        Assert.Equal("positions", row.HypertableName);
        Assert.Equal(2048L, row.TotalBytes);
        Assert.Equal(0L, row.UncompressedBytes);
        Assert.Equal(0.0, row.GrowthBytesPerDay);
        Assert.Null(row.EstDaysToQuota);
        Assert.Equal(DiskForecastSeverity.Unknown, row.Severity);
    }

    [Fact]
    public void Snapshot_parse_treats_missing_or_non_array_hypertables_as_empty()
    {
        using var missing = JsonDocument.Parse("{\"other\":true}");
        Assert.Empty(DiskForecastSnapshot.FromJson(missing.RootElement).Hypertables);

        using var notObject = JsonDocument.Parse("null");
        Assert.Empty(DiskForecastSnapshot.FromJson(notObject.RootElement).Hypertables);

        using var notArray = JsonDocument.Parse("{\"hypertables\":42}");
        Assert.Empty(DiskForecastSnapshot.FromJson(notArray.RootElement).Hypertables);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_rows_into_the_success_state()
    {
        var feed = new FakeFeed(new DiskForecastSnapshot(new[] { SampleRow() }));
        using var vm = new DiskForecastPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(DiskForecastState.Success, vm.State);
        Assert.True(vm.Display.ShowStats);
        Assert.True(vm.Display.ShowTable);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new DiskForecastPageViewModel(EmptyDiskForecastFeed.Instance, Localizer);

        await vm.LoadAsync();

        Assert.Equal(DiskForecastState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_generic_error_state()
    {
        using var vm = new DiskForecastPageViewModel(new ThrowingFeed(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(DiskForecastState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.False(vm.Display.ShowSubsystemUnavailable);
        Assert.Contains("Failed to load data", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_http_503_is_the_subsystem_unavailable_branch()
    {
        using var vm = new DiskForecastPageViewModel(new SubsystemMissingFeed(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(DiskForecastState.Error, vm.State);
        Assert.True(vm.Display.ShowSubsystemUnavailable);
        Assert.False(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeFeed(new DiskForecastSnapshot(new[] { SampleRow() }));
        using var vm = new DiskForecastPageViewModel(feed, Localizer);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed (web useDiskForecast) -------------------------------

    [Fact]
    public async Task ClientFeed_sends_the_observability_operation_with_no_params()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"hypertables\":[]}"));
        var feed = new DiskForecastClientFeed(api);

        var snapshot = await feed.FetchAsync(default);

        Assert.Empty(snapshot.Hypertables);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_admin_observability_disk_forecast", request.OperationId);
        Assert.Null(request.Query);
        Assert.Null(request.PathParams);
        Assert.Null(request.Body);
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception_for_the_subsystem_branch()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("not configured", 503));
        var feed = new DiskForecastClientFeed(api);

        var ex = await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
        Assert.Equal(503, ex.StatusCode);
    }

    // ---- Diagnostics ---------------------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new DiskForecastDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DiskForecastPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operation()
    {
        Assert.Equal("DiskForecast", DiskForecastRegistration.RouteName);
        Assert.Equal("get_api_v1_admin_observability_disk_forecast", DiskForecastRegistration.Operation);
        Assert.Equal("Disk Forecast", DiskForecastRegistration.Title(Localizer));
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

    private sealed class FakeFeed : IDiskForecastFeed
    {
        private readonly DiskForecastSnapshot _snapshot;

        public FakeFeed(DiskForecastSnapshot snapshot) => _snapshot = snapshot;

        public int FetchCount { get; private set; }

        public Task<DiskForecastSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(_snapshot);
        }
    }

    private sealed class ThrowingFeed : IDiskForecastFeed
    {
        public Task<DiskForecastSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");
    }

    private sealed class SubsystemMissingFeed : IDiskForecastFeed
    {
        public Task<DiskForecastSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("disk-forecast subsystem not configured", 503);
    }
}
