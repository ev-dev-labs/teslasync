using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="BackupHistoryViewModel"/> can be in — the native union of the
/// loading / loaded / no-site / no-events / error / stale / offline branches the web
/// <c>BackupHistoryWidget</c> renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/BackupHistoryWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. The web has two distinct empty surfaces — <see cref="NoSite"/>
/// (the <c>!hasSites</c> gate, "No Tesla Energy site linked") and <see cref="NoEvents"/>
/// (the <c>items.length === 0</c> gate, "No backup events in the last 30 days") — so both are
/// modelled here rather than collapsed into one generic empty.
/// </summary>
public enum BackupHistoryState
{
    /// <summary>Initial fetch with no cached rows — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh data from the network (or non-stale cache) with at least one outage.</summary>
    Loaded,

    /// <summary>No Tesla Energy site is linked — render the "no site" empty state (web <c>!hasSites</c>).</summary>
    NoSite,

    /// <summary>A site is linked but no backup events in the window — render the "no events" empty state.</summary>
    NoEvents,

    /// <summary>The request failed and no cached value exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached value older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached value remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Tolerant JSON readers shared by <see cref="BackupEvent"/> and the snapshot parsers. Each returns
/// <see langword="null"/> (or a zero default) for an absent / wrong-kind property so a partial wire body
/// never throws — mirroring the web hook's defensive <c>?? 0</c> / <c>?? null</c> reads. Numeric strings
/// are accepted because the Go API occasionally serializes ids as strings.
/// </summary>
internal static class BackupHistoryJson
{
    internal static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    internal static long? GetLong(JsonElement obj, string name)
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

