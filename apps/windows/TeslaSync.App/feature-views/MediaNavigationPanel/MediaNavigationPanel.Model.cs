using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="MediaNavigationPanelViewModel"/> can be in — the native
/// union of the branches the web Media &amp; Navigation panel renders
/// (web/src/features/vehicles/components/telemetry-panels/MediaNavigationPanel.tsx). The web component is a pure
/// child of the live-telemetry grid (it takes pre-resolved <c>mediaData</c> + <c>locationData</c> props); the
/// native surface binds its own cache-then-network reads (the media snapshot from <c>GET /media/latest</c> plus
/// the location snapshot from <c>GET /location-snapshots/latest</c>) and so owns the full loading / loaded /
/// empty / error / stale / offline matrix the P2 state contract requires. Every value maps onto a visible
/// surface (never a blank panel): <see cref="Loaded"/>, <see cref="Stale"/> and <see cref="Offline"/> render the
/// Now-Playing and Navigation sections (with the stale / offline chip for the latter two), <see cref="Empty"/>
/// renders the friendly empty surface (no media object and no location object), <see cref="Loading"/> shows the
/// skeleton chrome and <see cref="Error"/> the retry surface.
/// </summary>
public enum MediaNavigationPanelState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot with a media object and/or a location object.</summary>
    Loaded,

    /// <summary>The snapshot resolved but there is no media object and no location object — render the empty surface.</summary>
    Empty,

    /// <summary>The media request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the sections plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the sections plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The media fields the surface reads from <c>GET /media/latest?vehicle_id={id}</c> — the native mirror of the
/// exact <c>MediaSnapshot</c> slice the web <c>MediaNavigationPanel</c> consumes (<c>now_playing_title</c>,
/// <c>now_playing_artist</c>, <c>playback_source</c>, <c>playback_status</c>). Every field is run through the web
/// <c>cleanNil</c> filter at parse time (so the literal Go-nil strings <c>"&lt;nil&gt;"</c> / <c>"nil"</c> /
/// <c>"null"</c> and empty strings collapse to <see langword="null"/>, matching the web), and a
/// <see langword="null"/> parse result models the web <c>mediaData</c> being null/undefined (no media object). An
/// object with every field missing still parses (all-null) so the Now-Playing card renders with its
/// "Nothing playing" / "Unknown artist" fallbacks, matching the web. WinUI-free so the parse is unit-tested
/// without a UI host.
/// </summary>
/// <param name="NowPlayingTitle">Cleaned track title, or null (web <c>now_playing_title</c>).</param>
/// <param name="NowPlayingArtist">Cleaned artist, or null (web <c>now_playing_artist</c>).</param>
/// <param name="PlaybackSource">Cleaned playback source, or null (web <c>playback_source</c>).</param>
/// <param name="PlaybackStatus">Cleaned playback status, or null (web <c>playback_status</c>).</param>
public sealed record MediaReading(
    string? NowPlayingTitle,
    string? NowPlayingArtist,
    string? PlaybackSource,
    string? PlaybackStatus)
{
    /// <summary>
    /// Project a <c>GET /media/latest</c> response into the media slice, mirroring the web reads. Returns
    /// <see langword="null"/> for a non-object body — the native analogue of the web <c>mediaData</c> being
    /// null/undefined. Each string field is filtered through <see cref="MediaNavValues.CleanNil"/> so it matches
    /// the web's render-time <c>cleanNil</c> guard.
    /// </summary>
    public static MediaReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new MediaReading(
            NowPlayingTitle: MediaNavValues.CleanNil(MediaNavValues.ReadString(root, "now_playing_title")),
            NowPlayingArtist: MediaNavValues.CleanNil(MediaNavValues.ReadString(root, "now_playing_artist")),
            PlaybackSource: MediaNavValues.CleanNil(MediaNavValues.ReadString(root, "playback_source")),
            PlaybackStatus: MediaNavValues.CleanNil(MediaNavValues.ReadString(root, "playback_status")));
    }
}

