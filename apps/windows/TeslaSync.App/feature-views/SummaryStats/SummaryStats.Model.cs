using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state a <see cref="SummaryStatsViewModel"/> can be in — the native union of
/// the loading / loaded / empty / error / stale / offline branches the P2 state contract mandates for the web
/// Driving-Dynamics summary grid
/// (web/src/features/driving/components/driving-dynamics/SummaryStats.tsx). The web component is a pure child of
/// the Driving-Dynamics page that receives <c>motorStats: MotorStats | null</c> as a prop (only
/// <c>useTranslation</c> is read directly); the native feature-view owns the motor-history read the page's
/// <c>computeMotorStats(useMotorHistory(vehicleId, 200))</c> memo aggregates, so it renders the full state
/// matrix — none is ever hidden. <see cref="Empty"/> mirrors the web <c>motorStats === null</c> case (no motor
/// history) in addition to an empty HTTP body.
/// </summary>
public enum MotorSummaryState
{
    /// <summary>Initial fetch with no cached samples — render the per-tile skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh history (or non-stale cache) carrying at least one motor sample — render the six tiles.</summary>
    Loaded,

    /// <summary>No vehicle resolved or no motor samples — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached history exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached history older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached history remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One motor sample projected from the <c>GET /motor</c> history list (web <c>MotorSnapshot</c> in
/// web/src/api/types.ts). Only the fields the web <c>computeMotorStats</c> reduction consumes are kept — the
/// front/rear inverter torque, the front/rear motor temperatures, the drive power and the regen power — all
/// SI (newton-metres, Celsius, kilowatts). Field names mirror the Go API's snake_case JSON tags; parsing is
/// null-tolerant so a partial row never throws and a missing reading stays null (it is excluded from the
/// aggregate, never coerced to a misleading zero). Pure data — no WinUI types.
/// </summary>
/// <param name="TorqueNmFront">Front-axle inverter torque in newton-metres, or null (web <c>torque_nm_front</c>).</param>
/// <param name="TorqueNmRear">Rear-axle inverter torque in newton-metres, or null (web <c>torque_nm_rear</c>).</param>
/// <param name="MotorTempCFront">Front-motor temperature in °C, or null (web <c>motor_temp_c_front</c>).</param>
/// <param name="MotorTempCRear">Rear-motor temperature in °C, or null (web <c>motor_temp_c_rear</c>).</param>
/// <param name="PowerKw">Drive power in kW, or null (web <c>power_kw</c>).</param>
/// <param name="RegenKw">Regenerative power in kW, or null (web <c>regen_kw</c>).</param>
public sealed record MotorStatsSample(
    double? TorqueNmFront,
    double? TorqueNmRear,
    double? MotorTempCFront,
    double? MotorTempCRear,
    double? PowerKw,
    double? RegenKw)
{
    /// <summary>Parse a motor-history JSON array into a tolerant list of rows, preserving order.</summary>
    /// <param name="element">The motor-history JSON array.</param>
    /// <returns>The parsed rows (object entries only); an empty list for a non-array.</returns>
    public static IReadOnlyList<MotorStatsSample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<MotorStatsSample>();
        }

        var list = new List<MotorStatsSample>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single motor-history JSON object into a tolerant sample row.</summary>
    /// <param name="obj">The motor-history JSON object.</param>
    /// <returns>A tolerant sample (missing readings stay null).</returns>
    public static MotorStatsSample FromJson(JsonElement obj) => new(
        GetDouble(obj, "torque_nm_front"),
        GetDouble(obj, "torque_nm_rear"),
        GetDouble(obj, "motor_temp_c_front"),
        GetDouble(obj, "motor_temp_c_rear"),
        GetDouble(obj, "power_kw"),
        GetDouble(obj, "regen_kw"));

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
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
}

