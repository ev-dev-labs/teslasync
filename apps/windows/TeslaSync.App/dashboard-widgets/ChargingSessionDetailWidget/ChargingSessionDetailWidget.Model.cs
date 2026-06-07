using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="ChargingSessionDetailViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ChargingSessionDetailWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetChartSummary</c>
/// (web/src/features/dashboard/widgets/ChargingSessionDetailWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>!detail</c> gate (no vehicle, no
/// charging sessions, or the session detail resolved to nothing) — the friendly "No charge sessions"
/// surface — distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum ChargingSessionDetailState
{
    /// <summary>Initial fetch with no cached detail — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh session detail (or non-stale cache) is shown.</summary>
    Loaded,

    /// <summary>No vehicle resolved, no charging sessions, or no detail — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached detail exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached detail older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached detail remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The charger-type bucket a charging session is classified into — the native union of the web
/// <c>classifyCharger</c> result in web/src/features/dashboard/widgets/ChargingSessionDetailWidget.tsx.
/// Each maps to a localized label and a <see cref="StatusKind"/> badge accent.
/// </summary>
public enum ChargerKind
{
    /// <summary>Home / AC charging (web 'AC / Home', neutral badge). The null / empty fallback.</summary>
    AcHome,

    /// <summary>Tesla Supercharger (web 'Supercharger', warning badge).</summary>
    Supercharger,

    /// <summary>DC fast charging (web 'DC Fast', warning badge).</summary>
    DcFast,
}

/// <summary>
/// The session detail projected from the charging-session detail response (web <c>ApiChargingSession</c>,
/// an alias of <c>ChargingSession</c> in web/src/api/types.ts). Only the fields the web component reads are
/// kept: the SI energy added in watt-hours (<c>total_energy_added_wh</c>, converted to kWh at the display
/// boundary), the free-text <c>charger_type</c> (classified into a <see cref="ChargerKind"/>), and the
/// <c>started_at</c> / <c>ended_at</c> instants from which the session duration is derived (the v1
/// <c>/charging-sessions/{id}</c> response carries no precomputed <c>duration_min</c>, so it is computed
/// here exactly as the Go <c>ChargingSession.DurationMinutes</c> does). Field names mirror the Go API's
/// snake_case JSON tags; parsing is null-tolerant so a partial row never throws.
/// </summary>
/// <param name="EnergyAddedWh">Energy added in watt-hours (web <c>total_energy_added_wh ?? 0</c>).</param>
/// <param name="ChargerType">Raw charger-type label, or null (web <c>charger_type</c>).</param>
/// <param name="StartedAt">Session start instant, or null (web <c>started_at</c>).</param>
/// <param name="EndedAt">Session end instant, or null while the session is live (web <c>ended_at</c>).</param>
public sealed record ChargingSessionDetailRow(
    double EnergyAddedWh,
    string? ChargerType,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt)
{
    /// <summary>Project a single charging-session detail JSON object into a tolerant row.</summary>
    public static ChargingSessionDetailRow FromJson(JsonElement obj) => new(
        WidgetJson.GetDouble(obj, "total_energy_added_wh") ?? 0,
        WidgetJson.GetString(obj, "charger_type"),
        WidgetJson.GetDateTime(obj, "started_at"),
        WidgetJson.GetDateTime(obj, "ended_at"));

    /// <summary>
    /// True when <paramref name="element"/> carries a usable detail object. Mirrors the web <c>!detail</c>
    /// gate: a null / non-object payload collapses to the empty surface.
    /// </summary>
    public static bool HasDetail(JsonElement element) => element.ValueKind == JsonValueKind.Object;

    /// <summary>
    /// The session duration in whole minutes, or null when the session has no end yet. Mirrors the Go
    /// <c>ChargingSession.DurationMinutes</c> (<c>ended_at − started_at</c>); the web reads the server's
    /// equivalent <c>duration_min</c>.
    /// </summary>
    public double? DurationMinutes()
    {
        if (StartedAt is not { } start || EndedAt is not { } end)
        {
            return null;
        }

        double minutes = (end - start).TotalMinutes;
        return minutes >= 0 ? minutes : null;
    }
}

/// <summary>
/// One charge-telemetry sample projected from the per-session telemetry response (web
/// <c>ChargeTelemetryReading</c> in web/src/api/types.ts). Only the three fields the web chart reads are
/// kept: the <c>created_at</c> instant (X axis), the canonical <c>power_kw</c> (the power area), and the
/// battery state-of-charge (<c>battery_level ?? soc</c>, the SoC overlay line). Parsing is null-tolerant so
/// a partial row never throws and a missing metric becomes a gap the chart connects across (web
/// <c>connectNulls</c>).
/// </summary>
/// <param name="CreatedAt">Sample instant, or null (web <c>created_at</c>).</param>
/// <param name="PowerKw">Charger power in kW, or null (web <c>power_kw</c>).</param>
/// <param name="Soc">Battery state of charge %, or null (web <c>battery_level ?? soc</c>).</param>
public sealed record ChargeTelemetrySample(DateTimeOffset? CreatedAt, double? PowerKw, double? Soc)
{
    /// <summary>Parse a charge-telemetry JSON array into a tolerant list of samples, preserving order.</summary>
    public static IReadOnlyList<ChargeTelemetrySample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ChargeTelemetrySample>();
        }

        var list = new List<ChargeTelemetrySample>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single charge-telemetry JSON object into a tolerant sample.</summary>
    public static ChargeTelemetrySample FromJson(JsonElement obj) => new(
        WidgetJson.GetDateTime(obj, "created_at"),
        WidgetJson.GetDouble(obj, "power_kw"),

        // Web parity: `battery_level ?? soc` — battery_level wins, soc is the fallback.
        WidgetJson.GetDouble(obj, "battery_level") ?? WidgetJson.GetDouble(obj, "soc"));
}

