using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Diagnostics;

/// <summary>
/// The mutually-exclusive top-level lifecycle state of the <c>DBHealthPage</c> surface — the native summary of the
/// four data states the web page renders (web/src/features/system/pages/DBHealthPage.tsx). The web page runs three
/// independent queries (<c>useDBStats</c>, <c>useMigrations</c>, <c>useConnectionPool</c>) and renders, per region,
/// loading shimmers, a top error banner (<c>queryError</c>), the populated panels, or per-panel empty states. This
/// enum is the single summary the ledger / Narrator key off; per-region visibility is still driven by the projected
/// flags so each branch renders exactly as the web composes it.
/// </summary>
public enum DbHealthState
{
    /// <summary>At least one query is in flight with nothing rendered yet (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>Everything resolved but no tables / migration / pool data was returned.</summary>
    Empty,

    /// <summary>A stats or migration query failed (web <c>queryError</c>) — the error banner shows.</summary>
    Error,

    /// <summary>At least one query produced data — the panels render.</summary>
    Success,
}

/// <summary>The table-list sort key (web <c>SortKey</c>): by size, by row count, or by name.</summary>
public enum DbHealthSortKey
{
    /// <summary>Sort by on-disk size, falling back to row count (web <c>'size'</c>).</summary>
    Size,

    /// <summary>Sort by row count (web <c>'rows'</c>).</summary>
    Rows,

    /// <summary>Sort by table name, ascending (web <c>'name'</c>).</summary>
    Name,
}

/// <summary>
/// One database table row — the native mirror of the web <c>TableInfo</c> (web/src/types/admin.ts). The Go API's
/// <c>/dev-tools/db-stats</c> returns only <c>name</c> + <c>row_count</c>; <see cref="SizeBytes"/>,
/// <see cref="IndexCount"/> and <see cref="LastVacuum"/> are optional (absent on the current backend) so the page's
/// null-safe branches (size / indexes / last-vacuum em-dash fallbacks, the &gt;100&#160;MB large-table highlight)
/// stay faithful. Pure data; parsing tolerates missing / null fields.
/// </summary>
public sealed record DbHealthTableInfo(string Name, long RowCount, long? SizeBytes, long? IndexCount, string? LastVacuum)
{
    /// <summary>Read one table row from a JSON object, tolerating missing / null fields.</summary>
    public static DbHealthTableInfo FromJson(JsonElement o) => new(
        Name: JsonReadHelpers.Str(o, "name") ?? string.Empty,
        RowCount: JsonReadHelpers.Long(o, "row_count") ?? 0,
        SizeBytes: JsonReadHelpers.Long(o, "size_bytes"),
        IndexCount: JsonReadHelpers.Long(o, "index_count"),
        LastVacuum: JsonReadHelpers.Str(o, "last_vacuum"));
}

/// <summary>
/// The database-statistics snapshot — the native mirror of the web <c>DBStats</c> response (<c>useDBStats</c>,
/// GET /dev-tools/db-stats): the <see cref="Tables"/> roll-up and the numeric <see cref="DatabaseSize"/> in bytes.
/// <see cref="HasData"/> records whether the server returned a stats object (the web <c>dbStats</c> presence test).
/// Pure data; parsing is null-tolerant.
/// </summary>
public sealed record DbStatsSnapshot(bool HasData, IReadOnlyList<DbHealthTableInfo> Tables, double DatabaseSize)
{
    /// <summary>The empty snapshot (no stats yet) — the default local-state feed result.</summary>
    public static DbStatsSnapshot Empty { get; } = new(false, [], 0);

    /// <summary>Read the stats body from JSON, tolerating missing / null fields.</summary>
    public static DbStatsSnapshot FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var tables = new List<DbHealthTableInfo>();
        if (o.TryGetProperty("tables", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in arr.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.Object)
                {
                    tables.Add(DbHealthTableInfo.FromJson(item));
                }
            }
        }

        return new DbStatsSnapshot(
            HasData: true,
            Tables: tables,
            DatabaseSize: JsonReadHelpers.Double(o, "database_size") ?? 0);
    }
}

