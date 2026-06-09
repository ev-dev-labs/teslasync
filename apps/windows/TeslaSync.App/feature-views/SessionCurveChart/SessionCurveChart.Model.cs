using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// One sampled point of a charging session's power curve — the native mirror of the web
/// <c>CurvePoint</c> shape in <c>web/src/features/charging/components/charging-curve/types.ts</c>
/// (<c>{ soc: number; power: number }</c>). <see cref="Soc"/> is the battery state-of-charge in percent
/// (the chart's X domain) and <see cref="Power"/> is the instantaneous charging power in kilowatts (the Y
/// value). Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public readonly record struct CurvePoint(double Soc, double Power);

/// <summary>
/// The parent-owned async phase a <see cref="SessionCurveChartModel"/> is in. The web
/// <c>SessionCurveChart</c> is a pure presentational child (its only hook is <c>useTranslation</c>); the
/// surrounding charging-detail page owns the cache-then-network lifecycle. The native surface renders that
/// lifecycle inline, so the parent drives the phase down with the curve rather than swapping the surface out.
/// </summary>
public enum SessionCurvePhase
{
    /// <summary>The first fetch of the session curve is in flight — render the loading surface.</summary>
    Loading,

    /// <summary>A snapshot resolved (possibly empty, possibly stale/offline) — render the curve or empty.</summary>
    Ready,

    /// <summary>The fetch failed with no cached snapshot — render the error surface with a retry affordance.</summary>
    Error,
}

/// <summary>
/// The render-time data model the <c>SessionCurveChart</c> view binds to. The web component is purely
/// presentational and takes only <c>curveData</c>; this native model wraps that same series in the standard
/// async envelope (<see cref="Phase"/> + the freshness flags) the parent charging-detail page drives, so the
/// surface can render every state inline. Pure data — no WinUI types — so <see cref="SessionCurveChartProjection"/>
/// is verified headlessly.
/// </summary>
/// <param name="Phase">The parent-owned async phase.</param>
/// <param name="CurveData">The Power-vs-SOC samples (the web <c>curveData</c> prop).</param>
/// <param name="IsStale">True when the shown snapshot is older than the freshness window.</param>
/// <param name="IsOffline">True when the snapshot is served from cache while offline.</param>
/// <param name="ErrorDetail">Optional resolved error/offline detail surfaced in the error body.</param>
public sealed record SessionCurveChartModel(
    SessionCurvePhase Phase,
    IReadOnlyList<CurvePoint> CurveData,
    bool IsStale = false,
    bool IsOffline = false,
    string? ErrorDetail = null)
{
    /// <summary>The initial model: the first fetch is in flight and no curve has arrived yet.</summary>
    public static SessionCurveChartModel Pending { get; } =
        new(SessionCurvePhase.Loading, Array.Empty<CurvePoint>());

    /// <summary>A resolved, fresh model with no samples — the empty state.</summary>
    public static SessionCurveChartModel Empty { get; } =
        new(SessionCurvePhase.Ready, Array.Empty<CurvePoint>());

    /// <summary>A resolved, fresh model carrying the supplied curve samples.</summary>
    public static SessionCurveChartModel Loaded(IReadOnlyList<CurvePoint> curveData) =>
        new(SessionCurvePhase.Ready, curveData);

    /// <summary>A resolved model whose snapshot is stale (older than the freshness window).</summary>
    public static SessionCurveChartModel StaleSnapshot(IReadOnlyList<CurvePoint> curveData) =>
        new(SessionCurvePhase.Ready, curveData, IsStale: true);

    /// <summary>A resolved model served from cache while offline.</summary>
    public static SessionCurveChartModel OfflineSnapshot(IReadOnlyList<CurvePoint> curveData) =>
        new(SessionCurvePhase.Ready, curveData, IsOffline: true);

    /// <summary>A failed model with no cached snapshot — the error state.</summary>
    public static SessionCurveChartModel Failed(string? detail = null) =>
        new(SessionCurvePhase.Error, Array.Empty<CurvePoint>(), ErrorDetail: detail);
}

/// <summary>
/// The mutually-exclusive surface state the <c>SessionCurveChart</c> renders. The web source itself only
/// expresses the curve content (<see cref="Ready"/> / <see cref="Empty"/>); the remaining branches are the
/// standard native async chrome the parent charging-detail page drives. None is ever hidden — every state
/// maps onto a visible surface.
/// </summary>
public enum SessionCurveChartState
{
    /// <summary>Initial fetch in flight — chart skeleton chrome (web <c>ChartContainer</c> spinner).</summary>
    Loading,

