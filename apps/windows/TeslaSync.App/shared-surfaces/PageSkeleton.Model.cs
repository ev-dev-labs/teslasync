using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The four shaped loading building blocks the surface reproduces — the native analogue of the four exported
/// functions in <c>web/src/components/feedback/PageSkeleton.tsx</c> (<c>PageHeaderSkeleton</c>,
/// <c>StatGridSkeleton</c>, <c>ChartBlockSkeleton</c>, <c>TableSkeleton</c>). Each web block mirrors the
/// <em>structure</em> of a common page region so the loading UI claims the same space as the real content
/// (keeping layout shift near zero), and each is its own <c>role="status" aria-busy="true"</c> region with a
/// fixed accessible label and test id.
/// </summary>
public enum PageSkeletonBlock
{
    /// <summary>web <c>PageHeaderSkeleton</c> — a title line over a wider subtitle line.</summary>
    PageHeader,

    /// <summary>web <c>StatGridSkeleton</c> — a responsive grid of equal stat-card boxes.</summary>
    StatGrid,

    /// <summary>web <c>ChartBlockSkeleton</c> — a single full-width chart-height box.</summary>
    ChartBlock,

    /// <summary>web <c>TableSkeleton</c> — a header bar over N rows × M column cells.</summary>
    Table,
}

