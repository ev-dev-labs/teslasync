using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The chart layout the <c>SignalChartPanel</c> renders — the native mirror of the web
/// <c>SignalChartMode</c> union (<c>'overlay' | 'grid' | 'auto'</c>) in
/// web/src/features/telemetry/components/SignalChartPanel.tsx. <see cref="Overlay"/> stacks every series on
/// one chart, <see cref="Grid"/> draws one small-multiples cell per series, and <see cref="Auto"/> stays
/// overlay until the selected-signal count exceeds the grid threshold.
/// </summary>
public enum SignalChartMode
{
    /// <summary>Single chart with all series stacked (web <c>'overlay'</c>).</summary>
    Overlay,

    /// <summary>One small-multiples cell per series (web <c>'grid'</c>).</summary>
    Grid,

    /// <summary>Overlay until the grid threshold is exceeded, then grid (web <c>'auto'</c>).</summary>
    Auto,
}

/// <summary>
/// The mutually-exclusive body branch the <c>SignalChartPanel</c> surface renders — the native union of the
/// branches the web component draws inside its <c>GlassPanel</c>
/// (web/src/features/telemetry/components/SignalChartPanel.tsx). The web component owns no data fetching: it
/// is a pure child of the Signal Explorer / Workspace pages that pass it the already-loaded <c>data</c> +
/// <c>selectedSignals</c> and a <c>loading</c> flag, so the branches are a direct function of the input
/// <see cref="SignalChartPanelModel"/> — there is no fetch-driven error / stale / offline branch to reproduce
/// here (the parent pages own the query lifecycle and render those once for the whole workspace before this
/// panel is shown, exactly as the sibling presentational charts <c>BatteryLevelChart</c> /
/// <c>TemperatureTrendChart</c> do). Every branch maps onto a visible surface; the header is always shown and
/// only the body swaps, so the panel never collapses to a blank box.
/// </summary>
public enum SignalChartPanelState
{
    /// <summary>The parent's first fetch is in flight and not live (web <c>loading &amp;&amp; !isLive</c>) — skeleton chrome.</summary>
    Loading,

    /// <summary>At least one sample is loaded and the resolved layout is overlay — the stacked multi-line chart.</summary>
    Overlay,

    /// <summary>At least one sample is loaded and the resolved layout is grid — the small-multiples grid.</summary>
    Grid,

    /// <summary>Live with no samples yet (web <c>isLive</c> branch) — the friendly "waiting for signal data" surface.</summary>
    LiveWaiting,

    /// <summary>Historical with no samples (web fall-through) — the friendly "no data for this time range" surface.</summary>
    Empty,
}

/// <summary>
/// One per-signal min/max range — the native mirror of the two fields the web <c>SignalChartPanel</c> reads
/// from each <c>SignalStat</c> (<c>web/src/features/telemetry/hooks/useLiveSignalStream</c>) when it decides
/// whether a second Y axis is warranted. The other <c>SignalStat</c> fields are unused by this surface. Pure
/// data — no WinUI types — so the dual-axis decision is unit-tested without a UI host.
/// </summary>
/// <param name="Min">The series minimum (web <c>SignalStat.min</c>).</param>
/// <param name="Max">The series maximum (web <c>SignalStat.max</c>).</param>
public sealed record SignalChartStat(double Min, double Max);

/// <summary>
/// One render-time sample row — the native shape of one entry in the web <c>data: Record&lt;string, unknown&gt;[]</c>
/// the panel plots. <see cref="Timestamp"/> is the raw ISO timestamp the web reads as the <c>dataKey="timestamp"</c>
/// X value and formats through <c>useDateFormat().formatTime</c>; <see cref="Values"/> maps each pinned signal
/// name to its reading for this row (the web <c>row[sig]</c> each <c>&lt;Line dataKey={sig} /&gt;</c> reads),
/// nullable so a row that did not carry a given signal is a chart gap rather than a misleading zero (web
/// <c>connectNulls</c>). Pure data — no WinUI types.
/// </summary>
/// <param name="Timestamp">Raw ISO sample timestamp, or null (web <c>row.timestamp</c>).</param>
/// <param name="Values">Per-signal readings for this row, each nullable (web <c>row[sig]</c>).</param>
public sealed record SignalChartSample(string? Timestamp, IReadOnlyDictionary<string, double?> Values);

