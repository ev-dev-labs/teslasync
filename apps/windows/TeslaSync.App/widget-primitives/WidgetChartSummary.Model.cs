using System.Globalization;
using System.Threading;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// Canonical metadata + the single localized string for the WidgetChartSummary widget primitive — the native
/// analogue of the module-level identity of the web source
/// (web/src/features/dashboard/widgets/shared/WidgetChartSummary.tsx). The web component is a pure presentational
/// building block shared by many dashboard widgets: a compact row of labelled stat figures sitting above a chart
/// slot, with a single early-return empty branch that delegates to the shared <c>EmptyState</c>
/// (<c>message={emptyMessage ?? 'No data available'}</c>). It reads no network data and renders no titles of its
/// own, so this carries the diagnostics slug, the root automation id, the status role the empty branch's
/// <c>EmptyState</c> exposes (web <c>role="status"</c>), the one i18n key behind the default empty message, and the
/// layout metrics the web Tailwind classes encode (the 10px stat label/unit size, the 14px semibold value size,
/// the 2-/4-unit gaps, the 24rem container breakpoint at which the stat row relaxes from a 2-column grid into a
/// horizontal flex row, and the chart's top margin). UI-free so every value is asserted headlessly.
/// </summary>
public static class WidgetChartSummaryRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "WidgetChartSummary";

    /// <summary>
    /// The root automation id the view stamps on itself. The web component declares no <c>data-testid</c> (it is an
    /// anonymous presentational wrapper), so this is the native-only stable hook UI-automation tests target.
    /// </summary>
    public const string RootAutomationId = "widget-chart-summary";

    /// <summary>
    /// The accessibility role the empty branch exposes — a polite status region. The web component's only
    /// role-bearing branch is the shared <c>EmptyState</c> it returns when <c>isEmpty</c> (web <c>role="status"</c>);
    /// the populated stats/chart branch is a plain presentational column with no role of its own.
    /// </summary>
    public const string StatusRole = "status";

    /// <summary>
    /// i18n key behind the default empty message (web <c>emptyMessage ?? 'No data available'</c>). The fallback is
    /// the web literal verbatim; the key already exists in the P1/S10 catalogue under
    /// <c>translation.common.noData</c> (Strings/{lang}/Resources.resw).
    /// </summary>
    public const string DefaultEmptyMessageKey = "translation.common.noData";

    /// <summary>English fallback for <see cref="DefaultEmptyMessageKey"/> — the web default <c>'No data available'</c>, verbatim.</summary>
    public const string DefaultEmptyMessageFallback = "No data available";

    /// <summary>Stat label and unit font size in DIPs (web <c>text-[10px]</c>).</summary>
    public const double MicroFontSize = 10;

    /// <summary>Stat value font size in DIPs (web <c>text-sm</c>).</summary>
    public const double ValueFontSize = 14;

    /// <summary>Stat value font weight (web <c>font-semibold</c>).</summary>
    public const double ValueFontWeight = 600;

    /// <summary>Stat label / unit font weight (web default <c>font-normal</c>).</summary>
    public const double MutedFontWeight = 400;

    /// <summary>Stat-cell gap in the default 2-column grid and compact mode in DIPs (web <c>gap-2</c>).</summary>
    public const double CompactGap = 8;

    /// <summary>Stat-cell gap once the row relaxes into a horizontal flex row in DIPs (web <c>@sm:gap-4</c>).</summary>
    public const double WideGap = 16;

    /// <summary>Left margin of the unit suffix beside the value in DIPs (web <c>ml-0.5</c>).</summary>
    public const double UnitLeftMargin = 2;

    /// <summary>Top margin of the chart slot below the stat row in DIPs (web <c>mt-2</c>).</summary>
    public const double ChartTopMargin = 8;

    /// <summary>
    /// The control width in DIPs at which the non-compact stat row relaxes from the mobile-safe 2-column grid into a
    /// horizontal flex row (web container query <c>@sm</c> ≈ 24rem = 384px). At or above this width each stat gets
    /// its own column; below it (and always in compact mode) the stats wrap two-per-row.
    /// </summary>
    public const double HorizontalBreakpointDip = 384;

    /// <summary>The default number of columns the stat row wraps into below the breakpoint and in compact mode (web <c>grid-cols-2</c>).</summary>
    public const int DefaultColumns = 2;

    /// <summary>Resolve the default empty message (web <c>'No data available'</c>) through the i18n facade.</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveDefaultEmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(DefaultEmptyMessageKey, DefaultEmptyMessageFallback);
    }
}

