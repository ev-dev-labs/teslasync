using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="TripSummaryViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>TripSummaryWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/TripSummaryWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>trips.length === 0 ? &lt;EmptyState&gt; : …</c> gate (an empty trip list, or the query returning no
/// rows) — the friendly "No trips recorded yet" empty state. Faithful to the web, a transport failure with no
/// cached trips surfaces through the freshness "Error" chip plus the refresh affordance rather than a body
/// swap (<see cref="Error"/>), so the summary body is never replaced by a separate error panel.
/// </summary>
public enum TripSummaryState
{
    /// <summary>Initial fetch with no cached trips — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh list (or non-stale cache) carrying at least one trip to summarise.</summary>
    Loaded,

    /// <summary>An empty trip list — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached list exists — render the freshness error chip + refresh.</summary>
    Error,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One trip projected from the trip list (web <c>Trip</c> in web/src/api/types.ts). Only the fields the web
/// <c>TripSummaryWidget</c> reads are kept: the optional human <c>name</c>, the <c>start_date</c> /
/// <c>end_date</c> instants (for the short date label and the duration range), the SI distance in meters
/// (<c>total_distance_m</c>), and the <c>drive_count</c> / <c>charge_count</c> segment tallies. Field names
/// mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial row never throws.
/// </summary>
/// <param name="Id">The trip id (web <c>trip.id</c>).</param>
/// <param name="Name">The human trip name, or null (web <c>trip.name</c>).</param>
/// <param name="StartInstant">Parsed <c>start_date</c> instant used for the short date label and the
/// duration range, or null.</param>
/// <param name="EndInstant">Parsed <c>end_date</c> instant used for the duration range, or null.</param>
/// <param name="TotalDistanceM">Total distance travelled in meters (web <c>total_distance_m ?? 0</c>).</param>
/// <param name="DriveCount">Number of drive segments (web <c>drive_count ?? 0</c>).</param>
/// <param name="ChargeCount">Number of charge stops (web <c>charge_count ?? 0</c>).</param>
public sealed record TripSummaryTrip(
    long Id,
    string? Name,
    DateTimeOffset? StartInstant,
    DateTimeOffset? EndInstant,
    double TotalDistanceM,
    long DriveCount,
    long ChargeCount)
{
    /// <summary>Parse a trip-list JSON array into a tolerant list of rows, preserving server order.</summary>
    public static IReadOnlyList<TripSummaryTrip> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TripSummaryTrip>();
        }

        var list = new List<TripSummaryTrip>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single trip JSON object into a tolerant row.</summary>
    public static TripSummaryTrip FromJson(JsonElement obj) => new(
        GetLong(obj, "id"),
        GetString(obj, "name"),
        GetDateTime(obj, "start_date"),
        GetDateTime(obj, "end_date"),
        GetDouble(obj, "total_distance_m") ?? 0,
        (long)Math.Round(GetDouble(obj, "drive_count") ?? 0, MidpointRounding.AwayFromZero),
        (long)Math.Round(GetDouble(obj, "charge_count") ?? 0, MidpointRounding.AwayFromZero));

    private static long GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
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

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

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
            out var dt)
            ? dt
            : null;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols &lt;= 1</c> branch in
/// web/src/features/dashboard/widgets/TripSummaryWidget.tsx: when compact the featured stat grid drops from
/// four to two columns and each recent-trip row shows only the distance.
/// </summary>
public readonly record struct TripSummarySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static TripSummarySize Default => new(2, 4);

    /// <summary>True at one or fewer columns (web <c>isCompact</c>): drop to a two-up stat grid.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One projected, display-ready featured-trip statistic tile — the native analogue of a single web
