using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The interactive URL-state the Charging-list page folds into a projection — the native analogue of the web
/// page's <c>useUrlState</c> bundle (date range, search, collection, trend metric, sort, density, page). Pure data
/// so the projection is asserted headlessly.
/// </summary>
/// <param name="StartDate">Inclusive range start day (<c>yyyy-MM-dd</c>) — web <c>from</c>.</param>
/// <param name="EndDate">Inclusive range end day (<c>yyyy-MM-dd</c>) — web <c>to</c>.</param>
/// <param name="Search">The raw search query (web <c>q</c>).</param>
/// <param name="Collection">The active collection (web <c>coll</c>).</param>
/// <param name="TrendMetric">The active trend metric key (web <c>trend</c>).</param>
/// <param name="SortField">The active sort field (web <c>sort</c>).</param>
/// <param name="SortDescending">Whether the sort is descending (web <c>sort_desc</c>).</param>
/// <param name="Density">The list density (web <c>density</c>).</param>
/// <param name="Page">The 1-based display page (web <c>page</c>).</param>
/// <param name="SelectedIds">The currently bulk-selected session ids (web <c>bulkSelected</c>).</param>
public sealed record ChargingListFilters(
    string StartDate,
    string EndDate,
    string Search,
    ChargingCollectionKind Collection,
    string TrendMetric,
    ChargingSortField SortField,
    bool SortDescending,
    ChargingCardDensity Density,
    int Page,
    IReadOnlySet<long> SelectedIds)
{
    /// <summary>The default filters: 30-day window ending today, all sessions, date-descending.</summary>
    /// <param name="now">The clock used for the default window.</param>
    public static ChargingListFilters Default(DateTimeOffset now) => new(
        now.AddDays(-30).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        string.Empty,
        ChargingCollectionKind.All,
        "sessions",
        ChargingSortField.Date,
        true,
        ChargingCardDensity.Comfortable,
        1,
        new HashSet<long>());
}

/// <summary>One KPI metric tile in the overview card — the native analogue of a web <c>MetricCard</c>.</summary>
/// <param name="Key">Stable tile identity (sessions / energy / cost / rate / duration / power).</param>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted headline value.</param>
/// <param name="AccentBrushKey">The design-token brush key for the accent rail.</param>
/// <param name="DeltaText">Optional pre-formatted delta caption versus the prior period.</param>
/// <param name="AutomationName">Narrator name folding the label + value.</param>
public sealed record ChargingKpiCard(
    string Key,
    string Label,
    string Value,
    string AccentBrushKey,
    string DeltaText,
    string AutomationName);

/// <summary>One projected session row the list binds to — wraps the card model with its stable id + selection flag.</summary>
/// <param name="Id">The session id (row key + selection key).</param>
/// <param name="Card">The card render model.</param>
/// <param name="Selected">Whether the row is bulk-selected.</param>
public sealed record ChargingSessionRow(long Id, ChargingSessionCardModel Card, bool Selected);

/// <summary>One date-bucketed group in the session list — the native analogue of a web <c>DateGroupedListGroup</c>.</summary>
/// <param name="DateKey">The <c>yyyy-MM-dd</c> bucket key.</param>
/// <param name="DateLabel">The long-form date label.</param>
/// <param name="Summary">The "{count} sessions · {kWh} kWh" group summary.</param>
/// <param name="Rows">The session rows in the group.</param>
public sealed record ChargingDateGroup(string DateKey, string DateLabel, string Summary, IReadOnlyList<ChargingSessionRow> Rows);

/// <summary>One bar in the battery start-level distribution mini-view.</summary>
/// <param name="Label">The bucket label (e.g. <c>20–30%</c>).</param>
/// <param name="Count">The session count in the bucket.</param>
/// <param name="Ratio">Share of the largest bucket, 0..1.</param>
public sealed record ChargingBucketBar(string Label, long Count, double Ratio);