    internal static double? GetDouble(JsonElement obj, string name)
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
/// One Powerwall backup (power-outage) event from <c>GET /tesla/energy-sites/{siteID}/backup-history</c>
/// (web <c>useTeslaBackupHistory</c>, shape <c>TeslaBackupEvent</c> in web/src/types/energy.ts). Only the
/// fields the widget renders are projected — the id, the event <see cref="Timestamp"/> (kept as the raw
/// wire string as the web does, parsed on demand via <see cref="TimestampTime"/>), and the outage
/// <see cref="DurationSeconds"/>. Parsing is null-tolerant so a partial row never throws.
/// </summary>
public sealed record BackupEvent(
    long Id,
    string? Timestamp,
    double? DurationSeconds)
{
    /// <summary>The parsed event instant, or <see langword="null"/> when absent/unparseable.</summary>
    [JsonIgnore]
    public DateTimeOffset? TimestampTime => TryParseTimestamp(Timestamp);

    /// <summary>Project a single backup-history JSON object into a <see cref="BackupEvent"/>.</summary>
    public static BackupEvent FromJson(JsonElement obj) => new(
        Id: BackupHistoryJson.GetLong(obj, "id") ?? 0,
        Timestamp: BackupHistoryJson.GetString(obj, "timestamp"),
        DurationSeconds: BackupHistoryJson.GetDouble(obj, "duration_seconds"));

    private static DateTimeOffset? TryParseTimestamp(string? raw)
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
/// The parsed two-source payload backing the widget: whether a Tesla Energy site is linked
/// (<see cref="HasSites"/> + its <see cref="SiteId"/>) and the outage <see cref="Events"/> for that site
/// over the trailing window. The web composes <c>useTeslaEnergySites</c> (for the first site id) with
/// <c>useTeslaBackupHistory</c>; this snapshot is the native analogue of both resolved. <see cref="HasData"/>
/// distinguishes a fetched payload (even one with no site / no events) from the absent-body fallback used
/// for the first projection. This type round-trips losslessly through the cache (System.Text.Json over
/// its own well-formed serialization), so the source caches it directly rather than the raw wire JSON.
/// </summary>
public sealed record BackupHistorySnapshot(
    bool HasSites,
    long? SiteId,
    IReadOnlyList<BackupEvent> Events)
{
    /// <summary>The absent-body fallback (no payload yet) — flagged <see cref="HasData"/> = false.</summary>
    public static BackupHistorySnapshot Empty { get; } =
        new(false, null, Array.Empty<BackupEvent>()) { HasData = false };

    /// <summary>A fetched payload that resolved no linked Tesla Energy site (web <c>hasSites === false</c>).</summary>
    public static BackupHistorySnapshot NoSites { get; } =
        new(false, null, Array.Empty<BackupEvent>());

    /// <summary>True when a payload has been fetched (web <c>data</c> truthiness). False only for <see cref="Empty"/>.</summary>
    public bool HasData { get; init; } = true;

    /// <summary>True when at least one outage event is present.</summary>
    [JsonIgnore]
    public bool HasEvents => Events.Count > 0;

    /// <summary>
    /// The first site's <c>energy_site_id</c> from the energy-sites array (web
    /// <c>(sites ?? [])[0]?.energy_site_id</c>), or <see langword="null"/> when the list is empty / the
    /// element is not an object / the id is absent.
    /// </summary>
    public static long? ParseFirstSiteId(JsonElement sites)
    {
        if (sites.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var site in sites.EnumerateArray())
        {
            if (site.ValueKind == JsonValueKind.Object)
            {
                return BackupHistoryJson.GetLong(site, "energy_site_id");
            }
        }

        return null;
    }

    /// <summary>Project a backup-history JSON array into a tolerant list of <see cref="BackupEvent"/>.</summary>
    public static IReadOnlyList<BackupEvent> ParseEvents(JsonElement events)
    {
        if (events.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<BackupEvent>();
        }

        var list = new List<BackupEvent>(events.GetArrayLength());
        foreach (var item in events.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(BackupEvent.FromJson(item));
            }
        }

        return list;
    }

    /// <summary>A linked-site snapshot from the resolved <paramref name="siteId"/> and its events array.</summary>
    public static BackupHistorySnapshot FromSiteAndEvents(long siteId, JsonElement events) =>
        new(true, siteId, ParseEvents(events));

    /// <summary>
    /// Project both wire bodies into a snapshot: the energy-sites array (for the first site id) and the
    /// backup-history array. When no site resolves, the events body is ignored and <see cref="NoSites"/>
    /// is returned — exactly as the web short-circuits on a missing <c>siteId</c>.
    /// </summary>
    public static BackupHistorySnapshot FromJson(JsonElement sites, JsonElement events) =>
        ParseFirstSiteId(sites) is { } siteId ? FromSiteAndEvents(siteId, events) : NoSites;
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> logic in web/src/features/dashboard/widgets/BackupHistoryWidget.tsx: a single column
/// shows one "Outages" stat and at most three rows; wider footprints show the "Outages" + "Avg Duration"
/// stat pair and at most ten rows (web <c>maxEvents = isCompact ? 3 : 10</c>).
/// </summary>
public readonly record struct BackupHistorySize(int Cols, int Rows)
{
    /// <summary>Maximum feed rows in the compact (single-column) footprint (web <c>maxEvents = 3</c>).</summary>
    public const int CompactMaxEvents = 3;

    /// <summary>Maximum feed rows in the standard / wide footprint (web <c>maxEvents = 10</c>).</summary>
    public const int StandardMaxEvents = 10;

    /// <summary>The registry default footprint (2×4).</summary>
    public static BackupHistorySize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>).</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>Maximum feed rows rendered for this footprint (web <c>maxEvents</c>).</summary>
    public int MaxEvents => IsCompact ? CompactMaxEvents : StandardMaxEvents;
}

/// <summary>
/// One projected, display-ready outage row consumed by the WinUI feed. Holds the absolute event time
/// string, the formatted outage duration, a Narrator name and the parsed instant (for ordering). Pure
/// data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record BackupEventRow(
    long Id,
    string TimeText,
    string DurationText,
    string AccessibilityName,
    DateTimeOffset? Timestamp);

/// <summary>
/// The fully projected, render-ready view of the backup history for one footprint — the native analogue of
/// everything the web component computes via <c>useMemo</c> before returning JSX: the linked-site flag, the
/// total outage count and average duration (over <em>all</em> events, web <c>totalOutages</c> /
/// <c>avgDurationSec</c>), and the newest-first, footprint-capped feed rows, plus every localized label.
/// Pure data so the projection is unit-tested directly.
/// </summary>
public sealed record BackupHistoryDisplay(
    bool HasData,
    bool HasSites,
    bool IsCompact,
    bool HasEvents,
    int TotalOutages,
    IReadOnlyList<BackupEventRow> Events,
    string OutagesLabel,
    string OutagesValue,
    string AvgDurationLabel,
    string AvgDurationValue,
    string DurationLabel);

/// <summary>
/// Pure projection from a parsed <see cref="BackupHistorySnapshot"/> to the display model — the native port
/// of the <c>totalOutages</c> / <c>avgDurationSec</c> / <c>sortedItems</c> <c>useMemo</c> work plus the
/// compact/standard branch in web/src/features/dashboard/widgets/BackupHistoryWidget.tsx. Durations are
/// dimensionless seconds (no SI conversion needed); every label resolves through the i18n facade. <c>now</c>
/// is injected so the date formatting is deterministic in tests.
/// </summary>
public static class BackupHistoryProjection
{
    /// <summary>Seconds in a minute — the web <c>fmtDuration</c> sub-minute boundary.</summary>
    private const double SecondsPerMinute = 60.0;