/// <summary>
/// The location / navigation fields the surface reads from <c>GET /location-snapshots/latest?vehicle_id={id}</c>
/// — the native mirror of the exact <c>LocationSnapshot</c> slice the web <c>MediaNavigationPanel</c> consumes.
/// A <see langword="null"/> parse result models the web <c>locationData</c> being null/undefined (no location
/// object). <see cref="DistanceToArrivalM"/> is read from the wire field <c>miles_to_arrival</c>, which — despite
/// its legacy name — carries SI metres (the web converts it with <c>convertDistanceFromSI</c>); it is held in SI
/// and converted to the display unit once at the render boundary. <see cref="MinutesToArrival"/> is already in
/// whole minutes on the wire (the web renders it verbatim through <c>fmtInt</c>, with no conversion). WinUI-free
/// so the parse is unit-tested without a UI host.
/// </summary>
/// <param name="DestinationName">Active route destination name, or null (web <c>destination_name</c>).</param>
/// <param name="DistanceToArrivalM">Distance remaining in SI metres, or null (web <c>miles_to_arrival</c>).</param>
/// <param name="MinutesToArrival">Minutes remaining (already minutes), or null (web <c>minutes_to_arrival</c>).</param>
/// <param name="LocatedAtHome">Whether the vehicle is at the home place (web <c>located_at_home</c>).</param>
/// <param name="LocatedAtWork">Whether the vehicle is at the work place (web <c>located_at_work</c>).</param>
/// <param name="LocatedAtFavorite">Whether the vehicle is at a favorite place (web <c>located_at_favorite</c>).</param>
public sealed record NavigationReading(
    string? DestinationName,
    double? DistanceToArrivalM,
    double? MinutesToArrival,
    bool LocatedAtHome,
    bool LocatedAtWork,
    bool LocatedAtFavorite)
{
    /// <summary>True when an active route destination name is present (web <c>destination_name ?</c> guard).</summary>
    public bool HasDestination => !string.IsNullOrEmpty(DestinationName);

    /// <summary>True when at least one place flag is set (web home / work / favorite chips).</summary>
    public bool HasPlaces => LocatedAtHome || LocatedAtWork || LocatedAtFavorite;

    /// <summary>
    /// Project a <c>GET /location-snapshots/latest</c> response into the navigation slice, mirroring the web
    /// reads. Returns <see langword="null"/> for a non-object body — the native analogue of the web
    /// <c>locationData</c> being null/undefined.
    /// </summary>
    public static NavigationReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new NavigationReading(
            DestinationName: MediaNavValues.CleanNil(MediaNavValues.ReadString(root, "destination_name")),
            DistanceToArrivalM: MediaNavValues.ReadDouble(root, "miles_to_arrival"),
            MinutesToArrival: MediaNavValues.ReadDouble(root, "minutes_to_arrival"),
            LocatedAtHome: MediaNavValues.ReadBool(root, "located_at_home"),
            LocatedAtWork: MediaNavValues.ReadBool(root, "located_at_work"),
            LocatedAtFavorite: MediaNavValues.ReadBool(root, "located_at_favorite"));
    }
}

/// <summary>
/// The merged snapshot the surface renders — the media reading (or null) plus the navigation reading (or null).
/// It is the native equivalent of the web component's two props (<c>mediaData</c> + <c>locationData</c>) resolved
/// into one immutable value. <see cref="HasData"/> drives the content-vs-empty branch: the panel has something to
/// show when a media object exists OR a location object exists (web parity — the web always renders both sections
/// whenever it has either prop, each section showing its own "No … data" caption otherwise). Pure data.
/// </summary>
/// <param name="Media">The media reading, or null when <c>/media/latest</c> carried no object.</param>
/// <param name="Navigation">The navigation reading, or null when <c>/location-snapshots/latest</c> carried no object.</param>
public sealed record MediaNavigationSnapshot(MediaReading? Media, NavigationReading? Navigation)
{
    /// <summary>True when there is a media object or a location object — drives the loaded-vs-empty branch.</summary>
    public bool HasData => Media is not null || Navigation is not null;
}