/// <summary>One row in the charger-specs mini-view.</summary>
/// <param name="Label">The charger category label.</param>
/// <param name="Detail">The pre-formatted "{count} · avg {kW} kW · max {kW} kW" detail.</param>
public sealed record ChargingSpecRow(string Label, string Detail);

/// <summary>
/// One projected conditional analytical section — the native analogue of the web threshold-gated sections
/// (battery start-level distribution, charger specs, optimizer). Carries its localized title + description and
/// either a populated mini-view (bars / specs) or the threshold / empty message the web <c>EmptyStateThreshold</c>
/// shows below the data threshold.
/// </summary>
/// <param name="Key">Stable section identity (batteryDist / specs / optimizer).</param>
/// <param name="Title">The localized section title.</param>
/// <param name="Description">The localized section description.</param>
/// <param name="HasData">True when the populated mini-view renders; false shows the empty / threshold message.</param>
/// <param name="EmptyMessage">The threshold / empty message shown when <paramref name="HasData"/> is false.</param>
/// <param name="Bars">The distribution bars (battery section), else empty.</param>
/// <param name="Specs">The spec rows (specs section), else empty.</param>
public sealed record ChargingSectionDisplay(
    string Key,
    string Title,
    string Description,
    bool HasData,
    string EmptyMessage,
    IReadOnlyList<ChargingBucketBar> Bars,
    IReadOnlyList<ChargingSpecRow> Specs);

/// <summary>
/// The fully projected, render-ready view of the Charging-list page for one session snapshot + state + filters —
/// the native analogue of everything the web component computes before returning JSX. Every visible literal is
/// resolved here through the i18n facade (web key names, verbatim English defaults), so the WinUI page is a thin
/// renderer and the tests assert every string + state + computed value headlessly.
/// </summary>
public sealed record ChargingListDisplay
{
    /// <summary>The active lifecycle state.</summary>
    public required ChargingListState State { get; init; }

    /// <summary>The page title (web <c>charging.list.title</c>).</summary>
    public required string Title { get; init; }

    /// <summary>The page subtitle (web <c>charging.list.subtitle</c>).</summary>
    public required string Subtitle { get; init; }

    /// <summary>The sticky-summary accessible name (web <c>charging.stickyBar.aria</c>).</summary>
    public required string StickyAria { get; init; }

    /// <summary>The composed sticky-summary line (title · period · collection · results · avg score).</summary>
    public required string StickySummary { get; init; }

    /// <summary>The localized search hint shown in the search box.</summary>
    public required string SearchPrompt { get; init; }

    /// <summary>The "filtering…" pending label (web <c>filter.pending</c>).</summary>
    public required string FilterPendingLabel { get; init; }

    /// <summary>The active search-filter chip label (web <c>charging.filterLabel.search</c>).</summary>
    public required string FilterSearchLabel { get; init; }

    /// <summary>The active collection-filter chip label (web <c>charging.filterLabel.collection</c>).</summary>
    public required string FilterCollectionLabel { get; init; }

    /// <summary>True when the overview KPIs render (web <c>currentStats.count &gt; 0</c>).</summary>
    public required bool HasStats { get; init; }

    /// <summary>The overview card title (web <c>charging.overview</c>).</summary>
    public required string OverviewTitle { get; init; }

    /// <summary>The current-period label (preset · range).</summary>
    public required string PeriodLabel { get; init; }

    /// <summary>The prior-period label, or the "no prior data" line (web <c>charging.priorPeriod</c> / <c>noPriorData</c>).</summary>
    public required string PriorLabel { get; init; }

    /// <summary>The six overview KPI tiles (web MetricCards).</summary>
    public required IReadOnlyList<ChargingKpiCard> KpiCards { get; init; }

    /// <summary>The secondary stats line (by type · free · battery score · most common start).</summary>
    public required string SecondaryLine { get; init; }

    /// <summary>The no-stats GlassPanel message (web <c>charging.noStatsRange</c>) — the 7th panel.</summary>
    public required string NoStatsMessage { get; init; }