/// <summary>
/// One applied migration — the native mirror of the web <c>MigrationInfo</c>: the <see cref="Version"/>,
/// <see cref="Name"/> and the optional <see cref="AppliedAt"/> stamp. Pure data; parsing tolerates missing fields.
/// </summary>
public sealed record DbHealthMigrationEntry(string Version, string Name, string? AppliedAt)
{
    /// <summary>Read one migration entry from a JSON object, tolerating missing / null fields.</summary>
    public static DbHealthMigrationEntry FromJson(JsonElement o) => new(
        Version: JsonReadHelpers.Str(o, "version") ?? (JsonReadHelpers.Long(o, "version")?.ToString(CultureInfo.InvariantCulture) ?? string.Empty),
        Name: JsonReadHelpers.Str(o, "name") ?? string.Empty,
        AppliedAt: JsonReadHelpers.Str(o, "applied_at"));
}

/// <summary>
/// The migration-status snapshot — the native mirror of the web <c>MigrationStatus</c> (<c>useMigrations</c>,
/// GET /dev-tools/migration-status). The Go API returns <c>{version, dirty}</c>; <see cref="Pending"/> and the
/// <see cref="Migrations"/> history are optional (absent on the current backend) so the page's
/// "no migration history" / pending branches stay faithful. <see cref="Version"/> resolves the web
/// <c>version ?? currentVersion</c> fallback (null when neither is present). Pure data; parsing is null-tolerant.
/// </summary>
public sealed record MigrationSnapshot(
    bool HasData,
    string? Version,
    bool Dirty,
    long Pending,
    IReadOnlyList<DbHealthMigrationEntry> Migrations)
{
    /// <summary>The empty snapshot (no migration data) — the default local-state feed result.</summary>
    public static MigrationSnapshot Empty { get; } = new(false, null, false, 0, []);

    /// <summary>Read the migration body from JSON, tolerating missing / null fields.</summary>
    public static MigrationSnapshot FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        // web migrationVersion = data.version ?? data.currentVersion ?? '—'; the backend returns a numeric version.
        string? version = JsonReadHelpers.Long(o, "version")?.ToString(CultureInfo.InvariantCulture)
            ?? JsonReadHelpers.Str(o, "version")
            ?? JsonReadHelpers.Str(o, "current_version");

        var migrations = new List<DbHealthMigrationEntry>();
        if (o.TryGetProperty("migrations", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in arr.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.Object)
                {
                    migrations.Add(DbHealthMigrationEntry.FromJson(item));
                }
            }
        }

        return new MigrationSnapshot(
            HasData: true,
            Version: version,
            Dirty: JsonReadHelpers.Bool(o, "dirty") ?? false,
            Pending: JsonReadHelpers.Long(o, "pending") ?? 0,
            Migrations: migrations);
    }
}

/// <summary>
/// The connection-pool snapshot — the native mirror of the web <c>ConnectionPool</c> (<c>useConnectionPool</c>,
/// GET /dev-tools/runtime-info). The Go API returns <c>max_open / open / in_use / idle / wait_count</c>;
/// <see cref="WaitDurationMs"/> is optional (absent on the current backend, web <c>waitDurationMs ?? 0</c>).
/// <see cref="HasMaxOpen"/> mirrors the web <c>pool?.maxOpen != null</c> render gate. Pure data; parsing is
/// null-tolerant.
/// </summary>
public sealed record PoolSnapshot(
    bool HasData,
    bool HasMaxOpen,
    long MaxOpen,
    long Open,
    long InUse,
    long Idle,
    long WaitCount,
    long WaitDurationMs)
{
    /// <summary>The empty snapshot (no pool data) — the default local-state feed result.</summary>
    public static PoolSnapshot Empty { get; } = new(false, false, 0, 0, 0, 0, 0, 0);

    /// <summary>Read the pool body from JSON, tolerating missing / null fields.</summary>
    public static PoolSnapshot FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        long? maxOpen = JsonReadHelpers.Long(o, "max_open");
        return new PoolSnapshot(
            HasData: true,
            HasMaxOpen: maxOpen is not null,
            MaxOpen: maxOpen ?? 0,
            Open: JsonReadHelpers.Long(o, "open") ?? 0,
            InUse: JsonReadHelpers.Long(o, "in_use") ?? 0,
            Idle: JsonReadHelpers.Long(o, "idle") ?? 0,
            WaitCount: JsonReadHelpers.Long(o, "wait_count") ?? 0,
            WaitDurationMs: JsonReadHelpers.Long(o, "wait_duration_ms") ?? 0);
    }
}

