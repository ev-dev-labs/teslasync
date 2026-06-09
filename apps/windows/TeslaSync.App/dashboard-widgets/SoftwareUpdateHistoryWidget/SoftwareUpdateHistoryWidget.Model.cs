using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="SoftwareUpdateHistoryViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>SoftwareUpdateHistoryWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetEventFeed</c>
/// (web/src/features/dashboard/widgets/SoftwareUpdateHistoryWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web's <c>list.length === 0</c> gate (the
/// shared "No update history" empty state both the compact and feed layouts fall back to) — distinct from a
/// transport failure (<see cref="Error"/>).
/// </summary>
public enum SoftwareUpdateHistoryState
{
    /// <summary>Initial fetch with no cached rows — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh list (or non-stale cache) carrying at least one update.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or no updates — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached list exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One firmware-update row from <c>GET /software-updates</c> (web <c>useSoftwareUpdates</c>, shape
/// <c>SoftwareUpdate</c> in web/src/types/vehicle-systems.ts). Field names mirror the Go API's snake_case
/// JSON tags (<c>internal/models/vehicle/vehicle.go</c> — <c>installed_at</c> / <c>scheduled_at</c> /
/// <c>created_at</c>; the web reads the <c>camelCaseKeys</c> aliases of the very same fields). Parsing is
/// null-tolerant so a partial row never throws. The timestamps are kept as their raw wire strings (as the
/// web does) and resolved on demand through <see cref="EffectiveTimestamp"/>.
/// </summary>
/// <param name="Id">Stable update id (web <c>id</c>).</param>
/// <param name="VehicleId">Owning vehicle id (web <c>vehicleId</c>).</param>
/// <param name="Version">Firmware version string (web <c>version</c>), or null.</param>
/// <param name="Status">Lifecycle status: installed / installing / downloading / available / scheduled.</param>
/// <param name="InstalledAtRaw">Install timestamp string (web <c>installedAt</c>), or null.</param>
/// <param name="ScheduledAtRaw">Scheduled timestamp string (web <c>scheduledAt</c>), or null.</param>
/// <param name="CreatedAtRaw">Row creation timestamp string (web <c>createdAt</c>), or null.</param>
public sealed record SoftwareUpdateSample(
    long Id,
    long VehicleId,
    string? Version,
    string? Status,
    string? InstalledAtRaw,
    string? ScheduledAtRaw,
    string? CreatedAtRaw)
{
    /// <summary>
    /// The instant this row is sorted / dated by — the web feed's
    /// <c>installedAt ?? scheduledAt ?? createdAt</c> precedence. Null only when every timestamp is
    /// absent / unparseable (the web's final <c>new Date(0)</c> fallback is applied by the projection).
    /// </summary>
    public DateTimeOffset? EffectiveTimestamp =>
        TryParseTimestamp(InstalledAtRaw)
        ?? TryParseTimestamp(ScheduledAtRaw)
        ?? TryParseTimestamp(CreatedAtRaw);

    /// <summary>Parse a <c>GET /software-updates</c> JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<SoftwareUpdateSample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SoftwareUpdateSample>();
        }

        var list = new List<SoftwareUpdateSample>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single software-update JSON object into a tolerant row.</summary>
    public static SoftwareUpdateSample FromJson(JsonElement obj) => new(
        Id: GetLong(obj, "id") ?? 0,
        VehicleId: GetLong(obj, "vehicle_id") ?? 0,
        Version: GetString(obj, "version"),
        Status: GetString(obj, "status"),
        InstalledAtRaw: GetString(obj, "installed_at"),
        ScheduledAtRaw: GetString(obj, "scheduled_at"),
        CreatedAtRaw: GetString(obj, "created_at"));

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static long? GetLong(JsonElement obj, string name)
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
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1</c> branch in
/// web/src/features/dashboard/widgets/SoftwareUpdateHistoryWidget.tsx (note: the web compact test keys off
/// <em>columns only</em>).
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct SoftwareUpdateHistorySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static SoftwareUpdateHistorySize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): collapse the feed to the latest-version summary.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// Presentation tokens for a software-update status — the native analogue of one entry in the web
/// <c>STATUS_MAP</c> / <c>DEFAULT_STATUS</c>
/// (web/src/features/dashboard/widgets/SoftwareUpdateHistoryWidget.tsx). Holds the Segoe Fluent glyph
/// approximating the web Lucide icon, the theme-token accent brush key reproducing the web hex colour, and
/// the canonical <see cref="SeverityLevel"/> the web row carries. Pure data — no WinUI types.
/// </summary>
/// <param name="Glyph">Segoe Fluent / MDL2 glyph (web Lucide icon).</param>
/// <param name="AccentBrushKey">Token brush key for the row icon (web hex colour).</param>
/// <param name="Severity">Canonical severity (web <c>EventFeedItem.severity</c>).</param>
public readonly record struct SoftwareUpdateStatusTokens(string Glyph, string AccentBrushKey, SeverityLevel Severity);