    /// <summary>The anomaly callout text (web <c>charging.anomalyCount</c>), or empty when no callout.</summary>
    public required string AnomalyCallout { get; init; }

    /// <summary>The anomaly callout action label (web <c>charging.viewAnomalies</c>).</summary>
    public required string ViewAnomaliesLabel { get; init; }

    /// <summary>True when the anomaly callout is shown.</summary>
    public required bool HasAnomalyCallout { get; init; }

    /// <summary>The trend chart title (web <c>charging.overTime</c>).</summary>
    public required string TrendTitle { get; init; }

    /// <summary>The trend chart accessible name (web <c>charging.overTime.aria</c>).</summary>
    public required string TrendAria { get; init; }

    /// <summary>The trend chart empty message (web <c>charging.overTime.empty</c>).</summary>
    public required string TrendEmpty { get; init; }

    /// <summary>The four trend metric definitions in pill order.</summary>
    public required IReadOnlyList<MetricDefinition> TrendMetrics { get; init; }

    /// <summary>The per-metric trend series keyed by metric key.</summary>
    public required IReadOnlyDictionary<string, IReadOnlyList<MetricPoint>> TrendSeries { get; init; }

    /// <summary>The active trend metric key.</summary>
    public required string TrendActiveKey { get; init; }

    /// <summary>The collections pill bar accessible name (web <c>charging.collections.aria</c>).</summary>
    public required string CollectionsAria { get; init; }

    /// <summary>The collection pill options with live counts.</summary>
    public required IReadOnlyList<ComboOption> CollectionOptions { get; init; }

    /// <summary>The active collection value.</summary>
    public required string ActiveCollection { get; init; }

    /// <summary>The sort options.</summary>
    public required IReadOnlyList<ComboOption> SortOptions { get; init; }

    /// <summary>The active sort field value.</summary>
    public required string ActiveSort { get; init; }

    /// <summary>The session-list heading (web <c>charging.allSessions</c> or the collection label).</summary>
    public required string ListHeading { get; init; }

    /// <summary>The date-grouped session rows for the current page.</summary>
    public required IReadOnlyList<ChargingDateGroup> Groups { get; init; }

    /// <summary>True when the list has rows on the current page.</summary>
    public required bool HasRows { get; init; }

    /// <summary>The empty-for-collection title (web <c>charging.emptyForCollection</c>).</summary>
    public required string EmptyForCollectionTitle { get; init; }

    /// <summary>The empty-for-collection message (web <c>charging.emptyForCollection.msg</c>).</summary>
    public required string EmptyForCollectionMessage { get; init; }

    /// <summary>The total filtered row count (drives the pager + results count).</summary>
    public required int TotalRowCount { get; init; }

    /// <summary>The "{n} results" label (web <c>charging.results</c>).</summary>
    public required string ResultsLabel { get; init; }

    /// <summary>The 1-based display page.</summary>
    public required int Page { get; init; }

    /// <summary>The display page size.</summary>
    public required int PageSize { get; init; }

    /// <summary>The conditional analytical sections (battery distribution, specs, optimizer).</summary>
    public required IReadOnlyList<ChargingSectionDisplay> Sections { get; init; }

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

    /// <summary>The page-level empty title (web <c>charging.emptyTitle</c>).</summary>
    public required string EmptyTitle { get; init; }

    /// <summary>The page-level empty message (web <c>charging.emptyMessage</c>).</summary>
    public required string EmptyMessage { get; init; }

    /// <summary>The page-level empty call-to-action (web <c>charging.empty.cta</c>).</summary>
    public required string EmptyCta { get; init; }

    /// <summary>The generic "no data" label (web <c>common.noData</c>).</summary>
    public required string NoDataLabel { get; init; }

    /// <summary>The 1-based index of the first row on the current page.</summary>
    public int RangeStart => TotalRowCount == 0 ? 0 : ((Page - 1) * PageSize) + 1;

    /// <summary>The 1-based index of the last row on the current page.</summary>
    public int RangeEnd => Math.Min(Page * PageSize, TotalRowCount);
}
