using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>ChargerTypeChart</c> surface — the native union of the states
/// the web component renders
/// (web/src/features/charging/components/charging-curve/ChargerTypeChart.tsx). The web source is a pure
/// presentational component: it takes <c>sessions: ChargingSession[]</c> as its only prop, groups them by
/// charger category and renders the composed bar chart through the shared <c>ChartContainer</c>. It performs no
/// fetching, so the branches are a direct function of the input <see cref="ChargerTypeChartModel"/> — there is
/// deliberately NO fetch-driven error / stale / offline branch to reproduce here. The parent
/// <c>ChargingCurvePage</c> owns the whole query lifecycle (it renders a single page-level loading skeleton
/// while the sessions query is in flight, and the error / stale / offline chrome is handled once for the page
/// before this component is mounted), exactly as the web source only ever receives already-resolved sessions.
/// Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum ChargerTypeChartState
{
    /// <summary>The parent is still resolving the sessions — title + skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no sessions (web <c>sessions.length === 0</c>) — the friendly empty surface.</summary>
    Empty,

    /// <summary>At least one charger-type group to chart (web <c>sessions.length &gt; 0</c>) — the bars.</summary>
    Ready,
}

/// <summary>
/// One charging session the surface groups by charger category — the native mirror of the web
/// <c>ChargingSession</c> fields the component actually reads
/// (<c>charger_type</c>, <c>peak_power_w</c>, <c>total_energy_added_wh</c>, <c>started_at</c>, <c>ended_at</c>).
/// All energy / power figures are SI (watts, watt-hours) exactly as the API stores them; the projection divides
/// by 1000 at the display boundary the same way the web source does (<c>peak_power_w / 1000</c>,
/// <c>total_energy_added_wh / 1000</c>). <see cref="EndedAt"/> is nullable because an in-progress session has no
/// end yet (web <c>ended_at: string | null</c>). Pure data — no WinUI types — so the projection is unit-tested
/// without a UI host.
/// </summary>
public sealed record ChargerTypeChartSession(
    string? ChargerType,
    double? PeakPowerW,
    double TotalEnergyAddedWh,
    DateTimeOffset StartedAt,
    DateTimeOffset? EndedAt);

/// <summary>
/// The render-time data model the <c>ChargerTypeChart</c> view binds to — the native analogue of the web
/// component's single <c>sessions</c> prop plus the fetch flag the parent supplies. The component is
/// presentational; user-facing labels are resolved from the i18n facade by the projection, not passed in. The
/// charger-category grouping (web <c>getChargerLabel</c>) and the per-group averages (web <c>avg</c> over
/// <c>peak_power_w</c> / <c>total_energy_added_wh</c> / <c>durationMinutes</c>) are computed by the projection,
/// not here, so the raw sessions stay verbatim. Pure data — no WinUI types.
/// </summary>
public sealed record ChargerTypeChartModel(bool Loading, IReadOnlyList<ChargerTypeChartSession> Sessions)
{
    /// <summary>The initial model: the parent is still resolving the sessions and none have arrived yet.</summary>
    public static ChargerTypeChartModel Pending { get; } =
        new(true, Array.Empty<ChargerTypeChartSession>());

    /// <summary>A resolved model with no sessions — the empty surface.</summary>
    public static ChargerTypeChartModel Empty { get; } =
        new(false, Array.Empty<ChargerTypeChartSession>());
}

/// <summary>
/// One projected, render-ready charger-category row — the native union of a single web charger-type group
/// (web <c>chargerTypeStats.map(...)</c>): the two recharts <c>&lt;Bar&gt;</c> data points (average power +
/// average energy) and the per-type legend row below the chart. <see cref="Label"/> is the charger category
/// (web <c>getChargerLabel</c>: "Supercharger" / "DC Fast" / "Home / AC"); <see cref="Count"/>,
/// <see cref="AvgKw"/>, <see cref="AvgKwh"/> and <see cref="AvgDuration"/> are the raw group aggregates;
/// <see cref="ColorIndex"/> is the zero-based palette position the legend dot is tinted with (the native
/// analogue of the web <c>CHARGER_COLORS[label]</c> per-category colour, mapped to the shared brand palette by
/// row position — the same parity choice the <c>ChargerTypeBreakdown</c> port made); the <c>*Text</c> fields
/// are the web-formatted strings (<c>fmtNumber(x, 1)</c> / <c>fmtInt</c>); <see cref="CountCellText"/> is the
/// raw <c>String(count)</c> the accessible table renders; <see cref="LegendCaption"/> is the
/// "<c>{count} sessions · {avgDuration} min avg</c>" caption; and <see cref="AutomationName"/> is the spoken
/// row. Pure data.
/// </summary>
public sealed record ChargerTypeChartSlice(
    string Label,
    long Count,
    double AvgKw,
    double AvgKwh,
    double AvgDuration,
    int ColorIndex,
    string AvgKwText,
    string AvgKwhText,
    string AvgMinutesText,
    string CountText,
    string CountCellText,
    string LegendCaption,
    string AutomationName);

