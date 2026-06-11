using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state a <see cref="BatteryRangePanelViewModel"/> can be in — the native
/// superset of what the web <c>BatteryRangePanel</c> renders
/// (web/src/features/vehicles/components/vehicle-detail/BatteryRangePanel.tsx). The web component is a pure
/// child of the vehicle-detail page (it receives its <c>state</c> as a prop and always renders the gauge plus
/// the three metric cards); the native surface binds its own cache-then-network read of that vehicle's live
/// state, so it owns the full loading / loaded / empty / error / stale / offline matrix the P2 state contract
/// requires. Every value maps onto a visible surface — none is ever a blank panel. <see cref="Empty"/> mirrors
/// the absence of a live state object (no vehicle resolved, or the vehicle is asleep with no reported state).
/// </summary>
public enum BatteryRangePanelState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot with a live state — render the gauge and the three metric cards.</summary>
    Loaded,

    /// <summary>No live state (no vehicle, or asleep) — render the friendly empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The categorical accent a battery / range element renders with — the native, WinUI-free mirror of the web
/// component's per-element hue. The web battery gauge tints its arc by the state-of-charge band
/// (<c>batteryColor</c> in web/src/features/vehicles/components/vehicle-detail/helpers.ts: green above 60 %,
/// amber above 25 %, red otherwise) and each <c>MetricCard</c> carries a fixed <c>color</c> (cyan / green).
/// Kept as an enum so the projection can assign it and the tests can assert the colour without a UI host; the
/// view maps each value to a themed design-token brush at render time, so light / dark / high-contrast all stay
/// legible per the "platform tokens, not web Tailwind" rule.
/// </summary>
public enum BatteryRangeAccent
{
    /// <summary>Cyan (web <c>cyan</c>) — the rated-range card and the idle charging card.</summary>
    Cyan,

    /// <summary>Green (web <c>#10b981</c>) — a healthy battery, the ideal-range card and the active charging card.</summary>
    Green,

    /// <summary>Amber (web <c>#f59e0b</c>) — a battery in the warning band (25–60 %).</summary>
    Amber,

    /// <summary>Red (web <c>#ef4444</c>) — a battery in the critical band (25 % or below).</summary>
    Red,
}

/// <summary>
/// The battery / range / charging slice of the vehicle state the panel reads from
/// <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of the fields the web <c>BatteryRangePanel</c>
/// consumes off its <c>VehicleState</c> prop (web/src/api/types.ts). Distances are metres
/// (<c>rated_range</c> / <c>ideal_range</c> / <c>charge_rate</c>, all SI per Phase-42/48) and
/// <c>time_to_full_charge</c> is hours; every dynamic field is nullable and stays null when the source did not
/// report it, so the projection renders an explicit em dash rather than a fabricated value. A
/// <see langword="null"/> parse result models the web parent's <c>state</c> being undefined (the vehicle is
/// asleep / has no live state).
/// </summary>
/// <param name="BatteryLevel">State-of-charge percent, 0–100 (web <c>battery_level</c>).</param>
/// <param name="RatedRangeMeters">Rated range in metres (web <c>rated_range</c>).</param>
/// <param name="IdealRangeMeters">Ideal range in metres (web <c>ideal_range</c>).</param>
/// <param name="IsCharging">True while charging (web <c>is_charging</c>).</param>
/// <param name="ChargeRateMeters">Range added per hour in metres (web <c>charge_rate</c>).</param>
/// <param name="TimeToFullChargeHours">Hours to a full charge (web <c>time_to_full_charge</c>).</param>
public sealed record BatteryRangeTelemetry(
    double? BatteryLevel,
    double? RatedRangeMeters,
    double? IdealRangeMeters,
    bool IsCharging,
    double? ChargeRateMeters,
    double? TimeToFullChargeHours)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the battery / range slice, mirroring the
    /// normalisation in the web <c>useVehicleState</c> hook: prefer the canonical <c>state</c> object (the one
    /// carrying <c>vehicle_id</c>), otherwise a plain <c>state</c> object when no <c>vehicle</c>/<c>position</c>
    /// envelope is present, otherwise reconstruct from the <c>position</c> snapshot plus the top-level charging
    /// fields. Returns <see langword="null"/> when none of those yield a state — the native analogue of the web
    /// parent's <c>state</c> being undefined (asleep).
    /// </summary>
    /// <param name="root">The parsed state response body.</param>
    /// <returns>The parsed telemetry, or <see langword="null"/> when the vehicle reports no live state.</returns>
    public static BatteryRangeTelemetry? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        // Web parity (primary): res.state carrying a vehicle_id is the canonical SignalStore state object.
        if (BatteryRangePanelJson.Object(root, "state") is { } canonical && BatteryRangePanelJson.Has(canonical, "vehicle_id"))
        {
            return FromStateObject(canonical);
        }

        var vehicle = BatteryRangePanelJson.Object(root, "vehicle");
        var position = BatteryRangePanelJson.Object(root, "position");
        if (vehicle is null && position is null)
        {
            // Web parity: a plain state object (no vehicle/position envelope) is still usable.
            return BatteryRangePanelJson.Object(root, "state") is { } plain ? FromStateObject(plain) : null;
        }

        // Web parity (fallback): rebuild from the position snapshot plus the top-level charging flags.
        return new BatteryRangeTelemetry(
            BatteryLevel: position is { } pb ? BatteryRangePanelJson.Double(pb, "battery_level") : null,
            RatedRangeMeters: position is { } pr ? BatteryRangePanelJson.Double(pr, "rated_range") : null,
            IdealRangeMeters: position is { } pi ? BatteryRangePanelJson.Double(pi, "ideal_range") : null,
            IsCharging: BatteryRangePanelJson.Bool(root, "is_charging"),
            ChargeRateMeters: BatteryRangePanelJson.Double(root, "charge_rate"),
            TimeToFullChargeHours: BatteryRangePanelJson.Double(root, "time_to_full_charge"));
    }

    private static BatteryRangeTelemetry FromStateObject(JsonElement s) => new(
        BatteryLevel: BatteryRangePanelJson.Double(s, "battery_level"),
        RatedRangeMeters: BatteryRangePanelJson.Double(s, "rated_range"),
        IdealRangeMeters: BatteryRangePanelJson.Double(s, "ideal_range"),
        IsCharging: BatteryRangePanelJson.Bool(s, "is_charging"),
        ChargeRateMeters: BatteryRangePanelJson.Double(s, "charge_rate"),
        TimeToFullChargeHours: BatteryRangePanelJson.Double(s, "time_to_full_charge"));
}

