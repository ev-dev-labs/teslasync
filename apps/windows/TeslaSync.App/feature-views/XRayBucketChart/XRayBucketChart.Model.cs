using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.IngestXRay;

/// <summary>
/// The mutually-exclusive render branch of the <c>XRayBucketChart</c> surface — the native union of the
/// states the web component renders
/// (web/src/features/admin/components/ingest-xray/XRayBucketChart.tsx). The web source is a pure
/// presentational component (it takes <c>buckets</c> + <c>loading</c> as props and performs no fetching),
/// so the branches are a direct function of the input <see cref="XRayBucketChartModel"/> — there is no
/// fetch-driven error / stale / offline branch to reproduce here (the parent <c>IngestXRayPage</c> owns
/// the query lifecycle and wraps this surface in a section error boundary). Every branch maps onto a
/// visible surface; none is ever hidden.
/// </summary>
public enum XRayBucketChartState
{
    /// <summary>Initial fetch in flight (web <c>loading</c>) — title + skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no buckets (web <c>isEmpty = !loading &amp;&amp; series.length === 0</c>) — friendly empty state.</summary>
    Empty,

    /// <summary>At least one bucket to chart (web fall-through) — the bar strip + accessible data table.</summary>
    Ready,
}

/// <summary>
/// One ingest sample-count bucket — the native mirror of the web <c>IngestXRayBucketPoint</c> shape in
/// <c>web/src/types/admin-diagnostics.ts</c> (<c>{ bucket_start: string; count: number }</c>).
/// <see cref="BucketStart"/> is the ISO-8601 bucket boundary; <see cref="Count"/> is the number of
/// telemetry rows ingested in that bucket. Pure data — no WinUI types.
/// </summary>
public sealed record XRayBucketPoint(string BucketStart, long Count);

/// <summary>
/// The render-time data model the <c>XRayBucketChart</c> view binds to — the native analogue of the web
/// <c>XRayBucketChartProps</c> (<c>buckets</c> + <c>loading</c>). The component is presentational: this
/// model carries only the fetch flag and the bucket series the parent supplies. User-facing labels are
/// resolved from the i18n facade by the projection, not passed in. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record XRayBucketChartModel(bool Loading, IReadOnlyList<XRayBucketPoint> Buckets)
{
    /// <summary>The initial model: the first fetch is in flight and no buckets have arrived yet.</summary>
    public static XRayBucketChartModel Pending { get; } =
        new(true, Array.Empty<XRayBucketPoint>());

    /// <summary>A resolved model with no buckets — the empty state.</summary>
    public static XRayBucketChartModel Empty { get; } =
        new(false, Array.Empty<XRayBucketPoint>());
}

/// <summary>
/// One projected, render-ready bar — the native analogue of a single recharts <c>&lt;Bar&gt;</c> datum.
/// <see cref="TimeLabel"/> is the web <c>formatTime</c> axis tick (shown beneath the bar only when
/// <see cref="ShowLabel"/> is set, so a dense window doesn't overlap its ticks); <see cref="FullLabel"/>
/// is the unambiguous full timestamp used in the accessible table and Narrator name;
/// <see cref="HeightRatio"/> is the bar height as a fraction (0..1) of the tallest bar; and
/// <see cref="AutomationName"/> is the spoken "{time}, {count} {samples}" the web tooltip conveys. Pure data.
/// </summary>
public sealed record XRayBucketChartBar(
    string TimeLabel,
    bool ShowLabel,
    long Count,
    string CountText,
    double HeightRatio,
    string FullLabel,
    string AutomationName);

/// <summary>
/// A declarative table column descriptor (key + localized header) — the native, WinUI-free analogue of the
/// web <c>dataColumns</c> the chart feeds into <c>ChartContainer</c>'s accessible fallback table. The view
/// maps each one onto a <c>TsDataColumn</c>; rows address their cells by the same <see cref="Key"/>.
/// </summary>
public sealed record XRayBucketChartColumn(string Key, string Header);

/// <summary>
/// A single projected, display-ready table row — the cell values keyed by column key, a stable
/// <see cref="RowKey"/>, and a Narrator automation name. Mirrors one row of the web <c>data</c> array
/// (<c>{ bucket, count }</c>). Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record XRayBucketChartRow(
    string RowKey,
    IReadOnlyDictionary<string, string> Cells,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the chart for one input model — the native analogue of what