/// <summary>
/// A declarative accessible-table column descriptor (key + localized header) — the native, WinUI-free analogue
/// of one web <c>dataColumns</c> entry the chart feeds into <c>ChartContainer</c>'s tabular fallback. The view
/// maps each one onto a <c>TsDataColumn</c>; rows address their cells by the same <see cref="Key"/>.
/// </summary>
public sealed record ChargerTypeChartColumn(string Key, string Header);

/// <summary>
/// A single projected, display-ready accessible-table row — the cell values keyed by column key, a stable
/// <see cref="RowKey"/>, and a Narrator automation name. Mirrors one row of the web <c>data</c> array the
/// <c>ChartContainer</c> renders as <c>String(value)</c> (the pre-formatted average strings verbatim and the
/// raw session count). Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ChargerTypeChartRow(
    string RowKey,
    IReadOnlyDictionary<string, string> Cells,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the surface for one input model — the native analogue of what the
/// web <c>ChargerTypeChart</c> renders through <c>ChartContainer</c>. Holds the active <see cref="State"/>, the
/// resolved <see cref="Title"/> / <see cref="Subtitle"/> / <see cref="AriaLabel"/>, the empty + loading + table
/// captions, the two bar <see cref="Series"/> (average power + average energy), the per-type
/// <see cref="Slices"/> the legend list renders, the accessible-table <see cref="Columns"/> + <see cref="Rows"/>,
/// a spoken <see cref="ChartSummary"/> of the bars, and the surface <see cref="AutomationName"/>. Pure data so
/// every branch is asserted headlessly.
/// </summary>
public sealed record ChargerTypeChartDisplay(
    ChargerTypeChartState State,
    string Title,
    string Subtitle,
    string AriaLabel,
    string EmptyMessage,
    string LoadingLabel,
    string TableLabel,
    IReadOnlyList<ChartSeries> Series,
    IReadOnlyList<ChargerTypeChartSlice> Slices,
    IReadOnlyList<ChargerTypeChartColumn> Columns,
    IReadOnlyList<ChargerTypeChartRow> Rows,
    string ChartSummary,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="ChargerTypeChartModel"/> to its <see cref="ChargerTypeChartDisplay"/> — the
/// native port of web/src/features/charging/components/charging-curve/ChargerTypeChart.tsx. The branch
/// precedence mirrors the web source (loading → empty → ready, where emptiness is the session <em>count</em>).
/// The charger-category grouping reproduces the web <c>getChargerLabel</c> rules verbatim (Tesla →
/// "Supercharger"; any other non-empty <c>charger_type</c> → "DC Fast"; otherwise a peak above 20 kW → "DC
/// Fast"; else "Home / AC"), the groups keep first-seen order (web <c>Map</c> insertion order), and each
/// group's averages reuse the web <c>avg</c> over <c>peak_power_w / 1000</c>, <c>total_energy_added_wh / 1000</c>
/// and <c>durationMinutes</c>. Averages render through the web helpers (<c>fmtNumber(x, 1)</c> for the kW / kWh
/// figures, <c>fmtInt</c> for the table's average-minutes column, and <c>fmtNumber</c> at the user's decimal
/// precision for the legend's "min avg"), every numeric helper reusing <see cref="NumberFormatting"/> so
/// grouping / rounding match the web's <c>Intl.NumberFormat</c> exactly. Every label resolves through the i18n
/// facade using the same keys the web source feeds into <c>t(...)</c>. No WinUI types — unit-tested without a
/// UI host.
/// </summary>
public static class ChargerTypeChartProjection
{
    /// <summary>Charger category for a Tesla / Supercharger session (web <c>getChargerLabel</c>).</summary>
    public const string LabelSupercharger = "Supercharger";

    /// <summary>Charger category for any other identified DC fast charger (web <c>getChargerLabel</c>).</summary>
    public const string LabelDcFast = "DC Fast";

    /// <summary>Charger category for an unidentified low-power session (web <c>getChargerLabel</c>).</summary>
    public const string LabelHomeAc = "Home / AC";

    /// <summary>Accessible-table column key for the charger category (web <c>key: 'label'</c>).</summary>
    public const string LabelKey = "label";

    /// <summary>Accessible-table column key for the session count (web <c>key: 'count'</c>).</summary>
    public const string CountKey = "count";

    /// <summary>Accessible-table column key for the average power (web <c>key: 'avgKw'</c>).</summary>
    public const string AvgKwKey = "avgKw";

    /// <summary>Accessible-table column key for the average energy (web <c>key: 'avgKwh'</c>).</summary>
    public const string AvgKwhKey = "avgKwh";

    /// <summary>Accessible-table column key for the average duration (web <c>key: 'avgDuration'</c>).</summary>
    public const string AvgDurationKey = "avgDuration";

    /// <summary>Brand-palette index for the average-power bar series (web first <c>&lt;Bar&gt;</c>).</summary>
    public const int PowerColorIndex = 0;

    /// <summary>Brand-palette index for the average-energy bar series (web second <c>&lt;Bar&gt;</c>).</summary>
    public const int EnergyColorIndex = 1;

    /// <summary>Fixed decimals for the kW / kWh figures (web <c>fmtNumber(x, 1)</c>).</summary>
    public const int AverageDecimals = 1;

    /// <summary>The peak-power threshold (W) above which an unlabelled session counts as DC fast (web <c>20_000</c>).</summary>
    public const double DcFastThresholdW = 20_000;

    /// <summary>Power unit suffix carried on the average-power series for the native tooltip (web <c>" kW"</c>).</summary>
    public const string UnitKw = "kW";

    /// <summary>Energy unit suffix carried on the average-energy series for the native tooltip (web <c>" kWh"</c>).</summary>
    public const string UnitKwh = "kWh";

    private const string MiddleDot = "\u00B7";
    private const double MilliPerKilo = 1000.0;
    private const double MillisPerMinute = 60_000.0;

    /// <summary>Web <c>safeNumber</c>: a finite number passes through, anything else becomes 0.</summary>
    /// <param name="value">The value to sanitise.</param>
    public static double Safe(double value) => double.IsFinite(value) ? value : 0;

    /// <summary>Format a number with en-US grouping at <paramref name="decimals"/> places (web <c>fmtNumber</c>).</summary>
    /// <param name="value">The value to format.</param>
    /// <param name="decimals">Fixed fraction digits.</param>
    public static string FormatNumber(double value, int decimals) =>
        NumberFormatting.Format(Safe(value), null, decimals);

    /// <summary>Format a count with grouping at 0 dp, rounding half away from zero (web <c>fmtInt</c>).</summary>
    /// <param name="value">The value to format.</param>
    public static string FormatInt(double value) => NumberFormatting.Format(Safe(value), null, 0);

    /// <summary>The arithmetic mean of <paramref name="values"/>, or 0 when empty (web <c>avg</c>).</summary>
    /// <param name="values">The values to average.</param>
    public static double Average(IReadOnlyList<double> values)
    {
        ArgumentNullException.ThrowIfNull(values);
        if (values.Count == 0)
        {
            return 0;
        }

        double sum = 0;
        for (int i = 0; i < values.Count; i++)
        {
            sum += values[i];
        }

        return sum / values.Count;
    }

    /// <summary>
    /// Whole minutes between <paramref name="startedAt"/> and <paramref name="endedAt"/>, rounded half away from
    /// zero — the native port of web <c>durationMinutes</c>. Returns 0 for an in-progress session (no end), a
    /// non-finite span, or an end that is not strictly after the start.
    /// </summary>
    /// <param name="startedAt">When the session started.</param>
    /// <param name="endedAt">When the session ended, or null while in progress.</param>
    public static double DurationMinutes(DateTimeOffset startedAt, DateTimeOffset? endedAt)
    {
        if (endedAt is not { } ended)
        {
            return 0;
        }

        double ms = (ended - startedAt).TotalMilliseconds;
        if (!double.IsFinite(ms) || ms <= 0)
        {
            return 0;
        }

        return Math.Round(ms / MillisPerMinute, MidpointRounding.AwayFromZero);
    }

    /// <summary>
    /// The charger category for a session — the native port of web <c>getChargerLabel</c>. A <c>charger_type</c>
    /// of "Tesla" (or any value containing "tesla", case-insensitively) is a Supercharger; any other non-empty
    /// <c>charger_type</c> is a DC fast charger; otherwise a peak above the 20 kW threshold is treated as DC
    /// fast; everything else is home / AC.
    /// </summary>
    /// <param name="session">The session to classify.</param>
    public static string ChargerLabel(ChargerTypeChartSession session)
    {
        ArgumentNullException.ThrowIfNull(session);

        string? chargerType = session.ChargerType;
        string lowered = (chargerType ?? string.Empty).ToLowerInvariant();
        if (string.Equals(chargerType, "Tesla", StringComparison.Ordinal) ||
            lowered.Contains("tesla", StringComparison.Ordinal))
        {
            return LabelSupercharger;
        }

        if (!string.IsNullOrEmpty(chargerType))
        {
            return LabelDcFast;
        }

        if (session.PeakPowerW is { } peak && peak > DcFastThresholdW)
        {
            return LabelDcFast;
        }

        return LabelHomeAc;
    }

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web <c>sessions</c> prop + fetch flag).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="decimalPrecision">
    /// The user's display decimal precision (web <c>useSettings</c> global precision; default
    /// <see cref="ChargerTypeChartRegistration.DefaultDecimalPrecision"/>). Used only for the legend's
    /// "min avg" figure, which the web renders with <c>fmtNumber</c> at that precision; every other figure has
    /// an explicit precision baked into the web source.
    /// </param>
    public static ChargerTypeChartDisplay Project(
        ChargerTypeChartModel model,
        ILocalizer localizer,
        int decimalPrecision = ChargerTypeChartRegistration.DefaultDecimalPrecision)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        int precision = Math.Max(0, decimalPrecision);

        string title = localizer.GetString("charging.curve.chargerType", "Charge Rate by Charger Type");
        string subtitle = localizer.GetString(
            "charging.curve.chargerTypeDesc",
            "Average kW and kWh per charger category");
        string ariaLabel = localizer.GetString(
            "charging.curve.chargerType.aria",
            "Composed bar/line chart of average power and energy per charger type");
        string emptyMessage = localizer.GetString("chart.noData", "No data available");
        string loadingLabel = localizer.GetString("common.loading", "Loading");
        string tableLabel = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("chart.a11y.fallbackTableLabel", "{0} \u2014 data table"),
            title);
        string sessionsWord = localizer.GetString("charging.curve.sessions", "sessions");
        string minAvgWord = localizer.GetString("charging.curve.minAvg", "min avg");
        string powerSeriesName = localizer.GetString("charging.curve.avgPower", "Avg Power");
        string energySeriesName = localizer.GetString("charging.curve.avgEnergy", "Avg Energy");

        IReadOnlyList<ChargerTypeChartSlice> slices = BuildSlices(
            model,
            precision,
            sessionsWord,
            minAvgWord,
            powerSeriesName,
            energySeriesName);
        ChargerTypeChartState state = SelectState(model, slices);
        IReadOnlyList<ChartSeries> series = state == ChargerTypeChartState.Ready
            ? BuildSeries(slices, powerSeriesName, energySeriesName)
            : Array.Empty<ChartSeries>();
        IReadOnlyList<ChargerTypeChartColumn> columns = BuildColumns(localizer);
        IReadOnlyList<ChargerTypeChartRow> rows = BuildRows(slices);
        string chartSummary = BuildChartSummary(ariaLabel, slices);

        return new ChargerTypeChartDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            AriaLabel: ariaLabel,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            TableLabel: tableLabel,
            Series: series,
            Slices: slices,
            Columns: columns,
            Rows: rows,
            ChartSummary: chartSummary,
            AutomationName: BuildAutomationName(state, title, chartSummary, emptyMessage, loadingLabel));
    }

    /// <summary>Branch precedence from the web source: loading → empty → ready.</summary>
    private static ChargerTypeChartState SelectState(
        ChargerTypeChartModel model,
        IReadOnlyList<ChargerTypeChartSlice> slices)
    {
        if (model.Loading)
        {
            return ChargerTypeChartState.Loading;
        }

        // Web parity: `if (!sessions.length) return []` collapses to the empty surface; any session produces at
        // least one charger-type group, so emptiness is a function of the session COUNT, not the values.
        return slices.Count == 0 ? ChargerTypeChartState.Empty : ChargerTypeChartState.Ready;
    }

    private static IReadOnlyList<ChargerTypeChartSlice> BuildSlices(
        ChargerTypeChartModel model,
        int precision,
        string sessionsWord,
        string minAvgWord,
        string powerSeriesName,
        string energySeriesName)
    {
        if (model.Sessions.Count == 0)
        {
            return Array.Empty<ChargerTypeChartSlice>();
        }

        // First-seen group order (web `Map` insertion order, iterated by `Array.from(groups.entries())`).
        var order = new List<string>();
        var groups = new Dictionary<string, List<ChargerTypeChartSession>>(StringComparer.Ordinal);
        foreach (ChargerTypeChartSession session in model.Sessions)
        {
            string label = ChargerLabel(session);
            if (!groups.TryGetValue(label, out List<ChargerTypeChartSession>? items))
            {
                items = new List<ChargerTypeChartSession>();
                groups[label] = items;
                order.Add(label);
            }

            items.Add(session);
        }

        var slices = new List<ChargerTypeChartSlice>(order.Count);
        for (int i = 0; i < order.Count; i++)
        {
            string label = order[i];
            List<ChargerTypeChartSession> items = groups[label];

            var kwValues = new List<double>(items.Count);
            var kwhValues = new List<double>(items.Count);
            var durationValues = new List<double>(items.Count);
            foreach (ChargerTypeChartSession session in items)
            {
                kwValues.Add((session.PeakPowerW ?? 0) / MilliPerKilo);
                kwhValues.Add(session.TotalEnergyAddedWh / MilliPerKilo);
                durationValues.Add(DurationMinutes(session.StartedAt, session.EndedAt));
            }

            double avgKw = Average(kwValues);
            double avgKwh = Average(kwhValues);
            double avgDuration = Average(durationValues);
            long count = items.Count;

            string avgKwText = FormatNumber(avgKw, AverageDecimals);
            string avgKwhText = FormatNumber(avgKwh, AverageDecimals);
            string avgMinutesText = FormatInt(avgDuration);
            string countText = FormatInt(count);
            string countCellText = count.ToString(CultureInfo.InvariantCulture);
            string legendDuration = FormatNumber(avgDuration, precision);

            // Web legend: `{fmtInt(count)} {sessions} · {fmtNumber(avgDuration)} {min avg}`.
            string legendCaption =
                $"{countText} {sessionsWord} {MiddleDot} {legendDuration} {minAvgWord}";

            string automationName = string.Join(", ", new[]
            {
                label,
                $"{powerSeriesName} {avgKwText} {UnitKw}",
                $"{energySeriesName} {avgKwhText} {UnitKwh}",
                $"{countText} {sessionsWord}",
                $"{legendDuration} {minAvgWord}",
            });

            slices.Add(new ChargerTypeChartSlice(
                Label: label,
                Count: count,
                AvgKw: avgKw,
                AvgKwh: avgKwh,
                AvgDuration: avgDuration,
                ColorIndex: i,
                AvgKwText: avgKwText,
                AvgKwhText: avgKwhText,
                AvgMinutesText: avgMinutesText,
                CountText: countText,
                CountCellText: countCellText,
                LegendCaption: legendCaption,
                AutomationName: automationName));
        }

        return slices;
    }

    private static IReadOnlyList<ChartSeries> BuildSeries(
        IReadOnlyList<ChargerTypeChartSlice> slices,
        string powerSeriesName,
        string energySeriesName)
    {
        var powerPoints = new List<ChartPoint>(slices.Count);
        var energyPoints = new List<ChartPoint>(slices.Count);
        for (int i = 0; i < slices.Count; i++)
        {
            ChargerTypeChartSlice slice = slices[i];

            // Categorical X (web dataKey="label"): each bar is positioned by ordinal group index and carries the
            // charger-category label the web X-axis renders.
            powerPoints.Add(new ChartPoint(i, Safe(slice.AvgKw), slice.Label));
            energyPoints.Add(new ChartPoint(i, Safe(slice.AvgKwh), slice.Label));
        }

        return
        [
            new ChartSeries(powerSeriesName, powerPoints)
            {
                Kind = ChartSeriesKind.Bar,
                ColorIndex = PowerColorIndex,
                Unit = UnitKw,
                Decimals = AverageDecimals,
            },
            new ChartSeries(energySeriesName, energyPoints)
            {
                Kind = ChartSeriesKind.Bar,
                ColorIndex = EnergyColorIndex,
                Unit = UnitKwh,
                Decimals = AverageDecimals,
            },
        ];
    }

    private static IReadOnlyList<ChargerTypeChartColumn> BuildColumns(ILocalizer localizer) =>
    [
        new ChargerTypeChartColumn(LabelKey, localizer.GetString("charging.curve.col.charger", "Charger Type")),
        new ChargerTypeChartColumn(CountKey, localizer.GetString("charging.curve.col.sessions", "Sessions")),
        new ChargerTypeChartColumn(AvgKwKey, localizer.GetString("charging.curve.col.avgKw", "Avg kW")),
        new ChargerTypeChartColumn(AvgKwhKey, localizer.GetString("charging.curve.col.avgKwh", "Avg kWh")),
        new ChargerTypeChartColumn(AvgDurationKey, localizer.GetString("charging.curve.col.avgMin", "Avg minutes")),
    ];

    private static IReadOnlyList<ChargerTypeChartRow> BuildRows(IReadOnlyList<ChargerTypeChartSlice> slices)
    {
        if (slices.Count == 0)
        {
            return Array.Empty<ChargerTypeChartRow>();
        }

        var rows = new List<ChargerTypeChartRow>(slices.Count);
        foreach (ChargerTypeChartSlice slice in slices)
        {
            var cells = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [LabelKey] = slice.Label,
                [CountKey] = slice.CountCellText,
                [AvgKwKey] = slice.AvgKwText,
                [AvgKwhKey] = slice.AvgKwhText,
                [AvgDurationKey] = slice.AvgMinutesText,
            };

            rows.Add(new ChargerTypeChartRow(slice.Label, cells, slice.AutomationName));
        }

        return rows;
    }

    private static string BuildChartSummary(string ariaLabel, IReadOnlyList<ChargerTypeChartSlice> slices)
    {
        if (slices.Count == 0)
        {
            return ariaLabel;
        }

        var parts = new List<string>(slices.Count);
        foreach (ChargerTypeChartSlice slice in slices)
        {
            parts.Add($"{slice.Label} {slice.AvgKwText} {UnitKw}, {slice.AvgKwhText} {UnitKwh}");
        }

        return string.Create(CultureInfo.CurrentCulture, $"{ariaLabel}. {string.Join("; ", parts)}");
    }

    private static string BuildAutomationName(
        ChargerTypeChartState state,
        string title,
        string chartSummary,
        string emptyMessage,
        string loadingLabel) => state switch
        {
            ChargerTypeChartState.Loading => string.Create(CultureInfo.CurrentCulture, $"{title}. {loadingLabel}"),
            ChargerTypeChartState.Empty => string.Create(CultureInfo.CurrentCulture, $"{title}. {emptyMessage}"),
            _ => string.Create(CultureInfo.CurrentCulture, $"{title}. {chartSummary}"),
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>ChargerTypeChart</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a charger label, session count, power or
/// energy figure — so a diagnostics line can never leak a user's charging behaviour. Thread-safe.
/// </summary>
public sealed class ChargerTypeChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The diagnostics sink, or null to only count.</param>
    public ChargerTypeChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargerTypeChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargerTypeChartRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>ChargerTypeChart</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/charging/components/charging-curve/ChargerTypeChart.tsx</c>.
/// </summary>
public static class ChargerTypeChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ChargerTypeChart";

    /// <summary>The default display decimal precision (web <c>useSettings</c> default global precision).</summary>
    public const int DefaultDecimalPrecision = 2;
}
