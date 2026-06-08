using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="ChargingTelemetryViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ChargingTelemetryWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/ChargingTelemetryWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> models the web query resolving to <c>data == null</c>
/// (no telemetry row for the vehicle) — which the web renders as the "Not currently charging" surface,
/// the same surface a present-but-idle reading shows.
/// </summary>
public enum ChargingTelemetryState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh reading (or non-stale cache) to render the telemetry view for.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the response carried no telemetry row — render the "Not currently charging" surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached reading older than the freshness window — render the view plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached reading remains — render the view plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The fields the live charging view reads from <c>GET /charging-telemetry/latest?vehicle_id={id}</c> — the
/// native mirror of the web <c>ChargingTelemetry</c> slice the widget consumes (<c>ts</c>,
/// <c>charging_state</c>, <c>charger_voltage</c>, <c>charger_actual_current</c>, <c>charger_power_w</c>,
/// <c>charger_phases</c>, <c>charger_pilot_current</c>; web/src/api/types.ts). Values are read verbatim from
/// the wire exactly as the web component reads them — including the web's literal treatment of
/// <c>charger_power_w</c> (a watt figure) as the "kW" readout — so the native surface reproduces the web's
/// observable output, never silently "corrected". A <see langword="null"/> parse result models the web
/// <c>data == null</c> (no telemetry row → the "Not currently charging" surface). Parsing is null-tolerant so a
/// partial body never throws.
/// </summary>
/// <param name="Ts">The reading timestamp (web <c>ts</c>) — drives the rolling power-history sampling.</param>
/// <param name="ChargingState">The charge state string (web <c>charging_state</c>); "Charging" means active.</param>
/// <param name="ChargerVoltage">Charger voltage in volts (web <c>charger_voltage ?? 0</c>).</param>
/// <param name="ChargerActualCurrent">Charger actual current in amperes (web <c>charger_actual_current ?? 0</c>).</param>
/// <param name="ChargerPowerW">Charger power as the web reads it — <c>charger_power_w ?? 0</c>, rendered as "kW".</param>
/// <param name="ChargerPhases">Number of charging phases (web <c>charger_phases ?? 0</c>).</param>
/// <param name="ChargerPilotCurrent">Charger pilot current in amperes (web <c>charger_pilot_current ?? 0</c>).</param>
public sealed record ChargingTelemetryReading(
    string Ts,
    string? ChargingState,
    double ChargerVoltage,
    double ChargerActualCurrent,
    double ChargerPowerW,
    double ChargerPhases,
    double ChargerPilotCurrent)
{
    /// <summary>The active-charging charge-state literal the web compares against (<c>charging_state === 'Charging'</c>).</summary>
    public const string ChargingLiteral = "Charging";

    /// <summary>True when the reading is actively charging (web <c>data?.charging_state === 'Charging'</c>).</summary>
    public bool IsCharging => string.Equals(ChargingState, ChargingLiteral, StringComparison.Ordinal);

    /// <summary>
    /// Project a <c>/charging-telemetry/latest</c> response into the telemetry slice. Returns
    /// <see langword="null"/> when the body is not a JSON object — the native analogue of the web
    /// <c>data == null</c> (no telemetry row → the "Not currently charging" surface). Every numeric field is
    /// read null-tolerantly and defaults to 0, mirroring the web <c>?? 0</c> reads.
    /// </summary>
    public static ChargingTelemetryReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ChargingTelemetryReading(
            Ts: ReadString(root, "ts") ?? string.Empty,
            ChargingState: ReadString(root, "charging_state"),
            ChargerVoltage: ReadDouble(root, "charger_voltage") ?? 0,
            ChargerActualCurrent: ReadDouble(root, "charger_actual_current") ?? 0,
            ChargerPowerW: ReadDouble(root, "charger_power_w") ?? 0,
            ChargerPhases: ReadDouble(root, "charger_phases") ?? 0,
            ChargerPilotCurrent: ReadDouble(root, "charger_pilot_current") ?? 0);
    }

    private static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static double? ReadDouble(JsonElement obj, string name)
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
/// The telemetry snapshot the view-model projects — a thin wrapper over the parsed
/// <see cref="ChargingTelemetryReading"/>. The widget composes a single query (the web
/// <c>useChargingTelemetryLatest</c>), so the snapshot carries exactly one reading. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record ChargingTelemetrySnapshot(ChargingTelemetryReading Reading);

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isWide</c> logic in
/// web/src/features/dashboard/widgets/ChargingTelemetryWidget.tsx.
/// </summary>
public readonly record struct ChargingTelemetrySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static ChargingTelemetrySize Default => new(2, 2);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>): the big-number readout.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at four or more columns (web <c>isWide = size.cols &gt;= 4</c>): adds efficiency + charger badge + sparkline.</summary>
    public bool IsWide => Cols >= 4;
}