/// <summary>
/// The data port the <see cref="DBHealthPageViewModel"/> reads the three DB-health queries through — the native
/// parity of the web <c>useDBStats</c> / <c>useMigrations</c> / <c>useConnectionPool</c> hooks. The view never
/// performs HTTP itself; the default <see cref="EmptyDbHealthFeed"/> resolves to the empty states, and the
/// generated-client-backed <see cref="DbHealthClientFeed"/> binds to the generated OpenAPI contract client
/// (ADR-004). A failing fetch throws so the view-model can surface the error / empty branches exactly as the web
/// queries do.
/// </summary>
public interface IDbHealthFeed
{
    /// <summary>Resolve the database-statistics snapshot (web <c>useDBStats</c>).</summary>
    Task<DbStatsSnapshot> FetchDbStatsAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the migration-status snapshot (web <c>useMigrations</c>).</summary>
    Task<MigrationSnapshot> FetchMigrationAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the connection-pool snapshot (web <c>useConnectionPool</c>).</summary>
    Task<PoolSnapshot> FetchPoolAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every fetch to the empty snapshot (the empty data states).</summary>
public sealed class EmptyDbHealthFeed : IDbHealthFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyDbHealthFeed Instance { get; } = new();

    private EmptyDbHealthFeed()
    {
    }

