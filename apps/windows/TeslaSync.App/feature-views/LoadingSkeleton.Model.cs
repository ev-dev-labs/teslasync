using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// How a <see cref="SkeletonBlock"/> sizes itself horizontally — the native analogue of the three width
/// idioms the web <c>Skeleton</c> is driven with in
/// web/src/features/charging/components/cost-analysis/LoadingSkeleton.tsx: a fixed pixel width
/// (<c>width="220px"</c>), a fraction of the parent (<c>width="60%"</c>) or no width at all (the block
/// stretches to fill its row).
/// </summary>
public enum SkeletonWidth
{
    /// <summary>Fill the available row width (web blocks with no explicit <c>width</c>).</summary>
    Stretch,

    /// <summary>An absolute width in effective pixels (web <c>width="220px"</c>).</summary>
    Fixed,

    /// <summary>A fraction (0–1] of the available width (web <c>width="60%"</c>).</summary>
    Fraction,
}

/// <summary>
/// A single shimmer block in the loading scaffold — the WinUI-free description of one web
/// <c>&lt;Skeleton /&gt;</c> usage (web/src/features/charging/components/cost-analysis/LoadingSkeleton.tsx).
/// It captures the block's <see cref="Height"/>, its horizontal sizing (<see cref="WidthMode"/> +
/// <see cref="Width"/>) and whether it is fully rounded (the web <c>rounded</c> prop, used for the pill-shaped
/// header action). Pure data — no WinUI types — so the scaffold's geometry is asserted headlessly, row for
/// row, against the web source.
/// </summary>
/// <param name="Height">Block height in effective pixels (the web <c>height</c> prop).</param>
/// <param name="WidthMode">How <see cref="Width"/> is interpreted (stretch / fixed / fraction).</param>
/// <param name="Width">
/// The fixed pixel width when <see cref="WidthMode"/> is <see cref="SkeletonWidth.Fixed"/>, or the fraction
/// (0–1] when it is <see cref="SkeletonWidth.Fraction"/>; ignored when the block stretches.
/// </param>
/// <param name="Pill">When true the block is a full-radius pill (the web <c>rounded</c> prop).</param>
public sealed record SkeletonBlock(double Height, SkeletonWidth WidthMode, double Width, bool Pill)
{
    /// <summary>The default block corner radius — the web <c>Skeleton</c> default (<c>rounded-md</c>, ~6px).</summary>
    public const double DefaultRadius = 6;

    /// <summary>A block that stretches to fill its row (web <c>Skeleton</c> with no <c>width</c>).</summary>
    /// <param name="height">Block height in effective pixels.</param>
    /// <param name="pill">When true the block is a full-radius pill.</param>
    public static SkeletonBlock Stretch(double height, bool pill = false) =>
        new(height, SkeletonWidth.Stretch, 0, pill);

    /// <summary>A block with an absolute pixel width (web <c>width="{n}px"</c>).</summary>
    /// <param name="height">Block height in effective pixels.</param>
    /// <param name="width">Absolute width in effective pixels.</param>
    /// <param name="pill">When true the block is a full-radius pill.</param>
    public static SkeletonBlock Fixed(double height, double width, bool pill = false) =>
        new(height, SkeletonWidth.Fixed, width, pill);

    /// <summary>A block whose width is a fraction (0–1] of the available width (web <c>width="{n}%"</c>).</summary>
    /// <param name="height">Block height in effective pixels.</param>
    /// <param name="fraction">The width fraction in the range (0, 1].</param>
    /// <param name="pill">When true the block is a full-radius pill.</param>
    public static SkeletonBlock Fraction(double height, double fraction, bool pill = false) =>
        new(height, SkeletonWidth.Fraction, fraction, pill);

    /// <summary>
    /// The corner radius to render the block with: a full pill (half the height) when <see cref="Pill"/> is set
    /// (the web <c>rounded</c> prop on the header action), otherwise <see cref="DefaultRadius"/>.
    /// </summary>
    public double ResolveRadius() => Pill ? Height / 2 : DefaultRadius;
}

/// <summary>
/// A shimmer block plus the gap that precedes it inside a vertical region — the native analogue of the web
/// <c>mt-*</c> utility on a stacked <c>Skeleton</c> (e.g. the card's <c>mt-2</c> / <c>mt-1</c> rhythm in
/// web/src/features/charging/components/cost-analysis/LoadingSkeleton.tsx). Pure data so the per-row spacing is
/// verified without a UI host.
/// </summary>
/// <param name="Block">The shimmer block rendered on this row.</param>
/// <param name="TopGap">The gap above the block in effective pixels (0 for the first row).</param>
public sealed record SkeletonRow(SkeletonBlock Block, double TopGap);

