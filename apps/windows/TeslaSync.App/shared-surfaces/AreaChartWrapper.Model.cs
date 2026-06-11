using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.AreaChartWrapperSurface;

/// <summary>
/// Canonical metadata for the <c>AreaChartWrapper</c> shared surface — the native mirror of the web
/// component at <c>web/src/components/charts/AreaChartWrapper.tsx</c>. The web component is anonymous
/// (it renders no titles or labels of its own — just a full-width <c>div</c> wrapping a recharts
/// <c>ResponsiveContainer</c>/<c>AreaChart</c>), so this carries only the diagnostics slug the surface
/// registers under.
/// </summary>
public static class AreaChartWrapperRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "AreaChartWrapper";
}

/// <summary>
/// One series configuration — the native mirror of the web <c>SeriesConfig</c>
/// (<c>{ key; label; color }</c>) every <c>AreaChartWrapper</c> caller passes in its <c>series</c> prop
/// (web/src/components/charts/AreaChartWrapper.tsx). <see cref="Key"/> is the web <c>key</c> (the
/// <c>dataKey</c> each row's value is read from), <see cref="Label"/> is the web <c>label</c> surfaced in
/// the tooltip, and the web's arbitrary hex <c>color</c> is mapped to the W1 tokenized chart palette: a
/// caller picks a categorical slot through <see cref="ColorIndex"/> (cycled across the eight brand chart
/// brushes) or a semantic <see cref="Role"/> that overrides it, so colours flow from design tokens rather
/// than hard-coded hex (the codebase chart contract: "never hard-coded hex"). <see cref="Unit"/> and
/// <see cref="Decimals"/> reproduce the web chart-level <c>yFormatter</c> at the native render boundary
/// (the cartesian tooltip formats each value with the series unit and precision). Pure data — no WinUI
/// types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record AreaChartWrapperSeries
{
    /// <summary>Creates a series config from its required identity (web <c>key</c> + <c>label</c>).</summary>
    /// <param name="key">The web <c>key</c> / <c>dataKey</c> each row's value is read from.</param>
    /// <param name="label">The web <c>label</c> surfaced in the tooltip and accessible summary.</param>
    public AreaChartWrapperSeries(string key, string label)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        ArgumentException.ThrowIfNullOrEmpty(label);
        Key = key;
        Label = label;
    }

    /// <summary>The web <c>key</c> / <c>dataKey</c> the row value is read from (stable series identity).</summary>
    public string Key { get; }

    /// <summary>The web <c>label</c> shown in the tooltip and the accessible chart summary.</summary>
    public string Label { get; }

    /// <summary>
    /// Categorical brand-palette slot for the area colour (the tokenized mapping of the web hex
    /// <c>color</c>). Null falls back to the series' ordinal position, so a caller that supplies no colour
    /// still gets a distinct, theme-aware brush per series.
    /// </summary>
    public int? ColorIndex { get; init; }

    /// <summary>Optional semantic role; when set it overrides <see cref="ColorIndex"/> (web semantic hex).</summary>
    public ChartRole Role { get; init; } = ChartRole.None;

    /// <summary>Optional value unit appended in the tooltip (the native mapping of the web <c>yFormatter</c> suffix).</summary>
    public string? Unit { get; init; }

    /// <summary>Optional fixed decimal places for tooltip values (the native mapping of <c>yFormatter</c> precision).</summary>
    public int? Decimals { get; init; }
}

/// <summary>
/// One row of the chart's data — the native mirror of a single entry of the web <c>data</c> prop together
/// with the <c>xKey</c> extraction (web/src/components/charts/AreaChartWrapper.tsx reads <c>row[xKey]</c>
/// for the X position and <c>row[s.key]</c> for each series' Y). <see cref="X"/> is the already-extracted
/// raw X value (the web <c>row[xKey]</c>, stringified) and <see cref="Values"/> maps each series
/// <see cref="AreaChartWrapperSeries.Key"/> to its numeric Y. Pure data — no WinUI types.
/// </summary>
/// <param name="X">The raw X value (web <c>row[xKey]</c>); the optional formatter shapes its display label.</param>
/// <param name="Values">Per-series Y values keyed by <see cref="AreaChartWrapperSeries.Key"/> (web <c>row[s.key]</c>).</param>
public readonly record struct AreaChartWrapperRow(string X, IReadOnlyDictionary<string, double> Values);

