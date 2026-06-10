using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>StatorTempChart</c> surface — the native union of the
/// states the web component renders
/// (web/src/features/driving/components/drivetrain-health/StatorTempChart.tsx). The web source is a pure
/// presentational component: it takes a single <c>data: MotorChartDataPoint[]</c> prop, performs no fetching,
/// and renders nothing (<c>return null</c>) until it has more than one sample. The branches are therefore a
/// direct function of the input <see cref="StatorTempChartModel"/> — there is no fetch-driven error / stale /
/// offline branch to reproduce here. The parent Drivetrain-Health experience owns the query lifecycle
/// (loading / error / stale / offline are handled once for the whole page before any chart is shown), exactly
/// as the web page only renders this chart once the motor history has resolved. Every branch maps onto a
/// visible surface; none is ever hidden behind a blank panel.
/// </summary>
public enum StatorTempChartState
{
    /// <summary>Initial fetch in flight (the parent is still loading the motor history) — title + skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with one or zero snapshots (the web <c>data.length &lt;= 1</c> gate) — a friendly empty state.</summary>
    Empty,

    /// <summary>At least two snapshots are available (web fall-through) — the stator temperature line chart.</summary>
    Ready,
}

/// <summary>
/// One motor-thermal snapshot — the native mirror of the temperature fields of the web
/// <c>MotorChartDataPoint</c> shape
/// (<c>web/src/features/driving/components/drivetrain-health/constants.ts</c>). <see cref="Time"/> is the
/// already-formatted X-axis label the web parent produces with <c>formatTime(s.ts)</c>; the three
/// temperatures are the <b>SI Celsius</b> sensor readings the web parent feeds the chart — front-motor stator
/// (<c>motor_temp_c_front</c> → web <c>stator</c>), rear-motor stator (<c>motor_temp_c_rear</c> → web
/// <c>statorRel</c>) and inverter (<c>inverter_temp_c</c> → web <c>statorRer</c>). Each is nullable to model
/// a sensor that did not report. Unlike the web prop — which the page pre-converts to the user's display unit
/// before passing in — this native model stays SI-canonical and defers the unit conversion to the projection,
/// the single display boundary (the web <c>useUnits</c> contract). Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="Time">Pre-formatted snapshot timestamp label (web <c>MotorChartDataPoint.time</c>).</param>
/// <param name="StatorC">Front-motor stator temperature in SI Celsius, or null (web <c>stator</c>).</param>
/// <param name="StatorRelC">Rear-motor stator temperature in SI Celsius, or null (web <c>statorRel</c>).</param>
/// <param name="StatorRerC">Inverter temperature in SI Celsius, or null (web <c>statorRer</c>).</param>
public sealed record StatorTempSample(string Time, double? StatorC, double? StatorRelC, double? StatorRerC);

/// <summary>
/// The render-time data model the <c>StatorTempChart</c> view binds to — the native analogue of the web
/// <c>StatorTempChartProps</c> (<c>data: MotorChartDataPoint[]</c>), plus the fetch flag the parent supplies
/// so the surface can render its own loading branch (the web parent gates the whole chart behind its query
/// state). The component is presentational: this model carries only the snapshot series and the loading flag.
/// User-facing labels and the unit conversion are resolved by the projection from the i18n facade and the
/// <see cref="UnitPref"/>, not passed in. Pure data — no WinUI types.
/// </summary>
/// <param name="Loading">Whether the parent's first motor-history fetch is still in flight.</param>
/// <param name="Samples">The SI motor-thermal snapshots, oldest-first (web <c>data</c>).</param>
public sealed record StatorTempChartModel(bool Loading, IReadOnlyList<StatorTempSample> Samples)
{
    /// <summary>The initial model: the first fetch is in flight and no snapshots have arrived yet.</summary>
    public static StatorTempChartModel Pending { get; } =
        new(true, Array.Empty<StatorTempSample>());

    /// <summary>A resolved model with no snapshots — the empty state.</summary>
    public static StatorTempChartModel Empty { get; } =
        new(false, Array.Empty<StatorTempSample>());
}