/// <summary>
/// The header region of the loading scaffold — the web <c>flex … justify-between</c> header
/// (web/src/features/charging/components/cost-analysis/LoadingSkeleton.tsx): a left column holding the title
/// and subtitle blocks and a right-aligned action block.
/// </summary>
/// <param name="Title">The title block (web <c>Skeleton width="220px" height={28}</c>).</param>
/// <param name="Subtitle">The subtitle block (web <c>Skeleton width="340px" height={16}</c>).</param>
/// <param name="SubtitleGap">The gap between title and subtitle (web <c>mt-2</c>, 8px).</param>
/// <param name="ColumnGap">The minimum gap between the title column and the action (web <c>gap-4</c>, 16px).</param>
/// <param name="Action">The pill action block (web <c>Skeleton width="200px" height={36} rounded</c>).</param>
public sealed record HeaderSpec(
    SkeletonBlock Title,
    SkeletonBlock Subtitle,
    double SubtitleGap,
    double ColumnGap,
    SkeletonBlock Action);

/// <summary>
/// The stat-card grid of the loading scaffold — the web responsive grid of six glass panels
/// (web/src/features/charging/components/cost-analysis/LoadingSkeleton.tsx,
/// <c>grid-cols-2 lg:grid-cols-3 xl:grid-cols-6</c>), each panel holding the same three stacked blocks.
/// </summary>
/// <param name="Count">Number of cards (web <c>Array.from({ length: 6 })</c>).</param>
/// <param name="Columns">Columns at full width (web <c>xl:grid-cols-6</c>).</param>
/// <param name="Gap">Gap between cards (web grid <c>gap-4</c>, 16px).</param>
/// <param name="Padding">Panel padding (web <c>p-4</c>, 16px).</param>
/// <param name="Lines">The three stacked blocks inside each card, with their leading gaps.</param>
public sealed record CardsSpec(
    int Count,
    int Columns,
    double Gap,
    double Padding,
    IReadOnlyList<SkeletonRow> Lines);

/// <summary>
/// The chart row of the loading scaffold — the web two-column grid of glass panels
/// (web/src/features/charging/components/cost-analysis/LoadingSkeleton.tsx,
/// <c>grid-cols-1 lg:grid-cols-2</c>), each panel a small title block above a tall chart-body block.
/// </summary>
/// <param name="Count">Number of chart panels (web renders two).</param>
/// <param name="Columns">Columns at full width (web <c>lg:grid-cols-2</c>).</param>
/// <param name="Gap">Gap between panels (web grid <c>gap-4</c>, 16px).</param>
/// <param name="Padding">Panel padding (web <c>p-4</c>, 16px).</param>
/// <param name="Title">The title block (web <c>Skeleton height={16} width="40%"</c>).</param>
/// <param name="BodyGap">The gap above the chart body (web <c>mt-4</c>, 16px).</param>
/// <param name="Body">The chart-body block (web <c>Skeleton height={200}</c>, stretched).</param>
public sealed record ChartsSpec(
    int Count,
    int Columns,
    double Gap,
    double Padding,
    SkeletonBlock Title,
    double BodyGap,
    SkeletonBlock Body);

/// <summary>
/// The table region of the loading scaffold — the web single glass panel with a title block above a stack of
/// five row blocks (web/src/features/charging/components/cost-analysis/LoadingSkeleton.tsx).
/// </summary>
/// <param name="Padding">Panel padding (web <c>p-4</c>, 16px).</param>
/// <param name="Title">The title block (web <c>Skeleton height={16} width="30%"</c>).</param>
/// <param name="HeaderGap">The gap between the title and the row stack (web <c>mt-4</c>, 16px).</param>
/// <param name="RowCount">Number of row blocks (web <c>Array.from({ length: 5 })</c>).</param>
/// <param name="RowGap">The gap between rows (web <c>space-y-2</c>, 8px).</param>
/// <param name="Row">The row block (web <c>Skeleton height={32}</c>, stretched).</param>
public sealed record TableSpec(
    double Padding,
    SkeletonBlock Title,
    double HeaderGap,
    int RowCount,
    double RowGap,
    SkeletonBlock Row);

