using System.Collections.Generic;
using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// One distance-versus-elevation sample along a drive route — the native analogue of the web
/// <c>ElevationDataPoint</c> (web/src/components/charts/ElevationProfile.tsx L15-L20). <see cref="Index"/>
/// is the sample's original ordinal in the source series (carried through so a click maps back to the
/// replay frame, mirroring the web <c>onClickIndex(data[idx].index)</c>); <see cref="Distance"/> is the
/// cumulative route distance in the caller's display unit; <see cref="Elevation"/> is the elevation in SI
/// metres; <see cref="Speed"/> is the optional spot speed (unused by the chart, kept for shape parity with
/// the web point).
/// </summary>
public readonly record struct ElevationSample(int Index, double Distance, double Elevation, double? Speed = null);

/// <summary>
/// The mutually-exclusive render branches the surface shows — a faithful reproduction of the two branches
/// in the web <c>ElevationProfile</c>: the early return when <c>data.length === 0</c>
/// (web L73-L87, <see cref="Empty"/>) and the populated chart otherwise (web L89-L140, <see cref="Ready"/>).
/// The web component is presentational — it renders already-resolved data passed by its parent replay page
/// and therefore has no fetch lifecycle (no loading / error / stale / offline branch), exactly like the
/// other presentational shared surfaces (e.g. <c>AnnouncerRegion</c>).
/// </summary>
public enum ElevationProfileState
{
    /// <summary>No samples — the friendly "no elevation data" message (web <c>EmptyState</c> branch).</summary>
    Empty = 0,

    /// <summary>One or more samples — the elevation area chart (web populated branch).</summary>
    Ready = 1,
}

/// <summary>
/// Canonical metadata for the elevation-profile surface — the native analogue of the module-level identity in
/// the web <c>ElevationProfile</c>. The only registered identity is the diagnostics slug emitted with the
/// <c>view.opened</c> event and the localized chart title (web <c>replay.elevation.title</c>).
/// </summary>
public static class ElevationProfileRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ElevationProfile";

    /// <summary>The semantic chart role used for the area/line brush — emerald, matching the web <c>#10b981</c>.</summary>
    public const ChartRole SeriesRole = ChartRole.Regen;

    /// <summary>The themed brush key for the replay cursor reference line (cyan, matching the web <c>#00b4d8</c>).</summary>
    public const string CursorBrushKey = "TsColorInfoBrush";

    /// <summary>The default chart height in DIPs (web <c>height = 200</c>).</summary>
    public const double DefaultHeight = 200;

    /// <summary>The default distance-axis unit (web <c>distanceUnit = 'km'</c>).</summary>
    public const string DefaultDistanceUnit = "km";

    /// <summary>Localized chart title (web <c>t('replay.elevation.title', 'Elevation Profile')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("replay.elevation.title", "Elevation Profile");
    }
}

/// <summary>
/// The render-ready projection of an elevation series — everything the WinUI view needs to draw a frame
/// without recomputing anything, so the view is a thin renderer and the projection is verified headlessly.
/// It is the native analogue of the values the web <c>ElevationProfile</c> derives in its component body:
/// the <see cref="State"/> (the empty / populated branch), the <see cref="Points"/> fed to the area chart,
/// the cumulative <see cref="GainMeters"/> / <see cref="LossMeters"/> rolled up for the
/// <see cref="Subtitle"/> (web <c>elevGain</c> + the <c>↑ … ↓ …</c> subtitle), the optional
/// <see cref="CursorDistance"/> / <see cref="CursorIndex"/> reference-line anchor (web <c>cursorDistance</c>)
/// and the localized chrome strings.
/// </summary>
public sealed class ElevationProfileDisplay
{
    internal ElevationProfileDisplay(
        ElevationProfileState state,
        IReadOnlyList<ChartPoint> points,
        int gainMeters,
        int lossMeters,
        string subtitle,
        double? cursorDistance,
        int? cursorIndex,
        string distanceUnit,
        string title,
        string subtitleUnitlessTitle,
        string emptyMessage,
        string elevationLabel,
        string accessibleSummary)
    {
        State = state;
        Points = points;
        GainMeters = gainMeters;
        LossMeters = lossMeters;
        Subtitle = subtitle;
        CursorDistance = cursorDistance;
        CursorIndex = cursorIndex;
        DistanceUnit = distanceUnit;
        Title = title;
        ElevationAxisLabel = subtitleUnitlessTitle;
        EmptyMessage = emptyMessage;
        ElevationLabel = elevationLabel;
        AccessibleSummary = accessibleSummary;
    }