/// <summary>
/// The four localized column headers of the chart's accessible data table — the native analogue of the web
/// <c>ChartContainer</c> <c>dataColumns</c>. <see cref="Time"/> is the bare time-axis label; the three
/// temperature headers each carry the active unit suffix (<c>"Stator (°C)"</c>, <c>"Rear-Left (°F)"</c>, …)
/// exactly as the web builds <c>`${t('drivetrain.col.stator')} (${tempUnit})`</c>. Pure data.
/// </summary>
public sealed record StatorTempTableColumns(string Time, string Stator, string StatorRel, string StatorRer);

/// <summary>
/// One projected, render-ready row of the accessible data table — the native analogue of one entry in the
/// web <c>ChartContainer</c> <c>data</c> array. <see cref="Time"/> is the snapshot label; the three
/// temperature cells are the display-unit values formatted as bare numbers (the unit lives in the column
/// header, mirroring the web), or an em dash when the sensor did not report. <see cref="AutomationName"/> is
/// the spoken summary of the whole row (the timestamp plus each labelled, unit-suffixed reading). Pure data.
/// </summary>
public sealed record StatorTempTableRow(
    string Time,
    string Stator,
    string StatorRel,
    string StatorRer,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the chart for one input model — the native analogue of what the
/// web <c>StatorTempChart</c> renders inside its <c>ChartContainer</c>. Holds the resolved chrome strings (the
/// title / subtitle / aria the three header <c>t(...)</c> calls produce), the empty + loading copy, the active
/// temperature unit label, the three render-ready <see cref="Series"/> (already converted to the display unit,
/// nulls dropped, coloured by semantic role), the two threshold <see cref="ReferenceLines"/> (the converted
/// 60&#176;C "Normal" / 80&#176;C "Warm" markers), the accessible-table <see cref="Columns"/> + <see cref="Rows"/>,
/// the active <see cref="State"/>, and the surface <see cref="AutomationName"/>. Built from the pure
/// <see cref="ChartSeries"/> / <see cref="ChartAnnotation"/> primitives so every branch is asserted headlessly.
/// </summary>
public sealed record StatorTempChartDisplay(
    StatorTempChartState State,
    string Title,
    string Subtitle,
    string AriaLabel,
    string EmptyMessage,
    string LoadingLabel,
    string TemperatureUnitLabel,
    IReadOnlyList<ChartSeries> Series,
    IReadOnlyList<ChartAnnotation> ReferenceLines,
    StatorTempTableColumns Columns,
    IReadOnlyList<StatorTempTableRow> Rows,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="StatorTempChartModel"/> to its <see cref="StatorTempChartDisplay"/> — the
/// native port of web/src/features/driving/components/drivetrain-health/StatorTempChart.tsx. The web source is
/// a titled three-line chart of the front / rear / inverter motor stator temperatures with two dashed
/// threshold markers; this projection reproduces its twelve <c>t(...)</c> labels, converts every SI Celsius
/// reading to the user's display unit at this single boundary (the web <c>useUnits</c> + <c>convertTempFromSI</c>
/// contract), drops snapshots a sensor did not report (the recharts gap-on-null behaviour), and converts the
/// 60&#176;C / 80&#176;C threshold lines to the same display unit (the web <c>toTemperatureDisplay(60|80)</c>).
/// The state follows the web's only render gate — <c>data.length &lt;= 1</c> renders nothing, so fewer than
/// two snapshots collapses to a friendly empty state and two or more promotes the surface to the charted Ready
/// state. The web hex line colours map exactly onto the shared semantic chart tokens — stator <c>#ef4444</c>
/// is the temperature token, <c>statorRel #a855f7</c> the power token, <c>statorRer #06b6d4</c> the regen
/// token, the green "Normal" marker the battery token and the amber "Warm" marker the energy token — so the
/// chart stays theme-aware instead of hard-coding hex. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class StatorTempChartProjection
{
    /// <summary>The "Normal" threshold marker position in SI Celsius (web <c>ReferenceLine y={toTemperatureDisplay(60)}</c>).</summary>
    public const double NormalThresholdCelsius = 60.0;

    /// <summary>The "Warm" threshold marker position in SI Celsius (web <c>ReferenceLine y={toTemperatureDisplay(80)}</c>).</summary>
    public const double WarmThresholdCelsius = 80.0;

    /// <summary>The minimum snapshot count that renders a chart (web renders nothing for <c>data.length &lt;= 1</c>).</summary>
    public const int MinimumSampleCount = 2;

    /// <summary>Semantic role tinting the front-motor stator line (web <c>stroke="#ef4444"</c> = temperature token).</summary>
    public const ChartRole StatorRole = ChartRole.Temperature;

    /// <summary>Semantic role tinting the rear-motor stator line (web <c>stroke="#a855f7"</c> = power token).</summary>
    public const ChartRole StatorRelRole = ChartRole.Power;

    /// <summary>Semantic role tinting the inverter line (web <c>stroke="#06b6d4"</c> = regen token).</summary>
    public const ChartRole StatorRerRole = ChartRole.Regen;

    /// <summary>Semantic role tinting the "Normal" threshold marker (web <c>stroke="#4ade80"</c> = battery/green token).</summary>
    public const ChartRole NormalThresholdRole = ChartRole.Battery;

    /// <summary>Semantic role tinting the "Warm" threshold marker (web <c>stroke="#fbbf24"</c> = energy/amber token).</summary>
    public const ChartRole WarmThresholdRole = ChartRole.Energy;

    private const int TemperatureDecimals = 1;
    private const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade and unit preference.</summary>
    /// <param name="model">The render-time data model (the web <c>data</c> prop + the parent's fetch flag).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's display unit preference (the web <c>useUnits</c> result).</param>
    public static StatorTempChartDisplay Project(StatorTempChartModel model, ILocalizer localizer, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(units);

        IReadOnlyList<StatorTempSample> samples = model.Samples ?? Array.Empty<StatorTempSample>();
        string unitLabel = UnitLabels.Label(units.Temperature);

        string title = localizer.GetString("drivetrain.statorTempHistory", "Stator Temperature History");
        string subtitle = localizer.GetString(
            "drivetrain.statorTempSub",
            "Motor stator temperature over recent snapshots");
        string ariaLabel = localizer.GetString(
            "drivetrain.statorTempHistory.aria",
            "Front, rear-left and rear-right motor stator temperature history line chart");
        string emptyMessage = localizer.GetString("chart.noData", "No data available");
        string loadingLabel = localizer.GetString("common.loading", "Loading");

        string colTime = localizer.GetString("drivetrain.col.time", "Time");
        string colStator = localizer.GetString("drivetrain.col.stator", "Stator");
        string colStatorRel = localizer.GetString("drivetrain.col.statorRel", "Rear-Left");
        string colStatorRer = localizer.GetString("drivetrain.col.statorRer", "Rear-Right");

        string statorName = $"{localizer.GetString("drivetrain.statorTemp", "Stator Temp")} ({unitLabel})";
        string statorRelName =
            $"{localizer.GetString("drivetrain.statorTempRearLeft", "Rear-Left Stator Temp")} ({unitLabel})";
        string statorRerName =
            $"{localizer.GetString("drivetrain.statorTempRearRight", "Rear-Right Stator Temp")} ({unitLabel})";

        var series = new[]
        {
            BuildSeries(samples, static s => s.StatorC, statorName, StatorRole, units.Temperature, unitLabel),
            BuildSeries(samples, static s => s.StatorRelC, statorRelName, StatorRelRole, units.Temperature, unitLabel),
            BuildSeries(samples, static s => s.StatorRerC, statorRerName, StatorRerRole, units.Temperature, unitLabel),
        };

        var referenceLines = new[]
        {
            new ChartAnnotation(
                "normal",
                ChartAnnotationKind.HorizontalLine,
                UnitConverters.TemperatureFromSi(NormalThresholdCelsius, units.Temperature))
            {
                Label = localizer.GetString("drivetrain.normal", "Normal"),
                Role = NormalThresholdRole,
            },
            new ChartAnnotation(
                "warm",
                ChartAnnotationKind.HorizontalLine,
                UnitConverters.TemperatureFromSi(WarmThresholdCelsius, units.Temperature))
            {
                Label = localizer.GetString("drivetrain.warm", "Warm"),
                Role = WarmThresholdRole,
            },
        };

        var columns = new StatorTempTableColumns(
            colTime,
            $"{colStator} ({unitLabel})",
            $"{colStatorRel} ({unitLabel})",
            $"{colStatorRer} ({unitLabel})");

        IReadOnlyList<StatorTempTableRow> rows = BuildRows(
            samples, units, unitLabel, colStator, colStatorRel, colStatorRer);

        StatorTempChartState state = SelectState(model.Loading, samples.Count);

        return new StatorTempChartDisplay(
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
    private static StatorTempChartState SelectState(bool loading, int sampleCount)
    {
        if (loading)
        {
            return StatorTempChartState.Loading;
        }

        // Web parity: `if (data.length <= 1) return null;` — a single point (or none) cannot draw a trend, so
        // the surface collapses to the friendly empty state; two or more snapshots promote it to the chart.
        return sampleCount < MinimumSampleCount ? StatorTempChartState.Empty : StatorTempChartState.Ready;
    }

    private static ChartSeries BuildSeries(
        IReadOnlyList<StatorTempSample> samples,
        Func<StatorTempSample, double?> selector,
        string name,
        ChartRole role,
        TemperatureUnit unit,
        string unitLabel)
    {
        var points = new List<ChartPoint>(samples.Count);
        for (int i = 0; i < samples.Count; i++)
        {
            StatorTempSample sample = samples[i];
            if (sample is not null && IsFinite(selector(sample), out double celsius))
            {
                double display = UnitConverters.TemperatureFromSi(celsius, unit);
                points.Add(new ChartPoint(i, display, sample.Time));
            }
        }

        // The web always renders all three <Line>s (recharts simply leaves a gap where a value is null), so an
        // entirely-absent sensor still keeps its legend entry — the series is created even with no points.
        return new ChartSeries(name, points)
        {
            Kind = ChartSeriesKind.Line,
            Role = role,
            Unit = unitLabel,
            Decimals = TemperatureDecimals,
        };
    }

    private static IReadOnlyList<StatorTempTableRow> BuildRows(
        IReadOnlyList<StatorTempSample> samples,
        UnitPref units,
        string unitLabel,
        string colStator,
        string colStatorRel,
        string colStatorRer)
    {
        if (samples.Count == 0)
        {
            return Array.Empty<StatorTempTableRow>();
        }

        var rows = new List<StatorTempTableRow>(samples.Count);
        foreach (StatorTempSample sample in samples)
        {
            if (sample is null)
            {
                continue;
            }

            string time = string.IsNullOrWhiteSpace(sample.Time) ? EmDash : sample.Time;
            string stator = FormatCell(sample.StatorC, units);
            string statorRel = FormatCell(sample.StatorRelC, units);
            string statorRer = FormatCell(sample.StatorRerC, units);

            string spoken =
                $"{time}: {colStator} {Spoken(stator, unitLabel)}, " +
                $"{colStatorRel} {Spoken(statorRel, unitLabel)}, " +
                $"{colStatorRer} {Spoken(statorRer, unitLabel)}";

            rows.Add(new StatorTempTableRow(time, stator, statorRel, statorRer, spoken));
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

    // Spoken form of a cell — the unit-suffixed value, or a bare em dash when the sensor did not report.
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
        StatorTempChartState state,
        string title,
        string ariaLabel,
        string emptyMessage,
        string loadingLabel) => state switch
        {
            StatorTempChartState.Loading => $"{title}. {loadingLabel}",
            StatorTempChartState.Empty => $"{title}. {emptyMessage}",
            _ => ariaLabel,
        };
}

/// <summary>
/// Canonical metadata for the <c>StatorTempChart</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/driving/components/drivetrain-health/StatorTempChart.tsx</c>.
/// </summary>
public static class StatorTempChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "StatorTempChart";
}

/// <summary>
/// PII-safe diagnostics for the <c>StatorTempChart</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a temperature reading, timestamp or
/// vehicle id — so a diagnostics line can never leak a vehicle's thermal behaviour. Thread-safe.
/// </summary>
public sealed class StatorTempChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Optional sink invoked with each emitted, PII-safe diagnostics line.</param>
    public StatorTempChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=StatorTempChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={StatorTempChartRegistration.Slug}");
    }
}