/// <summary>
/// The consumer-owned async phase a <see cref="AreaChartWrapperModel"/> is in. The web
/// <c>AreaChartWrapper</c> is purely presentational — it owns no loading / error lifecycle (its consumers,
/// e.g. a page's <c>ChartContainer</c> / <c>QueryError</c>, drive that around it). The native surface
/// renders that lifecycle inline so it never collapses to a blank box, with the consuming surface driving
/// the phase down alongside the data.
/// </summary>
public enum AreaChartWrapperPhase
{
    /// <summary>The data is in flight — render the chart loading skeleton.</summary>
    Loading,

    /// <summary>Data resolved (possibly empty, possibly stale/offline) — render the chart or the empty surface.</summary>
    Ready,

    /// <summary>The read failed with no cached snapshot — render the error surface with a retry affordance.</summary>
    Error,
}

/// <summary>
/// The render-time data model the <c>AreaChartWrapper</c> view binds to. The web component takes the
/// presentational props directly (<c>data</c>, <c>xKey</c>'s extracted rows, <c>series</c>, <c>height</c>,
/// <c>xFormatter</c>); this native model wraps that same payload in the standard async envelope
/// (<see cref="Phase"/> plus the freshness flags) the consuming surface drives, so every P2 state renders
/// inline. Pure data — no WinUI types — so <see cref="AreaChartWrapperProjection"/> is verified headlessly.
/// </summary>
/// <param name="Phase">The consumer-owned async phase.</param>
/// <param name="Rows">The chart rows (the web <c>data</c> prop after <c>xKey</c> extraction).</param>
/// <param name="Series">The series configuration list (the web <c>series</c> prop).</param>
/// <param name="Height">The chart height in effective pixels (web <c>height</c>, default 300).</param>
/// <param name="IsStale">True when the shown snapshot is older than the freshness window.</param>
/// <param name="IsOffline">True when the snapshot is served from cache while offline.</param>
/// <param name="ErrorDetail">Optional resolved error/offline detail surfaced in the error body.</param>
public sealed record AreaChartWrapperModel(
    AreaChartWrapperPhase Phase,
    IReadOnlyList<AreaChartWrapperRow> Rows,
    IReadOnlyList<AreaChartWrapperSeries> Series,
    double Height = AreaChartWrapperProjection.DefaultHeight,
    bool IsStale = false,
    bool IsOffline = false,
    string? ErrorDetail = null)
{
    /// <summary>
    /// The optional X-axis display formatter (the web <c>xFormatter</c>): applied to each row's raw
    /// <see cref="AreaChartWrapperRow.X"/> to produce the point's display label (surfaced as the tooltip
    /// header on the native ordinal-X cartesian surface). Identity when null.
    /// </summary>
    public Func<string, string>? XFormatter { get; init; }

    /// <summary>The initial model: the chart's data is in flight and nothing has arrived yet.</summary>
    public static AreaChartWrapperModel Pending { get; } = new(
        AreaChartWrapperPhase.Loading,
        Array.Empty<AreaChartWrapperRow>(),
        Array.Empty<AreaChartWrapperSeries>());

    /// <summary>A resolved, fresh model with no rows/series — the empty state.</summary>
    public static AreaChartWrapperModel Empty { get; } = new(
        AreaChartWrapperPhase.Ready,
        Array.Empty<AreaChartWrapperRow>(),
        Array.Empty<AreaChartWrapperSeries>());

    /// <summary>A resolved, fresh model carrying the supplied rows and series.</summary>
    /// <param name="rows">The chart rows (web <c>data</c>).</param>
    /// <param name="series">The series configuration (web <c>series</c>).</param>
    /// <param name="height">The chart height (web <c>height</c>); defaults to 300.</param>
    /// <param name="xFormatter">The optional X-axis display formatter (web <c>xFormatter</c>).</param>
    public static AreaChartWrapperModel Loaded(
        IReadOnlyList<AreaChartWrapperRow> rows,
        IReadOnlyList<AreaChartWrapperSeries> series,
        double height = AreaChartWrapperProjection.DefaultHeight,
        Func<string, string>? xFormatter = null) =>
        new(AreaChartWrapperPhase.Ready, rows, series, height) { XFormatter = xFormatter };

    /// <summary>A resolved model whose snapshot is stale (older than the freshness window).</summary>
    /// <param name="rows">The chart rows (web <c>data</c>).</param>
    /// <param name="series">The series configuration (web <c>series</c>).</param>
    /// <param name="height">The chart height (web <c>height</c>); defaults to 300.</param>
    public static AreaChartWrapperModel StaleSnapshot(
        IReadOnlyList<AreaChartWrapperRow> rows,
        IReadOnlyList<AreaChartWrapperSeries> series,
        double height = AreaChartWrapperProjection.DefaultHeight) =>
        new(AreaChartWrapperPhase.Ready, rows, series, height, IsStale: true);

    /// <summary>A resolved model served from cache while offline.</summary>
    /// <param name="rows">The chart rows (web <c>data</c>).</param>
    /// <param name="series">The series configuration (web <c>series</c>).</param>
    /// <param name="height">The chart height (web <c>height</c>); defaults to 300.</param>
    public static AreaChartWrapperModel OfflineSnapshot(
        IReadOnlyList<AreaChartWrapperRow> rows,
        IReadOnlyList<AreaChartWrapperSeries> series,
        double height = AreaChartWrapperProjection.DefaultHeight) =>
        new(AreaChartWrapperPhase.Ready, rows, series, height, IsOffline: true);

    /// <summary>A failed model with no cached snapshot — the error state.</summary>
    /// <param name="detail">Optional resolved error detail.</param>
    public static AreaChartWrapperModel Failed(string? detail = null) =>
        new(
            AreaChartWrapperPhase.Error,
            Array.Empty<AreaChartWrapperRow>(),
            Array.Empty<AreaChartWrapperSeries>(),
            ErrorDetail: detail);
}

