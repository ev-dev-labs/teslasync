using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="VehicleHeroCardViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>VehicleHeroCardWidget</c>
/// renders through <c>WidgetShell</c> (web/src/features/dashboard/widgets/VehicleHeroCardWidget.tsx).
/// Every branch maps onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>{vehicle ? … : &lt;EmptyState&gt;}</c> gate (no resolved vehicle) — the "No vehicle data" surface.
/// A resolved vehicle whose state response carries no usable state still renders the card (with em-dash
/// metrics), so a stateless body is <em>not</em> <see cref="Empty"/>.
/// </summary>
public enum VehicleHeroCardState
{
    /// <summary>Initial state fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a vehicle to render the hero card for.</summary>
    Loaded,

    /// <summary>No vehicle resolved — render the "No vehicle data" empty surface (web <c>vehicle</c> falsy).</summary>
    Empty,

    /// <summary>The state request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the card plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the card plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The vehicle identity the hero card header shows — the native mirror of the web <c>Vehicle</c> slice the
/// component reads from <c>useVehicles</c> (<c>display_name</c>, <c>vin</c>, <c>model</c>, <c>trim_badging</c>;
/// web/src/types/vehicle). The card renders whenever an identity is resolved; the model/trim enrich the
/// header subtitle as the <c>GET /vehicles</c> list settles.
/// </summary>
public sealed record VehicleHeroIdentity(long Id, string DisplayName, string Vin, string Model, string TrimBadging)
{
    /// <summary>Header name — web <c>vehicle.display_name || vehicle.vin</c>.</summary>
    public string Name => !string.IsNullOrWhiteSpace(DisplayName) ? DisplayName.Trim() : (Vin ?? string.Empty).Trim();

    /// <summary>Header subtitle — web <c>{model}{trimBadging ? ` ${trimBadging}` : ''}</c>.</summary>
    public string Subtitle => string.IsNullOrWhiteSpace(TrimBadging)
        ? (Model ?? string.Empty).Trim()
        : $"{(Model ?? string.Empty).Trim()} {TrimBadging.Trim()}".Trim();

    /// <summary>
    /// Pick the identity from a <c>GET /vehicles</c> array, mirroring the web selection
    /// <c>vehicleId ? (vehicles.find(v =&gt; v.id === vehicleId) ?? vehicles[0]) : vehicles[0]</c>: prefer the
    /// entry whose <c>id</c> matches <paramref name="vehicleId"/>, otherwise the first entry. Returns
    /// <see langword="null"/> when the array carries no usable vehicle.
    /// </summary>
    public static VehicleHeroIdentity? FromVehiclesArray(JsonElement root, long vehicleId)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        JsonElement? first = null;
        foreach (var element in root.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            first ??= element;
            if (JsonRead.Long(element, "id") == vehicleId)
            {
                return FromVehicleObject(element, vehicleId);
            }
        }

        return first is { } fallback ? FromVehicleObject(fallback, vehicleId) : null;
    }

    private static VehicleHeroIdentity FromVehicleObject(JsonElement vehicle, long fallbackId) => new(
        Id: JsonRead.Long(vehicle, "id") ?? fallbackId,
        DisplayName: JsonRead.String(vehicle, "display_name") ?? string.Empty,
        Vin: JsonRead.String(vehicle, "vin") ?? string.Empty,
        Model: JsonRead.String(vehicle, "model") ?? string.Empty,
        TrimBadging: JsonRead.String(vehicle, "trim_badging") ?? string.Empty);
}

