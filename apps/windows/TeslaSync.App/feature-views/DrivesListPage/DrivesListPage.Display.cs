using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The interactive URL-state the Drives-list page folds into a projection — the native analogue of the web page's
/// <c>useUrlState</c> bundle (date range, search, collection, trend metric, sort, page, bulk selection). Pure data so
/// the projection is asserted headlessly.
/// </summary>
/// <param name="StartDate">Inclusive range start day (<c>yyyy-MM-dd</c>) — web <c>from</c>.</param>
/// <param name="EndDate">Inclusive range end day (<c>yyyy-MM-dd</c>) — web <c>to</c>.</param>
/// <param name="Search">The raw search query (web <c>q</c>).</param>
/// <param name="Collection">The active collection (web <c>coll</c>).</param>
/// <param name="TrendMetric">The active trend metric key (web <c>trend</c>).</param>
/// <param name="SortField">The active sort field (web <c>sort</c>).</param>
/// <param name="Page">The 1-based display page (web <c>page</c>).</param>
/// <param name="SelectedIds">The currently bulk-selected drive ids (web <c>bulkSelected</c>).</param>
public sealed record DrivesListFilters(
    string StartDate,
    string EndDate,
    string Search,
    DriveCollectionKind Collection,
    string TrendMetric,
    DriveSortField SortField,
    int Page,
    IReadOnlySet<long> SelectedIds)
{
    /// <summary>The default filters: 30-day window ending today, all drives, date sort, page 1, no selection.</summary>
    /// <param name="now">The clock used for the default window.</param>
    public static DrivesListFilters Default(DateTimeOffset now) => new(
        now.AddDays(-30).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        string.Empty,
        DriveCollectionKind.All,
        "drives",
        DriveSortField.Date,
        1,
        new HashSet<long>());
}

/// <summary>One KPI metric tile in the overview card — the native analogue of a web <c>MetricCard</c>.</summary>
/// <param name="Key">Stable tile identity (drives / distance / driveTime / score / efficiency / cost).</param>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted headline value.</param>
/// <param name="AccentBrushKey">The design-token brush key for the accent rail.</param>
/// <param name="DeltaText">Optional pre-formatted delta caption versus the prior period.</param>
/// <param name="AutomationName">Narrator name folding the label + value.</param>
public sealed record DriveKpiCard(
    string Key,
    string Label,
    string Value,
    string AccentBrushKey,
    string DeltaText,
    string AutomationName);

/// <summary>The semantic tone of a drive-row badge (web <c>Badge variant</c>).</summary>
public enum DriveBadgeKind
{
    /// <summary>Informational (distance badge).</summary>
    Info,

    /// <summary>Warning (no telemetry).</summary>
    Warning,

    /// <summary>Success (in progress).</summary>
    Success,
}

/// <summary>
/// One fully projected drive row the list binds to — the native analogue of the web <c>DriveCard</c> /
/// <c>HistoryListRow</c>. Every value is already display-converted + localized so the view is a thin renderer.
/// </summary>
public sealed record DriveRowModel
{
    /// <summary>The drive id (row key + selection key).</summary>
    public required long Id { get; init; }

    /// <summary>Whether the row is bulk-selected.</summary>
    public required bool Selected { get; init; }

    /// <summary>The select-checkbox accessible name (web <c>drives.selectDrive</c>).</summary>
    public required string SelectAria { get; init; }

    /// <summary>The leading score-badge grade label.</summary>
    public required string ScoreLabel { get; init; }

    /// <summary>The leading score-badge grade hex colour.</summary>
    public required string ScoreColorHex { get; init; }

    /// <summary>The score-badge accessible name (web <c>drives.scoreAria</c>).</summary>
    public required string ScoreAria { get; init; }

    /// <summary>The time-of-day primary label.</summary>
    public required string TimeLabel { get; init; }

    /// <summary>The duration label (e.g. <c>34m</c>).</summary>
    public required string DurationLabel { get; init; }

    /// <summary>The primary status badge text (distance, no-telemetry or in-progress).</summary>
    public required string PrimaryBadgeText { get; init; }

    /// <summary>The primary status badge tone.</summary>
    public required DriveBadgeKind PrimaryBadgeKind { get; init; }

    /// <summary>True when the high-speed badge renders (web <c>maxSpeedMps &gt; 58.1152</c>).</summary>
    public required bool HighSpeed { get; init; }

    /// <summary>The high-speed badge label (web <c>drives.highSpeed</c>).</summary>
    public required string HighSpeedLabel { get; init; }

    /// <summary>True when the low-efficiency anomaly badge renders.</summary>
    public required bool IsAnomaly { get; init; }

