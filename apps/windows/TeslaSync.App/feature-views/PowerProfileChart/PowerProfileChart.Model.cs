using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// One sampled point of a drive's instantaneous-power trace — the native mirror of the two fields the web
/// <c>PowerProfileChart</c> reads from each <c>ChartDataPoint</c>
/// (<c>web/src/features/driving/components/drive-detail/types.ts</c>): the formatted <see cref="Time"/> label
/// the web plots on the X axis (<c>dataKey="time"</c>) and the instantaneous <see cref="Power"/> in kilowatts
/// the web plots on the Y axis (<c>dataKey="power"</c>, positive = draw, negative = regen). Power is already
/// kW at this presentational boundary exactly as the web component receives it (the drive-detail page derives
/// it once and passes it down as a prop); no unit conversion happens here. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="Time">The formatted X-axis time label (web <c>ChartDataPoint.time</c>).</param>
/// <param name="Power">Instantaneous power in kilowatts (web <c>ChartDataPoint.power</c>).</param>
public readonly record struct PowerSample(string Time, double Power);

/// <summary>
/// The drive-power summary the web <c>PowerProfileChart</c> renders beneath the chart — the native subset of
/// the web <c>DriveStats</c> (<c>web/src/features/driving/components/drive-detail/types.ts</c>) limited to the
/// three figures the source reads: the peak draw (<see cref="PowerMax"/>, web <c>stats.powerMax</c>), the peak
/// regen (<see cref="PowerMin"/>, the most-negative power, web <c>stats.powerMin</c>) and the mean
/// (<see cref="AvgPower"/>, web <c>stats.avgPower</c>). All three are kilowatts, matching the web "kW" suffix.
/// Pure data so the projection is verified headlessly.
/// </summary>
/// <param name="PowerMax">Peak draw in kW (web <c>stats.powerMax</c>, shown as "Max Power").</param>
/// <param name="PowerMin">Peak regen in kW — most-negative power (web <c>stats.powerMin</c>, "Max Regen").</param>
/// <param name="AvgPower">Mean power in kW (web <c>stats.avgPower</c>, shown as "Avg").</param>
public readonly record struct PowerProfileStats(double PowerMax, double PowerMin, double AvgPower)
{
    /// <summary>The all-zero summary used when there is nothing to chart.</summary>
    public static PowerProfileStats Zero { get; } = new(0, 0, 0);
}

/// <summary>
/// The parent-owned async phase a <see cref="PowerProfileChartModel"/> is in. The web
/// <c>PowerProfileChart</c> is a pure presentational child (its only hooks are <c>useTranslation</c> plus the
/// two chart cursor-sync hooks); the surrounding drive-detail page owns the cache-then-network lifecycle. The
/// native surface renders that lifecycle inline so the parent drives the phase down with the samples rather
/// than swapping the surface out.
/// </summary>
public enum PowerProfilePhase
{
    /// <summary>The first fetch of the drive telemetry is in flight — render the loading surface.</summary>
    Loading,

    /// <summary>A snapshot resolved (possibly sparse, possibly stale/offline) — render the chart or empty.</summary>
    Ready,

    /// <summary>The fetch failed with no cached snapshot — render the error surface with a retry affordance.</summary>
    Error,
}

