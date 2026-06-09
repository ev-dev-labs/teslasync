using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="WatchSummaryViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>WatchSummaryWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/WatchSummaryWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>hasData = summary != null</c> gate (the watch-summary read returning no usable body) — the friendly
/// "No watch data" surface. Faithful to the web, a transport failure with nothing cached surfaces through the
/// freshness "Error" chip plus the refresh affordance rather than a body swap (<see cref="Error"/>), so the
/// body shows the same "No watch data" surface as <see cref="Empty"/>.
/// </summary>
public enum WatchSummaryState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying a watch summary to render.</summary>
    Loaded,

    /// <summary>The read returned no usable body — render the "No watch data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and nothing is cached — render the freshness error chip + refresh.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The watch-summary slice the widget reads from <c>GET /watch/summary</c> — the native mirror of the web
/// <c>WatchSummary</c> interface (web/src/api/hooks/useWatch.ts). Only the fields the web component consumes are
/// kept: the state-of-charge percent (<c>battery_level</c>), the rated range in kilometres (<c>range_km</c> —
/// the existing watch wire field, converted to SI metres at the display boundary), the coarse FSM
/// <c>state</c>, the <c>is_locked</c> flag, the cabin temperature in Celsius (<c>inside_temp_c</c>), and the
/// <c>last_updated</c> instant. Field names mirror the Go API's snake_case JSON tags; every field is nullable
/// (the web reads each as <c>?? null</c>) and parsing is null-tolerant so a partial body never throws. A
/// <see langword="null"/> parse result models the web <c>summary</c> being undefined (no data → the empty
/// surface).
/// </summary>
/// <param name="BatteryLevel">State-of-charge percent (web <c>summary.battery_level</c>), or null.</param>
/// <param name="RangeKm">Rated range in kilometres (web <c>summary.range_km</c>), or null.</param>
/// <param name="State">Coarse vehicle FSM state (web <c>summary.state</c>), or null.</param>
/// <param name="IsLocked">Lock flag (web <c>summary.is_locked</c>), or null.</param>
/// <param name="InsideTempC">Cabin temperature in Celsius (web <c>summary.inside_temp_c</c>), or null.</param>
/// <param name="LastUpdated">Parsed <c>last_updated</c> instant (web <c>summary.last_updated</c>), or null.</param>
public sealed record WatchSummaryData(
    double? BatteryLevel,
    double? RangeKm,
    string? State,
    bool? IsLocked,
    double? InsideTempC,
    DateTimeOffset? LastUpdated)
{
    /// <summary>
    /// Project a <c>GET /watch/summary</c> response into the slice. Returns <see langword="null"/> when the
    /// body is not an object or carries no fields — the native analogue of the web <c>summary</c> being
    /// undefined (the "No watch data" surface). A non-empty object always yields a record, even when every
    /// field is absent, mirroring the web <c>hasData = summary != null</c> (zeros still render).
    /// </summary>
    public static WatchSummaryData? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.EnumerateObject().MoveNext())
        {
            return null;
        }

        return new WatchSummaryData(
            BatteryLevel: ReadDouble(root, "battery_level"),
            RangeKm: ReadDouble(root, "range_km"),
            State: ReadString(root, "state"),
            IsLocked: ReadBool(root, "is_locked"),
            InsideTempC: ReadDouble(root, "inside_temp_c"),
            LastUpdated: ReadDateTime(root, "last_updated"));
    }

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

    private static bool? ReadBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when v.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String when bool.TryParse(v.GetString(), out var b) => b,
            _ => null,
        };
    }

    private static string? ReadString(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        string? value = v.GetString();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static DateTimeOffset? ReadDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// The minimal complication slice the widget reads from <c>GET /watch/complication</c> — the native mirror of
/// the web <c>WatchComplication</c> interface (web/src/api/hooks/useWatch.ts). The web component reads only
/// <c>complication?.charging</c> (the pulsing "⚡ Charging" line in the compact watch face), so only that flag
/// is kept here; parsing is null-tolerant and an absent / non-object body yields <see langword="false"/>,
/// matching the web optional-chaining default.
/// </summary>
/// <param name="Charging">Whether the vehicle is charging (web <c>complication.charging</c>).</param>
public sealed record WatchComplicationData(bool Charging)
{
    /// <summary>Parse a <c>GET /watch/complication</c> response, defaulting <see cref="Charging"/> to false.</summary>
    public static WatchComplicationData FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("charging", out var v))
        {
            return new WatchComplicationData(false);
        }

        bool charging = v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when v.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String when bool.TryParse(v.GetString(), out var b) => b,
            _ => false,
        };

        return new WatchComplicationData(charging);
    }
}