/// <summary>
/// Status → presentation lookup — the native port of the web <c>STATUS_MAP</c> + <c>DEFAULT_STATUS</c>.
/// Web hex colours map onto the nearest semantic design token: installed→success (green), installing→warning
/// (amber), downloading→info (blue), available→neutral (grey), scheduled→info (the palette has no purple
/// token, so the web <c>#a78bfa</c> falls back to the info accent while keeping the web's <c>info</c>
/// severity). Lookup is case-insensitive and any unknown status resolves to the neutral download default.
/// </summary>
public static class SoftwareUpdateStatusPresentation
{
    /// <summary>Status value: a fully installed firmware build (web <c>installed</c>).</summary>
    public const string Installed = "installed";

    /// <summary>Status value: the build is being applied (web <c>installing</c>).</summary>
    public const string Installing = "installing";

    /// <summary>Status value: the build is downloading to the vehicle (web <c>downloading</c>).</summary>
    public const string Downloading = "downloading";

    /// <summary>Status value: a build is offered but not yet downloading (web <c>available</c>).</summary>
    public const string Available = "available";

    /// <summary>Status value: an install is scheduled for later (web <c>scheduled</c>).</summary>
    public const string Scheduled = "scheduled";

    // Segoe MDL2 / Fluent glyphs: Completed (check), Download, Recent (clock).
    private const string CheckGlyph = "\uE930";
    private const string DownloadGlyph = "\uE896";
    private const string ClockGlyph = "\uE823";

    private static readonly SoftwareUpdateStatusTokens DefaultTokens =
        new(DownloadGlyph, "TsColorTextSecondaryBrush", SeverityLevel.Info);

    private static readonly Dictionary<string, SoftwareUpdateStatusTokens> Map =
        new(StringComparer.OrdinalIgnoreCase)
        {
            [Installed] = new(CheckGlyph, "TsColorSuccessBrush", SeverityLevel.Info),
            [Installing] = new(DownloadGlyph, "TsColorWarningBrush", SeverityLevel.Warn),
            [Downloading] = new(DownloadGlyph, "TsColorInfoBrush", SeverityLevel.Info),
            [Available] = new(DownloadGlyph, "TsColorTextSecondaryBrush", SeverityLevel.Info),
            [Scheduled] = new(ClockGlyph, "TsColorInfoBrush", SeverityLevel.Info),
        };

    /// <summary>Resolve the presentation tokens for <paramref name="status"/> (null / unknown → the default).</summary>
    public static SoftwareUpdateStatusTokens For(string? status) =>
        status is not null && Map.TryGetValue(status, out var tokens) ? tokens : DefaultTokens;

