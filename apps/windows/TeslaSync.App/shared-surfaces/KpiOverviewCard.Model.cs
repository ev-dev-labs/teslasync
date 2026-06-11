namespace TeslaSync.App.SharedSurfaces.KpiOverviewCardSurface;

/// <summary>
/// Canonical metadata for the KpiOverviewCard shared surface — the native analogue of the module-level
/// identity of web/src/components/data-display/KpiOverviewCard.tsx and its embedded
/// web/src/components/data-display/ComparisonHeader.tsx. Both web components are anonymous: they render no
/// titles or labels of their own and contain zero <c>t()</c> calls (the page passes already-localized
/// strings through the <c>header</c> props and the <c>kpis</c> / <c>secondary</c> / <c>footer</c> slots), so
/// this registration carries only the diagnostics slug the surface registers under (P1/S11) plus the
/// responsive grid constants that reproduce the web Tailwind column breakpoints.
/// </summary>
public static class KpiOverviewCardRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "KpiOverviewCard";

    /// <summary>
    /// The middot period separator drawn between the current and comparison labels — the native port of the web
    /// ComparisonHeader middot span (web/src/components/data-display/ComparisonHeader.tsx L65,
    /// <c>&lt;span className="mx-1.5 opacity-60"&gt;·&lt;/span&gt;</c>). The surrounding spaces stand in for the
    /// web horizontal margins.
    /// </summary>
    public const string PeriodSeparator = " \u00B7 ";

    /// <summary>
    /// Columns below the small breakpoint — the native port of the web base <c>grid-cols-2</c>
    /// (web/src/components/data-display/KpiOverviewCard.tsx L88).
    /// </summary>
    public const int NarrowColumns = 2;

    /// <summary>Columns at the small breakpoint — the native port of the web <c>sm:grid-cols-3</c> (web L88).</summary>
    public const int MediumColumns = 3;

    /// <summary>Columns at the large breakpoint — the native port of the web <c>lg:grid-cols-6</c> (web L88).</summary>
    public const int WideColumns = 6;

    /// <summary>The small breakpoint in effective pixels (the native analogue of the Tailwind <c>sm</c> = 640px).</summary>
    public const double SmallBreakpoint = 640;

    /// <summary>The large breakpoint in effective pixels (the native analogue of the Tailwind <c>lg</c> = 1024px).</summary>
    public const double LargeBreakpoint = 1024;
}

/// <summary>
/// The header inputs a <see cref="KpiOverviewCard"/> renders in its comparison header — the native port of the
/// web <c>ComparisonHeaderProps</c> title + period strip (web/src/components/data-display/ComparisonHeader.tsx
/// L5-L29). The page passes pre-formatted, already-localized strings (the web component "stays free of
/// date/i18n logic"), so this record simply carries them; null strings normalise to empty so the projection
/// never dereferences null.
/// </summary>
public sealed record KpiOverviewCardHeader
{
    /// <summary>The section title, e.g. "Overview" (web <c>title</c>, rendered in the <c>&lt;h3&gt;</c>).</summary>
    public string Title { get; init; } = string.Empty;

    /// <summary>The localized current-period descriptor, e.g. "Last 30 days" (web <c>currentLabel</c>).</summary>
    public string CurrentLabel { get; init; } = string.Empty;

    /// <summary>
    /// The optional localized comparison-period label, e.g. "vs prior 30 days" (web <c>comparisonLabel</c>);
    /// null / empty drops the trailing middot + span exactly as the web conditional does.
    /// </summary>
    public string? ComparisonLabel { get; init; }
}

/// <summary>
/// The full set of inputs for one <see cref="KpiOverviewCard"/> — the native port of the web
/// <c>KpiOverviewCardProps</c> (web/src/components/data-display/KpiOverviewCard.tsx L36-L64). The web card is
/// purely presentational: the page computes the values and supplies the visual slots, so this input carries the
/// header strings, the presence of each optional slot (the headline delta + actions inside the header, the
/// secondary line and the footer), the count of KPI tiles (so the degenerate no-tiles case renders a friendly
/// empty state instead of a blank box) and the optional fixed-column override that the web <c>gridClassName</c>
/// prop expresses. The slots themselves are UI elements held by the view; this record is the framework-free
/// record is the WinUI-free projection input, so the render logic is verified headlessly.
/// </summary>
public sealed record KpiOverviewCardInput
{
    /// <summary>The header strings (web <c>header</c>); never null.</summary>
    public KpiOverviewCardHeader Header { get; init; } = new();

    /// <summary>Whether the header shows its optional headline delta (web <c>header.delta</c> present).</summary>
    public bool HasHeadlineDelta { get; init; }

    /// <summary>Whether the header shows its optional right-aligned actions (web <c>header.actions</c> present).</summary>
    public bool HasActions { get; init; }