    /// <summary>Fetch failed with no cache — the <c>QueryError</c> equivalent with a retry affordance.</summary>
    Error,

    /// <summary>Resolved with no samples — a friendly empty surface (web <c>chart.noData</c>).</summary>
    Empty,

    /// <summary>At least one sample, fresh — the area chart (web fall-through render).</summary>
    Ready,

    /// <summary>Shown snapshot is older than the freshness window — chart plus a stale chip.</summary>
    Stale,

    /// <summary>Snapshot served from cache while offline — cached chart plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One projected, display-ready row of the accessible fallback table — the native mirror of a single row of
/// the web <c>data</c> array fed into <c>ChartContainer</c> (<c>{ soc, power }</c>, the power rounded to one
/// decimal). <see cref="Soc"/> and <see cref="Power"/> are the pre-formatted cell strings keyed by the
/// <c>soc</c> / <c>power</c> columns. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="RowKey">A stable, unique row identity.</param>
/// <param name="Soc">The formatted state-of-charge cell (web <c>SOC %</c> column).</param>
/// <param name="Power">The formatted, one-decimal power cell (web <c>Power (kW)</c> column).</param>
public sealed record SessionCurveChartRow(string RowKey, string Soc, string Power);

/// <summary>
/// The fully projected, render-ready view of the chart for one input model — the native analogue of what the
/// web <c>SessionCurveChart</c> returns through <c>ChartContainer</c>. Holds the resolved title / subtitle /
/// aria-label, the per-state messages, the axis + column labels, the single Power <see cref="ChartSeries"/>,
/// the accessible table <see cref="Rows"/>, the active <see cref="State"/> (plus the
/// <see cref="ContainerState"/> the chart body maps onto) and the optional freshness <see cref="FreshnessChip"/>.
/// Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The active mutually-exclusive surface state.</param>
/// <param name="ContainerState">The chart-body lifecycle state the visual chart frame maps onto.</param>
/// <param name="Title">Resolved chart heading (web <c>charging.curve.powerVsSoc</c>).</param>
/// <param name="Subtitle">Resolved sub-heading (web <c>charging.curve.powerVsSocDesc</c>).</param>
/// <param name="AriaLabel">Resolved accessible figure name (web <c>charging.curve.powerVsSoc.aria</c>).</param>
/// <param name="EmptyMessage">Resolved empty-state message (shared <c>chart.noData</c>).</param>
/// <param name="ErrorMessage">Resolved error-state message.</param>
/// <param name="LoadingMessage">Resolved loading-state message (shared <c>common.loading</c>).</param>
/// <param name="RetryLabel">Resolved retry affordance label (shared <c>common.retry</c>).</param>
/// <param name="DataTableLabel">Resolved accessible-table caption (interpolates the title).</param>
/// <param name="AxisXTitle">Resolved X-axis title (web <c>charging.curve.socPercent</c>).</param>
/// <param name="AxisYTitle">Resolved Y-axis title (web <c>charging.curve.powerKw</c>).</param>
/// <param name="SocColumnLabel">Resolved SOC table column header (web <c>charging.curve.col.soc</c>).</param>
/// <param name="PowerColumnLabel">Resolved Power table column header (web <c>charging.curve.col.power</c>).</param>
/// <param name="Series">The single Power-vs-SOC area series (web <c>&lt;Area&gt;</c>).</param>
/// <param name="HasCurve">True when there is at least one sample to draw.</param>
/// <param name="FreshnessChip">Stale / offline chip text; null in every other state.</param>
/// <param name="Rows">The accessible fallback table rows.</param>
/// <param name="AutomationName">The spoken Narrator name for the whole surface in this state.</param>
public sealed record SessionCurveChartDisplay(
    SessionCurveChartState State,
    ChartState ContainerState,
    string Title,
    string Subtitle,
    string AriaLabel,
    string EmptyMessage,
    string ErrorMessage,
    string LoadingMessage,
    string RetryLabel,
    string DataTableLabel,
    string AxisXTitle,
    string AxisYTitle,
    string SocColumnLabel,
    string PowerColumnLabel,
    ChartSeries Series,
    bool HasCurve,
    string? FreshnessChip,
    IReadOnlyList<SessionCurveChartRow> Rows,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SessionCurveChartModel"/> to its <see cref="SessionCurveChartDisplay"/> —
/// the native port of <c>web/src/features/charging/components/charging-curve/SessionCurveChart.tsx</c>. The
/// curve maps onto a single accent area series (web <c>&lt;Area&gt;</c> with <c>CHART_COLORS[0]</c>); the
/// accessible fallback table mirrors the web <c>dataColumns</c> (<c>SOC %</c> / <c>Power (kW)</c>) with the
/// power rounded to one decimal (the web <c>Math.round(power * 10) / 10</c>). Every label resolves through the
/// i18n facade with the same keys the web source feeds into <c>ChartContainer</c>. No WinUI types — unit-tested
/// without a UI host.
/// </summary>
public static class SessionCurveChartProjection
{
    /// <summary>Column key for the state-of-charge column (web <c>key: 'soc'</c>).</summary>
    public const string SocKey = "soc";

    /// <summary>Column key for the power column (web <c>key: 'power'</c>).</summary>
    public const string PowerKey = "power";

    /// <summary>Fixed decimals applied to the power value (web rounds to one decimal).</summary>
    public const int PowerDecimals = 1;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props plus the async envelope).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static SessionCurveChartDisplay Project(SessionCurveChartModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<CurvePoint> curve = model.CurveData ?? Array.Empty<CurvePoint>();

        string title = localizer.GetString("charging.curve.powerVsSoc", "Power vs SOC");
        string subtitle = localizer.GetString(
            "charging.curve.powerVsSocDesc",
            "Charging power curve for selected session");
        string aria = localizer.GetString(
            "charging.curve.powerVsSoc.aria",
            "Charging power versus state-of-charge area chart for the selected session");
        string seriesName = localizer.GetString("charging.curve.power", "Power");
        string powerUnit = localizer.GetString("charging.curve.power.unit", "kW");
        string axisX = localizer.GetString("charging.curve.socPercent", "SOC (%)");
        string axisY = localizer.GetString("charging.curve.powerKw", "Power (kW)");
        string socColumn = localizer.GetString("charging.curve.col.soc", "SOC %");
        string powerColumn = localizer.GetString("charging.curve.col.power", "Power (kW)");
        string emptyMessage = localizer.GetString("chart.noData", "No data available");
        string loadingMessage = localizer.GetString("common.loading", "Loading");
        string errorMessage = ResolveError(model, localizer);
        string retryLabel = localizer.GetString("common.retry", "Retry");
        string staleLabel = localizer.GetString("charging.curve.stale", "Stale");
        string offlineLabel = localizer.GetString("charging.curve.offline", "Offline");
        string tableLabel = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("chart.a11y.fallbackTableLabel", "{0} \u2014 data table"),
            title);

        bool hasCurve = curve.Count > 0;
        ChartSeries series = BuildSeries(curve, seriesName, powerUnit);
        IReadOnlyList<SessionCurveChartRow> rows = BuildRows(curve);

        SessionCurveChartState state = SelectState(model, hasCurve);
        ChartState containerState = MapContainerState(state, hasCurve);
        string? chip = state switch
        {
            SessionCurveChartState.Stale => staleLabel,
            SessionCurveChartState.Offline => offlineLabel,
            _ => null,
        };

        return new SessionCurveChartDisplay(
            State: state,
            ContainerState: containerState,
            Title: title,
            Subtitle: subtitle,
            AriaLabel: aria,
            EmptyMessage: emptyMessage,
            ErrorMessage: errorMessage,
            LoadingMessage: loadingMessage,
            RetryLabel: retryLabel,
            DataTableLabel: tableLabel,
            AxisXTitle: axisX,
            AxisYTitle: axisY,
            SocColumnLabel: socColumn,
            PowerColumnLabel: powerColumn,
            Series: series,
            HasCurve: hasCurve,
            FreshnessChip: chip,
            Rows: rows,
            AutomationName: BuildAutomationName(state, title, aria, emptyMessage, errorMessage, loadingMessage, chip));
    }