/// <summary>
/// The render-time data model the <c>SignalChartPanel</c> view binds to — the native analogue of the web
/// <c>SignalChartPanelProps</c> (web/src/features/telemetry/components/SignalChartPanel.tsx), minus the
/// pixel-layout props (<c>height</c> / <c>gridCellHeight</c> / <c>className</c>) which stay on the view. The
/// component is presentational: this model carries the pinned <see cref="SelectedSignals"/>, the loaded
/// <see cref="Data"/> rows and per-signal <see cref="Stats"/>, plus the live / loading flags and the header
/// counters. User-facing labels are resolved from the i18n facade by the projection, not passed in. Pure data
/// — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="SelectedSignals">The pinned signal names, in legend/colour order (web <c>selectedSignals</c>).</param>
/// <param name="Data">The loaded sample rows, ascending by timestamp (web <c>data</c>).</param>
/// <param name="Stats">Per-signal min/max ranges driving the dual-axis decision (web <c>stats</c>).</param>
public sealed record SignalChartPanelModel(
    IReadOnlyList<string> SelectedSignals,
    IReadOnlyList<SignalChartSample> Data,
    IReadOnlyList<SignalChartStat> Stats)
{
    /// <summary>The web default <c>gridAutoThreshold</c> (overlay flips to grid above this many signals).</summary>
    public const int DefaultGridAutoThreshold = 8;

    /// <summary>Whether the panel uses the live visual treatment (web <c>isLive</c>; default false).</summary>
    public bool IsLive { get; init; }

    /// <summary>Whether the parent's first (historical) fetch is in flight (web <c>loading</c>; default false).</summary>
    public bool Loading { get; init; }

    /// <summary>Total points loaded for the historical header annotation, or null (web <c>pointsLoaded</c>).</summary>
    public long? PointsLoaded { get; init; }

    /// <summary>Live event count for the live header annotation, or null (web <c>liveEventCount</c>).</summary>
    public long? LiveEventCount { get; init; }

    /// <summary>An explicit panel title that wins over the localized default, or null (web <c>title</c>).</summary>
    public string? Title { get; init; }

    /// <summary>The requested layout mode (web <c>chartMode</c>; default <see cref="SignalChartMode.Auto"/>).</summary>
    public SignalChartMode ChartMode { get; init; } = SignalChartMode.Auto;

    /// <summary>The auto-mode overlay→grid flip threshold (web <c>gridAutoThreshold</c>; default 8).</summary>
    public int GridAutoThreshold { get; init; } = DefaultGridAutoThreshold;

    /// <summary>The initial model: the first historical fetch is in flight and nothing has arrived yet.</summary>
    public static SignalChartPanelModel Pending { get; } = new(
        Array.Empty<string>(),
        Array.Empty<SignalChartSample>(),
        Array.Empty<SignalChartStat>())
    {
        Loading = true,
    };

    /// <summary>A resolved historical model with no samples — the empty state.</summary>
    public static SignalChartPanelModel Empty { get; } = new(
        Array.Empty<string>(),
        Array.Empty<SignalChartSample>(),
        Array.Empty<SignalChartStat>());

    /// <summary>A resolved live model with no samples yet — the "waiting for signal data" state.</summary>
    public static SignalChartPanelModel LiveWaiting { get; } = new(
        Array.Empty<string>(),
        Array.Empty<SignalChartSample>(),
        Array.Empty<SignalChartStat>())
    {
        IsLive = true,
    };
}

