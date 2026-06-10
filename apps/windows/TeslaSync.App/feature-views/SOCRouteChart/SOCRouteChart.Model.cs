using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// One sampled point of a planned trip's state-of-charge curve — the native mirror of the web
/// <c>TripSOCPoint</c> shape consumed by
/// <c>web/src/features/driving/components/SOCRouteChart.tsx</c> (<c>{ distance_m: number; soc: number }</c>).
/// <see cref="DistanceMeters"/> is the cumulative route distance the sample sits at (the chart's X domain) and
/// <see cref="Soc"/> is the projected battery state-of-charge in percent (the Y value). Pure data — no WinUI
/// types — so the projection is unit-tested without a UI host.
/// </summary>
public readonly record struct RouteSocPoint(double DistanceMeters, double Soc);

/// <summary>
/// One planned charge stop along the trip — the native mirror of the slice of the web <c>TripChargeStop</c>
/// shape the chart actually reads (<c>charge_from_soc</c>). <see cref="ChargeFromSoc"/> is the state-of-charge
/// the vehicle is expected to arrive at the stop with; the projection walks the SOC curve to anchor each stop
/// to the route distance where the curve first drops to that level (the web
/// <c>SOCRouteChart</c> stop-matching), which becomes a vertical reference line. Pure data.
/// </summary>
public readonly record struct RouteChargeStop(double ChargeFromSoc);

/// <summary>
/// The parent-owned async phase a <see cref="SOCRouteChartModel"/> is in. The web <c>SOCRouteChart</c> is a
/// pure presentational child (its only hook is <c>useTranslation</c>); the surrounding trip-planner page owns
/// the cache-then-network lifecycle. The native surface renders that lifecycle inline, so the parent drives
/// the phase down with the planned route rather than swapping the surface out.
/// </summary>
public enum SOCRoutePhase
{
    /// <summary>The first plan of the route is in flight — render the loading surface.</summary>
    Loading,

    /// <summary>A plan resolved (possibly empty, possibly stale/offline) — render the curve or empty.</summary>
    Ready,

    /// <summary>The plan failed with no cached snapshot — render the error surface with a retry affordance.</summary>
    Error,
}

/// <summary>
/// The render-time data model the <c>SOCRouteChart</c> view binds to. The web component is purely
/// presentational and takes three props (<c>socCurve</c>, <c>chargeStops</c>, <c>minArrivalSOC</c>); this
/// native model wraps that same payload in the standard async envelope (<see cref="Phase"/> + the freshness
/// flags) the parent trip-planner page drives, so the surface can render every state inline. Pure data — no
/// WinUI types — so <see cref="SOCRouteChartProjection"/> is verified headlessly.
/// </summary>
/// <param name="Phase">The parent-owned async phase.</param>
/// <param name="SocCurve">The planned state-of-charge samples (the web <c>socCurve</c> prop).</param>
/// <param name="ChargeStops">The planned charge stops (the web <c>chargeStops</c> prop).</param>
/// <param name="MinArrivalSoc">The minimum arrival SOC threshold (the web <c>minArrivalSOC</c> prop).</param>
/// <param name="IsStale">True when the shown snapshot is older than the freshness window.</param>
/// <param name="IsOffline">True when the snapshot is served from cache while offline.</param>
/// <param name="ErrorDetail">Optional resolved error/offline detail surfaced in the error body.</param>
public sealed record SOCRouteChartModel(
    SOCRoutePhase Phase,
    IReadOnlyList<RouteSocPoint> SocCurve,
    IReadOnlyList<RouteChargeStop> ChargeStops,
    double MinArrivalSoc,
    bool IsStale = false,
    bool IsOffline = false,
    string? ErrorDetail = null)
{
    /// <summary>The initial model: the first plan is in flight and no curve has arrived yet.</summary>
    public static SOCRouteChartModel Pending { get; } = new(
        SOCRoutePhase.Loading,
        Array.Empty<RouteSocPoint>(),
        Array.Empty<RouteChargeStop>(),
        0);

    /// <summary>A resolved, fresh model with no samples — the empty state.</summary>
    public static SOCRouteChartModel Empty { get; } = new(
        SOCRoutePhase.Ready,
        Array.Empty<RouteSocPoint>(),
        Array.Empty<RouteChargeStop>(),
        0);

    /// <summary>A resolved, fresh model carrying the supplied planned route.</summary>
    public static SOCRouteChartModel Loaded(
        IReadOnlyList<RouteSocPoint> socCurve,
        IReadOnlyList<RouteChargeStop> chargeStops,
        double minArrivalSoc) =>
        new(SOCRoutePhase.Ready, socCurve, chargeStops, minArrivalSoc);

    /// <summary>A resolved model whose snapshot is stale (older than the freshness window).</summary>
    public static SOCRouteChartModel StaleSnapshot(
        IReadOnlyList<RouteSocPoint> socCurve,
        IReadOnlyList<RouteChargeStop> chargeStops,
        double minArrivalSoc) =>
        new(SOCRoutePhase.Ready, socCurve, chargeStops, minArrivalSoc, IsStale: true);

    /// <summary>A resolved model served from cache while offline.</summary>
    public static SOCRouteChartModel OfflineSnapshot(
        IReadOnlyList<RouteSocPoint> socCurve,
        IReadOnlyList<RouteChargeStop> chargeStops,
        double minArrivalSoc) =>
        new(SOCRoutePhase.Ready, socCurve, chargeStops, minArrivalSoc, IsOffline: true);

    /// <summary>A failed model with no cached snapshot — the error state.</summary>
    public static SOCRouteChartModel Failed(string? detail = null) => new(
        SOCRoutePhase.Error,
        Array.Empty<RouteSocPoint>(),
        Array.Empty<RouteChargeStop>(),
        0,
        ErrorDetail: detail);
}