    /// <summary>
    /// Format a seconds duration exactly as the web <c>fmtDuration</c> helper does: below a minute,
    /// "<c>{round(s)}s</c>"; otherwise whole hours/minutes — "<c>{h}h {m}m</c>", "<c>{h}h</c>" (no leftover
    /// minutes) or "<c>{m}m</c>" (under an hour). Negative / non-finite inputs are floored to "0s".
    /// </summary>
    public static string FormatDuration(double seconds)
    {
        if (double.IsNaN(seconds) || double.IsInfinity(seconds) || seconds <= 0)
        {
            return "0s";
        }

        if (seconds < SecondsPerMinute)
        {
            long rounded = (long)Math.Round(seconds, MidpointRounding.AwayFromZero);
            return string.Create(CultureInfo.InvariantCulture, $"{rounded}s");
        }

        long mins = (long)Math.Floor(seconds / SecondsPerMinute);
        long hrs = mins / 60;
        long remainMins = mins % 60;
        if (hrs > 0)
        {
            return remainMins > 0
                ? string.Create(CultureInfo.InvariantCulture, $"{hrs}h {remainMins}m")
                : string.Create(CultureInfo.InvariantCulture, $"{hrs}h");
        }

        return string.Create(CultureInfo.InvariantCulture, $"{mins}m");
    }

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> at <paramref name="now"/> using the i18n facade.</summary>
    public static BackupHistoryDisplay Project(
        BackupHistorySnapshot data,
        BackupHistorySize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        string outagesLabel = localizer.GetString("widget.backupHistory.outages30d", "Outages (30d)");
        string avgDurationLabel = localizer.GetString("widget.backupHistory.avgDuration", "Avg Duration");
        string durationLabel = localizer.GetString("widget.backupHistory.duration", "Duration");

        var items = data.Events;
        int totalOutages = items.Count;
        double avgDurationSec = AverageDurationSeconds(items);

        var rows = ProjectRows(items, size.MaxEvents, durationLabel, now);

        return new BackupHistoryDisplay(
            HasData: data.HasData,
            HasSites: data.HasSites,
            IsCompact: size.IsCompact,
            HasEvents: totalOutages > 0,
            TotalOutages: totalOutages,
            Events: rows,
            OutagesLabel: outagesLabel,
            OutagesValue: ScalarFormatters.FormatNumber(totalOutages, 0),
            AvgDurationLabel: avgDurationLabel,
            AvgDurationValue: FormatDuration(avgDurationSec),
            DurationLabel: durationLabel);
    }

    /// <summary>Mean outage duration over <em>all</em> events (web <c>avgDurationSec</c>), zero when empty.</summary>
    public static double AverageDurationSeconds(IReadOnlyList<BackupEvent> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        if (items.Count == 0)
        {
            return 0;
        }

        double total = 0;
        foreach (var ev in items)
        {
            total += ev.DurationSeconds ?? 0;
        }

        return total / items.Count;
    }

    private static List<BackupEventRow> ProjectRows(
        IReadOnlyList<BackupEvent> items,
        int maxEvents,
        string durationLabel,
        DateTimeOffset now)
    {
        var ordered = items
            .OrderByDescending(e => e.TimestampTime ?? DateTimeOffset.MinValue)
            .Take(maxEvents);

        var rows = new List<BackupEventRow>(Math.Min(items.Count, maxEvents));
        foreach (var ev in ordered)
        {
            string timeText = DateTimeFormatting.Format(ev.TimestampTime, DateTimeVariant.Full, now);
            string durationText = FormatDuration(ev.DurationSeconds ?? 0);
            string accessibilityName = string.Format(
                CultureInfo.CurrentCulture, "{0}, {1}: {2}", timeText, durationLabel, durationText);

            rows.Add(new BackupEventRow(
                Id: ev.Id,
                TimeText: timeText,
                DurationText: durationText,
                AccessibilityName: accessibilityName,
                Timestamp: ev.TimestampTime));
        }

        return rows;
    }
}
