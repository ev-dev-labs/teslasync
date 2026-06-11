using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The lifecycle state of the existing-share-links read the <see cref="ShareDriveDialogViewModel"/> owns — the
/// native union of the loading / loaded / empty / error / stale / offline branches the surface renders. The web
/// <c>ShareDriveDialog</c> (web/src/features/driving/components/ShareDriveDialog.tsx) only shows a spinner while
/// <c>useShareLinks</c> is loading and the list once it resolves; the native modal owns that read through the
/// shared cache-then-network layer and renders every branch, so the active-links region is never a blank box.
/// </summary>
public enum ShareDriveState
{
    /// <summary>Initial fetch with no cached links — render the loading affordance.</summary>
    Loading,

    /// <summary>Fresh links from the network (or non-stale cache).</summary>
    Loaded,

    /// <summary>The request resolved with no links — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached links exist — render the retry affordance.</summary>
    Error,

    /// <summary>Cached links older than the freshness window — render links plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached links remain — render links plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One parsed drive share-link — the native mirror of the web <c>ShareToken</c> (web/src/types/sharing.ts) and the
/// generated <c>TeslaSync.Windows.Generated.Api.ShareToken</c>. Only the fields the dialog renders are projected
/// (the list row shows title / views / expiry and copies the public link); the wire is snake_case
/// (<c>token</c> / <c>include_speed</c> / <c>expires_at</c> / …). Pure data — no WinUI types.
/// </summary>
public sealed record ShareLink(
    long Id,
    string Token,
    string? Title,
    long Views,
    bool IncludeSpeed,
    bool IncludeTelemetry,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset? CreatedAt);

/// <summary>One option in the "Link expires after" dropdown (the day count value + its localized label).</summary>
public sealed record ShareExpiryOption(string Value, string Label);

/// <summary>
/// One projected, display-ready active-share row consumed by the WinUI view's link list — the native mirror of the
/// web <c>shares.map(...)</c> body. Holds the localized title (web <c>title ?? 'Untitled share'</c>), the views
/// label (web <c>{views} views</c>), the expiry label (web Expired / Expires {{date}} / No expiry), the public
/// share URL the copy button places on the clipboard (web <c>${origin}/s/${token}</c>), and the Narrator names for
/// the row + its copy / revoke affordances. Pure data — no WinUI types.
/// </summary>
public sealed record ShareLinkRow(
    string Token,
    string ShareUrl,
    string TitleDisplay,
    string ViewsLabel,
    string ExpiryLabel,
    bool IsExpired,
    string AutomationName,
    string CopyAutomationName,
    string RevokeAutomationName);

/// <summary>The projected active-share list: the render-ready rows plus a convenience emptiness flag.</summary>
public sealed record ShareLinksDisplay(IReadOnlyList<ShareLinkRow> Rows)
{
    /// <summary>An empty display (no active links).</summary>
    public static ShareLinksDisplay Empty { get; } = new(Array.Empty<ShareLinkRow>());