/// <summary>
/// The mutually-exclusive surface state the <c>SOCRouteChart</c> renders. The web source itself only expresses
/// the curve content (<see cref="Ready"/> / <see cref="Empty"/>, gated on <c>chartData.length === 0</c>); the
/// remaining branches are the standard native async chrome the parent trip-planner page drives. None is ever
/// hidden — every state maps onto a visible surface.
/// </summary>
public enum SOCRouteChartState
{
    /// <summary>Initial plan in flight — chart skeleton chrome (web <c>ChartContainer</c> spinner).</summary>
    Loading,

    /// <summary>Plan failed with no cache — the <c>QueryError</c> equivalent with a retry affordance.</summary>
    Error,

    /// <summary>Resolved with no samples — the web <c>tripPlanner.socChart.empty</c> friendly surface.</summary>
    Empty,

    /// <summary>At least one sample, fresh — the area chart (web fall-through render).</summary>
    Ready,

    /// <summary>Shown snapshot is older than the freshness window — chart plus a stale chip.</summary>
    Stale,

    /// <summary>Snapshot served from cache while offline — cached chart plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One projected, render-ready sample of the SOC curve — the native mirror of one entry of the web
/// <c>chartData</c> array (<c>{ distance, soc }</c>, each rounded to one decimal via
/// <c>Math.round(value * 10) / 10</c>). <see cref="Distance"/> is the route distance the web source plots on
/// its <c>distance</c> axis and <see cref="Soc"/> is the rounded state-of-charge. The same rounded pair feeds
/// both the area series and the accessible fallback table, exactly as the web feeds <c>chartData</c> to both
/// the recharts <c>AreaChart</c> and the <c>ChartContainer</c> data. Pure data.
/// </summary>
public sealed record SOCRoutePoint(double Distance, double Soc);

/// <summary>
/// One projected, display-ready row of the accessible fallback table — the native mirror of a single row of
/// the web <c>data</c> array fed into <c>ChartContainer</c> (<c>{ distance, soc }</c>). <see cref="Distance"/>
/// and <see cref="Soc"/> are the pre-formatted cell strings keyed by the <c>distance</c> / <c>soc</c> columns.
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="RowKey">A stable, unique row identity.</param>
/// <param name="Distance">The formatted distance cell (web <c>Distance</c> column).</param>
/// <param name="Soc">The formatted state-of-charge cell (web <c>SOC %</c> column).</param>
public sealed record SOCRouteChartRow(string RowKey, string Distance, string Soc);

/// <summary>
/// The fully projected, render-ready view of the chart for one input model — the native analogue of what the
/// web <c>SOCRouteChart</c> returns through <c>ChartContainer</c>. Holds the resolved title / aria-label, the
/// per-state messages, the axis + column labels, the single SOC <see cref="ChartSeries"/>, the reference
/// <see cref="Annotations"/> (the min-arrival threshold and each charge stop), the accessible table
/// <see cref="Rows"/>, the active <see cref="State"/> (plus the <see cref="ContainerState"/> the chart body
/// maps onto) and the optional freshness <see cref="FreshnessChip"/>. Pure data so every branch is asserted
/// headlessly.
/// </summary>
/// <param name="State">The active mutually-exclusive surface state.</param>
/// <param name="ContainerState">The chart-body lifecycle state the visual chart frame maps onto.</param>
/// <param name="Title">Resolved chart heading (web <c>tripPlanner.socChart.title</c>).</param>
/// <param name="AriaLabel">Resolved accessible figure name (web <c>tripPlanner.socChart.aria</c>).</param>
/// <param name="EmptyMessage">Resolved empty-state message (web <c>tripPlanner.socChart.empty</c>).</param>
/// <param name="ErrorMessage">Resolved error-state message.</param>
/// <param name="LoadingMessage">Resolved loading-state message (shared <c>common.loading</c>).</param>
/// <param name="RetryLabel">Resolved retry affordance label (shared <c>common.retry</c>).</param>
/// <param name="DataTableLabel">Resolved accessible-table caption (interpolates the title).</param>
/// <param name="AxisXTitle">Resolved X-axis title (web <c>XAxis</c> "km" label).</param>
/// <param name="AxisYTitle">Resolved Y-axis title (web <c>YAxis</c> "SOC %" label).</param>
/// <param name="DistanceColumnLabel">Resolved Distance column header (web <c>tripPlanner.socChart.col.distance</c>).</param>
/// <param name="SocColumnLabel">Resolved SOC column header (web <c>tripPlanner.socChart.col.soc</c>).</param>
/// <param name="Series">The single SOC-vs-distance area series (web <c>&lt;Area&gt;</c>).</param>
/// <param name="Annotations">The reference lines (min-arrival threshold + each charge stop).</param>
/// <param name="HasCurve">True when there is at least one sample to draw.</param>
/// <param name="FreshnessChip">Stale / offline chip text; null in every other state.</param>
/// <param name="Rows">The accessible fallback table rows.</param>
/// <param name="AutomationName">The spoken Narrator name for the whole surface in this state.</param>
public sealed record SOCRouteChartDisplay(
    SOCRouteChartState State,
    ChartState ContainerState,
    string Title,
    string AriaLabel,
    string EmptyMessage,
    string ErrorMessage,
    string LoadingMessage,
    string RetryLabel,
    string DataTableLabel,
    string AxisXTitle,
    string AxisYTitle,
    string DistanceColumnLabel,
    string SocColumnLabel,
    ChartSeries Series,
    IReadOnlyList<ChartAnnotation> Annotations,
    bool HasCurve,
    string? FreshnessChip,
    IReadOnlyList<SOCRouteChartRow> Rows,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SOCRouteChartModel"/> to its <see cref="SOCRouteChartDisplay"/> — the
/// native port of <c>web/src/features/driving/components/SOCRouteChart.tsx</c>. The planned curve maps onto a
/// single battery-green area series (web <c>&lt;Area stroke="#22c55e"&gt;</c>); the min-arrival SOC becomes a
/// horizontal reference line (web red <c>#ef4444</c> "Min N%") and each charge stop a vertical reference line
/// (web blue <c>#3b82f6</c> "\u26A1 Stop N"), anchored to the route distance the curve first drops to that
/// stop's arrival SOC (the web stop-matching walk). The accessible fallback table mirrors the web
/// <c>dataColumns</c> (<c>Distance</c> / <c>SOC %</c>) over the same one-decimal-rounded <c>chartData</c> the
/// web feeds the chart. Every label resolves through the i18n facade with the same keys the web source feeds
/// into <c>ChartContainer</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class SOCRouteChartProjection
{
    /// <summary>Column key for the distance column (web <c>key: 'distance'</c>).</summary>
    public const string DistanceKey = "distance";

    /// <summary>Column key for the state-of-charge column (web <c>key: 'soc'</c>).</summary>
    public const string SocKey = "soc";

    /// <summary>Annotation id of the minimum-arrival-SOC reference line.</summary>
    public const string MinArrivalAnnotationId = "min-arrival";

    /// <summary>Fixed decimals applied to the curve values (web rounds to one decimal).</summary>
    public const int CurveDecimals = 1;

    // Web parity: the SOC curve is stroked with the battery-green token (web `stroke="#22c55e"`), matching the
    // established green->Battery mapping used across the drivetrain charts.
    private const ChartRole SocSeriesRole = ChartRole.Battery;

    // The minimum-arrival threshold reference line. The web draws it red (`stroke="#ef4444"`, the "don't drop
    // below this" limit); the closest brand token is the warm red/orange Temperature role.
    private const ChartRole MinArrivalRole = ChartRole.Temperature;

    // Each charge-stop reference line. The web draws them blue (`stroke="#3b82f6"`); the closest brand token is
    // the blue Speed role.
    private const ChartRole ChargeStopRole = ChartRole.Speed;

    // Web: a charge stop is anchored to the first curve point whose SOC is within 5% of the stop's arrival SOC
    // (`Math.abs(pt.soc - stop.charge_from_soc) < 5`).
    private const double StopSocTolerance = 5.0;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props plus the async envelope).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static SOCRouteChartDisplay Project(SOCRouteChartModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<RouteSocPoint> curve = model.SocCurve ?? Array.Empty<RouteSocPoint>();
        IReadOnlyList<RouteChargeStop> stops = model.ChargeStops ?? Array.Empty<RouteChargeStop>();

        string title = localizer.GetString("tripPlanner.socChart.title", "Battery Along Route");
        string aria = localizer.GetString(
            "tripPlanner.socChart.aria",
            "Planned route battery state-of-charge area chart");
        string emptyMessage = localizer.GetString("tripPlanner.socChart.empty", "Plan a trip to see the SOC curve");
        string distanceColumn = localizer.GetString("tripPlanner.socChart.col.distance", "Distance");
        string socColumn = localizer.GetString("tripPlanner.socChart.col.soc", "SOC %");
        string axisX = localizer.GetString("tripPlanner.socChart.axis.distance", "km");
        string axisY = localizer.GetString("tripPlanner.socChart.axis.soc", "SOC %");
        string seriesName = localizer.GetString("tripPlanner.socChart.series", "SOC");
        string seriesUnit = localizer.GetString("tripPlanner.socChart.unit", "%");
        string minArrivalTemplate = localizer.GetString("tripPlanner.socChart.minArrival", "Min {0}%");
        string stopTemplate = localizer.GetString("tripPlanner.socChart.stop", "\u26A1 Stop {0}");
        string loadingMessage = localizer.GetString("common.loading", "Loading");
        string retryLabel = localizer.GetString("common.retry", "Retry");
        string staleLabel = localizer.GetString("tripPlanner.socChart.stale", "Stale");
        string offlineLabel = localizer.GetString("tripPlanner.socChart.offline", "Offline");
        string errorMessage = ResolveError(model, localizer);
        string tableLabel = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("chart.a11y.fallbackTableLabel", "{0} \u2014 data table"),
            title);

        IReadOnlyList<SOCRoutePoint> chartData = BuildChartData(curve);
        bool hasCurve = chartData.Count > 0;

        ChartSeries series = BuildSeries(chartData, seriesName, seriesUnit);
        IReadOnlyList<double> stopDistances = BuildStopDistances(curve, stops);
        IReadOnlyList<ChartAnnotation> annotations = BuildAnnotations(
            model.MinArrivalSoc,
            stopDistances,
            minArrivalTemplate,
            stopTemplate);
        IReadOnlyList<SOCRouteChartRow> rows = BuildRows(chartData);

        SOCRouteChartState state = SelectState(model, hasCurve);
        ChartState containerState = MapContainerState(state, hasCurve);
        string? chip = state switch
        {
            SOCRouteChartState.Stale => staleLabel,
            SOCRouteChartState.Offline => offlineLabel,
            _ => null,
        };

        return new SOCRouteChartDisplay(
            State: state,
            ContainerState: containerState,
            Title: title,
            AriaLabel: aria,
            EmptyMessage: emptyMessage,
            ErrorMessage: errorMessage,
            LoadingMessage: loadingMessage,
            RetryLabel: retryLabel,
            DataTableLabel: tableLabel,
            AxisXTitle: axisX,
            AxisYTitle: axisY,
            DistanceColumnLabel: distanceColumn,
            SocColumnLabel: socColumn,
            Series: series,
            Annotations: annotations,
            HasCurve: hasCurve,
            FreshnessChip: chip,
            Rows: rows,
            AutomationName: BuildAutomationName(state, title, aria, emptyMessage, errorMessage, loadingMessage, chip));
    }