/// <summary>
/// The render-time data model the <c>PowerProfileChart</c> view binds to. The web component is purely
/// presentational and takes only <c>chartData</c> + <c>stats</c>; this native model wraps that same pair in the
/// standard async envelope (<see cref="Phase"/> + the freshness flags) the parent drive-detail page drives, so
/// the surface can render every state inline. Pure data — no WinUI types — so
/// <see cref="PowerProfileChartProjection"/> is verified headlessly.
/// </summary>
/// <param name="Phase">The parent-owned async phase.</param>
/// <param name="ChartData">The per-sample power trace (the web <c>chartData</c> prop).</param>
/// <param name="Stats">The drive-power summary (the web <c>stats</c> prop).</param>
/// <param name="IsStale">True when the shown snapshot is older than the freshness window.</param>
/// <param name="IsOffline">True when the snapshot is served from cache while offline.</param>
/// <param name="ErrorDetail">Optional resolved error/offline detail surfaced in the error body.</param>
public sealed record PowerProfileChartModel(
    PowerProfilePhase Phase,
    IReadOnlyList<PowerSample> ChartData,
    PowerProfileStats Stats,
    bool IsStale = false,
    bool IsOffline = false,
    string? ErrorDetail = null)
{
    /// <summary>The initial model: the first fetch is in flight and no samples have arrived yet.</summary>
    public static PowerProfileChartModel Pending { get; } =
        new(PowerProfilePhase.Loading, Array.Empty<PowerSample>(), PowerProfileStats.Zero);

    /// <summary>A resolved, fresh model with no chartable trace — the empty state.</summary>
    public static PowerProfileChartModel Empty { get; } =
        new(PowerProfilePhase.Ready, Array.Empty<PowerSample>(), PowerProfileStats.Zero);

    /// <summary>A resolved, fresh model carrying the supplied trace and summary.</summary>
    public static PowerProfileChartModel Loaded(IReadOnlyList<PowerSample> chartData, PowerProfileStats stats) =>
        new(PowerProfilePhase.Ready, chartData, stats);

    /// <summary>A resolved model whose snapshot is stale (older than the freshness window).</summary>
    public static PowerProfileChartModel StaleSnapshot(IReadOnlyList<PowerSample> chartData, PowerProfileStats stats) =>
        new(PowerProfilePhase.Ready, chartData, stats, IsStale: true);

    /// <summary>A resolved model served from cache while offline.</summary>
    public static PowerProfileChartModel OfflineSnapshot(IReadOnlyList<PowerSample> chartData, PowerProfileStats stats) =>
        new(PowerProfilePhase.Ready, chartData, stats, IsOffline: true);

    /// <summary>A failed model with no cached snapshot — the error state.</summary>
    public static PowerProfileChartModel Failed(string? detail = null) =>
        new(PowerProfilePhase.Error, Array.Empty<PowerSample>(), PowerProfileStats.Zero, ErrorDetail: detail);
}

/// <summary>
/// The mutually-exclusive surface state the <c>PowerProfileChart</c> renders. The web source itself only
/// expresses the chart content vs. its inline "No telemetry data available" fallback (<see cref="Ready"/> /
/// <see cref="Empty"/>); the remaining branches are the standard native async chrome the parent drive-detail
/// page drives. None is ever hidden — every state maps onto a visible surface.
/// </summary>
public enum PowerProfileChartState
{
    /// <summary>Initial fetch in flight — chart skeleton chrome.</summary>
    Loading,

    /// <summary>Fetch failed with no cache — the <c>QueryError</c> equivalent with a retry affordance.</summary>
    Error,

    /// <summary>Resolved with too few samples to chart — a friendly empty surface (web <c>noChartData</c>).</summary>
    Empty,

    /// <summary>At least two samples, fresh — the area chart plus the summary stats (web fall-through).</summary>
    Ready,

    /// <summary>Shown snapshot is older than the freshness window — chart plus a stale chip.</summary>
    Stale,

