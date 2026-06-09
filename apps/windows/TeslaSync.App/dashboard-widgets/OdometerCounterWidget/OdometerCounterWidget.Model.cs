using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state an <see cref="OdometerCounterViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>OdometerCounterWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/OdometerCounterWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web inner
/// <c>{convertedOdometer != null ? … : &lt;EmptyState&gt;}</c> gate (no resolved vehicle, or a state
/// response carrying no <c>odometer</c>) — the "No odometer data" surface.
/// </summary>
public enum OdometerCounterState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying an odometer reading to display.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the response carried no odometer — render the "No odometer data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The single field the odometer counter reads from <c>GET /vehicles/{vehicleID}/state</c> — the native
/// mirror of the web <c>stateData?.state?.odometer</c> slice
/// (web/src/features/dashboard/widgets/OdometerCounterWidget.tsx). <see cref="Odometer"/> is the lifetime
/// odometer in SI metres (Phase-42 stores SI on disk). A <see langword="null"/> parse result models the web
/// <c>odometer ?? null</c> gate being null (no state, or no <c>odometer</c> in the response → the empty
/// surface). Parsing mirrors the three branches of the web <c>useVehicleState</c> hook and is null-tolerant
/// so a partial body never throws.
/// </summary>
public sealed record OdometerReading(double Odometer)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the odometer slice, mirroring the web
    /// <c>useVehicleState</c> hook's branch order: (1) <c>res.state</c> with a <c>vehicle_id</c> is the
    /// canonical SignalStore object (odometer read directly, <see langword="null"/> when absent — web
    /// <c>state.odometer ?? null</c>); (2) when neither <c>vehicle</c> nor <c>position</c> is present, a
    /// plain <c>state</c> object is still usable; (3) otherwise build from the <c>position</c> snapshot
    /// (web <c>odometer: p?.odometer ?? 0</c>). Returns <see langword="null"/> when the web
    /// <c>odometer</c> would be null — the empty surface.
    /// </summary>
    public static OdometerReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        // Branch 1 (web primary): res.state with a vehicle_id is the canonical SignalStore state object.
        if (Object(root, "state") is { } state && Has(state, "vehicle_id"))
        {
            return FromOdometer(ReadDouble(state, "odometer"));
        }

        var vehicle = Object(root, "vehicle");
        var position = Object(root, "position");
        if (vehicle is null && position is null)
        {
            // Branch 3 (web): `if (!v && !p) return { state: res.state }` — a plain state object's odometer,
            // otherwise there is no state and the widget shows its empty surface.
            return Object(root, "state") is { } plain ? FromOdometer(ReadDouble(plain, "odometer")) : null;
        }

        // Branch 2 (web fallback): build the reading from the position snapshot (web `odometer: p?.odometer ?? 0`).
        return new OdometerReading(position is { } p ? ReadDouble(p, "odometer") ?? 0 : 0);
    }

    private static OdometerReading? FromOdometer(double? odometer) =>
        odometer is { } value ? new OdometerReading(value) : null;

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
}

/// <summary>
/// The render-ready payload the odometer counter projects: the primary odometer reading (SI metres) plus the
/// supplementary lifetime distance from <c>GET /drives/stats</c> (web <c>useDrivingStats</c>'s
/// <c>totalDistanceKm</c>, only shown in the wide footprint's "Total Driven" tile). The supplementary value
/// is <see langword="null"/> when the stats query is unavailable — the web <c>'—'</c> fallback.
/// </summary>
public sealed record OdometerSnapshot(double Odometer, double? TotalDistanceKm);

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isWide</c> logic in
/// web/src/features/dashboard/widgets/OdometerCounterWidget.tsx
/// (<c>isCompact = size.cols === 1 &amp;&amp; size.rows === 1</c>, <c>isWide = size.cols &gt;= 2</c>).
/// </summary>
public readonly record struct OdometerCounterSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (1×2).</summary>
    public static OdometerCounterSize Default => new(1, 2);

    /// <summary>True at exactly one column and one row (web <c>isCompact</c>): the title-less big number.</summary>
    public bool IsCompact => Cols == 1 && Rows == 1;

    /// <summary>True at two or more columns (web <c>isWide</c>): show the "Total Driven" + "Unit" breakdown tiles.</summary>
    public bool IsWide => Cols >= 2;
}