/// <summary>
/// The combined snapshot driving the surface — the session <see cref="Detail"/> (web
/// <c>useChargingSessionDetail</c>) plus its <see cref="Telemetry"/> samples (web
/// <c>useChargeTelemetry</c>). The detail gates the empty surface and the summary stats; the telemetry
/// drives the power curve, the SoC overlay and the peak-power figure. Pure data so the projection is
/// unit-tested without a UI host or network.
/// </summary>
public sealed record ChargingSessionDetailSnapshot(
    ChargingSessionDetailRow Detail,
    IReadOnlyList<ChargeTelemetrySample> Telemetry);

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1</c> / <c>isWide = size.cols &gt;= 3</c> branches in
/// web/src/features/dashboard/widgets/ChargingSessionDetailWidget.tsx.
/// </summary>
public readonly record struct ChargingSessionDetailSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static ChargingSessionDetailSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>): show the big-number layout.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at three or more columns (web <c>isWide = size.cols &gt;= 3</c>): use the wider axis ticks.</summary>
    public bool IsWide => Cols >= 3;
}

/// <summary>
/// One projected, display-ready stat from the summary row — the native analogue of a web
/// <c>ChartSummaryStat</c>. Holds the localized <see cref="Label"/>, the formatted <see cref="Value"/>,
/// the optional <see cref="Unit"/> suffix (<c>kWh</c> / <c>kW</c>, absent for duration and charger), and a
/// Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record ChargingSessionDetailStat(string Label, string Value, string? Unit, string AutomationName);

/// <summary>
/// One projected, render-ready point of the charge curve — the native analogue of a single web
/// <c>ChartDatum</c>. Holds the X-axis <see cref="TimeLabel"/> (24-hour local <c>HH:mm</c>, matching the
/// web), the raw <see cref="PowerKw"/> / <see cref="Soc"/> (for the tooltip / automation summary) and the
/// pre-normalized <see cref="PowerRatio"/> / <see cref="SocRatio"/> (0..1 of the power axis / 0..100 SoC
/// axis) the view scales into pixels. A null ratio is a gap the view connects across (web
/// <c>connectNulls</c>). Pure data so the geometry is unit-tested without a UI host.
/// </summary>
public sealed record ChargeCurvePoint(
    string TimeLabel,
    double? PowerKw,
    double? Soc,
    double? PowerRatio,
    double? SocRatio);

/// <summary>
/// The fully projected charge-curve chart — the native analogue of the web recharts
/// <c>ComposedChart</c> (a power <c>Area</c> on the left axis + a dashed SoC <c>Line</c> on the right axis).
/// Holds the normalized <see cref="Points"/>, the localized series names, the left power-axis bound label
/// and a spoken automation summary. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ChargeCurveChartModel(
    IReadOnlyList<ChargeCurvePoint> Points,
    string PowerSeriesName,
    string SocSeriesName,
    double PowerAxisMaxKw,
    string PowerAxisMaxLabel,
    string AutomationName)
{
    /// <summary>True when there is at least one sample to plot (web <c>chartData.length &gt; 0</c>).</summary>
    public bool HasPoints => Points.Count > 0;
}