    /// <summary>Snapshot served from cache while offline — cached chart plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One projected, display-ready summary figure rendered beneath the chart — the native mirror of one of the
/// three web <c>&lt;span&gt;</c> stats ("Max Power" / "Max Regen" / "Avg"). Holds the localized
/// <see cref="Label"/>, the formatted <see cref="Value"/> (already carrying its " kW" suffix), the design-token
/// brush key tinting the value (web amber / cyan / primary), and a spoken <see cref="AutomationName"/>. Pure
/// data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Label">Localized stat label (web "Max Power" / "Max Regen" / "Avg").</param>
/// <param name="Value">Formatted value with its " kW" unit suffix.</param>
/// <param name="ColorBrushKey">Design-token brush key tinting the value.</param>
/// <param name="AutomationName">Spoken "label: value" summary for Narrator.</param>
public sealed record PowerProfileStatItem(string Label, string Value, string ColorBrushKey, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the chart for one input model — the native analogue of what the
/// web <c>PowerProfileChart</c> returns through <c>ChartContainer</c>. Holds the resolved title / aria-label,
/// the per-state messages, the single Power <see cref="ChartSeries"/>, the three summary
/// <see cref="Stats"/> rendered below the chart, the <see cref="HasData"/> gate (web
/// <c>chartData.length &gt; 1</c>), the active <see cref="State"/> (plus the <see cref="ContainerState"/> the
/// chart body maps onto) and the optional freshness <see cref="FreshnessChip"/>. Pure data so every branch is
/// asserted headlessly.
/// </summary>
/// <param name="State">The active mutually-exclusive surface state.</param>
/// <param name="ContainerState">The chart-body lifecycle state the visual chart frame maps onto.</param>
/// <param name="Title">Resolved chart heading (web <c>driveDetail.powerProfile</c>).</param>
/// <param name="AriaLabel">Resolved accessible figure name (web <c>driveDetail.powerProfile.aria</c>).</param>
/// <param name="EmptyMessage">Resolved empty-state message (web <c>driveDetail.noChartData</c>).</param>
/// <param name="ErrorMessage">Resolved error-state message.</param>
/// <param name="LoadingMessage">Resolved loading-state message (shared <c>common.loading</c>).</param>
/// <param name="RetryLabel">Resolved retry affordance label (shared <c>common.retry</c>).</param>
/// <param name="Series">The single Power-over-time area series (web <c>&lt;Area&gt;</c>).</param>
/// <param name="Stats">The three summary figures shown beneath the chart.</param>
/// <param name="HasData">True when there are at least two samples to chart (web gate).</param>
/// <param name="FreshnessChip">Stale / offline chip text; null in every other state.</param>
/// <param name="AutomationName">The spoken Narrator name for the whole surface in this state.</param>
public sealed record PowerProfileChartDisplay(
    PowerProfileChartState State,
    ChartState ContainerState,
    string Title,
    string AriaLabel,
    string EmptyMessage,
    string ErrorMessage,
    string LoadingMessage,
    string RetryLabel,
    ChartSeries Series,
    IReadOnlyList<PowerProfileStatItem> Stats,
    bool HasData,
    string? FreshnessChip,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="PowerProfileChartModel"/> to its <see cref="PowerProfileChartDisplay"/> —
/// the native port of <c>web/src/features/driving/components/drive-detail/PowerProfileChart.tsx</c>. The trace
/// maps onto a single power area series (web <c>&lt;Area dataKey="power"&gt;</c>); the empty gate mirrors the
/// web <c>chartData.length &gt; 1</c> (a single sample, like none, is too sparse to chart). The three summary
/// figures mirror the web stats row: "Max Power" (<c>fmtInt(powerMax)</c>) and "Max Regen"
/// (<c>fmtInt(powerMin)</c>) are formatted to whole kilowatts while "Avg" (<c>fmtNumber(avgPower)</c>) keeps
/// the default two decimals. Every label resolves through the i18n facade with the same keys the web source
/// uses. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class PowerProfileChartProjection
{
    /// <summary>The display unit the chart and summary express power in (web literal <c>'kW'</c>).</summary>
    public const string PowerUnit = "kW";

    /// <summary>Minimum sample count to draw the trace (web <c>chartData.length &gt; 1</c>).</summary>
    public const int MinSamplesToChart = 2;

    /// <summary>Tooltip decimals applied to the per-sample power value.</summary>
    public const int PowerTooltipDecimals = 1;

    /// <summary>Whole-kilowatt precision for the peak figures (web <c>fmtInt</c>).</summary>
    public const int PeakDecimals = 0;

    /// <summary>Two-decimal precision for the average figure (web <c>fmtNumber</c> default precision).</summary>
    public const int AverageDecimals = 2;

    // The web area trace is amber (#f59e0b); per the Windows token instruction we draw it with the platform's
    // semantic Power role (TsChartPowerBrush) — the same role DriveTelemetryWidget / ChargingTelemetryWidget
    // use for a power series — rather than porting the raw Tailwind hex. The "Max Power" figure pairs with the
    // same brush so it tracks the trace exactly as the web amber stat tracks the web amber trace.
    /// <summary>Brush key for the power trace and the "Max Power" figure (web amber → platform Power role).</summary>
    public const string PowerBrushKey = "TsChartPowerBrush";

    /// <summary>Brush key for the "Max Regen" figure (web cyan → platform Regen role).</summary>
    public const string RegenBrushKey = "TsChartRegenBrush";

    /// <summary>Brush key for the neutral "Avg" figure (web <c>--text-primary</c>).</summary>
    public const string AveragePrimaryBrushKey = "TsColorTextPrimaryBrush";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props plus the async envelope).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static PowerProfileChartDisplay Project(PowerProfileChartModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<PowerSample> samples = model.ChartData ?? Array.Empty<PowerSample>();

        string title = localizer.GetString("driveDetail.powerProfile", "Power Profile");
        string aria = localizer.GetString("driveDetail.powerProfile.aria", "Drive power profile area chart over time");
        string powerLabel = localizer.GetString("driveDetail.power", "Power");
        string emptyMessage = localizer.GetString("driveDetail.noChartData", "No telemetry data available");
        string loadingMessage = localizer.GetString("common.loading", "Loading");
        string retryLabel = localizer.GetString("common.retry", "Retry");
        string errorMessage = ResolveError(model, localizer);
        string staleLabel = localizer.GetString("driveDetail.stale", "Stale");
        string offlineLabel = localizer.GetString("driveDetail.offline", "Offline");

        bool hasData = samples.Count >= MinSamplesToChart;
        ChartSeries series = BuildSeries(samples, powerLabel);
        PowerProfileStatItem[] stats = BuildStats(model.Stats, localizer);

        PowerProfileChartState state = SelectState(model, hasData);
        ChartState containerState = MapContainerState(state, hasData);
        string? chip = state switch
        {
            PowerProfileChartState.Stale => staleLabel,
            PowerProfileChartState.Offline => offlineLabel,
            _ => null,
        };

        return new PowerProfileChartDisplay(
            State: state,
            ContainerState: containerState,
            Title: title,
            AriaLabel: aria,
            EmptyMessage: emptyMessage,
            ErrorMessage: errorMessage,
            LoadingMessage: loadingMessage,
            RetryLabel: retryLabel,
            Series: series,
            Stats: stats,
            HasData: hasData,
            FreshnessChip: chip,
            AutomationName: BuildAutomationName(state, title, aria, emptyMessage, errorMessage, loadingMessage, chip));
    }

    // Web parity: a single area series stroked with the power accent; the time label rides along on each point
    // (the web X axis is dataKey="time") and the raw kW values feed the curve while the tooltip rounds to one
    // decimal. The ordinal index is the X domain because the web's time axis is categorical, not numeric.
    private static ChartSeries BuildSeries(IReadOnlyList<PowerSample> samples, string powerLabel)
    {
        var points = new List<ChartPoint>(samples.Count);
        for (int i = 0; i < samples.Count; i++)
        {
            PowerSample sample = samples[i];
            points.Add(new ChartPoint(i, sample.Power, sample.Time));
        }

        return new ChartSeries(powerLabel, points)
        {
            Kind = ChartSeriesKind.Area,
            Role = ChartRole.Power,
            Unit = PowerUnit,
            Decimals = PowerTooltipDecimals,
        };
    }

    // Web parity: the three <span> figures below the chart — Max Power (fmtInt, amber), Max Regen (fmtInt,
    // cyan) and Avg (fmtNumber, primary), each suffixed " kW".
    private static PowerProfileStatItem[] BuildStats(PowerProfileStats stats, ILocalizer localizer)
    {
        return new[]
        {
            BuildStat(
                localizer.GetString("driveDetail.maxPower", "Max Power"),
                stats.PowerMax,
                PeakDecimals,
                PowerBrushKey),
            BuildStat(
                localizer.GetString("driveDetail.maxRegen", "Max Regen"),
                stats.PowerMin,
                PeakDecimals,
                RegenBrushKey),
            BuildStat(
                localizer.GetString("driveDetail.avgLabel", "Avg"),
                stats.AvgPower,
                AverageDecimals,
                AveragePrimaryBrushKey),
        };
    }

    private static PowerProfileStatItem BuildStat(string label, double value, int decimals, string brushKey)
    {
        string formatted = string.Create(
            CultureInfo.CurrentCulture,
            $"{ScalarFormatters.FormatNumber(value, decimals)} {PowerUnit}");
        string automation = string.Create(CultureInfo.CurrentCulture, $"{label}: {formatted}");
        return new PowerProfileStatItem(label, formatted, brushKey, automation);
    }

    // Branch precedence: the parent phase wins first (loading → error), then freshness wins over emptiness so a
    // stale/offline chip survives a too-sparse cached snapshot; a fresh snapshot is Ready or Empty by sample
    // count (web chartData.length > 1).
    private static PowerProfileChartState SelectState(PowerProfileChartModel model, bool hasData) => model.Phase switch
    {
        PowerProfilePhase.Loading => PowerProfileChartState.Loading,
        PowerProfilePhase.Error => PowerProfileChartState.Error,
        _ => model.IsOffline
            ? PowerProfileChartState.Offline
            : model.IsStale
                ? PowerProfileChartState.Stale
                : hasData
                    ? PowerProfileChartState.Ready
                    : PowerProfileChartState.Empty,
    };

    // The visual chart frame only knows loading / empty / error / ready; a stale or offline snapshot with a
    // chartable trace still draws the chart (with a chip), while one without falls back to the empty body.
    private static ChartState MapContainerState(PowerProfileChartState state, bool hasData) => state switch
    {
        PowerProfileChartState.Loading => ChartState.Loading,
        PowerProfileChartState.Error => ChartState.Error,
        PowerProfileChartState.Empty => ChartState.Empty,
        PowerProfileChartState.Stale => hasData ? ChartState.Ready : ChartState.Empty,
        PowerProfileChartState.Offline => hasData ? ChartState.Ready : ChartState.Empty,
        _ => ChartState.Ready,
    };

    private static string ResolveError(PowerProfileChartModel model, ILocalizer localizer)
    {
        if (!string.IsNullOrWhiteSpace(model.ErrorDetail))
        {
            return model.ErrorDetail!;
        }

        return localizer.GetString("driveDetail.powerProfile.error", "Couldn't load the power profile");
    }

    private static string BuildAutomationName(
        PowerProfileChartState state,
        string title,
        string aria,
        string emptyMessage,
        string errorMessage,
        string loadingMessage,
        string? chip) => state switch
        {
            PowerProfileChartState.Loading => $"{title}. {loadingMessage}",
            PowerProfileChartState.Error => $"{title}. {errorMessage}",
            PowerProfileChartState.Empty => $"{title}. {emptyMessage}",
            PowerProfileChartState.Stale => $"{title}. {aria}. {chip}",
            PowerProfileChartState.Offline => $"{title}. {aria}. {chip}",
            _ => $"{title}. {aria}",
        };
}

/// <summary>
/// Canonical metadata for the <c>PowerProfileChart</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/driving/components/drive-detail/PowerProfileChart.tsx</c>.
/// </summary>
public static class PowerProfileChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "PowerProfileChart";

    /// <summary>Localized surface title (web "Power Profile").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("driveDetail.powerProfile", "Power Profile");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>PowerProfileChart</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a power value, time, sample count or
/// drive id — so a diagnostics line can never leak drive telemetry. Thread-safe.
/// </summary>
public sealed class PowerProfileChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to; null discards them.</param>
    public PowerProfileChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PowerProfileChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PowerProfileChartRegistration.Slug}");
    }
}