    // Web parity: `chartData = (socCurve ?? []).map(pt => ({ distance: round(pt.distance_m, 1), soc: round(pt.soc, 1) }))`.
    // The same one-decimal-rounded pair feeds both the area series and the accessible table (the web feeds
    // `chartData` to the AreaChart and to ChartContainer's `data`). The web's `distance` axis plots the rounded
    // `distance_m` value verbatim under a "km" tick label; the projection reproduces that value as-is.
    private static IReadOnlyList<SOCRoutePoint> BuildChartData(IReadOnlyList<RouteSocPoint> curve)
    {
        if (curve.Count == 0)
        {
            return Array.Empty<SOCRoutePoint>();
        }

        var points = new List<SOCRoutePoint>(curve.Count);
        foreach (RouteSocPoint pt in curve)
        {
            points.Add(new SOCRoutePoint(Round(pt.DistanceMeters), Round(pt.Soc)));
        }

        return points;
    }

    // The single SOC area series (web `<Area dataKey="soc" stroke="#22c55e">`): the rounded chartData points,
    // the battery-green role, the "%" unit and one-decimal tooltip precision.
    private static ChartSeries BuildSeries(
        IReadOnlyList<SOCRoutePoint> chartData,
        string seriesName,
        string seriesUnit)
    {
        var points = new List<ChartPoint>(chartData.Count);
        foreach (SOCRoutePoint p in chartData)
        {
            points.Add(new ChartPoint(p.Distance, p.Soc));
        }

        return new ChartSeries(seriesName, points)
        {
            Kind = ChartSeriesKind.Area,
            Role = SocSeriesRole,
            Unit = seriesUnit,
            Decimals = CurveDecimals,
        };
    }