    /// <summary>The low-efficiency anomaly badge label (web <c>drives.lowEfficiencyBadge</c>).</summary>
    public required string AnomalyLabel { get; init; }

    /// <summary>The route start address (for the route display).</summary>
    public required string RouteStartAddress { get; init; }

    /// <summary>The route start latitude, or null.</summary>
    public required double? RouteStartLat { get; init; }

    /// <summary>The route start longitude, or null.</summary>
    public required double? RouteStartLon { get; init; }

    /// <summary>The route end address (for the route display).</summary>
    public required string RouteEndAddress { get; init; }

    /// <summary>The route end latitude, or null.</summary>
    public required double? RouteEndLat { get; init; }

    /// <summary>The route end longitude, or null.</summary>
    public required double? RouteEndLon { get; init; }

    /// <summary>The "Avg {n} {unit}" metric text.</summary>
    public required string AvgText { get; init; }

    /// <summary>The "Max {n} {unit}" metric text, or null when no max speed.</summary>
    public required string? MaxText { get; init; }

    /// <summary>True when the battery-delta chip renders.</summary>
    public required bool HasBattery { get; init; }

    /// <summary>The battery start percent for the delta chip.</summary>
    public required double BatteryStartPct { get; init; }

    /// <summary>The battery end percent for the delta chip.</summary>
    public required double BatteryEndPct { get; init; }

    /// <summary>The "{eff} {unit}" efficiency metric text, or null when ungradable.</summary>
    public required string? EfficiencyText { get; init; }

    /// <summary>The efficiency metric hex colour (grade colour), or null.</summary>
    public required string? EfficiencyColorHex { get; init; }

    /// <summary>The "~{cost}" energy-cost metric text, or null when unavailable.</summary>
    public required string? CostText { get; init; }
}

/// <summary>One date-bucketed group in the drive list — the native analogue of a web <c>DateGroupedListGroup</c>.</summary>
/// <param name="DateKey">The <c>yyyy-MM-dd</c> bucket key.</param>
/// <param name="DateLabel">The long-form date label.</param>
/// <param name="Summary">The "{count} drives · {dist} {unit}" group summary.</param>
/// <param name="Rows">The drive rows in the group.</param>
public sealed record DriveDateGroup(string DateKey, string DateLabel, string Summary, IReadOnlyList<DriveRowModel> Rows);

/// <summary>
/// The fully projected, render-ready view of the Drives-list page for one drive snapshot + state + filters — the
/// native analogue of everything the web component computes before returning JSX. Every visible literal is resolved
/// here through the i18n facade (web key names, verbatim English defaults), so the WinUI page is a thin renderer and
/// the tests assert every string + state + computed value headlessly.
/// </summary>
public sealed record DrivesListDisplay
{
    /// <summary>The active lifecycle state.</summary>
    public required DrivesListState State { get; init; }

    /// <summary>The page title (web <c>drives.title</c>).</summary>
    public required string Title { get; init; }

    /// <summary>The page subtitle (web <c>drives.subtitle</c>).</summary>
    public required string Subtitle { get; init; }

    /// <summary>The sticky-summary accessible name (web <c>drives.stickyBar.aria</c>).</summary>
    public required string StickyAria { get; init; }

    /// <summary>The composed sticky-summary line (title · period · collection · results · avg score).</summary>
    public required string StickySummary { get; init; }

    /// <summary>The localized search hint shown in the search box.</summary>
    public required string SearchPrompt { get; init; }

    /// <summary>The "filtering…" pending label (web <c>filter.pending</c>).</summary>
    public required string FilterPendingLabel { get; init; }

    /// <summary>The active search-filter chip label (web <c>drives.filterLabel.search</c>).</summary>
    public required string FilterSearchLabel { get; init; }

    /// <summary>The active collection-filter chip label (web <c>drives.filterLabel.collection</c>).</summary>
    public required string FilterCollectionLabel { get; init; }

    /// <summary>True when the overview KPIs render (web <c>currentStats.count &gt; 0</c>).</summary>
    public required bool HasStats { get; init; }

    /// <summary>The overview card title (web <c>drives.overview</c>).</summary>
    public required string OverviewTitle { get; init; }

    /// <summary>The current-period label (preset · range).</summary>
    public required string PeriodLabel { get; init; }

    /// <summary>The prior-period label, or the "no prior data" line (web <c>drives.priorPeriod</c> / <c>noPriorData</c>).</summary>
    public required string PriorLabel { get; init; }

    /// <summary>The six overview KPI tiles (web MetricCards: Drives, Distance, Drive-time, Avg-score, Efficiency, Cost).</summary>
    public required IReadOnlyList<DriveKpiCard> KpiCards { get; init; }