/// <summary>
/// One labelled stat figure in the summary row — the native analogue of the web <c>ChartSummaryStat</c> interface
/// (web/src/features/dashboard/widgets/shared/WidgetChartSummary.tsx L5-L9, <c>{ label, value, unit? }</c>). The
/// web <c>value</c> is <c>string | number</c>; React coerces it to a string at render time, so this carries the
/// already-stringified value and offers <see cref="Number"/> for the numeric case (invariant formatting, matching
/// the unformatted interpolation the dashboard widgets feed this primitive). Pure data (no WinUI types) so the
/// projection and view-model are unit-tested without a UI host.
/// </summary>
public sealed record ChartSummaryStat
{
    /// <summary>Creates a stat from an already-stringified value.</summary>
    /// <param name="label">The stat label (web <c>label</c>).</param>
    /// <param name="value">The stringified value (web <c>value</c> coerced to a string).</param>
    /// <param name="unit">The optional unit suffix (web <c>unit</c>); null/empty hides it.</param>
    public ChartSummaryStat(string label, string value, string? unit = null)
    {
        Label = label ?? string.Empty;
        Value = value ?? string.Empty;
        Unit = unit;
    }

    /// <summary>The stat label rendered above the value (web <c>label</c>).</summary>
    public string Label { get; init; }

    /// <summary>The stringified value (web <c>value</c>, a <c>string | number</c> coerced to a string).</summary>
    public string Value { get; init; }

    /// <summary>The optional unit suffix beside the value (web <c>unit</c>); null/empty hides it.</summary>
    public string? Unit { get; init; }

    /// <summary>
    /// Create a stat from a numeric value (the web <c>value: number</c> case), formatting it with the invariant
    /// culture so the rendered string matches the unformatted figure the dashboard widgets interpolate.
    /// </summary>
    /// <param name="label">The stat label (web <c>label</c>).</param>
    /// <param name="value">The numeric value (web <c>value</c>).</param>
    /// <param name="unit">The optional unit suffix (web <c>unit</c>).</param>
    public static ChartSummaryStat Number(string label, double value, string? unit = null) =>
        new(label, value.ToString(CultureInfo.InvariantCulture), unit);
}

/// <summary>
/// The inputs the WidgetChartSummary primitive renders from — the native analogue of the props the web
/// <c>&lt;WidgetChartSummary&gt;</c> receives from its parent widget
/// (web/src/features/dashboard/widgets/shared/WidgetChartSummary.tsx L11-L18). The web <c>chart</c> and
/// <c>emptyIcon</c> props are <c>ReactNode</c> slots: the chart is hosted by the view as a live
/// <see cref="Microsoft.UI.Xaml.UIElement"/>; the empty icon is modelled here as an optional Segoe Fluent glyph
/// (<see cref="EmptyIconGlyph"/>), the native idiom for the lucide node the web passes. Everything else is plain
/// data so the projection and view-model are unit-tested without a UI host.
/// </summary>
public sealed record WidgetChartSummaryInput
{
    /// <summary>The labelled stat figures shown above the chart (web <c>stats</c>); never null, defaults to empty.</summary>
    public IReadOnlyList<ChartSummaryStat> Stats { get; init; } = Array.Empty<ChartSummaryStat>();

    /// <summary>
    /// Whether the primitive renders in compact mode (web <c>compact</c>): the stat row is always forced into the
    /// 2-column grid and the chart slot is omitted (web <c>{!compact &amp;&amp; …}</c>).
    /// </summary>
    public bool Compact { get; init; }

    /// <summary>
    /// An optional caller override for the empty message (web <c>emptyMessage</c>). A null — not an empty string —
    /// falls back to the localized default, mirroring the web <c>emptyMessage ?? 'No data available'</c>.
    /// </summary>
    public string? EmptyMessage { get; init; }

