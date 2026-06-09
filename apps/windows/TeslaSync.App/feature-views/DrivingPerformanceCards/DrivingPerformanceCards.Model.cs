using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="DrivingPerformanceCardsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. It is a strict superset
/// of the web component (web/src/features/analytics/components/analytics/DrivingPerformanceCards.tsx), which
/// is a presentational grid that simply shows an em-dash per missing stat; the native feature-view owns its
/// own fleet-analytics read and therefore renders the full state matrix the prompt mandates. Every branch
/// maps onto a visible surface — none is ever hidden. <see cref="Empty"/> mirrors a fleet snapshot that
/// carries no drive analytics at all (rather than an empty HTTP body — the fleet endpoint always returns a
/// populated object).
/// </summary>
public enum DrivingPerformanceState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton tiles.</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) with at least one stat group to show.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no drive-analytics stat groups — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One drive-analytics statistics group (web <c>StatsSummary</c>) reduced to the two fields the surface
/// consumes — <see cref="Max"/> and <see cref="Avg"/>. Both are already <c>safe()</c>-coerced at parse time
/// (web <c>safe(v) = isFinite(v) ? v : 0</c>) so a missing/NaN field renders as a literal "0", exactly as
/// the web does when the parent stat object is present. A null <see cref="DrivingStat"/> (the parent group
/// absent entirely) is what drives the per-card em-dash.
/// </summary>
public sealed record DrivingStat(double Max, double Avg);

