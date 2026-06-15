using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Tesla profile envelope. Every getter returns a
/// nullable / fallback rather than throwing so a partial or schema-drifted body from
/// <c>GET /tesla/user/profile</c> never aborts the parse (web parity: <c>useTeslaUserProfile</c> tolerates
/// undefined fields and coalesces with the em-dash). Kept private to the surface and free of WinUI types so
/// the parse is unit-tested without a UI host.
/// </summary>
internal static class TeslaAccountJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The nested object property <paramref name="name"/>, or a default element when absent / null.</summary>
    public static JsonElement GetObject(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.Object
            ? prop
            : default;

    /// <summary>Parse an ISO-8601 timestamp string to a UTC-normalised instant, or null when unparseable.</summary>
    public static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// One Tesla account profile snapshot from <c>GET /tesla/user/profile</c> — the native analogue of the web
/// <c>TeslaProfileEnvelope</c> (web/src/api/hooks/useUser.ts): the inner <see cref="FullName"/> /
/// <see cref="Email"/> / <see cref="ProfileImageUrl"/> / <see cref="ProfileFetchedAt"/> (the envelope
/// <c>profile</c> object) and the envelope's own <see cref="SyncedAt"/> sync time. Field names mirror the Go
/// API's snake_case JSON tags; parsing is null-tolerant so a partial body never throws. The raw timestamp
/// strings are kept and parsed on demand (web parity — the SPA passes them straight to <c>formatRelative</c> /
/// <c>formatDateTime</c>). Pure data — unit-tested without a UI host.
/// </summary>
/// <param name="HasProfile">True when the envelope carried a <c>profile</c> object (web <c>data.profile</c> guard).</param>
/// <param name="FullName">The account holder's name (web <c>profile.full_name</c>), null when absent.</param>
/// <param name="Email">The account holder's email (web <c>profile.email</c>), null when absent.</param>
/// <param name="ProfileImageUrl">The avatar URL (web <c>profile.profile_image_url</c>), null when absent.</param>
/// <param name="ProfileFetchedAt">The raw profile sync timestamp (web <c>profile.fetched_at</c>), null when absent.</param>
/// <param name="SyncedAt">The raw envelope sync timestamp (web <c>fetched_at</c>), null when never synced.</param>
public sealed record TeslaProfile(
    bool HasProfile,
    string? FullName,
    string? Email,
    string? ProfileImageUrl,
    string? ProfileFetchedAt,
    string? SyncedAt)
{
    /// <summary>The "nothing known yet" snapshot used before the first successful read.</summary>
    public static readonly TeslaProfile Empty = new(false, null, null, null, null, null);

    /// <summary>True when an avatar URL is present (web <c>profile.profile_image_url</c> guard).</summary>
    public bool HasAvatar => !string.IsNullOrWhiteSpace(ProfileImageUrl);

    /// <summary>True when the envelope carries a sync timestamp (web <c>fetchedAt</c> guard on the sync bar).</summary>
    public bool HasSyncTime => SyncedInstant is not null;

    /// <summary>The parsed envelope sync instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? SyncedInstant => TeslaAccountJson.TryParseTimestamp(SyncedAt);

    /// <summary>The parsed profile sync instant (web <c>profile.fetched_at</c>), or null when absent / unparseable.</summary>
    public DateTimeOffset? ProfileFetchedInstant => TeslaAccountJson.TryParseTimestamp(ProfileFetchedAt);

    /// <summary>
    /// Parse a profile envelope. A non-object body (web parity: the query has no usable data) yields the
    /// <see cref="Empty"/> snapshot rather than throwing; a missing/null inner <c>profile</c> object leaves
    /// <see cref="HasProfile"/> false so the friendly empty surface renders.
    /// </summary>
    public static TeslaProfile FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var profile = TeslaAccountJson.GetObject(element, "profile");
        bool hasProfile = profile.ValueKind == JsonValueKind.Object;
        string? fullName = hasProfile ? TeslaAccountJson.GetString(profile, "full_name") : null;
        string? email = hasProfile ? TeslaAccountJson.GetString(profile, "email") : null;
        string? imageUrl = hasProfile ? TeslaAccountJson.GetString(profile, "profile_image_url") : null;
        string? profileFetchedAt = hasProfile ? TeslaAccountJson.GetString(profile, "fetched_at") : null;
        string? syncedAt = TeslaAccountJson.GetString(element, "fetched_at");
        return new TeslaProfile(hasProfile, fullName, email, imageUrl, profileFetchedAt, syncedAt);
    }
}