/// <summary>
/// Canonical metadata for the PageSkeleton surface — the native analogue of the structural constants baked into
/// the Tailwind classes of <c>web/src/components/feedback/PageSkeleton.tsx</c>. The web component renders no
/// network data and exposes no titles of its own; each building block is an anonymous status region. This class
/// therefore carries the diagnostics slug, the ARIA role/live contract (web <c>role="status"</c> /
/// <c>aria-busy="true"</c>), the per-block automation id (web <c>data-testid</c>), the per-block accessible-label
/// i18n key + English fallback (web <c>aria-label</c>) and the block geometry resolved from the web Tailwind
/// classes to device-independent pixels (the Tailwind spacing scale is 4&#160;px per unit, <c>rem</c> = 16&#160;px:
/// <c>h-8</c>=32, <c>w-64</c>=256, <c>h-4</c>=16, <c>w-96</c>=384, <c>h-24</c>=96, <c>h-10</c>=40, <c>gap-4</c>=16,
/// <c>gap-3</c>=12, <c>space-y-2</c>=8, <c>rounded</c>=6, <c>rounded-xl</c>=12). UI-free so every value is asserted
/// headlessly.
/// </summary>
public static class PageSkeletonRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "PageSkeleton";

    /// <summary>ARIA role each block exposes — a read-only status region (web <c>role="status"</c>).</summary>
    public const string StatusRole = "status";

    /// <summary>ARIA live urgency each block declares — a status region is polite.</summary>
    public const string LiveSetting = "polite";

    /// <summary>Automation id of the page-header block (web <c>data-testid="page-header-skeleton"</c>).</summary>
    public const string PageHeaderAutomationId = "page-header-skeleton";

    /// <summary>Automation id of the stat-grid block (web <c>data-testid="stat-grid-skeleton"</c>).</summary>
    public const string StatGridAutomationId = "stat-grid-skeleton";

    /// <summary>Automation id of the chart block (web <c>data-testid="chart-block-skeleton"</c>).</summary>
    public const string ChartBlockAutomationId = "chart-block-skeleton";

    /// <summary>Automation id of the table block (web <c>data-testid="table-skeleton"</c>).</summary>
    public const string TableAutomationId = "table-skeleton";

    /// <summary>i18n key for the page-header accessible label (web <c>aria-label="Loading page header"</c>).</summary>
    public const string PageHeaderLabelKey = "translation.skeleton.pageHeader";

    /// <summary>English fallback for <see cref="PageHeaderLabelKey"/> — the web literal, verbatim.</summary>
    public const string PageHeaderLabelFallback = "Loading page header";

    /// <summary>i18n key for the stat-grid accessible label (web <c>aria-label="Loading stat cards"</c>).</summary>
    public const string StatGridLabelKey = "translation.skeleton.statCards";

    /// <summary>English fallback for <see cref="StatGridLabelKey"/> — the web literal, verbatim.</summary>
    public const string StatGridLabelFallback = "Loading stat cards";

    /// <summary>i18n key for the chart accessible label (web <c>aria-label="Loading chart"</c>).</summary>
    public const string ChartBlockLabelKey = "translation.skeleton.chart";

    /// <summary>English fallback for <see cref="ChartBlockLabelKey"/> — the web literal, verbatim.</summary>
    public const string ChartBlockLabelFallback = "Loading chart";

    /// <summary>i18n key for the table accessible label (web <c>aria-label="Loading table"</c>).</summary>
    public const string TableLabelKey = "translation.skeleton.table";

    /// <summary>English fallback for <see cref="TableLabelKey"/> — the web literal, verbatim.</summary>
    public const string TableLabelFallback = "Loading table";

    /// <summary>Height of the page-header title line (web <c>h-8</c> = 32&#160;px).</summary>
    public const double HeaderTitleHeight = 32;

    /// <summary>Width of the page-header title line (web <c>w-64</c> = 256&#160;px).</summary>
    public const double HeaderTitleWidth = 256;

    /// <summary>Height of the page-header subtitle line (web <c>h-4</c> = 16&#160;px).</summary>
    public const double HeaderSubtitleHeight = 16;

    /// <summary>Width of the page-header subtitle line (web <c>w-96</c> = 384&#160;px, capped to the container).</summary>
    public const double HeaderSubtitleWidth = 384;

    /// <summary>Vertical gap between the page-header lines (web <c>space-y-2</c> = 8&#160;px).</summary>
    public const double HeaderGap = 8;

    /// <summary>Corner radius of a default-rounded line (web <c>rounded</c> = 6&#160;px).</summary>
    public const double LineRadius = 6;

    /// <summary>Height of a stat-grid card box (web <c>h-24</c> = 96&#160;px).</summary>
    public const double StatCardHeight = 96;

    /// <summary>Corner radius of a stat-grid card box (web <c>rounded-xl</c> = 12&#160;px).</summary>
    public const double StatCardRadius = 12;

    /// <summary>Gap between stat-grid cards, both axes (web <c>gap-4</c> = 16&#160;px).</summary>
    public const double StatGridGap = 16;

    /// <summary>Column-track count of the stat grid on a wide surface (web <c>md:grid-cols-4</c>).</summary>
    public const int StatGridColumns = 4;

    /// <summary>Default number of stat cards (web <c>cards = 4</c>).</summary>
    public const int DefaultCards = 4;

    /// <summary>Default chart box height in pixels (web <c>height = 320</c>).</summary>
    public const double DefaultChartHeight = 320;

    /// <summary>Corner radius of the chart box (web <c>rounded-xl</c> = 12&#160;px).</summary>
    public const double ChartRadius = 12;

    /// <summary>Height of the table header bar (web <c>h-10</c> = 40&#160;px).</summary>
    public const double TableHeaderHeight = 40;

    /// <summary>
    /// Corner radius of the table header bar. The web class is <c>rounded-t-xl</c> (top corners only, 12&#160;px);
    /// the shared shimmer atom carries a single uniform radius, so the whole bar rounds at 12&#160;px.
    /// </summary>
    public const double TableHeaderRadius = 12;

    /// <summary>Height of a table body cell (web <c>h-8</c> = 32&#160;px).</summary>
    public const double TableCellHeight = 32;

    /// <summary>Corner radius of a table body cell (web <c>rounded</c> = 6&#160;px).</summary>
    public const double TableCellRadius = 6;

    /// <summary>Vertical gap between the table header and body rows (web <c>space-y-2</c> = 8&#160;px).</summary>
    public const double TableRowGap = 8;

    /// <summary>Gap between table body cells in a row (web <c>gap-3</c> = 12&#160;px).</summary>
    public const double TableColumnGap = 12;

    /// <summary>Default number of table body rows (web <c>rows = 8</c>).</summary>
    public const int DefaultRows = 8;

    /// <summary>Default number of table columns (web <c>cols = 4</c>).</summary>
    public const int DefaultColumns = 4;

    /// <summary>The automation id (web <c>data-testid</c>) for <paramref name="block"/>.</summary>
    /// <param name="block">The building block.</param>
    public static string AutomationIdFor(PageSkeletonBlock block) => block switch
    {
        PageSkeletonBlock.PageHeader => PageHeaderAutomationId,
        PageSkeletonBlock.StatGrid => StatGridAutomationId,
        PageSkeletonBlock.ChartBlock => ChartBlockAutomationId,
        PageSkeletonBlock.Table => TableAutomationId,
        _ => throw new ArgumentOutOfRangeException(nameof(block)),
    };

    /// <summary>The i18n key behind the accessible label (web <c>aria-label</c>) for <paramref name="block"/>.</summary>
    /// <param name="block">The building block.</param>
    public static string LabelKeyFor(PageSkeletonBlock block) => block switch
    {
        PageSkeletonBlock.PageHeader => PageHeaderLabelKey,
        PageSkeletonBlock.StatGrid => StatGridLabelKey,
        PageSkeletonBlock.ChartBlock => ChartBlockLabelKey,
        PageSkeletonBlock.Table => TableLabelKey,
        _ => throw new ArgumentOutOfRangeException(nameof(block)),
    };

    /// <summary>The English fallback for the accessible label of <paramref name="block"/>.</summary>
    /// <param name="block">The building block.</param>
    public static string LabelFallbackFor(PageSkeletonBlock block) => block switch
    {
        PageSkeletonBlock.PageHeader => PageHeaderLabelFallback,
        PageSkeletonBlock.StatGrid => StatGridLabelFallback,
        PageSkeletonBlock.ChartBlock => ChartBlockLabelFallback,
        PageSkeletonBlock.Table => TableLabelFallback,
        _ => throw new ArgumentOutOfRangeException(nameof(block)),
    };

    /// <summary>Resolve the accessible label (web <c>aria-label</c>) for <paramref name="block"/> through i18n.</summary>
    /// <param name="block">The building block.</param>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveLabel(PageSkeletonBlock block, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LabelKeyFor(block), LabelFallbackFor(block));
    }
}