    // Web parity: walk the charge stops in order, anchoring each to the FIRST raw curve point that lies beyond
    // the running cumulative distance and whose raw SOC is within 5% of the stop's arrival SOC, then advance the
    // cumulative distance to that point. The matched point's distance (rounded to a whole unit, the web
    // `Math.round(matchPt.distance_m)`) becomes a vertical reference line.
    private static IReadOnlyList<double> BuildStopDistances(
        IReadOnlyList<RouteSocPoint> curve,
        IReadOnlyList<RouteChargeStop> stops)
    {
        if (curve.Count == 0 || stops.Count == 0)
        {
            return Array.Empty<double>();
        }

        var distances = new List<double>(stops.Count);
        double cumulative = 0;
        foreach (RouteChargeStop stop in stops)
        {
            foreach (RouteSocPoint pt in curve)
            {
                if (pt.DistanceMeters > cumulative && Math.Abs(pt.Soc - stop.ChargeFromSoc) < StopSocTolerance)
                {
                    distances.Add(Math.Round(pt.DistanceMeters, 0, MidpointRounding.AwayFromZero));
                    cumulative = pt.DistanceMeters;
                    break;
                }
            }
        }

        return distances;
    }

    // The reference lines drawn over the plot: the horizontal min-arrival threshold (web red "Min N%") plus one
    // vertical line per matched charge stop (web blue "\u26A1 Stop N"). The min-arrival line is omitted only
    // when its value is not a finite number; the web always renders it inside the chart branch.
    private static IReadOnlyList<ChartAnnotation> BuildAnnotations(
        double minArrivalSoc,
        IReadOnlyList<double> stopDistances,
        string minArrivalTemplate,
        string stopTemplate)
    {
        var annotations = new List<ChartAnnotation>(stopDistances.Count + 1);

        if (!double.IsNaN(minArrivalSoc) && !double.IsInfinity(minArrivalSoc))
        {
            string minLabel = string.Format(
                CultureInfo.CurrentCulture,
                minArrivalTemplate,
                ChartPalette.FormatValue(minArrivalSoc, null));
            annotations.Add(new ChartAnnotation(MinArrivalAnnotationId, ChartAnnotationKind.HorizontalLine, minArrivalSoc)
            {
                Label = minLabel,
                Role = MinArrivalRole,
            });
        }

        for (int i = 0; i < stopDistances.Count; i++)
        {
            string stopLabel = string.Format(CultureInfo.CurrentCulture, stopTemplate, i + 1);
            annotations.Add(new ChartAnnotation(
                string.Create(CultureInfo.InvariantCulture, $"stop-{i}"),
                ChartAnnotationKind.VerticalLine,
                stopDistances[i])
            {
                Label = stopLabel,
                Role = ChargeStopRole,
            });
        }

        if (annotations.Count == 0)
        {
            return Array.Empty<ChartAnnotation>();
        }

        return annotations;
    }