/// <summary>
/// The top-level state the <c>TeslaAccountPage</c> renders. Every value maps to a visible, non-collapsing
/// surface (no hidden panels): the page header (title, subtitle) and the sync bar are always shown in the
/// content states; the value selects the body chrome. These are exactly the four web data states the page
/// declares — <c>loading</c> (the <c>PageContainer</c> spinner), <c>error</c> (the <c>PageContainer</c> error
/// boundary), <c>empty</c> (the profile card's friendly "click Refresh" surface) and the populated
/// <c>success</c> (<see cref="Ready"/>) branch. The native cache-then-network read folds its cached /
/// refreshing / offline / stale emissions into these four so the profile never blanks out while loading,
/// after a hard failure, or while showing a cached account.
/// </summary>
public enum TeslaAccountSurfaceState
{
    /// <summary>The first profile read is in flight and no cached value exists yet (the page spinner).</summary>
    Loading,

    /// <summary>A profile is known — the populated avatar + details card is shown (web <c>success</c>).</summary>
    Ready,

    /// <summary>The read resolved with no profile — the friendly "click Refresh" empty surface is shown.</summary>
    Empty,

    /// <summary>A hard failure (the read failed with no cache to fall back to) — the page error boundary is shown.</summary>
    Error,
}

/// <summary>
/// The outcome of a "Refresh from Tesla" mutation (<c>POST /tesla/user/profile/refresh</c>) — the native
/// analogue of the web <c>useRefreshTeslaProfile</c> mutation result. On success the surface re-reads the
/// profile (web <c>invalidateQueries</c> → refetch) and announces the success toast; on failure it carries
/// the privacy-safe <see cref="RepositoryError"/> for the failure toast. It never throws for an HTTP fault
/// (web parity: the mutation resolves to a toast, not an unhandled rejection).
/// </summary>
/// <param name="Success">True when the refresh resolved successfully.</param>
/// <param name="Error">The classified failure when <paramref name="Success"/> is false, otherwise null.</param>
public sealed record TeslaProfileRefreshOutcome(bool Success, RepositoryError? Error)
{
    /// <summary>A successful refresh.</summary>
    public static TeslaProfileRefreshOutcome Ok() => new(true, null);

    /// <summary>A failed refresh carrying the classified error.</summary>
    public static TeslaProfileRefreshOutcome Fail(RepositoryError error) => new(false, error);
}

/// <summary>The kind of transient post-refresh notice (the native analogue of the web toast severity).</summary>
public enum TeslaProfileRefreshNoticeKind
{
    /// <summary>The refresh succeeded (web <c>toast.success</c>).</summary>
    Success,

    /// <summary>The refresh failed (web <c>toast.error</c>).</summary>
    Error,
}

/// <summary>
/// A transient post-refresh notice — the native analogue of the web in-app toast the page raises from the
/// mutation's <c>onSuccess</c> / <c>onError</c> callbacks. The view renders it as an assertive live-region
/// line (announced to Narrator), the desktop-idiomatic equivalent of a transient toast. Pure data —
/// unit-tested without a UI host.
/// </summary>
/// <param name="Kind">The notice severity (success / error).</param>
/// <param name="Message">The resolved, localized notice text.</param>
public sealed record TeslaProfileRefreshNotice(TeslaProfileRefreshNoticeKind Kind, string Message);