/// <summary>
/// One shimmer block in a reproduced region — the native analogue of a single web <c>&lt;Skeleton&gt;</c>. Kept
/// UI-free (no <c>Microsoft.UI</c> types) so the layout maths are unit-testable without a XAML runtime. A null
/// <see cref="Width"/> means the block stretches to fill its column (web blocks with no explicit <c>w-*</c>); a
/// value is an explicit width in device-independent pixels (web <c>w-64</c> / <c>w-96</c>).
/// </summary>
/// <param name="Height">The block height in device-independent pixels (web <c>h-*</c>).</param>
/// <param name="Width">The explicit block width in pixels, or null to stretch (web <c>w-*</c> / none).</param>
/// <param name="Radius">The corner radius in pixels (web <c>rounded</c> / <c>rounded-xl</c>).</param>
public readonly record struct SkeletonCell(double Height, double? Width, double Radius)
{
    /// <summary>True when the block stretches to fill its column (no explicit width).</summary>
    public bool Stretches => Width is null;

    /// <summary>A column-filling block of the given <paramref name="height"/> and <paramref name="radius"/>.</summary>
    /// <param name="height">The block height in pixels.</param>
    /// <param name="radius">The corner radius in pixels.</param>
    public static SkeletonCell Stretch(double height, double radius) => new(height, null, radius);

    /// <summary>A fixed-width block of the given <paramref name="height"/>, <paramref name="width"/> and radius.</summary>
    /// <param name="height">The block height in pixels.</param>
    /// <param name="width">The block width in pixels.</param>
    /// <param name="radius">The corner radius in pixels.</param>
    public static SkeletonCell Fixed(double height, double width, double radius) => new(height, width, radius);
}

/// <summary>
/// One row of shimmer blocks in a reproduced region — the native analogue of a single grid/flex line in the web
/// source. Carries its blocks, the <see cref="Columns"/> star-track count the row lays out over (so a partial
/// last grid row keeps the same per-card width as full rows — the web CSS-grid behaviour) and the horizontal
/// <see cref="ColumnGap"/> between blocks (web <c>gap-*</c>). UI-free.
/// </summary>
public sealed class SkeletonRow
{
    /// <summary>Creates a row over its blocks, column-track count and horizontal gap.</summary>
    /// <param name="cells">The shimmer blocks, laid out left to right.</param>
    /// <param name="columns">The number of equal column tracks the row spans (≥ the block count).</param>
    /// <param name="columnGap">The horizontal gap between blocks in pixels (web <c>gap-*</c>).</param>
    public SkeletonRow(IReadOnlyList<SkeletonCell> cells, int columns, double columnGap)
    {
        ArgumentNullException.ThrowIfNull(cells);
        Cells = cells;
        Columns = columns;
        ColumnGap = columnGap;
    }

    /// <summary>The shimmer blocks in the row, laid out left to right.</summary>
    public IReadOnlyList<SkeletonCell> Cells { get; }

    /// <summary>The number of equal column tracks the row lays out over (web grid column count).</summary>
    public int Columns { get; }

    /// <summary>The horizontal gap between blocks in pixels (web <c>gap-*</c>).</summary>
    public double ColumnGap { get; }
}