    /// <inheritdoc />
    public Task<DbStatsSnapshot> FetchDbStatsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(DbStatsSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<MigrationSnapshot> FetchMigrationAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(MigrationSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<PoolSnapshot> FetchPoolAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(PoolSnapshot.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>DBHealthPage</c> projects from — the native analogue of the web page's three
/// resolved query states plus the local table-sort selection (web/src/features/system/pages/DBHealthPage.tsx). Pure
/// data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record DbHealthModel(
    bool StatsLoading,
    bool StatsHasError,
    string? StatsError,
    DbStatsSnapshot Stats,
    bool MigrationLoading,
    bool MigrationHasError,
    string? MigrationError,
    MigrationSnapshot Migration,
    bool PoolLoading,
    PoolSnapshot Pool,
    DbHealthSortKey SortKey)
{
    /// <summary>The initial model — the first load, every query in flight, default sort by size.</summary>
    public static DbHealthModel Initial { get; } = new(
        StatsLoading: true,
        StatsHasError: false,
        StatsError: null,
        Stats: DbStatsSnapshot.Empty,
        MigrationLoading: true,
        MigrationHasError: false,
        MigrationError: null,
        Migration: MigrationSnapshot.Empty,
        PoolLoading: true,
        Pool: PoolSnapshot.Empty,
        SortKey: DbHealthSortKey.Size);
}

/// <summary>One projected summary stat card (web <c>StatCard</c>): a Fluent glyph, a label and a formatted value.</summary>
public sealed record DbHealthStatCardDisplay(string Label, string Value, string Glyph);

/// <summary>One projected bar in the top-15 table-size chart: the (truncated) name, formatted row count and 0..1 ratio.</summary>
public sealed record DbHealthBarDisplay(string Name, string RowsValue, long RowCount, double Ratio, string AutomationName);

/// <summary>One projected table-list row (web DataTable row): the name + the four formatted columns + the large flag.</summary>
public sealed record DbHealthTableRowDisplay(
    string Name,
    string RowsText,
    string SizeText,
    string IndexesText,
    string LastVacuumText,
    bool IsLarge);

/// <summary>One projected recent-migration entry (web migration list row).</summary>
public sealed record DbHealthMigrationRowDisplay(string Label, string AppliedAtText, bool ShowAppliedAt);

/// <summary>One projected connection-pool metric row (web pool list row): a muted label and a formatted value.</summary>
public sealed record DbHealthPoolRowDisplay(string Label, string Value);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade and every count formatted at the display boundary.
/// Holds the always-visible header, the top error banner, the four summary stat cards (panels 1-4), the
/// table-size bar chart (panel 5 + its data view), the tables list panel (panel 6), the migration-status panel
/// (panel 7) and the connection-pool panel (panel 8). Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record DbHealthDisplay(
    DbHealthState State,
    string Title,
    string Subtitle,
    string AutoRefreshLabel,
    bool ShowErrorBanner,
    string ErrorBannerTitle,
    string ErrorBannerMessage,
    IReadOnlyList<DbHealthStatCardDisplay> StatCards,
    string ChartTitle,
    string ChartAriaLabel,
    string ChartTableColumnLabel,
    string ChartRowsColumnLabel,
    string RowsSeriesName,
    bool ChartLoading,
    bool ChartHasData,
    string ChartEmptyMessage,
    IReadOnlyList<DbHealthBarDisplay> Bars,
    string TablesTitle,
    string SortSizeLabel,
    string SortRowsLabel,
    string SortNameLabel,
    DbHealthSortKey ActiveSort,
    bool TablesLoading,
    string TableNameHeader,
    string TableRowsHeader,
    string TableSizeHeader,
    string TableIndexesHeader,
    string TableLastVacuumHeader,
    bool TablesHasRows,
    string TablesEmptyMessage,
    IReadOnlyList<DbHealthTableRowDisplay> TableRows,
    string MigrationTitle,
    bool MigrationLoading,
    bool MigrationHasData,
    string CurrentVersionLabel,
    string CurrentVersionValue,
    string StatusLabel,
    string StatusValue,
    bool StatusIsDirty,
    bool ShowPending,
    string PendingLabel,
    string PendingValue,
    string RecentMigrationsLabel,
    bool ShowMigrationEntries,
    IReadOnlyList<DbHealthMigrationRowDisplay> MigrationRows,
    string NoMigrationsMessage,
    string NoMigrationDataMessage,
    string PoolTitle,
    bool PoolLoading,
    bool PoolHasData,
    IReadOnlyList<DbHealthPoolRowDisplay> PoolRows,
    string PoolUsageLabel,
    string PoolUsageValue,
    double PoolUsageRatio,
    bool PoolUsageHigh,
    string NoPoolDataMessage,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="DbHealthModel"/> to its <see cref="DbHealthDisplay"/> — the native port of the
/// render logic in web/src/features/system/pages/DBHealthPage.tsx. Every visible literal resolves through the i18n
/// facade using the exact web key names; counts format through <see cref="NumberFormatting"/> (web <c>fmtInt</c>),
/// bytes through the page-local <c>formatBytes</c> contract, and the recent-migration / last-vacuum stamps through
/// <see cref="DateTimeFormatting"/> (web <c>TimeStamp</c>). Every chrome string is resolved on every projection
/// (visibility is gated by the returned flags) so the i18n contract holds in every data state. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class DbHealthProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    /// <summary>The web large-table threshold: 100&#160;MB (web <c>LARGE_TABLE_THRESHOLD</c>).</summary>
    public const long LargeTableThreshold = 100L * 1024 * 1024;

    private const int ChartTableCount = 15;
    private const int RecentMigrationCount = 5;

    private const string DatabaseGlyph = "\uE9F5"; // Segoe Fluent — Database/Storage
    private const string WarningGlyph = "\uE7BA";  // Segoe Fluent — Warning
    private const string CheckGlyph = "\uE73E";    // Segoe Fluent — Completed

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the three resolved web query states + sort selection).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for timestamp formatting.</param>
    public static DbHealthDisplay Project(DbHealthModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Header (web PageContainer title + subtitle + auto-refresh action) ───────────────────────────────
        string title = localizer.GetString("dbHealth.title", "DB Health");
        string subtitle = localizer.GetString("dbHealth.subtitle", "Database health metrics and table statistics");
        string autoRefresh = localizer.GetString("dbHealth.autoRefresh", "Auto-refresh 30s");

        // ── Top error banner (web queryError AlertBanner, danger) ───────────────────────────────────────────
        bool showErrorBanner = model.StatsHasError || model.MigrationHasError;
        string errorTitle = localizer.GetString("dbHealth.error", "Error loading data");
        string errorMessage = model.StatsError ?? model.MigrationError ?? errorTitle;

        var tables = model.Stats.Tables;

        // ── Summary stat cards (web StatCard ×4) ────────────────────────────────────────────────────────────
        string totalSizeLabel = localizer.GetString("dbHealth.totalSize", "Total DB Size");
        string tablesLabel = localizer.GetString("dbHealth.tables", "Tables");
        string largeTablesLabel = localizer.GetString("dbHealth.largeTables", "Large Tables (>100MB)");
        string migrationLabel = localizer.GetString("dbHealth.migration", "Migration Version");

        string dbSizeDisplay = model.Stats.HasData ? FormatBytes(model.Stats.DatabaseSize) : EmDash;
        string tablesCount = model.StatsLoading ? EmDash : tables.Count.ToString(CultureInfo.InvariantCulture);
        long largeTables = tables.Count(t => (t.SizeBytes ?? 0) > LargeTableThreshold);
        string migrationVersion = model.Migration.Version ?? EmDash;

        var statCards = new List<DbHealthStatCardDisplay>
        {
            new(totalSizeLabel, dbSizeDisplay, DatabaseGlyph),
            new(tablesLabel, tablesCount, DatabaseGlyph),
            new(largeTablesLabel, largeTables.ToString(CultureInfo.InvariantCulture), WarningGlyph),
            new(migrationLabel, migrationVersion, CheckGlyph),
        };

        // ── Table-size bar chart (web ChartContainer + BarChart, top 15 by row count) ───────────────────────
        string chartTitle = localizer.GetString("dbHealth.chartTitle", "Table Sizes (Top 15)");
        string chartAria = localizer.GetString(
            "dbHealth.chartTitle.aria", "Top fifteen database table sizes horizontal bar chart");
        string colTable = localizer.GetString("dbHealth.col.table", "Table");
        string colRows = localizer.GetString("dbHealth.col.rows", "Rows");
        string rowsSeriesName = localizer.GetString("dbHealth.rows", "Rows");

        var bars = BuildBars(tables);

        // ── Tables list panel (web GlassPanel + sort control + DataTable) ───────────────────────────────────
        string tablesTitle = localizer.GetString("dbHealth.tablesTitle", "Tables");
        string sortSize = localizer.GetString("dbHealth.sort.size", "Size");
        string sortRows = localizer.GetString("dbHealth.sort.rows", "Rows");
        string sortName = localizer.GetString("dbHealth.sort.name", "Name");
        string tableNameHeader = localizer.GetString("dbHealth.table.name", "Table");
        string tableRowsHeader = localizer.GetString("dbHealth.table.rows", "Rows");
        string tableSizeHeader = localizer.GetString("dbHealth.table.size", "Size");
        string tableIndexesHeader = localizer.GetString("dbHealth.table.indexes", "Indexes");
        string tableLastVacuumHeader = localizer.GetString("dbHealth.table.lastVacuum", "Last Vacuum");
        string noTables = localizer.GetString("dbHealth.noTables", "No tables found");

        var tableRows = BuildTableRows(tables, model.SortKey);

        // ── Migration-status panel (web GlassPanel) ─────────────────────────────────────────────────────────
        string migrationTitle = localizer.GetString("dbHealth.migrationTitle", "Migration Status");
        string currentVersionLabel = localizer.GetString("dbHealth.currentVersion", "Current Version");
        string statusLabel = localizer.GetString("dbHealth.status", "Status");
        string dirtyText = localizer.GetString("dbHealth.dirty", "\u26a0 Dirty");
        string cleanText = localizer.GetString("dbHealth.clean", "\u2713 Clean");
        string pendingLabel = localizer.GetString("dbHealth.pending", "Pending");
        string recentMigrationsLabel = localizer.GetString("dbHealth.recentMigrations", "Recent Migrations");
        string noMigrations = localizer.GetString("dbHealth.noMigrations", "No migration history available");
        string noMigrationData = localizer.GetString("dbHealth.noMigrationData", "Migration data unavailable");

        bool migrationDirty = model.Migration.Dirty;
        long migrationPending = model.Migration.Pending;
        var migrationRows = BuildMigrationRows(model.Migration.Migrations, now);

        // ── Connection-pool panel (web GlassPanel) ──────────────────────────────────────────────────────────
        string poolTitle = localizer.GetString("dbHealth.poolTitle", "Connection Pool");
        string poolMaxOpen = localizer.GetString("dbHealth.pool.maxOpen", "Max Open");
        string poolOpen = localizer.GetString("dbHealth.pool.open", "Open");
        string poolInUse = localizer.GetString("dbHealth.pool.inUse", "In Use");
        string poolIdle = localizer.GetString("dbHealth.pool.idle", "Idle");
        string poolWaitCount = localizer.GetString("dbHealth.pool.waitCount", "Wait Count");
        string poolWaitDuration = localizer.GetString("dbHealth.pool.waitDuration", "Wait Duration");
        string poolUsageLabel = localizer.GetString("dbHealth.poolUsage", "Pool Usage");
        string noPoolData = localizer.GetString("dbHealth.noPoolData", "Connection pool data unavailable");

        var pool = model.Pool;
        var poolRows = new List<DbHealthPoolRowDisplay>
        {
            new(poolMaxOpen, pool.MaxOpen.ToString(CultureInfo.InvariantCulture)),
            new(poolOpen, pool.Open.ToString(CultureInfo.InvariantCulture)),
            new(poolInUse, pool.InUse.ToString(CultureInfo.InvariantCulture)),
            new(poolIdle, pool.Idle.ToString(CultureInfo.InvariantCulture)),
            new(poolWaitCount, pool.WaitCount.ToString(CultureInfo.InvariantCulture)),
            new(poolWaitDuration, $"{FormatInt(pool.WaitDurationMs)}ms"),
        };

        double poolUsage = pool.HasMaxOpen && pool.MaxOpen > 0
            ? Math.Min((double)pool.InUse / pool.MaxOpen * 100.0, 100.0)
            : 0.0;
        string poolUsageValue = $"{FormatInt((long)Math.Round(poolUsage, MidpointRounding.AwayFromZero))}%";

        // ── Top-level state summary ─────────────────────────────────────────────────────────────────────────
        bool anyLoading = model.StatsLoading || model.MigrationLoading || model.PoolLoading;
        bool anyError = model.StatsHasError || model.MigrationHasError;
        bool anyData = model.Stats.HasData || model.Migration.HasData || pool.HasData;
        DbHealthState state = anyError
            ? DbHealthState.Error
            : anyLoading
                ? DbHealthState.Loading
                : anyData
                    ? DbHealthState.Success
                    : DbHealthState.Empty;

        return new DbHealthDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            AutoRefreshLabel: autoRefresh,
            ShowErrorBanner: showErrorBanner,
            ErrorBannerTitle: errorTitle,
            ErrorBannerMessage: errorMessage,
            StatCards: statCards,
            ChartTitle: chartTitle,
            ChartAriaLabel: chartAria,
            ChartTableColumnLabel: colTable,
            ChartRowsColumnLabel: colRows,
            RowsSeriesName: rowsSeriesName,
            ChartLoading: model.StatsLoading,
            ChartHasData: bars.Count > 0,
            ChartEmptyMessage: noTables,
            Bars: bars,
            TablesTitle: tablesTitle,
            SortSizeLabel: sortSize,
            SortRowsLabel: sortRows,
            SortNameLabel: sortName,
            ActiveSort: model.SortKey,
            TablesLoading: model.StatsLoading,
            TableNameHeader: tableNameHeader,
            TableRowsHeader: tableRowsHeader,
            TableSizeHeader: tableSizeHeader,
            TableIndexesHeader: tableIndexesHeader,
            TableLastVacuumHeader: tableLastVacuumHeader,
            TablesHasRows: tableRows.Count > 0,
            TablesEmptyMessage: noTables,
            TableRows: tableRows,
            MigrationTitle: migrationTitle,
            MigrationLoading: model.MigrationLoading,
            MigrationHasData: model.Migration.HasData,
            CurrentVersionLabel: currentVersionLabel,
            CurrentVersionValue: migrationVersion,
            StatusLabel: statusLabel,
            StatusValue: migrationDirty ? dirtyText : cleanText,
            StatusIsDirty: migrationDirty,
            ShowPending: migrationPending > 0,
            PendingLabel: pendingLabel,
            PendingValue: migrationPending.ToString(CultureInfo.InvariantCulture),
            RecentMigrationsLabel: recentMigrationsLabel,
            ShowMigrationEntries: migrationRows.Count > 0,
            MigrationRows: migrationRows,
            NoMigrationsMessage: noMigrations,
            NoMigrationDataMessage: noMigrationData,
            PoolTitle: poolTitle,
            PoolLoading: model.PoolLoading,
            PoolHasData: pool.HasMaxOpen,
            PoolRows: poolRows,
            PoolUsageLabel: poolUsageLabel,
            PoolUsageValue: poolUsageValue,
            PoolUsageRatio: Math.Clamp(poolUsage / 100.0, 0.0, 1.0),
            PoolUsageHigh: poolUsage >= 80.0,
            NoPoolDataMessage: noPoolData,
            AutomationName: title);
    }

