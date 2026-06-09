using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="MediaHistoryViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>MediaHistoryWidget</c>
/// renders through <c>WidgetShell</c> + (<c>WidgetEventFeed</c> | <c>CompactView</c>)
/// (web/src/features/dashboard/widgets/MediaHistoryWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> is the friendly "No tracks played" state — the web
/// <c>list.length === 0</c> gate that drives both the compact <c>EmptyState</c> and the feed's
/// <c>emptyMessage</c> — distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum MediaHistoryState
{
    /// <summary>Initial fetch with no cached rows — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh rows from the network (or non-stale cache).</summary>
    Loaded,

    /// <summary>The request resolved with no played tracks — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached rows exist — render the retry affordance.</summary>
    Error,

    /// <summary>Cached rows older than the freshness window — render rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached rows remain — render rows plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One played-track row from the <c>GET /media</c> playback-history change feed (the web
/// <c>useMediaHistory</c> query). Field names mirror the canonical snake_case wire shape the Go
/// <c>MediaHandler.List</c> emits (internal/api/media/handler.go): <c>now_playing_title</c>,
/// <c>now_playing_artist</c>, <c>playback_source</c> (with a <c>now_playing_station</c> fallback, the
/// same precedence the sibling <c>MediaNowPlayingWidget</c> uses), <c>playback_status</c>, the row
/// timestamp (<c>ts</c> ?? <c>created_at</c>) and the synthetic <c>id</c>.
///
/// <para><b>Parity note (documented, not silent).</b> The web <c>MediaHistoryWidget</c> reads
/// <c>item.title</c> / <c>item.artist</c> / <c>item.source</c> / <c>item.timestamp</c> — the camelCase
/// names of its declared <c>MediaSnapshot</c> type (web/src/types/vehicle-systems.ts). Those names do
/// <em>not</em> exist on the actual wire shape: <c>camelCaseKeys</c> does a plain snake→camel transform
/// (web/src/lib/resilience.ts), so only <c>playbackStatus</c>←<c>playback_status</c> and <c>id</c>
/// resolve in the web; title/artist/source/timestamp are a latent web field-name bug. This native port
/// reads the canonical wire fields that actually carry the displayed data — faithful to the widget's
/// intent and to the platform's own handler — so the surface renders real tracks rather than the web's
/// degraded "🎵 — —". Parsing is null-tolerant so a partial row never throws.</para>
/// </summary>
/// <param name="Id">Synthetic row id (web <c>item.id</c>), or 0 when absent.</param>
/// <param name="Title">Track title (wire <c>now_playing_title</c>; web intent <c>item.title</c>), or null.</param>
/// <param name="Artist">Track artist (wire <c>now_playing_artist</c>; web intent <c>item.artist</c>), or null.</param>
/// <param name="Source">Playback source (wire <c>playback_source</c> ?? <c>now_playing_station</c>; web intent <c>item.source</c>), or null.</param>
/// <param name="PlaybackStatus">Playback status (wire <c>playback_status</c>; web <c>item.playbackStatus</c>), or null.</param>
/// <param name="Timestamp">Row timestamp (wire <c>ts</c> ?? <c>created_at</c>; web intent <c>item.timestamp</c>), or null.</param>
public sealed record MediaHistorySample(
    long Id,
    string? Title,
    string? Artist,
    string? Source,
    string? PlaybackStatus,
    DateTimeOffset? Timestamp)
{
    /// <summary>Parse a <c>GET /media</c> JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<MediaHistorySample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<MediaHistorySample>();
        }

        var list = new List<MediaHistorySample>(element.GetArrayLength());
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
    public static MediaHistorySample FromJson(JsonElement obj) => new(
        Id: ReadLong(obj, "id") ?? 0,
        Title: ReadString(obj, "now_playing_title"),
        Artist: ReadString(obj, "now_playing_artist"),

        // Web parity (MediaNowPlayingWidget): playback_source ?? now_playing_station.
        Source: ReadString(obj, "playback_source") ?? ReadString(obj, "now_playing_station"),
        PlaybackStatus: ReadString(obj, "playback_status"),
        Timestamp: ReadTimestamp(obj));

    // Wire parity: the List handler writes BOTH `ts` and `created_at` to the row timestamp; either is
    // the web's intended `item.timestamp`. First non-empty wins, then a plain `timestamp` is honoured
    // defensively. An absent/unparseable stamp parses to null (the web `?? new Date(0)` fallback is
    // applied at projection time, not here).
    private static DateTimeOffset? ReadTimestamp(JsonElement obj) =>
        ParseTimestamp(ReadString(obj, "ts"))
        ?? ParseTimestamp(ReadString(obj, "created_at"))
        ?? ParseTimestamp(ReadString(obj, "timestamp"));

    private static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static long? ReadLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
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

    private static DateTimeOffset? ParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind | DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1</c> branch in
/// web/src/features/dashboard/widgets/MediaHistoryWidget.tsx (the compact test keys off
/// <em>columns only</em>).
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct MediaHistorySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static MediaHistorySize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): render the last track only, not the feed.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One projected, display-ready feed row consumed by the WinUI view — the native analogue of a web
/// <c>EventFeedItem</c> as composed by <c>MediaHistoryWidget</c>'s <c>useMemo</c>. Holds the emoji-prefixed
/// title (<c>🎵 {title} — {artist}</c>), the optional source-label subtitle, the relative time, the
/// resolved playing presentation (a token brush key — green when playing, neutral otherwise) and a
/// Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record MediaHistoryRow(
    long Id,
    string Title,
    string? Subtitle,
    string RelativeTime,
    DateTimeOffset Timestamp,
    bool IsPlaying,
    string AccentBrushKey,
    string Glyph,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the media history for one footprint — the native analogue of