    /// <summary>True when <paramref name="status"/> is the installed status (case-insensitive).</summary>
    public static bool IsInstalled(string? status) =>
        string.Equals(status, Installed, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The compact-summary badge status (web <c>Badge variant</c>): installed→success, installing→warning,
    /// everything else→info.
    /// </summary>
    public static StatusKind BadgeStatus(string? status)
    {
        if (string.Equals(status, Installed, StringComparison.OrdinalIgnoreCase))
        {
            return StatusKind.Success;
        }

        return string.Equals(status, Installing, StringComparison.OrdinalIgnoreCase)
            ? StatusKind.Warning
            : StatusKind.Info;
    }
}

/// <summary>
/// One projected, display-ready feed row consumed by the WinUI view — the native analogue of a web
/// <c>EventFeedItem</c> built in the <c>feedItems</c> <c>useMemo</c>. Holds the resolved status presentation
/// (glyph + token brush key, overridden to the cyan accent + check for the current build), the localized
/// title/subtitle, the relative time string, the sort timestamp, the current flag, the carried severity,
/// and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record SoftwareUpdateRow(
    long Id,
    string Version,
    string Glyph,
    string AccentBrushKey,
    string Subtitle,
    string RelativeTime,
    DateTimeOffset Timestamp,
    bool IsCurrent,
    SeverityLevel Severity,
    string AutomationName);