    /// <summary>Format a count with en-US grouping (web <c>fmtInt</c>).</summary>
    public static string FormatInt(long value) => NumberFormatting.Format(value, null, 0);

    /// <summary>
    /// Format a byte count — the 1:1 port of the page-local <c>formatBytes</c> in DBHealthPage.tsx
    /// (B exact, KB/MB at one decimal, GB at two decimals; no grouping, matching <c>toFixed</c>).
    /// </summary>
    public static string FormatBytes(double bytes)
    {
        if (bytes < 1024)
        {
            return $"{((long)bytes).ToString(CultureInfo.InvariantCulture)} B";
        }

        if (bytes < 1024 * 1024)
        {
            return $"{(bytes / 1024).ToString("F1", CultureInfo.InvariantCulture)} KB";
        }

        if (bytes < 1024 * 1024 * 1024)
        {
            return $"{(bytes / (1024 * 1024)).ToString("F1", CultureInfo.InvariantCulture)} MB";
        }

        return $"{(bytes / (1024d * 1024 * 1024)).ToString("F2", CultureInfo.InvariantCulture)} GB";
    }

    // web chartData: top 15 tables by row count, names > 20 chars truncated to 18 + ellipsis.
    private static List<DbHealthBarDisplay> BuildBars(IReadOnlyList<DbHealthTableInfo> tables)
    {
        var top = tables
            .OrderByDescending(t => t.RowCount)
            .Take(ChartTableCount)
            .ToList();

        long max = top.Count > 0 ? Math.Max(1, top.Max(t => t.RowCount)) : 1;

        var bars = new List<DbHealthBarDisplay>(top.Count);
        foreach (var table in top)
        {
            string name = table.Name.Length > 20 ? table.Name[..18] + "\u2026" : table.Name;
            string rowsValue = FormatInt(table.RowCount);
            double ratio = Math.Clamp((double)table.RowCount / max, 0.0, 1.0);
            bars.Add(new DbHealthBarDisplay(name, rowsValue, table.RowCount, ratio, $"{name}: {rowsValue}"));
        }

        return bars;
    }