/// <summary>
/// The fully projected, render-ready view of the latest charge session for one footprint — the native
/// analogue of everything the web component computes via <c>useMemo</c> before returning JSX. Carries the
/// compact big-number fields, the standard summary stats and the charge-curve chart. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record ChargingSessionDetailDisplay(
    bool IsCompact,
    bool IsWide,
    bool HasData,
    string CompactEnergyText,
    string CompactUnitLabel,
    string ChargerLabel,
    ChargerKind Charger,
    StatusKind ChargerStatus,
    string CompactAutomationName,
    IReadOnlyList<ChargingSessionDetailStat> Stats,
    ChargeCurveChartModel Chart)
{
    /// <summary>True when there is a charge curve to draw (web <c>chartData.length &gt; 0</c>).</summary>
    public bool HasChart => Chart.HasPoints;
}

/// <summary>
/// Pure projection from the combined session snapshot to the display model — the native port of the
/// <c>chartData</c> / <c>stats</c> / <c>durationStr</c> / <c>peakPower</c> / <c>charger</c> <c>useMemo</c>
/// work and the <c>classifyCharger</c> / <c>isCompact</c> gating in
/// web/src/features/dashboard/widgets/ChargingSessionDetailWidget.tsx. Energy is converted from SI
/// watt-hours to kWh exactly as the web <c>convertEnergyFromSI(_, 'kWh')</c> does (a fixed
/// <c>wh / 1000</c>, never the user's unit preference); every label resolves through the i18n facade.
/// </summary>
public static class ChargingSessionDetailProjection
{
    /// <summary>Segoe Fluent "Lightning" glyph for the surface header / empty state (web <c>Zap</c>).</summary>
    public const string HeaderGlyph = "\uE945";

    /// <summary>The accent brush tinting the header icon and the power area (web emerald <c>#22c55e</c>).</summary>
    public const string PowerBrushKey = "TsColorSuccessBrush";

    /// <summary>The brush tinting the SoC overlay line (web cyan <c>#22d3ee</c>).</summary>
    public const string SocBrushKey = "TsColorInfoBrush";

    /// <summary>The energy unit the chart and stats are expressed in (web literal <c>'kWh'</c>).</summary>
    public const string EnergyUnit = "kWh";

    /// <summary>The power unit the peak-power stat is expressed in (web literal <c>'kW'</c>).</summary>
    public const string PowerUnit = "kW";

    /// <summary>Watt-hours per kilowatt-hour (web <c>convertEnergyFromSI(_, 'kWh')</c> divides by this).</summary>
    public const double WattHoursPerKwh = 1000.0;

    /// <summary>Headroom added above the tallest sample for the power axis (web <c>domain={[0, 'dataMax + 5']}</c>).</summary>
    public const double PowerAxisHeadroomKw = 5.0;

    /// <summary>The SoC axis spans a fixed 0..100% (web right axis <c>domain={[0, 100]}</c>).</summary>
    public const double SocAxisMax = 100.0;

    /// <summary>Classify a raw charger-type label into a bucket — the native port of <c>classifyCharger</c>.</summary>
    public static ChargerKind Classify(string? chargerType)
    {
        if (string.IsNullOrEmpty(chargerType))
        {
            return ChargerKind.AcHome;
        }

        string ct = chargerType.ToLowerInvariant();
        if (ct.Contains("supercharger", StringComparison.Ordinal) || ct.Contains("tesla", StringComparison.Ordinal))
        {
            return ChargerKind.Supercharger;
        }

        if (ct != "<invalid>")
        {
            return ChargerKind.DcFast;
        }

        return ChargerKind.AcHome;
    }

    /// <summary>The <see cref="StatusKind"/> badge accent for a charger bucket (web <c>variant</c>).</summary>
    public static StatusKind StatusFor(ChargerKind charger) =>
        charger == ChargerKind.AcHome ? StatusKind.Neutral : StatusKind.Warning;