/// everything the web component computes before returning JSX. Carries the newest-first, capped feed rows
/// (the standard layout) AND the compact line for <c>list[0]</c> (the compact layout), so the view is a
/// thin renderer that never re-derives anything. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="IsCompact">True at a single column: render the compact line, not the feed.</param>
/// <param name="HasData">Whether any played track exists (web <c>list.length &gt; 0</c>).</param>
/// <param name="Rows">Feed rows, sorted newest-first and capped to the feed budget (empty when compact / no data).</param>
/// <param name="CompactLine">The compact line for <c>list[0]</c> ("{title} — {artist}" or the no-tracks message), or null when no data.</param>
/// <param name="CompactAutomationName">Narrator name for the compact line, or null when no data.</param>
public sealed record MediaHistoryDisplay(
    bool IsCompact,
    bool HasData,
    IReadOnlyList<MediaHistoryRow> Rows,
    string? CompactLine,
    string? CompactAutomationName);

/// <summary>
/// Pure projection from the raw played-track list to the display model — the native port of the
/// <c>feedItems</c> / <c>lastTrack</c> / <c>sourceLabel</c> <c>useMemo</c> work plus <c>WidgetEventFeed</c>'s
/// newest-first sort and <c>maxItems</c> slice in web/src/features/dashboard/widgets/MediaHistoryWidget.tsx.
/// <c>now</c> is injected so the relative-time tiers are unit-tested deterministically. Every label resolves
/// through the i18n facade.
/// </summary>
public static class MediaHistoryProjection
{
    /// <summary>Segoe Fluent "MusicInfo" glyph for the header / row / empty-state icon (web <c>ListMusic</c> / <c>Music</c>).</summary>
    public const string MusicGlyph = "\uE8D6";

    /// <summary>The em dash the web renders for an absent title / artist (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>The musical-note emoji the web prefixes onto every feed title (web <c>'🎵'</c>).</summary>
    public const string NoteEmoji = "\U0001F3B5";

    /// <summary>Feed cap — the web passes <c>maxItems={10}</c> for the standard layout (size-independent).</summary>
    public const int FeedMaxItems = 10;

    /// <summary>Lowercased playback status that marks a row as actively playing (web <c>=== 'playing'</c>).</summary>
    public const string PlayingStatus = "playing";

    /// <summary>Token brush key for an actively-playing row (web <c>#22c55e</c> — emerald/success).</summary>
    public static string PlayingBrushKey => StatusResources.AccentBrushKey(StatusKind.Success);

    /// <summary>Token brush key for an idle row (web <c>#6b7280</c> — neutral grey).</summary>
    public static string IdleBrushKey => StatusResources.AccentBrushKey(StatusKind.Neutral);

    /// <summary>Project <paramref name="samples"/> for <paramref name="size"/> relative to <paramref name="now"/> using <paramref name="localizer"/>.</summary>
    public static MediaHistoryDisplay Project(
        IReadOnlyList<MediaHistorySample> samples,
        MediaHistorySize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(localizer);

        bool hasData = samples.Count > 0;

        // Web parity (WidgetEventFeed): sort newest-first by timestamp, then cap to maxItems. A row with
        // no timestamp sorts as the epoch (the web `item.timestamp ?? new Date(0)` fallback).
        var rows = hasData
            ? samples
                .OrderByDescending(s => s.Timestamp ?? DateTimeOffset.UnixEpoch)
                .Take(FeedMaxItems)
                .Select(s => BuildRow(s, now))
                .ToList()
            : new List<MediaHistoryRow>();

        // Web parity (compact): lastTrack = list[0] (the raw, unsorted first row), then CompactView shows
        // "{title} — {artist}" unless the title is the em dash, in which case the no-tracks message.
        string? compactLine = null;
        if (hasData)
        {
            compactLine = BuildCompactLine(samples[0], localizer);
        }

        return new MediaHistoryDisplay(
            IsCompact: size.IsCompact,
            HasData: hasData,
            Rows: rows,
            CompactLine: compactLine,
            CompactAutomationName: compactLine);
    }

