using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The now-playing reading from <c>GET /media/latest?vehicle_id={id}</c> (web <c>MediaSnapshot</c> in
/// web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx, hook <c>useMediaLatest</c>), narrowed to the
/// fields the Media-Player page reads. Durations are milliseconds exactly as the web <c>fmtPlayTime</c>
/// consumes them; the audio volume / max / increment are the raw device scale (0..max), not an SI unit — so
/// nothing here is unit-converted. Parsing is null-tolerant so a partial or schema-drifted body never throws
/// (web parity: each field independently falls back with <c>?? '—'</c> / <c>?? 0</c> / <c>!= null</c>). Pure
/// data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Title">Now-playing track title, or null (web <c>now_playing_title</c>).</param>
/// <param name="Artist">Now-playing artist, or null (web <c>now_playing_artist</c>).</param>
/// <param name="Album">Now-playing album, or null (web <c>now_playing_album</c>).</param>
/// <param name="Station">Now-playing station, or null (web <c>now_playing_station</c>).</param>
/// <param name="PlaybackSource">Playback source, or null (web <c>playback_source</c>).</param>
/// <param name="PlaybackStatus">Playback status string, or null (web <c>playback_status</c>).</param>
/// <param name="DurationMs">Track duration in milliseconds, or null (web <c>now_playing_duration</c>).</param>
/// <param name="ElapsedMs">Track elapsed time in milliseconds, or null (web <c>now_playing_elapsed</c>).</param>
/// <param name="Volume">Audio volume on the device scale, or null (web <c>audio_volume</c>).</param>
/// <param name="VolumeMax">Audio volume maximum, or null (web <c>audio_volume_max</c>).</param>
/// <param name="VolumeIncrement">Audio volume step, or null (web <c>audio_volume_increment</c>).</param>
public sealed record MediaReading(
    string? Title,
    string? Artist,
    string? Album,
    string? Station,
    string? PlaybackSource,
    string? PlaybackStatus,
    double? DurationMs,
    double? ElapsedMs,
    double? Volume,
    double? VolumeMax,
    double? VolumeIncrement)
{
    /// <summary>
    /// Project a <c>GET /media/latest</c> response into the reading. Returns <see langword="null"/> when the
    /// body is not a JSON object — the native analogue of the web <c>latest</c> being null (no now-playing
    /// object). Any object yields a reading; individual absent fields parse to <see langword="null"/>.
    /// </summary>
    public static MediaReading? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new MediaReading(
            Title: MediaJson.String(root, "now_playing_title"),
            Artist: MediaJson.String(root, "now_playing_artist"),
            Album: MediaJson.String(root, "now_playing_album"),
            Station: MediaJson.String(root, "now_playing_station"),
            PlaybackSource: MediaJson.String(root, "playback_source"),
            PlaybackStatus: MediaJson.String(root, "playback_status"),
            DurationMs: MediaJson.Double(root, "now_playing_duration"),
            ElapsedMs: MediaJson.Double(root, "now_playing_elapsed"),
            Volume: MediaJson.Double(root, "audio_volume"),
            VolumeMax: MediaJson.Double(root, "audio_volume_max"),
            VolumeIncrement: MediaJson.Double(root, "audio_volume_increment"));
    }
}

/// <summary>
/// One played-track row from the <c>GET /media?vehicle_id={id}&amp;limit=500</c> playback-history feed (web
/// <c>useMediaHistory</c>), narrowed to the fields the stats, volume chart, source distribution and history
/// table read. Field names mirror the canonical snake_case wire shape the Go <c>MediaHandler.List</c> emits.
/// Volume is the raw device scale; the timestamp is <c>created_at</c>. Parsing is null-tolerant. Pure data —
/// no WinUI types.
/// </summary>
/// <param name="Id">Synthetic row id (web <c>id</c>), or 0 when absent.</param>
/// <param name="Title">Track title (wire <c>now_playing_title</c>), or null.</param>
/// <param name="Artist">Track artist (wire <c>now_playing_artist</c>), or null.</param>
/// <param name="Source">Playback source (wire <c>playback_source</c>), or null.</param>
/// <param name="Status">Playback status (wire <c>playback_status</c>), or null.</param>
/// <param name="Volume">Audio volume on the device scale, or null (wire <c>audio_volume</c>).</param>
/// <param name="VolumeMax">Audio volume maximum, or null (wire <c>audio_volume_max</c>).</param>
/// <param name="CreatedAt">Row timestamp (wire <c>created_at</c>), or null.</param>
public sealed record MediaHistoryEntry(
    long Id,
    string? Title,
    string? Artist,
    string? Source,
    string? Status,
    double? Volume,
    double? VolumeMax,
    DateTimeOffset? CreatedAt)
{
    /// <summary>Parse a <c>GET /media</c> JSON array into a tolerant list of rows, preserving wire order.</summary>
    public static IReadOnlyList<MediaHistoryEntry> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<MediaHistoryEntry>();
        }

        var list = new List<MediaHistoryEntry>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single media-history JSON object into a tolerant row.</summary>
    public static MediaHistoryEntry FromJson(JsonElement obj) => new(
        Id: MediaJson.Long(obj, "id") ?? 0,
        Title: MediaJson.String(obj, "now_playing_title"),
        Artist: MediaJson.String(obj, "now_playing_artist"),
        Source: MediaJson.String(obj, "playback_source"),
        Status: MediaJson.String(obj, "playback_status"),
        Volume: MediaJson.Double(obj, "audio_volume"),
        VolumeMax: MediaJson.Double(obj, "audio_volume_max"),
        CreatedAt: MediaJson.Instant(obj, "created_at") ?? MediaJson.Instant(obj, "ts"));
}