/// <summary>
/// The resolved reading cached by the source: whether a vehicle was resolved at all plus the (nullable) live
/// <see cref="State"/>. A null <see cref="State"/> with <see cref="HasVehicle"/> true is the asleep vehicle
/// (the web parent's <c>state</c> undefined); <see cref="HasVehicle"/> false is "no vehicle resolved" (the web
/// page's selected-vehicle gate). Serialized to the cache as JSON so the cache-then-network read round-trips
/// losslessly.
/// </summary>
/// <param name="HasVehicle">True once a vehicle was resolved for the read.</param>
/// <param name="State">The live battery / range telemetry, or <see langword="null"/> when asleep.</param>
public sealed record BatteryRangeData(bool HasVehicle, BatteryRangeTelemetry? State)
{
    /// <summary>The "no vehicle resolved" snapshot — the parse / loading fallback.</summary>
    public static BatteryRangeData Empty { get; } = new(false, null);

    /// <summary>True when a vehicle was resolved and reported a live state worth rendering.</summary>
    [JsonIgnore]
    public bool HasData => HasVehicle && State is not null;
}

/// <summary>
/// One projected, display-ready metric card consumed by the WinUI view — the native analogue of one web
/// <c>&lt;MetricCard&gt;</c>. Holds the localized label, the already-formatted value, the optional subtitle, the
/// resolved Fluent glyph, the categorical accent (so the card's icon colour matches the web hue) and a Narrator
/// automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Key">A stable, non-localized identity used by the view and the tests.</param>
/// <param name="Label">The localized card label (web <c>MetricCard label</c>).</param>
/// <param name="Value">The pre-formatted headline value (web <c>MetricCard value</c>).</param>
/// <param name="Subtitle">The optional sub-line, or <see langword="null"/> (web <c>MetricCard subtitle</c>).</param>
/// <param name="Glyph">The Segoe Fluent glyph for the card icon (web <c>MetricCard icon</c>).</param>
/// <param name="Accent">The categorical icon accent (web <c>MetricCard color</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the card.</param>
public sealed record BatteryRangeMetric(
    string Key,
    string Label,
    string Value,
    string? Subtitle,
    string Glyph,
    BatteryRangeAccent Accent,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the panel — the native analogue of everything the web component
/// computes before returning its gauge plus three <c>&lt;MetricCard&gt;</c> cards. Holds the battery gauge
/// inputs (value, formatted text, unit, label, the state-of-charge band and its accent, plus the Narrator name)
/// and the three metric cards. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when a live state backs the snapshot (gates the empty surface).</param>
/// <param name="BatteryLevel">The clamped 0–100 state-of-charge the gauge sweep uses.</param>
/// <param name="BatteryValueText">The formatted battery percentage (no unit), e.g. <c>72</c>.</param>
/// <param name="BatteryUnit">The gauge unit suffix (<c>%</c>).</param>
/// <param name="BatteryLabel">The localized gauge caption (web <c>common.battery</c>).</param>
/// <param name="BatteryBand">The state-of-charge health band (web <c>batteryColor</c>), as a semantic status.</param>
/// <param name="BatteryAccent">The categorical accent matching <see cref="BatteryBand"/>.</param>
/// <param name="BatteryAutomationName">The composed Narrator name for the gauge.</param>
/// <param name="Metrics">The three display-ready metric cards, in web order.</param>
public sealed record BatteryRangeDisplay(
    bool HasData,
    double BatteryLevel,
    string BatteryValueText,
    string BatteryUnit,
    string BatteryLabel,
    StatusKind BatteryBand,
    BatteryRangeAccent BatteryAccent,
    string BatteryAutomationName,
    IReadOnlyList<BatteryRangeMetric> Metrics);

/// <summary>
/// Pure projection from a raw <see cref="BatteryRangeTelemetry"/> to the gauge-plus-three-cards display model —
/// the native port of web/src/features/vehicles/components/vehicle-detail/BatteryRangePanel.tsx. SI is converted
/// to the user's display unit here (and only here) through the shared <see cref="UnitFormatters"/>; the
/// state-of-charge band reproduces the web <c>batteryColor</c> thresholds exactly; every label resolves through
/// the i18n facade. No WinUI types so the whole projection is unit-tested headlessly.
/// </summary>
public static class BatteryRangePanelProjection
{
    /// <summary>Above this state-of-charge the battery reads healthy (web <c>batteryColor</c> &gt; 60).</summary>
    public const double HealthyBatteryPercent = 60;

    /// <summary>Above this state-of-charge (and at or below <see cref="HealthyBatteryPercent"/>) the battery reads warning (web <c>batteryColor</c> &gt; 25).</summary>
    public const double WarningBatteryPercent = 25;

    /// <summary>The full sweep of the battery gauge — a percentage (web <c>RadialGauge max={100}</c>).</summary>
    public const double BatteryGaugeMax = 100;

    /// <summary>The gauge unit suffix (web <c>RadialGauge unit="%"</c>).</summary>
    public const string PercentUnit = "%";

    /// <summary>The "/h" suffix the web appends after the charge-rate distance.</summary>
    public const string PerHourSuffix = "/h";

    /// <summary>The "h" suffix the web appends after the time-to-full hours.</summary>
    public const string HourSuffix = "h";

    /// <summary>Fluent glyph for the rated-range card (web <c>Navigation</c>) — Segoe Fluent Location.</summary>
    public const string RatedRangeGlyph = "\uE707";

    /// <summary>Fluent glyph for the ideal-range card (web <c>MapPin</c>) — Segoe Fluent Activity, matching the native vehicle-hero ideal-range glyph.</summary>
    public const string IdealRangeGlyph = "\uE9D2";

    /// <summary>Fluent glyph for the charging card (web <c>BatteryCharging</c>) — Segoe Fluent LightningBolt.</summary>
    public const string ChargingGlyph = "\uE945";

    private const int RangePrecision = 0;
    private const int BatteryPrecision = 0;
    private const int TimeToFullPrecision = 1;

    /// <summary>Map a state-of-charge percentage to its health band (web <c>batteryColor</c> thresholds).</summary>
    /// <param name="batteryLevel">The state-of-charge percentage (0–100).</param>
    /// <returns><see cref="StatusKind.Success"/> above 60 %, <see cref="StatusKind.Warning"/> above 25 %, otherwise <see cref="StatusKind.Danger"/>.</returns>
    public static StatusKind BatteryBand(double batteryLevel) =>
        batteryLevel > HealthyBatteryPercent ? StatusKind.Success
        : batteryLevel > WarningBatteryPercent ? StatusKind.Warning
        : StatusKind.Danger;

    /// <summary>Map a health band to its categorical accent.</summary>
    /// <param name="band">The state-of-charge band.</param>
    /// <returns>The matching <see cref="BatteryRangeAccent"/>.</returns>
    public static BatteryRangeAccent BandAccent(StatusKind band) => band switch
    {
        StatusKind.Success => BatteryRangeAccent.Green,
        StatusKind.Warning => BatteryRangeAccent.Amber,
        _ => BatteryRangeAccent.Red,
    };

    /// <summary>Project <paramref name="state"/> for the user's <paramref name="units"/>.</summary>
    /// <param name="state">The live battery / range telemetry, or <see langword="null"/> when asleep.</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static BatteryRangeDisplay Project(BatteryRangeTelemetry? state, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string batteryLabel = localizer.GetString("common.battery", "Battery");

        if (state is null)
        {
            return new BatteryRangeDisplay(
                HasData: false,
                BatteryLevel: 0,
                BatteryValueText: ScalarFormatters.FormatNumber(0, BatteryPrecision),
                BatteryUnit: PercentUnit,
                BatteryLabel: batteryLabel,
                BatteryBand: StatusKind.Danger,
                BatteryAccent: BatteryRangeAccent.Red,
                BatteryAutomationName: BatteryAutomation(batteryLabel, ScalarFormatters.FormatNumber(0, BatteryPrecision)),
                Metrics: Array.Empty<BatteryRangeMetric>());
        }

        double battery = Math.Clamp(state.BatteryLevel ?? 0, 0, BatteryGaugeMax);
        string batteryValueText = ScalarFormatters.FormatNumber(battery, BatteryPrecision);
        StatusKind band = BatteryBand(state.BatteryLevel ?? 0);
        BatteryRangeAccent batteryAccent = BandAccent(band);

        string ratedLabel = localizer.GetString("vehicles.detail.ratedRange", "Rated Range");
        string idealLabel = localizer.GetString("vehicles.detail.idealRange", "Ideal Range");
        string chargingLabel = localizer.GetString("common.charging", "Charging");
        string notChargingText = localizer.GetString("common.notCharging", "Not Charging");
        string fullInLabel = localizer.GetString("vehicles.detail.fullIn", "Full in");

        // Web: formatDistance(rated_range, { precision: 0 }).
        string ratedValue = UnitFormatters.FormatDistance(state.RatedRangeMeters, units, RangePrecision);

        // Web: formatDistance(ideal_range, { precision: 0 }).
        string idealValue = UnitFormatters.FormatDistance(state.IdealRangeMeters, units, RangePrecision);

        // Web: is_charging ? `${formatDistance(charge_rate)}/h` : t('common.notCharging').
        string chargingValue = state.IsCharging
            ? UnitFormatters.FormatDistance(state.ChargeRateMeters, units) + PerHourSuffix
            : notChargingText;
        BatteryRangeAccent chargingAccent = state.IsCharging ? BatteryRangeAccent.Green : BatteryRangeAccent.Cyan;

        // Web: is_charging && time_to_full_charge > 0 ? `${t('vehicles.detail.fullIn')} ${fmtNumber(...,1)}h` : undefined.
        double timeToFull = state.TimeToFullChargeHours ?? 0;
        string? chargingSubtitle = state.IsCharging && timeToFull > 0
            ? $"{fullInLabel} {ScalarFormatters.FormatNumber(timeToFull, TimeToFullPrecision)}{HourSuffix}"
            : null;

        var metrics = new[]
        {
            Metric("rated-range", ratedLabel, ratedValue, null, RatedRangeGlyph, BatteryRangeAccent.Cyan),
            Metric("ideal-range", idealLabel, idealValue, null, IdealRangeGlyph, BatteryRangeAccent.Green),
            Metric("charging", chargingLabel, chargingValue, chargingSubtitle, ChargingGlyph, chargingAccent),
        };

        return new BatteryRangeDisplay(
            HasData: true,
            BatteryLevel: battery,
            BatteryValueText: batteryValueText,
            BatteryUnit: PercentUnit,
            BatteryLabel: batteryLabel,
            BatteryBand: band,
            BatteryAccent: batteryAccent,
            BatteryAutomationName: BatteryAutomation(batteryLabel, batteryValueText),
            Metrics: metrics);
    }

    private static BatteryRangeMetric Metric(
        string key,
        string label,
        string value,
        string? subtitle,
        string glyph,
        BatteryRangeAccent accent) =>
        new(key, label, value, subtitle, glyph, accent, MetricAutomation(label, value, subtitle));

    private static string BatteryAutomation(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, PercentUnit);

    private static string MetricAutomation(string label, string value, string? subtitle) =>
        string.IsNullOrEmpty(subtitle)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1}. {2}", label, value, subtitle);
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the battery / range parse. Each returns
/// <see langword="null"/> (or a benign default) for an absent or wrong-kinded field so a partial response body
/// never throws. Kept UI-free and internal to the surface so the parse is unit-tested without a network.
/// </summary>
internal static class BatteryRangePanelJson
{
    /// <summary>True when <paramref name="element"/> is an object carrying <paramref name="name"/>.</summary>
    public static bool Has(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out _);

    /// <summary>The child object at <paramref name="name"/>, or <see langword="null"/>.</summary>
    public static JsonElement? Object(JsonElement element, string name)
    {
        if (element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.Object)
        {
            return value;
        }

        return null;
    }

    /// <summary>The numeric (or numeric-string) value at <paramref name="name"/>, or <see langword="null"/>.</summary>
    public static double? Double(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    /// <summary>The boolean value at <paramref name="name"/> (true only for an explicit JSON true).</summary>
    public static bool Bool(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.True;
}
