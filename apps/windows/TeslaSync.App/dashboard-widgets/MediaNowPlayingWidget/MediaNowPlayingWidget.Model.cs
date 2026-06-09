using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="MediaNowPlayingViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>MediaNowPlayingWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/MediaNowPlayingWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>{media ? … : &lt;EmptyState&gt;}</c> gate — the response carried no media object — the
/// "Nothing playing" surface.
/// </summary>
public enum MediaNowPlayingState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying a media object to render the track for.</summary>
    Loaded,

    /// <summary>No media object in the response — render the "Nothing playing" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the track plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the track plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The fields the now-playing view reads from <c>GET /media/latest?vehicle_id={id}</c> — the native mirror of the
/// exact <c>MediaSnapshot</c> slice the web widget consumes
/// (web/src/features/dashboard/widgets/MediaNowPlayingWidget.tsx). The web component reads the wire fields
/// <c>now_playing_title</c> / <c>now_playing_artist</c> / <c>now_playing_album</c> / <c>now_playing_station</c>,
/// <c>playback_source</c> / <c>playback_status</c>, <c>now_playing_duration</c> / <c>now_playing_elapsed</c>
/// (milliseconds, as <c>formatDurationClock</c> consumes them) and <c>audio_volume</c> / <c>audio_volume_max</c>;
/// those exact names are read here verbatim so the native surface reproduces the web's observable output. A
/// <see langword="null"/> parse result models the web <c>media</c> being null/undefined (no media object → the
/// empty surface); a missing field parses to <see langword="null"/> so each element independently falls back
/// exactly like the web <c>?? '—'</c> / <c>?? 0</c> / <c>!= null</c> guards.
/// </summary>
/// <param name="Title">Now-playing track title, or null (web <c>now_playing_title</c>).</param>
/// <param name="Artist">Now-playing artist, or null (web <c>now_playing_artist</c>).</param>
/// <param name="Album">Now-playing album, or null (web <c>now_playing_album</c>).</param>
/// <param name="Station">Now-playing station, or null (web <c>now_playing_station</c>).</param>
/// <param name="PlaybackSource">Playback source, or null (web <c>playback_source</c>).</param>
/// <param name="PlaybackStatus">Playback status string, or null (web <c>playback_status</c>).</param>
/// <param name="DurationMs">Track duration in milliseconds, or null (web <c>now_playing_duration</c>).</param>
/// <param name="ElapsedMs">Track elapsed time in milliseconds, or null (web <c>now_playing_elapsed</c>).</param>
/// <param name="Volume">Audio volume, or null (web <c>audio_volume</c>).</param>
/// <param name="VolumeMax">Audio volume maximum, or null (web <c>audio_volume_max</c>).</param>
public sealed record MediaNowPlayingReading(
    string? Title,
    string? Artist,
    string? Album,
    string? Station,
    string? PlaybackSource,
    string? PlaybackStatus,
    double? DurationMs,
    double? ElapsedMs,
    double? Volume,
    double? VolumeMax)
{
    /// <summary>
    /// Project a <c>GET /media/latest</c> response into the media slice. Returns <see langword="null"/>
    /// when the body is not a JSON object — the native analogue of the web <c>media</c> being null
    /// (the empty surface). Any object yields a reading (matching the web's truthy <c>media ?</c> gate);
    /// individual absent/null fields parse to <see langword="null"/> so a partial body never throws and each
    /// element independently falls back, exactly like the web's per-field <c>?? '—'</c> / <c>!= null</c> checks.
    /// </summary>
    public static MediaNowPlayingReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new MediaNowPlayingReading(
            Title: ReadString(root, "now_playing_title"),
            Artist: ReadString(root, "now_playing_artist"),
            Album: ReadString(root, "now_playing_album"),
            Station: ReadString(root, "now_playing_station"),
            PlaybackSource: ReadString(root, "playback_source"),
            PlaybackStatus: ReadString(root, "playback_status"),
            DurationMs: ReadDouble(root, "now_playing_duration"),
            ElapsedMs: ReadDouble(root, "now_playing_elapsed"),
            Volume: ReadDouble(root, "audio_volume"),
            VolumeMax: ReadDouble(root, "audio_volume_max"));
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
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c>. Unlike most surfaces
/// the web <c>MediaNowPlayingWidget</c> branches on <c>size</c> — a 1×1 compact variant, a standard row variant,
/// and a tall (<c>rows ≥ 2</c>) variant that also shows the album, source and volume — so the footprint carries
/// the same <see cref="IsCompact"/> / <see cref="IsTall"/> predicates the web computes, kept here (pure) so the
/// view branches identically and they are unit-testable.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct MediaNowPlayingSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static MediaNowPlayingSize Default => new(2, 2);

    /// <summary>True for the compact 1×1 variant (web <c>size.cols === 1 &amp;&amp; size.rows === 1</c>).</summary>
    public bool IsCompact => Cols == 1 && Rows == 1;

    /// <summary>True for the tall variant that adds album / source / volume (web <c>size.rows >= 2</c>).</summary>
    public bool IsTall => Rows >= 2;
}