/// <c>&lt;StatCard&gt;</c> in the featured card. Holds the localized label, the already-formatted value
/// (distance + unit, duration range, or an integer tally), the Segoe Fluent accent glyph, and the Narrator
/// automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">Localized tile label (e.g. "Distance").</param>
/// <param name="Value">Pre-formatted value (e.g. "12.3 km", "1h 5m", "3").</param>
/// <param name="Glyph">Segoe Fluent accent glyph mirroring the web lucide icon.</param>
/// <param name="AutomationName">Narrator name folding the label and value together.</param>
public sealed record TripStat(string Label, string Value, string Glyph, string AutomationName);

/// <summary>
/// The fully projected featured "Last Trip" card — the native analogue of the web featured block (the
/// "Last Trip" badge + date, the trip name, and the four-up stat grid). Holds the localized badge label, the
/// short date, the resolved trip name (or the "Unnamed trip" fallback), the four stat tiles, and the
/// card-level Narrator name. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="BadgeLabel">Localized "Last Trip" chip label.</param>
/// <param name="DateText">Short start-date label (web <c>formatDateShort</c>).</param>
/// <param name="Name">Resolved trip name or the localized "Unnamed trip" fallback.</param>
/// <param name="Stats">The four featured stat tiles, in web order.</param>
/// <param name="AutomationName">Narrator name folding the badge, date, name and stats together.</param>
public sealed record TripSummaryFeatured(
    string BadgeLabel,
    string DateText,
    string Name,
    IReadOnlyList<TripStat> Stats,
    string AutomationName);