    // The accessible fallback table mirrors the web `dataColumns` rows over the same rounded chartData: the
    // distance cell and the SOC cell, each at its natural precision (trailing-zero-free, the web number form).
    private static IReadOnlyList<SOCRouteChartRow> BuildRows(IReadOnlyList<SOCRoutePoint> chartData)
    {
        if (chartData.Count == 0)
        {
            return Array.Empty<SOCRouteChartRow>();
        }

        var rows = new List<SOCRouteChartRow>(chartData.Count);
        for (int i = 0; i < chartData.Count; i++)
        {
            SOCRoutePoint p = chartData[i];
            rows.Add(new SOCRouteChartRow(
                RowKey: string.Create(CultureInfo.InvariantCulture, $"row-{i}"),
                Distance: ChartPalette.FormatValue(p.Distance, null),
                Soc: ChartPalette.FormatValue(p.Soc, null)));
        }

        return rows;
    }

    // Branch precedence: the parent phase wins first (loading -> error), then freshness wins over emptiness so a
    // stale/offline chip survives an empty cached snapshot; a fresh snapshot is Ready or Empty by sample count
    // (the web `chartData.length === 0` test).
    private static SOCRouteChartState SelectState(SOCRouteChartModel model, bool hasCurve) => model.Phase switch
    {
        SOCRoutePhase.Loading => SOCRouteChartState.Loading,
        SOCRoutePhase.Error => SOCRouteChartState.Error,
        _ => model.IsOffline
            ? SOCRouteChartState.Offline
            : model.IsStale
                ? SOCRouteChartState.Stale
                : hasCurve
                    ? SOCRouteChartState.Ready
                    : SOCRouteChartState.Empty,
    };