/// <summary>
/// Maps a raw <see cref="RepositoryResult{T}"/> of the profile JSON envelope onto a typed
/// <see cref="TeslaProfile"/> result, preserving the load status, fetch time, stale flag and the
/// <see cref="RepositoryError"/>. Pure — unit-tested without a UI host. The native analogue of the
/// pass-through the web <c>useQuery</c> does between the raw response and the page.
/// </summary>
public static class TeslaProfileResultMapper
{
    /// <summary>Project one raw profile emission into a typed profile result.</summary>
    public static RepositoryResult<TeslaProfile> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<TeslaProfile>.Loading(),
            LoadStatus.Empty => RepositoryResult<TeslaProfile>.Empty(raw.FetchedAt),
            LoadStatus.Error => RepositoryResult<TeslaProfile>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
            LoadStatus.Cached => RepositoryResult<TeslaProfile>.Cached(
                Profile(raw), raw.FetchedAt ?? default, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<TeslaProfile>.Refreshing(
                Profile(raw), raw.FetchedAt ?? default, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<TeslaProfile>.OfflineCached(
                Profile(raw),
                raw.FetchedAt ?? default,
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<TeslaProfile>.Loaded(Profile(raw), raw.FetchedAt ?? default),
        };
    }

    private static TeslaProfile Profile(RepositoryResult<JsonElement> raw) =>
        raw.HasValue ? TeslaProfile.FromJson(raw.Value) : TeslaProfile.Empty;
}

/// <summary>
/// Canonical registry metadata for the Tesla Account page — the native mirror of the web page
/// (web/src/features/system/pages/TeslaAccountPage.tsx, route <c>/tesla-account</c>). It centralises the
/// deep-link route name, the diagnostics slug and every localized string, keyed exactly as the web
/// <c>t('teslaAccount.*')</c> calls (with the <c>translation.</c> catalog prefix the WinUI resource bridge
/// expects — the same convention the shipped RegionSettings / TeslaRegionPage surfaces use) and the same
/// English fallbacks, so the view and view-model stay free of literal copy. Every fallback equals its
/// <c>Strings/en/Resources.resw</c> value so a headless <see cref="PassthroughLocalizer"/> renders identically
/// to the app's resource bridge. UI-free so it is asserted in tests without a XAML host.
/// </summary>
public static class TeslaAccountRegistration
{
    /// <summary>The em-dash fallback for a missing value (web <c>|| '—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>The deep-link route name (RouteTable <c>Page("TeslaAccount","tesla-account", …)</c>).</summary>
    public const string RouteName = "TeslaAccount";

    /// <summary>Diagnostics surface slug for the page surface (P1/S11).</summary>
    public const string Slug = "TeslaAccountPage";

    /// <summary>i18n key for the page title (web <c>teslaAccount.title</c>).</summary>
    public const string TitleKey = "translation.teslaAccount.title";

    /// <summary>i18n key for the page subtitle (web <c>teslaAccount.subtitle</c>).</summary>
    public const string SubtitleKey = "translation.teslaAccount.subtitle";

    /// <summary>i18n key for the "Last synced: {0}" caption format (web <c>teslaAccount.lastSynced</c>).</summary>
    public const string LastSyncedKey = "translation.teslaAccount.lastSynced";

    /// <summary>i18n key for the never-synced caption (web <c>teslaAccount.neverSynced</c>).</summary>
    public const string NeverSyncedKey = "translation.teslaAccount.neverSynced";

    /// <summary>i18n key for the Refresh button (web <c>teslaAccount.refresh</c>).</summary>
    public const string RefreshKey = "translation.teslaAccount.refresh";

    /// <summary>i18n key for the profile-card title (web <c>teslaAccount.profile</c>).</summary>
    public const string ProfileKey = "translation.teslaAccount.profile";

    /// <summary>i18n key for the avatar accessible name (web <c>teslaAccount.avatar</c>).</summary>
    public const string AvatarKey = "translation.teslaAccount.avatar";