    // web sortedTables: stable copy ordered by the active sort key.
    private static List<DbHealthTableRowDisplay> BuildTableRows(
        IReadOnlyList<DbHealthTableInfo> tables, DbHealthSortKey sortKey)
    {
        IEnumerable<DbHealthTableInfo> sorted = sortKey switch
        {
            // web: (b.sizeBytes ?? b.rowCount) - (a.sizeBytes ?? a.rowCount), descending.
            DbHealthSortKey.Size => tables.OrderByDescending(t => (double)(t.SizeBytes ?? t.RowCount)),
            DbHealthSortKey.Rows => tables.OrderByDescending(t => t.RowCount),
            _ => tables.OrderBy(t => t.Name, StringComparer.Ordinal),
        };

        var rows = new List<DbHealthTableRowDisplay>();
        foreach (var table in sorted)
        {
            bool isLarge = (table.SizeBytes ?? 0) > LargeTableThreshold;
            rows.Add(new DbHealthTableRowDisplay(
                Name: table.Name,
                RowsText: FormatInt(table.RowCount),
                SizeText: table.SizeBytes is { } size ? FormatBytes(size) : EmDash,
                IndexesText: table.IndexCount?.ToString(CultureInfo.InvariantCulture) ?? EmDash,
                LastVacuumText: FormatTimestamp(table.LastVacuum, now: null),
                IsLarge: isLarge));
        }

        return rows;
    }