    /// <summary>Which render branch this projection represents.</summary>
    public ElevationProfileState State { get; }

    /// <summary>True when there are no samples (the web <c>data.length === 0</c> branch).</summary>
    public bool IsEmpty => State == ElevationProfileState.Empty;

    /// <summary>The chart points: <c>X</c> = cumulative distance, <c>Y</c> = elevation in metres.</summary>
    public IReadOnlyList<ChartPoint> Points { get; }

    /// <summary>Total metres climbed across the route (web <c>elevGain.gain</c>, rounded).</summary>
    public int GainMeters { get; }

    /// <summary>Total metres descended across the route (web <c>elevGain.loss</c>, rounded).</summary>
    public int LossMeters { get; }

    /// <summary>The gain/loss subtitle, e.g. <c>↑ 312m  ↓ 188m</c> (web chart-container subtitle).</summary>
    public string Subtitle { get; }

    /// <summary>The distance the cursor reference line sits at, or null when no frame is selected.</summary>
    public double? CursorDistance { get; }

    /// <summary>The original sample index the cursor sits at, or null (web <c>currentIndex</c> when in range).</summary>
    public int? CursorIndex { get; }

    /// <summary>The distance-axis display unit (web <c>distanceUnit</c>, e.g. <c>km</c>).</summary>
    public string DistanceUnit { get; }

    /// <summary>The localized chart title (web <c>replay.elevation.title</c>).</summary>
    public string Title { get; }

    /// <summary>The elevation-axis unit label — always metres, matching the web Y-axis <c>m</c> label.</summary>
    public string ElevationAxisLabel { get; }

    /// <summary>The localized empty-state message (web <c>replay.elevation.noData</c>).</summary>
    public string EmptyMessage { get; }

    /// <summary>The localized series label used in the tooltip (web <c>replay.elevation.label</c>).</summary>
    public string ElevationLabel { get; }

    /// <summary>The localized accessible chart summary (web <c>ariaLabel</c> via <c>replay.elevation.aria</c>).</summary>
    public string AccessibleSummary { get; }
}

/// <summary>
/// Pure, UI-thread-free projection of an elevation series into an <see cref="ElevationProfileDisplay"/> — the
/// native port of the derivations in the web <c>ElevationProfile</c> component body
/// (web/src/components/charts/ElevationProfile.tsx). It folds the per-step elevation deltas into a
/// gain/loss total (web <c>elevGain</c> memo, L45-L54), resolves the cursor distance from the selected index
/// (web <c>cursorDistance</c> memo, L56-L59), builds the chart points and composes every localized string,
/// so both the WinUI view and the unit tests share one source of truth.
/// </summary>
public static class ElevationProfileProjection
{
    private static readonly IReadOnlyList<ChartPoint> NoPoints = [];