/// <summary>
/// The fully projected, render-ready view of the panel for one input model — the native analogue of
/// everything the web <c>SignalChartPanel</c> computes before returning its <c>GlassPanel</c>. Holds the
/// active <see cref="State"/>, the resolved <see cref="Title"/> + <see cref="IsLive"/> header treatment, the
/// formatted <see cref="HeaderAnnotation"/> (the live event/point counters or the historical "points loaded"
/// note) plus its <see cref="ShowLivePulse"/> flag, the render-ready multi-line <see cref="Series"/>, the
/// dual-axis <see cref="UseRightAxis"/> decision and the resolved <see cref="EffectiveMode"/> (overlay/grid),
/// the loaded <see cref="PointCount"/>, the empty / waiting / loading copy, and the surface
/// <see cref="AutomationName"/>. Built from the pure <see cref="ChartSeries"/> primitive so every branch is
/// asserted headlessly.
/// </summary>
public sealed record SignalChartPanelDisplay(
    SignalChartPanelState State,
    string Title,
    bool IsLive,
    string HeaderAnnotation,
    bool ShowLivePulse,
    IReadOnlyList<ChartSeries> Series,
    bool UseRightAxis,
    SignalChartMode EffectiveMode,
    int PointCount,
    string EmptyMessage,
    string WaitingMessage,
    string LoadingLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SignalChartPanelModel"/> to its <see cref="SignalChartPanelDisplay"/> —
/// the native port of web/src/features/telemetry/components/SignalChartPanel.tsx. It reproduces the web
/// component's three derived decisions verbatim: the dual-axis <c>useRightAxis</c> memo (two-or-more stats
/// whose visible ranges differ by more than ten-fold), the <c>effectiveMode</c> memo (overlay / grid resolved
/// from <c>chartMode</c>, the selected-signal count and <c>gridAutoThreshold</c>), and the <c>resolvedTitle</c>
/// (<c>title ?? (isLive ? liveTitle : title)</c>). It then folds the web body ladder
/// (<c>loading &amp;&amp; !isLive</c> → data → <c>isLive</c> → empty) into the mutually-exclusive
/// <see cref="SignalChartPanelState"/>, projects each pinned signal into a render-ready <see cref="ChartSeries"/>
/// (ordinal X, the <c>formatTime</c> label, null readings dropped as gaps, palette index by selection order —
/// the web <c>CHART_COLORS[i % len]</c>), and formats the header counters with the en-US grouping contract (the
/// web <c>fmtInt</c>). Every label resolves through the i18n facade with the same English text the web feeds its
/// natural-language <c>t(...)</c> keys. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class SignalChartPanelProjection
{
    /// <summary>The minimum stat count the dual-axis decision needs (web <c>stats.length &lt; 2 → false</c>).</summary>
    public const int MinimumStatsForRightAxis = 2;

    /// <summary>The fold the dual-axis ranges must exceed to warrant a second axis (web <c>&gt; 10</c>).</summary>
    public const double RightAxisRangeFactor = 10.0;

    /// <summary>The minimum signal count an explicit grid needs to be meaningful (web <c>&gt;= 2</c>).</summary>
    public const int MinimumSignalsForExplicitGrid = 2;

    private const char MiddleDot = '\u00B7';

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props minus the pixel-layout ones).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static SignalChartPanelDisplay Project(SignalChartPanelModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<string> signals = model.SelectedSignals ?? Array.Empty<string>();
        IReadOnlyList<SignalChartSample> data = model.Data ?? Array.Empty<SignalChartSample>();
        IReadOnlyList<SignalChartStat> stats = model.Stats ?? Array.Empty<SignalChartStat>();

        string defaultTitle = localizer.GetString("signalChart.title", "Signal Chart");
        string liveTitle = localizer.GetString("signalChart.liveTitle", "Live Signal Stream");
        string eventsWord = localizer.GetString("signalChart.events", "events");
        string pointsWord = localizer.GetString("signalChart.points", "points");
        string pointsLoadedWord = localizer.GetString("signalChart.pointsLoaded", "points loaded");
        string waitingMessage = localizer.GetString("signalChart.liveWaiting", "Waiting for signal data\u2026");
        string emptyMessage = localizer.GetString("signalChart.empty", "No data for this time range");
        string loadingLabel = localizer.GetString("common.loading", "Loading");

        // Web parity: resolvedTitle = title ?? (isLive ? t('Live Signal Stream') : t('Signal Chart')).
        string title = model.Title ?? (model.IsLive ? liveTitle : defaultTitle);

        bool useRightAxis = ComputeUseRightAxis(stats);
        SignalChartMode effectiveMode = ResolveEffectiveMode(model.ChartMode, signals.Count, model.GridAutoThreshold);
        IReadOnlyList<ChartSeries> series = BuildSeries(signals, data);
        int pointCount = data.Count;

        SignalChartPanelState state = SelectState(model.Loading, model.IsLive, pointCount, effectiveMode);
        string annotation = BuildAnnotation(model, pointCount, eventsWord, pointsWord, pointsLoadedWord);

        return new SignalChartPanelDisplay(
            State: state,
            Title: title,
            IsLive: model.IsLive,
            HeaderAnnotation: annotation,
            ShowLivePulse: model.IsLive,
            Series: series,
            UseRightAxis: useRightAxis,
            EffectiveMode: effectiveMode,
            PointCount: pointCount,
            EmptyMessage: emptyMessage,
            WaitingMessage: waitingMessage,
            LoadingLabel: loadingLabel,
            AutomationName: BuildAutomationName(state, title, annotation, waitingMessage, emptyMessage, loadingLabel));
    }

    /// <summary>
    /// The web <c>useRightAxis</c> memo: with fewer than two stats there is no second axis; otherwise the two
    /// leading visible ranges (a zero / non-finite span counts as 1, the web <c>|max - min| || 1</c>) warrant a
    /// second axis when either is more than ten times the other.
    /// </summary>
    public static bool ComputeUseRightAxis(IReadOnlyList<SignalChartStat> stats)
    {
        ArgumentNullException.ThrowIfNull(stats);
        if (stats.Count < MinimumStatsForRightAxis)
        {
            return false;
        }

        double first = SpanOrUnit(stats[0]);
        double second = SpanOrUnit(stats[1]);
        return (first / second) > RightAxisRangeFactor || (second / first) > RightAxisRangeFactor;
    }

    /// <summary>
    /// The web <c>effectiveMode</c> memo: an explicit overlay stays overlay; an explicit grid needs two or more
    /// signals to be a meaningful small-multiples (one cell falls back to overlay); auto flips overlay→grid once
    /// the selected-signal count exceeds <paramref name="gridAutoThreshold"/>.
    /// </summary>
    public static SignalChartMode ResolveEffectiveMode(SignalChartMode mode, int signalCount, int gridAutoThreshold) =>
        mode switch
        {
            SignalChartMode.Overlay => SignalChartMode.Overlay,
            SignalChartMode.Grid => signalCount >= MinimumSignalsForExplicitGrid
                ? SignalChartMode.Grid
                : SignalChartMode.Overlay,
            _ => signalCount > gridAutoThreshold ? SignalChartMode.Grid : SignalChartMode.Overlay,
        };

    // Web parity body ladder: loading && !isLive → skeleton; data.length > 0 → (grid|overlay); isLive →
    // waiting; else → empty. The resolved effective mode selects the populated branch.
    private static SignalChartPanelState SelectState(bool loading, bool isLive, int pointCount, SignalChartMode effectiveMode)
    {
        if (loading && !isLive)
        {
            return SignalChartPanelState.Loading;
        }

        if (pointCount > 0)
        {
            return effectiveMode == SignalChartMode.Grid
                ? SignalChartPanelState.Grid
                : SignalChartPanelState.Overlay;
        }

        return isLive ? SignalChartPanelState.LiveWaiting : SignalChartPanelState.Empty;
    }

    // Web parity header annotation. Live: "{liveEventCount ?? 0} events · {data.length} points". Historical:
    // "{pointsLoaded} points loaded" only when data is present and pointsLoaded was supplied; otherwise none.
    private static string BuildAnnotation(
        SignalChartPanelModel model,
        int pointCount,
        string eventsWord,
        string pointsWord,
        string pointsLoadedWord)
    {
        if (model.IsLive)
        {
            string events = FormatInt(model.LiveEventCount ?? 0L);
            string points = FormatInt(pointCount);
            return string.Create(
                CultureInfo.CurrentCulture,
                $"{events} {eventsWord} {MiddleDot} {points} {pointsWord}");
        }

        if (pointCount > 0 && model.PointsLoaded is { } loaded)
        {
            return string.Create(CultureInfo.CurrentCulture, $"{FormatInt(loaded)} {pointsLoadedWord}");
        }

        return string.Empty;
    }

    private static IReadOnlyList<ChartSeries> BuildSeries(
        IReadOnlyList<string> signals,
        IReadOnlyList<SignalChartSample> data)
    {
        if (signals.Count == 0)
        {
            return Array.Empty<ChartSeries>();
        }

        var series = new List<ChartSeries>(signals.Count);
        for (int i = 0; i < signals.Count; i++)
        {
            string signal = signals[i];
            if (string.IsNullOrWhiteSpace(signal))
            {
                continue;
            }

            series.Add(new ChartSeries(signal, BuildPoints(signal, data))
            {
                Kind = ChartSeriesKind.Line,
                ColorIndex = i,
            });
        }

        return series;
    }

    // Web parity: each <Line dataKey={sig} connectNulls /> reads row[sig]; a null / non-finite reading is a gap
    // (the point is omitted) while its row index is kept as the ordinal X so the surrounding spacing is
    // preserved, and the formatted clock label rides along for the tooltip / axis (web tickFormatter formatTime).
    private static List<ChartPoint> BuildPoints(string signal, IReadOnlyList<SignalChartSample> data)
    {
        var points = new List<ChartPoint>(data.Count);
        for (int i = 0; i < data.Count; i++)
        {
            SignalChartSample sample = data[i];
            if (sample?.Values is { } values
                && values.TryGetValue(signal, out double? value)
                && IsFinite(value, out double y))
            {
                points.Add(new ChartPoint(i, y, FormatTime(sample.Timestamp)));
            }
        }

        return points;
    }

    private static double SpanOrUnit(SignalChartStat stat)
    {
        double span = Math.Abs(stat.Max - stat.Min);
        return span > 0 && !double.IsNaN(span) && !double.IsInfinity(span) ? span : 1.0;
    }

    // Web parity: time = ts ? formatTime(ts) : ''. A missing / unparseable timestamp yields the empty string.
    private static string FormatTime(string? ts)
    {
        if (string.IsNullOrEmpty(ts) ||
            !DateTimeOffset.TryParse(ts, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dt))
        {
            return string.Empty;
        }

        return DateTimeFormatting.Format(dt, DateTimeVariant.Time, dt);
    }

    private static string FormatInt(long value) =>
        NumberFormatting.Format(value, null, 0);

    private static bool IsFinite(double? value, out double result)
    {
        if (value is { } v && !double.IsNaN(v) && !double.IsInfinity(v))
        {
            result = v;
            return true;
        }

        result = 0;
        return false;
    }

    private static string BuildAutomationName(
        SignalChartPanelState state,
        string title,
        string annotation,
        string waitingMessage,
        string emptyMessage,
        string loadingLabel) => state switch
        {
            SignalChartPanelState.Loading => $"{title}. {loadingLabel}",
            SignalChartPanelState.LiveWaiting => $"{title}. {waitingMessage}",
            SignalChartPanelState.Empty => $"{title}. {emptyMessage}",
            _ => string.IsNullOrEmpty(annotation) ? title : $"{title}. {annotation}",
        };
}

/// <summary>
/// Canonical metadata for the <c>SignalChartPanel</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/telemetry/components/SignalChartPanel.tsx</c>.
/// </summary>
public static class SignalChartPanelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SignalChartPanel";
}

/// <summary>
/// PII-safe diagnostics for the <c>SignalChartPanel</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a signal name, reading, timestamp, event
/// count or vehicle id — so a diagnostics line can never leak a vehicle's telemetry. Thread-safe.
/// </summary>
public sealed class SignalChartPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Optional sink invoked with each emitted, PII-safe diagnostics line.</param>
    public SignalChartPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SignalChartPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SignalChartPanelRegistration.Slug}");
    }
}