    // web migrations.slice(-5).reverse(): the five most recent applied migrations, newest first.
    private static List<DbHealthMigrationRowDisplay> BuildMigrationRows(
        IReadOnlyList<DbHealthMigrationEntry> migrations, DateTimeOffset now)
    {
        var recent = migrations
            .Skip(Math.Max(0, migrations.Count - RecentMigrationCount))
            .Reverse()
            .ToList();

        var rows = new List<DbHealthMigrationRowDisplay>(recent.Count);
        foreach (var entry in recent)
        {
            string label = string.IsNullOrEmpty(entry.Name)
                ? $"v{entry.Version}"
                : $"v{entry.Version} {entry.Name}";
            string when = FormatTimestamp(entry.AppliedAt, now);
            rows.Add(new DbHealthMigrationRowDisplay(label, when, when != EmDash));
        }

        return rows;
    }

    // web TimeStamp: an absolute date-time, or the em-dash fallback for missing / unparseable input.
    private static string FormatTimestamp(string? raw, DateTimeOffset? now)
    {
        if (!string.IsNullOrWhiteSpace(raw) && DateTimeOffset.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var value))
        {
            return DateTimeFormatting.Format(value, DateTimeVariant.Full, now ?? DateTimeOffset.Now);
        }

        return EmDash;
    }
}