/// <summary>
/// The aggregate motor figures the web Driving-Dynamics summary grid consumes — the native port of the web
/// <c>MotorStats</c> shape and the <c>computeMotorStats</c> reduction
/// (web/src/features/driving/components/driving-dynamics/helpers.ts). Reproduced verbatim for parity: torque is
/// the sum of the two axles' inverter torque (a row with neither axle reported is excluded), motor temperature
/// is the hotter of the two motors per row, and power / regen are read directly. Averages, maxima and minima of
/// an empty series collapse to 0 exactly as the web helper does. All values are SI; the user's unit preference
/// is applied only at the render boundary. WinUI-free so the reduction is unit-tested without a UI host.
/// </summary>
/// <param name="TotalReadings">The number of motor samples (web <c>h.length</c>).</param>
/// <param name="AvgTorque">Average combined axle torque in newton-metres (web <c>avgTorque</c>).</param>
/// <param name="MaxTorque">Maximum combined axle torque in newton-metres (web <c>maxTorque</c>).</param>
/// <param name="AvgMotorTemp">Average per-row hottest motor temperature in °C (web <c>avgMotorTemp</c>).</param>
/// <param name="MaxMotorTemp">Maximum per-row hottest motor temperature in °C (web <c>maxMotorTemp</c>).</param>
/// <param name="AvgPower">Average drive power in kW (web <c>avgPower</c>).</param>
/// <param name="PeakPower">Maximum drive power in kW (web <c>peakPower</c>).</param>
/// <param name="MinPower">Minimum drive power in kW (web <c>minPower</c>).</param>
/// <param name="PeakRegen">Maximum regenerative power in kW (web <c>peakRegen</c>).</param>
/// <param name="HighTorquePct">Percent of torque samples above the high-torque threshold (web <c>highTorquePct</c>).</param>
public sealed record MotorStats(
    int TotalReadings,
    double AvgTorque,
    double MaxTorque,
    double AvgMotorTemp,
    double MaxMotorTemp,
    double AvgPower,
    double PeakPower,
    double MinPower,
    double PeakRegen,
    double HighTorquePct)
{
    /// <summary>Torque (Nm) above which a sample counts toward <see cref="HighTorquePct"/> (web <c>t &gt; 200</c>).</summary>
    public const double HighTorqueThresholdNm = 200;

    /// <summary>
    /// Reduce <paramref name="samples"/> into the aggregate figures — the native port of the web
    /// <c>computeMotorStats</c>. Returns <see langword="null"/> for an empty (or null) series, mirroring the web
    /// helper's <c>if (h.length === 0) return null</c> (the surface then renders the empty state).
    /// </summary>
    /// <param name="samples">The motor-history samples (order is irrelevant to the aggregates).</param>
    /// <returns>The aggregate figures, or <see langword="null"/> when there are no samples.</returns>
    public static MotorStats? Compute(IReadOnlyList<MotorStatsSample> samples)
    {
        if (samples is null || samples.Count == 0)
        {
            return null;
        }

        var torques = new List<double>(samples.Count);
        var motorTemps = new List<double>(samples.Count);
        var powers = new List<double>(samples.Count);
        var regens = new List<double>(samples.Count);

        foreach (var s in samples)
        {
            // web: f + r, but skip the row when neither axle reported a torque (=> null, filtered out).
            if (s.TorqueNmFront is not null || s.TorqueNmRear is not null)
            {
                torques.Add((s.TorqueNmFront ?? 0) + (s.TorqueNmRear ?? 0));
            }

            // web: Math.max(f ?? -Infinity, r ?? -Infinity), skipping the row when neither motor reported.
            if (s.MotorTempCFront is not null || s.MotorTempCRear is not null)
            {
                motorTemps.Add(Math.Max(
                    s.MotorTempCFront ?? double.NegativeInfinity,
                    s.MotorTempCRear ?? double.NegativeInfinity));
            }

            if (s.PowerKw is { } p)
            {
                powers.Add(p);
            }

            if (s.RegenKw is { } r)
            {
                regens.Add(r);
            }
        }

        int highTorque = 0;
        foreach (var t in torques)
        {
            if (t > HighTorqueThresholdNm)
            {
                highTorque++;
            }
        }

        return new MotorStats(
            TotalReadings: samples.Count,
            AvgTorque: Avg(torques),
            MaxTorque: Max(torques),
            AvgMotorTemp: Avg(motorTemps),
            MaxMotorTemp: Max(motorTemps),
            AvgPower: Avg(powers),
            PeakPower: Max(powers),
            MinPower: Min(powers),
            PeakRegen: Max(regens),
            HighTorquePct: torques.Count > 0 ? (double)highTorque / torques.Count * 100 : 0);
    }

    private static double Avg(List<double> values)
    {
        if (values.Count == 0)
        {
            return 0;
        }

        double sum = 0;
        foreach (var v in values)
        {
            sum += v;
        }

        return sum / values.Count;
    }

    private static double Max(List<double> values)
    {
        if (values.Count == 0)
        {
            return 0;
        }

        double max = values[0];
        for (int i = 1; i < values.Count; i++)
        {
            if (values[i] > max)
            {
                max = values[i];
            }
        }

        return max;
    }

    private static double Min(List<double> values)
    {
        if (values.Count == 0)
        {
            return 0;
        }

        double min = values[0];
        for (int i = 1; i < values.Count; i++)
        {
            if (values[i] < min)
            {
                min = values[i];
            }
        }

        return min;
    }
}

