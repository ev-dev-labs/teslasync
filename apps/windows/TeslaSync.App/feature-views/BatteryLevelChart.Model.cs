using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>BatteryLevelChart</c> surface — the native union of the
/// states the web component renders
/// (web/src/features/charging/components/charging-list/BatteryLevelChart.tsx). The web source is a pure
/// presentational component (it takes a single <c>data: StartLevelBucket[]</c> prop and performs no
/// fetching), so the branches are a direct function of the input <see cref="BatteryLevelChartModel"/> —
/// there is no fetch-driven error / stale / offline branch to reproduce here. The parent charging-list
/// experience owns the query lifecycle (loading / error / stale / offline are handled once for the whole
/// list before any chart is shown), exactly as the web page only renders this chart once the charging
/// sessions have resolved. Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum BatteryLevelChartState
{
    /// <summary>Initial fetch in flight (the parent is still loading the sessions) — title + skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no charging activity to bucket — a friendly empty state, never a blank chart.</summary>
    Empty,

    /// <summary>At least one session falls into a starting-level bucket (web fall-through) — the bar strip.</summary>
    Ready,
}

/// <summary>
/// One starting-battery-level bucket — the native mirror of the web <c>StartLevelBucket</c> shape in
/// <c>web/src/features/charging/components/charging-list/helpers.ts</c>
/// (<c>{ range: string; count: number }</c>). <see cref="Range"/> is the 10-point SoC band label the web's
/// <c>computeStartLevelDist</c> emits (<c>"0-10%"</c> … <c>"90-100%"</c>); <see cref="Count"/> is the number
/// of charge sessions that started in that band. Pure data — no WinUI types.
/// </summary>
public sealed record BatteryLevelBucket(string Range, long Count);

/// <summary>
/// The render-time data model the <c>BatteryLevelChart</c> view binds to — the native analogue of the web
/// <c>BatteryLevelChartProps</c> (<c>data: StartLevelBucket[]</c>), plus the fetch flag the parent supplies
/// so the surface can render its own loading branch (the web parent gates the whole chart behind its query
/// state). The component is presentational: this model carries only the bucket series and the loading flag.
/// User-facing labels are resolved from the i18n facade by the projection, not passed in. Pure data — no
/// WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record BatteryLevelChartModel(bool Loading, IReadOnlyList<BatteryLevelBucket> Buckets)
{
    /// <summary>The initial model: the first fetch is in flight and no buckets have arrived yet.</summary>
    public static BatteryLevelChartModel Pending { get; } =
        new(true, Array.Empty<BatteryLevelBucket>());

    /// <summary>A resolved model with no buckets — the empty state.</summary>
    public static BatteryLevelChartModel Empty { get; } =
        new(false, Array.Empty<BatteryLevelBucket>());
}

