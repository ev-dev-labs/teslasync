using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="TemperatureMetricCardsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. The web component
/// (web/src/features/driving/components/drivetrain-health/TemperatureMetricCards.tsx) is a presentational grid
/// that receives its <c>sensors</c>, <c>overallHealth</c>, <c>healthScore</c> and <c>peakPower</c> as props
/// (only <c>useTranslation</c> + <c>useUnits</c> are read directly); the native feature-view owns the
/// drivetrain-health read (plus the recent-drives read the Peak Power tile aggregates) so it renders the full
/// state matrix the P2 contract mandates. Every branch maps onto a visible surface — none is ever hidden.
/// <see cref="Empty"/> mirrors the web Drivetrain-Health page's <c>{health ? … : &lt;EmptyState/&gt;}</c> gate
/// (no drivetrain-health snapshot) in addition to an empty HTTP body.
/// </summary>
public enum TemperatureMetricCardsState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton tiles.</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) — render the six metric tiles.</summary>
    Loaded,

    /// <summary>No drivetrain-health snapshot resolved — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Overall drivetrain condition — the native port of the web <c>HealthStatus</c> union
/// (web/src/features/driving/components/drivetrain-health/constants.ts: <c>'good' | 'warning' | 'critical'</c>).
/// Drives the Health Score tile value and accent.
/// </summary>
public enum DrivetrainHealthStatus
{
    /// <summary>Healthy (web <c>'good'</c>) — green accent, 95% score.</summary>
    Good,

    /// <summary>Elevated (web <c>'warning'</c>) — amber accent, 60% score.</summary>
    Warning,

    /// <summary>Critical (web <c>'critical'</c>) — red accent, 25% score.</summary>
    Critical,
}

/// <summary>
/// One drivetrain-health snapshot the six tiles consume — the native projection of the
/// <c>/drivetrain/health</c> body (the web <c>DrivetrainHealthData</c> in web/src/types/driving.ts) combined
/// with the <see cref="PeakPowerKw"/> the web page derives from the recent-drives list. The four motor/battery
/// temperatures are SI Celsius (nullable; a missing sensor renders the web "No data" tile), the
/// <see cref="OverallHealth"/> seeds the Health Score tile, and <see cref="PeakPowerKw"/> is the maximum recent
/// drive power in kW. Parsing is null-tolerant so a partial body never throws. Pure data — no WinUI types.
/// </summary>
/// <param name="FrontMotorTempC">Front-motor temperature in °C (web <c>frontMotorTempC</c>); null when absent.</param>
/// <param name="RearMotorTempC">Rear-motor temperature in °C (web <c>rearMotorTempC</c>); null when absent.</param>
/// <param name="InverterTempC">Inverter temperature in °C (web <c>inverterTempC</c>); null when absent.</param>
/// <param name="BatteryTempC">Battery temperature in °C (web <c>batteryTempC</c>); null when absent.</param>
/// <param name="MotorStatus">Motor status label (web <c>motorStatus</c>); empty when absent.</param>
/// <param name="OverallHealth">Overall condition (web <c>overallHealth ?? 'good'</c>).</param>
/// <param name="PeakPowerKw">Peak recent-drive power in kW (web <c>peakPower</c>); 0 when none.</param>
public sealed record TemperatureMetricCardsSnapshot(
    double? FrontMotorTempC,
    double? RearMotorTempC,
    double? InverterTempC,
    double? BatteryTempC,
    string MotorStatus,
    DrivetrainHealthStatus OverallHealth,
    double PeakPowerKw)
{
    /// <summary>
    /// Project a <c>/drivetrain/health</c> JSON object into a tolerant snapshot, injecting the separately
    /// resolved <paramref name="peakPowerKw"/>. Snake_case keys match the Go handler's wire shape exactly
    /// (the native contract client does not camelCase).
    /// </summary>
    /// <param name="obj">The drivetrain-health JSON object.</param>
    /// <param name="peakPowerKw">The peak recent-drive power in kW (resolved from the drives list).</param>
    /// <returns>A tolerant snapshot.</returns>
    public static TemperatureMetricCardsSnapshot FromJson(JsonElement obj, double peakPowerKw)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return new TemperatureMetricCardsSnapshot(
                null, null, null, null, string.Empty, DrivetrainHealthStatus.Good, NonNegative(peakPowerKw));
        }

        return new TemperatureMetricCardsSnapshot(
            FrontMotorTempC: GetDouble(obj, "front_motor_temp_c"),
            RearMotorTempC: GetDouble(obj, "rear_motor_temp_c"),
            InverterTempC: GetDouble(obj, "inverter_temp_c"),
            BatteryTempC: GetDouble(obj, "battery_temp_c"),
            MotorStatus: GetString(obj, "motor_status") ?? string.Empty,
            OverallHealth: ParseHealth(GetString(obj, "overall_health")),
            PeakPowerKw: NonNegative(peakPowerKw));
    }

    /// <summary>Parse the web <c>HealthStatus</c> string, defaulting to <see cref="DrivetrainHealthStatus.Good"/> (web <c>?? 'good'</c>).</summary>
    /// <param name="value">The <c>overall_health</c> string, or null.</param>
    /// <returns>The parsed status.</returns>
    public static DrivetrainHealthStatus ParseHealth(string? value) => value switch
    {
        "critical" => DrivetrainHealthStatus.Critical,
        "warning" => DrivetrainHealthStatus.Warning,
        _ => DrivetrainHealthStatus.Good,
    };

    private static double NonNegative(double value) =>
        double.IsFinite(value) && value > 0 ? value : 0;

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

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>
/// The fixed per-status drivetrain scores the Health Score tile renders — the native port of the web
/// <c>HEALTH_SCORE</c> map (web/src/features/driving/components/drivetrain-health/constants.ts:
/// good = 95, warning = 60, critical = 25). Pure data so the mapping is unit-tested without a UI host.
/// </summary>
public static class DrivetrainHealthScore
{
    /// <summary>Score for a healthy drivetrain (web <c>HEALTH_SCORE.good</c>).</summary>
    public const int Good = 95;