/// <summary>
/// The render inputs that vary a reproduced block — the native analogue of the web building-block props
/// (<c>cards</c>, <c>height</c>, <c>rows</c>, <c>cols</c>). A value type so equal parameter sets compare equal
/// (the view-model dedupes redundant prop pushes). The <c>Normalized*</c> accessors clamp nonsensical inputs the
/// way a real render must: counts never go negative and the chart height / column count never collapse below a
/// drawable minimum.
/// </summary>
/// <param name="Cards">Number of stat-grid cards (web <c>cards</c>; default 4).</param>
/// <param name="ChartHeight">Chart box height in pixels (web <c>height</c>; default 320).</param>
/// <param name="TableRows">Number of table body rows (web <c>rows</c>; default 8).</param>
/// <param name="TableColumns">Number of table columns (web <c>cols</c>; default 4).</param>
public readonly record struct PageSkeletonParameters(
    int Cards,
    double ChartHeight,
    int TableRows,
    int TableColumns)
{
    /// <summary>The web prop defaults (<c>cards=4</c>, <c>height=320</c>, <c>rows=8</c>, <c>cols=4</c>).</summary>
    public static PageSkeletonParameters Default { get; } = new(
        PageSkeletonRegistration.DefaultCards,
        PageSkeletonRegistration.DefaultChartHeight,
        PageSkeletonRegistration.DefaultRows,
        PageSkeletonRegistration.DefaultColumns);

    /// <summary>The stat-card count, clamped to never go negative.</summary>
    public int NormalizedCards => Math.Max(0, Cards);

    /// <summary>The chart box height, clamped to a drawable minimum of 1&#160;px.</summary>
    public double NormalizedChartHeight => Math.Max(1, ChartHeight);

    /// <summary>The table body-row count, clamped to never go negative.</summary>
    public int NormalizedTableRows => Math.Max(0, TableRows);

    /// <summary>The table column count, clamped to at least one track.</summary>
    public int NormalizedTableColumns => Math.Max(1, TableColumns);
}

/// <summary>
/// Pure projection of a reproduced building block — the native port of one web <c>PageSkeleton</c> function body.
/// Given the <see cref="PageSkeletonBlock"/>, its <see cref="PageSkeletonParameters"/> and the reduce-motion flag,
/// it resolves the accessible label (web <c>aria-label</c>, through i18n), the automation id (web
/// <c>data-testid</c>), whether the shimmer animates (<see cref="Animate"/> is false under reduced motion, where
/// the web <c>animate-pulse</c> is suppressed), the rows of shimmer blocks (web <c>&lt;Skeleton&gt;</c> children)
/// and the vertical <see cref="RowGap"/> between them (web <c>space-y-*</c> / <c>gap-*</c>). Static and
/// side-effect-free so the adapter is unit-testable without a view-model or a UI thread.
/// </summary>
public sealed class PageSkeletonProjection
{
    private PageSkeletonProjection(
        PageSkeletonBlock block,
        string accessibleName,
        string automationId,
        bool animate,
        IReadOnlyList<SkeletonRow> rows,
        double rowGap)
    {
        Block = block;
        AccessibleName = accessibleName;
        AutomationId = automationId;
        Animate = animate;
        Rows = rows;
        RowGap = rowGap;
    }

    /// <summary>The building block this projection describes.</summary>
    public PageSkeletonBlock Block { get; }

    /// <summary>The accessible name the status region announces (web <c>aria-label</c>).</summary>
    public string AccessibleName { get; }

    /// <summary>The automation id stamped on the region (web <c>data-testid</c>).</summary>
    public string AutomationId { get; }

    /// <summary>Whether the shimmer pulses; false under reduced motion (web <c>animate-pulse</c> suppressed).</summary>
    public bool Animate { get; }

    /// <summary>The rows of shimmer blocks, top to bottom (web <c>&lt;Skeleton&gt;</c> children).</summary>
    public IReadOnlyList<SkeletonRow> Rows { get; }

    /// <summary>The vertical gap between rows in pixels (web <c>space-y-*</c> / grid row gap).</summary>
    public double RowGap { get; }