    /// <summary>i18n key for the Name row label (web <c>teslaAccount.name</c>).</summary>
    public const string NameKey = "translation.teslaAccount.name";

    /// <summary>i18n key for the Email row label (web <c>teslaAccount.email</c>).</summary>
    public const string EmailKey = "translation.teslaAccount.email";

    /// <summary>i18n key for the Fetched At row label (web <c>teslaAccount.fetchedAt</c>).</summary>
    public const string FetchedAtKey = "translation.teslaAccount.fetchedAt";

    /// <summary>i18n key for the empty-surface message (web <c>teslaAccount.noProfile</c>).</summary>
    public const string NoProfileKey = "translation.teslaAccount.noProfile";

    /// <summary>Resolve the page title (web <c>t('teslaAccount.title', 'Tesla Account')</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString(TitleKey, "Tesla Account");

    /// <summary>Resolve the page subtitle (web <c>t('teslaAccount.subtitle', …)</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Require(localizer).GetString(SubtitleKey, "Your Tesla account profile synced from the Fleet API");

    /// <summary>Resolve the raw "Last synced: {0}" format string (web <c>teslaAccount.lastSynced</c>).</summary>
    public static string LastSyncedFormat(ILocalizer localizer) =>
        Require(localizer).GetString(LastSyncedKey, "Last synced: {0}");

    /// <summary>
    /// Resolve the sync-bar caption with the relative <paramref name="time"/> interpolated (web
    /// <c>t('teslaAccount.lastSynced', 'Last synced: {{time}}', { time })</c>).
    /// </summary>
    public static string LastSynced(ILocalizer localizer, string time) =>
        string.Format(CultureInfo.CurrentCulture, LastSyncedFormat(localizer), time);

    /// <summary>Resolve the never-synced caption (web <c>t('teslaAccount.neverSynced', …)</c>).</summary>
    public static string NeverSynced(ILocalizer localizer) =>
        Require(localizer).GetString(NeverSyncedKey, "Never synced \u2014 click Refresh to fetch from Tesla");

    /// <summary>Resolve the Refresh button label (web <c>t('teslaAccount.refresh', 'Refresh from Tesla')</c>).</summary>
    public static string Refresh(ILocalizer localizer) =>
        Require(localizer).GetString(RefreshKey, "Refresh from Tesla");

    /// <summary>Resolve the profile-card title (web <c>t('teslaAccount.profile', 'Profile')</c>).</summary>
    public static string ProfileTitle(ILocalizer localizer) =>
        Require(localizer).GetString(ProfileKey, "Profile");

    /// <summary>Resolve the avatar accessible name (web <c>t('teslaAccount.avatar', 'Profile picture')</c>).</summary>
    public static string Avatar(ILocalizer localizer) =>
        Require(localizer).GetString(AvatarKey, "Profile picture");

    /// <summary>Resolve the Name row label (web <c>t('teslaAccount.name', 'Name')</c>).</summary>
    public static string Name(ILocalizer localizer) =>
        Require(localizer).GetString(NameKey, "Name");

    /// <summary>Resolve the Email row label (web <c>t('teslaAccount.email', 'Email')</c>).</summary>
    public static string Email(ILocalizer localizer) =>
        Require(localizer).GetString(EmailKey, "Email");

    /// <summary>Resolve the Fetched At row label (web <c>t('teslaAccount.fetchedAt', 'Fetched At')</c>).</summary>
    public static string FetchedAt(ILocalizer localizer) =>
        Require(localizer).GetString(FetchedAtKey, "Fetched At");

    /// <summary>Resolve the empty-surface message (web <c>t('teslaAccount.noProfile', …)</c>).</summary>
    public static string NoProfile(ILocalizer localizer) =>
        Require(localizer).GetString(
            NoProfileKey,
            "No profile data yet. Click \"Refresh from Tesla\" to sync your account.");