/// the web <c>XRayBucketChart</c> returns through <c>ChartContainer</c>. Holds the resolved title /
/// subtitle / aria-label, the empty + table-caption labels, the active <see cref="State"/>, the projected
/// <see cref="Bars"/>, and the accessible table <see cref="Columns"/> + <see cref="Rows"/>. Pure data so
/// every branch is asserted headlessly.
/// </summary>
public sealed record XRayBucketChartDisplay(
    XRayBucketChartState State,
    string Title,
    string Subtitle,
    string AriaLabel,
    string EmptyMessage,
    string TableLabel,
    IReadOnlyList<XRayBucketChartBar> Bars,
    IReadOnlyList<XRayBucketChartColumn> Columns,
    IReadOnlyList<XRayBucketChartRow> Rows,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="XRayBucketChartModel"/> to its <see cref="XRayBucketChartDisplay"/> —
/// the native port of web/src/features/admin/components/ingest-xray/XRayBucketChart.tsx. The branch
/// precedence mirrors the web source exactly (loading → empty → ready); the bar time labels render through
/// <see cref="DateTimeFormatting"/> with the <see cref="DateTimeVariant.Time"/> variant (the web
/// <c>formatTime</c>) and the table bucket cells with <see cref="DateTimeVariant.Full"/> for an
/// unambiguous accessible fallback; the sample counts render through <see cref="NumberFormatting"/> (the
/// web <c>fmtInt</c>). Every label resolves through the i18n facade using the same keys the web source
/// feeds into <c>ChartContainer</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class XRayBucketChartProjection
{
    /// <summary>Column key for the bucket column (web <c>key: 'bucket'</c>).</summary>
    public const string BucketKey = "bucket";

    /// <summary>Column key for the sample-count column (web <c>key: 'count'</c>).</summary>
    public const string CountKey = "count";

    /// <summary>Target number of axis tick labels; denser windows thin their labels to this many.</summary>
    public const int LabelTargetTicks = 8;

    private const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for timestamp formatting.</param>
    public static XRayBucketChartDisplay Project(
        XRayBucketChartModel model,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("admin.xray.chart.title", "Samples per bucket");
        string subtitle = localizer.GetString(
            "admin.xray.chart.subtitle",
            "Time-series of ingested telemetry rows over the selected window.");
        string ariaLabel = localizer.GetString(
            "admin.xray.chart.ariaLabel",
            "Bar chart of ingest sample counts per time bucket.");
        string samplesWord = localizer.GetString("admin.xray.chart.tooltip", "Samples");
        string emptyMessage = localizer.GetString("chart.noData", "No data available");
        string tableLabel = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("chart.a11y.fallbackTableLabel", "{0} \u2014 data table"),
            title);

        IReadOnlyList<XRayBucketChartColumn> columns = BuildColumns(localizer);
        IReadOnlyList<XRayBucketChartBar> bars = BuildBars(model.Buckets, samplesWord, now);
        IReadOnlyList<XRayBucketChartRow> rows = BuildRows(bars, samplesWord);

        XRayBucketChartState state = SelectState(model);

        return new XRayBucketChartDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            AriaLabel: ariaLabel,
            EmptyMessage: emptyMessage,
            TableLabel: tableLabel,
            Bars: bars,
            Columns: columns,
            Rows: rows,
            AutomationName: BuildAutomationName(state, title, ariaLabel, emptyMessage, localizer));
    }

    /// <summary>Branch precedence from the web source: loading → empty → ready.</summary>
    private static XRayBucketChartState SelectState(XRayBucketChartModel model)
    {
        if (model.Loading)
        {
            return XRayBucketChartState.Loading;
        }

        // Web parity: `isEmpty = !loading && series.length === 0` — emptiness is a function of the bucket
        // COUNT, not the values, so a window of all-zero buckets still renders the (zero-height) bars.
        return model.Buckets.Count == 0 ? XRayBucketChartState.Empty : XRayBucketChartState.Ready;
    }

    private static IReadOnlyList<XRayBucketChartColumn> BuildColumns(ILocalizer localizer) =>
    [
        new XRayBucketChartColumn(BucketKey, localizer.GetString("admin.xray.chart.cols.bucket", "Bucket")),
        new XRayBucketChartColumn(CountKey, localizer.GetString("admin.xray.chart.cols.count", "Samples")),
    ];

    private static IReadOnlyList<XRayBucketChartBar> BuildBars(
        IReadOnlyList<XRayBucketPoint> buckets,
        string samplesWord,
        DateTimeOffset now)
    {
        if (buckets.Count == 0)
        {
            return Array.Empty<XRayBucketChartBar>();
        }

        long max = 0;
        foreach (var bucket in buckets)
        {
            if (bucket.Count > max)
            {
                max = bucket.Count;
            }
        }

        // Thin the axis labels to ~LabelTargetTicks so a dense window (e.g. 60×1m buckets) doesn't render
        // overlapping ticks — every bar still carries its full time + count in its Narrator name.
        int stride = buckets.Count <= LabelTargetTicks
            ? 1
            : (int)Math.Ceiling(buckets.Count / (double)LabelTargetTicks);

        var bars = new List<XRayBucketChartBar>(buckets.Count);
        for (int i = 0; i < buckets.Count; i++)
        {
            var bucket = buckets[i];
            DateTimeOffset? ts = TryParseTimestamp(bucket.BucketStart);
            string timeLabel = ts is null ? EmDash : DateTimeFormatting.Format(ts, DateTimeVariant.Time, now);
            string fullLabel = ts is null ? EmDash : DateTimeFormatting.Format(ts, DateTimeVariant.Full, now);
            string countText = NumberFormatting.Format(bucket.Count, null, 0);
            double ratio = max > 0 ? Math.Clamp(bucket.Count / (double)max, 0.0, 1.0) : 0.0;
            bool showLabel = i % stride == 0;

            bars.Add(new XRayBucketChartBar(
                TimeLabel: timeLabel,
                ShowLabel: showLabel,
                Count: bucket.Count,
                CountText: countText,
                HeightRatio: ratio,
                FullLabel: fullLabel,
                AutomationName: $"{fullLabel}, {countText} {samplesWord}"));
        }

        return bars;
    }

    private static IReadOnlyList<XRayBucketChartRow> BuildRows(
        IReadOnlyList<XRayBucketChartBar> bars,
        string samplesWord)
    {
        if (bars.Count == 0)
        {
            return Array.Empty<XRayBucketChartRow>();
        }

        var rows = new List<XRayBucketChartRow>(bars.Count);
        for (int i = 0; i < bars.Count; i++)
        {
            var bar = bars[i];
            var cells = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [BucketKey] = bar.FullLabel,
                [CountKey] = bar.CountText,
            };

            rows.Add(new XRayBucketChartRow(
                RowKey: string.Create(CultureInfo.InvariantCulture, $"row-{i}"),
                Cells: cells,
                AutomationName: $"{bar.FullLabel}. {bar.CountText} {samplesWord}"));
        }

        return rows;
    }

    // Web parity for the X-axis: `Date.parse(b.bucket_start)` then format — an unparseable boundary renders
    // the em-dash fallback rather than a NaN tick.
    private static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (!string.IsNullOrWhiteSpace(raw) && DateTimeOffset.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var value))
        {
            return value;
        }

        return null;
    }

    private static string BuildAutomationName(
        XRayBucketChartState state,
        string title,
        string ariaLabel,
        string emptyMessage,
        ILocalizer localizer) => state switch
        {
            XRayBucketChartState.Loading => $"{title}. {localizer.GetString("common.loading", "Loading")}",
            XRayBucketChartState.Empty => $"{title}. {emptyMessage}",
            _ => $"{title}. {ariaLabel}",
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>XRayBucketChart</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a bucket boundary or sample
/// count — so a diagnostics line can never leak ingest volume or timing. Thread-safe.
/// </summary>
public sealed class XRayBucketChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public XRayBucketChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=XRayBucketChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={XRayBucketChartRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>XRayBucketChart</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/admin/components/ingest-xray/XRayBucketChart.tsx</c>.
/// </summary>
public static class XRayBucketChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "XRayBucketChart";
}
