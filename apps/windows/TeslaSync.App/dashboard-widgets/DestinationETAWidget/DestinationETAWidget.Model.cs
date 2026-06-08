using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="DestinationETAViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>DestinationETAWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/DestinationETAWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>!snapshot</c> gate — the
/// response carried no location snapshot — the "No location data" surface. A resolved snapshot is always
/// <see cref="Loaded"/> (or stale / offline) whether or not it is actively navigating; the active-navigation vs
/// location-badge choice is a projection detail, not a separate state.
/// </summary>
public enum DestinationETAState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying a location snapshot to render.</summary>
    Loaded,

    /// <summary>No location snapshot in the response — render the "No location data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the body plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the body plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The fields the destination-ETA view reads from <c>GET /location-snapshots/latest?vehicle_id={id}</c> — the
/// native mirror of the exact <c>LocationSnapshot</c> slice the web widget consumes. The web component reads
/// <c>destination_name</c> (the active-navigation gate), <c>miles_to_arrival</c> (SI metres — Phase-48 stores SI
/// despite the legacy field name, and the web converts it via <c>convertDistanceFromSI</c>),
/// <c>minutes_to_arrival</c> (minutes, used directly) and the three presence booleans
/// <c>located_at_home</c> / <c>located_at_work</c> / <c>located_at_favorite</c>. Those exact wire names are read
/// here verbatim so the native surface reproduces the web's observable output. A <see langword="null"/> parse
/// result models the web <c>snapshot</c> being null/undefined (no snapshot → the "No location data" surface); a
/// missing numeric field parses to <c>0</c> exactly like the web <c>?? 0</c> coalescing.
/// </summary>
/// <param name="DestinationName">Active-navigation destination name, or null (web <c>destination_name</c>).</param>
/// <param name="DistanceMeters">Remaining distance in SI metres (web <c>miles_to_arrival</c>, defaulted to 0).</param>
/// <param name="MinutesToArrival">Remaining time in minutes (web <c>minutes_to_arrival</c>, defaulted to 0).</param>
/// <param name="LocatedAtHome">Whether the vehicle is at home (web <c>located_at_home</c>).</param>
/// <param name="LocatedAtWork">Whether the vehicle is at work (web <c>located_at_work</c>).</param>
/// <param name="LocatedAtFavorite">Whether the vehicle is at a favourite (web <c>located_at_favorite</c>).</param>
public sealed record DestinationETAReading(
    string? DestinationName,
    double DistanceMeters,
    double MinutesToArrival,
    bool LocatedAtHome,
    bool LocatedAtWork,
    bool LocatedAtFavorite)
{
    /// <summary>
    /// Project a <c>GET /location-snapshots/latest</c> response into the snapshot slice. Returns
    /// <see langword="null"/> when the body is not a JSON object — the native analogue of the web
    /// <c>snapshot</c> being null (the "No location data" surface). Any object yields a reading (matching the
    /// web's truthy <c>snapshot</c> gate); absent numeric fields coalesce to <c>0</c> exactly like the web's
    /// <c>?? 0</c> guards so a partial body never throws.
    /// </summary>
    public static DestinationETAReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new DestinationETAReading(
            DestinationName: ReadString(root, "destination_name"),
            DistanceMeters: ReadDouble(root, "miles_to_arrival") ?? 0,
            MinutesToArrival: ReadDouble(root, "minutes_to_arrival") ?? 0,
            LocatedAtHome: ReadBool(root, "located_at_home"),
            LocatedAtWork: ReadBool(root, "located_at_work"),
            LocatedAtFavorite: ReadBool(root, "located_at_favorite"));
    }

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

    private static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

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
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c>. Unlike most surfaces,
/// the web <c>DestinationETAWidget</c> branches on <c>size.cols &lt;= 1</c> to choose a compact (1×2) versus
/// standard (2×2+) layout, so the footprint is observable — see <see cref="IsCompact"/>.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct DestinationETASize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static DestinationETASize Default => new(2, 2);

    /// <summary>True at the compact footprint (web <c>size.cols &lt;= 1</c>).</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// The location-presence badge the web <c>locationBadge()</c> helper computes — an emoji, a localized label and a
/// semantic status. Home → success, work / favourite → neutral, anything else → warning, in that priority order.
/// </summary>
/// <param name="Emoji">The presence emoji (web 🏠 / 🏢 / ⭐ / 📍).</param>
/// <param name="Label">The localized presence label (Home / Work / Favorite / Other).</param>
/// <param name="Status">The semantic status driving the chip colour.</param>
public sealed record LocationBadgeInfo(string Emoji, string Label, StatusKind Status);