    /// <summary>Loading caption while the first read is in flight (shared <c>common.loading</c>).</summary>
    public static string Loading(ILocalizer localizer) =>
        Require(localizer).GetString("translation.common.loading", "Loading...");

    /// <summary>Retry affordance label for the error surface (shared <c>common.retry</c>).</summary>
    public static string Retry(ILocalizer localizer) =>
        Require(localizer).GetString("translation.common.retry", "Retry");

    /// <summary>Hard-failure message for the error surface (shared <c>error.loadFailed</c>).</summary>
    public static string LoadFailed(ILocalizer localizer) =>
        Require(localizer).GetString("translation.error.loadFailed", "Failed to load data");

    /// <summary>Success notice copy after a refresh (web <c>toast.user.teslaProfile.success</c>).</summary>
    public static string RefreshSucceeded(ILocalizer localizer) =>
        Require(localizer).GetString("translation.toast.user.teslaProfile.success", "Tesla profile refreshed");

    /// <summary>Failure notice copy after a refresh (web <c>toast.user.teslaProfile.error</c>).</summary>
    public static string RefreshFailed(ILocalizer localizer) =>
        Require(localizer).GetString("translation.toast.user.teslaProfile.error", "Failed to refresh Tesla profile");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// The default local-state <see cref="ITeslaAccountSource"/> the page hosts when no live data layer is wired —
/// the host-injection precedent every feature page follows (the page's parameterless constructor defaults to
/// an empty source; an explicit constructor accepts the generated-client-backed <see cref="TeslaAccountSource"/>
/// for tests / dependency injection). It resolves a single successful-but-empty snapshot so the page renders
/// its friendly empty body (web parity: the query has no profile and no fetch time), and the refresh is a
/// no-op success. The view never performs HTTP.
/// </summary>
public sealed class EmptyTeslaAccountSource : ITeslaAccountSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyTeslaAccountSource Instance { get; } = new();

    private EmptyTeslaAccountSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<TeslaProfile>> StreamProfileAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<TeslaProfile>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }

    /// <inheritdoc />
    public Task<TeslaProfileRefreshOutcome> RefreshAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(TeslaProfileRefreshOutcome.Ok());
    }
}

/// <summary>
/// PII-safe diagnostics for the Tesla Account page (P1/S11 diagnostics contract). Records only the operational
/// counters with the surface slug — never the account name, email, avatar URL or any profile detail — so a
/// diagnostics line can never leak a user's Tesla account identity. Thread-safe.
/// </summary>
public sealed class TeslaAccountDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _refreshesRequested;
    private long _refreshesSucceeded;
    private long _refreshesFailed;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TeslaAccountDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of refresh actions requested.</summary>
    public long RefreshesRequested => Interlocked.Read(ref _refreshesRequested);

    /// <summary>Number of refresh actions that succeeded.</summary>
    public long RefreshesSucceeded => Interlocked.Read(ref _refreshesSucceeded);

    /// <summary>Number of refresh actions that failed.</summary>
    public long RefreshesFailed => Interlocked.Read(ref _refreshesFailed);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TeslaAccountPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TeslaAccountRegistration.Slug}");
    }

    /// <summary>Record that a refresh was requested (no account detail is ever logged).</summary>
    public void RecordRefreshRequested()
    {
        Interlocked.Increment(ref _refreshesRequested);
        _sink?.Invoke($"teslaAccount.refresh.requested slug={TeslaAccountRegistration.Slug}");
    }

    /// <summary>Record the resolution of a refresh (success/failure only — never account detail).</summary>
    public void RecordRefreshResolved(bool success)
    {
        if (success)
        {
            Interlocked.Increment(ref _refreshesSucceeded);
        }
        else
        {
            Interlocked.Increment(ref _refreshesFailed);
        }

        _sink?.Invoke(
            $"teslaAccount.refresh.resolved slug={TeslaAccountRegistration.Slug} success={(success ? "true" : "false")}");
    }
}