/// <summary>
/// The two-source snapshot the page binds to: the now-playing reading (web <c>useMediaLatest</c> — drives the
/// now-playing card and the volume gauge) and the playback-history list (web <c>useMediaHistory</c> — feeds the
/// derived stats, the volume-over-time area chart, the source-distribution pie and the history table). Mirrors
/// the web page handing both query results to its render body.
/// </summary>
/// <param name="HasLatest">Whether a now-playing object was present (web truthy <c>latest</c>).</param>
/// <param name="Latest">The now-playing reading, or null when <c>/media/latest</c> carried no object.</param>
/// <param name="History">The playback-history rows (empty when none / unavailable).</param>
public sealed record MediaPlayerSnapshot(
    bool HasLatest,
    MediaReading? Latest,
    IReadOnlyList<MediaHistoryEntry> History)
{
    /// <summary>The empty snapshot (no now-playing object, no history) — the page-level empty surface.</summary>
    public static MediaPlayerSnapshot Empty { get; } = new(false, null, Array.Empty<MediaHistoryEntry>());

    /// <summary>Whether the page has anything to render (a now-playing object or any history row).</summary>
    public bool HasAny => HasLatest || History.Count > 0;

    /// <summary>Compose a snapshot from the parsed now-playing reading (may be null) and the history list.</summary>
    public static MediaPlayerSnapshot Compose(MediaReading? latest, IReadOnlyList<MediaHistoryEntry> history)
    {
        ArgumentNullException.ThrowIfNull(history);
        return new MediaPlayerSnapshot(latest is not null, latest, history);
    }
}