/// <summary>
/// The compact (single-column) summary — the native analogue of the web <c>CompactView</c>. Holds the latest
/// build's version, the badge text (the localized "Current" for an installed build, otherwise the raw status
/// the web surfaces verbatim) and its semantic badge status, plus a Narrator automation name. Pure data.
/// </summary>
public sealed record SoftwareUpdateCompact(
    string Version,
    string BadgeText,
    StatusKind BadgeStatus,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the update history for one footprint — the native analogue of
/// everything the web component computes via <c>useMemo</c> before returning JSX. Holds the newest-first,
/// capped feed rows (standard layout) and the latest-build compact summary (single-column layout), already
/// gated by the web's <c>list.length</c> empty check. Pure data so the projection is unit-tested without a
/// UI host.
/// </summary>
/// <param name="IsCompact">True at a single column: render the compact summary, not the feed.</param>
/// <param name="HasData">Whether any update exists (web <c>list.length &gt; 0</c>).</param>
/// <param name="Rows">The newest-first, capped feed rows (empty when <paramref name="HasData"/> is false).</param>
/// <param name="Compact">The latest-build compact summary (null when <paramref name="HasData"/> is false).</param>
public sealed record SoftwareUpdateHistoryDisplay(
    bool IsCompact,
    bool HasData,
    IReadOnlyList<SoftwareUpdateRow> Rows,
    SoftwareUpdateCompact? Compact);

/// <summary>
/// Pure projection from the raw update list to the display model — the native port of the <c>feedItems</c> /
/// <c>latest</c> / <c>isCompact</c> <c>useMemo</c> work in
/// web/src/features/dashboard/widgets/SoftwareUpdateHistoryWidget.tsx plus <c>WidgetEventFeed</c>'s
/// newest-first sort and <c>maxItems</c> slice. The current build is detected on the raw list order (the web
/// <c>idx === 0 &amp;&amp; status === 'installed'</c>) before the feed re-sorts by timestamp, so it keeps its
/// cyan accent and "Current" label. <c>now</c> is injected so the relative-time tiers are unit-tested
/// deterministically. Every label resolves through the i18n facade.
/// </summary>
public static class SoftwareUpdateHistoryProjection
{
    /// <summary>Segoe Fluent "Download" glyph for the surface header / empty state (web <c>Download</c>).</summary>
    public const string HeaderGlyph = "\uE896";

    /// <summary>The em dash the web renders for an absent version / status (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Maximum feed rows rendered (web <c>maxItems={15}</c>).</summary>
    public const int MaxFeedItems = 15;

    /// <summary>Cyan accent brush key for the current build (web <c>#22d3ee</c>).</summary>
    public const string CurrentAccentBrushKey = "TsColorAccentBrush";

    /// <summary>Segoe Fluent "Completed" glyph for the current build (web <c>CheckCircle2</c>).</summary>
    public const string CurrentGlyph = "\uE930";

    /// <summary>Project <paramref name="samples"/> for <paramref name="size"/> using the localizer for every label.</summary>
    public static SoftwareUpdateHistoryDisplay Project(
        IReadOnlyList<SoftwareUpdateSample> samples,
        SoftwareUpdateHistorySize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(localizer);

        bool hasData = samples.Count > 0;
        if (!hasData)
        {
            return new SoftwareUpdateHistoryDisplay(size.IsCompact, HasData: false, Array.Empty<SoftwareUpdateRow>(), Compact: null);
        }

        string currentLabel = localizer.GetString("widget.updateCurrent", "Current");

        var rows = new List<SoftwareUpdateRow>(samples.Count);
        for (int i = 0; i < samples.Count; i++)
        {
            rows.Add(BuildRow(samples[i], isCurrent: i == 0 && SoftwareUpdateStatusPresentation.IsInstalled(samples[i].Status), currentLabel, now));
        }

        // Web parity: WidgetEventFeed sorts the items newest-first by timestamp and slices to maxItems.
        // OrderByDescending is a stable sort, so equal timestamps keep their original (API) order.
        var feed = rows
            .OrderByDescending(static r => r.Timestamp)
            .Take(MaxFeedItems)
            .ToList();

        return new SoftwareUpdateHistoryDisplay(
            IsCompact: size.IsCompact,
            HasData: true,
            Rows: feed,
            Compact: BuildCompact(samples[0], currentLabel));
    }

    private static SoftwareUpdateRow BuildRow(
        SoftwareUpdateSample sample,
        bool isCurrent,
        string currentLabel,
        DateTimeOffset now)
    {
        var tokens = SoftwareUpdateStatusPresentation.For(sample.Status);
        string version = string.IsNullOrEmpty(sample.Version) ? EmDash : sample.Version!;

        // Web parity: the current build overrides the status icon/colour with the cyan CheckCircle2 and the
        // "Current" subtitle; otherwise the row shows its raw status (the web surfaces upd.status verbatim).
        string glyph = isCurrent ? CurrentGlyph : tokens.Glyph;
        string accent = isCurrent ? CurrentAccentBrushKey : tokens.AccentBrushKey;
        string subtitle = isCurrent
            ? currentLabel
            : string.IsNullOrEmpty(sample.Status) ? EmDash : sample.Status!;

        // Web parity: timestamp = installedAt ?? scheduledAt ?? createdAt ?? new Date(0).
        DateTimeOffset timestamp = sample.EffectiveTimestamp ?? DateTimeOffset.UnixEpoch;
        string relative = DateTimeFormatting.Format(timestamp, DateTimeVariant.Relative, now);

        return new SoftwareUpdateRow(
            Id: sample.Id,
            Version: version,
            Glyph: glyph,
            AccentBrushKey: accent,
            Subtitle: subtitle,
            RelativeTime: relative,
            Timestamp: timestamp,
            IsCurrent: isCurrent,
            Severity: tokens.Severity,
            AutomationName: string.Create(CultureInfo.CurrentCulture, $"{version}, {subtitle}, {relative}"));
    }

    private static SoftwareUpdateCompact BuildCompact(SoftwareUpdateSample latest, string currentLabel)
    {
        string version = string.IsNullOrEmpty(latest.Version) ? EmDash : latest.Version!;

        // Web parity: installed → "Current"; otherwise the raw status (web t('widget.updateStatus', status)
        // resolves to the status verbatim — the status is API data, not a UI label).
        string badgeText = SoftwareUpdateStatusPresentation.IsInstalled(latest.Status)
            ? currentLabel
            : string.IsNullOrEmpty(latest.Status) ? EmDash : latest.Status!;

        return new SoftwareUpdateCompact(
            Version: version,
            BadgeText: badgeText,
            BadgeStatus: SoftwareUpdateStatusPresentation.BadgeStatus(latest.Status),
            AutomationName: string.Create(CultureInfo.CurrentCulture, $"{version}, {badgeText}"));
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;SoftwareUpdateSample&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. A
/// successful-but-empty array collapses to <see cref="RepositoryResult{T}.Empty"/> (the web's shared
/// "No update history" gate). Kept pure so the parse-and-preserve contract is unit-tested without a network
/// or cache.
/// </summary>
public static class SoftwareUpdateHistoryResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<SoftwareUpdateSample>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<SoftwareUpdateSample> Parse() =>
            raw.HasValue ? SoftwareUpdateSample.ParseList(raw.Value) : Array.Empty<SoftwareUpdateSample>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<SoftwareUpdateSample>> ToLoadedOrEmpty(
        IReadOnlyList<SoftwareUpdateSample> parsed,
        DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}