/// <summary>
/// One projected, display-ready summary tile consumed by the WinUI view — the native analogue of a web
/// <c>&lt;StatCard&gt;</c> instance. Holds the localized label, the already-formatted value (unit and, for the
/// temperature tile, user-unit conversion already applied), the Segoe Fluent accent glyph (the native mapping
/// of the web lucide icon) and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted primary value (with its unit suffix).</param>
/// <param name="Glyph">The Segoe Fluent accent glyph (the native mapping of the web lucide icon).</param>
/// <param name="AutomationName">The Narrator name combining label and value.</param>
public sealed record MotorSummaryTile(string Label, string Value, string Glyph, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Driving-Dynamics summary grid — the six tiles plus the
/// <see cref="HasData"/> gate (web <c>motorStats</c> truthy). Pure data so the projection is unit-tested without
/// a UI host.
/// </summary>
/// <param name="HasData">True when a motor-stats aggregate is present (web <c>motorStats</c> truthy).</param>
/// <param name="Cards">The six summary tiles in web display order.</param>
public sealed record MotorSummaryDisplay(bool HasData, IReadOnlyList<MotorSummaryTile> Cards)
{
    /// <summary>An empty projection (no tiles) — the projection fallback for an absent aggregate.</summary>
    public static MotorSummaryDisplay Empty { get; } = new(false, Array.Empty<MotorSummaryTile>());
}

/// <summary>
/// Pure projection from a <see cref="MotorStats"/> aggregate to the six display tiles — the native port of the
/// <c>&lt;StatCard&gt;</c> composition in
/// web/src/features/driving/components/driving-dynamics/SummaryStats.tsx. Tile order, labels, value precision
/// (the web <c>fmtNumber(x, 1)</c>), unit suffixes (<c>Nm</c> / <c>kW</c>) and the temperature tile's
/// SI-Celsius → display conversion (web <c>fmtNumber(toTemperatureDisplay(avgMotorTemp), 1)${tempUnit}</c>)
/// mirror the web component exactly. Every label resolves through the i18n facade; no WinUI types — unit-tested
/// without a UI host.
/// </summary>
public static class MotorSummaryProjection
{
    /// <summary>Torque unit suffix (web literal <c>Nm</c>); torque is already SI so it is never converted.</summary>
    public const string TorqueUnit = "Nm";

    /// <summary>Power unit suffix (web literal <c>kW</c>); power/regen are already in kW so are never converted.</summary>
    public const string PowerUnit = "kW";

    /// <summary>Segoe Fluent glyph for the Total Readings tile (web lucide <c>BarChart3</c>).</summary>
    public const string TotalReadingsGlyph = "\uE9D2";

    /// <summary>Segoe Fluent glyph for the Avg Torque tile (web lucide <c>Zap</c> / LightningBolt).</summary>
    public const string TorqueGlyph = "\uE945";

    /// <summary>Segoe Fluent glyph for the Peak Power tile (web lucide <c>CornerDownRight</c>).</summary>
    public const string PeakPowerGlyph = "\uEC4A";

    /// <summary>Segoe Fluent glyph for the Peak Regen tile (web lucide <c>TrendingDown</c>).</summary>
    public const string RegenGlyph = "\uE70D";

    /// <summary>Segoe Fluent glyph for the Avg Power tile (web lucide <c>Gauge</c> / Speed).</summary>
    public const string AvgPowerGlyph = "\uE9D9";

    /// <summary>Segoe Fluent glyph for the Avg Motor Temp tile (web lucide <c>Thermometer</c>).</summary>
    public const string TemperatureGlyph = "\uE9CA";

    private const int StatDecimals = 1; // web fmtNumber(x, 1) for torque / power / regen / temperature
    private const int CountDecimals = 0; // total readings is a whole count

    /// <summary>
    /// Project <paramref name="stats"/> into the six summary tiles using the user's units. Returns
    /// <see cref="MotorSummaryDisplay.Empty"/> when <paramref name="stats"/> is null (web
    /// <c>motorStats === null</c>). Tile order, labels, value precision, unit suffixes and the temperature
    /// conversion mirror the web component exactly.
    /// </summary>
    /// <param name="stats">The motor-stats aggregate, or null.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); drives the temperature tile.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>The render-ready display model.</returns>
    public static MotorSummaryDisplay Project(MotorStats? stats, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        if (stats is null)
        {
            return MotorSummaryDisplay.Empty;
        }

        var cards = new List<MotorSummaryTile>(6)
        {
            Card(
                localizer.GetString("dynamics.totalReadings", "Total Readings"),
                ScalarFormatters.FormatNumber(stats.TotalReadings, CountDecimals),
                TotalReadingsGlyph),
            Card(
                localizer.GetString("dynamics.avgTorque", "Avg Torque"),
                WithUnit(stats.AvgTorque, TorqueUnit),
                TorqueGlyph),
            Card(
                localizer.GetString("dynamics.peakPower", "Peak Power"),
                WithUnit(stats.PeakPower, PowerUnit),
                PeakPowerGlyph),
            Card(
                localizer.GetString("dynamics.peakRegen", "Peak Regen"),
                WithUnit(stats.PeakRegen, PowerUnit),
                RegenGlyph),
            Card(
                localizer.GetString("dynamics.avgPower", "Avg Power"),
                WithUnit(stats.AvgPower, PowerUnit),
                AvgPowerGlyph),
            Card(
                localizer.GetString("dynamics.avgMotorTemp", "Avg Motor Temp"),
                UnitFormatters.FormatTemperature(stats.AvgMotorTemp, units, StatDecimals),
                TemperatureGlyph),
        };

        return new MotorSummaryDisplay(true, cards);
    }

    private static string WithUnit(double value, string unit) =>
        string.Format(
            CultureInfo.CurrentCulture,
            "{0} {1}",
            ScalarFormatters.FormatNumber(value, StatDecimals),
            unit);

    private static MotorSummaryTile Card(string label, string value, string glyph) =>
        new(label, value, glyph, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;MotorStatsSample&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// <c>computeMotorStats</c> reduction and the empty gate are applied by the view-model, not here, so an empty
/// list still flows through with its freshness intact. Kept pure so the parse-and-preserve contract is
/// unit-tested without a network or cache.
/// </summary>
public static class MotorSummaryResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission carrying the motor-history JSON.</param>
    /// <returns>The parsed emission with its status preserved.</returns>
    public static RepositoryResult<IReadOnlyList<MotorStatsSample>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<MotorStatsSample> Parse() =>
            raw.HasValue ? MotorStatsSample.ParseList(raw.Value) : Array.Empty<MotorStatsSample>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<MotorStatsSample>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<MotorStatsSample>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<MotorStatsSample>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<MotorStatsSample>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<MotorStatsSample>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<MotorStatsSample>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<MotorStatsSample>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Driving-Dynamics summary surface — the native mirror of the web feature
/// component (web/src/features/driving/components/driving-dynamics/SummaryStats.tsx, rendered by the
/// Driving-Dynamics page). Centralises the stable id, category and diagnostics slug so the view and view-model
/// stay free of literal identifiers.
/// </summary>
public static class MotorSummaryRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "summary-stats";

    /// <summary>Surface category (matches the web driving feature).</summary>
    public const string Category = "driving";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SummaryStats";

    /// <summary>Localized surface title (used as the accessible name; the web grid itself is headerless).</summary>
    /// <param name="localizer">The i18n facade resolving the title.</param>
    /// <returns>The localized title.</returns>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("dynamics.summaryStats.title", "Motor Summary");
    }
}

/// <summary>
/// PII-safe diagnostics for the Driving-Dynamics summary surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a torque figure, temperature, sample
/// count, VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class MotorSummaryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The PII-safe diagnostics sink, or null.</param>
    public MotorSummaryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SummaryStats</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MotorSummaryRegistration.Slug}");
    }
}