    /// <summary>True when there is at least one active share link to render.</summary>
    public bool HasRows => Rows.Count > 0;
}

/// <summary>
/// The <c>POST /drives/{driveID}/share</c> request body — the native mirror of the web <c>CreateShareRequest</c>
/// (web/src/types/sharing.ts) the create form fills. Every property carries an explicit snake_case
/// <see cref="JsonPropertyNameAttribute"/> so the wire matches the Go API regardless of the serializer's naming
/// policy. <see cref="Title"/> and <see cref="ExpiresInDays"/> are omitted when null — the web sends
/// <c>title || undefined</c> and <c>expires_in_days: Number(expiryDays) || undefined</c> (so an empty title and the
/// "Never" option are dropped from the payload).
/// </summary>
public sealed record CreateShareBody(
    [property: JsonPropertyName("title")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Title,
    [property: JsonPropertyName("include_speed")] bool IncludeSpeed,
    [property: JsonPropertyName("include_telemetry")] bool IncludeTelemetry,
    [property: JsonPropertyName("expires_in_days")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    int? ExpiresInDays);

/// <summary>
/// The parsed <c>POST /drives/{driveID}/share</c> response — the native mirror of the web <c>CreateShareResponse</c>
/// (<c>token</c> / <c>url</c> / <c>id</c>). The dialog builds the displayed link from the origin + token (web
/// parity), keeping the server-supplied <see cref="Url"/> as a fallback.
/// </summary>
public sealed record ShareCreateResult(string Token, string? Url, long Id);

/// <summary>
/// The outcome of a single create-share mutation — the native analogue of the web <c>useCreateShareLink</c> mutation
/// resolving. On success it carries the created token; on an HTTP fault it carries a classified
/// <see cref="Error"/> rather than throwing, so the caller raises a toast rather than an unhandled rejection.
/// </summary>
public sealed record ShareCreateOutcome(bool Success, ShareCreateResult? Result, RepositoryError? Error)
{
    /// <summary>A successful create carrying the new share token.</summary>
    public static ShareCreateOutcome Ok(ShareCreateResult result) => new(true, result, null);

    /// <summary>A classified failure.</summary>
    public static ShareCreateOutcome Fail(RepositoryError error) => new(false, null, error);
}

/// <summary>
/// The outcome of a single revoke-share mutation — the native analogue of the web <c>useRevokeShareLink</c> mutation
/// resolving. Success carries no payload; a fault carries a classified <see cref="Error"/> rather than throwing.
/// </summary>
public sealed record ShareRevokeOutcome(bool Success, RepositoryError? Error)
{
    /// <summary>A successful revoke.</summary>
    public static ShareRevokeOutcome Ok() => new(true, null);

    /// <summary>A classified failure.</summary>
    public static ShareRevokeOutcome Fail(RepositoryError error) => new(false, error);
}

/// <summary>
/// Null-tolerant parser for the <c>GET /drives/{driveID}/shares</c> payload (generated operation
/// <c>get_api_v1_drives_driveID_shares</c>) — the native analogue of the web <c>useShareLinks</c> query returning
/// <c>ShareToken[]</c>. It reads each snake_case object onto the canonical <see cref="ShareLink"/>, skipping any row
/// without a token (not renderable — the copy / revoke actions both key off the token) so a partial payload never
/// throws. Kept WinUI-free so it is asserted headlessly.
/// </summary>
public static class ShareDriveDialogParser
{
    /// <summary>Parse a <c>GET /drives/{driveID}/shares</c> JSON array into a tolerant list of share links.</summary>
    public static IReadOnlyList<ShareLink> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ShareLink>();
        }

        var list = new List<ShareLink>(element.GetArrayLength());
        foreach (JsonElement item in element.EnumerateArray())
        {
            if (FromJson(item) is { } link)
            {
                list.Add(link);
            }
        }

        return list;
    }

    /// <summary>Project a single share-link JSON object, or <see langword="null"/> when not renderable.</summary>
    public static ShareLink? FromJson(JsonElement obj)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        string? token = GetString(obj, "token");
        if (string.IsNullOrEmpty(token))
        {
            return null;
        }

        return new ShareLink(
            Id: GetLong(obj, "id") ?? 0,
            Token: token,
            Title: NullIfBlank(GetString(obj, "title")),
            Views: GetLong(obj, "views") ?? 0,
            IncludeSpeed: GetBool(obj, "include_speed"),
            IncludeTelemetry: GetBool(obj, "include_telemetry"),
            ExpiresAt: GetDate(obj, "expires_at"),
            CreatedAt: GetDate(obj, "created_at"));
    }

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out JsonElement v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static bool GetBool(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out JsonElement v) && v.ValueKind == JsonValueKind.True;

