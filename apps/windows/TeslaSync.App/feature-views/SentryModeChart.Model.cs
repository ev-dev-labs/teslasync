using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>SentryModeChart</c> surface — the native union of the
/// states the web component renders
/// (web/src/features/admin/components/security-access/SentryModeChart.tsx). The web source is a pure
/// presentational component (it takes a single <c>sentryBuckets: SentryDayBucket[]</c> prop and performs no
/// fetching), so the branches are a direct function of the input <see cref="SentryModeChartModel"/> — there
/// is no fetch-driven error / stale / offline branch to reproduce here. The parent Security-and-Access
/// experience owns the query lifecycle (loading / error / stale / offline are handled once for the whole
/// page before any chart is shown), exactly as the web page only renders this chart once the security
/// history has resolved. Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum SentryModeChartState
{
    /// <summary>Initial fetch in flight (the parent is still loading the history) — title + skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no day buckets to chart — a friendly empty state, never a blank chart.</summary>
    Empty,

    /// <summary>At least one day bucket is present (web <c>sentryBuckets.length &gt; 0</c>) — the stacked bars.</summary>
    Ready,
}

/// <summary>
/// One day's sentry-mode armed/disarmed tally — the native mirror of the web <c>SentryDayBucket</c> shape in
/// <c>web/src/features/admin/components/security-access/helpers.ts</c>
/// (<c>{ date: string; sentryOn: number; sentryOff: number }</c>). <see cref="Date"/> is the <c>YYYY-MM-DD</c>
/// day key the web's <c>buildSentryBuckets</c> emits; <see cref="SentryOn"/> / <see cref="SentryOff"/> are the
/// number of security snapshots that day with sentry armed / disarmed. Pure data — no WinUI types.
/// </summary>
public sealed record SentryDayBucket(string Date, long SentryOn, long SentryOff);

/// <summary>
/// The render-time data model the <c>SentryModeChart</c> view binds to — the native analogue of the web
/// <c>SentryModeChartProps</c> (<c>sentryBuckets: SentryDayBucket[]</c>), plus the fetch flag the parent
/// supplies so the surface can render its own loading branch (the web parent gates the whole chart behind
/// its query state). The component is presentational: this model carries only the day-bucket series and the
/// loading flag. User-facing labels are resolved from the i18n facade by the projection, not passed in. Pure
/// data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record SentryModeChartModel(bool Loading, IReadOnlyList<SentryDayBucket> Buckets)
{
    /// <summary>The initial model: the first fetch is in flight and no buckets have arrived yet.</summary>
    public static SentryModeChartModel Pending { get; } =
        new(true, Array.Empty<SentryDayBucket>());

    /// <summary>A resolved model with no buckets — the empty state.</summary>
    public static SentryModeChartModel Empty { get; } =
        new(false, Array.Empty<SentryDayBucket>());
}

