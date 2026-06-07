using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="BatteryRadialGaugeViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>BatteryRadialGaugeWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/BatteryRadialGaugeWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>{state ? … : &lt;EmptyState&gt;}</c>
/// gate (no resolved vehicle / no usable state in the response) — the "No battery data" surface.
/// </summary>
public enum BatteryRadialGaugeState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a vehicle state to render the gauge for.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the response carried no state — render the "No battery data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the gauge plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the gauge plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The three fields the radial gauge reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of
/// the web <c>VehicleState</c> slice the widget consumes (<c>state.battery_level</c>, <c>state.is_charging</c>
/// and the optional extended <c>state.charge_limit_soc</c>, web/src/api/types). <see cref="BatteryLevel"/> is a
/// state-of-charge percent (0–100, already unit-free), <see cref="IsCharging"/> drives the "⚡ Charging"
/// indicator, and <see cref="ChargeLimitSoc"/> (when present on the extended payload) drives the thin charge
/// limit ring overlay and the "Limit" stat. A <see langword="null"/> parse result models the web
/// <c>stateData?.state</c> being undefined (no state in the response → the empty surface); a
/// <see langword="null"/> <see cref="ChargeLimitSoc"/> models the web <c>charge_limit_soc</c> being absent
/// (no limit ring, no "Limit" stat). Parsing is null-tolerant so a partial body never throws.
/// </summary>
public sealed record RadialGaugeVehicleState(double BatteryLevel, bool IsCharging, double? ChargeLimitSoc)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the gauge slice, mirroring the
    /// normalisation in the web <c>useVehicleState</c> hook: prefer the canonical <c>state</c> object (the
    /// one carrying <c>vehicle_id</c>), otherwise fall back to a plain <c>state</c> object, otherwise
    /// reconstruct from <c>position.battery_level</c> + top-level <c>is_charging</c> when a
    /// <c>vehicle</c>/<c>position</c> is present. Returns <see langword="null"/> when none of those yield a
    /// state — the native analogue of the web <c>state</c> being undefined.
    /// </summary>
    public static RadialGaugeVehicleState? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        // Web parity (primary): res.state with a vehicle_id is the canonical SignalStore state object.
        if (Object(root, "state") is { } state && Has(state, "vehicle_id"))
        {
            return FromStateObject(state);
        }

        var vehicle = Object(root, "vehicle");
        var position = Object(root, "position");
        if (vehicle is null && position is null)
        {
            // Web parity: `if (!v && !p) return { state: res.state }` — a plain state object is still usable,
            // otherwise there is no state and the widget shows its empty surface.
            return Object(root, "state") is { } plain ? FromStateObject(plain) : null;
        }

        // Web parity (fallback): build the state from the position snapshot + the top-level charging flag.
        // The web reconstruction carries no charge_limit_soc, so the limit ring/stat stays absent here.
        return new RadialGaugeVehicleState(
            BatteryLevel: position is { } p ? ReadDouble(p, "battery_level") ?? 0 : 0,
            IsCharging: ReadBool(root, "is_charging"),
            ChargeLimitSoc: null);
    }

    private static RadialGaugeVehicleState FromStateObject(JsonElement state) => new(
        BatteryLevel: ReadDouble(state, "battery_level") ?? 0,
        IsCharging: ReadBool(state, "is_charging"),
        ChargeLimitSoc: ReadDouble(state, "charge_limit_soc"));

    private static JsonElement? Object(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object &&
        parent.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.Object
            ? value
            : null;

    private static bool Has(JsonElement obj, string name) => obj.TryGetProperty(name, out _);

    private static double? ReadDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static bool ReadBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when v.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String => bool.TryParse(v.GetString(), out var b) && b,
            _ => false,
        };
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isLarge</c> flags and the <c>WidgetGaugeHero</c> diameter logic in
/// web/src/features/dashboard/widgets/BatteryRadialGaugeWidget.tsx.
/// </summary>
public readonly record struct BatteryRadialGaugeSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (1×2).</summary>
    public static BatteryRadialGaugeSize Default => new(1, 2);

    /// <summary>True at exactly one column and one row (web <c>isCompact = cols === 1 &amp;&amp; rows === 1</c>).</summary>
    public bool IsCompact => Cols == 1 && Rows == 1;

    /// <summary>True at two-plus columns and rows (web <c>isLarge = cols &gt;= 2 &amp;&amp; rows &gt;= 2</c>) — shows the stats row.</summary>
    public bool IsLarge => Cols >= 2 && Rows >= 2;

    /// <summary>Gauge diameter in pixels (web <c>WidgetGaugeHero size = compact ? 70 : 100</c>).</summary>
    public double GaugeDiameter => IsCompact ? 70 : 100;
}