    /// <summary>Whether the muted secondary stats line is shown (web <c>secondary</c> truthy, L95-L99).</summary>
    public bool HasSecondary { get; init; }

    /// <summary>Whether the footer slot is shown (web <c>footer</c> truthy, L101).</summary>
    public bool HasFooter { get; init; }

    /// <summary>The number of KPI tiles in the grid slot (web <c>kpis</c> children count).</summary>
    public int KpiCount { get; init; }

    /// <summary>
    /// The fixed column-count override — the native expression of the web <c>gridClassName</c> prop (web L58,
    /// L87-L88). Null keeps the responsive 2 / 3 / 6 breakpoint behaviour; a positive value pins the grid to
    /// that many columns at every width.
    /// </summary>
    public int? GridColumns { get; init; }

    /// <summary>The optional automation id for the outer panel (web <c>testId</c>, L60).</summary>
    public string? TestId { get; init; }

    /// <summary>The optional element id for sticky-bar targeting (web <c>id</c>, L62-L63); carried for parity.</summary>
    public string? ElementId { get; init; }
}

/// <summary>
/// The render-ready projection of one <see cref="KpiOverviewCardInput"/> — everything the WinUI view needs to
/// draw a frame without recomputing anything, so the view is a thin renderer and the projection is verified
/// headlessly. It is the native analogue of the values the web card + its embedded ComparisonHeader derive in
/// their bodies (web/src/components/data-display/KpiOverviewCard.tsx L76-L103,
/// web/src/components/data-display/ComparisonHeader.tsx L52-L76): the resolved header strings and the composed
/// period strip, which optional regions are shown (the headline delta + actions, the secondary line, the
/// footer), whether the grid has tiles or shows the empty state, the column-count resolver for the responsive
/// grid, and a Narrator name for the card region.
/// </summary>
public sealed class KpiOverviewCardDisplay
{
    internal KpiOverviewCardDisplay(
        string title,
        string currentLabel,
        string comparisonLabel,
        bool hasComparisonLabel,
        string periodText,
        bool showHeadlineDelta,
        bool showActions,
        bool showSecondary,
        bool showFooter,
        bool hasKpis,
        int? gridColumns,
        string accessibleName)
    {
        Title = title;
        CurrentLabel = currentLabel;
        ComparisonLabel = comparisonLabel;
        HasComparisonLabel = hasComparisonLabel;
        PeriodText = periodText;
        ShowHeadlineDelta = showHeadlineDelta;
        ShowActions = showActions;
        ShowSecondary = showSecondary;
        ShowFooter = showFooter;
        HasKpis = hasKpis;
        GridColumns = gridColumns;
        AccessibleName = accessibleName;
    }

    /// <summary>The section title shown in the header heading (web <c>&lt;h3&gt;</c>); empty when none.</summary>
    public string Title { get; }

    /// <summary>The current-period label (web <c>currentLabel</c>); empty when none.</summary>
    public string CurrentLabel { get; }

    /// <summary>The comparison-period label (web <c>comparisonLabel</c>); empty when none.</summary>
    public string ComparisonLabel { get; }

    /// <summary>True when the comparison label is shown after the middot (web <c>comparisonLabel &amp;&amp; …</c>).</summary>
    public bool HasComparisonLabel { get; }

    /// <summary>
    /// The composed period strip — the current label, plus the middot separator and the comparison label when
    /// present (web ComparisonHeader period <c>&lt;p&gt;</c>). Always non-empty when a current label exists.
    /// </summary>
    public string PeriodText { get; }

    /// <summary>Whether the header shows its headline delta on the right (web <c>delta &amp;&amp; …</c>).</summary>
    public bool ShowHeadlineDelta { get; }

    /// <summary>Whether the header shows its right-aligned actions (web <c>actions</c>).</summary>
    public bool ShowActions { get; }

    /// <summary>Whether the header's right-hand accessory column is drawn at all (delta or actions present).</summary>
    public bool ShowHeaderAccessory => ShowHeadlineDelta || ShowActions;

    /// <summary>Whether the muted secondary stats line is drawn (web <c>secondary &amp;&amp; …</c>).</summary>
    public bool ShowSecondary { get; }

    /// <summary>Whether the footer slot is drawn (web <c>footer &amp;&amp; …</c>).</summary>
    public bool ShowFooter { get; }

    /// <summary>True when the grid has at least one KPI tile (web <c>kpis</c> non-empty).</summary>
    public bool HasKpis { get; }

    /// <summary>
    /// True when the grid resolves to no tiles and the surface shows a friendly empty state in place of a blank
    /// grid box (the prompt's empty-state contract — "never a blank box").
    /// </summary>
    public bool ShowEmptyState => !HasKpis;

