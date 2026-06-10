using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// One drive's peak / regen power point — the native mirror of the three fields the web
/// <c>PowerOutputChart</c> reads from each <c>ChartDataPoint</c>
/// (<c>web/src/features/driving/components/drivetrain-health/constants.ts</c>): the formatted
/// <see cref="Date"/> the web plots on the categorical X axis (<c>dataKey="date"</c>), the per-drive peak power
/// <see cref="PowerMax"/> (web <c>powerMax</c>, the violet <c>&lt;Area dataKey="powerMax"&gt;</c>) and the peak
/// regen power <see cref="PowerMin"/> (web <c>powerMin</c>, the red <c>&lt;Area dataKey="powerMin"&gt;</c>). Both
/// powers are already kilowatts at this presentational boundary exactly as the web component receives them (the
/// drivetrain-health page derives them once — <c>powerMax = avgPowerW / 1000</c> — and passes them down as a
/// prop); no unit conversion happens here. Pure data — no WinUI types — so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Date">The formatted X-axis date label (web <c>ChartDataPoint.date</c>).</param>
/// <param name="PowerMax">Per-drive peak power in kilowatts (web <c>ChartDataPoint.powerMax</c>).</param>
/// <param name="PowerMin">Per-drive peak regen power in kilowatts (web <c>ChartDataPoint.powerMin</c>).</param>
public readonly record struct PowerOutputPoint(string Date, double PowerMax, double PowerMin);

/// <summary>
/// The parent-owned async phase a <see cref="PowerOutputChartModel"/> is in. The web
/// <c>PowerOutputChart</c> is a pure presentational child (its only hooks are <c>useTranslation</c> and
/// <c>useHiddenSeries</c>); the surrounding drivetrain-health page owns the cache-then-network lifecycle. The
/// native surface renders that lifecycle inline so the parent drives the phase down with the points rather
/// than swapping the surface out.
/// </summary>
public enum PowerOutputPhase
{
    /// <summary>The first fetch of the drive history is in flight — render the loading surface.</summary>
    Loading,

    /// <summary>A snapshot resolved (possibly sparse, possibly stale/offline) — render the chart or empty.</summary>
    Ready,

    /// <summary>The fetch failed with no cached snapshot — render the error surface with a retry affordance.</summary>
    Error,
}

/// <summary>
/// The render-time data model the <c>PowerOutputChart</c> view binds to. The web component is purely
/// presentational and takes only the <c>data</c> array; this native model wraps that same list in the standard
/// async envelope (<see cref="Phase"/> + the freshness flags) the parent drivetrain-health page drives, so the
/// surface can render every state inline. Pure data — no WinUI types — so
/// <see cref="PowerOutputChartProjection"/> is verified headlessly.
/// </summary>
/// <param name="Phase">The parent-owned async phase.</param>
/// <param name="Data">The per-drive peak/regen power history (the web <c>data</c> prop).</param>
/// <param name="IsStale">True when the shown snapshot is older than the freshness window.</param>
/// <param name="IsOffline">True when the snapshot is served from cache while offline.</param>
/// <param name="ErrorDetail">Optional resolved error/offline detail surfaced in the error body.</param>
public sealed record PowerOutputChartModel(
    PowerOutputPhase Phase,
    IReadOnlyList<PowerOutputPoint> Data,
    bool IsStale = false,
    bool IsOffline = false,
    string? ErrorDetail = null)
{
    /// <summary>The initial model: the first fetch is in flight and no points have arrived yet.</summary>
    public static PowerOutputChartModel Pending { get; } =
        new(PowerOutputPhase.Loading, Array.Empty<PowerOutputPoint>());

    /// <summary>A resolved, fresh model with no chartable history — the empty state.</summary>
    public static PowerOutputChartModel Empty { get; } =
        new(PowerOutputPhase.Ready, Array.Empty<PowerOutputPoint>());

    /// <summary>A resolved, fresh model carrying the supplied per-drive history.</summary>
    public static PowerOutputChartModel Loaded(IReadOnlyList<PowerOutputPoint> data) =>
        new(PowerOutputPhase.Ready, data);

    /// <summary>A resolved model whose snapshot is stale (older than the freshness window).</summary>
    public static PowerOutputChartModel StaleSnapshot(IReadOnlyList<PowerOutputPoint> data) =>
        new(PowerOutputPhase.Ready, data, IsStale: true);

    /// <summary>A resolved model served from cache while offline.</summary>
    public static PowerOutputChartModel OfflineSnapshot(IReadOnlyList<PowerOutputPoint> data) =>
        new(PowerOutputPhase.Ready, data, IsOffline: true);

    /// <summary>A failed model with no cached snapshot — the error state.</summary>
    public static PowerOutputChartModel Failed(string? detail = null) =>
        new(PowerOutputPhase.Error, Array.Empty<PowerOutputPoint>(), ErrorDetail: detail);
}