/// <summary>
/// Canonical metadata for the <c>DBHealthPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/system/pages/DBHealthPage.tsx</c> (route <c>/db-health</c>, nav name
/// <c>DBHealthDashboard</c>).
/// </summary>
public static class DbHealthRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DBHealthPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>DBHealthDashboard</c>).</summary>
    public const string RouteName = "DBHealthDashboard";

    /// <summary>The generated OpenAPI operation id for the database-statistics query (web <c>useDBStats</c>).</summary>
    public const string DbStatsOperation = "get_api_v1_dev_tools_db_stats";

    /// <summary>The generated OpenAPI operation id for the migration-status query (web <c>useMigrations</c>).</summary>
    public const string MigrationOperation = "get_api_v1_dev_tools_migration_status";

    /// <summary>The generated OpenAPI operation id for the connection-pool query (web <c>useConnectionPool</c>).</summary>
    public const string PoolOperation = "get_api_v1_dev_tools_runtime_info";

    /// <summary>The localized page title (web <c>dbHealth.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("dbHealth.title", "DB Health");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>DBHealthPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a table name, row count or migration version —
/// so a diagnostics line can never leak schema content. Thread-safe.
/// </summary>
public sealed class DbHealthDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DbHealthDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DBHealthPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DbHealthRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers shared by the <c>DBHealthPage</c> snapshots. Mirrors the per-page
/// helper used by the sibling W7 surfaces (one definition per feature namespace) so the snake_case Go wire shape is
/// preserved losslessly and a partial / null payload never throws.
/// </summary>
internal static class JsonReadHelpers
{
    public static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static long? Long(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.Number when v.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static double? Double(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var d) => d,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static bool? Bool(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }
}
