using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Diagnostics;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DBHealthPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/system/pages/DBHealthPage.tsx), the tolerant snake_case parsers, the view-model's four-state
/// matrix (loading / empty / error / success) across the three independent queries, the table-sort selection, and the
/// generated-client feed's request shaping (web <c>useDBStats</c> / <c>useMigrations</c> / <c>useConnectionPool</c>).
/// The WinUI view is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="DbHealthDisplay"/> flags asserted here.
/// </summary>
public sealed class DBHealthPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // The 41 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "dbHealth.autoRefresh", "dbHealth.chartTitle", "dbHealth.chartTitle.aria", "dbHealth.clean",
        "dbHealth.col.rows", "dbHealth.col.table", "dbHealth.currentVersion", "dbHealth.dirty", "dbHealth.error",
        "dbHealth.largeTables", "dbHealth.migration", "dbHealth.migrationTitle", "dbHealth.noMigrationData",
        "dbHealth.noMigrations", "dbHealth.noPoolData", "dbHealth.noTables", "dbHealth.pending", "dbHealth.pool.idle",
        "dbHealth.pool.inUse", "dbHealth.pool.maxOpen", "dbHealth.pool.open", "dbHealth.pool.waitCount",
        "dbHealth.pool.waitDuration", "dbHealth.poolTitle", "dbHealth.poolUsage", "dbHealth.recentMigrations",
        "dbHealth.rows", "dbHealth.sort.name", "dbHealth.sort.rows", "dbHealth.sort.size", "dbHealth.status",
        "dbHealth.subtitle", "dbHealth.table.indexes", "dbHealth.table.lastVacuum", "dbHealth.table.name",
        "dbHealth.table.rows", "dbHealth.table.size", "dbHealth.tables", "dbHealth.tablesTitle", "dbHealth.title",
        "dbHealth.totalSize",
    ];

    private static DbStatsSnapshot SampleStats(double databaseSize = 5L * 1024 * 1024 * 1024) => new(
        HasData: true,
        Tables:
        [
            new DbHealthTableInfo("signal_log", 1_500_000, null, null, null),
            new DbHealthTableInfo("drives", 42_000, null, null, null),
            new DbHealthTableInfo("charging_sessions", 8_100, null, null, null),
            new DbHealthTableInfo("alerts", 320, null, null, null),
        ],
        DatabaseSize: databaseSize);

    private static MigrationSnapshot SampleMigration(bool dirty = false, long pending = 0) => new(
        HasData: true,
        Version: "185",
        Dirty: dirty,
        Pending: pending,
        Migrations:
        [
            new DbHealthMigrationEntry("183", "add_tesla_unit_history", "2026-06-01T10:00:00Z"),
            new DbHealthMigrationEntry("184", "drop_legacy_telemetry", "2026-06-03T11:00:00Z"),
            new DbHealthMigrationEntry("185", "si_canonical", "2026-06-05T12:00:00Z"),
        ]);

    private static PoolSnapshot SamplePool() => new(
        HasData: true,
        HasMaxOpen: true,
        MaxOpen: 25,
        Open: 10,
        InUse: 5,
        Idle: 5,
        WaitCount: 2,
        WaitDurationMs: 1234);

    private static DbHealthModel SuccessModel(DbHealthSortKey sort = DbHealthSortKey.Size) => new(
        StatsLoading: false,
        StatsHasError: false,
        StatsError: null,
        Stats: SampleStats(),
        MigrationLoading: false,
        MigrationHasError: false,
        MigrationError: null,
        Migration: SampleMigration(),
        PoolLoading: false,
        Pool: SamplePool(),
        SortKey: sort);

    // ---- i18n key coverage (all 41 manifest strings) ------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = DbHealthProjection.Project(SuccessModel(), recorder, Now);

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
        _ = DbHealthProjection.Project(DbHealthModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_every_query_is_in_flight()
    {
        var display = DbHealthProjection.Project(DbHealthModel.Initial, Localizer, Now);

        Assert.Equal(DbHealthState.Loading, display.State);
        Assert.True(display.ChartLoading);
        Assert.True(display.TablesLoading);
        Assert.True(display.MigrationLoading);
        Assert.True(display.PoolLoading);
    }

    [Fact]
    public void State_success_when_data_present()
    {
        var display = DbHealthProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal(DbHealthState.Success, display.State);
        Assert.True(display.ChartHasData);
        Assert.True(display.TablesHasRows);
        Assert.True(display.MigrationHasData);
        Assert.True(display.PoolHasData);
        Assert.False(display.ShowErrorBanner);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_data()
    {
        var model = DbHealthModel.Initial with
        {
            StatsLoading = false,
            MigrationLoading = false,
            PoolLoading = false,
        };

        var display = DbHealthProjection.Project(model, Localizer, Now);

        Assert.Equal(DbHealthState.Empty, display.State);
        Assert.False(display.ChartHasData);
        Assert.False(display.TablesHasRows);
        Assert.False(display.MigrationHasData);
        Assert.False(display.PoolHasData);
    }

    [Fact]
    public void State_error_when_a_query_fails_and_the_banner_shows()
    {
        var model = SuccessModel() with
        {
            StatsHasError = true,
            StatsError = "boom",
            Stats = DbStatsSnapshot.Empty,
        };

        var display = DbHealthProjection.Project(model, Localizer, Now);

        Assert.Equal(DbHealthState.Error, display.State);
        Assert.True(display.ShowErrorBanner);
        Assert.Equal("Error loading data", display.ErrorBannerTitle);
        Assert.Equal("boom", display.ErrorBannerMessage);
    }

    // ---- Summary stat cards (panels 1-4) -------------------------------------------

    [Fact]
    public void StatCards_project_the_four_summary_metrics()
    {
        var display = DbHealthProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal(4, display.StatCards.Count);
        Assert.Equal("Total DB Size", display.StatCards[0].Label);
        Assert.Equal("5.00 GB", display.StatCards[0].Value);
        Assert.Equal("Tables", display.StatCards[1].Label);
        Assert.Equal("4", display.StatCards[1].Value);
        Assert.Equal("Large Tables (>100MB)", display.StatCards[2].Label);
        Assert.Equal("Migration Version", display.StatCards[3].Label);
        Assert.Equal("185", display.StatCards[3].Value);
    }

    [Theory]
    [InlineData(512.0, "512 B")]
    [InlineData(2048.0, "2.0 KB")]
    [InlineData(5242880.0, "5.0 MB")]
    [InlineData(2147483648.0, "2.00 GB")]
    public void FormatBytes_matches_the_web_page_local_contract(double bytes, string expected) =>
        Assert.Equal(expected, DbHealthProjection.FormatBytes(bytes));

    [Fact]
    public void Tables_stat_card_is_em_dash_while_loading()
    {
        var model = SuccessModel() with { StatsLoading = true };

        var display = DbHealthProjection.Project(model, Localizer, Now);

        Assert.Equal("\u2014", display.StatCards[1].Value);
    }

    [Fact]
    public void Large_tables_counts_only_tables_over_the_threshold()
    {
        var model = SuccessModel() with
        {
            Stats = new DbStatsSnapshot(
                HasData: true,
                Tables:
                [
                    new DbHealthTableInfo("big", 1, 200L * 1024 * 1024, null, null),
                    new DbHealthTableInfo("small", 1, 1024, null, null),
                ],
                DatabaseSize: 1024),
        };

        var display = DbHealthProjection.Project(model, Localizer, Now);

        Assert.Equal("1", display.StatCards[2].Value);
    }

    // ---- Bar chart (panel 5 + both chart parity items) -----------------------------

    [Fact]
    public void Chart_projects_up_to_fifteen_bars_sorted_by_row_count()
    {
        var tables = new List<DbHealthTableInfo>();
        for (var i = 0; i < 20; i++)
        {
            tables.Add(new DbHealthTableInfo($"t{i:00}", i * 1000, null, null, null));
        }

        var model = SuccessModel() with { Stats = new DbStatsSnapshot(true, tables, 0) };

        var display = DbHealthProjection.Project(model, Localizer, Now);

        Assert.Equal(15, display.Bars.Count);
        Assert.Equal("t19", display.Bars[0].Name); // highest row count first
        Assert.Equal(1.0, display.Bars[0].Ratio, 3);
        Assert.True(display.Bars[1].Ratio < display.Bars[0].Ratio);
    }

    [Fact]
    public void Chart_truncates_long_table_names()
    {
        var model = SuccessModel() with
        {
            Stats = new DbStatsSnapshot(
                true,
                [new DbHealthTableInfo("this_is_a_very_long_table_name_indeed", 10, null, null, null)],
                0),
        };

        var display = DbHealthProjection.Project(model, Localizer, Now);

        Assert.Equal("this_is_a_very_lon\u2026", display.Bars[0].Name);
    }

    // ---- Tables list panel (panel 6) + sort ----------------------------------------

    [Fact]
    public void Table_rows_sort_by_rows_descending()
    {
        var display = DbHealthProjection.Project(SuccessModel(DbHealthSortKey.Rows), Localizer, Now);

        Assert.Equal("signal_log", display.TableRows[0].Name);
        Assert.Equal("alerts", display.TableRows[^1].Name);
        Assert.Equal("1,500,000", display.TableRows[0].RowsText);
    }

    [Fact]
    public void Table_rows_sort_by_name_ascending()
    {
        var display = DbHealthProjection.Project(SuccessModel(DbHealthSortKey.Name), Localizer, Now);

        Assert.Equal("alerts", display.TableRows[0].Name);
        Assert.Equal("signal_log", display.TableRows[^1].Name);
    }

    [Fact]
    public void Table_cells_em_dash_absent_size_indexes_and_vacuum()
    {
        var display = DbHealthProjection.Project(SuccessModel(), Localizer, Now);
        var row = display.TableRows[0];

        Assert.Equal("\u2014", row.SizeText);
        Assert.Equal("\u2014", row.IndexesText);
        Assert.Equal("\u2014", row.LastVacuumText);
        Assert.False(row.IsLarge);
    }

    [Fact]
    public void Table_marks_large_tables()
    {
        var model = SuccessModel() with
        {
            Stats = new DbStatsSnapshot(
                true,
                [new DbHealthTableInfo("huge", 5, 500L * 1024 * 1024, 12, null)],
                0),
        };

        var display = DbHealthProjection.Project(model, Localizer, Now);

        Assert.True(display.TableRows[0].IsLarge);
        Assert.Equal("12", display.TableRows[0].IndexesText);
        Assert.Equal("500.0 MB", display.TableRows[0].SizeText);
    }

    // ---- Migration status panel (panel 7) ------------------------------------------

    [Fact]
    public void Migration_panel_projects_version_clean_status_and_recent_entries()
    {
        var display = DbHealthProjection.Project(SuccessModel(), Localizer, Now);

        Assert.True(display.MigrationHasData);
        Assert.Equal("185", display.CurrentVersionValue);
        Assert.False(display.StatusIsDirty);
        Assert.Equal("\u2713 Clean", display.StatusValue);
        Assert.False(display.ShowPending);
        Assert.True(display.ShowMigrationEntries);
        Assert.Equal(3, display.MigrationRows.Count);
        Assert.StartsWith("v185", display.MigrationRows[0].Label); // newest first
    }

    [Fact]
    public void Migration_panel_shows_dirty_and_pending()
    {
        var model = SuccessModel() with { Migration = SampleMigration(dirty: true, pending: 3) };

        var display = DbHealthProjection.Project(model, Localizer, Now);

        Assert.True(display.StatusIsDirty);
        Assert.Equal("\u26a0 Dirty", display.StatusValue);
        Assert.True(display.ShowPending);
        Assert.Equal("3", display.PendingValue);
    }

    [Fact]
    public void Migration_panel_empty_when_no_history()
    {
        var model = SuccessModel() with
        {
            Migration = new MigrationSnapshot(true, "185", false, 0, []),
        };

        var display = DbHealthProjection.Project(model, Localizer, Now);

        Assert.False(display.ShowMigrationEntries);
        Assert.Equal("No migration history available", display.NoMigrationsMessage);
    }

    // ---- Connection pool panel (panel 8) -------------------------------------------

    [Fact]
    public void Pool_panel_projects_six_metrics_and_usage()
    {
        var display = DbHealthProjection.Project(SuccessModel(), Localizer, Now);

        Assert.True(display.PoolHasData);
        Assert.Equal(6, display.PoolRows.Count);
        Assert.Equal("Max Open", display.PoolRows[0].Label);
        Assert.Equal("25", display.PoolRows[0].Value);
        Assert.Equal("1,234ms", display.PoolRows[5].Value);
        Assert.Equal("20%", display.PoolUsageValue); // 5 / 25 = 20%
        Assert.Equal(0.2, display.PoolUsageRatio, 3);
        Assert.False(display.PoolUsageHigh);
    }

    [Fact]
    public void Pool_usage_flags_high_utilisation()
    {
        var model = SuccessModel() with
        {
            Pool = new PoolSnapshot(true, true, 10, 9, 9, 1, 0, 0),
        };

        var display = DbHealthProjection.Project(model, Localizer, Now);

        Assert.Equal("90%", display.PoolUsageValue);
        Assert.True(display.PoolUsageHigh);
    }

    [Fact]
    public void Pool_panel_empty_when_max_open_absent()
    {
        var model = SuccessModel() with { Pool = PoolSnapshot.Empty };

        var display = DbHealthProjection.Project(model, Localizer, Now);

        Assert.False(display.PoolHasData);
        Assert.Equal("Connection pool data unavailable", display.NoPoolDataMessage);
    }

    // ---- Tolerant parsers (snake_case Go wire shape) -------------------------------

    [Fact]
    public void DbStatsSnapshot_parses_the_go_wire_shape()
    {
        var json = Json("{\"tables\":[{\"schema\":\"public\",\"name\":\"drives\",\"row_count\":42}],\"table_count\":1,\"database_size\":123456}");

        var snapshot = DbStatsSnapshot.FromJson(json);

        Assert.True(snapshot.HasData);
        var table = Assert.Single(snapshot.Tables);
        Assert.Equal("drives", table.Name);
        Assert.Equal(42, table.RowCount);
        Assert.Null(table.SizeBytes);
        Assert.Equal(123456, snapshot.DatabaseSize);
    }

    [Fact]
    public void MigrationSnapshot_parses_numeric_version_and_dirty()
    {
        var json = Json("{\"version\":185,\"dirty\":true}");

        var snapshot = MigrationSnapshot.FromJson(json);

        Assert.True(snapshot.HasData);
        Assert.Equal("185", snapshot.Version);
        Assert.True(snapshot.Dirty);
        Assert.Equal(0, snapshot.Pending);
        Assert.Empty(snapshot.Migrations);
    }

    [Fact]
    public void PoolSnapshot_parses_runtime_info_and_tolerates_missing_wait_duration()
    {
        var json = Json("{\"max_open\":25,\"open\":10,\"in_use\":5,\"idle\":5,\"wait_count\":2}");

        var snapshot = PoolSnapshot.FromJson(json);

        Assert.True(snapshot.HasMaxOpen);
        Assert.Equal(25, snapshot.MaxOpen);
        Assert.Equal(5, snapshot.InUse);
        Assert.Equal(0, snapshot.WaitDurationMs);
    }

    // ---- View-model four-state matrix ----------------------------------------------

    [Fact]
    public async Task ViewModel_success_populates_every_panel()
    {
        using var vm = new DBHealthPageViewModel(
            new FakeFeed(SampleStats(), SampleMigration(), SamplePool()), Localizer, () => Now);

        // initial state is loading until the first load resolves.
        Assert.Equal(DbHealthState.Loading, vm.State);

        await vm.LoadAsync();

        Assert.Equal(DbHealthState.Success, vm.State);
        Assert.True(vm.Display.TablesHasRows);
        Assert.True(vm.Display.MigrationHasData);
        Assert.True(vm.Display.PoolHasData);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_feed_resolves_every_empty_branch()
    {
        using var vm = new DBHealthPageViewModel(EmptyDbHealthFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DbHealthState.Empty, vm.State);
        Assert.False(vm.Display.TablesHasRows);
        Assert.False(vm.Display.MigrationHasData);
        Assert.False(vm.Display.PoolHasData);
        Assert.False(vm.Display.ShowErrorBanner);
    }

    [Fact]
    public async Task ViewModel_stats_failure_raises_the_error_banner()
    {
        var feed = new FakeFeed(SampleStats(), SampleMigration(), SamplePool())
        {
            StatsException = new InvalidOperationException("db down"),
        };
        using var vm = new DBHealthPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DbHealthState.Error, vm.State);
        Assert.True(vm.Display.ShowErrorBanner);
        Assert.Equal("db down", vm.Display.ErrorBannerMessage);
    }

    [Fact]
    public async Task ViewModel_pool_failure_renders_empty_pool_without_banner()
    {
        var feed = new FakeFeed(SampleStats(), SampleMigration(), SamplePool())
        {
            PoolException = new InvalidOperationException("pool down"),
        };
        using var vm = new DBHealthPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.False(vm.Display.PoolHasData);
        Assert.False(vm.Display.ShowErrorBanner); // web useConnectionPool surfaces no page-level error
    }

    [Fact]
    public async Task ViewModel_set_sort_reprojects_table_order()
    {
        using var vm = new DBHealthPageViewModel(
            new FakeFeed(SampleStats(), SampleMigration(), SamplePool()), Localizer, () => Now);
        await vm.LoadAsync();

        vm.SetSort(DbHealthSortKey.Name);

        Assert.Equal(DbHealthSortKey.Name, vm.SortKey);
        Assert.Equal("alerts", vm.Display.TableRows[0].Name);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_all_three_queries()
    {
        var feed = new FakeFeed(SampleStats(), SampleMigration(), SamplePool());
        using var vm = new DBHealthPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.StatsCount);
        Assert.Equal(2, feed.MigrationCount);
        Assert.Equal(2, feed.PoolCount);
    }

    // ---- Generated-client feed (web useDBStats / useMigrations / useConnectionPool) ----

    [Fact]
    public async Task ClientFeed_sends_the_db_stats_operation_with_no_params()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"tables\":[],\"table_count\":0,\"database_size\":0}"));
        var feed = new DbHealthClientFeed(api);

        var snapshot = await feed.FetchDbStatsAsync(default);

        Assert.True(snapshot.HasData);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_dev_tools_db_stats", request.OperationId);
        Assert.Null(request.Query);
        Assert.Null(request.PathParams);
        Assert.Null(request.Body);
    }

    [Fact]
    public async Task ClientFeed_sends_the_migration_status_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"version\":185,\"dirty\":false}"));
        var feed = new DbHealthClientFeed(api);

        _ = await feed.FetchMigrationAsync(default);

        Assert.Equal("get_api_v1_dev_tools_migration_status", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_sends_the_runtime_info_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"max_open\":25,\"open\":1,\"in_use\":0,\"idle\":1,\"wait_count\":0}"));
        var feed = new DbHealthClientFeed(api);

        _ = await feed.FetchPoolAsync(default);

        Assert.Equal("get_api_v1_dev_tools_runtime_info", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("server error", 500));
        var feed = new DbHealthClientFeed(api);

        var ex = await Assert.ThrowsAsync<ApiException>(() => feed.FetchDbStatsAsync(default));
        Assert.Equal(500, ex.StatusCode);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new DbHealthDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DBHealthPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("DBHealthDashboard", DbHealthRegistration.RouteName);
        Assert.Equal("get_api_v1_dev_tools_db_stats", DbHealthRegistration.DbStatsOperation);
        Assert.Equal("get_api_v1_dev_tools_migration_status", DbHealthRegistration.MigrationOperation);
        Assert.Equal("get_api_v1_dev_tools_runtime_info", DbHealthRegistration.PoolOperation);
        Assert.Equal("DB Health", DbHealthRegistration.Title(Localizer));
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

    private sealed class FakeFeed : IDbHealthFeed
    {
        private readonly DbStatsSnapshot _stats;
        private readonly MigrationSnapshot _migration;
        private readonly PoolSnapshot _pool;

        public FakeFeed(DbStatsSnapshot stats, MigrationSnapshot migration, PoolSnapshot pool)
        {
            _stats = stats;
            _migration = migration;
            _pool = pool;
        }

        public Exception? StatsException { get; init; }

        public Exception? MigrationException { get; init; }

        public Exception? PoolException { get; init; }

        public int StatsCount { get; private set; }

        public int MigrationCount { get; private set; }

        public int PoolCount { get; private set; }

        public Task<DbStatsSnapshot> FetchDbStatsAsync(CancellationToken cancellationToken)
        {
            StatsCount++;
            return StatsException is null ? Task.FromResult(_stats) : Task.FromException<DbStatsSnapshot>(StatsException);
        }

        public Task<MigrationSnapshot> FetchMigrationAsync(CancellationToken cancellationToken)
        {
            MigrationCount++;
            return MigrationException is null
                ? Task.FromResult(_migration)
                : Task.FromException<MigrationSnapshot>(MigrationException);
        }

        public Task<PoolSnapshot> FetchPoolAsync(CancellationToken cancellationToken)
        {
            PoolCount++;
            return PoolException is null ? Task.FromResult(_pool) : Task.FromException<PoolSnapshot>(PoolException);
        }
    }
}