/// <summary>
/// The SI vehicle state the hero card reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of
/// the web <c>VehicleState</c> slice the widget consumes. Distances are metres (<c>ideal_range</c>),
/// temperatures °C (<c>inside_temp</c>/<c>outside_temp</c>), <c>charger_power</c> is kilowatts and
/// <c>battery_level</c> a state-of-charge percent. Every dynamic field is nullable and stays null when the
/// source did not report it, so the projection renders an explicit em dash rather than a fabricated value. A
/// <see langword="null"/> parse result models the web <c>stateData?.state</c> being undefined.
/// </summary>
public sealed record VehicleHeroStateReading(
    double? BatteryLevel,
    double? IdealRangeMeters,
    double? InsideTempCelsius,
    double? OutsideTempCelsius,
    bool IsCharging,
    double? ChargerPowerKw,
    string Status)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the hero slice, mirroring the
    /// normalisation in the web <c>useVehicleState</c> hook: prefer the canonical <c>state</c> object (the one
    /// carrying <c>vehicle_id</c>), otherwise a plain <c>state</c> object when no <c>vehicle</c>/<c>position</c>
    /// is present, otherwise reconstruct from the <c>position</c> snapshot plus the top-level charging fields.
    /// Returns <see langword="null"/> when none of those yield a state — the native analogue of the web
    /// <c>state</c> being undefined.
    /// </summary>
    public static VehicleHeroStateReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        // Web parity (primary): res.state with a vehicle_id is the canonical SignalStore state object.
        if (JsonRead.Object(root, "state") is { } canonical && JsonRead.Has(canonical, "vehicle_id"))
        {
            return FromStateObject(canonical);
        }

        var vehicle = JsonRead.Object(root, "vehicle");
        var position = JsonRead.Object(root, "position");
        if (vehicle is null && position is null)
        {
            // Web parity: `if (!v && !p) return { state: res.state }` — a plain state object is still usable.
            return JsonRead.Object(root, "state") is { } plain ? FromStateObject(plain) : null;
        }

        // Web parity (fallback): build the state from the position snapshot + the top-level charging flags.
        return new VehicleHeroStateReading(
            BatteryLevel: position is { } p ? JsonRead.Double(p, "battery_level") : null,
            IdealRangeMeters: position is { } pr ? JsonRead.Double(pr, "ideal_range") : null,
            InsideTempCelsius: position is { } pi ? JsonRead.Double(pi, "inside_temp") : null,
            OutsideTempCelsius: position is { } po ? JsonRead.Double(po, "outside_temp") : null,
            IsCharging: JsonRead.Bool(root, "is_charging"),
            ChargerPowerKw: JsonRead.Double(root, "charger_power"),
            Status: (vehicle is { } v ? JsonRead.String(v, "state") : null) ?? "offline");
    }

    private static VehicleHeroStateReading FromStateObject(JsonElement state) => new(
        BatteryLevel: JsonRead.Double(state, "battery_level"),
        IdealRangeMeters: JsonRead.Double(state, "ideal_range"),
        InsideTempCelsius: JsonRead.Double(state, "inside_temp"),
        OutsideTempCelsius: JsonRead.Double(state, "outside_temp"),
        IsCharging: JsonRead.Bool(state, "is_charging"),
        ChargerPowerKw: JsonRead.Double(state, "charger_power"),
        Status: JsonRead.String(state, "state") ?? "offline");
}

/// <summary>The resolved hero reading: the always-present identity plus the (nullable) live state.</summary>
public sealed record VehicleHeroReading(VehicleHeroIdentity Identity, VehicleHeroStateReading? State);

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c>/<c>isWide</c>/<c>isTall</c> flags in
/// web/src/features/dashboard/widgets/VehicleHeroCardWidget.tsx.
/// </summary>
public readonly record struct VehicleHeroCardSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static VehicleHeroCardSize Default => new(2, 2);

    /// <summary>True at one column and one row (web <c>size.cols &lt;= 1 &amp;&amp; size.rows &lt;= 1</c>).</summary>
    public bool IsCompact => Cols <= 1 && Rows <= 1;

    /// <summary>True at three or more columns (web <c>size.cols &gt;= 3</c>) — adds the Outside metric cell.</summary>
    public bool IsWide => Cols >= 3;

    /// <summary>True at two or more rows (web <c>size.rows &gt;= 2</c>) — adds the Outside/Ideal context row.</summary>
    public bool IsTall => Rows >= 2;
}