    private static long? GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out JsonElement v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out long n) => n,
            JsonValueKind.String when long.TryParse(
                v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long n) => n,
            _ => null,
        };
    }

    private static DateTimeOffset? GetDate(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out JsonElement v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
            out DateTimeOffset parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// Pure projection from parsed <see cref="ShareLink"/>s to display-ready <see cref="ShareLinkRow"/>s — the native
/// mirror of the web <c>shares.map(...)</c> body. It resolves the localized title / views / expiry labels, builds
/// the public share URL the copy button uses (web <c>${origin}/s/${token}</c>), and composes the per-row Narrator
/// name. Kept WinUI-free so the projection is unit-tested without a host.
/// </summary>
public static class ShareDriveDialogProjection
{
    /// <summary>Project the <paramref name="links"/> into accessible display rows in source order.</summary>
    public static ShareLinksDisplay Project(
        IReadOnlyList<ShareLink> links,
        string originBase,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(links);
        ArgumentNullException.ThrowIfNull(localizer);

        if (links.Count == 0)
        {
            return ShareLinksDisplay.Empty;
        }

        string copyAria = localizer.GetString("share.copyLink", "Copy link");
        string revokeAria = localizer.GetString("share.revoke", "Revoke");

        var rows = new List<ShareLinkRow>(links.Count);
        foreach (ShareLink link in links)
        {
            string title = TitleDisplay(link, localizer);
            string views = ViewsLabel(link.Views, localizer);
            bool expired = IsExpired(link, now);
            string expiry = ExpiryLabel(link, now, localizer);
            rows.Add(new ShareLinkRow(
                Token: link.Token,
                ShareUrl: BuildShareUrl(originBase, link.Token),
                TitleDisplay: title,
                ViewsLabel: views,
                ExpiryLabel: expiry,
                IsExpired: expired,
                AutomationName: string.Create(CultureInfo.CurrentCulture, $"{title}. {views}. {expiry}"),
                CopyAutomationName: string.Create(CultureInfo.CurrentCulture, $"{copyAria}: {title}"),
                RevokeAutomationName: string.Create(CultureInfo.CurrentCulture, $"{revokeAria}: {title}")));
        }

        return new ShareLinksDisplay(rows);
    }

    /// <summary>Build the public share URL (web <c>${window.location.origin}/s/${token}</c>).</summary>
    public static string BuildShareUrl(string originBase, string token)
    {
        string trimmed = (originBase ?? string.Empty).TrimEnd('/');
        return string.Create(CultureInfo.InvariantCulture, $"{trimmed}/s/{token}");
    }

    /// <summary>The displayed title (web <c>share.title ?? 'Untitled share'</c>).</summary>
    public static string TitleDisplay(ShareLink link, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(link);
        ArgumentNullException.ThrowIfNull(localizer);
        return string.IsNullOrWhiteSpace(link.Title)
            ? localizer.GetString("share.untitled", "Untitled share")
            : link.Title!;
    }

    /// <summary>The views label (web <c>{views} views</c>).</summary>
    public static string ViewsLabel(long views, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string word = localizer.GetString("share.views", "views");
        return string.Create(CultureInfo.CurrentCulture, $"{views} {word}");
    }

    /// <summary>True when the link carries an expiry that is already in the past (web <c>isExpired</c>).</summary>
    public static bool IsExpired(ShareLink link, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(link);
        return link.ExpiresAt is { } expiresAt && expiresAt < now;
    }

    /// <summary>
    /// The expiry label: Expired when past, "Expires {{date}}" when set, else "No expiry" (web ternary parity).
    /// </summary>
    public static string ExpiryLabel(ShareLink link, DateTimeOffset now, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(link);
        ArgumentNullException.ThrowIfNull(localizer);

        if (IsExpired(link, now))
        {
            return localizer.GetString("share.expired", "Expired");
        }

        if (link.ExpiresAt is { } expiresAt)
        {
            string template = localizer.GetString("share.expiresOn", "Expires {{date}}");
            return template.Replace("{{date}}", FormatDate(expiresAt), StringComparison.Ordinal);
        }

        return localizer.GetString("share.noExpiry", "No expiry");
    }

    /// <summary>
    /// Format an instant as a date-only label in the user's local zone (web <c>formatDate</c> →
    /// <c>toLocaleDateString({ year, month: 'short', day })</c>, e.g. "Apr 4, 2026").
    /// </summary>
    public static string FormatDate(DateTimeOffset value) =>
        value.ToLocalTime().ToString("MMM d, yyyy", CultureInfo.CurrentCulture);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;ShareLink&gt;&gt;</c>, preserving every freshness flag (cached /
/// refreshing / stale / offline) so the view-model can render the full state matrix and collapsing a successful
/// empty array to <see cref="LoadStatus.Empty"/>. Kept pure so the parse-and-preserve contract is unit-tested
/// without a network or cache.
/// </summary>
public static class ShareDriveDialogResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<ShareLink>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<ShareLink> Parse() =>
            raw.HasValue ? ShareDriveDialogParser.ParseList(raw.Value) : Array.Empty<ShareLink>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<ShareLink>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<ShareLink>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<ShareLink>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<ShareLink>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<ShareLink>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<ShareLink>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<ShareLink>> ToLoadedOrEmpty(
        IReadOnlyList<ShareLink> parsed,
        DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<ShareLink>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<ShareLink>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}

/// <summary>
/// Canonical metadata, generated-operation ids, Segoe Fluent glyphs, expiry options and i18n keys for the
/// <c>ShareDriveDialog</c> surface — the native mirror of <c>web/src/features/driving/components/ShareDriveDialog.tsx</c>.
/// The web component ships literal copy; every literal is keyed here (with that literal as the English fallback) so
/// the native view and view-model stay free of inline strings and resolve through the i18n facade. UI-free so every
/// key + value is asserted in tests.
/// </summary>
public static class ShareDriveDialogRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "share-drive-dialog";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ShareDriveDialog";

    /// <summary>Generated operation id for the existing-links read (web <c>useShareLinks</c>).</summary>
    public const string ListOperation = "get_api_v1_drives_driveID_shares";

    /// <summary>Generated operation id for the create-link mutation (web <c>useCreateShareLink</c>).</summary>
    public const string CreateOperation = "post_api_v1_drives_driveID_share";

    /// <summary>Generated operation id for the revoke-link mutation (web <c>useRevokeShareLink</c>).</summary>
    public const string RevokeOperation = "delete_api_v1_shares_token";

    /// <summary>The expiry-select value chosen by default (web <c>useState('30')</c>).</summary>
    public const string DefaultExpiryDays = "30";

    /// <summary>Segoe Fluent "Link" glyph (web lucide <c>Link</c>) on the Generate action.</summary>
    public const string LinkGlyph = "\uE71B";

    /// <summary>Segoe Fluent "OpenInNewWindow" glyph (web lucide <c>ExternalLink</c>) on the open action.</summary>
    public const string ExternalLinkGlyph = "\uE8A7";

    /// <summary>Segoe Fluent "Delete" glyph (web lucide <c>Trash2</c>) on the revoke action.</summary>
    public const string TrashGlyph = "\uE74D";

    /// <summary>Segoe Fluent "RedEye" glyph (web lucide <c>Eye</c>) beside the views count.</summary>
    public const string EyeGlyph = "\uE7B3";

    /// <summary>Modal title (web <c>title="Share Drive"</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("share.title", "Share Drive");

    /// <summary>Intro description (web <c>share.description</c>).</summary>
    public static string Description(ILocalizer localizer) =>
        Require(localizer).GetString(
            "share.description",
            "Generate a public link to share this drive report. Anyone with the link can view the map, stats, and charts \u2014 no login required.");

    /// <summary>Optional-title field hint (web <c>share.titlePlaceholder</c>).</summary>
    public static string TitleHint(ILocalizer localizer) =>
        Require(localizer).GetString("share.titlePlaceholder", "Optional title (e.g., \u201CSF to LA Road Trip\u201D)"); // parity:allow web i18n key kept verbatim for catalog parity

    /// <summary>Include-speed toggle label (web <c>share.includeSpeed</c>).</summary>
    public static string IncludeSpeed(ILocalizer localizer) =>
        Require(localizer).GetString("share.includeSpeed", "Include speed data");

    /// <summary>Include-telemetry toggle label (web <c>share.includeTelemetry</c>).</summary>
    public static string IncludeTelemetry(ILocalizer localizer) =>
        Require(localizer).GetString("share.includeTelemetry", "Include detailed telemetry (battery, power)");

    /// <summary>Expiry select label (web <c>share.expiry</c>).</summary>
    public static string ExpiryHeading(ILocalizer localizer) =>
        Require(localizer).GetString("share.expiry", "Link expires after");

    /// <summary>Generate-link button label (web <c>share.generate</c>).</summary>
    public static string Generate(ILocalizer localizer) =>
        Require(localizer).GetString("share.generate", "Generate Link");

    /// <summary>Success heading shown above the created link (web <c>share.created</c>).</summary>
    public static string Created(ILocalizer localizer) =>
        Require(localizer).GetString("share.created", "Share link created!");

    /// <summary>Copy-link primary button label (web <c>share.copy</c>).</summary>
    public static string Copy(ILocalizer localizer) =>
        Require(localizer).GetString("share.copy", "Copy Link");

    /// <summary>Copy confirmation label briefly shown after a copy (web <c>CopyButton</c> toast).</summary>
    public static string Copied(ILocalizer localizer) =>
        Require(localizer).GetString("common.copied", "Copied");

    /// <summary>"Create another link" reset action (web <c>share.createAnother</c>).</summary>
    public static string CreateAnother(ILocalizer localizer) =>
        Require(localizer).GetString("share.createAnother", "Create another link");

    /// <summary>Active-links section header (web <c>share.existing</c>).</summary>
    public static string Existing(ILocalizer localizer) =>
        Require(localizer).GetString("share.existing", "Active Share Links");

    /// <summary>Untitled-share fallback (web <c>share.untitled</c>).</summary>
    public static string Untitled(ILocalizer localizer) =>
        Require(localizer).GetString("share.untitled", "Untitled share");

    /// <summary>Per-row copy affordance label (web <c>share.copyLink</c>).</summary>
    public static string CopyLink(ILocalizer localizer) =>
        Require(localizer).GetString("share.copyLink", "Copy link");

    /// <summary>Per-row revoke affordance label (web <c>share.revoke</c>).</summary>
    public static string Revoke(ILocalizer localizer) =>
        Require(localizer).GetString("share.revoke", "Revoke");

    /// <summary>Modal close affordance label (web <c>Modal</c> close <c>aria-label="Close"</c>).</summary>
    public static string Close(ILocalizer localizer) =>
        Require(localizer).GetString("common.close", "Close");

    /// <summary>Open-in-browser affordance label for the created link (Windows-idiomatic external open).</summary>
    public static string OpenLink(ILocalizer localizer) =>
        Require(localizer).GetString("share.openLink", "Open link in browser");

    /// <summary>Empty-state message when no active links exist yet.</summary>
    public static string EmptyMessage(ILocalizer localizer) =>
        Require(localizer).GetString("share.empty", "No active share links yet.");

    /// <summary>Loading caption for the active-links read.</summary>
    public static string Loading(ILocalizer localizer) =>
        Require(localizer).GetString("share.loading", "Loading share links\u2026");

    /// <summary>Retry affordance label for the error surface.</summary>
    public static string Retry(ILocalizer localizer) =>
        Require(localizer).GetString("common.retry", "Retry");

    /// <summary>Stale chip label shown while a background refresh runs.</summary>
    public static string Stale(ILocalizer localizer) =>
        Require(localizer).GetString("share.stale", "Updating\u2026");

    /// <summary>Offline chip label shown when serving cached links.</summary>
    public static string Offline(ILocalizer localizer) =>
        Require(localizer).GetString("share.offline", "Offline \u2014 showing cached share links");

    /// <summary>Hard-failure message for the error surface (web <c>QueryError</c> equivalent).</summary>
    public static string ErrorText(ILocalizer localizer) =>
        Require(localizer).GetString("share.error", "Couldn't load share links");

    /// <summary>Success toast after a create (web <c>useCreateShareLink</c> <c>toast.success</c>).</summary>
    public static string CreatedToast(ILocalizer localizer) =>
        Require(localizer).GetString("share.toast.created", "Share link created");

    /// <summary>Failure toast after a create (web <c>useCreateShareLink</c> <c>toast.error</c>).</summary>
    public static string CreateErrorToast(ILocalizer localizer) =>
        Require(localizer).GetString("share.toast.createError", "Failed to create share link");

    /// <summary>Success toast after a revoke (web <c>useRevokeShareLink</c> <c>toast.success</c>).</summary>
    public static string RevokedToast(ILocalizer localizer) =>
        Require(localizer).GetString("share.toast.revoked", "Share link revoked");

    /// <summary>Failure toast after a revoke (web <c>useRevokeShareLink</c> <c>toast.error</c>).</summary>
    public static string RevokeErrorToast(ILocalizer localizer) =>
        Require(localizer).GetString("share.toast.revokeError", "Failed to revoke share link");

    /// <summary>The expiry options in web render order: 7 / 30 / 90 days, then Never.</summary>
    public static IReadOnlyList<ShareExpiryOption> ExpiryOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return
        [
            new ShareExpiryOption("7", localizer.GetString("share.expiry7d", "7 days")),
            new ShareExpiryOption("30", localizer.GetString("share.expiry30d", "30 days")),
            new ShareExpiryOption("90", localizer.GetString("share.expiry90d", "90 days")),
            new ShareExpiryOption("0", localizer.GetString("share.expiryNever", "Never")),
        ];
    }

    /// <summary>
    /// Build the create-share payload from the form fields (web <c>handleCreate</c>): an empty title and the
    /// "Never" / non-positive day count are dropped (web <c>title || undefined</c> /
    /// <c>Number(expiryDays) || undefined</c>).
    /// </summary>
    public static CreateShareBody BuildCreateBody(
        string? title,
        bool includeSpeed,
        bool includeTelemetry,
        string? expiryDays)
    {
        string? trimmedTitle = string.IsNullOrEmpty(title) ? null : title;
        int? days = int.TryParse(expiryDays, NumberStyles.Integer, CultureInfo.InvariantCulture, out int parsed) && parsed > 0
            ? parsed
            : null;
        return new CreateShareBody(trimmedTitle, includeSpeed, includeTelemetry, days);
    }

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>ShareDriveDialog</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters and the surface slug — never a share token, URL, drive id or title — so a diagnostics line
/// can never leak who a drive was shared with. Thread-safe.
/// </summary>
public sealed class ShareDriveDialogDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _linksCreated;
    private long _linksRevoked;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ShareDriveDialogDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of share links successfully created from this surface.</summary>
    public long LinksCreated => Interlocked.Read(ref _linksCreated);

    /// <summary>Number of share links successfully revoked from this surface.</summary>
    public long LinksRevoked => Interlocked.Read(ref _linksRevoked);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ShareDriveDialog</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        Emit("view.opened");
    }

    /// <summary>Record that a share link was created (the token / URL are never logged).</summary>
    public void RecordLinkCreated()
    {
        Interlocked.Increment(ref _linksCreated);
        Emit("share.link.created");
    }

    /// <summary>Record that a share link was revoked (the token is never logged).</summary>
    public void RecordLinkRevoked()
    {
        Interlocked.Increment(ref _linksRevoked);
        Emit("share.link.revoked");
    }

    private void Emit(string action) =>
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"{action} slug={ShareDriveDialogRegistration.Slug}"));
}