/// <summary>
/// Shared JSON / value helpers for the Media &amp; Navigation readings — the native port of the web
/// <c>cleanNil</c> filter plus tolerant scalar reads. UI-free so they are unit-tested without a XAML runtime.
/// </summary>
public static class MediaNavValues
{
    /// <summary>
    /// The native port of the web <c>cleanNil</c> filter: collapses the literal Go-nil string representations
    /// (<c>"&lt;nil&gt;"</c>, <c>"nil"</c>, <c>"null"</c>) and empty / missing values to <see langword="null"/>,
    /// and otherwise returns the value verbatim.
    /// </summary>
    public static string? CleanNil(string? value) =>
        string.IsNullOrEmpty(value) || value is "<nil>" or "nil" or "null" ? null : value;

    /// <summary>Read a string property, or null when absent / not a JSON string.</summary>
    public static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Read a finite numeric property (number or numeric string), or null when absent / non-finite.</summary>
    public static double? ReadDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        double? parsed = v.ValueKind switch
        {
            JsonValueKind.Number => v.TryGetDouble(out var d) ? d : null,
            JsonValueKind.String => double.TryParse(
                v.GetString(),
                NumberStyles.Float | NumberStyles.AllowThousands,
                CultureInfo.InvariantCulture,
                out var s)
                ? s
                : null,
            _ => null,
        };

        return parsed is { } value && !double.IsNaN(value) && !double.IsInfinity(value) ? value : null;
    }

    /// <summary>Read a boolean property; absent / non-boolean reads as <see langword="false"/> (web parity).</summary>
    public static bool ReadBool(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
}

/// <summary>
/// Resolves a playback-status string to its semantic badge status — the native mirror of the web Badge colour
/// map (<c>Playing → green</c>, <c>Paused → amber</c>, anything else → neutral). UI-free so the mapping is
/// unit-tested without a XAML runtime.
/// </summary>
public static class MediaNavigationPanelStatusTokens
{
    /// <summary>
    /// The badge status for the playback chip (web Badge colour): <c>Playing → Success</c> (green),
    /// <c>Paused → Warning</c> (amber), everything else (and null) → <see cref="StatusKind.Neutral"/>.
    /// </summary>
    public static StatusKind PlaybackStatus(string? status) => status switch
    {
        "Playing" => StatusKind.Success,
        "Paused" => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };
}

/// <summary>
/// The render-ready Now-Playing card — the cleaned title / artist (each with its localized fallback already
/// applied), the optional source chip text, the optional playback-status chip (label + semantic status), and the
/// Narrator name. The native mirror of the web Now-Playing card. Pure data so the projection is asserted without
/// a UI host.
/// </summary>
/// <param name="Title">The track title, or the localized "Nothing playing" fallback.</param>
/// <param name="Artist">The artist, or the localized "Unknown artist" fallback.</param>
/// <param name="Source">The playback source chip text, or null when the source chip is hidden.</param>
/// <param name="StatusLabel">The playback-status chip label, or null when the status chip is hidden.</param>
/// <param name="StatusKind">The semantic status tinting the playback-status chip.</param>
/// <param name="AutomationName">The Narrator name combining the title, artist and status.</param>
public sealed record MediaNavNowPlaying(
    string Title,
    string Artist,
    string? Source,
    string? StatusLabel,
    StatusKind StatusKind,
    string AutomationName)
{
    /// <summary>True when the source chip should render.</summary>
    public bool HasSource => !string.IsNullOrEmpty(Source);

    /// <summary>True when the playback-status chip should render.</summary>
    public bool HasStatus => !string.IsNullOrEmpty(StatusLabel);
}