    // Web parity: a single area series stroked with the first palette colour (CHART_COLORS[0]); the raw
    // (un-rounded) samples feed the curve, while the tooltip formats to one decimal with the " kW" unit.
    private static ChartSeries BuildSeries(IReadOnlyList<CurvePoint> curve, string seriesName, string unit)
    {
        var points = new List<ChartPoint>(curve.Count);
        foreach (CurvePoint p in curve)
        {
            points.Add(new ChartPoint(p.Soc, p.Power));
        }

        return new ChartSeries(seriesName, points)
        {
            Kind = ChartSeriesKind.Area,
            ColorIndex = 0,
            Unit = unit,
            Decimals = PowerDecimals,
        };
    }

    // The accessible fallback table mirrors the web `dataColumns` rows: the SOC cell at its natural precision
    // and the power cell rounded to one decimal (the web `Math.round(power * 10) / 10`, half away from zero).
    private static IReadOnlyList<SessionCurveChartRow> BuildRows(IReadOnlyList<CurvePoint> curve)
    {
        if (curve.Count == 0)
        {
            return Array.Empty<SessionCurveChartRow>();
        }

        var rows = new List<SessionCurveChartRow>(curve.Count);
        for (int i = 0; i < curve.Count; i++)
        {
            CurvePoint p = curve[i];
            double roundedPower = Math.Round(p.Power, PowerDecimals, MidpointRounding.AwayFromZero);
            rows.Add(new SessionCurveChartRow(
                RowKey: string.Create(CultureInfo.InvariantCulture, $"row-{i}"),
                Soc: ChartPalette.FormatValue(p.Soc, null),
                Power: ChartPalette.FormatValue(roundedPower, PowerDecimals)));
        }

        return rows;
    }