    /// <summary>
    /// The web <c>sourceLabel</c>: "usb" → "USB"; otherwise the source with its first letter upper-cased.
    /// </summary>
    public static string SourceLabel(string source)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (string.Equals(source, "usb", StringComparison.OrdinalIgnoreCase))
        {
            return "USB";
        }

        if (source.Length == 0)
        {
            return source;
        }

        return string.Create(CultureInfo.CurrentCulture, $"{char.ToUpper(source[0], CultureInfo.CurrentCulture)}{source[1..]}");
    }

    private static MediaHistoryRow BuildRow(MediaHistorySample sample, DateTimeOffset now)
    {
        // Web parity: trackTitle = item.title ?? '—', artist = item.artist ?? '—',
        // title = `🎵 ${trackTitle} — ${artist}`.
        string track = string.IsNullOrEmpty(sample.Title) ? EmDash : sample.Title!;
        string artist = string.IsNullOrEmpty(sample.Artist) ? EmDash : sample.Artist!;
        string title = string.Create(CultureInfo.CurrentCulture, $"{NoteEmoji} {track} {EmDash} {artist}");

        // Web parity: source ? sourceLabel(source) : undefined.
        string source = sample.Source ?? string.Empty;
        string? subtitle = string.IsNullOrEmpty(source) ? null : SourceLabel(source);

        // Web parity: (item.playbackStatus ?? '').toLowerCase() === 'playing'.
        bool isPlaying = string.Equals(sample.PlaybackStatus?.Trim(), PlayingStatus, StringComparison.OrdinalIgnoreCase);

        DateTimeOffset timestamp = sample.Timestamp ?? DateTimeOffset.UnixEpoch;
        string relative = DateTimeFormatting.Format(timestamp, DateTimeVariant.Relative, now);

        return new MediaHistoryRow(
            Id: sample.Id,
            Title: title,
            Subtitle: subtitle,
            RelativeTime: relative,
            Timestamp: timestamp,
            IsPlaying: isPlaying,
            AccentBrushKey: isPlaying ? PlayingBrushKey : IdleBrushKey,
            Glyph: MusicGlyph,
            AutomationName: BuildAutomationName(track, artist, subtitle, relative));
    }

    // Web parity (CompactView): title !== '—' ? `${title} — ${artist}` : t('widget.noMediaPlayed').
    private static string BuildCompactLine(MediaHistorySample sample, ILocalizer localizer)
    {
        string track = string.IsNullOrEmpty(sample.Title) ? EmDash : sample.Title!;
        if (string.Equals(track, EmDash, StringComparison.Ordinal))
        {
            return localizer.GetString("widget.noMediaPlayed", "No tracks played");
        }

        string artist = string.IsNullOrEmpty(sample.Artist) ? EmDash : sample.Artist!;
        return string.Create(CultureInfo.CurrentCulture, $"{track} {EmDash} {artist}");
    }

    private static string BuildAutomationName(string track, string artist, string? subtitle, string relativeTime)
    {
        string head = string.Create(CultureInfo.CurrentCulture, $"{track} {EmDash} {artist}");
        return subtitle is null
            ? string.Format(CultureInfo.CurrentCulture, "{0}, {1}", head, relativeTime)
            : string.Format(CultureInfo.CurrentCulture, "{0}, {1}, {2}", head, subtitle, relativeTime);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;MediaHistorySample&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. A
/// successfully-loaded empty array collapses to <see cref="LoadStatus.Empty"/> (the web's friendly
/// "No tracks played"). Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class MediaHistoryResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<MediaHistorySample>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<MediaHistorySample> Parse() =>
            raw.HasValue ? MediaHistorySample.ParseList(raw.Value) : Array.Empty<MediaHistorySample>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<MediaHistorySample>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<MediaHistorySample>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<MediaHistorySample>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<MediaHistorySample>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<MediaHistorySample>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<MediaHistorySample>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<MediaHistorySample>> ToLoadedOrEmpty(
        IReadOnlyList<MediaHistorySample> parsed,
        DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<MediaHistorySample>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<MediaHistorySample>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}