/// <summary>
/// The mutually-exclusive surface state the <c>PowerOutputChart</c> renders. The web source itself only
/// expresses the chart content vs. its <c>data.length &lt;= 1</c> early <c>return null</c> (<see cref="Ready"/>
/// vs. <see cref="Empty"/>); the remaining branches are the standard native async chrome the parent
/// drivetrain-health page drives. None is ever hidden — every state maps onto a visible surface (the native
/// contract never reproduces the web's <c>return null</c> as a blank region).
/// </summary>
public enum PowerOutputChartState
{
    /// <summary>Initial fetch in flight — chart skeleton chrome.</summary>
    Loading,

    /// <summary>Fetch failed with no cache — the <c>QueryError</c> equivalent with a retry affordance.</summary>
    Error,

    /// <summary>Resolved with too few drives to chart — a friendly empty surface (web <c>return null</c>).</summary>
    Empty,

    /// <summary>Two or more drives, fresh — the dual-area chart plus the accessible data table.</summary>
    Ready,

    /// <summary>Shown snapshot is older than the freshness window — chart plus a stale chip.</summary>
    Stale,

    /// <summary>Snapshot served from cache while offline — cached chart plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One projected, screen-reader-ready row of the accessible data table — the native mirror of one web table
/// row (<c>web ChartContainer</c> <c>data</c> + <c>dataColumns</c>). Holds the formatted
/// <see cref="Date"/> (web <c>date</c> column), the peak-power cell <see cref="Peak"/> (web <c>power_max_kw</c>)
/// and the regen-power cell <see cref="Regen"/> (web <c>power_min_kw</c>), each already a display string. Pure
/// data so the table projection is unit-tested without a UI host.
/// </summary>
/// <param name="Date">The drive date (web <c>date</c> cell).</param>
/// <param name="Peak">The formatted peak-power cell in kW (web <c>power_max_kw</c> cell).</param>
/// <param name="Regen">The formatted regen-power cell in kW (web <c>power_min_kw</c> cell).</param>
/// <param name="AutomationName">The spoken "date: peak, regen" row summary for Narrator.</param>
public sealed record PowerOutputTableRow(string Date, string Peak, string Regen, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the chart for one input model — the native analogue of what the
/// web <c>PowerOutputChart</c> returns through <c>ChartContainer</c>. Holds the resolved title / subtitle /
/// aria-label, the per-state messages, the two power <see cref="Series"/> (peak + regen) the chart and its
/// hidden-series legend bind, the accessible data table (<see cref="TableColumns"/> + <see cref="TableRows"/>,
/// web <c>dataColumns</c> + <c>data</c>), the <see cref="HasData"/> gate (web <c>data.length &gt; 1</c>), the
/// active <see cref="State"/> (plus the <see cref="ContainerState"/> the chart body maps onto) and the optional
/// freshness <see cref="FreshnessChip"/>. Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The active mutually-exclusive surface state.</param>
/// <param name="ContainerState">The chart-body lifecycle state the visual chart frame maps onto.</param>
/// <param name="Title">Resolved chart heading (web <c>drivetrain.powerOutput</c>).</param>
/// <param name="Subtitle">Resolved supporting sub-heading (web <c>drivetrain.powerOutputSub</c>).</param>
/// <param name="AriaLabel">Resolved accessible figure name (web <c>drivetrain.powerOutput.aria</c>).</param>
/// <param name="EmptyMessage">Resolved empty-state message (web's <c>return null</c> becomes a visible state).</param>
/// <param name="ErrorMessage">Resolved error-state message.</param>
/// <param name="LoadingMessage">Resolved loading-state message (shared <c>common.loading</c>).</param>
/// <param name="RetryLabel">Resolved retry affordance label (shared <c>common.retry</c>).</param>
/// <param name="DataTableLabel">Resolved label for the accessible data-table toggle.</param>
/// <param name="Series">The two power area series — peak then regen (web <c>&lt;Area&gt;</c> pair).</param>
/// <param name="TableColumns">The data-table column headers — Date / Peak / Regen (web <c>dataColumns</c>).</param>
/// <param name="TableRows">The data-table body rows, one per drive (web <c>data</c>).</param>
/// <param name="HasData">True when there are at least two drives to chart (web gate).</param>
/// <param name="FreshnessChip">Stale / offline chip text; null in every other state.</param>
/// <param name="AutomationName">The spoken Narrator name for the whole surface in this state.</param>
public sealed record PowerOutputChartDisplay(
    PowerOutputChartState State,
    ChartState ContainerState,
    string Title,
    string Subtitle,
    string AriaLabel,
    string EmptyMessage,
    string ErrorMessage,
    string LoadingMessage,
    string RetryLabel,
    string DataTableLabel,
    IReadOnlyList<ChartSeries> Series,
    IReadOnlyList<string> TableColumns,
    IReadOnlyList<PowerOutputTableRow> TableRows,
    bool HasData,
    string? FreshnessChip,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="PowerOutputChartModel"/> to its <see cref="PowerOutputChartDisplay"/> —
/// the native port of <c>web/src/features/driving/components/drivetrain-health/PowerOutputChart.tsx</c>. The
/// history maps onto two power area series — peak (web violet <c>&lt;Area dataKey="powerMax"&gt;</c>) and regen
/// (web red <c>&lt;Area dataKey="powerMin"&gt;</c>); per the Windows token instruction they are drawn with the
/// platform's semantic Power / Regen roles rather than the raw Tailwind hex. The empty gate mirrors the web
/// <c>data.length &gt; 1</c> (a single drive, like none, is too sparse to chart, and the web component returns
/// <c>null</c> — the native surface renders a friendly empty state instead). The accessible data table mirrors
/// the web <c>dataColumns</c> (Date / Peak (kW) / Regen (kW)) and <c>data</c> rows. Every label resolves
/// through the i18n facade with the same keys the web source uses. No WinUI types — unit-tested without a UI
/// host.
/// </summary>
public static class PowerOutputChartProjection
{
    /// <summary>The display unit the chart and table express power in (web column suffix <c>(kW)</c>).</summary>
    public const string PowerUnit = "kW";

    /// <summary>Minimum drive count to draw the traces (web <c>data.length &gt; 1</c>).</summary>
    public const int MinPointsToChart = 2;

    /// <summary>Tooltip decimals applied to the per-drive power values.</summary>
    public const int PowerTooltipDecimals = 1;

    /// <summary>
    /// Decimals the data-table power cells are formatted to. The web table coerces the raw value with
    /// <c>String()</c>; the native table reads in the same one-decimal kW precision the chart tooltip uses
    /// (the documented intent of the web <c>dataColumns</c> formatter) so the table and chart never disagree.
    /// </summary>
    public const int TableValueDecimals = 1;

    /// <summary>Stable id of the zero-power reference line (web <c>&lt;ReferenceLine y={0} /&gt;</c>).</summary>
    public const string ZeroReferenceId = "drivetrain-power-zero";

    // The web peak trace is violet (#8b5cf6); per the Windows token instruction we draw it with the platform's
    // semantic Power role rather than porting the raw Tailwind hex. The web regen trace is red (#ef4444); it is
    // semantically the regen series, so it maps onto the platform Regen role.
    /// <summary>Semantic chart role for the peak-power series (web violet → platform Power role).</summary>
    public const ChartRole PeakRole = ChartRole.Power;

    /// <summary>Semantic chart role for the regen-power series (web red → platform Regen role).</summary>
    public const ChartRole RegenRole = ChartRole.Regen;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web prop plus the async envelope).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static PowerOutputChartDisplay Project(PowerOutputChartModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<PowerOutputPoint> points = model.Data ?? Array.Empty<PowerOutputPoint>();

        string title = localizer.GetString("drivetrain.powerOutput", "Power Output History");
        string subtitle = localizer.GetString("drivetrain.powerOutputSub", "Peak and regen power per drive over time");
        string aria = localizer.GetString(
            "drivetrain.powerOutput.aria",
            "Per-drive peak and regen motor power output history area chart");
        string peakName = localizer.GetString("drivetrain.powerMax", "Peak Power (kW)");
        string regenName = localizer.GetString("drivetrain.powerMin", "Regen Power (kW)");
        string emptyMessage = localizer.GetString("drivetrain.noData", "No data");
        string loadingMessage = localizer.GetString("common.loading", "Loading");
        string retryLabel = localizer.GetString("common.retry", "Retry");
        string dataTableLabel = localizer.GetString("drivetrain.powerOutput.dataTable", "Show data table");
        string errorMessage = ResolveError(model, localizer);
        string staleLabel = localizer.GetString("drivetrain.stale", "Stale");
        string offlineLabel = localizer.GetString("common.offline", "Offline");

        bool hasData = points.Count >= MinPointsToChart;
        IReadOnlyList<ChartSeries> series = BuildSeries(points, peakName, regenName);
        IReadOnlyList<string> tableColumns = BuildColumns(localizer);
        IReadOnlyList<PowerOutputTableRow> tableRows = BuildRows(points, tableColumns);

        PowerOutputChartState state = SelectState(model, hasData);
        ChartState containerState = MapContainerState(state, hasData);
        string? chip = state switch
        {
            PowerOutputChartState.Stale => staleLabel,
            PowerOutputChartState.Offline => offlineLabel,
            _ => null,
        };

        return new PowerOutputChartDisplay(
            State: state,
            ContainerState: containerState,
            Title: title,
            Subtitle: subtitle,
            AriaLabel: aria,
            EmptyMessage: emptyMessage,
            ErrorMessage: errorMessage,
            LoadingMessage: loadingMessage,
            RetryLabel: retryLabel,
            DataTableLabel: dataTableLabel,
            Series: series,
            TableColumns: tableColumns,
            TableRows: tableRows,
            HasData: hasData,
            FreshnessChip: chip,
            AutomationName: BuildAutomationName(state, title, aria, emptyMessage, errorMessage, loadingMessage, chip));
    }

    // Web parity: two area series stroked with the power / regen accents. The date label rides along on each
    // point (the web X axis is dataKey="date") and the raw kW values feed the curves while the tooltip rounds
    // to one decimal. The ordinal index is the X domain because the web's date axis is categorical, not numeric.
    private static ChartSeries[] BuildSeries(
        IReadOnlyList<PowerOutputPoint> points,
        string peakName,
        string regenName)
    {
        var peak = new List<ChartPoint>(points.Count);
        var regen = new List<ChartPoint>(points.Count);
        for (int i = 0; i < points.Count; i++)
        {
            PowerOutputPoint point = points[i];
            peak.Add(new ChartPoint(i, point.PowerMax, point.Date));
            regen.Add(new ChartPoint(i, point.PowerMin, point.Date));
        }

        var peakSeries = new ChartSeries(peakName, peak)
        {
            Kind = ChartSeriesKind.Area,
            Role = PeakRole,
            Unit = PowerUnit,
            Decimals = PowerTooltipDecimals,
        };
        var regenSeries = new ChartSeries(regenName, regen)
        {
            Kind = ChartSeriesKind.Area,
            Role = RegenRole,
            Unit = PowerUnit,
            Decimals = PowerTooltipDecimals,
        };

        return new[] { peakSeries, regenSeries };
    }

    // Web parity: the three dataColumns headers — Date / Peak (kW) / Regen (kW).
    private static string[] BuildColumns(ILocalizer localizer)
    {
        return new[]
        {
            localizer.GetString("drivetrain.col.date", "Date"),
            localizer.GetString("drivetrain.col.powerMax", "Peak (kW)"),
            localizer.GetString("drivetrain.col.powerMin", "Regen (kW)"),
        };
    }

    // Web parity: the data table body — one row per drive (date, peak kW, regen kW). The web coerces each value
    // with String(); the native cells read in the chart's one-decimal kW precision so the table and chart agree.
    private static List<PowerOutputTableRow> BuildRows(
        IReadOnlyList<PowerOutputPoint> points,
        IReadOnlyList<string> columns)
    {
        var rows = new List<PowerOutputTableRow>(points.Count);
        foreach (PowerOutputPoint point in points)
        {
            string peak = ScalarFormatters.FormatNumber(point.PowerMax, TableValueDecimals);
            string regen = ScalarFormatters.FormatNumber(point.PowerMin, TableValueDecimals);
            string automation = string.Format(
                CultureInfo.CurrentCulture,
                "{0}, {1}: {2}, {3}: {4}",
                point.Date,
                columns[1],
                peak,
                columns[2],
                regen);
            rows.Add(new PowerOutputTableRow(point.Date, peak, regen, automation));
        }

        return rows;
    }

    // Branch precedence: the parent phase wins first (loading → error), then freshness wins over emptiness so a
    // stale/offline chip survives a too-sparse cached snapshot; a fresh snapshot is Ready or Empty by drive
    // count (web data.length > 1).
    private static PowerOutputChartState SelectState(PowerOutputChartModel model, bool hasData) => model.Phase switch
    {
        PowerOutputPhase.Loading => PowerOutputChartState.Loading,
        PowerOutputPhase.Error => PowerOutputChartState.Error,
        _ => model.IsOffline
            ? PowerOutputChartState.Offline
            : model.IsStale
                ? PowerOutputChartState.Stale
                : hasData
                    ? PowerOutputChartState.Ready
                    : PowerOutputChartState.Empty,
    };

    // The visual chart frame only knows loading / empty / error / ready; a stale or offline snapshot with a
    // chartable history still draws the chart (with a chip), while one without falls back to the empty body.
    private static ChartState MapContainerState(PowerOutputChartState state, bool hasData) => state switch
    {
        PowerOutputChartState.Loading => ChartState.Loading,
        PowerOutputChartState.Error => ChartState.Error,
        PowerOutputChartState.Empty => ChartState.Empty,
        PowerOutputChartState.Stale => hasData ? ChartState.Ready : ChartState.Empty,
        PowerOutputChartState.Offline => hasData ? ChartState.Ready : ChartState.Empty,
        _ => ChartState.Ready,
    };

    private static string ResolveError(PowerOutputChartModel model, ILocalizer localizer)
    {
        if (!string.IsNullOrWhiteSpace(model.ErrorDetail))
        {
            return model.ErrorDetail!;
        }

        return localizer.GetString("drivetrain.powerOutput.error", "Couldn't load power output history");
    }

    private static string BuildAutomationName(
        PowerOutputChartState state,
        string title,
        string aria,
        string emptyMessage,
        string errorMessage,
        string loadingMessage,
        string? chip) => state switch
        {
            PowerOutputChartState.Loading => $"{title}. {loadingMessage}",
            PowerOutputChartState.Error => $"{title}. {errorMessage}",
            PowerOutputChartState.Empty => $"{title}. {emptyMessage}",
            PowerOutputChartState.Stale => $"{title}. {aria}. {chip}",
            PowerOutputChartState.Offline => $"{title}. {aria}. {chip}",
            _ => $"{title}. {aria}",
        };
}

/// <summary>
/// Canonical metadata for the <c>PowerOutputChart</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/driving/components/drivetrain-health/PowerOutputChart.tsx</c>.
/// </summary>
public static class PowerOutputChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "PowerOutputChart";

    /// <summary>Localized surface title (web "Power Output History").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("drivetrain.powerOutput", "Power Output History");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>PowerOutputChart</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a power value, date, drive count or drive
/// id — so a diagnostics line can never leak drive telemetry. Thread-safe.
/// </summary>
public sealed class PowerOutputChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to; null discards them.</param>
    public PowerOutputChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PowerOutputChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PowerOutputChartRegistration.Slug}");
    }
}