/// <summary>
/// One projected, display-ready recent-trip row consumed by the WinUI view — the native analogue of a single
/// mapped row in the web "Recent Trips" list. Holds the resolved name, the short date, the already-formatted
/// distance, the duration range, the "{n} drv" segment badge, and a Narrator automation name. Pure data — no
/// WinUI types.
/// </summary>
/// <param name="Id">The trip id (used as the list key).</param>
/// <param name="Name">Resolved trip name or the localized "Unnamed trip" fallback.</param>
/// <param name="DateText">Short start-date label (web <c>formatDateShort</c>).</param>
/// <param name="DistanceText">Distance + unit (e.g. "8.0 km").</param>
/// <param name="DurationText">Duration range label (e.g. "25m"), or the em-dash fallback.</param>
/// <param name="DrivesBadgeText">Drive-segment badge text (e.g. "2 drv").</param>
/// <param name="AutomationName">Narrator name folding the row labels together.</param>
public sealed record TripSummaryRow(
    long Id,
    string Name,
    string DateText,
    string DistanceText,
    string DurationText,
    string DrivesBadgeText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the trip summary for one footprint — the native analogue of
/// everything the web component computes before returning JSX. Holds the compact-layout flag (the stat-grid
/// column count + per-row density), the data flag (web <c>trips.length &gt; 0</c>), the featured "Last Trip"
/// card, and the capped recent-trip rows. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="IsCompact">True when the surface is one column wide (web <c>isCompact</c>).</param>
/// <param name="HasData">True when at least one trip is present (web <c>trips.length &gt; 0</c>).</param>
/// <param name="Featured">The featured "Last Trip" card, or null when there is no data.</param>
/// <param name="RecentRows">The recent-trip rows (web <c>recentTrips.slice(1)</c>), in server order.</param>
public sealed record TripSummaryDisplay(
    bool IsCompact,
    bool HasData,
    TripSummaryFeatured? Featured,
    IReadOnlyList<TripSummaryRow> RecentRows);

/// <summary>
/// Pure projection from the raw trip list to the display model — the native port of the featured-trip block,
/// the recent-trip list slice, the SI→display distance conversion, and the duration/date formatting in
/// web/src/features/dashboard/widgets/TripSummaryWidget.tsx. Distances are converted from SI meters to the
/// user's display unit exactly as the web <c>convertDistanceFromSI</c> does (and only here); the duration is
/// the rounded-minutes range between <c>start_date</c> and <c>end_date</c> (web <c>formatDurationRange</c>).
/// The featured trip is <c>trips[0]</c> and the recent list is <c>trips[1..2]</c> (web
/// <c>recentTrips = trips.slice(0, 3)</c>, shown when <c>recentTrips.length &gt; 1</c>, rendering
/// <c>recentTrips.slice(1)</c>).
/// </summary>
public static class TripSummaryProjection
{
    /// <summary>Segoe Fluent "MapDirections" glyph for the header / empty state (web <c>Navigation</c>).</summary>
    public const string HeaderGlyph = "\uE816";

    /// <summary>Segoe Fluent "MapPin" glyph for the Distance stat (web <c>MapPin</c>).</summary>
    public const string DistanceGlyph = "\uE81D";

    /// <summary>Segoe Fluent "Recent" (clock) glyph for the Duration stat (web <c>Clock</c>).</summary>
    public const string DurationGlyph = "\uE823";

    /// <summary>Segoe Fluent "trending line" glyph for the Drives stat (web <c>Route</c>).</summary>
    public const string DrivesGlyph = "\uE9D2";

    /// <summary>Segoe Fluent "LightningBolt" glyph for the Charge Stops stat (web <c>Zap</c>).</summary>
    public const string ChargeStopsGlyph = "\uE945";

    /// <summary>How many trips the surface fetches (web <c>useTrips({ limit: 5 })</c>).</summary>
    public const int FetchLimit = 5;

    /// <summary>How many recent-trip rows are listed under the featured card (web <c>slice(1)</c> of three).</summary>
    public const int RecentRowLimit = 2;

    private const string EmDash = "\u2014";
    private const double MillisecondsPerMinute = 60_000.0;
    private const long MinutesPerHour = 60;

    /// <summary>Project <paramref name="trips"/> for <paramref name="size"/> using the user's distance unit.</summary>
    public static TripSummaryDisplay Project(
        IReadOnlyList<TripSummaryTrip> trips,
        TripSummarySize size,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(trips);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        bool isCompact = size.IsCompact;
        string distanceUnit = UnitLabels.Label(units.Distance);

        if (trips.Count == 0)
        {
            return new TripSummaryDisplay(isCompact, HasData: false, Featured: null, RecentRows: Array.Empty<TripSummaryRow>());
        }

        var featured = BuildFeatured(trips[0], units, distanceUnit, localizer, now);

        // Web parity: recentTrips = trips.slice(0, 3); rendered list = recentTrips.slice(1) — i.e. trips[1..2].
        int recentCount = Math.Min(Math.Max(trips.Count - 1, 0), RecentRowLimit);
        var rows = new List<TripSummaryRow>(recentCount);
        for (int i = 1; i <= recentCount; i++)
        {
            rows.Add(BuildRow(trips[i], units, distanceUnit, localizer, now));
        }

        return new TripSummaryDisplay(isCompact, HasData: true, featured, rows);
    }

    /// <summary>
    /// Format the rounded-minutes duration between two instants (web <c>formatDurationRange</c>): the em-dash
    /// for a missing endpoint or a non-positive / non-finite span, otherwise "{m}m" or "{h}h {m}m".
    /// </summary>
    public static string FormatDurationRange(DateTimeOffset? start, DateTimeOffset? end)
    {
        if (start is not { } s || end is not { } e)
        {
            return EmDash;
        }

        double ms = (e - s).TotalMilliseconds;
        if (double.IsNaN(ms) || double.IsInfinity(ms) || ms <= 0)
        {
            return EmDash;
        }

        long minutes = (long)Math.Round(ms / MillisecondsPerMinute, MidpointRounding.AwayFromZero);
        if (minutes < 0)
        {
            return EmDash;
        }

        long hours = minutes / MinutesPerHour;
        string mins = ScalarFormatters.FormatNumber(minutes % MinutesPerHour, 0);
        return hours > 0
            ? string.Create(CultureInfo.InvariantCulture, $"{hours}h {mins}m")
            : mins + "m";
    }

    /// <summary>Format an SI-meters distance for display as "{value} {unit}" (web <c>fmtNumber(displayDist, 1)</c>).</summary>
    public static string FormatDistance(double meters, UnitPref units, string distanceUnit)
    {
        ArgumentNullException.ThrowIfNull(units);
        double value = UnitConverters.DistanceFromSi(meters, units.Distance);
        return ScalarFormatters.FormatNumber(value, 1) + " " + distanceUnit;
    }

    private static TripSummaryFeatured BuildFeatured(
        TripSummaryTrip trip, UnitPref units, string distanceUnit, ILocalizer localizer, DateTimeOffset now)
    {
        string badgeLabel = localizer.GetString("widget.lastTrip", "Last Trip");
        string dateText = DateTimeFormatting.Format(trip.StartInstant, DateTimeVariant.Short, now);
        string name = ResolveName(trip.Name, localizer);

        var stats = new List<TripStat>(4)
        {
            Stat(localizer.GetString("widget.distance", "Distance"), FormatDistance(trip.TotalDistanceM, units, distanceUnit), DistanceGlyph),
            Stat(localizer.GetString("widget.duration", "Duration"), FormatDurationRange(trip.StartInstant, trip.EndInstant), DurationGlyph),
            Stat(localizer.GetString("widget.drives", "Drives"), ScalarFormatters.FormatNumber(trip.DriveCount, 0), DrivesGlyph),
            Stat(localizer.GetString("widget.chargeStops", "Charge Stops"), ScalarFormatters.FormatNumber(trip.ChargeCount, 0), ChargeStopsGlyph),
        };

        string automationName = BuildFeaturedAutomationName(badgeLabel, dateText, name, stats);
        return new TripSummaryFeatured(badgeLabel, dateText, name, stats, automationName);
    }

    private static TripSummaryRow BuildRow(
        TripSummaryTrip trip, UnitPref units, string distanceUnit, ILocalizer localizer, DateTimeOffset now)
    {
        string name = ResolveName(trip.Name, localizer);
        string dateText = DateTimeFormatting.Format(trip.StartInstant, DateTimeVariant.Short, now);
        string distanceText = FormatDistance(trip.TotalDistanceM, units, distanceUnit);
        string durationText = FormatDurationRange(trip.StartInstant, trip.EndInstant);
        string drivesBadge = string.Create(
            CultureInfo.InvariantCulture,
            $"{ScalarFormatters.FormatNumber(trip.DriveCount, 0)} {localizer.GetString("widget.drivesShort", "drv")}");

        string automationName = string.Join(", ", name, dateText, distanceText, durationText, drivesBadge);
        return new TripSummaryRow(trip.Id, name, dateText, distanceText, durationText, drivesBadge, automationName);
    }

    private static TripStat Stat(string label, string value, string glyph) =>
        new(label, value, glyph, label + ": " + value);

    private static string ResolveName(string? name, ILocalizer localizer) =>
        string.IsNullOrWhiteSpace(name) ? localizer.GetString("widget.tripUnnamed", "Unnamed trip") : name;

    private static string BuildFeaturedAutomationName(
        string badge, string date, string name, List<TripStat> stats)
    {
        var parts = new List<string>(3 + stats.Count) { badge, date, name };
        foreach (var stat in stats)
        {
            parts.Add(stat.AutomationName);
        }

        return string.Join(", ", parts);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;TripSummaryTrip&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// empty-list gate (web's <c>trips.length === 0</c>) is applied by the view-model, so a populated-but-empty
/// list still flows through with its freshness intact. Kept pure so the parse-and-preserve contract is
/// unit-tested without a network or cache.
/// </summary>
public static class TripSummaryResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<TripSummaryTrip>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<TripSummaryTrip> Parse() =>
            raw.HasValue ? TripSummaryTrip.ParseList(raw.Value) : Array.Empty<TripSummaryTrip>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<TripSummaryTrip>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