    /// <summary>Score for an elevated drivetrain (web <c>HEALTH_SCORE.warning</c>).</summary>
    public const int Warning = 60;

    /// <summary>Score for a critical drivetrain (web <c>HEALTH_SCORE.critical</c>).</summary>
    public const int Critical = 25;

    /// <summary>Resolve the score for <paramref name="status"/>.</summary>
    /// <param name="status">The overall drivetrain condition.</param>
    /// <returns>The percent score (0..100).</returns>
    public static int For(DrivetrainHealthStatus status) => status switch
    {
        DrivetrainHealthStatus.Warning => Warning,
        DrivetrainHealthStatus.Critical => Critical,
        _ => Good,
    };
}

/// <summary>
/// Pure aggregation of the Peak Power tile value from the recent-drives list — the native port of the web
/// Drivetrain-Health page's <c>peakPower</c> <c>useMemo</c>
/// (web/src/features/driving/pages/DrivetrainHealthPage.tsx): the drives are filtered to the default
/// last-30-day window, sorted by start time, capped at the 30 most-recent points, each mapped to
/// <c>avg_power_w / 1000</c> (kW, missing power → 0), and the maximum is taken (no drives → 0). Snake_case
/// keys match the Go drives wire shape. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class DrivetrainPeakPower
{
    /// <summary>The default look-back window in days (web <c>defaultStartDate = today − 30 days</c>).</summary>
    public const int WindowDays = 30;

    /// <summary>The maximum number of most-recent points retained (web <c>chartData.slice(-30)</c>).</summary>
    public const int MaxPoints = 30;

    /// <summary>Watts per kilowatt — the divisor turning SI watts into the kW the tile shows.</summary>
    public const double WattsPerKilowatt = 1000.0;

    /// <summary>
    /// Compute the peak recent-drive power in kW from <paramref name="drives"/> relative to <paramref name="now"/>.
    /// Reproduces the web default-window filter (today − 30 days at 00:00 → today at 23:59:59), the ascending
    /// sort, the 30-point cap and the <c>avg_power_w / 1000</c> mapping verbatim.
    /// </summary>
    /// <param name="drives">The drives JSON array (newest-or-any order).</param>
    /// <param name="now">The clock used to derive the look-back window.</param>
    /// <returns>The peak power in kW, or 0 when no drive falls in the window.</returns>
    public static double FromDrives(JsonElement drives, DateTimeOffset now)
    {
        if (drives.ValueKind != JsonValueKind.Array)
        {
            return 0;
        }

        // web: startMs = new Date(`${startDate}T00:00:00`); endMs = new Date(`${endDate}T23:59:59`) where
        // startDate = today − 30 days and endDate = today (date-truncated in the user's local zone).
        var startBound = new DateTimeOffset(now.Date, now.Offset).AddDays(-WindowDays);
        var endBound = new DateTimeOffset(now.Date, now.Offset).AddDays(1).AddSeconds(-1);

        var window = new List<(DateTimeOffset Start, double PowerKw)>();
        foreach (var item in drives.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var start = GetDateTime(item, "start_ts");
            if (start is not { } ts || ts < startBound || ts > endBound)
            {
                continue;
            }

            double powerKw = (GetDouble(item, "avg_power_w") ?? 0) / WattsPerKilowatt;
            window.Add((ts, powerKw));
        }

        if (window.Count == 0)
        {
            return 0;
        }

        window.Sort(static (a, b) => a.Start.CompareTo(b.Start));
        int skip = Math.Max(0, window.Count - MaxPoints);

        double peak = 0;
        for (int i = skip; i < window.Count; i++)
        {
            peak = Math.Max(peak, window[i].PowerKw);
        }

        return peak;
    }

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

    private static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var ts)
            ? ts
            : null;
    }
}

