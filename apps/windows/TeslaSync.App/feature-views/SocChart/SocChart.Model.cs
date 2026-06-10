using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// One sampled point of a drive's state-of-charge trace — the native mirror of the two fields the web
/// <c>SocChart</c> reads off each <c>ChartDataPoint</c>
/// (<c>web/src/features/driving/components/drive-detail/SocChart.tsx</c> + <c>./types.ts</c>):
/// <see cref="Time"/> is the pre-formatted X-axis tick (the web <c>time</c> string, already run through the
/// page's <c>formatTime</c>) and <see cref="Battery"/> is the battery state-of-charge percent the area plots
/// (the web <c>battery</c> value, <c>tp.batteryLevel ?? 0</c>, kept verbatim — the web applies no rounding).
/// Pure data — no WinUI types — so <see cref="SocChartProjection"/> is unit-tested without a UI host.
/// </summary>
/// <param name="Time">The pre-formatted time label plotted on the X axis (web <c>time</c>).</param>
/// <param name="Battery">The battery state-of-charge percent plotted on the Y axis (web <c>battery</c>).</param>
public readonly record struct SocSample(string Time, double Battery);

/// <summary>
/// The parent-owned async phase a <see cref="SocChartModel"/> is in. The web <c>SocChart</c> is a pure
/// presentational child of the Drive-Detail page (its only hooks are <c>useTranslation</c> and the
/// cross-chart cursor-sync hooks); the surrounding page owns the cache-then-network drive read whose
/// <c>chartData</c> it threads in. The native surface renders that lifecycle inline, so the parent drives the
/// phase down with the trace rather than swapping the surface out.
/// </summary>
public enum SocChartPhase
{
    /// <summary>The drive's telemetry is in flight — render the loading surface.</summary>
    Loading,

    /// <summary>A drive resolved (possibly empty, possibly stale/offline) — render the trace or empty.</summary>
    Ready,

    /// <summary>The drive read failed with no cached snapshot — render the error surface with a retry.</summary>
    Error,
}

/// <summary>
/// The render-time data model the <c>SocChart</c> view binds to. The web component is purely presentational
/// and takes a single <c>chartData</c> prop; this native model wraps that same per-sample SOC trace in the
/// standard async envelope (<see cref="Phase"/> plus the freshness flags) the parent Drive-Detail page drives,
/// so the surface can render every P2 state inline. Pure data — no WinUI types — so
/// <see cref="SocChartProjection"/> is verified headlessly.
/// </summary>
/// <param name="Phase">The parent-owned async phase.</param>
/// <param name="Samples">The per-sample SOC trace (the web <c>chartData</c> prop, time + battery only).</param>
/// <param name="IsStale">True when the shown snapshot is older than the freshness window.</param>
/// <param name="IsOffline">True when the snapshot is served from cache while offline.</param>
/// <param name="ErrorDetail">Optional resolved error/offline detail surfaced in the error body.</param>
public sealed record SocChartModel(
    SocChartPhase Phase,
    IReadOnlyList<SocSample> Samples,
    bool IsStale = false,
    bool IsOffline = false,
    string? ErrorDetail = null)
{
    /// <summary>The initial model: the drive's telemetry is in flight and no trace has arrived yet.</summary>
    public static SocChartModel Pending { get; } = new(SocChartPhase.Loading, Array.Empty<SocSample>());

    /// <summary>A resolved, fresh model with no samples — the empty state.</summary>
    public static SocChartModel Empty { get; } = new(SocChartPhase.Ready, Array.Empty<SocSample>());

    /// <summary>A resolved, fresh model carrying the supplied SOC trace.</summary>
    /// <param name="samples">The per-sample SOC trace.</param>
    public static SocChartModel Loaded(IReadOnlyList<SocSample> samples) =>
        new(SocChartPhase.Ready, samples);

    /// <summary>A resolved model whose snapshot is stale (older than the freshness window).</summary>
    /// <param name="samples">The per-sample SOC trace.</param>
    public static SocChartModel StaleSnapshot(IReadOnlyList<SocSample> samples) =>
        new(SocChartPhase.Ready, samples, IsStale: true);

    /// <summary>A resolved model served from cache while offline.</summary>
    /// <param name="samples">The per-sample SOC trace.</param>
    public static SocChartModel OfflineSnapshot(IReadOnlyList<SocSample> samples) =>
        new(SocChartPhase.Ready, samples, IsOffline: true);

    /// <summary>A failed model with no cached snapshot — the error state.</summary>
    /// <param name="detail">Optional resolved error detail.</param>
    public static SocChartModel Failed(string? detail = null) =>
        new(SocChartPhase.Error, Array.Empty<SocSample>(), ErrorDetail: detail);
}