/// <summary>
/// One projected, render-ready stacked column — the native analogue of a single day on the recharts
/// stacked <c>&lt;BarChart&gt;</c>. <see cref="AxisLabel"/> is the short date shown beneath the column (the
/// web <c>XAxis tickFormatter={formatDateShort}</c>); <see cref="SentryOn"/> / <see cref="SentryOff"/> are the
/// raw tallies and <see cref="SentryOnText"/> / <see cref="SentryOffText"/> their grouped display form (the
/// web <c>fmtNumber</c> / <c>Intl.NumberFormat</c>); <see cref="OnRatio"/> / <see cref="OffRatio"/> are each
/// segment's height as a fraction (0..1) of the tallest day's total (so the two segments stack to the column's
/// share of the busiest day, mirroring <c>stackId="sentry"</c>); and <see cref="AutomationName"/> is the spoken
/// "{date}, {on} Sentry On, {off} Sentry Off" the web tooltip conveys. Pure data.
/// </summary>
public sealed record SentryModeChartColumn(
    string Date,
    string AxisLabel,
    long SentryOn,
    long SentryOff,
    string SentryOnText,
    string SentryOffText,
    double OnRatio,
    double OffRatio,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the chart for one input model — the native analogue of what the
/// web <c>SentryModeChart</c> renders inside its <c>GlassPanel</c>. Holds the resolved title + series legend
/// labels (the three <c>t(...)</c> calls from the web source), the empty + loading copy, the active
/// <see cref="State"/>, the projected stacked <see cref="Columns"/>, and the surface
/// <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record SentryModeChartDisplay(
    SentryModeChartState State,
    string Title,
    string SentryOnLabel,
    string SentryOffLabel,
    string EmptyMessage,
    string LoadingLabel,
    IReadOnlyList<SentryModeChartColumn> Columns,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SentryModeChartModel"/> to its <see cref="SentryModeChartDisplay"/> — the
/// native port of web/src/features/admin/components/security-access/SentryModeChart.tsx. The web source is a
/// titled, stacked bar chart of the per-day sentry-armed / sentry-disarmed snapshot counts; this projection
/// reproduces its three <c>t(...)</c> labels (<c>admin.security.sentryChart</c> /
/// <c>admin.security.chart.sentryOn</c> / <c>admin.security.chart.sentryOff</c>), scales each day's two
/// segments to the busiest day's total so they stack faithfully (the web <c>stackId="sentry"</c>), formats the
/// short date axis labels (the web <c>formatDateShort</c>) and the tooltip counts through
/// <see cref="NumberFormatting"/> (the web <c>fmtNumber</c>). The web gate is purely
/// <c>sentryBuckets.length &gt; 0</c>: any day bucket promotes the surface to the charted Ready state, and only
/// a resolved, empty series collapses to the friendly empty state per the surface state contract. Every label
/// resolves through the i18n facade using the same keys the web source feeds into <c>t(...)</c>. No WinUI
/// types — unit-tested without a UI host.
/// </summary>
public static class SentryModeChartProjection
{
    /// <summary>Em-dash shown for a blank / unparseable day key (mirrors the web <c>formatDateShort</c> fallback).</summary>
    private const string EmDash = "\u2014";

    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");

    /// <summary>
    /// Token brush key for the "Sentry On" stacked segment — the W1 chart token whose colour is exactly the
    /// web's <c>#3b82f6</c> blue, kept as a theme-aware key rather than a hard-coded hex.
    /// </summary>
    public const string SentryOnBrushKey = "TsChartSpeedBrush";

    /// <summary>
    /// Token brush key for the "Sentry Off" stacked segment — the neutral status token (the theme-aware
    /// analogue of the web's <c>#6b7280</c> grey), resolved once from <see cref="StatusResources"/>.
    /// </summary>
    public static string SentryOffBrushKey { get; } = StatusResources.AccentBrushKey(StatusKind.Neutral);

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web <c>sentryBuckets</c> prop + the parent's fetch flag).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static SentryModeChartDisplay Project(SentryModeChartModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("admin.security.sentryChart", "Sentry Mode Activity");
        string sentryOnLabel = localizer.GetString("admin.security.chart.sentryOn", "Sentry On");
        string sentryOffLabel = localizer.GetString("admin.security.chart.sentryOff", "Sentry Off");
        string emptyMessage = localizer.GetString("common.noData", "No data available");
        string loadingLabel = localizer.GetString("common.loading", "Loading");

        IReadOnlyList<SentryModeChartColumn> columns = BuildColumns(model.Buckets, sentryOnLabel, sentryOffLabel);
        SentryModeChartState state = SelectState(model.Loading, columns);

        return new SentryModeChartDisplay(
            State: state,
            Title: title,
            SentryOnLabel: sentryOnLabel,
            SentryOffLabel: sentryOffLabel,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            Columns: columns,
            AutomationName: BuildAutomationName(state, title, emptyMessage, loadingLabel, columns.Count));
    }

    /// <summary>Branch precedence from the web source's data lifecycle: loading → empty → ready.</summary>
    private static SentryModeChartState SelectState(bool loading, IReadOnlyList<SentryModeChartColumn> columns)
    {
        if (loading)
        {
            return SentryModeChartState.Loading;
        }

        // The web renders the chart whenever `sentryBuckets.length > 0` and the friendly empty state otherwise,
        // so emptiness is purely a function of whether any day bucket exists.
        return columns.Count > 0 ? SentryModeChartState.Ready : SentryModeChartState.Empty;
    }

    private static IReadOnlyList<SentryModeChartColumn> BuildColumns(
        IReadOnlyList<SentryDayBucket> buckets,
        string sentryOnLabel,
        string sentryOffLabel)
    {
        if (buckets.Count == 0)
        {
            return Array.Empty<SentryModeChartColumn>();
        }

        long maxTotal = 0;
        foreach (SentryDayBucket bucket in buckets)
        {
            long total = Clamp(bucket.SentryOn) + Clamp(bucket.SentryOff);
            if (total > maxTotal)
            {
                maxTotal = total;
            }
        }

        var columns = new List<SentryModeChartColumn>(buckets.Count);
        foreach (SentryDayBucket bucket in buckets)
        {
            long on = Clamp(bucket.SentryOn);
            long off = Clamp(bucket.SentryOff);
            string onText = NumberFormatting.Format(on, null, 0);
            string offText = NumberFormatting.Format(off, null, 0);
            double onRatio = maxTotal > 0 ? Math.Clamp(on / (double)maxTotal, 0.0, 1.0) : 0.0;
            double offRatio = maxTotal > 0 ? Math.Clamp(off / (double)maxTotal, 0.0, 1.0) : 0.0;
            string axisLabel = FormatAxisLabel(bucket.Date);

            columns.Add(new SentryModeChartColumn(
                Date: bucket.Date ?? string.Empty,
                AxisLabel: axisLabel,
                SentryOn: on,
                SentryOff: off,
                SentryOnText: onText,
                SentryOffText: offText,
                OnRatio: onRatio,
                OffRatio: offRatio,
                AutomationName: $"{axisLabel}, {onText} {sentryOnLabel}, {offText} {sentryOffLabel}"));
        }

        return columns;
    }

    /// <summary>
    /// Short month/day axis label for a <c>YYYY-MM-DD</c> day key — the native analogue of the web
    /// <c>formatDateShort</c> ("Apr 4"). The day key is formatted directly (no timezone round-trip) so the
    /// label is stable across time zones, following the established en-US <c>DateTimeFormatting</c> contract;
    /// a blank or unparseable key renders the em-dash fallback, exactly as the web formatter does.
    /// </summary>
    private static string FormatAxisLabel(string? date)
    {
        if (string.IsNullOrWhiteSpace(date))
        {
            return EmDash;
        }

        if (DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out DateOnly day))
        {
            return day.ToString("MMM d", EnUs);
        }

        if (DateTimeOffset.TryParse(date, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out DateTimeOffset stamp))
        {
            return stamp.UtcDateTime.ToString("MMM d", EnUs);
        }

        return EmDash;
    }

    private static long Clamp(long value) => value < 0 ? 0 : value;

    private static string BuildAutomationName(
        SentryModeChartState state,
        string title,
        string emptyMessage,
        string loadingLabel,
        int dayCount) => state switch
        {
            SentryModeChartState.Loading => $"{title}. {loadingLabel}",
            SentryModeChartState.Empty => $"{title}. {emptyMessage}",
            _ => $"{title}. {dayCount}",
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>SentryModeChart</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a day key or a sentry count — so a
/// diagnostics line can never leak a user's security activity. Thread-safe.
/// </summary>
public sealed class SentryModeChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SentryModeChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SentryModeChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SentryModeChartRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>SentryModeChart</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/admin/components/security-access/SentryModeChart.tsx</c>.
/// </summary>
public static class SentryModeChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SentryModeChart";
}