/// <summary>
/// The drive-analytics slice of <c>GET /analytics/fleet</c> the surface needs — the four stat groups the web
/// component reads off <c>data.drive_analytics</c> (<c>speed_stats</c>, <c>power_stats</c>, <c>regen_stats</c>,
/// <c>distance_stats</c>). Each is nullable: present (even when empty) → a zero-filled <see cref="DrivingStat"/>,
/// absent → null (the card shows an em-dash). Parsing is null-tolerant so a partial or schema-drifted body
/// never throws. Speed is kilometres-per-hour and distance is kilometres on the wire (both derived SI) — both
/// converted to the user's display unit only at projection time. Power and regen are kilowatts and need no
/// conversion.
/// </summary>
public sealed record DrivingPerformanceSnapshot(
    DrivingStat? Speed,
    DrivingStat? Power,
    DrivingStat? Regen,
    DrivingStat? Distance)
{
    /// <summary>An all-absent snapshot — the parse fallback for an absent/non-object body.</summary>
    public static DrivingPerformanceSnapshot Empty { get; } = new(null, null, null, null);

    /// <summary>
    /// True when at least one stat group is present — i.e. there is something worth charting. Gates the empty
    /// state (the web grid always renders, showing em-dashes; the native superset renders a friendly empty
    /// surface when no group is present and otherwise renders the grid with per-card em-dashes).
    /// </summary>
    public bool HasData => Speed is not null || Power is not null || Regen is not null || Distance is not null;

    /// <summary>Project a <c>GET /analytics/fleet</c> JSON object into a tolerant drive-analytics snapshot.</summary>
    public static DrivingPerformanceSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty("drive_analytics", out var da)
            || da.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new DrivingPerformanceSnapshot(
            Speed: ReadStat(da, "speed_stats"),
            Power: ReadStat(da, "power_stats"),
            Regen: ReadStat(da, "regen_stats"),
            Distance: ReadStat(da, "distance_stats"));
    }

    // web: `ss = da?.speed_stats` — a present (object) group, even an empty one, is truthy and renders
    // safe(undefined)=0; an absent group is undefined and renders the em-dash. Mirror that: an object yields
    // a zero-filled stat, anything else yields null.
    private static DrivingStat? ReadStat(JsonElement driveAnalytics, string name)
    {
        if (!driveAnalytics.TryGetProperty(name, out var stat) || stat.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new DrivingStat(Safe(GetDouble(stat, "max")), Safe(GetDouble(stat, "avg")));
    }

    // web `safe`: a finite number passes through; everything else (null / NaN / ∞ / non-number) becomes 0.
    private static double Safe(double? value) =>
        value is { } v && !double.IsNaN(v) && !double.IsInfinity(v) ? v : 0;

    private static double? GetDouble(JsonElement obj, string name)
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
/// One projected, display-ready metric tile consumed by the WinUI view — the native analogue of a web
/// <c>MetricCard</c> instance. Holds the localized label, the already-formatted value (or em-dash), the unit
/// subtitle, the resolved Fluent glyph, the categorical palette index (so each tile gets the web's accent
/// colour grouping), and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record DrivingMetricCard(
    string Label,
    string Value,
    string Subtitle,
    string Glyph,
    int ColorIndex,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the driving-performance grid — the six tiles plus the
/// <see cref="HasData"/> gate. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record DrivingPerformanceDisplay(bool HasData, IReadOnlyList<DrivingMetricCard> Cards)
{
    /// <summary>An empty projection (no tiles) — the projection fallback.</summary>
    public static DrivingPerformanceDisplay Empty { get; } = new(false, Array.Empty<DrivingMetricCard>());
}

/// <summary>
/// Pure projection from a parsed <see cref="DrivingPerformanceSnapshot"/> to the six display tiles — the
/// native port of the unit conversion + <c>MetricCard</c> composition in
/// web/src/features/analytics/components/analytics/DrivingPerformanceCards.tsx. SI is converted to the user's
/// display unit here (and only here); every label resolves through the i18n facade. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class DrivingPerformanceProjection
{
    /// <summary>1 km = 1000 m (web <c>METERS_PER_KM</c>).</summary>
    public const double MetersPerKm = 1000.0;

    /// <summary>Seconds per hour (web <c>SECONDS_PER_HOUR</c>).</summary>
    public const double SecondsPerHour = 3600.0;

    /// <summary>Em-dash shown when a stat group is absent (web parity '—').</summary>
    public const string EmDash = "\u2014";

    // Segoe Fluent / MDL2 glyphs standing in for the web lucide icons (Gauge, TrendingUp, Zap,
    // BatteryCharging, MapPin, Car).
    private const string SpeedGlyph = "\uE950";        // gauge / pulse
    private const string TrendingUpGlyph = "\uE9D2";   // trending up
    private const string PowerGlyph = "\uE945";        // lightning
    private const string RegenGlyph = "\uE83F";        // battery
    private const string DistanceGlyph = "\uE707";     // map pin
    private const string DriveGlyph = "\uE804";        // car

    /// <summary>The kilowatt unit suffix the power/regen tiles render (web <c>subtitle="kW"</c>).</summary>
    public const string PowerUnitLabel = "kW";

    /// <summary>Project <paramref name="data"/> into the six metric tiles using the user's units.</summary>
    public static DrivingPerformanceDisplay Project(
        DrivingPerformanceSnapshot data,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var speedUnit = units.Speed;
        var distanceUnit = units.Distance;
        string speedUnitLabel = UnitLabels.Label(speedUnit);
        string distanceUnitLabel = UnitLabels.Label(distanceUnit);

        // backend speed_stats is km/h; SI floor is m/s (web `fromKmh`).
        double FromKmh(double kmh) => UnitConverters.SpeedFromSi(kmh * MetersPerKm / SecondsPerHour, speedUnit);

        // backend distance_stats is km; SI floor is metres (web `fromKm`).
        double FromKm(double km) => UnitConverters.DistanceFromSi(km * MetersPerKm, distanceUnit);

        string topSpeedLabel = localizer.GetString("analytics.driving.topSpeed", "Top Speed");
        string avgSpeedLabel = localizer.GetString("analytics.driving.avgSpeed", "Avg Speed");
        string peakPowerLabel = localizer.GetString("analytics.driving.peakPower", "Peak Power");
        string peakRegenLabel = localizer.GetString("analytics.driving.peakRegen", "Peak Regen");
        string avgDistLabel = localizer.GetString("analytics.driving.avgDriveDist", "Avg Drive Distance");
        string longestLabel = localizer.GetString("analytics.driving.longestDrive", "Longest Drive");

        // Card values: a present stat group renders the formatted number (fields are already safe()-coerced);
        // an absent group renders the em-dash (web `ss ? fmtNumber(...) : '—'`). The colour indices reproduce
        // the web's accent grouping (cyan/purple/amber/green, with cyan & purple each shared by two tiles).
        var cards = new List<DrivingMetricCard>(6)
        {
            Card(topSpeedLabel, data.Speed is { } s1 ? Number(FromKmh(s1.Max), 0) : EmDash, speedUnitLabel, SpeedGlyph, 0),
            Card(avgSpeedLabel, data.Speed is { } s2 ? Number(FromKmh(s2.Avg), 0) : EmDash, speedUnitLabel, TrendingUpGlyph, 1),
            Card(peakPowerLabel, data.Power is { } p ? Number(p.Max, 0) : EmDash, PowerUnitLabel, PowerGlyph, 2),
            Card(peakRegenLabel, data.Regen is { } r ? Number(r.Max, 0) : EmDash, PowerUnitLabel, RegenGlyph, 3),
            Card(avgDistLabel, data.Distance is { } d1 ? Number(FromKm(d1.Avg), 1) : EmDash, distanceUnitLabel, DistanceGlyph, 0),
            Card(longestLabel, data.Distance is { } d2 ? Number(FromKm(d2.Max), 1) : EmDash, distanceUnitLabel, DriveGlyph, 1),
        };

        return new DrivingPerformanceDisplay(data.HasData, cards);
    }

    private static DrivingMetricCard Card(string label, string value, string subtitle, string glyph, int colorIndex) =>
        new(label, value, subtitle, glyph, colorIndex, AutomationName(label, value, subtitle));

    // web `fmtNumber(value, decimals)`: the value is always finite here (safe()-coerced), so it formats the
    // number rather than the em-dash fallback the formatter uses for null/NaN.
    private static string Number(double value, int decimals) => ScalarFormatters.FormatNumber(value, decimals);

    private static string AutomationName(string label, string value, string subtitle) =>
        value == EmDash
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, subtitle);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;DrivingPerformanceSnapshot&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class DrivingPerformanceResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<DrivingPerformanceSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        DrivingPerformanceSnapshot Parse() =>
            raw.HasValue ? DrivingPerformanceSnapshot.FromJson(raw.Value) : DrivingPerformanceSnapshot.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<DrivingPerformanceSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<DrivingPerformanceSnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<DrivingPerformanceSnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<DrivingPerformanceSnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<DrivingPerformanceSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<DrivingPerformanceSnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<DrivingPerformanceSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Driving Performance Cards surface — the native mirror of the web
/// component (web/src/features/analytics/components/analytics/DrivingPerformanceCards.tsx, rendered by the
/// analytics Driving tab). Centralises the stable id, category, diagnostics slug and the trailing analytics
/// window so the view and view-model stay free of literal identifiers.
/// </summary>
public static class DrivingPerformanceCardsRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "driving-performance-cards";

    /// <summary>Surface category (matches the web analytics feature).</summary>
    public const string Category = "analytics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "DrivingPerformanceCards";

    /// <summary>
    /// The trailing window the surface requests, mirroring the web analytics page's default <c>30d</c> range
    /// preset (<c>useRangeState({ defaultPresetId: '30d' })</c> → <c>useFleetAnalytics</c>).
    /// </summary>
    public const int DefaultDays = 30;
}

/// <summary>
/// PII-safe diagnostics for the Driving Performance Cards surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a fleet metric, VIN or location —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class DrivingPerformanceCardsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DrivingPerformanceCardsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DrivingPerformanceCards</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DrivingPerformanceCardsRegistration.Slug}");
    }
}