    /// <summary>The i18n key for a charger-bucket label (web hardcoded label, lifted to i18n here).</summary>
    public static string ChargerLabelKey(ChargerKind charger) => charger switch
    {
        ChargerKind.Supercharger => "widget.chargingSessionDetail.charger.supercharger",
        ChargerKind.DcFast => "widget.chargingSessionDetail.charger.dcFast",
        _ => "widget.chargingSessionDetail.charger.acHome",
    };

    /// <summary>The English fallback for a charger-bucket label (web <c>classifyCharger</c> label).</summary>
    public static string ChargerLabelFallback(ChargerKind charger) => charger switch
    {
        ChargerKind.Supercharger => "Supercharger",
        ChargerKind.DcFast => "DC Fast",
        _ => "AC / Home",
    };

    /// <summary>Project the empty (no detail) display for <paramref name="size"/> using the localizer.</summary>
    public static ChargingSessionDetailDisplay Empty(ChargingSessionDetailSize size, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var charger = ChargerKind.AcHome;
        return new ChargingSessionDetailDisplay(
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            HasData: false,
            CompactEnergyText: Fmt(0, 1),
            CompactUnitLabel: localizer.GetString("widget.chargingSessionDetail.unitKwh", "kWh added"),
            ChargerLabel: localizer.GetString(ChargerLabelKey(charger), ChargerLabelFallback(charger)),
            Charger: charger,
            ChargerStatus: StatusFor(charger),
            CompactAutomationName: localizer.GetString("widget.chargingSessionDetail.empty", "No charge sessions"),
            Stats: Array.Empty<ChargingSessionDetailStat>(),
            Chart: EmptyChart(localizer));
    }

    /// <summary>Project <paramref name="snapshot"/> for <paramref name="size"/> using the localizer for every label.</summary>
    /// <param name="snapshot">The combined session detail + telemetry samples.</param>
    /// <param name="size">The widget footprint (drives the compact branch).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="now">The reference instant (threaded for consistency; the HH:mm label ignores it).</param>
    public static ChargingSessionDetailDisplay Project(
        ChargingSessionDetailSnapshot snapshot,
        ChargingSessionDetailSize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var detail = snapshot.Detail;
        var telemetry = snapshot.Telemetry;

        double energyKwh = detail.EnergyAddedWh / WattHoursPerKwh;
        double peakPowerKw = PeakPower(telemetry);
        var charger = Classify(detail.ChargerType);
        string chargerLabel = localizer.GetString(ChargerLabelKey(charger), ChargerLabelFallback(charger));

        var chart = BuildChart(telemetry, peakPowerKw, localizer);
        var stats = BuildStats(energyKwh, detail, peakPowerKw, chargerLabel, localizer);

        return new ChargingSessionDetailDisplay(
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            HasData: true,
            CompactEnergyText: Fmt(energyKwh, 1),
            CompactUnitLabel: localizer.GetString("widget.chargingSessionDetail.unitKwh", "kWh added"),
            ChargerLabel: chargerLabel,
            Charger: charger,
            ChargerStatus: StatusFor(charger),
            CompactAutomationName: CompactAutomationName(energyKwh, chargerLabel, localizer),
            Stats: stats,
            Chart: chart);
    }

    /// <summary>The peak charger power across the telemetry (web <c>reduce(max, power_kw ?? 0, 0)</c>).</summary>
    public static double PeakPower(IReadOnlyList<ChargeTelemetrySample> telemetry)
    {
        ArgumentNullException.ThrowIfNull(telemetry);
        double max = 0;
        foreach (var sample in telemetry)
        {
            double power = sample.PowerKw ?? 0;
            if (power > max)
            {
                max = power;
            }
        }

        return max;
    }

    /// <summary>
    /// The session duration formatted as the web <c>durationStr</c> does: <c>&lt;60 → "{m}m"</c>, otherwise
    /// <c>"{h}h {m}m"</c> (or <c>"{h}h"</c> when the minute remainder is zero). A session with no end yet
    /// reads as <c>0m</c> (the web <c>duration_min ?? 0</c> when detail is present).
    /// </summary>
    public static string DurationText(ChargingSessionDetailRow detail)
    {
        ArgumentNullException.ThrowIfNull(detail);
        int mins = (int)Math.Round(detail.DurationMinutes() ?? 0, MidpointRounding.AwayFromZero);
        if (mins < 60)
        {
            return string.Create(CultureInfo.CurrentCulture, $"{mins}m");
        }

        int h = mins / 60;
        int m = mins % 60;
        return m > 0
            ? string.Create(CultureInfo.CurrentCulture, $"{h}h {m}m")
            : string.Create(CultureInfo.CurrentCulture, $"{h}h");
    }