/// <summary>
/// The mutually-exclusive surface state the <c>SocChart</c> renders. The web source itself only expresses the
/// trace content (<see cref="Ready"/> / <see cref="Empty"/>, gated on its <c>chartData.length &gt; 1</c>
/// test); the remaining branches are the standard native async chrome the parent Drive-Detail page drives.
/// None is ever hidden — every state maps onto a visible surface.
/// </summary>
public enum SocChartState
{
    /// <summary>Initial telemetry in flight — chart skeleton chrome.</summary>
    Loading,

    /// <summary>Read failed with no cache — the <c>QueryError</c> equivalent with a retry affordance.</summary>
    Error,

    /// <summary>Resolved with too few samples to draw — the web "No telemetry data available" surface.</summary>
    Empty,

    /// <summary>At least two samples, fresh — the area chart (web fall-through render).</summary>
    Ready,

    /// <summary>Shown snapshot is older than the freshness window — chart plus a stale chip.</summary>
    Stale,

    /// <summary>Snapshot served from cache while offline — cached chart plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The fully projected, render-ready view of the chart for one input model — the native analogue of what the
/// web <c>SocChart</c> returns through its <c>ChartContainer</c>. Holds the always-present chrome strings
/// (title / aria-label / series name), the per-state messages, the single SOC area <see cref="Series"/>, the
/// active <see cref="State"/> (plus the <see cref="ContainerState"/> the chart body maps onto), the
/// <see cref="HasData"/> gate (the web <c>chartData.length &gt; 1</c> test) and the optional freshness
/// <see cref="FreshnessChip"/>. Per the web source's <c>chart-a11y:no-table</c> directive (a dense per-sample
/// trace whose start/end SOC is read from the drive summary tiles) there is deliberately no accessible data
/// table — the chart's aria-label carries the accessible representation. Pure data so every branch is asserted
/// headlessly.
/// </summary>
/// <param name="State">The active mutually-exclusive surface state.</param>
/// <param name="ContainerState">The chart-body lifecycle state the visual chart frame maps onto.</param>
/// <param name="Title">Resolved chart heading (web <c>driveDetail.socOverTime</c>).</param>
/// <param name="AriaLabel">Resolved accessible figure name (web <c>driveDetail.socOverTime.aria</c>).</param>
/// <param name="SeriesName">Resolved series name (web <c>`${t('driveDetail.soc')} %`</c> → "SOC %").</param>
/// <param name="EmptyMessage">Resolved empty-state message (web <c>driveDetail.noChartData</c>).</param>
/// <param name="ErrorMessage">Resolved error-state message.</param>
/// <param name="LoadingMessage">Resolved loading-state message (shared <c>common.loading</c>).</param>
/// <param name="RetryLabel">Resolved retry affordance label (shared <c>common.retry</c>).</param>
/// <param name="Series">The single SOC-vs-time area series (web <c>&lt;Area dataKey="battery"&gt;</c>).</param>
/// <param name="HasData">True with at least two samples to draw (web <c>chartData.length &gt; 1</c>).</param>
/// <param name="FreshnessChip">Stale / offline chip text; null in every other state.</param>
/// <param name="AutomationName">The spoken Narrator name for the whole surface in this state.</param>
public sealed record SocChartDisplay(
    SocChartState State,
    ChartState ContainerState,
    string Title,
    string AriaLabel,
    string SeriesName,
    string EmptyMessage,
    string ErrorMessage,
    string LoadingMessage,
    string RetryLabel,
    ChartSeries Series,
    bool HasData,
    string? FreshnessChip,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SocChartModel"/> to its <see cref="SocChartDisplay"/> — the native port
/// of <c>web/src/features/driving/components/drive-detail/SocChart.tsx</c>. The per-sample SOC trace maps onto
/// a single emerald battery-green area series (web <c>&lt;Area dataKey="battery" stroke="#10b981"&gt;</c>),
/// each point keyed by its ordinal index with the pre-formatted <c>time</c> string carried as the point label
/// (the native cartesian surface plots an ordinal X domain and surfaces the time label in its tooltip, the
/// same shape the sibling trend charts use). The web's <c>chartData.length &gt; 1</c> gate becomes
/// <see cref="SocChartDisplay.HasData"/> — fewer than two samples render the friendly
/// "No telemetry data available" surface rather than a blank box. Every label resolves through the i18n facade
/// with the same keys (and English fallbacks) the web source feeds into its <c>ChartContainer</c>. No WinUI
/// types — unit-tested without a UI host.
/// </summary>
public static class SocChartProjection
{
    /// <summary>Minimum number of samples required to draw the trace (web <c>chartData.length &gt; 1</c>).</summary>
    public const int MinSamplesToDraw = 2;

    /// <summary>The web Y-axis floor (web <c>YAxis domain={[0, 100]}</c> lower bound).</summary>
    public const double AxisMinPercent = 0;

    /// <summary>The web Y-axis ceiling (web <c>YAxis domain={[0, 100]}</c> upper bound).</summary>
    public const double AxisMaxPercent = 100;

    // Web parity: the SOC area is stroked emerald (web `stroke="#10b981"`), the established green->Battery
    // mapping shared across the drivetrain charts; the role resolves a theme-aware battery brush.
    private const ChartRole SocSeriesRole = ChartRole.Battery;

    // Web parity: `name={`${t('driveDetail.soc')} %`}` — the localized "SOC" label suffixed with a percent
    // sign; SOC is a whole-percent figure so the series formats with no decimals.
    private const int SocDecimals = 0;

    private const string PercentUnit = "%";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web prop plus the async envelope).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static SocChartDisplay Project(SocChartModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<SocSample> samples = model.Samples ?? Array.Empty<SocSample>();

        string title = localizer.GetString("driveDetail.socOverTime", "SOC % Over Time");
        string aria = localizer.GetString(
            "driveDetail.socOverTime.aria",
            "State of charge percent over time area chart");
        string socLabel = localizer.GetString("driveDetail.soc", "SOC");
        string seriesName = string.Format(CultureInfo.CurrentCulture, "{0} %", socLabel);
        string emptyMessage = localizer.GetString("driveDetail.noChartData", "No telemetry data available");
        string loadingMessage = localizer.GetString("common.loading", "Loading");
        string retryLabel = localizer.GetString("common.retry", "Retry");
        string staleLabel = localizer.GetString("driveDetail.socOverTime.stale", "Stale");
        string offlineLabel = localizer.GetString("driveDetail.socOverTime.offline", "Offline");
        string errorMessage = ResolveError(model, localizer);

        ChartSeries series = BuildSeries(samples, seriesName);
        bool hasData = samples.Count >= MinSamplesToDraw;

        SocChartState state = SelectState(model, hasData);
        ChartState containerState = MapContainerState(state, hasData);
        string? chip = state switch
        {
            SocChartState.Stale => staleLabel,
            SocChartState.Offline => offlineLabel,
            _ => null,
        };

        return new SocChartDisplay(
            State: state,
            ContainerState: containerState,
            Title: title,
            AriaLabel: aria,
            SeriesName: seriesName,
            EmptyMessage: emptyMessage,
            ErrorMessage: errorMessage,
            LoadingMessage: loadingMessage,
            RetryLabel: retryLabel,
            Series: series,
            HasData: hasData,
            FreshnessChip: chip,
            AutomationName: BuildAutomationName(state, title, aria, emptyMessage, errorMessage, loadingMessage, chip));
    }

    // The single SOC area series (web `<Area dataKey="battery" stroke="#10b981">`): each sample keyed by its
    // ordinal index, the raw battery percent on Y (the web applies no rounding), the pre-formatted time string
    // carried as the point label, the battery-green role, the "%" unit and whole-percent tooltip precision.
    private static ChartSeries BuildSeries(IReadOnlyList<SocSample> samples, string seriesName)
    {
        var points = new List<ChartPoint>(samples.Count);
        for (int i = 0; i < samples.Count; i++)
        {
            SocSample sample = samples[i];
            points.Add(new ChartPoint(i, sample.Battery, sample.Time));
        }

        return new ChartSeries(seriesName, points)
        {
            Kind = ChartSeriesKind.Area,
            Role = SocSeriesRole,
            Unit = PercentUnit,
            Decimals = SocDecimals,
        };
    }

    // Branch precedence mirrors the sibling charts: the parent phase wins first (loading -> error), then
    // freshness wins over emptiness so a stale/offline chip survives an empty cached snapshot; a fresh snapshot
    // is Ready or Empty by sample count (the web `chartData.length > 1` test).
    private static SocChartState SelectState(SocChartModel model, bool hasData) => model.Phase switch
    {
        SocChartPhase.Loading => SocChartState.Loading,
        SocChartPhase.Error => SocChartState.Error,
        _ => model.IsOffline
            ? SocChartState.Offline
            : model.IsStale
                ? SocChartState.Stale
                : hasData
                    ? SocChartState.Ready
                    : SocChartState.Empty,
    };

    // The visual chart frame only knows loading / empty / error / ready; a stale or offline snapshot with
    // samples still draws the chart (with a chip), while one without falls back to the empty body.
    private static ChartState MapContainerState(SocChartState state, bool hasData) => state switch
    {
        SocChartState.Loading => ChartState.Loading,
        SocChartState.Error => ChartState.Error,
        SocChartState.Empty => ChartState.Empty,
        SocChartState.Stale => hasData ? ChartState.Ready : ChartState.Empty,
        SocChartState.Offline => hasData ? ChartState.Ready : ChartState.Empty,
        _ => ChartState.Ready,
    };

    private static string ResolveError(SocChartModel model, ILocalizer localizer)
    {
        if (!string.IsNullOrWhiteSpace(model.ErrorDetail))
        {
            return model.ErrorDetail!;
        }

        return localizer.GetString("driveDetail.section.socChartFailed", "SOC chart failed to load");
    }

    private static string BuildAutomationName(
        SocChartState state,
        string title,
        string aria,
        string emptyMessage,
        string errorMessage,
        string loadingMessage,
        string? chip) => state switch
        {
            SocChartState.Loading => $"{title}. {loadingMessage}",
            SocChartState.Error => $"{title}. {errorMessage}",
            SocChartState.Empty => $"{title}. {emptyMessage}",
            SocChartState.Stale => $"{title}. {aria}. {chip}",
            SocChartState.Offline => $"{title}. {aria}. {chip}",
            _ => $"{title}. {aria}",
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>SocChart</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a battery figure, timestamp or sample
/// count — so a diagnostics line can never leak a drive's telemetry. Thread-safe.
/// </summary>
public sealed class SocChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to; null discards them.</param>
    public SocChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SocChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SocChartRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>SocChart</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/driving/components/drive-detail/SocChart.tsx</c>.
/// </summary>
public static class SocChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SocChart";
}