    /// <summary>
    /// Project a building block, reproducing the corresponding web function body. Negative / zero inputs are
    /// clamped through <see cref="PageSkeletonParameters"/> so the region always renders a sane shape.
    /// </summary>
    /// <param name="block">The building block (web exported function).</param>
    /// <param name="parameters">The block parameters (web props).</param>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set (web <c>animate-pulse</c> gate).</param>
    /// <param name="localizer">The i18n facade the accessible label resolves through.</param>
    public static PageSkeletonProjection Project(
        PageSkeletonBlock block,
        PageSkeletonParameters parameters,
        bool reduceMotion,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        (IReadOnlyList<SkeletonRow> rows, double rowGap) = block switch
        {
            PageSkeletonBlock.PageHeader => BuildPageHeader(),
            PageSkeletonBlock.StatGrid => BuildStatGrid(parameters.NormalizedCards),
            PageSkeletonBlock.ChartBlock => BuildChartBlock(parameters.NormalizedChartHeight),
            PageSkeletonBlock.Table => BuildTable(parameters.NormalizedTableRows, parameters.NormalizedTableColumns),
            _ => throw new ArgumentOutOfRangeException(nameof(block)),
        };

        return new PageSkeletonProjection(
            block,
            PageSkeletonRegistration.ResolveLabel(block, localizer),
            PageSkeletonRegistration.AutomationIdFor(block),
            animate: !reduceMotion,
            rows,
            rowGap);
    }

    private static (IReadOnlyList<SkeletonRow>, double) BuildPageHeader()
    {
        // web: <div className="space-y-2"><Skeleton h-8 w-64 /><Skeleton h-4 w-96 max-w-full /></div>
        var rows = new SkeletonRow[]
        {
            SingleColumnRow(SkeletonCell.Fixed(
                PageSkeletonRegistration.HeaderTitleHeight,
                PageSkeletonRegistration.HeaderTitleWidth,
                PageSkeletonRegistration.LineRadius)),
            SingleColumnRow(SkeletonCell.Fixed(
                PageSkeletonRegistration.HeaderSubtitleHeight,
                PageSkeletonRegistration.HeaderSubtitleWidth,
                PageSkeletonRegistration.LineRadius)),
        };

        return (rows, PageSkeletonRegistration.HeaderGap);
    }

    private static (IReadOnlyList<SkeletonRow>, double) BuildStatGrid(int cards)
    {
        // web: <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{cards × <Skeleton h-24 rounded-xl />}</div>
        int columns = PageSkeletonRegistration.StatGridColumns;
        var rows = new List<SkeletonRow>();

        for (var start = 0; start < cards; start += columns)
        {
            int countInRow = Math.Min(columns, cards - start);
            var cells = new SkeletonCell[countInRow];
            for (var i = 0; i < countInRow; i++)
            {
                cells[i] = SkeletonCell.Stretch(
                    PageSkeletonRegistration.StatCardHeight,
                    PageSkeletonRegistration.StatCardRadius);
            }

            rows.Add(new SkeletonRow(cells, columns, PageSkeletonRegistration.StatGridGap));
        }

        return (rows, PageSkeletonRegistration.StatGridGap);
    }

    private static (IReadOnlyList<SkeletonRow>, double) BuildChartBlock(double height)
    {
        // web: <div className="w-full"><Skeleton className="rounded-xl" height={height} /></div>
        var rows = new SkeletonRow[]
        {
            SingleColumnRow(SkeletonCell.Stretch(height, PageSkeletonRegistration.ChartRadius)),
        };

        return (rows, 0);
    }

    private static (IReadOnlyList<SkeletonRow>, double) BuildTable(int bodyRows, int columns)
    {
        // web: <div className="space-y-2"><Skeleton h-10 rounded-t-xl />{rows × <div className="grid gap-3">{cols × <Skeleton h-8 rounded />}</div>}</div>
        var rows = new List<SkeletonRow>
        {
            SingleColumnRow(SkeletonCell.Stretch(
                PageSkeletonRegistration.TableHeaderHeight,
                PageSkeletonRegistration.TableHeaderRadius)),
        };

        for (var r = 0; r < bodyRows; r++)
        {
            var cells = new SkeletonCell[columns];
            for (var c = 0; c < columns; c++)
            {
                cells[c] = SkeletonCell.Stretch(
                    PageSkeletonRegistration.TableCellHeight,
                    PageSkeletonRegistration.TableCellRadius);
            }

            rows.Add(new SkeletonRow(cells, columns, PageSkeletonRegistration.TableColumnGap));
        }

        return (rows, PageSkeletonRegistration.TableRowGap);
    }

    private static SkeletonRow SingleColumnRow(SkeletonCell cell) =>
        new(new[] { cell }, columns: 1, columnGap: 0);
}

/// <summary>
/// PII-safe diagnostics for the PageSkeleton surface (P1/S11 diagnostics contract). The loading scaffold carries
/// no user content, so the collector records only the operational <c>view.opened</c> event with the surface slug.
/// Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class PageSkeletonDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public PageSkeletonDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PageSkeleton</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PageSkeletonRegistration.Slug}");
    }
}