/// <summary>
/// The complete, WinUI-free layout specification for the <c>LoadingSkeleton</c> surface — the native parity
/// projection of the web component at
/// <c>web/src/features/charging/components/cost-analysis/LoadingSkeleton.tsx</c>. The web source is a pure
/// presentational scaffold (no props, no data, no i18n strings and no conditional branches — it renders exactly
/// one thing: the cost-analysis page's loading chrome), so the native port has a single render path described
/// entirely by this immutable spec: the <see cref="Header"/>, the six-card <see cref="Cards"/> grid, the
/// two-panel <see cref="Charts"/> row and the five-row <see cref="Table"/>, wrapped with the page's
/// <see cref="ContentSpacing"/> (web <c>space-y-6</c>) and <see cref="OuterPadding"/> (web <c>p-6</c>). Holding
/// the geometry as data lets the view stay declarative and lets the parity tests assert every dimension and
/// count row for row against the web source without a UI host.
/// </summary>
/// <param name="Header">The header region (title, subtitle, action).</param>
/// <param name="Cards">The six-card stat grid.</param>
/// <param name="Charts">The two-panel chart row.</param>
/// <param name="Table">The single table panel with five rows.</param>
/// <param name="ContentSpacing">The gap between the four regions (web <c>space-y-6</c>, 24px).</param>
/// <param name="OuterPadding">The padding around the whole scaffold (web <c>p-6</c>, 24px).</param>
public sealed record LoadingSkeletonSpec(
    HeaderSpec Header,
    CardsSpec Cards,
    ChartsSpec Charts,
    TableSpec Table,
    double ContentSpacing,
    double OuterPadding)
{
    /// <summary>
    /// The canonical scaffold geometry, transcribed field-for-field from the web source. Every literal below is
    /// the value of the corresponding web <c>Skeleton</c> prop / Tailwind spacing token, so a drift in either the
    /// web source or this port is caught by the parity tests.
    /// </summary>
    public static LoadingSkeletonSpec Default { get; } = new(
        Header: new HeaderSpec(
            Title: SkeletonBlock.Fixed(28, 220),
            Subtitle: SkeletonBlock.Fixed(16, 340),
            SubtitleGap: 8,
            ColumnGap: 16,
            Action: SkeletonBlock.Fixed(36, 200, pill: true)),
        Cards: new CardsSpec(
            Count: 6,
            Columns: 6,
            Gap: 16,
            Padding: 16,
            Lines: new[]
            {
                new SkeletonRow(SkeletonBlock.Fraction(14, 0.60), 0),
                new SkeletonRow(SkeletonBlock.Fraction(24, 0.80), 8),
                new SkeletonRow(SkeletonBlock.Fraction(12, 0.40), 4),
            }),
        Charts: new ChartsSpec(
            Count: 2,
            Columns: 2,
            Gap: 16,
            Padding: 16,
            Title: SkeletonBlock.Fraction(16, 0.40),
            BodyGap: 16,
            Body: SkeletonBlock.Stretch(200)),
        Table: new TableSpec(
            Padding: 16,
            Title: SkeletonBlock.Fraction(16, 0.30),
            HeaderGap: 16,
            RowCount: 5,
            RowGap: 8,
            Row: SkeletonBlock.Stretch(32)),
        ContentSpacing: 24,
        OuterPadding: 24);
}

/// <summary>
/// Canonical metadata for the <c>LoadingSkeleton</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/charging/components/cost-analysis/LoadingSkeleton.tsx</c>. The surface is anonymous on the
/// web (it renders no text), so the only string it resolves is its accessible name: the shared
/// <c>common.loading</c> catalog entry, used as the Narrator name and the live-region announcement so the page
/// is not a silent shimmer to assistive technology. UI-free so the slug and the i18n binding are asserted in
/// tests.
/// </summary>
public static class LoadingSkeletonRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "LoadingSkeleton";

    /// <summary>i18n key for the surface's accessible name (the shared <c>common.loading</c> string).</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading";

    /// <summary>Resolve the surface's accessible "Loading" name through the i18n facade.</summary>
    /// <param name="localizer">The i18n facade the accessible name resolves through.</param>
    public static string LoadingLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LoadingKey, LoadingFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>LoadingSkeleton</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — the scaffold carries no fleet data, so a
/// diagnostics line can never leak anything. Thread-safe.
/// </summary>
public sealed class LoadingSkeletonDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public LoadingSkeletonDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LoadingSkeleton</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LoadingSkeletonRegistration.Slug}");
    }
}