/// <summary>The two-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface IMediaPlayerFeed
{
    /// <summary>Fetch the now-playing reading + playback-history list for the active vehicle.</summary>
    Task<MediaPlayerSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyMediaPlayerFeed : IMediaPlayerFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyMediaPlayerFeed Instance { get; } = new();

    private EmptyMediaPlayerFeed()
    {
    }

    /// <inheritdoc />
    public Task<MediaPlayerSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(MediaPlayerSnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum MediaPlayerState
{
    /// <summary>The primary now-playing query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no now-playing object and no history — the friendly empty surface, never blank.</summary>
    Empty,

    /// <summary>The primary now-playing query failed — the retriable error surface.</summary>
    Error,

    /// <summary>Data resolved — the full page content.</summary>
    Success,
}

/// <summary>A localized status chip for the now-playing card (web <c>Badge</c> + <c>statusLabel</c>).</summary>
/// <param name="Visible">Whether a playback status was present (web <c>latest?.playback_status &amp;&amp; …</c>).</param>
/// <param name="Text">Localized status label ("Playing" / "Paused" / "Stopped").</param>
/// <param name="Status">Semantic status driving the chip colour (web <c>statusVariant</c>).</param>
public sealed record MediaStatusChip(bool Visible, string Text, StatusKind Status);

/// <summary>A summary metric tile (web <c>MetricCard</c>): pre-formatted value + label + accent rail.</summary>
public sealed record MediaMetricCardDisplay(string Label, string Value, string AccentBrushKey, string AutomationName);

/// <summary>A source-distribution legend entry (web pie legend row): name + count + palette index.</summary>
public sealed record MediaSourceSliceDisplay(string Name, int Count, int ColorIndex);

/// <summary>A single playback-history table row (web per-row render).</summary>
public sealed record MediaHistoryRowDisplay(
    string Id,
    string Time,
    string Track,
    string Artist,
    string Source,
    string Volume,
    string Status,
    StatusKind StatusKind,
    string AutomationName);

/// <summary>
/// The now-playing card projection (web "GlassPanel1"): the title (or "No track"), the optional status chip, the
/// artist line (artist + album), the optional station / source rows and the optional progress block. Pure data.
/// </summary>
public sealed record MediaNowPlayingDisplay(
    string TrackTitle,
    MediaStatusChip Status,
    string ArtistLine,
    bool HasStation,
    string Station,
    bool HasSource,
    string Source,
    string SourceGlyph,
    bool IsPlaying,
    bool HasProgress,
    string ElapsedText,
    string DurationText,
    double ProgressFraction,
    string AutomationName);

/// <summary>The volume-over-time area chart projection (web "GlassPanel7" / recharts <c>AreaChart</c>).</summary>
public sealed record MediaVolumeChartDisplay(
    bool HasData,
    string Title,
    string AriaLabel,
    IReadOnlyList<ChartPoint> Points,
    double YMax,
    string EmptyMessage);

/// <summary>The source-distribution pie chart projection (web "GlassPanel8" / recharts <c>PieChart</c>).</summary>
public sealed record MediaSourceChartDisplay(
    bool HasData,
    string Title,
    string AriaLabel,
    IReadOnlyList<ChartPoint> Slices,
    IReadOnlyList<MediaSourceSliceDisplay> Legend,
    string EmptyMessage);

/// <summary>The playback-history table projection (web "GlassPanel9" / <c>DataTable</c>).</summary>
public sealed record MediaHistoryTableDisplay(
    string Title,
    int RecordCount,
    string RecordsBadge,
    IReadOnlyList<string> Columns,
    IReadOnlyList<MediaHistoryRowDisplay> Rows,
    bool HasRows,
    string TableEmptyMessage,
    string PanelEmptyMessage);

/// <summary>
/// The fully-resolved render model the WinUI view binds to — every branch, format and string the web
/// <c>MediaPlayerPage</c> computes, resolved once so the view is a thin renderer. Pure data — no WinUI types —
/// so the whole projection is unit-tested without a UI host.
/// </summary>
public sealed record MediaPlayerDisplay(
    MediaPlayerState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    string EmptyMessage,
    MediaNowPlayingDisplay NowPlaying,
    double VolumeValue,
    double VolumeMax,
    string VolumeLabel,
    IReadOnlyList<MediaMetricCardDisplay> MetricCards,
    MediaVolumeChartDisplay VolumeChart,
    MediaSourceChartDisplay SourceChart,
    MediaHistoryTableDisplay History,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed two-source <see cref="Snapshot"/> plus the page
/// lifecycle (the primary now-playing query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The view-model
/// fills this in; tests construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record MediaPlayerModel(MediaPlayerSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the primary now-playing query is in flight with no data yet.</summary>
    public static MediaPlayerModel Initial { get; } = new(MediaPlayerSnapshot.Empty, true, null);
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every key the web <c>MediaPlayerPage</c> feeds
/// into <c>t(...)</c>, resolved once through the i18n facade so the projection stays readable and the
/// string-coverage test asserts all of them in one pass. The web page uses natural-language keys (e.g.
/// <c>t('Media Player')</c>), preserved here verbatim.
/// </summary>
public sealed record MediaStrings
{
    /// <summary>Page title (web <c>t('Media Player')</c>).</summary>
    public required string Title { get; init; }

    /// <summary>Page subtitle (web <c>t('Now playing, volume, and listening history')</c>).</summary>
    public required string Subtitle { get; init; }

    /// <summary>Now-playing fallback title (web <c>t('No track')</c>).</summary>
    public required string NoTrack { get; init; }

    /// <summary>Now-playing fallback artist (web <c>t('Unknown artist')</c>).</summary>
    public required string UnknownArtist { get; init; }

    /// <summary>Playing status label (web <c>t('Playing')</c>).</summary>
    public required string Playing { get; init; }

    /// <summary>Paused status label (web <c>t('Paused')</c>).</summary>
    public required string Paused { get; init; }

    /// <summary>Stopped status label (web <c>t('Stopped')</c>).</summary>
    public required string Stopped { get; init; }

    /// <summary>Volume gauge / column label (web <c>t('Volume')</c>).</summary>
    public required string Volume { get; init; }

    /// <summary>Unique-tracks metric label (web <c>t('Unique Tracks')</c>).</summary>
    public required string UniqueTracks { get; init; }

    /// <summary>Top-source metric label (web <c>t('Top Source')</c>).</summary>
    public required string TopSource { get; init; }

    /// <summary>Average-volume metric label (web <c>t('Avg Volume')</c>).</summary>
    public required string AvgVolume { get; init; }

    /// <summary>Volume-step metric label (web <c>t('Volume Step')</c>).</summary>
    public required string VolumeStep { get; init; }

    /// <summary>Volume-over-time chart title (web <c>t('Volume over Time')</c>).</summary>
    public required string VolumeOverTime { get; init; }

    /// <summary>Volume-over-time empty message (web <c>t('No volume data for this period')</c>).</summary>
    public required string NoVolumeData { get; init; }

    /// <summary>Source-distribution chart title (web <c>t('Source Distribution')</c>).</summary>
    public required string SourceDistribution { get; init; }

    /// <summary>Source-distribution empty message (web <c>t('No source data available')</c>).</summary>
    public required string NoSourceData { get; init; }

    /// <summary>Playback-history panel title (web <c>t('Playback History')</c>).</summary>
    public required string PlaybackHistory { get; init; }

    /// <summary>Records badge noun (web <c>t('records')</c>).</summary>
    public required string Records { get; init; }

    /// <summary>Time column header (web <c>t('Time')</c>).</summary>
    public required string Time { get; init; }

    /// <summary>Track column header (web <c>t('Track')</c>).</summary>
    public required string Track { get; init; }

    /// <summary>Artist column header (web <c>t('Artist')</c>).</summary>
    public required string Artist { get; init; }

    /// <summary>Source column header (web <c>t('Source')</c>).</summary>
    public required string Source { get; init; }

    /// <summary>Status column header (web <c>t('Status')</c>).</summary>
    public required string Status { get; init; }

    /// <summary>DataTable empty message (web <c>emptyMessage={t('No playback history')}</c>).</summary>
    public required string NoPlaybackHistory { get; init; }

    /// <summary>Panel empty message (web <c>t('No playback history for this period')</c>).</summary>
    public required string NoPlaybackHistoryPeriod { get; init; }

    /// <summary>Error banner prefix (web <c>t('error.loadFailed', 'Failed to load data')</c>).</summary>
    public required string LoadFailed { get; init; }

    /// <summary>Retry affordance label (shared <c>common.retry</c>).</summary>
    public required string Retry { get; init; }

    /// <summary>Resolve every string the page renders through the i18n facade (web key names, verbatim).</summary>
    public static MediaStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new MediaStrings
        {
            Title = localizer.GetString("Media Player", "Media Player"),
            Subtitle = localizer.GetString(
                "Now playing, volume, and listening history",
                "Now playing, volume, and listening history"),
            NoTrack = localizer.GetString("No track", "No track"),
            UnknownArtist = localizer.GetString("Unknown artist", "Unknown artist"),
            Playing = localizer.GetString("Playing", "Playing"),
            Paused = localizer.GetString("Paused", "Paused"),
            Stopped = localizer.GetString("Stopped", "Stopped"),
            Volume = localizer.GetString("Volume", "Volume"),
            UniqueTracks = localizer.GetString("Unique Tracks", "Unique Tracks"),
            TopSource = localizer.GetString("Top Source", "Top Source"),
            AvgVolume = localizer.GetString("Avg Volume", "Avg Volume"),
            VolumeStep = localizer.GetString("Volume Step", "Volume Step"),
            VolumeOverTime = localizer.GetString("Volume over Time", "Volume over Time"),
            NoVolumeData = localizer.GetString("No volume data for this period", "No volume data for this period"),
            SourceDistribution = localizer.GetString("Source Distribution", "Source Distribution"),
            NoSourceData = localizer.GetString("No source data available", "No source data available"),
            PlaybackHistory = localizer.GetString("Playback History", "Playback History"),
            Records = localizer.GetString("records", "records"),
            Time = localizer.GetString("Time", "Time"),
            Track = localizer.GetString("Track", "Track"),
            Artist = localizer.GetString("Artist", "Artist"),
            Source = localizer.GetString("Source", "Source"),
            Status = localizer.GetString("Status", "Status"),
            NoPlaybackHistory = localizer.GetString("No playback history", "No playback history"),
            NoPlaybackHistoryPeriod = localizer.GetString(
                "No playback history for this period",
                "No playback history for this period"),
            LoadFailed = localizer.GetString("error.loadFailed", "Failed to load data"),
            Retry = localizer.GetString("common.retry", "Retry"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="MediaPlayerModel"/> to its <see cref="MediaPlayerDisplay"/> — the native
/// port of the render logic in web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx and its
/// <c>statusVariant</c> / <c>statusLabel</c> / <c>sourceIcon</c> / <c>fmtPlayTime</c> helpers and the
/// <c>stats</c> / <c>volumeChartData</c> / <c>sourceData</c> memos. The branch precedence mirrors the web data
/// lifecycle (loading → error → empty → success); the now-playing reading feeds the card and the volume gauge,
/// while the history list feeds the four metric tiles, the volume-over-time area chart, the source-distribution
/// pie and the history table. Every label resolves through the i18n facade using the same keys the web page
/// uses. The audio volume is the raw device scale (not an SI quantity), so no unit conversion occurs.
/// </summary>
public static class MediaPlayerProjection
{
    /// <summary>Segoe Fluent "MusicInfo" glyph (web <c>Music</c> / <c>ListMusic</c>).</summary>
    public const string MusicGlyph = "\uE8D6";

    /// <summary>Segoe Fluent "Volume" glyph (web <c>Volume2</c>).</summary>
    public const string VolumeGlyph = "\uE767";

    /// <summary>Segoe Fluent "Radio" glyph (web <c>Radio</c> / <c>Disc3</c>).</summary>
    public const string RadioGlyph = "\uE93C";

    /// <summary>Segoe Fluent "Bluetooth" glyph (web <c>Bluetooth</c> source icon).</summary>
    public const string BluetoothGlyph = "\uE702";

    /// <summary>Segoe Fluent "Headphone" glyph (web <c>Headphones</c> fallback source icon).</summary>
    public const string HeadphonesGlyph = "\uE7F6";

    /// <summary>The fallback volume maximum the web applies (web <c>audio_volume_max || 11</c>).</summary>
    public const double DefaultVolumeMax = 11;

    /// <summary>The em dash the web renders for an absent cell value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>The double-hyphen the web renders for an absent top source (web <c>'--'</c>).</summary>
    public const string DoubleDash = "--";

    /// <summary>The bucket label the web assigns to a missing playback source in the pie (web <c>'Unknown'</c>).</summary>
    public const string UnknownSource = "Unknown";

    private const string AccentInfo = "TsColorInfoBrush";
    private const string AccentSuccess = "TsColorSuccessBrush";
    private const string AccentAccent = "TsColorAccentBrush";

    private const int AvgVolumePrecision = 0;
    private const int VolumeStepPrecision = 2;
    private const int CountPrecision = 0;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the localizer + clock.</summary>
    /// <param name="model">The parsed two-source data plus the page lifecycle flags.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date / time formatting in tests.</param>
    public static MediaPlayerDisplay Project(MediaPlayerModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = MediaStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var latest = snapshot.Latest;
        var history = snapshot.History;

        MediaPlayerState state =
            model.Loading && !snapshot.HasAny ? MediaPlayerState.Loading
            : model.ErrorDetail is not null ? MediaPlayerState.Error
            : !snapshot.HasAny ? MediaPlayerState.Empty
            : MediaPlayerState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.LoadFailed
            : $"{s.LoadFailed}: {model.ErrorDetail}";

        var nowPlaying = BuildNowPlaying(latest, s);
        var metricCards = BuildMetricCards(latest, history, s);
        var volumeChart = BuildVolumeChart(latest, history, s, now);
        var sourceChart = BuildSourceChart(history, s);
        var table = BuildTable(history, s, now);

        double volumeMax = ResolveVolumeMax(latest);

        return new MediaPlayerDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            ShowLoading: state == MediaPlayerState.Loading,
            ShowError: state == MediaPlayerState.Error,
            ShowEmpty: state == MediaPlayerState.Empty,
            ShowContent: state == MediaPlayerState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            EmptyMessage: s.NoPlaybackHistoryPeriod,
            NowPlaying: nowPlaying,
            VolumeValue: latest?.Volume ?? 0,
            VolumeMax: volumeMax,
            VolumeLabel: s.Volume,
            MetricCards: metricCards,
            VolumeChart: volumeChart,
            SourceChart: sourceChart,
            History: table,
            AutomationName: $"{s.Title}. {s.Subtitle}");
    }

    /// <summary>The semantic chip variant for a playback status (web <c>statusVariant</c>).</summary>
    public static StatusKind StatusVariant(string? status)
    {
        string s = (status ?? string.Empty).ToLowerInvariant();
        if (s.Contains("playing", StringComparison.Ordinal))
        {
            return StatusKind.Success;
        }

        if (s.Contains("paused", StringComparison.Ordinal))
        {
            return StatusKind.Warning;
        }

        return StatusKind.Neutral;
    }

    /// <summary>The localized status label for a playback status (web <c>statusLabel</c>).</summary>
    public static string StatusLabel(string? status, MediaStrings strings)
    {
        ArgumentNullException.ThrowIfNull(strings);
        string s = (status ?? string.Empty).ToLowerInvariant();
        if (s.Contains("playing", StringComparison.Ordinal))
        {
            return strings.Playing;
        }

        if (s.Contains("paused", StringComparison.Ordinal))
        {
            return strings.Paused;
        }

        return strings.Stopped;
    }

    /// <summary>The Segoe Fluent source glyph for a playback source (web <c>sourceIcon</c>).</summary>
    public static string SourceGlyph(string? source)
    {
        string s = (source ?? string.Empty).ToLowerInvariant();
        if (s.Contains("bluetooth", StringComparison.Ordinal))
        {
            return BluetoothGlyph;
        }

        if (s.Contains("radio", StringComparison.Ordinal)
            || s.Contains("fm", StringComparison.Ordinal)
            || s.Contains("am", StringComparison.Ordinal))
        {
            return RadioGlyph;
        }

        return HeadphonesGlyph;
    }

    /// <summary>
    /// Format a millisecond position as <c>m:ss</c> the way the web <c>fmtPlayTime</c> does (floor to whole
    /// seconds, then <c>{minutes}:{seconds:00}</c>).
    /// </summary>
    public static string PlayClock(double milliseconds)
    {
        if (double.IsNaN(milliseconds) || double.IsInfinity(milliseconds) || milliseconds < 0)
        {
            return "0:00";
        }

        long totalSeconds = (long)Math.Floor(milliseconds / 1000.0);
        long minutes = totalSeconds / 60;
        long seconds = totalSeconds % 60;
        return string.Create(CultureInfo.InvariantCulture, $"{minutes}:{seconds:D2}");
    }

    /// <summary>The distinct count of non-empty track titles in the history (web <c>stats.uniqueTracks</c>).</summary>
    public static int UniqueTracks(IReadOnlyList<MediaHistoryEntry> history)
    {
        ArgumentNullException.ThrowIfNull(history);
        var titles = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in history)
        {
            if (!string.IsNullOrEmpty(entry.Title))
            {
                titles.Add(entry.Title!);
            }
        }

        return titles.Count;
    }

    /// <summary>The most-frequent non-empty playback source, or <c>'--'</c> when none (web <c>stats.topSource</c>).</summary>
    public static string TopSource(IReadOnlyList<MediaHistoryEntry> history)
    {
        ArgumentNullException.ThrowIfNull(history);
        var counts = CountSources(history, includeUnknownBucket: false);
        string? top = null;
        int best = -1;
        foreach (var (name, count) in counts)
        {
            if (count > best)
            {
                best = count;
                top = name;
            }
        }

        return top ?? DoubleDash;
    }

    /// <summary>The mean audio volume across the history (web <c>stats.avgVolume</c>); 0 when empty.</summary>
    public static double AverageVolume(IReadOnlyList<MediaHistoryEntry> history)
    {
        ArgumentNullException.ThrowIfNull(history);
        if (history.Count == 0)
        {
            return 0;
        }

        double sum = 0;
        foreach (var entry in history)
        {
            sum += entry.Volume ?? 0;
        }

        return sum / history.Count;
    }

    private static MediaNowPlayingDisplay BuildNowPlaying(MediaReading? latest, MediaStrings s)
    {
        string trackTitle = string.IsNullOrEmpty(latest?.Title) ? s.NoTrack : latest!.Title!;

        bool hasStatus = !string.IsNullOrEmpty(latest?.PlaybackStatus);
        var statusChip = new MediaStatusChip(
            hasStatus,
            StatusLabel(latest?.PlaybackStatus, s),
            StatusVariant(latest?.PlaybackStatus));

        string artist = string.IsNullOrEmpty(latest?.Artist) ? s.UnknownArtist : latest!.Artist!;
        string artistLine = string.IsNullOrEmpty(latest?.Album)
            ? artist
            : $"{artist} {EmDash} {latest!.Album}";

        bool hasStation = !string.IsNullOrEmpty(latest?.Station);
        string station = latest?.Station ?? string.Empty;

        bool hasSource = !string.IsNullOrEmpty(latest?.PlaybackSource);
        string source = latest?.PlaybackSource ?? string.Empty;

        bool isPlaying = (latest?.PlaybackStatus ?? string.Empty)
            .ToLowerInvariant()
            .Contains("playing", StringComparison.Ordinal);

        double duration = latest?.DurationMs ?? 0;
        double elapsed = latest?.ElapsedMs ?? 0;
        bool hasProgress = duration > 0;
        double progress = hasProgress ? Math.Clamp(elapsed / duration, 0, 1) : 0;

        string automation = hasStatus
            ? $"{trackTitle}, {artistLine}, {statusChip.Text}"
            : $"{trackTitle}, {artistLine}";

        return new MediaNowPlayingDisplay(
            TrackTitle: trackTitle,
            Status: statusChip,
            ArtistLine: artistLine,
            HasStation: hasStation,
            Station: station,
            HasSource: hasSource,
            Source: source,
            SourceGlyph: SourceGlyph(source),
            IsPlaying: isPlaying,
            HasProgress: hasProgress,
            ElapsedText: PlayClock(elapsed),
            DurationText: PlayClock(duration),
            ProgressFraction: progress,
            AutomationName: automation);
    }

    private static IReadOnlyList<MediaMetricCardDisplay> BuildMetricCards(
        MediaReading? latest,
        IReadOnlyList<MediaHistoryEntry> history,
        MediaStrings s)
    {
        string uniqueTracks = ScalarFormatters.FormatNumber(UniqueTracks(history), CountPrecision);
        string topSource = TopSource(history);
        string avgVolume = ScalarFormatters.FormatNumber(AverageVolume(history), AvgVolumePrecision);
        string volumeStep = latest?.VolumeIncrement is { } step
            ? ScalarFormatters.FormatNumber(step, VolumeStepPrecision)
            : EmDash;

        return
        [
            new MediaMetricCardDisplay(s.UniqueTracks, uniqueTracks, AccentInfo, $"{s.UniqueTracks}: {uniqueTracks}"),
            new MediaMetricCardDisplay(s.TopSource, topSource, AccentSuccess, $"{s.TopSource}: {topSource}"),
            new MediaMetricCardDisplay(s.AvgVolume, avgVolume, AccentAccent, $"{s.AvgVolume}: {avgVolume}"),
            new MediaMetricCardDisplay(s.VolumeStep, volumeStep, AccentInfo, $"{s.VolumeStep}: {volumeStep}"),
        ];
    }

    private static MediaVolumeChartDisplay BuildVolumeChart(
        MediaReading? latest,
        IReadOnlyList<MediaHistoryEntry> history,
        MediaStrings s,
        DateTimeOffset now)
    {
        var sorted = new List<MediaHistoryEntry>(history);
        sorted.Sort((a, b) =>
            (a.CreatedAt ?? DateTimeOffset.UnixEpoch).CompareTo(b.CreatedAt ?? DateTimeOffset.UnixEpoch));

        var points = new List<ChartPoint>(sorted.Count);
        for (int i = 0; i < sorted.Count; i++)
        {
            string label = DateTimeFormatting.Format(sorted[i].CreatedAt, DateTimeVariant.Full, now);
            points.Add(new ChartPoint(i, sorted[i].Volume ?? 0, label));
        }

        double yMax = ResolveVolumeMax(latest);

        return new MediaVolumeChartDisplay(
            HasData: points.Count > 0,
            Title: s.VolumeOverTime,
            AriaLabel: s.VolumeOverTime,
            Points: points,
            YMax: yMax,
            EmptyMessage: s.NoVolumeData);
    }

    private static MediaSourceChartDisplay BuildSourceChart(IReadOnlyList<MediaHistoryEntry> history, MediaStrings s)
    {
        var counts = CountSources(history, includeUnknownBucket: true);
        var ordered = new List<KeyValuePair<string, int>>(counts);
        ordered.Sort((a, b) => b.Value.CompareTo(a.Value));

        var slices = new List<ChartPoint>(ordered.Count);
        var legend = new List<MediaSourceSliceDisplay>(ordered.Count);
        for (int i = 0; i < ordered.Count; i++)
        {
            slices.Add(new ChartPoint(i, ordered[i].Value, ordered[i].Key));
            legend.Add(new MediaSourceSliceDisplay(ordered[i].Key, ordered[i].Value, i));
        }

        return new MediaSourceChartDisplay(
            HasData: slices.Count > 0,
            Title: s.SourceDistribution,
            AriaLabel: s.SourceDistribution,
            Slices: slices,
            Legend: legend,
            EmptyMessage: s.NoSourceData);
    }

    private static MediaHistoryTableDisplay BuildTable(
        IReadOnlyList<MediaHistoryEntry> history,
        MediaStrings s,
        DateTimeOffset now)
    {
        var columns = new[] { s.Time, s.Track, s.Artist, s.Source, s.Volume, s.Status };

        var sorted = new List<MediaHistoryEntry>(history);
        sorted.Sort((a, b) =>
            (b.CreatedAt ?? DateTimeOffset.UnixEpoch).CompareTo(a.CreatedAt ?? DateTimeOffset.UnixEpoch));

        var rows = new List<MediaHistoryRowDisplay>(sorted.Count);
        foreach (var entry in sorted)
        {
            string time = DateTimeFormatting.Format(entry.CreatedAt, DateTimeVariant.Full, now);
            string track = string.IsNullOrEmpty(entry.Title) ? DoubleDash : entry.Title!;
            string artist = string.IsNullOrEmpty(entry.Artist) ? DoubleDash : entry.Artist!;
            string source = string.IsNullOrEmpty(entry.Source) ? DoubleDash : entry.Source!;
            string volume = $"{FormatVolumeCell(entry.Volume)}/{FormatVolumeCell(entry.VolumeMax)}";
            string status = StatusLabel(entry.Status, s);
            StatusKind statusKind = StatusVariant(entry.Status);

            rows.Add(new MediaHistoryRowDisplay(
                entry.Id.ToString(CultureInfo.InvariantCulture),
                time,
                track,
                artist,
                source,
                volume,
                status,
                statusKind,
                $"{time}, {track}, {artist}, {source}, {status}"));
        }

        string recordsBadge = $"{history.Count.ToString(CultureInfo.CurrentCulture)} {s.Records}";

        return new MediaHistoryTableDisplay(
            Title: s.PlaybackHistory,
            RecordCount: history.Count,
            RecordsBadge: recordsBadge,
            Columns: columns,
            Rows: rows,
            HasRows: rows.Count > 0,
            TableEmptyMessage: s.NoPlaybackHistory,
            PanelEmptyMessage: s.NoPlaybackHistoryPeriod);
    }

    private static string FormatVolumeCell(double? volume) =>
        volume is { } v ? v.ToString(CultureInfo.CurrentCulture) : EmDash;

    private static double ResolveVolumeMax(MediaReading? latest) =>
        latest?.VolumeMax is { } max && max > 0 ? max : DefaultVolumeMax;

    private static List<KeyValuePair<string, int>> CountSources(
        IReadOnlyList<MediaHistoryEntry> history,
        bool includeUnknownBucket)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var entry in history)
        {
            string? source = entry.Source;
            string key;
            if (string.IsNullOrEmpty(source))
            {
                if (!includeUnknownBucket)
                {
                    continue;
                }

                key = UnknownSource;
            }
            else
            {
                key = source!;
            }

            counts.TryGetValue(key, out int current);
            counts[key] = current + 1;
        }

        return new List<KeyValuePair<string, int>>(counts);
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Media-Player page — every getter returns a nullable
/// rather than throwing so a partial or schema-drifted body never aborts the parse (web parity: the page
/// tolerates undefined fields). WinUI-free so the parse is unit-tested without a UI host. Reads the canonical
/// snake_case wire shape (no camelCaseKeys transform on native).
/// </summary>
internal static class MediaJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / non-string.</summary>
    public static string? String(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var v)
        && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    /// <summary>The numeric value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var sv) => sv,
            _ => null,
        };
    }

    /// <summary>The integer value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.Number when prop.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var sv) => sv,
            _ => null,
        };
    }

    /// <summary>The timestamp value of <paramref name="name"/>, or null when absent / unparseable.</summary>
    public static DateTimeOffset? Instant(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object
            || !obj.TryGetProperty(name, out var prop)
            || prop.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            prop.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// Canonical navigation + diagnostics metadata for the Media-Player page — the native mirror of the web page at
/// web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx (route <c>/media-player</c>, nav name
/// <c>MediaPlayer</c>). The page reads the same now-playing snapshot the web <c>useMediaLatest</c> hook reads
/// (generated operation <c>get_api_v1_media_latest</c>) plus the playback-history list the web
/// <c>useMediaHistory</c> hook reads (generated operation <c>get_api_v1_media</c>).
/// </summary>
public static class MediaPlayerRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "MediaPlayer";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "MediaPlayerPage";

    /// <summary>The generated operation id for the now-playing read (web <c>useMediaLatest</c>).</summary>
    public const string LatestOperation = "get_api_v1_media_latest";

    /// <summary>The generated operation id for the playback-history read (web <c>useMediaHistory</c>).</summary>
    public const string HistoryOperation = "get_api_v1_media";

    /// <summary>The Segoe Fluent glyph for the page-level empty surface (web <c>Music</c>).</summary>
    public const string EmptyGlyph = MediaPlayerProjection.MusicGlyph;

    /// <summary>The localized page title (web <c>t('Media Player')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Media Player", "Media Player");
    }
}

/// <summary>
/// PII-safe diagnostics sink for the Media-Player surface — records only the <c>view.opened</c> event with the
/// surface slug, never any vehicle data. Mirrors the sibling feature-view diagnostics.
/// </summary>
public sealed class MediaPlayerDiagnostics
{
    private readonly Action<string>? _sink;
    private int _viewsOpened;

    /// <summary>Creates the diagnostics sink over an optional line writer.</summary>
    public MediaPlayerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface was opened.</summary>
    public int ViewsOpened => _viewsOpened;

    /// <summary>Record that the surface was opened (PII-safe).</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MediaPlayerRegistration.Slug}");
    }
}