/// <summary>
/// The combined, settled reading the view-model projects — the load-bearing watch summary plus the enrichment
/// charging flag from the complication read. The native analogue of the web component's two-hook composition
/// (<c>summary</c> drives <c>hasData</c>; <c>complication?.charging</c> only feeds the compact charging line).
/// </summary>
/// <param name="Summary">The load-bearing watch summary (never null on a content emission).</param>
/// <param name="Charging">The enrichment charging flag from the complication read.</param>
public sealed record WatchSummaryReading(WatchSummaryData Summary, bool Charging);

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1</c> branch in web/src/features/dashboard/widgets/WatchSummaryWidget.tsx that
/// switches between the compact watch-face gauge and the standard battery hero + detail grid.
/// </summary>
public readonly record struct WatchSummarySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (1×2).</summary>
    public static WatchSummarySize Default => new(1, 2);

    /// <summary>True at one column or narrower (web <c>isCompact = size.cols &lt;= 1</c>) — the watch face.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One render-ready tile in the standard detail grid — the native analogue of a web detail cell
/// (Range / Lock / Cabin / Last Seen). Pure data so the projection is unit-tested without a UI host; the view
/// is a thin renderer. <see cref="AutomationName"/> carries the Narrator label combining the label and value.
/// </summary>
/// <param name="Label">The localized, uppercased tile caption.</param>
/// <param name="ValueText">The pre-formatted value text (em dash when absent).</param>
/// <param name="AutomationName">The Narrator label combining the caption and value.</param>
public sealed record WatchDetailTile(string Label, string ValueText, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the watch summary for one footprint — the native analogue of
/// everything the web component computes before returning JSX (the clamped gauge value and threshold status,
/// the converted range / cabin temperature in display units, the lock status, the state badge variant, the
/// charging affordance, and every localized label). Pure data so the projection is unit-tested without a UI
/// host.
/// </summary>
public sealed record WatchSummaryDisplay(
    bool IsCompact,
    double? BatteryLevel,
    double GaugeValue,
    string BatteryValueText,
    WatchBatteryTint BatteryTint,
    string GaugeAutomationName,
    string? State,
    bool HasState,
    string StateDotBrushKey,
    StatusKind StateBadgeStatus,
    bool ShowStateBadge,
    double? RangeDisplay,
    string RangeValueText,
    string DistanceUnitLabel,
    double? TempDisplay,
    string TempValueText,
    string TemperatureUnitLabel,
    bool? IsLocked,
    bool HasLock,
    bool LockGlyphIsLocked,
    string LockLabel,
    StatusKind LockStatus,
    DateTimeOffset? LastUpdated,
    string LastSeenText,
    bool Charging,
    string ChargingText,
    string BatteryLabel,
    WatchDetailTile RangeTile,
    WatchDetailTile LockTile,
    WatchDetailTile CabinTile,
    WatchDetailTile LastSeenTile);

/// <summary>
/// The semantic tint the watch-face gauge arc is drawn with — the native, theme-token analogue of the web
/// <c>getBatteryColor</c> hex map plus the web grey (<c>#374151</c>) used when the state-of-charge is unknown.
/// </summary>
public enum WatchBatteryTint
{
    /// <summary>State-of-charge unknown (web grey <c>#374151</c>) — a muted track-coloured arc.</summary>
    Unknown,

    /// <summary>State-of-charge &gt; 50% (web green <c>#10b981</c>).</summary>
    Healthy,

    /// <summary>State-of-charge &gt; 20% (web amber <c>#f59e0b</c>).</summary>
    Warning,

    /// <summary>State-of-charge ≤ 20% (web red <c>#ef4444</c>).</summary>
    Critical,
}

/// <summary>
/// Maps a coarse vehicle FSM state to its theme-aware design-token brush key for the compact
/// <c>StatusBadge</c> dot — the native, light/dark/high-contrast-safe analogue of the web
/// <c>getStateDefinition('vehicle', state).badgeDot</c> resolution (web/src/types/fsm/vehicle.ts): online green,
/// driving blue, charging amber, parked / updating cyan-indigo, asleep purple, offline red, otherwise muted
/// grey. Pure and case-insensitive so the projection is unit-tested without a XAML runtime.
/// </summary>
public static class WatchStatePalette
{
    /// <summary>Token brush key for the default / unknown state (web neutral <c>bg-gray-400</c>).</summary>
    public const string DefaultDotKey = "TsColorTextSecondaryBrush";

    /// <summary>Resolve the token brush key for the <c>StatusBadge</c> dot of <paramref name="state"/>.</summary>
    public static string DotBrushKey(string? state) => (state ?? string.Empty).Trim().ToLowerInvariant() switch
    {
        "online" => "TsColorSuccessBrush",   // web success → green
        "driving" => "TsColorInfoBrush",      // web badgeDot bg-blue-500
        "charging" => "TsColorWarningBrush",  // web badgeDot bg-yellow-400
        "parked" => "TsColorInfoBrush",       // web badgeDot bg-cyan-500
        "updating" => "TsColorInfoBrush",     // web badgeDot bg-indigo-500
        "asleep" => "TsChart07Brush",         // web badgeDot bg-purple-500
        "offline" => "TsColorDangerBrush",    // web danger → red
        _ => DefaultDotKey,
    };

    /// <summary>
    /// The badge variant the standard battery hero tints its state chip with — the web inline map
    /// <c>state === 'online' ? 'success' : state === 'asleep' ? 'neutral' : 'warning'</c>.
    /// </summary>
    public static StatusKind BadgeStatus(string? state) => (state ?? string.Empty).Trim().ToLowerInvariant() switch
    {
        "online" => StatusKind.Success,
        "asleep" => StatusKind.Neutral,
        _ => StatusKind.Warning,
    };
}

/// <summary>
/// Pure projection from a settled <see cref="WatchSummaryReading"/> to the render-ready
/// <see cref="WatchSummaryDisplay"/> — the native port of the web <c>WatchSummaryWidget</c>'s render-time
/// computation (web/src/features/dashboard/widgets/WatchSummaryWidget.tsx): the <c>getBatteryColor</c>
/// threshold, the SI conversions (<c>range_km</c> → display distance, <c>inside_temp_c</c> → display
/// temperature) via the shared <see cref="UnitConverters"/> at the display boundary, the lock status, the
/// state badge variant, and every localized label. The state-of-charge is already a unit-free percent.
/// </summary>
public static class WatchSummaryProjection
{
    /// <summary>Segoe Fluent "Stopwatch" glyph for the surface icon + empty state (web <c>Watch</c> icon).</summary>
    public const string HeaderGlyph = "\uE916";

    /// <summary>Segoe Fluent "Lock" glyph for the locked detail (web <c>Lock</c> icon).</summary>
    public const string LockGlyph = "\uE72E";

    /// <summary>Segoe Fluent "Unlock" glyph for the unlocked detail (web <c>Unlock</c> icon).</summary>
    public const string UnlockGlyph = "\uE785";

    /// <summary>The lightning prefix the web charging indicator renders (web <c>⚡</c>).</summary>
    public const string ChargingBolt = "\u26A1";

    /// <summary>The gauge maximum (web <c>RadialGauge max={100}</c>).</summary>
    public const double MaxPercent = 100;

    /// <summary>Above this state-of-charge the gauge is healthy/green (web <c>level &gt; 50</c>).</summary>
    public const double HealthyThresholdPercent = 50;

    /// <summary>Above this state-of-charge the gauge is a warning/amber (web <c>level &gt; 20</c>).</summary>
    public const double WarningThresholdPercent = 20;

    private const string EmDash = "\u2014";

    /// <summary>
    /// Map a state-of-charge to the semantic tint the gauge arc is drawn with (web <c>getBatteryColor</c>):
    /// &gt;50% → <see cref="WatchBatteryTint.Healthy"/>, &gt;20% → <see cref="WatchBatteryTint.Warning"/>,
    /// otherwise <see cref="WatchBatteryTint.Critical"/>. A null state-of-charge maps to
    /// <see cref="WatchBatteryTint.Unknown"/> (the web grey <c>#374151</c>).
    /// </summary>
    public static WatchBatteryTint TintFor(double? batteryLevel)
    {
        if (batteryLevel is not { } level)
        {
            return WatchBatteryTint.Unknown;
        }

        if (level > HealthyThresholdPercent)
        {
            return WatchBatteryTint.Healthy;
        }

        return level > WarningThresholdPercent ? WatchBatteryTint.Warning : WatchBatteryTint.Critical;
    }

    /// <summary>The semantic status the <see cref="WatchBatteryTint"/> resolves its arc brush from.</summary>
    public static StatusKind StatusFor(WatchBatteryTint tint) => tint switch
    {
        WatchBatteryTint.Healthy => StatusKind.Success,
        WatchBatteryTint.Warning => StatusKind.Warning,
        WatchBatteryTint.Critical => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>Project <paramref name="reading"/> for <paramref name="size"/> using the active units + localizer.</summary>
    public static WatchSummaryDisplay Project(
        WatchSummaryReading reading,
        WatchSummarySize size,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        WatchSummaryData summary = reading.Summary;

        double? batteryLevel = summary.BatteryLevel;
        double gaugeValue = Math.Clamp(SafeNumber(batteryLevel ?? 0), 0, MaxPercent);
        WatchBatteryTint tint = TintFor(batteryLevel);
        string batteryValueText = batteryLevel is { } b ? FormatNumber(b) : EmDash;
        string batteryLabel = localizer.GetString("widget.battery", "Battery");

        // Web parity: range_km is kilometres → metres (×1000) → display distance via the shared converter.
        double? rangeDisplay = summary.RangeKm is { } km
            ? UnitConverters.DistanceFromSi(km * 1000.0, units.Distance)
            : null;
        string distanceUnitLabel = UnitLabels.Label(units.Distance);
        string rangeValueText = rangeDisplay is { } r ? FormatNumber(r) : EmDash;

        // Web parity: inside_temp_c is Celsius (SI) → display temperature via the shared converter.
        double? tempDisplay = summary.InsideTempC is { } c
            ? UnitConverters.TemperatureFromSi(c, units.Temperature)
            : null;
        string temperatureUnitLabel = UnitLabels.Label(units.Temperature);
        string tempValueText = tempDisplay is { } t ? FormatNumber(t) : EmDash;

        bool? isLocked = summary.IsLocked;
        bool hasLock = isLocked.HasValue;
        bool lockGlyphIsLocked = isLocked == true;
        string lockLabel = isLocked == true
            ? localizer.GetString("widget.locked", "Locked")
            : localizer.GetString("widget.unlocked", "Unlocked");
        StatusKind lockStatus = isLocked == true ? StatusKind.Success : StatusKind.Warning;

        string? state = summary.State;
        bool hasState = !string.IsNullOrWhiteSpace(state);

        string lastSeenText = DateTimeFormatting.Format(summary.LastUpdated, DateTimeVariant.Relative, now);

        string rangeLabel = localizer.GetString("widget.range", "Range");
        string lockSectionLabel = localizer.GetString("widget.lockStatus", "Lock");
        string cabinLabel = localizer.GetString("widget.cabinTemp", "Cabin");
        string lastSeenLabel = localizer.GetString("widget.lastSeen", "Last Seen");

        string rangeValueWithUnit = rangeDisplay is not null ? $"{rangeValueText} {distanceUnitLabel}" : EmDash;
        string tempValueWithUnit = tempDisplay is not null ? $"{tempValueText}{temperatureUnitLabel}" : EmDash;
        string lockValueText = hasLock ? lockLabel : EmDash;

        return new WatchSummaryDisplay(
            IsCompact: size.IsCompact,
            BatteryLevel: batteryLevel,
            GaugeValue: gaugeValue,
            BatteryValueText: batteryValueText,
            BatteryTint: tint,
            GaugeAutomationName: $"{batteryLabel} {FormatNumber(gaugeValue)}%",
            State: state,
            HasState: hasState,
            StateDotBrushKey: WatchStatePalette.DotBrushKey(state),
            StateBadgeStatus: WatchStatePalette.BadgeStatus(state),
            ShowStateBadge: hasState,
            RangeDisplay: rangeDisplay,
            RangeValueText: rangeValueText,
            DistanceUnitLabel: distanceUnitLabel,
            TempDisplay: tempDisplay,
            TempValueText: tempValueText,
            TemperatureUnitLabel: temperatureUnitLabel,
            IsLocked: isLocked,
            HasLock: hasLock,
            LockGlyphIsLocked: lockGlyphIsLocked,
            LockLabel: lockLabel,
            LockStatus: lockStatus,
            LastUpdated: summary.LastUpdated,
            LastSeenText: lastSeenText,
            Charging: reading.Charging,
            ChargingText: localizer.GetString("widget.charging", "Charging"),
            BatteryLabel: batteryLabel,
            RangeTile: new WatchDetailTile(rangeLabel, rangeValueWithUnit, $"{rangeLabel} {rangeValueWithUnit}"),
            LockTile: new WatchDetailTile(lockSectionLabel, lockValueText, $"{lockSectionLabel} {lockValueText}"),
            CabinTile: new WatchDetailTile(cabinLabel, tempValueWithUnit, $"{cabinLabel} {tempValueWithUnit}"),
            LastSeenTile: new WatchDetailTile(lastSeenLabel, lastSeenText, $"{lastSeenLabel} {lastSeenText}"));
    }

    /// <summary>
    /// Format a value exactly as the web watch widget does: zero fraction digits (the web
    /// <c>RadialGauge decimals={0}</c>, <c>AnimatedNumber</c> default precision, and <c>fmtNumber(value, 0)</c>
    /// all round to whole units), using en-US grouping.
    /// </summary>
    public static string FormatNumber(double value) => ScalarFormatters.FormatNumber(SafeNumber(value), 0);

    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Folds the two settled reads — the load-bearing watch summary and the enrichment complication — into one
/// combined emission, the native port of the web component's two-hook composition. Only the summary decides
/// loaded / empty / error (web <c>hasData = summary != null</c>); the complication merely contributes the
/// charging flag and the freshness union (<c>updatedAt = max(...)</c>), and a failed / absent complication
/// degrades silently to <c>charging = false</c> exactly as the web <c>complication?.charging</c> does. Kept
/// pure so the parse-and-merge contract is unit-tested without a network or cache.
/// </summary>
public static class WatchSummaryResultMapper
{
    /// <summary>
    /// Combine the settled load-bearing <paramref name="summary"/> read with the optional
    /// <paramref name="complication"/> read (null models the complication still loading — it contributes
    /// nothing yet; web parity: it never gates content).
    /// </summary>
    public static RepositoryResult<WatchSummaryReading> Combine(
        RepositoryResult<JsonElement> summary,
        RepositoryResult<JsonElement>? complication)
    {
        ArgumentNullException.ThrowIfNull(summary);

        // Load-bearing: the watch-summary read. A hard failure with nothing cached → the retry surface.
        if (summary.Status == LoadStatus.Error)
        {
            return RepositoryResult<WatchSummaryReading>.Failure(
                summary.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load watch summary"));
        }

        WatchSummaryData? data = summary.HasValue ? WatchSummaryData.FromResponse(summary.Value) : null;

        // Web parity: hasData = summary != null. No usable body → the "No watch data" empty surface.
        if (data is null)
        {
            return RepositoryResult<WatchSummaryReading>.Empty(summary.FetchedAt);
        }

        bool charging = complication is { HasValue: true } comp
            && WatchComplicationData.FromResponse(comp.Value).Charging;

        var reading = new WatchSummaryReading(data, charging);

        bool offline = summary.Status == LoadStatus.Offline;
        bool stale = summary.IsStale || (complication?.IsStale ?? false);
        DateTimeOffset updatedAt = Latest(summary.FetchedAt, complication?.FetchedAt)
            ?? summary.FetchedAt
            ?? DateTimeOffset.UtcNow;

        if (offline)
        {
            return RepositoryResult<WatchSummaryReading>.OfflineCached(
                reading,
                updatedAt,
                summary.Error ?? new RepositoryError(RepositoryErrorKind.Network, "A live read is unavailable"));
        }

        if (stale)
        {
            return RepositoryResult<WatchSummaryReading>.Cached(reading, updatedAt, stale: true);
        }

        return RepositoryResult<WatchSummaryReading>.Loaded(reading, updatedAt);
    }

    private static DateTimeOffset? Latest(DateTimeOffset? a, DateTimeOffset? b)
    {
        if (a is null)
        {
            return b;
        }

        if (b is null)
        {
            return a;
        }

        return b > a ? b : a;
    }
}