    /// <summary>
    /// Projects <paramref name="samples"/> (a null list is treated as empty) at the optional
    /// <paramref name="currentIndex"/> cursor, in the given <paramref name="distanceUnit"/>, resolving every
    /// label through <paramref name="localizer"/>.
    /// </summary>
    public static ElevationProfileDisplay Project(
        IReadOnlyList<ElevationSample>? samples,
        int? currentIndex,
        string? distanceUnit,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string unit = string.IsNullOrEmpty(distanceUnit)
            ? ElevationProfileRegistration.DefaultDistanceUnit
            : distanceUnit;
        string title = localizer.GetString("replay.elevation.title", "Elevation Profile");
        string elevationLabel = localizer.GetString("replay.elevation.label", "Elevation");
        string emptyMessage = localizer.GetString("replay.elevation.noData", "No elevation data available");

        // web L73-L87: the empty branch keeps the same key but a different default string than the populated
        // branch — mirror that call shape exactly (the catalog value, when present, wins for both).
        if (samples is null || samples.Count == 0)
        {
            string emptyAria = localizer.GetString(
                "replay.elevation.aria",
                "Elevation profile chart \u2014 no data available yet");
            return new ElevationProfileDisplay(
                ElevationProfileState.Empty,
                NoPoints,
                gainMeters: 0,
                lossMeters: 0,
                subtitle: string.Empty,
                cursorDistance: null,
                cursorIndex: null,
                unit,
                title,
                "m",
                emptyMessage,
                elevationLabel,
                emptyAria);
        }

        var (gain, loss) = AccumulateGainLoss(samples);
        var points = BuildPoints(samples);
        var (cursorDistance, cursorIndex) = ResolveCursor(samples, currentIndex);

        // web L93: subtitle={`↑ ${elevGain.gain}m  ↓ ${elevGain.loss}m`} — not localized; the unit glyph is literal.
        string subtitle = string.Create(CultureInfo.InvariantCulture, $"\u2191 {gain}m  \u2193 {loss}m");

        // web L94: the populated ariaLabel reuses replay.elevation.aria with the route-summary default.
        string readyAria = localizer.GetString(
            "replay.elevation.aria",
            "Elevation profile chart along the route, with total gain and loss in meters");

        return new ElevationProfileDisplay(
            ElevationProfileState.Ready,
            points,
            gain,
            loss,
            subtitle,
            cursorDistance,
            cursorIndex,
            unit,
            title,
            "m",
            emptyMessage,
            elevationLabel,
            readyAria);
    }

    /// <summary>
    /// Builds the single chart series the view renders and the data-table tabulates — emerald
    /// (<see cref="ChartRole.Regen"/>) elevation in metres, matching the web area's <c>#10b981</c> stroke.
    /// </summary>
    public static ChartSeries BuildSeries(ElevationProfileDisplay display, string seriesName)
    {
        ArgumentNullException.ThrowIfNull(display);
        ArgumentException.ThrowIfNullOrEmpty(seriesName);
        return new ChartSeries(seriesName, display.Points)
        {
            Kind = ChartSeriesKind.Area,
            Role = ElevationProfileRegistration.SeriesRole,
            Unit = "m",
            Decimals = 0,
        };
    }

    // web L45-L54: walk consecutive samples; positive deltas add to gain, negative to loss (absolute).
    private static (int Gain, int Loss) AccumulateGainLoss(IReadOnlyList<ElevationSample> samples)
    {
        double gain = 0;
        double loss = 0;
        for (int i = 1; i < samples.Count; i++)
        {
            double diff = samples[i].Elevation - samples[i - 1].Elevation;
            if (diff > 0)
            {
                gain += diff;
            }
            else
            {
                loss += Math.Abs(diff);
            }
        }

        return ((int)Math.Round(gain), (int)Math.Round(loss));
    }

    private static List<ChartPoint> BuildPoints(IReadOnlyList<ElevationSample> samples)
    {
        var points = new List<ChartPoint>(samples.Count);
        foreach (var sample in samples)
        {
            points.Add(new ChartPoint(sample.Distance, sample.Elevation));
        }

        return points;
    }

    // web L56-L59: cursorDistance = (currentIndex != null && data[currentIndex]) ? data[currentIndex].distance : undefined.
    private static (double? Distance, int? Index) ResolveCursor(
        IReadOnlyList<ElevationSample> samples,
        int? currentIndex)
    {
        if (currentIndex is { } index && index >= 0 && index < samples.Count)
        {
            return (samples[index].Distance, index);
        }

        return (null, null);
    }
}

/// <summary>
/// PII-safe diagnostics for the elevation-profile surface (P1/S11 diagnostics contract). Elevation and
/// distance samples are location-adjacent, so the collector records ONLY the operational
/// <see cref="RecordViewOpened"/> signal with the surface slug — never a sample value, distance or index.
/// Thread-safe; mirrors the other shared-surface diagnostics collectors.
/// </summary>
public sealed class ElevationProfileDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ElevationProfileDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ElevationProfile</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ElevationProfileRegistration.Slug}");
    }
}