/// <summary>
/// One projected, render-ready bar — the native analogue of a single recharts <c>&lt;Bar&gt;</c> datum.
/// <see cref="Range"/> is the SoC-band axis label shown beneath the bar (the web <c>XAxis dataKey="range"</c>);
/// <see cref="Count"/> is the raw session count; <see cref="CountText"/> is its grouped display form (the web
/// <c>fmtNumber</c> / <c>Intl.NumberFormat</c>); <see cref="HeightRatio"/> is the bar height as a fraction
/// (0..1) of the tallest bucket; and <see cref="AutomationName"/> is the spoken "{range}, {count} {sessions}"
/// the web tooltip conveys. Pure data.
/// </summary>
public sealed record BatteryLevelChartBar(
    string Range,
    long Count,
    string CountText,
    double HeightRatio,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the chart for one input model — the native analogue of what the
/// web <c>BatteryLevelChart</c> renders inside its <c>GlassPanel</c>. Holds the resolved title + hint (the two
/// <c>t(...)</c> calls from the web source), the empty + loading copy, the localized "sessions" word for the
/// bar Narrator names, the active <see cref="State"/>, the projected <see cref="Bars"/>, and the surface
/// <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record BatteryLevelChartDisplay(
    BatteryLevelChartState State,
    string Title,
    string Hint,
    string EmptyMessage,
    string LoadingLabel,
    string SessionsWord,
    IReadOnlyList<BatteryLevelChartBar> Bars,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="BatteryLevelChartModel"/> to its <see cref="BatteryLevelChartDisplay"/> —
/// the native port of web/src/features/charging/components/charging-list/BatteryLevelChart.tsx. The web
/// source is a bare titled bar chart of the start-of-charge SoC distribution; this projection reproduces its
/// two <c>t(...)</c> labels (<c>charging.charts.batteryLevelAtStart</c> / <c>charging.charts.batteryLevelHint</c>),
/// scales each bar to the tallest bucket, and formats the session counts through <see cref="NumberFormatting"/>
/// (the web <c>fmtNumber</c>). Because the web's <c>computeStartLevelDist</c> always emits ten buckets — every
/// one zero when there are no sessions — an all-zero (or absent) distribution carries no answer to "how low do
/// you typically go?", so it collapses to a friendly empty state per the surface state contract; the chart
/// renders as soon as any session lands in a bucket. Every label resolves through the i18n facade using the
/// same keys the web source feeds into <c>t(...)</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class BatteryLevelChartProjection
{
    private const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web <c>data</c> prop + the parent's fetch flag).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static BatteryLevelChartDisplay Project(BatteryLevelChartModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("charging.charts.batteryLevelAtStart", "Battery Level at Charge Start");
        string hint = localizer.GetString(
            "charging.charts.batteryLevelHint",
            "How low do you typically go before charging?");
        string emptyMessage = localizer.GetString("chart.noData", "No data available");
        string loadingLabel = localizer.GetString("common.loading", "Loading");
        string sessionsWord = localizer.GetString("charging.charts.batteryLevelSessions", "Sessions");

        IReadOnlyList<BatteryLevelChartBar> bars = BuildBars(model.Buckets, sessionsWord);
        BatteryLevelChartState state = SelectState(model.Loading, model.Buckets);

        return new BatteryLevelChartDisplay(
            State: state,
            Title: title,
            Hint: hint,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            SessionsWord: sessionsWord,
            Bars: bars,
            AutomationName: BuildAutomationName(state, title, hint, emptyMessage, loadingLabel));
    }

    /// <summary>Branch precedence from the web source's data lifecycle: loading → empty → ready.</summary>
    private static BatteryLevelChartState SelectState(bool loading, IReadOnlyList<BatteryLevelBucket> buckets)
    {
        if (loading)
        {
            return BatteryLevelChartState.Loading;
        }

        // The web `computeStartLevelDist` always returns ten buckets (every count zero when there are no
        // sessions), so emptiness is a function of the VALUES, not the bucket count: a distribution with no
        // sessions in any band answers nothing and collapses to the empty state, while a single session in
        // any band promotes the surface to the charted Ready state.
        foreach (var bucket in buckets)
        {
            if (bucket.Count > 0)
            {
                return BatteryLevelChartState.Ready;
            }
        }

        return BatteryLevelChartState.Empty;
    }

    private static IReadOnlyList<BatteryLevelChartBar> BuildBars(
        IReadOnlyList<BatteryLevelBucket> buckets,
        string sessionsWord)
    {
        if (buckets.Count == 0)
        {
            return Array.Empty<BatteryLevelChartBar>();
        }

        long max = 0;
        foreach (var bucket in buckets)
        {
            if (bucket.Count > max)
            {
                max = bucket.Count;
            }
        }

        var bars = new List<BatteryLevelChartBar>(buckets.Count);
        foreach (var bucket in buckets)
        {
            string range = string.IsNullOrWhiteSpace(bucket.Range) ? EmDash : bucket.Range;
            long count = bucket.Count < 0 ? 0 : bucket.Count;
            string countText = NumberFormatting.Format(count, null, 0);
            double ratio = max > 0 ? Math.Clamp(count / (double)max, 0.0, 1.0) : 0.0;

            bars.Add(new BatteryLevelChartBar(
                Range: range,
                Count: count,
                CountText: countText,
                HeightRatio: ratio,
                AutomationName: $"{range}, {countText} {sessionsWord}"));
        }

        return bars;
    }

    private static string BuildAutomationName(
        BatteryLevelChartState state,
        string title,
        string hint,
        string emptyMessage,
        string loadingLabel) => state switch
        {
            BatteryLevelChartState.Loading => $"{title}. {loadingLabel}",
            BatteryLevelChartState.Empty => $"{title}. {emptyMessage}",
            _ => $"{title}. {hint}",
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>BatteryLevelChart</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a bucket label or session count —
/// so a diagnostics line can never leak a user's charging behaviour. Thread-safe.
/// </summary>
public sealed class BatteryLevelChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BatteryLevelChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BatteryLevelChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BatteryLevelChartRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>BatteryLevelChart</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/charging/components/charging-list/BatteryLevelChart.tsx</c>.
/// </summary>
public static class BatteryLevelChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BatteryLevelChart";
}