/// <summary>
/// One metric tile — the native counterpart of a web <c>StatGridItem</c> rendered through <c>StatCard</c>
/// (a leading glyph, a localized label, a pre-formatted value with an optional unit, an emphasis flag for the
/// web <c>valueColor</c>, and a Narrator name combining all three). Pure data — no WinUI types.
/// </summary>
/// <param name="Glyph">The Segoe Fluent glyph for the leading icon (web lucide icon).</param>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted tile value.</param>
/// <param name="Unit">The unit suffix ("V" / "A" / "kW" / "%"), or empty when there is none.</param>
/// <param name="Emphasize">True for the Power tile (web <c>valueColor: 'text-emerald-300'</c>).</param>
/// <param name="AutomationName">The Narrator name (label + value + unit).</param>
public sealed record ChargingTelemetryStat(
    string Glyph,
    string Label,
    string Value,
    string Unit,
    bool Emphasize,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the charging-telemetry surface for one footprint — the native
/// analogue of everything the web component computes before returning JSX (the derived <c>voltage</c> /
/// <c>current</c> / <c>power</c> / <c>phases</c> reads, the <c>chargerType</c> + <c>efficiency</c> memos, the
/// <c>coreStats</c> / <c>wideStats</c> grids, and the compact / standard / wide composition flags). Pure data
/// so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ChargingTelemetryDisplay(
    bool IsCharging,
    bool IsCompact,
    bool IsWide,
    string PowerText,
    string VoltageCurrentText,
    IReadOnlyList<ChargingTelemetryStat> Stats,
    int StatColumns,
    string? ChargerType,
    string? ChargerBadgeText,
    StatusKind ChargerBadgeStatus,
    IReadOnlyList<double> PowerHistory,
    bool ShowSparkline,
    string NotChargingText,
    string ChargingAutomationName,
    string CompactAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="ChargingTelemetrySnapshot"/> + the accumulated power history to the
/// display model — the native port of the web component's derived reads, its <c>chargerType</c> /
/// <c>efficiency</c> memos, its <c>coreStats</c> / <c>wideStats</c> stat grids and its compact / standard /
/// wide JSX branches in web/src/features/dashboard/widgets/ChargingTelemetryWidget.tsx. Numbers are formatted
/// exactly as the web <c>fmtNumber</c> / <c>fmtInt</c> (en-US grouping, explicit precision); the charger-type
/// heuristic and the efficiency formula are reproduced verbatim, including the web's literal watt-as-kW power
/// read. Every label resolves through the i18n facade.
/// </summary>
public static class ChargingTelemetryProjection
{
    /// <summary>Segoe Fluent "Speed" (gauge) glyph — the web <c>Gauge</c> icon (header, current, phases, efficiency).</summary>
    public const string GaugeGlyph = "\uE950";

    /// <summary>Segoe Fluent "LightningBolt" glyph — the web <c>Zap</c> icon (voltage).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent "Battery10" glyph — the web <c>BatteryCharging</c> icon (power tile + compact hero).</summary>
    public const string BatteryChargingGlyph = "\uE83F";

    /// <summary>Segoe Fluent "PowerButton" glyph — the web <c>Plug</c> icon (the "Not currently charging" surface).</summary>
    public const string PlugGlyph = "\uE7E8";

    /// <summary>The DC fast-charger voltage threshold (web <c>voltage &gt; 300</c>).</summary>
    public const double DcVoltageThreshold = 300;

    /// <summary>The rolling power-history cap (web <c>MAX_POWER_HISTORY</c>).</summary>
    public const int MaxPowerHistory = 30;

    private const int VoltagePrecision = 0;
    private const int CurrentPrecision = 0;
    private const int PowerPrecision = 1;
    private const int PhasesPrecision = 0;
    private const int EfficiencyPrecision = 0;

    /// <summary>The em dash the web renders for a zero/absent phase count (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project <paramref name="snapshot"/> + <paramref name="powerHistory"/> for <paramref name="size"/> using the localizer for every label.</summary>
    public static ChargingTelemetryDisplay Project(
        ChargingTelemetrySnapshot snapshot,
        IReadOnlyList<double> powerHistory,
        ChargingTelemetrySize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(powerHistory);
        ArgumentNullException.ThrowIfNull(localizer);

        var reading = snapshot.Reading;
        bool isCharging = reading.IsCharging;
        bool isWide = size.IsWide;

        // Web parity: the same `voltage` / `current` / `power` / `phases` reads the component derives.
        double voltage = Safe(reading.ChargerVoltage);
        double current = Safe(reading.ChargerActualCurrent);
        double power = Safe(reading.ChargerPowerW);
        double phases = Safe(reading.ChargerPhases);

        string? chargerType = DeriveChargerType(isCharging, voltage);
        double? efficiency = DeriveEfficiency(isCharging, reading, voltage, phases, power);

        var stats = BuildStats(localizer, isCharging, isWide, voltage, current, power, phases, efficiency);

        string powerText = FormatPower(power);
        string voltageCurrentText = string.Create(
            CultureInfo.InvariantCulture,
            $"{ScalarFormatters.FormatNumber(voltage, VoltagePrecision)}V \u00b7 {ScalarFormatters.FormatNumber(current, CurrentPrecision)}A");

        string chargerWord = localizer.GetString("widget.chargingTelemetry.charger", "Charger");
        string? badgeText = chargerType is null ? null : $"{chargerType} {chargerWord}";
        StatusKind badgeStatus = chargerType == "DC" ? StatusKind.Warning : StatusKind.Neutral;

        var history = powerHistory.Count == 0 ? Array.Empty<double>() : powerHistory.ToArray();
        bool showSparkline = isWide && history.Length > 1;

        string notCharging = localizer.GetString("widget.chargingTelemetry.notCharging", "Not currently charging");
        string title = localizer.GetString("widget.chargingTelemetry.title", "Charging Telemetry");
        string chargingName = $"{title}, {powerText}, {voltageCurrentText}";
        string compactName = $"{powerText}, {voltageCurrentText}";

        return new ChargingTelemetryDisplay(
            IsCharging: isCharging,
            IsCompact: size.IsCompact,
            IsWide: isWide,
            PowerText: powerText,
            VoltageCurrentText: voltageCurrentText,
            Stats: stats,
            StatColumns: isWide ? 4 : 2,
            ChargerType: chargerType,
            ChargerBadgeText: badgeText,
            ChargerBadgeStatus: badgeStatus,
            PowerHistory: history,
            ShowSparkline: showSparkline,
            NotChargingText: notCharging,
            ChargingAutomationName: chargingName,
            CompactAutomationName: compactName);
    }

    /// <summary>
    /// Derive the charger type the way the web <c>chargerType</c> memo does: <see langword="null"/> when not
    /// charging, "DC" above the <see cref="DcVoltageThreshold"/> volt threshold, otherwise "AC".
    /// </summary>
    public static string? DeriveChargerType(bool isCharging, double voltage)
    {
        if (!isCharging)
        {
            return null;
        }

        return voltage > DcVoltageThreshold ? "DC" : "AC";
    }

    /// <summary>
    /// Derive the charging efficiency the way the web <c>efficiency</c> memo does: <see langword="null"/> when
    /// not charging, when the pilot current or voltage is non-positive, or when the theoretical pilot capacity
    /// is non-positive; otherwise <c>min(100, (power / theoreticalPower) * 100)</c>. The formula — including its
    /// <c>(pilot · voltage · phases) / 1000</c> kW capacity and its literal watt-as-power numerator — is
    /// reproduced verbatim so the native readout matches the web's observable output.
    /// </summary>
    public static double? DeriveEfficiency(bool isCharging, ChargingTelemetryReading reading, double voltage, double phases, double power)
    {
        ArgumentNullException.ThrowIfNull(reading);
        if (!isCharging)
        {
            return null;
        }

        double pilot = Safe(reading.ChargerPilotCurrent);
        if (pilot <= 0 || voltage <= 0)
        {
            return null;
        }

        double theoreticalPower = pilot * voltage * (phases > 0 ? phases : 1) / 1000.0;
        if (theoreticalPower <= 0)
        {
            return null;
        }

        return Math.Min(100, power / theoreticalPower * 100);
    }

    /// <summary>Format the power readout the way the web does — <c>fmtNumber(power, 1)</c> followed by " kW".</summary>
    public static string FormatPower(double power) =>
        ScalarFormatters.FormatNumber(Safe(power), PowerPrecision) + " kW";

    private static IReadOnlyList<ChargingTelemetryStat> BuildStats(
        ILocalizer localizer,
        bool isCharging,
        bool isWide,
        double voltage,
        double current,
        double power,
        double phases,
        double? efficiency)
    {
        // Web parity: coreStats is [] unless charging.
        if (!isCharging)
        {
            return Array.Empty<ChargingTelemetryStat>();
        }

        var stats = new List<ChargingTelemetryStat>(5)
        {
            Stat(ZapGlyph, localizer.GetString("widget.chargingTelemetry.voltage", "Voltage"),
                ScalarFormatters.FormatNumber(voltage, VoltagePrecision), "V", emphasize: false),
            Stat(GaugeGlyph, localizer.GetString("widget.chargingTelemetry.current", "Current"),
                ScalarFormatters.FormatNumber(current, CurrentPrecision), "A", emphasize: false),
            Stat(BatteryChargingGlyph, localizer.GetString("widget.chargingTelemetry.power", "Power"),
                ScalarFormatters.FormatNumber(power, PowerPrecision), "kW", emphasize: true),
            Stat(GaugeGlyph, localizer.GetString("widget.chargingTelemetry.phases", "Phases"),
                phases > 0 ? ScalarFormatters.FormatNumber(phases, PhasesPrecision) : EmDash, string.Empty, emphasize: false),
        };

        // Web parity: wideStats only when wide AND efficiency is computable.
        if (isWide && efficiency is { } eff)
        {
            stats.Add(Stat(GaugeGlyph, localizer.GetString("widget.chargingTelemetry.efficiency", "Efficiency"),
                ScalarFormatters.FormatNumber(eff, EfficiencyPrecision), "%", emphasize: false));
        }

        return stats;
    }

    private static ChargingTelemetryStat Stat(string glyph, string label, string value, string unit, bool emphasize)
    {
        string automation = string.IsNullOrEmpty(unit) ? $"{label} {value}" : $"{label} {value} {unit}";
        return new ChargingTelemetryStat(glyph, label, value, unit, emphasize, automation);
    }

    private static double Safe(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> state emissions onto parsed
/// <c>RepositoryResult&lt;ChargingTelemetrySnapshot&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline). A successful emission whose body carries no telemetry row collapses
/// to <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web query resolving to
/// <c>data == null</c>. Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ChargingTelemetryResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s telemetry payload (when present) and preserve the status.</summary>
    public static RepositoryResult<ChargingTelemetrySnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        ChargingTelemetrySnapshot? Combine() =>
            raw.HasValue && ChargingTelemetryReading.FromResponse(raw.Value) is { } reading
                ? new ChargingTelemetrySnapshot(reading)
                : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ChargingTelemetrySnapshot>.Loading(),
            LoadStatus.Cached => Combine() is { } cached
                ? RepositoryResult<ChargingTelemetrySnapshot>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<ChargingTelemetrySnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Combine() is { } refreshing
                ? RepositoryResult<ChargingTelemetrySnapshot>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<ChargingTelemetrySnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Combine() is { } loaded
                ? RepositoryResult<ChargingTelemetrySnapshot>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<ChargingTelemetrySnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<ChargingTelemetrySnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Combine() is { } offline
                ? RepositoryResult<ChargingTelemetrySnapshot>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<ChargingTelemetrySnapshot>.Empty(raw.FetchedAt),
            _ => RepositoryResult<ChargingTelemetrySnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