    // The visual chart frame only knows loading / empty / error / ready; a stale or offline snapshot with
    // samples still draws the chart (with a chip), while one without falls back to the empty body.
    private static ChartState MapContainerState(SOCRouteChartState state, bool hasCurve) => state switch
    {
        SOCRouteChartState.Loading => ChartState.Loading,
        SOCRouteChartState.Error => ChartState.Error,
        SOCRouteChartState.Empty => ChartState.Empty,
        SOCRouteChartState.Stale => hasCurve ? ChartState.Ready : ChartState.Empty,
        SOCRouteChartState.Offline => hasCurve ? ChartState.Ready : ChartState.Empty,
        _ => ChartState.Ready,
    };

    private static double Round(double value) => Math.Round(value, CurveDecimals, MidpointRounding.AwayFromZero);

    private static string ResolveError(SOCRouteChartModel model, ILocalizer localizer)
    {
        if (!string.IsNullOrWhiteSpace(model.ErrorDetail))
        {
            return model.ErrorDetail!;
        }

        return localizer.GetString("tripPlanner.socChart.error", "Couldn't load the route SOC curve");
    }

    private static string BuildAutomationName(
        SOCRouteChartState state,
        string title,
        string aria,
        string emptyMessage,
        string errorMessage,
        string loadingMessage,
        string? chip) => state switch
        {
            SOCRouteChartState.Loading => $"{title}. {loadingMessage}",
            SOCRouteChartState.Error => $"{title}. {errorMessage}",
            SOCRouteChartState.Empty => $"{title}. {emptyMessage}",
            SOCRouteChartState.Stale => $"{title}. {aria}. {chip}",
            SOCRouteChartState.Offline => $"{title}. {aria}. {chip}",
            _ => $"{title}. {aria}",
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>SOCRouteChart</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a distance, SOC or stop value — so a
/// diagnostics line can never leak a planned route. Thread-safe.
/// </summary>
public sealed class SOCRouteChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to; null discards them.</param>
    public SOCRouteChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SOCRouteChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SOCRouteChartRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>SOCRouteChart</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/driving/components/SOCRouteChart.tsx</c>.
/// </summary>
public static class SOCRouteChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SOCRouteChart";
}