    /// <summary>The secondary stats line (top speed · longest · avg trip · avg dur).</summary>
    public required string SecondaryLine { get; init; }

    /// <summary>The no-stats GlassPanel message (web <c>drives.noStatsRange</c>) — the 7th panel.</summary>
    public required string NoStatsMessage { get; init; }

    /// <summary>The anomaly callout text (web <c>drives.anomalyCount</c>), or empty when no callout.</summary>
    public required string AnomalyCallout { get; init; }

    /// <summary>The anomaly callout action label (web <c>drives.viewAnomalies</c>).</summary>
    public required string ViewAnomaliesLabel { get; init; }

    /// <summary>True when the anomaly callout is shown.</summary>
    public required bool HasAnomalyCallout { get; init; }

    /// <summary>The trend chart title (web <c>drives.overTime</c>).</summary>
    public required string TrendTitle { get; init; }

    /// <summary>The trend chart accessible name (web <c>drives.overTime.aria</c>).</summary>
    public required string TrendAria { get; init; }

    /// <summary>The trend chart empty message (web <c>drives.overTime.empty</c>).</summary>
    public required string TrendEmpty { get; init; }

    /// <summary>The five trend metric definitions in pill order (drives / distance / score / efficiency / cost).</summary>
    public required IReadOnlyList<MetricDefinition> TrendMetrics { get; init; }

    /// <summary>The per-metric trend series keyed by metric key.</summary>
    public required IReadOnlyDictionary<string, IReadOnlyList<MetricPoint>> TrendSeries { get; init; }

    /// <summary>The active trend metric key.</summary>
    public required string TrendActiveKey { get; init; }

    /// <summary>The collections pill bar accessible name (web <c>drives.collections.aria</c>).</summary>
    public required string CollectionsAria { get; init; }

    /// <summary>The collection pill options with live counts.</summary>
    public required IReadOnlyList<ComboOption> CollectionOptions { get; init; }

    /// <summary>The active collection value.</summary>
    public required string ActiveCollection { get; init; }

    /// <summary>The sort options (date / distance / efficiency).</summary>
    public required IReadOnlyList<ComboOption> SortOptions { get; init; }

    /// <summary>The active sort field value.</summary>
    public required string ActiveSort { get; init; }

    /// <summary>The sort-control accessible name (web <c>drives.sortByAria</c> for the active field).</summary>
    public required string SortAria { get; init; }

    /// <summary>The drive-list heading (web <c>drives.allDrives</c>).</summary>
    public required string ListHeading { get; init; }

    /// <summary>The date-grouped drive rows for the current page.</summary>
    public required IReadOnlyList<DriveDateGroup> Groups { get; init; }

    /// <summary>True when the list has rows on the current page.</summary>
    public required bool HasRows { get; init; }

    /// <summary>The empty-for-collection title (web <c>drives.emptyForCollection</c>).</summary>
    public required string EmptyForCollectionTitle { get; init; }

    /// <summary>The empty-for-collection message (web <c>drives.emptyForCollection.msg</c>).</summary>
    public required string EmptyForCollectionMessage { get; init; }

    /// <summary>The total filtered row count (drives the pager + results count).</summary>
    public required int TotalRowCount { get; init; }

    /// <summary>The "{n} results" label (web <c>drives.results</c>).</summary>
    public required string ResultsLabel { get; init; }

    /// <summary>The 1-based display page.</summary>
    public required int Page { get; init; }

    /// <summary>The display page size.</summary>
    public required int PageSize { get; init; }

    /// <summary>The bulk-delete action label (web <c>bulk.actions.delete</c>).</summary>
    public required string BulkDeleteLabel { get; init; }

    /// <summary>The bulk-delete confirm title (web <c>bulk.deleteConfirmTitle</c>).</summary>
    public required string BulkConfirmTitle { get; init; }

    /// <summary>The bulk-delete confirm description (web <c>bulk.deleteConfirmDescription</c>).</summary>
    public required string BulkConfirmDescription { get; init; }

    /// <summary>The confirm button label (web <c>common.delete</c>).</summary>
    public required string CommonDeleteLabel { get; init; }

    /// <summary>The number of bulk-selected rows.</summary>
    public required int SelectedCount { get; init; }

    /// <summary>The page-level empty title (web <c>drives.emptyTitle</c>).</summary>
    public required string EmptyTitle { get; init; }

    /// <summary>The page-level empty message (web <c>drives.emptyMessage</c>).</summary>
    public required string EmptyMessage { get; init; }

    /// <summary>The page-level empty call-to-action (web <c>drives.empty.cta</c>).</summary>
    public required string EmptyCta { get; init; }

    /// <summary>The generic "no data" label (web <c>common.noData</c>).</summary>
    public required string NoDataLabel { get; init; }
}