    // Branch precedence: the parent phase wins first (loading → error), then freshness wins over emptiness so
    // a stale/offline chip survives an empty cached snapshot; a fresh snapshot is Ready or Empty by sample count.
    private static SessionCurveChartState SelectState(SessionCurveChartModel model, bool hasCurve) => model.Phase switch
    {
        SessionCurvePhase.Loading => SessionCurveChartState.Loading,
        SessionCurvePhase.Error => SessionCurveChartState.Error,
        _ => model.IsOffline
            ? SessionCurveChartState.Offline
            : model.IsStale
                ? SessionCurveChartState.Stale
                : hasCurve
                    ? SessionCurveChartState.Ready
                    : SessionCurveChartState.Empty,
    };

    // The visual chart frame only knows loading / empty / error / ready; a stale or offline snapshot with
    // samples still draws the chart (with a chip), while one without falls back to the empty body.
    private static ChartState MapContainerState(SessionCurveChartState state, bool hasCurve) => state switch
    {
        SessionCurveChartState.Loading => ChartState.Loading,
        SessionCurveChartState.Error => ChartState.Error,
        SessionCurveChartState.Empty => ChartState.Empty,
        SessionCurveChartState.Stale => hasCurve ? ChartState.Ready : ChartState.Empty,
        SessionCurveChartState.Offline => hasCurve ? ChartState.Ready : ChartState.Empty,
        _ => ChartState.Ready,
    };

    private static string ResolveError(SessionCurveChartModel model, ILocalizer localizer)
    {
        if (!string.IsNullOrWhiteSpace(model.ErrorDetail))
        {
            return model.ErrorDetail!;
        }

        return localizer.GetString("charging.curve.error", "Couldn't load the charging curve");
    }

    private static string BuildAutomationName(
        SessionCurveChartState state,
        string title,
        string aria,
        string emptyMessage,
        string errorMessage,
        string loadingMessage,
        string? chip) => state switch
        {
            SessionCurveChartState.Loading => $"{title}. {loadingMessage}",
            SessionCurveChartState.Error => $"{title}. {errorMessage}",
            SessionCurveChartState.Empty => $"{title}. {emptyMessage}",
            SessionCurveChartState.Stale => $"{title}. {aria}. {chip}",
            SessionCurveChartState.Offline => $"{title}. {aria}. {chip}",
            _ => $"{title}. {aria}",
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>SessionCurveChart</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a SOC or power value — so a
/// diagnostics line can never leak charging telemetry. Thread-safe.
/// </summary>
public sealed class SessionCurveChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to; null discards them.</param>
    public SessionCurveChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SessionCurveChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SessionCurveChartRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>SessionCurveChart</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/charging/components/charging-curve/SessionCurveChart.tsx</c>.
/// </summary>
public static class SessionCurveChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SessionCurveChart";
}