/// <summary>
/// One render-ready tile in the gauge's stats row — the native analogue of a web <c>GaugeHeroStat</c>
/// (web/src/features/dashboard/widgets/shared/WidgetGaugeHero.tsx). The value is pre-formatted so the view is a
/// thin renderer; <see cref="AutomationName"/> carries the Narrator label combining the label, value and unit.
/// </summary>
public sealed record RadialGaugeStat(string Label, string ValueText, string Unit, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the radial gauge for one footprint — the native analogue of
/// everything the web component computes before returning JSX (the clamped value, the threshold colour, the
/// formatted value text, the optional charge-limit ring fraction, the stats row, and the charging affordance).
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record BatteryRadialGaugeDisplay(
    double Value,
    double Max,
    string ValueText,
    string Unit,
    string GaugeLabel,
    StatusKind Status,
    bool IsCharging,
    bool ShowCharging,
    string ChargingText,
    double? ChargeLimitSoc,
    bool ShowChargeLimitRing,
    double ChargeLimitFraction,
    IReadOnlyList<RadialGaugeStat> Stats,
    bool ShowStats,
    bool IsCompact,
    double GaugeDiameter,
    string GaugeAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="RadialGaugeVehicleState"/> to the display model — the native port of
/// the <c>getBatteryColor</c> helper, the <c>ChargeLimitRing</c> geometry and the <c>WidgetGaugeHero</c>
/// composition in web/src/features/dashboard/widgets/BatteryRadialGaugeWidget.tsx. The state-of-charge is
/// already unit-free (a percent), so this only clamps, formats and colours; every label resolves through the
/// i18n facade.
/// </summary>
public static class BatteryRadialGaugeProjection
{
    /// <summary>Segoe Fluent "Battery10" glyph for the surface title icon + empty state (web <c>Battery</c> icon).</summary>
    public const string HeaderGlyph = "\uE83F";

    /// <summary>The gauge maximum (web <c>max={100}</c>).</summary>
    public const double MaxPercent = 100;

    /// <summary>Above this state-of-charge the gauge is healthy/green (web <c>level &gt; 50</c>).</summary>
    public const double HealthyThresholdPercent = 50;

    /// <summary>Above this state-of-charge the gauge is a warning/amber (web <c>level &gt; 20</c>).</summary>
    public const double WarningThresholdPercent = 20;

    /// <summary>The lightning prefix the web charging indicator renders (web <c>⚡</c>).</summary>
    public const string ChargingBolt = "\u26A1";

    /// <summary>
    /// Map a state-of-charge to the semantic status the gauge arc is tinted with (web <c>getBatteryColor</c>):
    /// &gt;50% → <see cref="StatusKind.Success"/> (green), &gt;20% → <see cref="StatusKind.Warning"/> (amber),
    /// otherwise <see cref="StatusKind.Danger"/> (red). The web's no-state grey is never reached here because
    /// the gauge is only projected when a state is present.
    /// </summary>
    public static StatusKind StatusFor(double batteryLevel)
    {
        if (batteryLevel > HealthyThresholdPercent)
        {
            return StatusKind.Success;
        }

        return batteryLevel > WarningThresholdPercent ? StatusKind.Warning : StatusKind.Danger;
    }

    /// <summary>Project <paramref name="state"/> for <paramref name="size"/> using the localizer for every label.</summary>
    public static BatteryRadialGaugeDisplay Project(
        RadialGaugeVehicleState state,
        BatteryRadialGaugeSize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(localizer);

        double clamped = Math.Clamp(SafeNumber(state.BatteryLevel), 0, MaxPercent);
        const string unit = "%";
        string valueText = FormatValue(clamped);
        string battery = localizer.GetString("widget.battery", "Battery");

        // Web parity: RadialGauge label is `isCompact ? '' : t('widget.battery')` — no caption when compact.
        string gaugeLabel = size.IsCompact ? string.Empty : battery;

        // Web parity: charge_limit_soc drives the thin overlay ring + the "Limit" stat. The overlay is passed
        // as WidgetGaugeHero children, so it only renders when !compact; the stats are passed only when isLarge.
        double? limit = state.ChargeLimitSoc;
        bool hasLimit = limit.HasValue;
        double clampedLimit = hasLimit ? Math.Clamp(SafeNumber(limit!.Value), 0, MaxPercent) : 0;

        var stats = new List<RadialGaugeStat>(2);
        string levelLabel = localizer.GetString("widget.level", "Level");
        stats.Add(new RadialGaugeStat(levelLabel, valueText, unit, $"{levelLabel} {valueText}{unit}"));
        if (hasLimit)
        {
            string limitLabel = localizer.GetString("widget.chargeLimit", "Limit");
            string limitText = FormatValue(clampedLimit);
            stats.Add(new RadialGaugeStat(limitLabel, limitText, unit, $"{limitLabel} {limitText}{unit}"));
        }

        return new BatteryRadialGaugeDisplay(
            Value: clamped,
            Max: MaxPercent,
            ValueText: valueText,
            Unit: unit,
            GaugeLabel: gaugeLabel,
            Status: StatusFor(clamped),
            IsCharging: state.IsCharging,
            ShowCharging: state.IsCharging,
            ChargingText: localizer.GetString("widget.charging", "Charging"),
            ChargeLimitSoc: limit,
            ShowChargeLimitRing: hasLimit && !size.IsCompact,
            ChargeLimitFraction: clampedLimit / MaxPercent,
            Stats: stats,
            ShowStats: size.IsLarge,
            IsCompact: size.IsCompact,
            GaugeDiameter: size.GaugeDiameter,
            GaugeAutomationName: $"{battery} {valueText}{unit}");
    }

    /// <summary>
    /// Format the gauge value exactly as the web <c>RadialGauge</c> does: integers render with no fraction
    /// digits and non-integers with the global precision (2), using en-US grouping (web <c>fmtNumber</c>).
    /// </summary>
    public static string FormatValue(double value)
    {
        double safe = SafeNumber(value);
        int decimals = safe == Math.Floor(safe) ? 0 : 2;
        return ScalarFormatters.FormatNumber(safe, decimals);
    }

    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;RadialGaugeVehicleState&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline). A successful emission whose body carries no usable state collapses
/// to <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{state ? gauge : empty}</c>
/// gate. Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class BatteryRadialGaugeResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<RadialGaugeVehicleState> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        RadialGaugeVehicleState? Parse() => raw.HasValue ? RadialGaugeVehicleState.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<RadialGaugeVehicleState>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<RadialGaugeVehicleState>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<RadialGaugeVehicleState>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<RadialGaugeVehicleState>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<RadialGaugeVehicleState>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<RadialGaugeVehicleState>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<RadialGaugeVehicleState>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<RadialGaugeVehicleState>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<RadialGaugeVehicleState>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<RadialGaugeVehicleState>.Empty(raw.FetchedAt),
            _ => RepositoryResult<RadialGaugeVehicleState>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