/// <summary>
/// The fully projected, render-ready view of the destination-ETA surface for one unit preference — the native
/// analogue of everything the web component computes before returning JSX (the active-navigation gate, the
/// unit-converted distance string, the rounded ETA minutes, the hour/minute detail string, the progress fraction
/// and the location badge). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="IsNavigating">Whether the vehicle is actively navigating (web <c>isNavigating</c>).</param>
/// <param name="DestinationName">The destination name (navigating only), or the em dash.</param>
/// <param name="EtaMinutes">The rounded remaining minutes shown as the big number (web <c>Math.round(min)</c>).</param>
/// <param name="EtaDetailText">The hour/minute detail string, e.g. "1h 05m" or "45m" (web <c>etaDisplay</c>).</param>
/// <param name="DistanceText">The unit-converted remaining distance, e.g. "12.3" (web <c>fmtNumber(displayDistance, 1)</c>).</param>
/// <param name="DistanceUnitLabel">The distance unit label, e.g. "km" / "mi" (web <c>distanceUnit</c>).</param>
/// <param name="ProgressPercent">The 0..100 progress-bar fill (web <c>progressPercent</c>).</param>
/// <param name="LocationEmoji">The location-badge emoji (not-navigating only).</param>
/// <param name="LocationLabel">The localized location-badge label.</param>
/// <param name="LocationStatus">The location-badge semantic status.</param>
/// <param name="EtaLabel">Localized "ETA" label.</param>
/// <param name="MinLabel">Localized "min" unit.</param>
/// <param name="RemainingLabel">Localized "Remaining" label.</param>
/// <param name="NoNavLabel">Localized "No active navigation" label.</param>
/// <param name="AutomationName">Narrator name summarising the rendered surface.</param>
public sealed record DestinationETADisplay(
    bool IsNavigating,
    string DestinationName,
    double EtaMinutes,
    string EtaDetailText,
    string DistanceText,
    string DistanceUnitLabel,
    double ProgressPercent,
    string LocationEmoji,
    string LocationLabel,
    StatusKind LocationStatus,
    string EtaLabel,
    string MinLabel,
    string RemainingLabel,
    string NoNavLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="DestinationETAReading"/> to the display model — the native port of the
/// web component's inline computation in web/src/features/dashboard/widgets/DestinationETAWidget.tsx. The
/// remaining distance honours the user's distance preference exactly like the web
/// <c>convertDistanceFromSI(miles_to_arrival, unit)</c>; the ETA big number reproduces the web
/// <c>Math.round(minutes_to_arrival)</c>; the hour/minute detail reproduces the web <c>etaDisplay</c>; the
/// progress fraction reproduces the web <c>progressPercent</c> formula verbatim (including its
/// metres-domain quirk). Every label resolves through the i18n facade.
/// </summary>
public static class DestinationETAProjection
{
    /// <summary>The em dash the web renders for an absent value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Distance fraction digits (web <c>fmtNumber(displayDistance, 1)</c>).</summary>
    public const int DistancePrecision = 1;

    /// <summary>The web 🏠 home emoji.</summary>
    public const string HomeEmoji = "\U0001F3E0";

    /// <summary>The web 🏢 work emoji.</summary>
    public const string WorkEmoji = "\U0001F3E2";

    /// <summary>The web ⭐ favourite emoji.</summary>
    public const string FavoriteEmoji = "\u2B50";

    /// <summary>The web 📍 other emoji.</summary>
    public const string OtherEmoji = "\U0001F4CD";

    private const double MinutesPerHour = 60.0;

    /// <summary>Project <paramref name="reading"/> for <paramref name="units"/> using the localizer for every label.</summary>
    public static DestinationETADisplay Project(DestinationETAReading reading, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        bool navigating = IsNavigating(reading);
        LocationBadgeInfo badge = LocationBadge(reading, localizer);

        string destinationName = string.IsNullOrEmpty(reading.DestinationName) ? EmDash : reading.DestinationName!;
        double etaMinutes = Math.Round(reading.MinutesToArrival, MidpointRounding.AwayFromZero);
        string etaDetail = FormatEtaDetail(reading.MinutesToArrival);
        string distanceText = FormatDistance(reading.DistanceMeters, units);
        string distanceUnit = UnitLabels.Label(units.Distance);
        double progress = ProgressPercent(reading.DistanceMeters, navigating);

        string etaLabel = localizer.GetString("widget.destinationETA.eta", "ETA");
        string minLabel = localizer.GetString("widget.destinationETA.min", "min");
        string remainingLabel = localizer.GetString("widget.destinationETA.remaining", "Remaining");
        string noNavLabel = localizer.GetString("widget.destinationETA.noNav", "No active navigation");

        string automation = navigating
            ? $"{destinationName}, {etaLabel} {ScalarFormatters.FormatNumber(etaMinutes, 0)} {minLabel}, {remainingLabel} {distanceText} {distanceUnit}"
            : $"{badge.Label}, {noNavLabel}";

        return new DestinationETADisplay(
            IsNavigating: navigating,
            DestinationName: destinationName,
            EtaMinutes: etaMinutes,
            EtaDetailText: etaDetail,
            DistanceText: distanceText,
            DistanceUnitLabel: distanceUnit,
            ProgressPercent: progress,
            LocationEmoji: badge.Emoji,
            LocationLabel: badge.Label,
            LocationStatus: badge.Status,
            EtaLabel: etaLabel,
            MinLabel: minLabel,
            RemainingLabel: remainingLabel,
            NoNavLabel: noNavLabel,
            AutomationName: automation);
    }

    /// <summary>True when the vehicle is actively navigating (web <c>destination_name != null &amp;&amp; destination_name !== ''</c>).</summary>
    public static bool IsNavigating(DestinationETAReading reading)
    {
        ArgumentNullException.ThrowIfNull(reading);
        return !string.IsNullOrEmpty(reading.DestinationName);
    }

    /// <summary>The location-presence badge, in the web's home → work → favourite → other priority.</summary>
    public static LocationBadgeInfo LocationBadge(DestinationETAReading reading, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        if (reading.LocatedAtHome)
        {
            return new LocationBadgeInfo(HomeEmoji, localizer.GetString("widget.destinationETA.home", "Home"), StatusKind.Success);
        }

        if (reading.LocatedAtWork)
        {
            return new LocationBadgeInfo(WorkEmoji, localizer.GetString("widget.destinationETA.work", "Work"), StatusKind.Neutral);
        }

        if (reading.LocatedAtFavorite)
        {
            return new LocationBadgeInfo(FavoriteEmoji, localizer.GetString("widget.destinationETA.favorite", "Favorite"), StatusKind.Neutral);
        }

        return new LocationBadgeInfo(OtherEmoji, localizer.GetString("widget.destinationETA.other", "Other"), StatusKind.Warning);
    }

    /// <summary>
    /// Format the remaining distance the way the web does — <c>fmtNumber(convertDistanceFromSI(metres, unit), 1)</c>.
    /// The reading carries SI metres (Phase-48), so this converts at the display boundary only.
    /// </summary>
    public static string FormatDistance(double meters, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        double display = UnitConverters.DistanceFromSi(meters, units.Distance);
        return ScalarFormatters.FormatNumber(display, DistancePrecision);
    }

    /// <summary>
    /// Format the hour/minute ETA detail the way the web does — <c>etaHours &gt; 0 ? `${h}h ${m}m` : `${m}m`</c>
    /// where <c>h = floor(min / 60)</c> and <c>m = round(min % 60)</c> (both via <c>fmtInt</c>).
    /// </summary>
    public static string FormatEtaDetail(double minutes)
    {
        double safe = double.IsNaN(minutes) || double.IsInfinity(minutes) ? 0 : minutes;
        int etaHours = (int)Math.Floor(safe / MinutesPerHour);
        long etaMins = (long)Math.Round(safe % MinutesPerHour, MidpointRounding.AwayFromZero);

        string m = ScalarFormatters.FormatNumber(etaMins, 0);
        if (etaHours > 0)
        {
            string h = ScalarFormatters.FormatNumber(etaHours, 0);
            return $"{h}h {m}m";
        }

        return $"{m}m";
    }

    /// <summary>
    /// The 0..100 progress fill, reproducing the web formula verbatim:
    /// <c>navigating &amp;&amp; metres &gt; 0 ? clamp(0, 100, 100 - metres / (metres + 1) * 100) : 0</c>.
    /// </summary>
    public static double ProgressPercent(double distanceMeters, bool navigating)
    {
        if (!navigating || distanceMeters <= 0 || double.IsNaN(distanceMeters) || double.IsInfinity(distanceMeters))
        {
            return 0;
        }

        double p = 100.0 - (distanceMeters / (distanceMeters + 1.0) * 100.0);
        return Math.Max(0.0, Math.Min(100.0, p));
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;DestinationETAReading&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline). A successful emission whose body carries no location snapshot collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>!snapshot</c> gate. Kept pure so
/// the parse-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class DestinationETAResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s snapshot payload (when present) and preserve the load status.</summary>
    public static RepositoryResult<DestinationETAReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        DestinationETAReading? Parse() =>
            raw.HasValue ? DestinationETAReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<DestinationETAReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<DestinationETAReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<DestinationETAReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<DestinationETAReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<DestinationETAReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<DestinationETAReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<DestinationETAReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<DestinationETAReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<DestinationETAReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<DestinationETAReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<DestinationETAReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