/// <summary>
/// The fully projected, render-ready view of the odometer for one footprint — the native analogue of
/// everything the web component computes via <c>useMemo</c> before returning JSX (the unit-converted
/// odometer, the converted "Total Driven" value, the unit label, and the Narrator names for the compact /
/// expanded big number and the two breakdown tiles). Pure data so the projection is unit-tested without a
/// UI host.
/// </summary>
public sealed record OdometerDisplay(
    bool IsCompact,
    bool IsWide,
    double OdometerValue,
    string OdometerValueText,
    string UnitLabel,
    string ExpandedSuffix,
    string TotalOdometerLabel,
    string TotalDrivenLabel,
    string TotalDrivenValue,
    string TotalDrivenAutomationName,
    string UnitTileLabel,
    string UnitTileValue,
    string UnitTileAutomationName,
    string CompactAutomationName,
    string ExpandedAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="OdometerSnapshot"/> to the display model — the native port of the
/// unit conversion + <c>convertedOdometer</c>/<c>convertedTotalDriven</c> <c>useMemo</c>s in
/// web/src/features/dashboard/widgets/OdometerCounterWidget.tsx. SI is converted to the user's display unit
/// here (and only here); every label resolves through the i18n facade.
/// </summary>
public static class OdometerCounterProjection
{
    /// <summary>web <c>Gauge</c> (lucide) → Segoe Fluent "Speed" glyph for the title row + empty state.</summary>
    public const string HeaderGlyph = "\uEC4A";

    private const string EmDash = "\u2014";

    /// <summary>Token brush key for the "Total Driven" tile accent rail (web <c>color="green"</c> / emerald).</summary>
    public const string TotalDrivenBrushKey = "TsColorSuccessBrush";

    /// <summary>Token brush key for the "Unit" tile accent rail (web <c>color="amber"</c>).</summary>
    public const string UnitTileBrushKey = "TsColorWarningBrush";

    /// <summary>
    /// Project <paramref name="snapshot"/> for <paramref name="size"/> using the user's distance unit.
    /// <para>
    /// Distance handling follows the web source exactly: the web passes both <c>state.odometer</c> and
    /// <c>stats.totalDistanceKm</c> <em>directly</em> into <c>convertDistanceFromSI</c> (SI metres in) with
    /// NO km→m scaling. The odometer is genuinely SI metres (matching <c>VehicleHeroMetrics.OdometerMeters</c>
    /// and Phase-42's on-disk SI), and the "Km" suffix on the stats wire field is legacy/misleading — the
    /// value is treated as metres, identical to the FleetStats widget's parity decision. Converting either
    /// with an extra ×1000 here would silently over-scale the reading.
    /// </para>
    /// </summary>
    public static OdometerDisplay Project(
        OdometerSnapshot snapshot,
        OdometerCounterSize size,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string unitLabel = UnitLabels.Label(units.Distance);
        double odometerDisplay = UnitConverters.DistanceFromSi(snapshot.Odometer, units.Distance);
        double? totalDrivenDisplay = snapshot.TotalDistanceKm is { } km
            ? UnitConverters.DistanceFromSi(km, units.Distance)
            : null;

        string odometerValueText = ScalarFormatters.FormatNumber(odometerDisplay, 0);
        string totalDrivenValue = totalDrivenDisplay is { } driven
            ? string.Format(CultureInfo.CurrentCulture, "{0} {1}", ScalarFormatters.FormatNumber(driven, 0), unitLabel)
            : EmDash;

        string totalOdometerLabel = localizer.GetString("widget.odometer.total", "Total Odometer");
        string totalDrivenLabel = localizer.GetString("widget.odometer.totalDriven", "Total Driven");
        string unitTileLabel = localizer.GetString("widget.odometer.unit", "Unit");

        string compactAutomationName = string.Format(CultureInfo.CurrentCulture, "{0} {1}", odometerValueText, unitLabel);
        string expandedAutomationName = string.Format(
            CultureInfo.CurrentCulture, "{0}: {1} {2}", totalOdometerLabel, odometerValueText, unitLabel);
        string totalDrivenAutomationName = string.Format(
            CultureInfo.CurrentCulture, "{0}: {1}", totalDrivenLabel, totalDrivenValue);
        string unitTileAutomationName = string.Format(
            CultureInfo.CurrentCulture, "{0}: {1}", unitTileLabel, unitLabel);

        return new OdometerDisplay(
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            OdometerValue: odometerDisplay,
            OdometerValueText: odometerValueText,
            UnitLabel: unitLabel,
            ExpandedSuffix: string.Format(CultureInfo.CurrentCulture, " {0}", unitLabel),
            TotalOdometerLabel: totalOdometerLabel,
            TotalDrivenLabel: totalDrivenLabel,
            TotalDrivenValue: totalDrivenValue,
            TotalDrivenAutomationName: totalDrivenAutomationName,
            UnitTileLabel: unitTileLabel,
            UnitTileValue: unitLabel,
            UnitTileAutomationName: unitTileAutomationName,
            CompactAutomationName: compactAutomationName,
            ExpandedAutomationName: expandedAutomationName);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;OdometerSnapshot&gt;</c>, combining each parsed <see cref="OdometerReading"/> with
/// the once-resolved supplementary lifetime distance and preserving every freshness flag
/// (cached / refreshing / stale / offline). Mirroring the web inner gate, a value-bearing emission whose
/// state carries no odometer collapses to <see cref="RepositoryResult{T}.Empty"/> (the web
/// <c>&lt;EmptyState&gt;</c>). Kept pure so the parse-combine-preserve contract is unit-tested without a
/// network or cache.
/// </summary>
public static class OdometerCounterResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s state payload, fold in <paramref name="totalDistanceKm"/>, and preserve status.</summary>
    public static RepositoryResult<OdometerSnapshot> Map(RepositoryResult<JsonElement> raw, double? totalDistanceKm)
    {
        ArgumentNullException.ThrowIfNull(raw);

        OdometerSnapshot? Parse()
        {
            if (!raw.HasValue)
            {
                return null;
            }

            return OdometerReading.FromResponse(raw.Value) is { } reading
                ? new OdometerSnapshot(reading.Odometer, totalDistanceKm)
                : null;
        }

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<OdometerSnapshot>.Loading(),
            LoadStatus.Cached => WithValueOrEmpty(Parse(), raw, static (v, r) =>
                RepositoryResult<OdometerSnapshot>.Cached(v, r.FetchedAt!.Value, r.IsStale)),
            LoadStatus.Refreshing => WithValueOrEmpty(Parse(), raw, static (v, r) =>
                RepositoryResult<OdometerSnapshot>.Refreshing(v, r.FetchedAt!.Value, r.IsStale)),
            LoadStatus.Loaded => WithValueOrEmpty(Parse(), raw, static (v, r) =>
                RepositoryResult<OdometerSnapshot>.Loaded(v, r.FetchedAt ?? DateTimeOffset.UtcNow)),
            LoadStatus.Empty => RepositoryResult<OdometerSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => WithValueOrEmpty(Parse(), raw, static (v, r) =>
                RepositoryResult<OdometerSnapshot>.OfflineCached(v, r.FetchedAt!.Value, r.Error!)),
            _ => RepositoryResult<OdometerSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<OdometerSnapshot> WithValueOrEmpty(
        OdometerSnapshot? value,
        RepositoryResult<JsonElement> raw,
        Func<OdometerSnapshot, RepositoryResult<JsonElement>, RepositoryResult<OdometerSnapshot>> build) =>
        value is { } v ? build(v, raw) : RepositoryResult<OdometerSnapshot>.Empty(raw.FetchedAt);
}