    /// <summary>
    /// Optional Segoe Fluent glyph for the empty state's icon (the native form of the web <c>emptyIcon</c> node);
    /// null/empty lets the empty branch render without an icon, mirroring the web <c>{icon &amp;&amp; …}</c> guard.
    /// </summary>
    public string? EmptyIconGlyph { get; init; }

    /// <summary>
    /// Whether the primitive shows the empty state instead of the stats / chart (web <c>isEmpty</c>). When true the
    /// web component returns early with <c>&lt;EmptyState … /&gt;</c>, so the stats and chart are not rendered.
    /// </summary>
    public bool IsEmpty { get; init; }
}

/// <summary>
/// The render-ready projection of one <see cref="ChartSummaryStat"/> — the value pre-composed with its optional
/// unit and a coherent accessible reading. Mirrors the web stat cell
/// (web/src/features/dashboard/widgets/shared/WidgetChartSummary.tsx L45-L57): the truncated label, the semibold
/// value and the optional muted unit suffix.
/// </summary>
public sealed record StatCellDisplay
{
    internal StatCellDisplay(string label, string value, string unit, bool hasUnit, string accessibleName)
    {
        Label = label;
        Value = value;
        Unit = unit;
        HasUnit = hasUnit;
        AccessibleName = accessibleName;
    }

    /// <summary>The stat label (web <c>label</c>).</summary>
    public string Label { get; }

    /// <summary>The stringified value (web <c>value</c>).</summary>
    public string Value { get; }

    /// <summary>The unit suffix, or empty when none (web <c>unit</c>).</summary>
    public string Unit { get; }

    /// <summary>Whether the unit suffix should be drawn (web <c>{stat.unit &amp;&amp; …}</c>).</summary>
    public bool HasUnit { get; }

    /// <summary>The composed "label, value unit" text the cell reports to Narrator as one coherent reading.</summary>
    public string AccessibleName { get; }
}

/// <summary>
/// The render-ready projection of one <see cref="WidgetChartSummaryInput"/> — everything the WinUI view needs to
/// draw a frame without recomputing anything, so the view stays a thin renderer and the composition is verified
/// headlessly. It is the native analogue of the values the web component body derives
/// (web/src/features/dashboard/widgets/shared/WidgetChartSummary.tsx L20-L63): the early empty branch
/// (<see cref="IsEmpty"/> + the resolved <see cref="EmptyMessage"/> + the optional <see cref="EmptyIconGlyph"/>),
/// the stat row (<see cref="Stats"/> + the <see cref="ShowStats"/> guard, web <c>stats.length &gt; 0</c>) and the
/// chart slot guard (<see cref="ShowChart"/>, web <c>!compact</c>).
/// </summary>
public sealed record WidgetChartSummaryDisplay
{
    internal WidgetChartSummaryDisplay(
        bool isEmpty,
        string emptyMessage,
        string? emptyIconGlyph,
        IReadOnlyList<StatCellDisplay> stats,
        bool showStats,
        bool compact,
        bool showChart)
    {
        IsEmpty = isEmpty;
        EmptyMessage = emptyMessage;
        EmptyIconGlyph = emptyIconGlyph;
        Stats = stats;
        ShowStats = showStats;
        Compact = compact;
        ShowChart = showChart;
    }

    /// <summary>Whether the empty state is shown in place of the stats / chart (web <c>isEmpty</c>).</summary>
    public bool IsEmpty { get; }

    /// <summary>The resolved empty message — the caller override or the localized default (web <c>emptyMessage ?? 'No data available'</c>).</summary>
    public string EmptyMessage { get; }

    /// <summary>The optional empty-state glyph (native form of web <c>emptyIcon</c>); null renders no icon.</summary>
    public string? EmptyIconGlyph { get; }

    /// <summary>The projected stat cells (web <c>stats.map(…)</c>).</summary>
    public IReadOnlyList<StatCellDisplay> Stats { get; }

    /// <summary>Whether the stat row should be drawn (web <c>stats.length &gt; 0</c>).</summary>
    public bool ShowStats { get; }

    /// <summary>Whether the primitive is in compact mode (web <c>compact</c>): forces the 2-column stat grid.</summary>
    public bool Compact { get; }