/// <summary>
/// The fully projected, render-ready view of the hero card for one footprint and unit preference — the native
/// analogue of everything the web component computes before returning JSX (the resolved name/subtitle, the
/// threshold battery colour, the unit-converted range/temperatures, the charging affordance, and the Narrator
/// names). Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record VehicleHeroCardDisplay(
    string Name,
    string Subtitle,
    string Status,
    string StatusAccentKey,
    bool HasBattery,
    double BatteryValue,
    string BatteryText,
    string BatteryAccentKey,
    string RangeText,
    string CabinText,
    string OutsideText,
    string IdealText,
    bool IsCharging,
    string ChargingText,
    string? ChargerText,
    string BatteryLabel,
    string RangeLabel,
    string CabinLabel,
    string OutsideLabel,
    string IdealLabel,
    bool IsCompact,
    bool IsWide,
    bool IsTall,
    string CompactAutomationName,
    string FullAutomationName);

/// <summary>
/// Pure projection from a <see cref="VehicleHeroReading"/> to the display model — the native port of the
/// <c>batteryColor</c> helper, the SI→display conversions and the Compact/Full composition in
/// web/src/features/dashboard/widgets/VehicleHeroCardWidget.tsx. Reads SI directly (metres, °C) and converts at
/// the display boundary via <see cref="UnitConverters"/> + <see cref="UnitPref"/>; every label resolves through
/// the i18n facade.
/// </summary>
public static class VehicleHeroCardProjection
{
    /// <summary>Em dash rendered for any unreported metric (web <c>—</c>).</summary>
    public const string Dash = "\u2014";

    /// <summary>Segoe Fluent "Car" glyph for the header + empty surface (web <c>Car</c> icon).</summary>
    public const string CarGlyph = "\uE804";

    /// <summary>Above this state-of-charge the battery reads healthy/green (web <c>battery_level &gt; 50</c>).</summary>
    public const double HealthyThresholdPercent = 50;

    /// <summary>Above this state-of-charge the battery reads warning/amber (web <c>battery_level &gt; 20</c>).</summary>
    public const double WarningThresholdPercent = 20;

    /// <summary>
    /// The token brush key for the battery value colour (web <c>batteryColor</c>): no state → muted,
    /// &gt;50% → success, &gt;20% → warning, otherwise danger. A state with a missing battery level falls to
    /// danger, matching the web's <c>undefined &gt; 50</c>/<c>undefined &gt; 20</c> both being false.
    /// </summary>
    public static string BatteryAccentKey(VehicleHeroStateReading? state)
    {
        if (state is null)
        {
            return "TsColorTextMutedBrush";
        }

        double level = state.BatteryLevel ?? double.NaN;
        if (level > HealthyThresholdPercent)
        {
            return StatusResources.AccentBrushKey(StatusKind.Success);
        }

        return level > WarningThresholdPercent
            ? StatusResources.AccentBrushKey(StatusKind.Warning)
            : StatusResources.AccentBrushKey(StatusKind.Danger);
    }

    /// <summary>
    /// The token brush key for the status-badge dot, mirroring the web <c>StatusBadge</c> badge-dot palette
    /// (<c>getStateDefinition('vehicle', status).badgeDot</c> in web/src/types/fsm/vehicle.ts): online green,
    /// driving blue, charging amber, parked cyan, updating indigo, asleep purple, offline red, otherwise grey.
    /// Mapped to the nearest themed design token so light/dark/high-contrast all stay legible.
    /// </summary>
    public static string StatusAccentKey(string? status) => Normalize(status) switch
    {
        "online" => StatusResources.AccentBrushKey(StatusKind.Success),   // web badgeDot bg-green-400
        "driving" => StatusResources.AccentBrushKey(StatusKind.Info),     // web badgeDot bg-blue-500
        "charging" => StatusResources.AccentBrushKey(StatusKind.Warning), // web badgeDot bg-yellow-400
        "parked" => StatusResources.AccentBrushKey(StatusKind.Info),      // web badgeDot bg-cyan-500
        "updating" => StatusResources.AccentBrushKey(StatusKind.Info),    // web badgeDot bg-indigo-500
        "asleep" => "TsChart07Brush",                                     // web badgeDot bg-purple-500
        "offline" => StatusResources.AccentBrushKey(StatusKind.Danger),   // web badgeDot bg-red-400
        _ => StatusResources.AccentBrushKey(StatusKind.Neutral),          // web default bg-gray-400
    };