    private static List<ChargingSessionDetailStat> BuildStats(
        double energyKwh,
        ChargingSessionDetailRow detail,
        double peakPowerKw,
        string chargerLabel,
        ILocalizer localizer)
    {
        string energyLabel = localizer.GetString("widget.chargingSessionDetail.energy", "Energy Added");
        string durationLabel = localizer.GetString("widget.chargingSessionDetail.duration", "Duration");
        string peakLabel = localizer.GetString("widget.chargingSessionDetail.peakPower", "Peak Power");
        string chargerHeading = localizer.GetString("widget.chargingSessionDetail.charger", "Charger");

        string energyValue = Fmt(energyKwh, 1);
        string durationValue = DurationText(detail);
        string peakValue = Fmt(peakPowerKw, 1);

        return new List<ChargingSessionDetailStat>(4)
        {
            new(energyLabel, energyValue, EnergyUnit, MeasureAutomationName(energyLabel, energyValue, EnergyUnit)),
            new(durationLabel, durationValue, null, PlainAutomationName(durationLabel, durationValue)),
            new(peakLabel, peakValue, PowerUnit, MeasureAutomationName(peakLabel, peakValue, PowerUnit)),
            new(chargerHeading, chargerLabel, null, PlainAutomationName(chargerHeading, chargerLabel)),
        };
    }

    private static ChargeCurveChartModel BuildChart(
        IReadOnlyList<ChargeTelemetrySample> telemetry,
        double peakPowerKw,
        ILocalizer localizer)
    {
        string powerSeries = localizer.GetString("widget.chargingSessionDetail.powerKw", "Power (kW)");
        string socSeries = localizer.GetString("widget.chargingSessionDetail.soc", "SoC %");

        if (telemetry.Count == 0)
        {
            return EmptyChart(localizer);
        }

        // Web parity: the left power axis domain is [0, dataMax + 5]; a zero-power curve still yields a
        // non-degenerate axis so the SoC overlay remains visible.
        double axisMax = peakPowerKw + PowerAxisHeadroomKw;
        if (axisMax <= 0)
        {
            axisMax = PowerAxisHeadroomKw;
        }

        var points = new List<ChargeCurvePoint>(telemetry.Count);
        foreach (var sample in telemetry)
        {
            string label = sample.CreatedAt is { } ts
                ? ts.LocalDateTime.ToString("HH:mm", CultureInfo.InvariantCulture)
                : string.Empty;

            double? powerRatio = sample.PowerKw is { } pw
                ? Math.Clamp(pw / axisMax, 0.0, 1.0)
                : null;
            double? socRatio = sample.Soc is { } soc
                ? Math.Clamp(soc / SocAxisMax, 0.0, 1.0)
                : null;

            points.Add(new ChargeCurvePoint(label, sample.PowerKw, sample.Soc, powerRatio, socRatio));
        }

        return new ChargeCurveChartModel(
            Points: points,
            PowerSeriesName: powerSeries,
            SocSeriesName: socSeries,
            PowerAxisMaxKw: axisMax,
            PowerAxisMaxLabel: Fmt(axisMax, 0),
            AutomationName: ChartAutomationName(points.Count, peakPowerKw, powerSeries, socSeries, localizer));
    }

    private static ChargeCurveChartModel EmptyChart(ILocalizer localizer) => new(
        Points: Array.Empty<ChargeCurvePoint>(),
        PowerSeriesName: localizer.GetString("widget.chargingSessionDetail.powerKw", "Power (kW)"),
        SocSeriesName: localizer.GetString("widget.chargingSessionDetail.soc", "SoC %"),
        PowerAxisMaxKw: PowerAxisHeadroomKw,
        PowerAxisMaxLabel: Fmt(PowerAxisHeadroomKw, 0),
        AutomationName: localizer.GetString("widget.chargingSessionDetail.noCurve", "No charge curve data"));

    private static string ChartAutomationName(
        int pointCount,
        double peakPowerKw,
        string powerSeries,
        string socSeries,
        ILocalizer localizer)
    {
        string template = localizer.GetString(
            "widget.chargingSessionDetail.chartSummary",
            "{0} and {1}, {2} samples, peak {3} {4}");
        return string.Format(
            CultureInfo.CurrentCulture,
            template,
            powerSeries,
            socSeries,
            pointCount.ToString(CultureInfo.CurrentCulture),
            Fmt(peakPowerKw, 1),
            PowerUnit);
    }