/// <summary>
/// The mutually-exclusive surface state the <c>AreaChartWrapper</c> renders. The web source itself only
/// expresses the chart content (the area chart for whatever <c>data</c> it is given, and an implicit empty
/// plot when <c>data</c> is empty); the remaining branches are the standard native async chrome the
/// consuming surface drives. None is ever hidden — every state maps onto a visible surface so a chart never
/// collapses to a blank box.
/// </summary>
public enum AreaChartWrapperState
{
    /// <summary>Data in flight — chart skeleton chrome.</summary>
    Loading,

    /// <summary>Read failed with no cache — the <c>QueryError</c> equivalent with a retry affordance.</summary>
    Error,

    /// <summary>Resolved with no rows or no series to draw — the friendly empty surface.</summary>
    Empty,

    /// <summary>At least one row and one series, fresh — the area chart (web fall-through render).</summary>
    Ready,

    /// <summary>Shown snapshot is older than the freshness window — chart plus a stale chip.</summary>
    Stale,

    /// <summary>Snapshot served from cache while offline — cached chart plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The fully projected, render-ready view of the chart for one input model — the native analogue of what
/// the web <c>AreaChartWrapper</c> renders. Holds the projected native <see cref="Series"/> (one area per
/// web <c>SeriesConfig</c>), the chart <see cref="Height"/>, the active <see cref="State"/> (plus the
/// <see cref="ContainerState"/> the chart body maps onto), the <see cref="HasData"/> draw gate, the
/// per-state messages, the optional freshness <see cref="FreshnessChip"/>, the accessible
/// <see cref="AriaLabel"/> and the per-state <see cref="AutomationName"/>. Pure data so every branch is
/// asserted headlessly.
/// </summary>
/// <param name="State">The active mutually-exclusive surface state.</param>
/// <param name="ContainerState">The chart-body lifecycle state the visual chart frame maps onto.</param>
/// <param name="Series">The projected native area series (one per web <c>SeriesConfig</c>).</param>
/// <param name="Height">The chart height in effective pixels (web <c>height</c>).</param>
/// <param name="HasData">True with at least one row and one series to draw.</param>
/// <param name="EmptyMessage">Resolved empty-state message (shared <c>chart.noData</c>).</param>
/// <param name="ErrorTitle">Resolved error-state title (shared <c>error.loadFailed</c>).</param>
/// <param name="ErrorMessage">Resolved error-state body (model detail then shared <c>error.network.message</c>).</param>
/// <param name="LoadingMessage">Resolved loading-state message (shared <c>common.loading</c>).</param>
/// <param name="RetryLabel">Resolved retry affordance label (shared <c>common.retry</c>).</param>
/// <param name="FreshnessChip">Stale / offline chip text; null in every other state.</param>
/// <param name="AriaLabel">The composed accessible name for the chart figure (series labels).</param>
/// <param name="AutomationName">The spoken Narrator name for the whole surface in this state.</param>
public sealed record AreaChartWrapperDisplay(
    AreaChartWrapperState State,
    ChartState ContainerState,
    IReadOnlyList<ChartSeries> Series,
    double Height,
    bool HasData,
    string EmptyMessage,
    string ErrorTitle,
    string ErrorMessage,
    string LoadingMessage,
    string RetryLabel,
    string? FreshnessChip,
    string AriaLabel,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="AreaChartWrapperModel"/> to its <see cref="AreaChartWrapperDisplay"/>
/// — the native port of <c>web/src/components/charts/AreaChartWrapper.tsx</c>. Each web <c>SeriesConfig</c>
/// becomes a tokenized <see cref="ChartSeriesKind.Area"/> <see cref="ChartSeries"/>: every row contributes
/// one point keyed by its ordinal index (the native cartesian surface plots an ordinal X domain and
/// surfaces the formatted X label in its tooltip, the same shape the sibling trend charts use), with the
/// row's value for that series on Y (missing keys read as zero, the web <c>undefined</c> area gap), the
/// optional <c>xFormatter</c> applied to the raw X to build the point label, and the series colour resolved
/// from <see cref="AreaChartWrapperSeries.ColorIndex"/> (defaulting to the ordinal position) or its
/// semantic <see cref="ChartRole"/>. A model with no rows or no series renders the friendly empty surface
/// rather than a blank box. Every label resolves through the i18n facade with shared keys. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class AreaChartWrapperProjection
{
    /// <summary>The web default chart height (<c>height = 300</c>).</summary>
    public const double DefaultHeight = 300;

    /// <summary>Minimum rows required to draw the chart rather than the empty surface.</summary>
    public const int MinRowsToDraw = 1;

    /// <summary>Minimum series required to draw the chart rather than the empty surface.</summary>
    public const int MinSeriesToDraw = 1;

    private const string EmptyKey = "chart.noData";
    private const string EmptyFallback = "No data available";
    private const string ErrorTitleKey = "error.loadFailed";
    private const string ErrorTitleFallback = "Failed to load data";
    private const string ErrorMessageKey = "error.network.message";
    private const string ErrorMessageFallback = "Check your internet connection and try again.";
    private const string LoadingKey = "common.loading";
    private const string LoadingFallback = "Loading";
    private const string RetryKey = "common.retry";
    private const string RetryFallback = "Retry";
    private const string StaleKey = "common.stale";
    private const string StaleFallback = "Stale";
    private const string OfflineKey = "common.offline";
    private const string OfflineFallback = "Offline";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props plus the async envelope).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static AreaChartWrapperDisplay Project(AreaChartWrapperModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<AreaChartWrapperRow> rows = model.Rows ?? Array.Empty<AreaChartWrapperRow>();
        IReadOnlyList<AreaChartWrapperSeries> configs = model.Series ?? Array.Empty<AreaChartWrapperSeries>();

        IReadOnlyList<ChartSeries> series = BuildSeries(rows, configs, model.XFormatter);
        bool hasData = rows.Count >= MinRowsToDraw && configs.Count >= MinSeriesToDraw;

        string emptyMessage = localizer.GetString(EmptyKey, EmptyFallback);
        string errorTitle = localizer.GetString(ErrorTitleKey, ErrorTitleFallback);
        string errorMessage = ResolveError(model, localizer);
        string loadingMessage = localizer.GetString(LoadingKey, LoadingFallback);
        string retryLabel = localizer.GetString(RetryKey, RetryFallback);
        string staleLabel = localizer.GetString(StaleKey, StaleFallback);
        string offlineLabel = localizer.GetString(OfflineKey, OfflineFallback);

        AreaChartWrapperState state = SelectState(model, hasData);
        ChartState containerState = MapContainerState(state, hasData);
        string? chip = state switch
        {
            AreaChartWrapperState.Stale => staleLabel,
            AreaChartWrapperState.Offline => offlineLabel,
            _ => null,
        };

        string aria = BuildAriaLabel(configs, emptyMessage);

        return new AreaChartWrapperDisplay(
            State: state,
            ContainerState: containerState,
            Series: series,
            Height: NormalizeHeight(model.Height),
            HasData: hasData,
            EmptyMessage: emptyMessage,
            ErrorTitle: errorTitle,
            ErrorMessage: errorMessage,
            LoadingMessage: loadingMessage,
            RetryLabel: retryLabel,
            FreshnessChip: chip,
            AriaLabel: aria,
            AutomationName: BuildAutomationName(state, aria, emptyMessage, errorMessage, loadingMessage, chip));
    }

    // Each web `<Area dataKey={s.key} stroke={s.color}>` becomes a tokenized area series: every row keyed by
    // its ordinal index, the row's value for that series on Y (missing keys read as zero — the web area gap),
    // the formatted X carried as the point label (the native tooltip header), the categorical colour slot
    // (defaulting to the series position) or the semantic role, and the series unit / precision.
    private static IReadOnlyList<ChartSeries> BuildSeries(
        IReadOnlyList<AreaChartWrapperRow> rows,
        IReadOnlyList<AreaChartWrapperSeries> configs,
        Func<string, string>? xFormatter)
    {
        if (configs.Count == 0)
        {
            return Array.Empty<ChartSeries>();
        }

        var series = new List<ChartSeries>(configs.Count);
        for (int c = 0; c < configs.Count; c++)
        {
            AreaChartWrapperSeries config = configs[c];
            var points = new List<ChartPoint>(rows.Count);
            for (int r = 0; r < rows.Count; r++)
            {
                AreaChartWrapperRow row = rows[r];
                double y = ValueFor(row, config.Key);
                string label = FormatX(row.X, xFormatter);
                points.Add(new ChartPoint(r, y, label));
            }

            series.Add(new ChartSeries(config.Label, points)
            {
                Kind = ChartSeriesKind.Area,
                ColorIndex = config.ColorIndex ?? c,
                Role = config.Role,
                Unit = config.Unit,
                Decimals = config.Decimals,
            });
        }

        return series;
    }

    // web `row[s.key]`: the row's value for this series, or zero when the row carries no value for it
    // (the web `undefined` the area renders as a gap / baseline).
    private static double ValueFor(AreaChartWrapperRow row, string key)
    {
        if (row.Values is { } values && values.TryGetValue(key, out double value))
        {
            return value;
        }

        return 0;
    }

    // web `xFormatter ? xFormatter(value) : value`: the optional display formatter applied to the raw X, or
    // the raw X verbatim. The result is the point label the native cartesian tooltip surfaces as its header.
    private static string FormatX(string x, Func<string, string>? xFormatter)
    {
        string raw = x ?? string.Empty;
        return xFormatter is null ? raw : xFormatter(raw) ?? raw;
    }

    // Branch precedence mirrors the sibling charts: the consumer phase wins first (loading -> error), then
    // freshness wins over emptiness so a stale/offline chip survives an empty cached snapshot; a fresh
    // snapshot is Ready or Empty by the draw gate.
    private static AreaChartWrapperState SelectState(AreaChartWrapperModel model, bool hasData) => model.Phase switch
    {
        AreaChartWrapperPhase.Loading => AreaChartWrapperState.Loading,
        AreaChartWrapperPhase.Error => AreaChartWrapperState.Error,
        _ => model.IsOffline
            ? AreaChartWrapperState.Offline
            : model.IsStale
                ? AreaChartWrapperState.Stale
                : hasData
                    ? AreaChartWrapperState.Ready
                    : AreaChartWrapperState.Empty,
    };

    // The visual chart frame only knows loading / empty / error / ready; a stale or offline snapshot with
    // data still draws the chart (with a chip), while one without falls back to the empty body.
    private static ChartState MapContainerState(AreaChartWrapperState state, bool hasData) => state switch
    {
        AreaChartWrapperState.Loading => ChartState.Loading,
        AreaChartWrapperState.Error => ChartState.Error,
        AreaChartWrapperState.Empty => ChartState.Empty,
        AreaChartWrapperState.Stale => hasData ? ChartState.Ready : ChartState.Empty,
        AreaChartWrapperState.Offline => hasData ? ChartState.Ready : ChartState.Empty,
        _ => ChartState.Ready,
    };

    private static string ResolveError(AreaChartWrapperModel model, ILocalizer localizer)
    {
        if (!string.IsNullOrWhiteSpace(model.ErrorDetail))
        {
            return model.ErrorDetail!;
        }

        return localizer.GetString(ErrorMessageKey, ErrorMessageFallback);
    }

    // The chart figure's accessible name: the localized series labels joined, so a non-visual user hears
    // which series the area chart plots. Falls back to the empty message when there is no series.
    private static string BuildAriaLabel(IReadOnlyList<AreaChartWrapperSeries> configs, string emptyMessage)
    {
        if (configs.Count == 0)
        {
            return emptyMessage;
        }

        var labels = new string[configs.Count];
        for (int i = 0; i < configs.Count; i++)
        {
            labels[i] = configs[i].Label;
        }

        return string.Join(", ", labels);
    }

    private static string BuildAutomationName(
        AreaChartWrapperState state,
        string aria,
        string emptyMessage,
        string errorMessage,
        string loadingMessage,
        string? chip) => state switch
        {
            AreaChartWrapperState.Loading => loadingMessage,
            AreaChartWrapperState.Error => errorMessage,
            AreaChartWrapperState.Empty => emptyMessage,
            AreaChartWrapperState.Stale => string.Format(CultureInfo.CurrentCulture, "{0}, {1}", aria, chip),
            AreaChartWrapperState.Offline => string.Format(CultureInfo.CurrentCulture, "{0}, {1}", aria, chip),
            _ => aria,
        };

    // web `height = 300`: a non-positive or non-finite height falls back to the default so the chart always
    // reserves a visible area rather than collapsing.
    private static double NormalizeHeight(double height) =>
        double.IsFinite(height) && height > 0 ? height : DefaultHeight;
}

/// <summary>
/// PII-safe diagnostics for the <c>AreaChartWrapper</c> surface (P1/S11 diagnostics contract). The chart can
/// plot user telemetry, so the collector records only the operational <c>view.opened</c> event with the
/// surface slug — never a data value, series label or row count. Thread-safe.
/// </summary>
public sealed class AreaChartWrapperDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to; null discards them.</param>
    public AreaChartWrapperDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AreaChartWrapper</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AreaChartWrapperRegistration.Slug}");
    }
}