    /// <summary>The fixed column-count override, or null for the responsive 2 / 3 / 6 behaviour (web <c>gridClassName</c>).</summary>
    public int? GridColumns { get; }

    /// <summary>The Narrator name for the card region — the title when present, else the period strip.</summary>
    public string AccessibleName { get; }

    /// <summary>
    /// Resolve the KPI grid's column count for a measured <paramref name="width"/> in effective pixels — the
    /// native port of the web responsive grid (web/src/components/data-display/KpiOverviewCard.tsx L87-L88). A
    /// positive <see cref="GridColumns"/> override pins the count at every width; otherwise the count follows the
    /// Tailwind breakpoints (2 below <see cref="KpiOverviewCardRegistration.SmallBreakpoint"/>, 3 below
    /// <see cref="KpiOverviewCardRegistration.LargeBreakpoint"/>, 6 at or above it). An unmeasured width
    /// (≤ 0) resolves to the mobile-first base count, matching the web default-rendered column count.
    /// </summary>
    /// <param name="width">The available grid width in effective pixels.</param>
    /// <returns>The number of columns, always at least one.</returns>
    public int ResolveColumnCount(double width)
    {
        if (GridColumns is { } fixedColumns && fixedColumns > 0)
        {
            return fixedColumns;
        }

        if (double.IsNaN(width) || width <= 0 || width < KpiOverviewCardRegistration.SmallBreakpoint)
        {
            return KpiOverviewCardRegistration.NarrowColumns;
        }

        return width < KpiOverviewCardRegistration.LargeBreakpoint
            ? KpiOverviewCardRegistration.MediumColumns
            : KpiOverviewCardRegistration.WideColumns;
    }
}

/// <summary>
/// Pure, UI-thread-free projection of one <see cref="KpiOverviewCardInput"/> into a render-ready
/// <see cref="KpiOverviewCardDisplay"/> — the native port of the web card + ComparisonHeader bodies
/// (web/src/components/data-display/KpiOverviewCard.tsx L76-L103,
/// web/src/components/data-display/ComparisonHeader.tsx L52-L76). It normalises the header strings, composes the
/// period strip, decides which optional regions render and derives the Narrator name. It performs no unit math,
/// resolves no i18n keys (the web components are anonymous — every visible string is supplied already-localized
/// by the page) and touches no view framework, so both the WinUI view and the unit tests share one source of
/// truth.
/// </summary>
public static class KpiOverviewCardProjection
{
    /// <summary>
    /// Project <paramref name="input"/> into the render-ready display. Reproduces the web composition exactly:
    /// the header title + period strip, the optional headline-delta / actions accessory, the responsive KPI grid
    /// (or the empty state when there are no tiles), the optional muted secondary line and the optional footer.
    /// </summary>
    /// <param name="input">The presentational inputs; never null.</param>
    /// <returns>The render-ready projection.</returns>
    public static KpiOverviewCardDisplay Project(KpiOverviewCardInput input)
    {
        ArgumentNullException.ThrowIfNull(input);

        KpiOverviewCardHeader header = input.Header ?? new KpiOverviewCardHeader();
        string title = header.Title ?? string.Empty;
        string currentLabel = header.CurrentLabel ?? string.Empty;
        string comparisonLabel = header.ComparisonLabel ?? string.Empty;
        bool hasComparisonLabel = !string.IsNullOrEmpty(comparisonLabel);

        string periodText = hasComparisonLabel
            ? currentLabel + KpiOverviewCardRegistration.PeriodSeparator + comparisonLabel
            : currentLabel;

        // web ComparisonHeader exposes the <h3> as the section heading; the card region's Narrator name is that
        // title when present, else the period strip so the region is never anonymous to assistive tech.
        string accessibleName = !string.IsNullOrEmpty(title) ? title : periodText;

        int? gridColumns = input.GridColumns is { } columns && columns > 0 ? columns : null;

        return new KpiOverviewCardDisplay(
            title,
            currentLabel,
            comparisonLabel,
            hasComparisonLabel,
            periodText,
            input.HasHeadlineDelta,
            input.HasActions,
            input.HasSecondary,
            input.HasFooter,
            input.KpiCount > 0,
            gridColumns,
            accessibleName);
    }
}

/// <summary>
/// PII-safe diagnostics for the KpiOverviewCard surface (P1/S11 diagnostics contract). The card frames
/// user-facing KPI values, so the collector records only the operational <see cref="RecordViewOpened"/> signal
/// with the surface slug — never a title, label or metric value. Thread-safe; mirrors the other shared-surface
/// diagnostics collectors.
/// </summary>
public sealed class KpiOverviewCardDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event string is forwarded to.</param>
    public KpiOverviewCardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=KpiOverviewCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={KpiOverviewCardRegistration.Slug}");
    }
}