/// <summary>
/// The render-ready active-route destination card — the destination name, the optional pre-formatted distance
/// (already unit-converted with its label) and ETA (already with its "min" suffix), and the Narrator name. The
/// native mirror of the web destination card. Pure data so the projection is asserted without a UI host.
/// </summary>
/// <param name="Name">The destination name (web <c>destination_name</c>).</param>
/// <param name="Distance">The pre-formatted distance-to-arrival (e.g. "12.34 km"), or null when absent.</param>
/// <param name="Eta">The pre-formatted minutes-to-arrival (e.g. "15 min"), or null when absent.</param>
/// <param name="AutomationName">The Narrator name combining the destination, distance and ETA.</param>
public sealed record MediaNavDestination(string Name, string? Distance, string? Eta, string AutomationName)
{
    /// <summary>True when the distance row should render.</summary>
    public bool HasDistance => !string.IsNullOrEmpty(Distance);

    /// <summary>True when the ETA row should render.</summary>
    public bool HasEta => !string.IsNullOrEmpty(Eta);
}

/// <summary>
/// One render-ready presence chip (Home / Work / Favorite) — the decorative marker glyph, the localized label,
/// the semantic status tinting the chip, and the Narrator name (the label alone, so the marker stays
/// decorative). The native mirror of a web place chip. Pure data so the projection is asserted without a UI host.
/// </summary>
/// <param name="Marker">The decorative presence marker (web emoji 🏠 / 🏢 / ⭐).</param>
/// <param name="Label">The localized place label (Home / Work / Favorite).</param>
/// <param name="Status">The semantic status tinting the chip.</param>
/// <param name="AutomationName">The Narrator name (the localized label).</param>
public sealed record MediaNavPlace(string Marker, string Label, StatusKind Status, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Media &amp; Navigation surface — the localized title, the
/// Now-Playing card (or its "No media data" caption), the Navigation section (the active-route card or its
/// "No active destination" caption, plus the presence chips, or the whole-section "No location data" caption),
/// the empty-surface message and the accessible summary. <see cref="HasData"/> drives the content-vs-empty
/// branch. Pure data so every branch is asserted without a UI host.
/// </summary>
public sealed record MediaNavigationPanelDisplay(
    bool HasData,
    string Title,
    string NowPlayingLabel,
    MediaNavNowPlaying? NowPlaying,
    string NoMediaMessage,
    string NavigationLabel,
    bool HasNavigation,
    MediaNavDestination? Destination,
    string NoActiveDestinationMessage,
    IReadOnlyList<MediaNavPlace> Places,
    string NoLocationMessage,
    string EmptyMessage,
    string AriaLabel)
{
    /// <summary>An all-empty display (the friendly empty surface) for the loading / empty fallback.</summary>
    public static MediaNavigationPanelDisplay Empty(ILocalizer localizer, UnitPref units) =>
        MediaNavigationPanelProjection.Project(new MediaNavigationSnapshot(null, null), units, localizer);
}

/// <summary>
/// Pure projection from a merged <see cref="MediaNavigationSnapshot"/> to a
/// <see cref="MediaNavigationPanelDisplay"/> — the native port of the render logic in MediaNavigationPanel.tsx.
/// It applies the title / artist fallbacks, the playback-status badge mapping, the distance conversion
/// (SI metres → the user's display unit once at the boundary via <see cref="UnitConverters.DistanceFromSi"/>,
/// then <c>fmtNumber</c> at the web's default precision) and the verbatim minutes (web <c>fmtInt</c>) with the
/// "min" suffix, and builds the presence chips. Every label resolves through the i18n facade. WinUI-free —
/// unit-tested without a UI host.
/// </summary>
public static class MediaNavigationPanelProjection
{
    /// <summary>Distance display precision — the web <c>fmtNumber</c> global default is 2.</summary>
    public const int DistanceDecimals = 2;

    /// <summary>Minutes display precision — the web renders the count with <c>fmtInt</c> (0 decimals).</summary>
    public const int MinutesDecimals = 0;

    /// <summary>Decorative home presence marker (web emoji 🏠).</summary>
    public const string HomeMarker = "\U0001F3E0";

    /// <summary>Decorative work presence marker (web emoji 🏢).</summary>
    public const string WorkMarker = "\U0001F3E2";

    /// <summary>Decorative favorite presence marker (web emoji ⭐).</summary>
    public const string FavoriteMarker = "\u2B50";

    /// <summary>Project <paramref name="snapshot"/> in the user's <paramref name="units"/> using the localizer.</summary>
    /// <param name="snapshot">The merged media + navigation snapshot.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); the distance display unit is read from it.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static MediaNavigationPanelDisplay Project(
        MediaNavigationSnapshot snapshot,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("telemetry.mediaNav", "Media & Navigation");
        string nowPlayingLabel = localizer.GetString("telemetry.nowPlaying", "Now Playing");
        string navigationLabel = localizer.GetString("telemetry.navigation", "Navigation");
        string noMedia = localizer.GetString("telemetry.noMediaData", "No media data");
        string noActiveDestination =
            localizer.GetString("telemetry.noActiveDestination", "No active destination");
        string noLocation = localizer.GetString("telemetry.noLocationData", "No location data");
        string empty = localizer.GetString("telemetry.mediaNav.empty", "No media or navigation data yet.");
        string aria = localizer.GetString(
            "telemetry.mediaNav.aria", "Media and navigation — now playing and active route");

        MediaNavNowPlaying? nowPlaying = snapshot.Media is { } media
            ? BuildNowPlaying(media, localizer)
            : null;

        bool hasNavigation = snapshot.Navigation is not null;
        MediaNavDestination? destination = snapshot.Navigation is { HasDestination: true } nav
            ? BuildDestination(nav, units, localizer)
            : null;
        IReadOnlyList<MediaNavPlace> places = snapshot.Navigation is { } navPlaces
            ? BuildPlaces(navPlaces, localizer)
            : [];

        return new MediaNavigationPanelDisplay(
            HasData: snapshot.HasData,
            Title: title,
            NowPlayingLabel: nowPlayingLabel,
            NowPlaying: nowPlaying,
            NoMediaMessage: noMedia,
            NavigationLabel: navigationLabel,
            HasNavigation: hasNavigation,
            Destination: destination,
            NoActiveDestinationMessage: noActiveDestination,
            Places: places,
            NoLocationMessage: noLocation,
            EmptyMessage: empty,
            AriaLabel: aria);
    }

    private static MediaNavNowPlaying BuildNowPlaying(MediaReading media, ILocalizer localizer)
    {
        string title = media.NowPlayingTitle ?? localizer.GetString("telemetry.nothingPlaying", "Nothing playing");
        string artist = media.NowPlayingArtist ?? localizer.GetString("telemetry.unknownArtist", "Unknown artist");
        string? status = media.PlaybackStatus;

        string automation = status is { Length: > 0 }
            ? string.Format(CultureInfo.CurrentCulture, "{0} — {1} — {2}", title, artist, status)
            : string.Format(CultureInfo.CurrentCulture, "{0} — {1}", title, artist);

        return new MediaNavNowPlaying(
            Title: title,
            Artist: artist,
            Source: media.PlaybackSource,
            StatusLabel: status,
            StatusKind: MediaNavigationPanelStatusTokens.PlaybackStatus(status),
            AutomationName: automation);
    }

    private static MediaNavDestination BuildDestination(
        NavigationReading nav,
        UnitPref units,
        ILocalizer localizer)
    {
        string? distance = nav.DistanceToArrivalM is { } meters
            ? string.Format(
                CultureInfo.CurrentCulture,
                "{0} {1}",
                NumberFormatting.Format(
                    UnitConverters.DistanceFromSi(meters, units.Distance), units.Locale, DistanceDecimals),
                UnitLabels.Label(units.Distance))
            : null;

        string? eta = nav.MinutesToArrival is { } minutes
            ? string.Format(
                CultureInfo.CurrentCulture,
                "{0} {1}",
                NumberFormatting.Format(minutes, units.Locale, MinutesDecimals),
                localizer.GetString("common.minShort", "min"))
            : null;

        string name = nav.DestinationName ?? string.Empty;
        var detail = new List<string> { name };
        if (distance is not null)
        {
            detail.Add(distance);
        }

        if (eta is not null)
        {
            detail.Add(eta);
        }

        return new MediaNavDestination(
            Name: name,
            Distance: distance,
            Eta: eta,
            AutomationName: string.Join(" — ", detail));
    }

    private static List<MediaNavPlace> BuildPlaces(NavigationReading nav, ILocalizer localizer)
    {
        var places = new List<MediaNavPlace>(3);

        if (nav.LocatedAtHome)
        {
            string label = localizer.GetString("telemetry.placeHome", "Home");
            places.Add(new MediaNavPlace(HomeMarker, label, StatusKind.Success, label));
        }

        if (nav.LocatedAtWork)
        {
            string label = localizer.GetString("telemetry.placeWork", "Work");
            places.Add(new MediaNavPlace(WorkMarker, label, StatusKind.Info, label));
        }

        if (nav.LocatedAtFavorite)
        {
            string label = localizer.GetString("telemetry.placeFavorite", "Favorite");
            places.Add(new MediaNavPlace(FavoriteMarker, label, StatusKind.Warning, label));
        }

        return places;
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> media emissions onto parsed
/// <c>RepositoryResult&lt;MediaNavigationSnapshot&gt;</c>, folding in the already-resolved navigation reading and
/// preserving every freshness flag (cached / refreshing / stale / offline) so the view-model can render the full
/// state matrix. A media body that carries no object becomes a snapshot with a null media reading (the navigation
/// section still renders); the view-model classifies the surface empty only when neither reading has data. Pure
/// so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class MediaNavigationPanelResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s media payload (when present), folding in <paramref name="navigation"/>.</summary>
    public static RepositoryResult<MediaNavigationSnapshot> Map(
        RepositoryResult<JsonElement> raw,
        NavigationReading? navigation)
    {
        ArgumentNullException.ThrowIfNull(raw);

        MediaNavigationSnapshot Snapshot() => new(MediaReading.FromResponse(raw.Value), navigation);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<MediaNavigationSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<MediaNavigationSnapshot>.Cached(Snapshot(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<MediaNavigationSnapshot>.Refreshing(Snapshot(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<MediaNavigationSnapshot>.Loaded(Snapshot(), raw.FetchedAt ?? DateTimeOffset.UtcNow),

            // The media read never declares itself empty (the navigation reading may still carry an object), so an
            // Empty status only arrives when there is genuinely no vehicle; surface it as a navigation-only
            // snapshot the view-model classifies (empty when navigation is also null).
            LoadStatus.Empty => RepositoryResult<MediaNavigationSnapshot>.Loaded(
                new MediaNavigationSnapshot(null, navigation), raw.FetchedAt ?? DateTimeOffset.UtcNow),

            LoadStatus.Offline => RepositoryResult<MediaNavigationSnapshot>.OfflineCached(Snapshot(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<MediaNavigationSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Media &amp; Navigation feature surface — the native mirror of the web component at
/// web/src/features/vehicles/components/telemetry-panels/MediaNavigationPanel.tsx.
/// </summary>
public static class MediaNavigationPanelRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "media-navigation-panel";

    /// <summary>Surface category.</summary>
    public const string Category = "vehicles";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "MediaNavigationPanel";

    /// <summary>Localized surface name.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("telemetry.mediaNav", "Media & Navigation");
    }
}

/// <summary>
/// PII-safe diagnostics for the Media &amp; Navigation surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a track title, artist, destination, place,
/// VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class MediaNavigationPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public MediaNavigationPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MediaNavigationPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MediaNavigationPanelRegistration.Slug}");
    }
}