/// <summary>
/// One projected, display-ready metric tile consumed by the WinUI view — the native analogue of a web
/// <c>&lt;MetricCard&gt;</c> instance. Holds the localized label, the already-formatted value, the formatted
/// subtitle, the resolved accent brush key (the native mapping of the web <c>color</c> glow), and a Narrator
/// automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted primary value.</param>
/// <param name="Subtitle">The pre-formatted caption line (empty when the web tile has none).</param>
/// <param name="AccentBrushKey">The token brush key tinting the accent rail.</param>
/// <param name="AutomationName">The Narrator name combining label, value and subtitle.</param>
public sealed record TemperatureMetricCard(
    string Label,
    string Value,
    string Subtitle,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the temperature-metric grid — the six tiles plus the
/// <see cref="HasData"/> gate. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when a drivetrain-health snapshot is present (web <c>health</c> truthy).</param>
/// <param name="Cards">The six metric tiles in web display order.</param>
public sealed record TemperatureMetricCardsDisplay(bool HasData, IReadOnlyList<TemperatureMetricCard> Cards)
{
    /// <summary>An empty projection (no tiles) — the projection fallback for an absent snapshot.</summary>
    public static TemperatureMetricCardsDisplay Empty { get; } = new(false, Array.Empty<TemperatureMetricCard>());
}

/// <summary>
/// Pure projection from a <see cref="TemperatureMetricCardsSnapshot"/> to the six display tiles — the native
/// port of the <c>&lt;MetricCard&gt;</c> composition in
/// web/src/features/driving/components/drivetrain-health/TemperatureMetricCards.tsx, with the temperature
/// formatting from <c>useUnits().formatTemperature</c>, the <c>tempNeonColor</c> / health colour logic from
/// the sibling <c>helpers.ts</c>, and the value/subtitle formatting from <c>fmtNumber</c>/<c>fmtInt</c>. Every
/// label resolves through the i18n facade; no WinUI types — unit-tested without a UI host.
/// </summary>
public static class TemperatureMetricCardsProjection
{
    /// <summary>Front-motor saturation temperature in °C (web sensor <c>maxTemp</c>).</summary>
    public const double FrontMotorMaxC = 150;

    /// <summary>Rear-motor saturation temperature in °C (web sensor <c>maxTemp</c>).</summary>
    public const double RearMotorMaxC = 150;

    /// <summary>Inverter saturation temperature in °C (web sensor <c>maxTemp</c>).</summary>
    public const double InverterMaxC = 120;

    /// <summary>Battery saturation temperature in °C (web sensor <c>maxTemp</c>).</summary>
    public const double BatteryMaxC = 60;

    /// <summary>Ratio at/above which a sensor turns red (web <c>tempNeonColor</c> ≥ 0.85).</summary>
    public const double CriticalRatio = 0.85;

    /// <summary>Ratio at/above which a sensor turns amber (web <c>tempNeonColor</c> ≥ 0.65).</summary>
    public const double WarningRatio = 0.65;

    /// <summary>The accent brush key for the Peak Power tile (web <c>color="purple"</c>).</summary>
    public const string PurpleBrushKey = "TsChartPowerBrush";

    /// <summary>The Segoe Fluent glyph for the empty / header surface (web lucide <c>Thermometer</c>).</summary>
    public const string ThermometerGlyph = "\uE9CA";

    /// <summary>
    /// Project <paramref name="snapshot"/> into the six metric tiles using the user's units. Tile order,
    /// labels, value precision, colours and subtitles mirror the web component exactly.
    /// </summary>
    /// <param name="snapshot">The drivetrain-health snapshot.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>The render-ready display model.</returns>
    public static TemperatureMetricCardsDisplay Project(
        TemperatureMetricCardsSnapshot snapshot,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string ofMax = localizer.GetString("drivetrain.ofMax", "of max");
        string noData = localizer.GetString("drivetrain.noData", "No data");

        var cards = new List<TemperatureMetricCard>(6)
        {
            SensorCard(
                localizer.GetString("drivetrain.frontMotor", "Front Motor"),
                snapshot.FrontMotorTempC, FrontMotorMaxC, units, ofMax, noData),
            SensorCard(
                localizer.GetString("drivetrain.rearMotor", "Rear Motor"),
                snapshot.RearMotorTempC, RearMotorMaxC, units, ofMax, noData),
            SensorCard(
                localizer.GetString("drivetrain.inverter", "Inverter"),
                snapshot.InverterTempC, InverterMaxC, units, ofMax, noData),
            SensorCard(
                localizer.GetString("drivetrain.battery", "Battery"),
                snapshot.BatteryTempC, BatteryMaxC, units, ofMax, noData),
            HealthScoreCard(snapshot.OverallHealth, localizer),
            PeakPowerCard(snapshot.PeakPowerKw, localizer),
        };

        return new TemperatureMetricCardsDisplay(true, cards);
    }

    /// <summary>
    /// The native port of the web <c>tempNeonColor</c> accent: a null reading and any reading below the warning
    /// ratio are green, ≥ 0.65 is amber and ≥ 0.85 is red.
    /// </summary>
    /// <param name="celsius">The SI Celsius reading, or null.</param>
    /// <param name="max">The sensor's saturation temperature.</param>
    /// <returns>The token brush key for the accent rail.</returns>
    public static string TempAccentBrushKey(double? celsius, double max)
    {
        if (celsius is not { } c || max <= 0)
        {
            return StatusResources.AccentBrushKey(StatusKind.Success);
        }

        double ratio = c / max;
        if (ratio >= CriticalRatio)
        {
            return StatusResources.AccentBrushKey(StatusKind.Danger);
        }

        if (ratio >= WarningRatio)
        {
            return StatusResources.AccentBrushKey(StatusKind.Warning);
        }

        return StatusResources.AccentBrushKey(StatusKind.Success);
    }

    /// <summary>
    /// The native port of the web Health Score <c>color</c>: good is green, warning amber, critical red.
    /// </summary>
    /// <param name="status">The overall drivetrain condition.</param>
    /// <returns>The token brush key for the accent rail.</returns>
    public static string HealthAccentBrushKey(DrivetrainHealthStatus status) => status switch
    {
        DrivetrainHealthStatus.Warning => StatusResources.AccentBrushKey(StatusKind.Warning),
        DrivetrainHealthStatus.Critical => StatusResources.AccentBrushKey(StatusKind.Danger),
        _ => StatusResources.AccentBrushKey(StatusKind.Success),
    };

    private static TemperatureMetricCard SensorCard(
        string label,
        double? celsius,
        double max,
        UnitPref units,
        string ofMax,
        string noData)
    {
        // web displayTemp: null → '—', else formatTemperature(celsius). FormatTemperature already returns the
        // em-dash empty fallback for a null/non-finite reading.
        string value = UnitFormatters.FormatTemperature(celsius, units);

        // web subtitle: value !== null ? `${fmtNumber((value / maxTemp) * 100, 0)}% of max` : 'No data'.
        string subtitle = celsius is { } c && max > 0
            ? string.Format(CultureInfo.CurrentCulture, "{0}% {1}", ScalarFormatters.FormatNumber(c / max * 100, 0), ofMax)
            : noData;

        return Card(label, value, subtitle, TempAccentBrushKey(celsius, max));
    }

    private static TemperatureMetricCard HealthScoreCard(DrivetrainHealthStatus status, ILocalizer localizer)
    {
        // web: value = `${healthScore}%`; no subtitle.
        string value = string.Format(
            CultureInfo.CurrentCulture, "{0}%", ScalarFormatters.FormatNumber(DrivetrainHealthScore.For(status), 0));
        return Card(
            localizer.GetString("drivetrain.healthScore", "Health Score"),
            value,
            string.Empty,
            HealthAccentBrushKey(status));
    }

    private static TemperatureMetricCard PeakPowerCard(double peakPowerKw, ILocalizer localizer)
    {
        // web: value = peakPower > 0 ? `${fmtInt(peakPower)} kW` : '—'; color purple; no subtitle.
        string value = peakPowerKw > 0
            ? string.Format(CultureInfo.CurrentCulture, "{0} kW", ScalarFormatters.FormatNumber(peakPowerKw, 0))
            : UnitFormatters.DefaultEmptyDisplay;
        return Card(
            localizer.GetString("drivetrain.peakPower", "Peak Power"),
            value,
            string.Empty,
            PurpleBrushKey);
    }

    private static TemperatureMetricCard Card(string label, string value, string subtitle, string accentBrushKey) =>
        new(label, value, subtitle, accentBrushKey, AutomationName(label, value, subtitle));

    private static string AutomationName(string label, string value, string subtitle) =>
        string.IsNullOrEmpty(subtitle)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, value, subtitle);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;TemperatureMetricCardsSnapshot&gt;</c>, injecting the separately resolved peak power
/// and preserving every freshness flag (cached / refreshing / stale / offline) so the view-model can render
/// the full state matrix. Kept pure so the parse-and-preserve contract is unit-tested without a network or
/// cache.
/// </summary>
public static class TemperatureMetricCardsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) with <paramref name="peakPowerKw"/> while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission carrying the drivetrain-health JSON.</param>
    /// <param name="peakPowerKw">The peak recent-drive power in kW resolved alongside.</param>
    /// <returns>The parsed emission with its status preserved.</returns>
    public static RepositoryResult<TemperatureMetricCardsSnapshot> Map(RepositoryResult<JsonElement> raw, double peakPowerKw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        TemperatureMetricCardsSnapshot Parse() => raw.HasValue
            ? TemperatureMetricCardsSnapshot.FromJson(raw.Value, peakPowerKw)
            : TemperatureMetricCardsSnapshot.FromJson(default, peakPowerKw);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<TemperatureMetricCardsSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<TemperatureMetricCardsSnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<TemperatureMetricCardsSnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<TemperatureMetricCardsSnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<TemperatureMetricCardsSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<TemperatureMetricCardsSnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<TemperatureMetricCardsSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Temperature Metric Cards surface — the native mirror of the web
/// component (web/src/features/driving/components/drivetrain-health/TemperatureMetricCards.tsx, rendered by the
/// Drivetrain-Health page). Centralises the stable id, category and diagnostics slug so the view and
/// view-model stay free of literal identifiers.
/// </summary>
public static class TemperatureMetricCardsRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "temperature-metric-cards";

    /// <summary>Surface category (matches the web driving feature).</summary>
    public const string Category = "driving";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "TemperatureMetricCards";
}

/// <summary>
/// PII-safe diagnostics for the Temperature Metric Cards surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a temperature value, power figure,
/// VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class TemperatureMetricCardsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional redacting diagnostics sink.</param>
    public TemperatureMetricCardsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TemperatureMetricCards</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TemperatureMetricCardsRegistration.Slug}");
    }
}