    private static string CompactAutomationName(double energyKwh, string chargerLabel, ILocalizer localizer)
    {
        string unit = localizer.GetString("widget.chargingSessionDetail.unitKwh", "kWh added");
        return string.Format(CultureInfo.CurrentCulture, "{0} {1}, {2}", Fmt(energyKwh, 1), unit, chargerLabel);
    }

    private static string MeasureAutomationName(string label, string value, string unit) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);

    private static string PlainAutomationName(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);

    /// <summary>
    /// Format a number exactly as the web <c>fmtNumber</c> does: coerce null / NaN / ±∞ to 0 (web
    /// <c>safeNumber</c>) then render with fixed <paramref name="decimals"/> fraction digits and en-US
    /// grouping.
    /// </summary>
    private static string Fmt(double value, int decimals)
    {
        double safe = !double.IsNaN(value) && !double.IsInfinity(value) ? value : 0.0;
        return ScalarFormatters.FormatNumber(safe, decimals);
    }
}

/// <summary>
/// Tolerant JSON readers shared by the Charging Session Detail model — null-safe accessors that coerce a
/// missing / wrong-kind property to null rather than throwing, so a partial wire row (the Go API omits
/// nil pointers via <c>omitempty</c>) never breaks the projection.
/// </summary>
internal static class WidgetJson
{
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    public static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var dt)
            ? dt
            : null;
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> detail emissions — combined with the
/// already-resolved telemetry samples — onto parsed
/// <c>RepositoryResult&lt;ChargingSessionDetailSnapshot&gt;</c>, preserving every freshness flag (cached /
/// refreshing / stale / offline) so the view-model can render the full state matrix. A detail payload that
/// carries no usable object collapses to <see cref="LoadStatus.Empty"/> (web <c>!detail</c>). Kept pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ChargingSessionDetailResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s detail payload, fold in <paramref name="telemetry"/>, and preserve status.</summary>
    public static RepositoryResult<ChargingSessionDetailSnapshot> Map(
        RepositoryResult<JsonElement> raw,
        IReadOnlyList<ChargeTelemetrySample> telemetry)
    {
        ArgumentNullException.ThrowIfNull(raw);
        ArgumentNullException.ThrowIfNull(telemetry);

        ChargingSessionDetailSnapshot? Parse()
        {
            if (!raw.HasValue || !ChargingSessionDetailRow.HasDetail(raw.Value))
            {
                return null;
            }

            return new ChargingSessionDetailSnapshot(ChargingSessionDetailRow.FromJson(raw.Value), telemetry);
        }

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ChargingSessionDetailSnapshot>.Loading(),
            LoadStatus.Cached => FromParsed(Parse(), s => RepositoryResult<ChargingSessionDetailSnapshot>.Cached(s, raw.FetchedAt!.Value, raw.IsStale), raw.FetchedAt),
            LoadStatus.Refreshing => FromParsed(Parse(), s => RepositoryResult<ChargingSessionDetailSnapshot>.Refreshing(s, raw.FetchedAt!.Value, raw.IsStale), raw.FetchedAt),
            LoadStatus.Loaded => FromParsed(Parse(), s => RepositoryResult<ChargingSessionDetailSnapshot>.Loaded(s, raw.FetchedAt ?? DateTimeOffset.UtcNow), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<ChargingSessionDetailSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => FromParsed(Parse(), s => RepositoryResult<ChargingSessionDetailSnapshot>.OfflineCached(s, raw.FetchedAt!.Value, raw.Error!), raw.FetchedAt),
            _ => RepositoryResult<ChargingSessionDetailSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    // A present-but-detail-less payload (web `!detail`) collapses to Empty regardless of the transport status.
    private static RepositoryResult<ChargingSessionDetailSnapshot> FromParsed(
        ChargingSessionDetailSnapshot? parsed,
        Func<ChargingSessionDetailSnapshot, RepositoryResult<ChargingSessionDetailSnapshot>> project,
        DateTimeOffset? fetchedAt) =>
        parsed is { } snapshot
            ? project(snapshot)
            : RepositoryResult<ChargingSessionDetailSnapshot>.Empty(fetchedAt);
}
