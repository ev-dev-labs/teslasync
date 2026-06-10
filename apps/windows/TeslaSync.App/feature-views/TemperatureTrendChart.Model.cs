using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>TemperatureTrendChart</c> surface — the native union of the
/// states the web component renders
/// (web/src/features/driving/components/drivetrain-health/TemperatureTrendChart.tsx). The web source is a pure
/// presentational component: it takes a single <c>data: ChartDataPoint[]</c> prop (date + outside temperature),
/// performs no fetching, and renders nothing (<c>return null</c>) until it has more than one sample. The parent
/// Drivetrain-Health page additionally pre-filters the points whose outside temperature is null before passing
/// the array in, so the branches are a direct function of the input <see cref="TemperatureTrendChartModel"/> —
/// there is no fetch-driven error / stale / offline branch to reproduce here. The parent owns the query
/// lifecycle (loading / error / stale / offline are handled once for the whole page before any chart is shown),
/// exactly as the web page only renders this chart once the recent-drive history has resolved. Every branch
/// maps onto a visible surface; none is ever hidden behind a blank panel.
/// </summary>
public enum TemperatureTrendChartState
{
    /// <summary>Initial fetch in flight (the parent is still loading the recent-drive history) — title + skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with one or zero plottable points (the web <c>data.length &lt;= 1</c> gate) — a friendly empty state.</summary>
    Empty,

    /// <summary>At least two outside-temperature points are available (web fall-through) — the trend line chart.</summary>
    Ready,
}

/// <summary>
/// One recent-drive outside-temperature point — the native mirror of the fields of the web
/// <c>ChartDataPoint</c> shape this chart consumes
/// (<c>web/src/features/driving/components/drivetrain-health/constants.ts</c>: <c>date</c> + <c>outsideTemp</c>;
/// the sibling <c>powerMax</c> / <c>powerMin</c> / <c>distance</c> fields are unused by this chart). <see cref="Date"/>
/// is the already-formatted X-axis label the web parent produces with <c>formatDateShort(d.startTs)</c>;
/// <see cref="OutsideTempC"/> is the <b>SI Celsius</b> average-outside-temperature reading the web parent feeds
/// the chart (<c>d.outsideTempAvgC</c>), nullable to model a drive that did not record it. Unlike the web prop —
/// which the page passes through to the chart as raw Celsius while only its threshold markers are converted —
/// this native model stays SI-canonical and defers the unit conversion to the projection, the single display
/// boundary (the web <c>useUnits</c> contract), so the plotted line and the markers share one consistent unit.
/// Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Date">Pre-formatted drive-date label (web <c>ChartDataPoint.date</c>).</param>
/// <param name="OutsideTempC">Average outside temperature in SI Celsius, or null (web <c>outsideTemp</c>).</param>
public sealed record TemperatureTrendSample(string Date, double? OutsideTempC);

/// <summary>
/// The render-time data model the <c>TemperatureTrendChart</c> view binds to — the native analogue of the web
/// <c>TemperatureTrendChartProps</c> (<c>data: ChartDataPoint[]</c>), plus the fetch flag the parent supplies
/// so the surface can render its own loading branch (the web parent gates the whole chart behind its query
/// state). The component is presentational: this model carries only the outside-temperature points and the
/// loading flag. User-facing labels and the unit conversion are resolved by the projection from the i18n facade
/// and the <see cref="UnitPref"/>, not passed in. Pure data — no WinUI types.
/// </summary>
/// <param name="Loading">Whether the parent's first recent-drive history fetch is still in flight.</param>
/// <param name="Samples">The SI outside-temperature points, oldest-first (web <c>data</c>).</param>
public sealed record TemperatureTrendChartModel(bool Loading, IReadOnlyList<TemperatureTrendSample> Samples)
{
    /// <summary>The initial model: the first fetch is in flight and no points have arrived yet.</summary>
    public static TemperatureTrendChartModel Pending { get; } =
        new(true, Array.Empty<TemperatureTrendSample>());

    /// <summary>A resolved model with no points — the empty state.</summary>
    public static TemperatureTrendChartModel Empty { get; } =
        new(false, Array.Empty<TemperatureTrendSample>());
}