    /// <summary>Project <paramref name="reading"/> for <paramref name="size"/> + <paramref name="units"/>.</summary>
    public static VehicleHeroCardDisplay Project(
        VehicleHeroReading reading,
        VehicleHeroCardSize size,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var identity = reading.Identity;
        var state = reading.State;

        // Web parity: state?.state ?? 'offline'.
        string status = string.IsNullOrWhiteSpace(state?.Status) ? "offline" : state!.Status.Trim();
        string distanceLabel = UnitLabels.Label(units.Distance);
        string tempLabel = UnitLabels.Label(units.Temperature);

        // Web parity: batteryLevel = state?.battery_level ?? null; `${batteryLevel}%` else '—'.
        bool hasBattery = state?.BatteryLevel is not null;
        double batteryValue = state?.BatteryLevel ?? 0;
        string batteryText = hasBattery ? $"{ScalarFormatters.FormatNumber(batteryValue, 0)}%" : Dash;

        // Web parity: range = state ? round(convertDistanceFromSI(ideal_range ?? 0)) : null.
        double? rangeValue = state is null
            ? null
            : Math.Round(UnitConverters.DistanceFromSi(state.IdealRangeMeters ?? 0, units.Distance));
        string rangeText = rangeValue is { } r ? $"{ScalarFormatters.FormatNumber(r, 0)} {distanceLabel}" : Dash;

        // Web parity: insideTemp = state?.inside_temp != null ? round(convertTempFromSI(inside_temp)) : null.
        double? insideValue = state?.InsideTempCelsius is { } inside
            ? Math.Round(UnitConverters.TemperatureFromSi(inside, units.Temperature))
            : null;
        string cabinText = insideValue is { } iv ? $"{ScalarFormatters.FormatNumber(iv, 0)}{tempLabel}" : Dash;

        double? outsideValue = state?.OutsideTempCelsius is { } outside
            ? Math.Round(UnitConverters.TemperatureFromSi(outside, units.Temperature))
            : null;
        string outsideText = outsideValue is { } ov ? $"{ScalarFormatters.FormatNumber(ov, 0)}{tempLabel}" : Dash;

        bool isCharging = state?.IsCharging ?? false;
        string chargingText = localizer.GetString("widget.charging", "Charging");

        // Web parity: chargerPower != null && chargerPower > 0 ? `${fmtNumber(chargerPower, 1)} kW`.
        string? chargerText = state?.ChargerPowerKw is { } kw && kw > 0
            ? $"{ScalarFormatters.FormatNumber(kw, 1)} kW"
            : null;

        string batteryLabel = localizer.GetString("widget.battery", "Battery");
        string rangeLabel = localizer.GetString("widget.range", "Range");
        string cabinLabel = localizer.GetString("widget.cabin", "Cabin");
        string outsideLabel = localizer.GetString("widget.outside", "Outside");
        string idealLabel = localizer.GetString("widget.idealRange", "Ideal");

        string name = identity.Name;
        string statusText = Capitalize(status);

        string compactAuto = Join(name, statusText, $"{batteryLabel} {batteryText}");
        string fullAuto = BuildFullAutomationName(
            name, statusText, identity.Subtitle,
            batteryLabel, batteryText, rangeLabel, rangeText, cabinLabel, cabinText,
            isCharging, chargingText, chargerText);

        return new VehicleHeroCardDisplay(
            Name: name,
            Subtitle: identity.Subtitle,
            Status: status,
            StatusAccentKey: StatusAccentKey(status),
            HasBattery: hasBattery,
            BatteryValue: batteryValue,
            BatteryText: batteryText,
            BatteryAccentKey: BatteryAccentKey(state),
            RangeText: rangeText,
            CabinText: cabinText,
            OutsideText: outsideText,
            IdealText: rangeText,
            IsCharging: isCharging,
            ChargingText: chargingText,
            ChargerText: chargerText,
            BatteryLabel: batteryLabel,
            RangeLabel: rangeLabel,
            CabinLabel: cabinLabel,
            OutsideLabel: outsideLabel,
            IdealLabel: idealLabel,
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            IsTall: size.IsTall,
            CompactAutomationName: compactAuto,
            FullAutomationName: fullAuto);
    }