/// <summary>
/// The fully projected, render-ready view of the now-playing surface — the native analogue of everything the web
/// component computes before returning JSX (the title / artist / album / source fallbacks, the playing flag, the
/// <c>m:ss</c> elapsed / duration clocks and the progress fraction, and the volume value + fraction). Pure data
/// so the projection is unit-tested without a UI host; the view decides which of these to show per footprint.
/// </summary>
/// <param name="Title">Track title, web <c>now_playing_title ?? '—'</c>.</param>
/// <param name="Artist">Artist, web <c>now_playing_artist ?? '—'</c>.</param>
/// <param name="Album">Album (null when absent; shown only in the tall variant).</param>
/// <param name="Source">Effective source, web <c>playback_source ?? now_playing_station</c> (null when both absent).</param>
/// <param name="HasSource">Whether a source string is present (web <c>source &amp;&amp; …</c>).</param>
/// <param name="IsPlaying">Whether playback is active, web <c>playback_status === 'Playing'</c>.</param>
/// <param name="PlayingChipText">Localized "Playing" chip label.</param>
/// <param name="HasDuration">Whether the progress block renders, web <c>duration > 0</c>.</param>
/// <param name="ElapsedText">Elapsed clock, web <c>formatDurationClock(elapsed)</c> (e.g. "1:05").</param>
/// <param name="DurationText">Duration clock, web <c>formatDurationClock(duration)</c> (e.g. "3:42").</param>
/// <param name="ProgressFraction">Progress 0–1, web <c>min(elapsed / duration, 1)</c>.</param>
/// <param name="HasVolume">Whether the volume row renders, web <c>volume != null</c>.</param>
/// <param name="VolumeText">Volume value text, web <c>{volume}</c>.</param>
/// <param name="VolumeFraction">Volume 0–1, web <c>min(volume / volumeMax, 1)</c>.</param>
/// <param name="SourceLabel">Localized "Source" label (Narrator / source row).</param>
/// <param name="VolumeLabel">Localized "Volume" label (Narrator / volume row).</param>
/// <param name="AutomationName">Narrator name summarising the rendered track and chips.</param>
public sealed record MediaNowPlayingDisplay(
    string Title,
    string Artist,
    string? Album,
    string? Source,
    bool HasSource,
    bool IsPlaying,
    string PlayingChipText,
    bool HasDuration,
    string ElapsedText,
    string DurationText,
    double ProgressFraction,
    bool HasVolume,
    string VolumeText,
    double VolumeFraction,
    string SourceLabel,
    string VolumeLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="MediaNowPlayingReading"/> to the display model — the native port of the
/// web component's inline computation in web/src/features/dashboard/widgets/MediaNowPlayingWidget.tsx. Reproduces
/// the title / artist <c>?? '—'</c> fallbacks, the <c>playback_source ?? now_playing_station</c> source, the
/// <c>playback_status === 'Playing'</c> flag, the <c>formatDurationClock</c> <c>m:ss</c> clocks and the
/// progress / volume fractions, all clamped to 0–1. Every label resolves through the i18n facade.
/// </summary>
public static class MediaNowPlayingProjection
{
    /// <summary>Segoe Fluent "MusicNote" glyph — the web <c>Music</c> icon (header / compact / empty surfaces).</summary>
    public const string MusicGlyph = "\uE8D6";

    /// <summary>Segoe Fluent "Radio" glyph — the web <c>Radio</c> source-row icon.</summary>
    public const string RadioGlyph = "\uE93C";

    /// <summary>Segoe Fluent "Volume" glyph — the web <c>Volume2</c> volume-row icon.</summary>
    public const string VolumeGlyph = "\uE767";

    /// <summary>The em dash the web renders for an absent title / artist (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>The exact playback-status literal the web compares against (web <c>playback_status === 'Playing'</c>).</summary>
    public const string PlayingStatus = "Playing";

    /// <summary>The fallback volume maximum the web applies (web <c>audio_volume_max ?? 11</c>).</summary>
    public const double DefaultVolumeMax = 11;

    /// <summary>Project <paramref name="reading"/> using <paramref name="localizer"/> for every label.</summary>
    public static MediaNowPlayingDisplay Project(MediaNowPlayingReading reading, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = reading.Title ?? EmDash;
        string artist = reading.Artist ?? EmDash;
        string? album = string.IsNullOrEmpty(reading.Album) ? null : reading.Album;
        string? source = FirstNonEmpty(reading.PlaybackSource, reading.Station);
        bool hasSource = !string.IsNullOrEmpty(source);
        bool isPlaying = string.Equals(reading.PlaybackStatus, PlayingStatus, StringComparison.Ordinal);

        double elapsed = reading.ElapsedMs ?? 0;
        double duration = reading.DurationMs ?? 0;
        bool hasDuration = duration > 0;
        string elapsedText = FormatDurationClock(elapsed);
        string durationText = FormatDurationClock(duration);
        double progress = ProgressOf(elapsed, duration);

        bool hasVolume = reading.Volume.HasValue;
        double volume = reading.Volume ?? 0;
        double volumeMax = reading.VolumeMax ?? DefaultVolumeMax;
        string volumeText = FormatVolume(volume);
        double volumeFraction = ProgressOf(volume, volumeMax);

        string playingText = localizer.GetString("widget.playing", "Playing");
        string sourceLabel = localizer.GetString("widget.source", "Source");
        string volumeLabel = localizer.GetString("widget.volume", "Volume");

        string automation = BuildAutomationName(
            title, artist, album,
            isPlaying ? playingText : null,
            hasDuration ? elapsedText : null,
            hasDuration ? durationText : null,
            hasSource ? sourceLabel : null, source,
            hasVolume ? volumeLabel : null, hasVolume ? volumeText : null);

        return new MediaNowPlayingDisplay(
            Title: title,
            Artist: artist,
            Album: album,
            Source: source,
            HasSource: hasSource,
            IsPlaying: isPlaying,
            PlayingChipText: playingText,
            HasDuration: hasDuration,
            ElapsedText: elapsedText,
            DurationText: durationText,
            ProgressFraction: progress,
            HasVolume: hasVolume,
            VolumeText: volumeText,
            VolumeFraction: volumeFraction,
            SourceLabel: sourceLabel,
            VolumeLabel: volumeLabel,
            AutomationName: automation);
    }

    /// <summary>
    /// Format a millisecond duration the way the web <c>formatDurationClock</c> does — a non-finite or negative
    /// input renders the em dash, otherwise <c>m:ss</c> from <c>floor(ms / 1000)</c> total seconds (e.g. 215000 →
    /// "3:35", 0 → "0:00").
    /// </summary>
    public static string FormatDurationClock(double milliseconds)
    {
        if (double.IsNaN(milliseconds) || double.IsInfinity(milliseconds) || milliseconds < 0)
        {
            return EmDash;
        }

        long totalSeconds = (long)Math.Floor(milliseconds / 1000.0);
        long minutes = totalSeconds / 60;
        long seconds = totalSeconds % 60;
        return string.Create(CultureInfo.InvariantCulture, $"{minutes}:{seconds:D2}");
    }

    /// <summary>Format a volume value the way the web renders the raw <c>{volume}</c> — shortest round-trippable, invariant.</summary>
    public static string FormatVolume(double volume) =>
        volume.ToString(CultureInfo.InvariantCulture);

    /// <summary>The web progress ratio <c>denominator > 0 ? min(numerator / denominator, 1) : 0</c>, clamped to 0–1.</summary>
    public static double ProgressOf(double numerator, double denominator)
    {
        if (denominator <= 0 || double.IsNaN(numerator) || double.IsInfinity(numerator))
        {
            return 0;
        }

        double ratio = numerator / denominator;
        return Math.Clamp(ratio, 0, 1);
    }

    private static string? FirstNonEmpty(string? primary, string? secondary)
    {
        if (!string.IsNullOrEmpty(primary))
        {
            return primary;
        }

        return string.IsNullOrEmpty(secondary) ? null : secondary;
    }

    private static string BuildAutomationName(
        string title,
        string artist,
        string? album,
        string? playingText,
        string? elapsedText,
        string? durationText,
        string? sourceLabel,
        string? source,
        string? volumeLabel,
        string? volumeText)
    {
        var parts = new List<string>(6) { title, artist };

        if (album is not null)
        {
            parts.Add(album);
        }

        if (playingText is not null)
        {
            parts.Add(playingText);
        }

        if (elapsedText is not null && durationText is not null)
        {
            parts.Add(string.Create(CultureInfo.InvariantCulture, $"{elapsedText} / {durationText}"));
        }

        if (sourceLabel is not null && !string.IsNullOrEmpty(source))
        {
            parts.Add(string.Create(CultureInfo.InvariantCulture, $"{sourceLabel} {source}"));
        }

        if (volumeLabel is not null && volumeText is not null)
        {
            parts.Add(string.Create(CultureInfo.InvariantCulture, $"{volumeLabel} {volumeText}"));
        }

        return string.Join(", ", parts);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;MediaNowPlayingReading&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline). A successful emission whose body carries no media object collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{media ? … : empty}</c> gate.
/// Kept pure so the parse-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class MediaNowPlayingResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s media payload (when present) and preserve the load status.</summary>
    public static RepositoryResult<MediaNowPlayingReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        MediaNowPlayingReading? Parse() =>
            raw.HasValue ? MediaNowPlayingReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<MediaNowPlayingReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<MediaNowPlayingReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<MediaNowPlayingReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<MediaNowPlayingReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<MediaNowPlayingReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<MediaNowPlayingReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<MediaNowPlayingReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<MediaNowPlayingReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<MediaNowPlayingReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<MediaNowPlayingReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<MediaNowPlayingReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