/// <summary>
/// The two localized column headers of the chart's accessible data table — the native analogue of the web
/// <c>ChartContainer</c> <c>dataColumns</c>. <see cref="Date"/> is the bare drive-date label; <see cref="Outside"/>
/// carries the active unit suffix (<c>"Outside (°C)"</c>, <c>"Outside (°F)"</c>) exactly as the web builds
/// <c>`${t('drivetrain.col.outside')} (${tempUnit})`</c>. Pure data.
/// </summary>
public sealed record TemperatureTrendTableColumns(string Date, string Outside);

/// <summary>
/// One projected, render-ready row of the accessible data table — the native analogue of one entry in the web
/// <c>ChartContainer</c> <c>data</c> array. <see cref="Date"/> is the drive-date label; <see cref="Outside"/> is
/// the display-unit value formatted as a bare number (the unit lives in the column header, mirroring the web),
/// or an em dash when the drive did not record it. <see cref="AutomationName"/> is the spoken summary of the
/// whole row (the date plus the labelled, unit-suffixed reading). Pure data.
/// </summary>
public sealed record TemperatureTrendTableRow(string Date, string Outside, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the chart for one input model — the native analogue of what the
/// web <c>TemperatureTrendChart</c> renders inside its <c>ChartContainer</c>. Holds the resolved chrome strings
/// (the title / subtitle / aria the three header <c>t(...)</c> calls produce), the empty + loading copy, the
/// active temperature unit label, the single render-ready outside-temperature <see cref="Series"/> (already
/// converted to the display unit, nulls dropped), the two threshold <see cref="ReferenceLines"/> (the converted
/// 35&#176;C "Warm Zone" / 0&#176;C "Freezing" markers), the accessible-table <see cref="Columns"/> +
/// <see cref="Rows"/>, the active <see cref="State"/>, and the surface <see cref="AutomationName"/>. Built from
/// the pure <see cref="ChartSeries"/> / <see cref="ChartAnnotation"/> primitives so every branch is asserted
/// headlessly.
/// </summary>
public sealed record TemperatureTrendChartDisplay(
    TemperatureTrendChartState State,
    string Title,
    string Subtitle,
    string AriaLabel,
    string EmptyMessage,
    string LoadingLabel,
    string TemperatureUnitLabel,
    ChartSeries Series,
    IReadOnlyList<ChartAnnotation> ReferenceLines,
    TemperatureTrendTableColumns Columns,
    IReadOnlyList<TemperatureTrendTableRow> Rows,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="TemperatureTrendChartModel"/> to its <see cref="TemperatureTrendChartDisplay"/>
/// — the native port of web/src/features/driving/components/drivetrain-health/TemperatureTrendChart.tsx. The web
/// source is a titled single-line chart of the outside temperature recorded per recent drive with two dashed
/// threshold markers; this projection reproduces its eight <c>t(...)</c> labels, converts every SI Celsius
/// reading to the user's display unit at this single boundary (the web <c>useUnits</c> + <c>convertTempFromSI</c>
/// contract), drops points a drive did not record (the recharts gap-on-null behaviour), and converts the
/// 35&#176;C / 0&#176;C threshold lines to the same display unit (the web <c>toTemperatureDisplay(35|0)</c>). The
/// state follows the web's only render gate — the parent first filters out the null-temperature points and then
/// <c>data.length &lt;= 1</c> renders nothing, so fewer than two plottable points collapses to a friendly empty
/// state and two or more promotes the surface to the charted Ready state. The web hex colours map onto the
/// shared semantic chart tokens — the outside line <c>#06b6d4</c> and the "Freezing" marker <c>#06b6d4</c> are
/// the regen/cyan token and the "Warm Zone" marker <c>#f59e0b</c> is the energy/amber token — so the chart stays
/// theme-aware instead of hard-coding hex. The web line legend label intentionally carries no unit suffix
/// (<c>t('drivetrain.outsideTemp', 'Outside Temp')</c>), preserved here verbatim; the unit lives on the series
/// <see cref="ChartSeries.Unit"/> (tooltips) and the column header. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class TemperatureTrendChartProjection
{
    /// <summary>The "Warm Zone" threshold marker position in SI Celsius (web <c>ReferenceLine y={toTemperatureDisplay(35)}</c>).</summary>
    public const double WarmZoneThresholdCelsius = 35.0;

    /// <summary>The "Freezing" threshold marker position in SI Celsius (web <c>ReferenceLine y={toTemperatureDisplay(0)}</c>).</summary>
    public const double FreezingThresholdCelsius = 0.0;

    /// <summary>The minimum plottable-point count that renders a chart (web renders nothing for <c>data.length &lt;= 1</c>).</summary>
    public const int MinimumSampleCount = 2;

    /// <summary>Semantic role tinting the outside-temperature line (web <c>stroke="#06b6d4"</c> = regen/cyan token).</summary>
    public const ChartRole OutsideRole = ChartRole.Regen;

    /// <summary>Semantic role tinting the "Warm Zone" threshold marker (web <c>stroke="#f59e0b"</c> = energy/amber token).</summary>
    public const ChartRole WarmZoneThresholdRole = ChartRole.Energy;

    /// <summary>Semantic role tinting the "Freezing" threshold marker (web <c>stroke="#06b6d4"</c> = regen/cyan token).</summary>
    public const ChartRole FreezingThresholdRole = ChartRole.Regen;

    private const int TemperatureDecimals = 1;
    private const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade and unit preference.</summary>
    /// <param name="model">The render-time data model (the web <c>data</c> prop + the parent's fetch flag).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's display unit preference (the web <c>useUnits</c> result).</param>
    public static TemperatureTrendChartDisplay Project(
        TemperatureTrendChartModel model,
        ILocalizer localizer,
        UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(units);

        IReadOnlyList<TemperatureTrendSample> samples = model.Samples ?? Array.Empty<TemperatureTrendSample>();
        string unitLabel = UnitLabels.Label(units.Temperature);

        string title = localizer.GetString("drivetrain.tempHistory", "Temperature Trend");
        string subtitle = localizer.GetString(
            "drivetrain.tempHistorySub",
            "Outside temperature recorded during recent drives");
        string ariaLabel = localizer.GetString(
            "drivetrain.tempHistory.aria",
            "Outside temperature trend line chart per recent drive");
        string emptyMessage = localizer.GetString("chart.noData", "No data available");
        string loadingLabel = localizer.GetString("common.loading", "Loading");

        string colDate = localizer.GetString("drivetrain.col.date", "Date");
        string colOutside = localizer.GetString("drivetrain.col.outside", "Outside");

        // Web parity: the line legend label is the bare `t('drivetrain.outsideTemp')` with NO unit suffix
        // (unlike the sibling StatorTempChart lines); the unit travels on the series Unit + the column header.
        string seriesName = localizer.GetString("drivetrain.outsideTemp", "Outside Temp");

        ChartSeries series = BuildSeries(samples, seriesName, units.Temperature, unitLabel);

        var referenceLines = new[]
        {
            new ChartAnnotation(
                "warmZone",
                ChartAnnotationKind.HorizontalLine,
                UnitConverters.TemperatureFromSi(WarmZoneThresholdCelsius, units.Temperature))
            {
                Label = localizer.GetString("drivetrain.warmZone", "Warm Zone"),
                Role = WarmZoneThresholdRole,
            },
            new ChartAnnotation(
                "freezing",
                ChartAnnotationKind.HorizontalLine,
                UnitConverters.TemperatureFromSi(FreezingThresholdCelsius, units.Temperature))
            {
                Label = localizer.GetString("drivetrain.freezing", "Freezing"),
                Role = FreezingThresholdRole,
            },
        };

        var columns = new TemperatureTrendTableColumns(colDate, $"{colOutside} ({unitLabel})");
        IReadOnlyList<TemperatureTrendTableRow> rows = BuildRows(samples, units, unitLabel, colOutside);

        TemperatureTrendChartState state = SelectState(model.Loading, CountPlottable(samples));

        return new TemperatureTrendChartDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            AriaLabel: ariaLabel,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            TemperatureUnitLabel: unitLabel,
            Series: series,
            ReferenceLines: referenceLines,
            Columns: columns,
            Rows: rows,
            AutomationName: BuildAutomationName(state, title, ariaLabel, emptyMessage, loadingLabel));
    }

    /// <summary>Branch precedence from the web source's data lifecycle: loading → empty (web <c>&lt;= 1</c>) → ready.</summary>
    private static TemperatureTrendChartState SelectState(bool loading, int plottableCount)
    {
        if (loading)
        {
            return TemperatureTrendChartState.Loading;
        }

        // Web parity: the parent filters out null-temperature points, then `if (data.length <= 1) return null;` —
        // a single point (or none) cannot draw a trend, so the surface collapses to the friendly empty state;
        // two or more plottable points promote it to the chart.
        return plottableCount < MinimumSampleCount
            ? TemperatureTrendChartState.Empty
            : TemperatureTrendChartState.Ready;
    }

    // The count of points with a finite outside temperature — the native analogue of the web parent's
    // `chartData.filter((d) => d.outsideTemp !== null)` that feeds the chart's `data.length` gate.
    private static int CountPlottable(IReadOnlyList<TemperatureTrendSample> samples)
    {
        int count = 0;
        for (int i = 0; i < samples.Count; i++)
        {
            if (samples[i] is { } sample && IsFinite(sample.OutsideTempC, out _))
            {
                count++;
            }
        }

        return count;
    }

    private static ChartSeries BuildSeries(
        IReadOnlyList<TemperatureTrendSample> samples,
        string name,
        TemperatureUnit unit,
        string unitLabel)
    {
        var points = new List<ChartPoint>(samples.Count);
        for (int i = 0; i < samples.Count; i++)
        {
            TemperatureTrendSample sample = samples[i];
            if (sample is not null && IsFinite(sample.OutsideTempC, out double celsius))
            {
                double display = UnitConverters.TemperatureFromSi(celsius, unit);
                points.Add(new ChartPoint(i, display, sample.Date));
            }
        }

        return new ChartSeries(name, points)
        {
            Kind = ChartSeriesKind.Line,
            Role = OutsideRole,
            Unit = unitLabel,
            Decimals = TemperatureDecimals,
        };
    }

    private static IReadOnlyList<TemperatureTrendTableRow> BuildRows(
        IReadOnlyList<TemperatureTrendSample> samples,
        UnitPref units,
        string unitLabel,
        string colOutside)
    {
        if (samples.Count == 0)
        {
            return Array.Empty<TemperatureTrendTableRow>();
        }

        var rows = new List<TemperatureTrendTableRow>(samples.Count);
        foreach (TemperatureTrendSample sample in samples)
        {
            if (sample is null)
            {
                continue;
            }

            string date = string.IsNullOrWhiteSpace(sample.Date) ? EmDash : sample.Date;
            string outside = FormatCell(sample.OutsideTempC, units);
            string spoken = $"{date}: {colOutside} {Spoken(outside, unitLabel)}";

            rows.Add(new TemperatureTrendTableRow(date, outside, spoken));
        }

        return rows;
    }

    // Bare display-unit number for the data table; the unit lives in the column header (web dataColumns).
    private static string FormatCell(double? celsius, UnitPref units)
    {
        if (IsFinite(celsius, out double value))
        {
            double display = UnitConverters.TemperatureFromSi(value, units.Temperature);
            return ScalarFormatters.FormatNumber(display, TemperatureDecimals);
        }

        return EmDash;
    }

    // Spoken form of a cell — the unit-suffixed value, or a bare em dash when the drive did not record it.
    private static string Spoken(string cell, string unitLabel) =>
        string.Equals(cell, EmDash, StringComparison.Ordinal) ? EmDash : $"{cell}{unitLabel}";

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
        TemperatureTrendChartState state,
        string title,
        string ariaLabel,
        string emptyMessage,
        string loadingLabel) => state switch
        {
            TemperatureTrendChartState.Loading => $"{title}. {loadingLabel}",
            TemperatureTrendChartState.Empty => $"{title}. {emptyMessage}",
            _ => ariaLabel,
        };
}

/// <summary>
/// Canonical metadata for the <c>TemperatureTrendChart</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/driving/components/drivetrain-health/TemperatureTrendChart.tsx</c>.
/// </summary>
public static class TemperatureTrendChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TemperatureTrendChart";
}

/// <summary>
/// PII-safe diagnostics for the <c>TemperatureTrendChart</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a temperature reading, drive date or
/// vehicle id — so a diagnostics line can never leak a vehicle's whereabouts or thermal behaviour. Thread-safe.
/// </summary>
public sealed class TemperatureTrendChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Optional sink invoked with each emitted, PII-safe diagnostics line.</param>
    public TemperatureTrendChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TemperatureTrendChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TemperatureTrendChartRegistration.Slug}");
    }
}