    /// <summary>Whether the chart slot should be drawn below the stats (web <c>{!compact &amp;&amp; …}</c>).</summary>
    public bool ShowChart { get; }
}

/// <summary>
/// Pure, UI-thread-free projection of one <see cref="WidgetChartSummaryInput"/> into a render-ready
/// <see cref="WidgetChartSummaryDisplay"/> — the native port of the web component body
/// (web/src/features/dashboard/widgets/shared/WidgetChartSummary.tsx L20-L63). It resolves the empty message,
/// projects each stat into a value/unit/accessible-name triple, and reproduces the two render guards
/// (<c>stats.length &gt; 0</c> and <c>!compact</c>). It touches no view framework, so the WinUI view and the unit
/// tests share one source of truth.
/// </summary>
public static class WidgetChartSummaryProjection
{
    /// <summary>
    /// Project <paramref name="input"/>, resolving every string through <paramref name="localizer"/>. Reproduces the
    /// web body: the early <c>isEmpty</c> branch's <c>emptyMessage ?? 'No data available'</c>, the per-stat
    /// value/unit composition, the <c>stats.length &gt; 0</c> stat-row guard and the <c>!compact</c> chart guard.
    /// </summary>
    /// <param name="input">The resolved props (web component props); never null.</param>
    /// <param name="localizer">The i18n facade every string resolves through; never null.</param>
    public static WidgetChartSummaryDisplay Project(WidgetChartSummaryInput input, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(localizer);

        // web L29: message={emptyMessage ?? 'No data available'} — only a null (not an empty string) falls back.
        string emptyMessage = input.EmptyMessage ?? WidgetChartSummaryRegistration.ResolveDefaultEmptyMessage(localizer);

        IReadOnlyList<ChartSummaryStat> rawStats = input.Stats ?? Array.Empty<ChartSummaryStat>();
        var stats = new List<StatCellDisplay>(rawStats.Count);
        foreach (ChartSummaryStat stat in rawStats)
        {
            stats.Add(ProjectStat(stat));
        }

        bool showStats = stats.Count > 0;        // web L34: {stats.length > 0 && …}
        bool showChart = !input.Compact;         // web L61: {!compact && …}
        string? emptyIconGlyph = string.IsNullOrEmpty(input.EmptyIconGlyph) ? null : input.EmptyIconGlyph;

        return new WidgetChartSummaryDisplay(
            isEmpty: input.IsEmpty,
            emptyMessage: emptyMessage,
            emptyIconGlyph: emptyIconGlyph,
            stats: stats,
            showStats: showStats,
            compact: input.Compact,
            showChart: showChart);
    }

    private static StatCellDisplay ProjectStat(ChartSummaryStat stat)
    {
        string label = stat.Label ?? string.Empty;
        string value = stat.Value ?? string.Empty;
        bool hasUnit = !string.IsNullOrEmpty(stat.Unit);   // web L50: {stat.unit && …}
        string unit = hasUnit ? stat.Unit! : string.Empty;

        return new StatCellDisplay(label, value, unit, hasUnit, ComposeCellName(label, value, unit, hasUnit));
    }

    // The web stat cell renders label + value (+ unit) as separate spans; Narrator reads them as one coherent
    // figure, so the cell's accessible name is the visible text joined: "<label>, <value> <unit>".
    private static string ComposeCellName(string label, string value, string unit, bool hasUnit)
    {
        string figure = hasUnit ? $"{value} {unit}" : value;
        if (string.IsNullOrEmpty(label))
        {
            return figure;
        }

        return string.IsNullOrEmpty(figure) ? label : $"{label}, {figure}";
    }
}

/// <summary>
/// PII-safe diagnostics for the WidgetChartSummary surface (P1/S11 diagnostics contract). The primitive renders
/// only caller-supplied labels / values, but to stay consistent with the peer surfaces the collector records ONLY
/// the operational <c>view.opened</c> event with the surface slug — never the stats, the values or the message.
/// Thread-safe; mirrors the other shared-surface diagnostics collectors.
/// </summary>
public sealed class WidgetChartSummaryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public WidgetChartSummaryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WidgetChartSummary</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WidgetChartSummaryRegistration.Slug}");
    }
}
