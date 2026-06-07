using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="BatteryGaugeViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>BatteryGaugeWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/BatteryGaugeWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>{state ? … : &lt;EmptyState&gt;}</c>
/// gate (no resolved vehicle / no usable state in the response) — the "No battery data" surface.
/// </summary>
public enum BatteryGaugeState
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
/// The two fields the battery gauge reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of
/// the web <c>VehicleState</c> slice the widget consumes (<c>state.battery_level</c> + <c>state.is_charging</c>,
/// web/src/api/types). <see cref="BatteryLevel"/> is a state-of-charge percent (0–100, already unit-free) and
/// <see cref="IsCharging"/> drives the "⚡ Charging" indicator. A <see langword="null"/> parse result models
/// the web <c>stateData?.state</c> being undefined (no state in the response → the empty surface). Parsing is
/// null-tolerant so a partial body never throws.
/// </summary>
public sealed record VehicleGaugeState(double BatteryLevel, bool IsCharging)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the gauge slice, mirroring the
    /// normalisation in the web <c>useVehicleState</c> hook: prefer the canonical <c>state</c> object (the
    /// one carrying <c>vehicle_id</c>), otherwise fall back to a plain <c>state</c> object, otherwise
    /// reconstruct from <c>position.battery_level</c> + top-level <c>is_charging</c> when a
    /// <c>vehicle</c>/<c>position</c> is present. Returns <see langword="null"/> when none of those yield a
    /// state — the native analogue of the web <c>state</c> being undefined.
    /// </summary>
    public static VehicleGaugeState? FromResponse(JsonElement root)
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
        return new VehicleGaugeState(
            BatteryLevel: position is { } p ? ReadDouble(p, "battery_level") ?? 0 : 0,
            IsCharging: ReadBool(root, "is_charging"));
    }

    private static VehicleGaugeState FromStateObject(JsonElement state) => new(
        BatteryLevel: ReadDouble(state, "battery_level") ?? 0,
        IsCharging: ReadBool(state, "is_charging"));

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
/// <c>isCompact</c> flag and the <c>WidgetGaugeHero</c> diameter logic in
/// web/src/features/dashboard/widgets/BatteryGaugeWidget.tsx.
/// </summary>
public readonly record struct BatteryGaugeSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (1×2).</summary>
    public static BatteryGaugeSize Default => new(1, 2);

    /// <summary>True at exactly one column and one row (web <c>isCompact = size.cols === 1 &amp;&amp; size.rows === 1</c>).</summary>
    public bool IsCompact => Cols == 1 && Rows == 1;

    /// <summary>Gauge diameter in pixels (web <c>WidgetGaugeHero size = compact ? 70 : 100</c>).</summary>
    public double GaugeDiameter => IsCompact ? 70 : 100;
}

/// <summary>
/// The fully projected, render-ready view of the gauge for one footprint — the native analogue of everything
/// the web component computes before returning JSX (the clamped value, the threshold colour, the formatted
/// value text, and the charging affordance). Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record BatteryGaugeDisplay(
    double Value,
    double Max,
    string ValueText,
    string Unit,
    string Label,
    StatusKind Status,
    bool IsCharging,
    bool ShowCharging,
    string ChargingText,
    bool IsCompact,
    double GaugeDiameter,
    string GaugeAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="VehicleGaugeState"/> to the display model — the native port of the
/// <c>batteryColor</c> helper and the <c>WidgetGaugeHero</c> composition in
/// web/src/features/dashboard/widgets/BatteryGaugeWidget.tsx. The state-of-charge is already unit-free (a
/// percent), so this only clamps, formats and colours; every label resolves through the i18n facade.
/// </summary>
public static class BatteryGaugeProjection
{
    /// <summary>Segoe Fluent "Battery10" glyph for the surface empty state (web <c>Battery</c> icon).</summary>
    public const string HeaderGlyph = "\uE83F";

    /// <summary>The gauge maximum (web <c>max={100}</c>).</summary>
    public const double MaxPercent = 100;

    /// <summary>Above this state-of-charge the gauge is healthy/green (web <c>battery_level &gt; 50</c>).</summary>
    public const double HealthyThresholdPercent = 50;

    /// <summary>Above this state-of-charge the gauge is a warning/amber (web <c>battery_level &gt; 20</c>).</summary>
    public const double WarningThresholdPercent = 20;

    /// <summary>The lightning prefix the web charging indicator renders (web <c>⚡</c>).</summary>
    public const string ChargingBolt = "\u26A1";

    /// <summary>
    /// Map a state-of-charge to the semantic status the gauge arc is tinted with (web <c>batteryColor</c>):
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
    public static BatteryGaugeDisplay Project(VehicleGaugeState state, BatteryGaugeSize size, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(localizer);

        double clamped = Math.Clamp(SafeNumber(state.BatteryLevel), 0, MaxPercent);
        string label = localizer.GetString("widget.battery", "Battery");
        const string unit = "%";
        string valueText = FormatValue(clamped);
        bool showCharging = state.IsCharging && !size.IsCompact;

        return new BatteryGaugeDisplay(
            Value: clamped,
            Max: MaxPercent,
            ValueText: valueText,
            Unit: unit,
            Label: label,
            Status: StatusFor(clamped),
            IsCharging: state.IsCharging,
            ShowCharging: showCharging,
            ChargingText: localizer.GetString("widget.charging", "Charging"),
            IsCompact: size.IsCompact,
            GaugeDiameter: size.GaugeDiameter,
            GaugeAutomationName: $"{label} {valueText}{unit}");
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
/// <c>RepositoryResult&lt;VehicleGaugeState&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline). A successful emission whose body carries no usable state collapses
/// to <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{state ? gauge : empty}</c>
/// gate. Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class BatteryGaugeResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<VehicleGaugeState> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        VehicleGaugeState? Parse() => raw.HasValue ? VehicleGaugeState.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<VehicleGaugeState>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<VehicleGaugeState>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<VehicleGaugeState>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<VehicleGaugeState>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<VehicleGaugeState>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<VehicleGaugeState>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<VehicleGaugeState>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<VehicleGaugeState>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<VehicleGaugeState>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<VehicleGaugeState>.Empty(raw.FetchedAt),
            _ => RepositoryResult<VehicleGaugeState>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