    private static string BuildFullAutomationName(
        string name,
        string statusText,
        string subtitle,
        string batteryLabel,
        string batteryText,
        string rangeLabel,
        string rangeText,
        string cabinLabel,
        string cabinText,
        bool isCharging,
        string chargingText,
        string? chargerText)
    {
        var parts = new List<string> { name, statusText };
        if (!string.IsNullOrWhiteSpace(subtitle))
        {
            parts.Add(subtitle);
        }

        parts.Add($"{batteryLabel} {batteryText}");
        parts.Add($"{rangeLabel} {rangeText}");
        parts.Add($"{cabinLabel} {cabinText}");
        if (isCharging)
        {
            parts.Add(chargerText is null ? chargingText : $"{chargingText} {chargerText}");
        }

        return Join([.. parts]);
    }

    private static string Join(params string[] parts) =>
        string.Join(", ", parts.Where(p => !string.IsNullOrWhiteSpace(p)));

    private static string Normalize(string? status) => (status ?? string.Empty).Trim().ToLowerInvariant();

    private static string Capitalize(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        return char.ToUpperInvariant(value[0]) + value[1..];
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> state emissions onto parsed
/// <c>RepositoryResult&lt;VehicleHeroReading&gt;</c>, folding in the already-resolved
/// <see cref="VehicleHeroIdentity"/> and preserving every freshness flag (cached / refreshing / stale /
/// offline). Unlike a state-gated surface, a successful-but-stateless body does <em>not</em> collapse to empty
/// — the card still renders for the resolved vehicle with em-dash metrics (web <c>{vehicle ? card : empty}</c>).
/// Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class VehicleHeroCardResultMapper
{
    /// <summary>Combine <paramref name="identity"/> with the state read <paramref name="stateRaw"/>.</summary>
    public static RepositoryResult<VehicleHeroReading> Combine(
        VehicleHeroIdentity identity,
        RepositoryResult<JsonElement> stateRaw)
    {
        ArgumentNullException.ThrowIfNull(identity);
        ArgumentNullException.ThrowIfNull(stateRaw);

        VehicleHeroStateReading? Parse() =>
            stateRaw.HasValue ? VehicleHeroStateReading.FromResponse(stateRaw.Value) : null;

        VehicleHeroReading Reading(VehicleHeroStateReading? state) => new(identity, state);

        return stateRaw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<VehicleHeroReading>.Loading(),
            LoadStatus.Cached => RepositoryResult<VehicleHeroReading>.Cached(
                Reading(Parse()), stateRaw.FetchedAt!.Value, stateRaw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<VehicleHeroReading>.Refreshing(
                Reading(Parse()), stateRaw.FetchedAt!.Value, stateRaw.IsStale),
            LoadStatus.Loaded => RepositoryResult<VehicleHeroReading>.Loaded(
                Reading(Parse()), stateRaw.FetchedAt ?? DateTimeOffset.UtcNow),

            // Web parity: a stateless state response still renders the card (vehicle present) with em-dash metrics.
            LoadStatus.Empty => RepositoryResult<VehicleHeroReading>.Loaded(
                Reading(null), stateRaw.FetchedAt ?? DateTimeOffset.UtcNow),

            LoadStatus.Offline => RepositoryResult<VehicleHeroReading>.OfflineCached(
                Reading(Parse()), stateRaw.FetchedAt!.Value, stateRaw.Error!),
            _ => RepositoryResult<VehicleHeroReading>.Failure(
                stateRaw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>Null-tolerant <see cref="JsonElement"/> field readers shared by the hero card parse adapters.</summary>
internal static class JsonRead
{
    public static JsonElement? Object(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object &&
        parent.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.Object
            ? value
            : null;

    public static bool Has(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out _);

    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
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

    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static string? String(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    }

    public static bool Bool(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
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
